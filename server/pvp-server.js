// The PvP WebSocket endpoint (spec §1, §3; public launch 4a §1-§2):
// upgrades /pvp on the web server, screens every socket (limits.js) and
// every name (names.js), turns hello into a room seat — private, by code, or
// a quick-joined public room — feeds validated inputs to server/rooms.js,
// runs each room's 30 Hz loop, broadcasts snapshots and kicks idle humans.
// Heartbeat pings drop dead sockets.
//
// A seat outlives a dropped socket by NET.reconnectGraceMs (4b spec §2): the
// welcome hands out a seat token, and hello.resume with it re-seats the same
// hero on a new socket; a bye gives the seat up at once.
//
// Privacy: a caller's IP is used only as a key into the gate's in-memory
// counters (server/limits.js). It is never logged and never sent anywhere;
// the only log line about refusals is a count per period. Seat tokens live
// only in memory, only in `tokens`, and are never logged either.
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, quickJoin, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, drainKicks,
  markAway, resumeSeat, drainExpired } from './rooms.js'
import { makeGate, admit, release, takeHello, noteFlood, sweepGate, makeConnLimits, allowMessage, allowClass, clientIp,
  canCreateRoom, noteRoomCreated, noteRoomClosed } from './limits.js'
import { acceptableName } from './names.js'
import { MSG, ERR, encode, decode, validateHello, validateInput, validateClass } from '../renderer/net/protocol.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(encode(msg)) }

// A refusal: tell the client why (when there is a code — a flood has none),
// then close. A peer that ignores the close frame (or never even parses it)
// would otherwise sit in Cloud Run's connection count for as long as the
// underlying library waits for the close handshake (~15 s) — long enough for
// one IP to fill out the concurrency cap. The unref'd fallback forces it
// closed well before that; a normal peer's own close beats it and clears it.
function closeAndReap(ws, code) {
  if (code) send(ws, { type: MSG.ERROR, code })
  ws.close(1008)
  const reap = setTimeout(() => { try { ws.terminate() } catch { /* already gone */ } }, 1000)
  reap.unref?.()
  ws.once('close', () => clearTimeout(reap))
}

export function heartbeatSweep(clients) {
  for (const ws of clients) {
    if (ws.missed >= NET.heartbeatMisses) { ws.terminate(); continue }
    ws.missed = (ws.missed ?? 0) + 1
    ws.ping()
  }
}

export function attachPvp(httpServer, { path = NET.path, heartbeatMs = NET.heartbeatMs, helloTimeoutMs = NET.helloTimeoutMs,
  trustProxy = NET.trustProxy, refusalLogMs = NET.refusalLogMs, log = console.log, now = () => performance.now(),
  ...lobbyOpts } = {}) {
  const lobby = makeLobby(lobbyOpts)
  const gate = makeGate()
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxPayload })
  const loops = new Map()

  // Seat token → { roomCode, heroId }. One live token per seat: a resume
  // spends the old one, and a seat given up takes its token with it.
  const tokens = new Map()

  function issueToken(room, heroId) {
    const token = randomBytes(16).toString('hex')
    tokens.set(token, { roomCode: room.code, heroId })
    return token
  }

  // Every token of one seat, or (heroId null) of a whole room.
  function dropTokens(code, heroId = null) {
    for (const [token, at] of tokens) if (at.roomCode === code && (heroId === null || at.heroId === heroId)) tokens.delete(token)
  }

  httpServer.on('upgrade', (req, socket, head) => {
    // A malformed request line (e.g. an absolute-form target with an
    // unterminated IPv6 host) makes `new URL` throw ERR_INVALID_URL; left
    // unguarded that is an uncaught exception that kills the process.
    let pathname
    try { pathname = new URL(req.url, 'http://x').pathname }
    catch { socket.destroy(); return }
    if (pathname !== path) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  function broadcast(room, body) {
    for (const [id, ws] of room.sockets) {
      // A reader that cannot keep up (a stalled/slow connection) piles frames
      // up in the OS write buffer; skip it rather than let a snapshot queue
      // grow without bound behind it.
      if (ws.bufferedAmount > NET.maxBuffered) continue
      send(ws, { ...body, ack: ackOf(room, id) })
    }
  }

  // A tick throwing (a sim bug) must not take the whole process — and every
  // other room — down with it: log it, stop this room's loop, drop it from
  // the lobby, and boot its sockets. The sockets' own 'close' handlers check
  // lobby.rooms before touching the room again, so they don't re-throw on
  // teardown of a room that is already gone.
  function crashRoom(room, err) {
    console.error(`[pvp] room ${room.code} crashed, closing it:`, err)
    stopLoop(room.code)
    lobby.rooms.delete(room.code)
    dropTokens(room.code)
    if (room.creatorIp) noteRoomClosed(gate, room.creatorIp)
    for (const ws of room.sockets.values()) { try { ws.close(1011) } catch { /* already gone */ } }
  }

  // A room the lobby no longer holds: stop its loop and, if it was counted
  // against its creator's roomsPerIp cap, free that slot.
  function roomGone(room) {
    stopLoop(room.code)
    if (room.creatorIp) noteRoomClosed(gate, room.creatorIp)
  }

  // Give a seat up for good: its token, its hero (a public room's bot fill
  // takes the seat) and, with the last seat, the room.
  function vacate(room, heroId) {
    dropTokens(room.code, heroId)
    leaveRoom(lobby, room, heroId)
    if (!lobby.rooms.has(room.code)) roomGone(room)
  }

  // Free a seat from the server side (the idle kick): tell the client why,
  // leave the room now and close. The socket's own 'close' handler runs
  // later and finds the seat no longer its own: nothing to do.
  function kick(room, heroId, code) {
    const ws = room.sockets.get(heroId)
    room.sockets.delete(heroId)
    vacate(room, heroId)
    if (ws) { send(ws, { type: MSG.ERROR, code }); ws.close(1000) }
  }

  // hello.resume: back into an away seat of a live room, or resume_failed —
  // the token unknown, spent or expired, the room gone, or the seat's own
  // socket still open (rooms.js's resumeSeat now takes that over instead of
  // refusing it — CONTROLLER RULING 2026-09-26; see closeSuperseded below for
  // the socket-layer half of that takeover).
  function resume(token) {
    const at = tokens.get(token)
    const room = at && lobby.rooms.get(at.roomCode)
    if (!room) return { error: ERR.RESUME_FAILED }
    const res = resumeSeat(room, at.heroId)
    if (res.error) return res
    tokens.delete(token)
    return res
  }

  // A resume that lands on a seat whose own socket is still open (a phone
  // that switched networks before the old link was noticed dead) takes the
  // seat over rather than being refused. The old socket is told nothing —
  // there is no message for this — just closed 4001 'replaced', flagged so
  // its own 'close' handler does nothing to the seat (that seat is already
  // the new socket's), while the gate release for that socket's own
  // connection still runs exactly once, same as any other close.
  function closeSuperseded(room, heroId, ws) {
    const prev = room.sockets.get(heroId)
    if (!prev || prev === ws) return
    prev.replaced = true
    try { prev.close(4001, 'replaced') } catch { /* already gone */ }
  }

  // A validated hello → a seat, or { error }. A name that fails the screen
  // answers bad_name, the same as a malformed one. `ip` is only ever used
  // here as a key into the gate's in-memory counters (roomsPerIp) — never
  // stored on anything sent to a client.
  function seat(hello, ip) {
    if (hello.error) return hello
    if (!acceptableName(hello.name)) return { error: ERR.BAD_NAME }
    const wantsNewRoom = hello.create || hello.quick
    const underCap = !wantsNewRoom || canCreateRoom(gate, ip)
    const res = hello.create ? createRoom(lobby, hello)
      : hello.quick ? quickJoin(lobby, hello)
      : joinRoom(lobby, hello.room, hello)
    if (res.error) return res
    // heroId 'p1' only ever happens for the room's own creator (an existing
    // room's p1 is already taken), so this is exactly "quickJoin/createRoom
    // made a brand-new room" without rooms.js needing to know about IPs.
    const madeNewRoom = wantsNewRoom && res.heroId === 'p1'
    if (madeNewRoom && !underCap) {
      leaveRoom(lobby, res.room, res.heroId)   // undo: the only seat in it, so this closes the room too
      gate.refused.rate_limited++
      return { error: ERR.RATE_LIMITED }
    }
    if (madeNewRoom) { noteRoomCreated(gate, ip); res.room.creatorIp = ip }
    return res
  }

  function ensureLoop(room) {
    if (loops.has(room.code)) return
    const tickMs = PVP.tick * 1000
    let last = performance.now(), acc = 0
    loops.set(room.code, setInterval(() => {
      try {
        const now = performance.now()
        acc += Math.min(now - last, PVP.maxFrame * 1000)
        last = now
        while (acc >= tickMs) {
          acc -= tickMs
          const body = stepRoom(lobby, room)
          if (body) broadcast(room, body)
          for (const id of drainKicks(room)) kick(room, id, ERR.IDLE)
          for (const id of drainExpired(room)) vacate(room, id)
          if (lobby.rooms.get(room.code) !== room) return
        }
      } catch (err) { crashRoom(room, err) }
    }, tickMs))
  }

  function stopLoop(code) {
    clearInterval(loops.get(code))
    loops.delete(code)
  }

  wss.on('connection', (ws, req) => {
    // An oversized frame (over maxPayload) surfaces here as a RangeError,
    // not a 'close' — without this handler it is an uncaught exception.
    // Installed first, before any early return.
    ws.on('error', () => { try { ws.terminate() } catch { /* already gone */ } })
    // The upgrade is accepted, then a socket over the per-IP or total cap is
    // told why and closed. A refused socket is never counted, so nothing
    // releases it.
    const ip = clientIp(req, trustProxy)
    const refused = admit(gate, ip, now())
    if (refused) { closeAndReap(ws, refused); return }
    ws.missed = 0
    ws.on('pong', () => { ws.missed = 0 })
    const budget = makeConnLimits(now())
    let room = null, heroId = null
    // Set when this socket's seat must go the moment it closes, with no
    // grace: a flood refusal or a message that crashed its handler.
    let leaveNow = false
    // A socket that never sends hello would otherwise sit open forever.
    const helloTimer = setTimeout(() => { if (!room) ws.close(1008) }, helloTimeoutMs)
    ws.on('message', (data, isBinary) => {
      // Closing (a kick, a flood): anything still arriving is ignored.
      if (ws.readyState !== 1) return
      if (!allowMessage(budget, now())) { noteFlood(gate); leaveNow = true; closeAndReap(ws); return }
      const msg = isBinary ? null : decode(data)
      if (!msg) { ws.close(1003); return }
      // A message can arrive from this socket after its room has already
      // been torn down (crashRoom) but before the close handshake finishes;
      // room is still set, so without this it would reach queueInput/
      // setRoomClass on a dead room (e.g. room.match is gone) and throw.
      if (room && lobby.rooms.get(room.code) !== room) return
      // Hello handling shares this try with message dispatch below: a future
      // arena with fewer spawns than NET.maxHeroes (or any other bug in
      // createRoom/joinRoom/quickJoin) must close just this socket with 1011,
      // not take the process down.
      try {
        if (!room) {
          if (msg.type !== MSG.HELLO) { ws.close(1008); return }
          if (!takeHello(gate, ip, now())) { closeAndReap(ws, ERR.RATE_LIMITED); return }
          const hello = validateHello(msg)
          const res = hello.resume ? resume(hello.resume) : seat(hello, ip)
          if (res.error) { closeAndReap(ws, res.error); return }
          room = res.room; heroId = res.heroId
          clearTimeout(helloTimer)
          room.sockets ??= new Map()
          // A resume onto a seat whose own socket is still open takes it
          // over (CONTROLLER RULING 2026-09-26): the old socket is closed
          // 4001 here, before this one takes the map entry, so its own
          // 'close' handler sees room.sockets.get(heroId) already pointing
          // elsewhere and does nothing to the seat.
          closeSuperseded(room, heroId, ws)
          room.sockets.set(heroId, ws)
          ensureLoop(room)
          send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick,
            arena: room.match.arena.id, token: issueToken(room, heroId) })
          return
        }
        // A deliberate leave: the seat goes now, with no grace. The close
        // handler then finds the seat no longer this socket's.
        if (msg.type === MSG.BYE) {
          room.sockets.delete(heroId)
          vacate(room, heroId)
          ws.close(1000)
          return
        }
        if (msg.type === MSG.INPUT) { const input = validateInput(msg); if (input) queueInput(room, heroId, input) }
        else if (msg.type === MSG.CLASS) { if (validateClass(msg.cls) && allowClass(budget, now())) setRoomClass(room, heroId, msg.cls) }
        else if (msg.type === MSG.PING) { if (Number.isFinite(msg.t)) send(ws, { type: MSG.PONG, t: msg.t }) }
      } catch (err) {
        console.error(`[pvp] message handling failed (room ${room?.code}, hero ${heroId}):`, err)
        leaveNow = true
        try { ws.close(1011) } catch { /* already gone */ }
      }
    })
    ws.on('close', () => {
      release(gate, ip)
      clearTimeout(helloTimer)
      // A resume already took this socket's seat over and closed it 4001:
      // nothing here is this socket's to free, and the gate release above
      // already ran (once, like for any other close).
      if (ws.replaced) return
      if (!room) return
      // A kick or a bye already freed this seat, or a resume moved it to a
      // newer socket: this one owns nothing any more.
      if (room.sockets.get(heroId) !== ws) return
      room.sockets.delete(heroId)
      // The room may already have been torn down by crashRoom(); its own
      // sockets are being closed right now, so leaveRoom must not run again
      // against a room the lobby no longer holds.
      if (lobby.rooms.get(room.code) !== room) return
      try {
        // An unexpected drop keeps the seat for NET.reconnectGraceMs.
        if (leaveNow) vacate(room, heroId)
        else markAway(lobby, room, heroId)
      } catch (err) {
        // Belt-and-braces: leaveRoom/markAway touch room.match too, so if
        // this room is in some other unexpected broken state, don't let
        // tearing down one departing socket take the process down.
        // crashRoom logs, stops the loop, drops the room and closes every
        // socket still in it.
        crashRoom(room, err)
      }
    })
  })

  const heartbeat = setInterval(() => heartbeatSweep(wss.clients), heartbeatMs)
  // Refusal counts once a period, only when there were any — never an address.
  const sweeper = setInterval(() => {
    const counts = Object.entries(sweepGate(gate, now())).filter(([, n]) => n > 0)
    if (counts.length) log(`[pvp] refused in the last ${Math.round(refusalLogMs / 1000)} s: ${counts.map(([k, n]) => `${k} ${n}`).join(', ')}`)
  }, refusalLogMs)

  return {
    lobby, wss, gate, tokens,
    close() {
      clearInterval(heartbeat)
      clearInterval(sweeper)
      for (const code of [...loops.keys()]) stopLoop(code)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}
