import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
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
