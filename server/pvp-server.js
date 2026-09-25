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

export function attachPvp(httpServer, { path = NET.path, heartbeatMs = NET.heartbeatMs, ...lobbyOpts } = {}) {
  const lobby = makeLobby(lobbyOpts)
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxPayload })
  const loops = new Map()

  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== path) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  function broadcast(room, body) {
    for (const [id, ws] of room.sockets) send(ws, { ...body, ack: ackOf(room, id) })
  }

  function ensureLoop(room) {
    if (loops.has(room.code)) return
    const tickMs = PVP.tick * 1000
    let last = performance.now(), acc = 0
    loops.set(room.code, setInterval(() => {
      const now = performance.now()
      acc += Math.min(now - last, PVP.maxFrame * 1000)
      last = now
      while (acc >= tickMs) {
        acc -= tickMs
        const body = stepRoom(lobby, room)
        if (body) broadcast(room, body)
      }
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
    ws.on('message', (data, isBinary) => {
      const msg = isBinary ? null : decode(data)
      if (!msg) { ws.close(1003); return }
      if (!room) {
        if (msg.type !== MSG.HELLO) { ws.close(1008); return }
        const hello = validateHello(msg)
        const res = hello.error ? hello : hello.create ? createRoom(lobby, hello) : joinRoom(lobby, hello.room, hello)
        if (res.error) { send(ws, { type: MSG.ERROR, code: res.error }); ws.close(1008); return }
        room = res.room; heroId = res.heroId
        room.sockets ??= new Map()
        room.sockets.set(heroId, ws)
        ensureLoop(room)
        send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick })
        return
      }
      if (msg.type === MSG.INPUT) { const input = validateInput(msg); if (input) queueInput(room, heroId, input) }
      else if (msg.type === MSG.CLASS) { if (validateClass(msg.cls)) setRoomClass(room, heroId, msg.cls) }
      else if (msg.type === MSG.PING) { if (Number.isFinite(msg.t)) send(ws, { type: MSG.PONG, t: msg.t }) }
    })
    ws.on('close', () => {
      if (!room) return
      room.sockets.delete(heroId)
      leaveRoom(lobby, room, heroId)
      if (!lobby.rooms.has(room.code)) stopLoop(room.code)
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
