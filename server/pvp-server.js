// The PvP WebSocket endpoint (spec §1, §3): upgrades /pvp on the web server,
// turns hello into a room seat, feeds validated inputs to server/rooms.js,
// runs each room's 30 Hz loop and broadcasts snapshots. Heartbeat pings drop
// dead sockets.
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf } from './rooms.js'
import { MSG, encode, decode, validateHello, validateInput, validateClass } from '../renderer/net/protocol.js'
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

export function attachPvp(httpServer, { path = NET.path, heartbeatMs = NET.heartbeatMs, helloTimeoutMs = NET.helloTimeoutMs, ...lobbyOpts } = {}) {
  const lobby = makeLobby(lobbyOpts)
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
        }
      } catch (err) { crashRoom(room, err) }
    }, tickMs))
  }

  function stopLoop(code) {
    clearInterval(loops.get(code))
    loops.delete(code)
  }

  wss.on('connection', ws => {
    ws.missed = 0
    ws.on('pong', () => { ws.missed = 0 })
    // An oversized frame (over maxPayload) surfaces here as a RangeError,
    // not a 'close' — without this handler it is an uncaught exception.
    ws.on('error', () => { try { ws.terminate() } catch { /* already gone */ } })
    let room = null, heroId = null
    // A socket that never sends hello would otherwise sit open forever.
    const helloTimer = setTimeout(() => { if (!room) ws.close(1008) }, helloTimeoutMs)
    ws.on('message', (data, isBinary) => {
      const msg = isBinary ? null : decode(data)
      if (!msg) { ws.close(1003); return }
      // A message can arrive from this socket after its room has already
      // been torn down (crashRoom) but before the close handshake finishes;
      // room is still set, so without this it would reach queueInput/
      // setRoomClass on a dead room (e.g. room.match is gone) and throw.
      if (room && lobby.rooms.get(room.code) !== room) return
      // Hello handling shares this try with message dispatch below: a future
      // arena with fewer spawns than NET.maxHeroes (or any other bug in
      // createRoom/joinRoom) must close just this socket with 1011, not take
      // the process down. Belt-and-braces alongside the lobby.rooms check
      // above: a message can still be in flight (already read off the
      // socket, e.g. sent right before the crash) when the room it targets
      // comes apart underneath it, so dispatch never runs unguarded either.
      try {
        if (!room) {
          if (msg.type !== MSG.HELLO) { ws.close(1008); return }
          const hello = validateHello(msg)
          const res = hello.error ? hello : hello.create ? createRoom(lobby, hello) : joinRoom(lobby, hello.room, hello)
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
        else if (msg.type === MSG.CLASS) { if (validateClass(msg.cls)) setRoomClass(room, heroId, msg.cls) }
        else if (msg.type === MSG.PING) { if (Number.isFinite(msg.t)) send(ws, { type: MSG.PONG, t: msg.t }) }
      } catch (err) {
        console.error(`[pvp] message handling failed (room ${room?.code}, hero ${heroId}):`, err)
        try { ws.close(1011) } catch { /* already gone */ }
      }
    })
    ws.on('close', () => {
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
        // one departing socket take the process down. Just deleting the room
        // here would leave its other sockets connected with nothing arriving
        // (the loop is stopped) — crashRoom logs, stops the loop, drops the
        // room and closes every socket still in it with 1011.
        crashRoom(room, err)
      }
    })
  })

  const heartbeat = setInterval(() => heartbeatSweep(wss.clients), heartbeatMs)

  return {
    lobby, wss,
    close() {
      clearInterval(heartbeat)
      for (const code of [...loops.keys()]) stopLoop(code)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}
