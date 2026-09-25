import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { heartbeatSweep } from '../server/pvp-server.js'
import { NET } from '../renderer/data/net.js'

const hello = (over = {}) => ({ type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'archer', ...over })
const input = (seq, over = {}) => ({ type: 'input', seq, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false, ...over })

describe('pvp server', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('create → welcome with a room code, then snapshots with ack', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    assert.match(w.room, /^[A-Z]{4}$/)
    assert.equal(w.heroId, 'p1')
    const s = await a.next('snap')
    assert.equal(s.heroes.length, 1)
    assert.equal(s.waiting, true)
    assert.equal(s.ack, 0)
    a.ws.close()
  })

  it('join with the code (any case) → p2, and both see two heroes, clock running', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room } = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ room: room.toLowerCase(), name: 'Aino' }))
    assert.equal((await b.next('welcome')).heroId, 'p2')
    await waitFor(() => a.last('snap')?.heroes.length === 2 && a.last('snap').waiting === false)
    a.ws.close(); b.ws.close()
  })

  it('refuses a bad hello with an error code and closes', async () => {
    for (const [msg, code] of [[hello({ room: 'ZZZZ' }), 'no_room'], [hello({ v: 99, create: true }), 'version'], [hello({ name: '<x>', create: true }), 'bad_name']]) {
      const c = await rawClient(srv.url)
      c.send(msg)
      assert.equal((await c.next('error')).code, code)
      await waitFor(() => c.closed !== null)
    }
  })

  it('closes a socket that speaks before hello, sends garbage, or sends an oversized frame', async () => {
    const early = await rawClient(srv.url)
    early.send(input(1))
    await waitFor(() => early.closed !== null)
    const junk = await rawClient(srv.url)
    junk.send('{nope')
    await waitFor(() => junk.closed !== null)
    const big = await rawClient(srv.url)
    big.send(hello({ create: true }))
    await big.next('welcome')
    big.send('x'.repeat(NET.maxPayload + 100))
    await waitFor(() => big.closed !== null)
  })

  it('out-of-range input only ever moves the hero at walking speed', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { heroId } = await a.next('welcome')
    const start = (await a.next('snap')).heroes.find(h => h.id === heroId).px
    for (let s = 1; s <= 15; s++) { a.send(input(s, { move: { x: 50, y: 0 }, facing: 'up' })); await sleep(33) }
    await sleep(100)
    const end = a.last('snap').heroes.find(h => h.id === heroId).px
    assert.ok(end > start, 'it moved')
    assert.ok(end - start <= 120 * 0.7 + 8, `moved ${end - start} px in ~0.6 s`)
    a.ws.close()
  })

  it('answers ping with pong', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    await a.next('welcome')
    a.send({ type: 'ping', t: 42 })
    assert.equal((await a.next('pong')).t, 42)
    a.ws.close()
  })

  it('the last socket out destroys the room', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room } = await a.next('welcome')
    assert.ok(srv.pvp.lobby.rooms.has(room))
    a.ws.close()
    await waitFor(() => !srv.pvp.lobby.rooms.has(room))
  })

  it('a malformed upgrade request line does not crash the server', async () => {
    const { port, hostname } = new URL(srv.url.replace('ws:', 'http:'))
    await new Promise((resolve, reject) => {
      const sock = net.connect(Number(port), hostname, () => {
        sock.write(
          'GET http://[ HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
        )
      })
      sock.on('error', () => {})     // the socket is expected to be destroyed server-side
      sock.on('close', resolve)
      setTimeout(() => { sock.destroy(); resolve() }, 500)
    })
    // The process (and this server) must still be alive and able to serve a normal client.
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    assert.match(w.room, /^[A-Z]{4}$/)
    a.ws.close()
  })

  it('a close-handler exception crashes the room, closing every other socket in it too', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room: code } = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ room: code, name: 'Guest' }))
    await b.next('welcome')
    // Break leaveRoom's next call for this room (removeHero reads room.match).
    srv.pvp.lobby.rooms.get(code).match = null
    a.ws.close()
    await waitFor(() => b.closed !== null)
    assert.equal(b.closed, 1011)
    assert.ok(!srv.pvp.lobby.rooms.has(code))
  })

  it('an exception during hello handling closes that socket, not the server', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room: code } = await a.next('welcome')
    const room = srv.pvp.lobby.rooms.get(code)
    // Shrink room A's arena to exactly its current hero count — a copy, never
    // the shared PVP_ARENAS singleton — so the next join's addHero throws
    // "arena is full", standing in for "a future arena with fewer spawns than
    // maxHeroes". Unlike planting a malformed hero in match.heroes, this
    // leaves the match itself untouched, so room A's 30 Hz loop (which keeps
    // stepping it the whole time this test awaits B's close) has nothing
    // broken to trip over and crash the room on.
    room.match.arena = { ...room.match.arena, spawns: room.match.arena.spawns.slice(0, room.match.heroes.length) }
    const b = await rawClient(srv.url)
    b.send(hello({ room: code, name: 'Guest' }))
    await waitFor(() => b.closed !== null)
    assert.equal(b.closed, 1011)
    // The server (and room A) must still be serving.
    const c = await rawClient(srv.url)
    c.send(hello({ create: true }))
    const w = await c.next('welcome')
    assert.match(w.room, /^[A-Z]{4}$/)
    assert.ok(srv.pvp.lobby.rooms.has(code))
    a.ws.close(); c.ws.close()
  })

  it('skips a socket whose bufferedAmount exceeds NET.maxBuffered', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room: code } = await a.next('welcome')
    const room = srv.pvp.lobby.rooms.get(code)
    const heroId = [...room.sockets.keys()][0]
    let sent = 0
    const fake = { readyState: 1, bufferedAmount: NET.maxBuffered + 1, send: () => { sent++ } }
    room.sockets.set(heroId, fake)
    await sleep(100)
    assert.equal(sent, 0, 'a slow reader must not be sent to')
    room.sockets.delete(heroId)
    a.ws.close()
  })

  it('a crashing room does not take down the server or other rooms', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room: codeA } = await a.next('welcome')
    await a.next('snap')

    const b = await rawClient(srv.url)
    b.send(hello({ create: true }))
    const { room: codeB } = await b.next('welcome')
    await b.next('snap')

    // Break room A's simulation so its next tick throws, then immediately
    // start flooding that socket with inputs, every event-loop turn, right
    // through the crash and this socket's close handshake — trying to land
    // one in the window where `room` is still set on the connection but the
    // room is no longer valid. setImmediate (not a timer) gives the
    // tightest cadence available without touching prod code.
    srv.pvp.lobby.rooms.get(codeA).match = null
    let racing = true
    const raceLoop = () => {
      if (!racing) return
      if (a.ws.readyState === 1) { try { a.send(input(99)) } catch { /* already gone */ } }
      setImmediate(raceLoop)
    }
    raceLoop()
    await waitFor(() => a.closed !== null)
    racing = false
    assert.ok(!srv.pvp.lobby.rooms.has(codeA))

    // Room B must still be alive and ticking.
    const before = b.messages.filter(m => m.type === 'snap').length
    await waitFor(() => b.messages.filter(m => m.type === 'snap').length > before)
    assert.ok(srv.pvp.lobby.rooms.has(codeB))
    b.ws.close()
  })
})

describe('hello timeout', () => {
  it('closes a socket that never sends hello', async () => {
    const srv2 = await startServer({ helloTimeoutMs: 50 })
    const c = await rawClient(srv2.url)
    await waitFor(() => c.closed !== null)
    await srv2.close()
  })
})

describe('heartbeatSweep', () => {
  it('pings live sockets and terminates one that missed two sweeps', () => {
    const log = []
    const sock = name => ({ name, missed: 0, ping: () => log.push(`ping ${name}`), terminate: () => log.push(`kill ${name}`) })
    const a = sock('a'), b = sock('b')
    heartbeatSweep([a, b]); a.missed = 0            // a answered, b didn't
    heartbeatSweep([a, b])
    heartbeatSweep([a, b])
    assert.ok(log.includes('kill b'))
    assert.ok(!log.includes('kill a'))
  })
})
