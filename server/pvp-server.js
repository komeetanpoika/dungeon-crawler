// The PvP WebSocket endpoint (spec §1, §3; public launch 4a §1-§2):
// upgrades /pvp on the web server, screens every socket (limits.js) and
// every name (names.js), turns hello into a room seat — private, by code, or
// a quick-joined public room — feeds validated inputs to server/rooms.js,
// runs each room's 30 Hz loop, broadcasts snapshots and kicks idle humans.
// Heartbeat pings drop dead sockets.
//
// Privacy: a caller's IP is used only as a key into the gate's in-memory
// counters (server/limits.js). It is never logged and never sent anywhere;
// the only log line about refusals is a count per period.
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, quickJoin, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, drainKicks } from './rooms.js'
import { makeGate, admit, release, takeHello, noteFlood, sweepGate, makeConnLimits, allowMessage, allowClass, clientIp } from './limits.js'
import { acceptableName } from './names.js'
import { MSG, ERR, encode, decode, validateHello, validateInput, validateClass } from '../renderer/net/protocol.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(encode(msg)) }

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
    for (const ws of room.sockets.values()) { try { ws.close(1011) } catch { /* already gone */ } }
  }

  // Free a seat from the server side (the idle kick): tell the client why,
  // leave the room now — a public room's bot fill takes the seat — and close.
  // The socket's own 'close' handler runs later and finds nothing to do:
  // leaveRoom is idempotent.
  function kick(room, heroId, code) {
    const ws = room.sockets.get(heroId)
    room.sockets.delete(heroId)
    leaveRoom(lobby, room, heroId)
    if (!lobby.rooms.has(room.code)) stopLoop(room.code)
    if (ws) { send(ws, { type: MSG.ERROR, code }); ws.close(1000) }
  }

  // A validated hello → a seat, or { error }. A name that fails the screen
  // answers bad_name, the same as a malformed one.
  function seat(hello) {
    if (hello.error) return hello
    if (!acceptableName(hello.name)) return { error: ERR.BAD_NAME }
    if (hello.create) return createRoom(lobby, hello)
    if (hello.quick) return quickJoin(lobby, hello)
    return joinRoom(lobby, hello.room, hello)
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
    if (refused) { send(ws, { type: MSG.ERROR, code: refused }); ws.close(1008); return }
    ws.missed = 0
    ws.on('pong', () => { ws.missed = 0 })
    const budget = makeConnLimits(now())
    let room = null, heroId = null
    // A socket that never sends hello would otherwise sit open forever.
    const helloTimer = setTimeout(() => { if (!room) ws.close(1008) }, helloTimeoutMs)
    ws.on('message', (data, isBinary) => {
      // Closing (a kick, a flood): anything still arriving is ignored.
      if (ws.readyState !== 1) return
      if (!allowMessage(budget, now())) { noteFlood(gate); ws.close(1008); return }
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
          if (!takeHello(gate, ip, now())) { send(ws, { type: MSG.ERROR, code: ERR.RATE_LIMITED }); ws.close(1008); return }
          const res = seat(validateHello(msg))
          if (res.error) { send(ws, { type: MSG.ERROR, code: res.error }); ws.close(1008); return }
          room = res.room; heroId = res.heroId
          clearTimeout(helloTimer)
          room.sockets ??= new Map()
          room.sockets.set(heroId, ws)
          ensureLoop(room)
          send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick })
          return
        }
        if (msg.type === MSG.INPUT) { const input = validateInput(msg); if (input) queueInput(room, heroId, input) }
        else if (msg.type === MSG.CLASS) { if (validateClass(msg.cls) && allowClass(budget, now())) setRoomClass(room, heroId, msg.cls) }
        else if (msg.type === MSG.PING) { if (Number.isFinite(msg.t)) send(ws, { type: MSG.PONG, t: msg.t }) }
      } catch (err) {
        console.error(`[pvp] message handling failed (room ${room?.code}, hero ${heroId}):`, err)
        try { ws.close(1011) } catch { /* already gone */ }
      }
    })
    ws.on('close', () => {
      release(gate, ip)
      clearTimeout(helloTimer)
      if (!room) return
      room.sockets.delete(heroId)
      // The room may already have been torn down by crashRoom(); its own
      // sockets are being closed right now, so leaveRoom must not run again
      // against a room the lobby no longer holds.
      if (lobby.rooms.get(room.code) !== room) return
      try {
        leaveRoom(lobby, room, heroId)
        if (!lobby.rooms.has(room.code)) stopLoop(room.code)
      } catch (err) {
        // Belt-and-braces: leaveRoom touches room.match too, so if this room
        // is in some other unexpected broken state, don't let tearing down
        // one departing socket take the process down. crashRoom logs, stops
        // the loop, drops the room and closes every socket still in it.
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
    lobby, wss, gate,
    close() {
      clearInterval(heartbeat)
      clearInterval(sweeper)
      for (const code of [...loops.keys()]) stopLoop(code)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}
