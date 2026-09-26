import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { NET } from '../renderer/data/net.js'

const hello = (over = {}) => ({ type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'archer', ...over })
const move = seq => ({ type: 'input', seq, view: 0, move: { x: seq % 2 ? 1 : -1, y: 0 }, facing: null, attack: false, alt: false, sprint: false })
const botsIn = snap => snap.heroes.filter(h => h.name.startsWith('Bot '))

describe('public rooms over sockets', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('a lone quick-join gets a running match with three bots; a second lands in the same room and a bot leaves', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    const s = await waitFor(() => a.last('snap')?.heroes.length === NET.botFill && a.last('snap'))
    assert.equal(botsIn(s).length, 3)
    assert.equal(s.waiting, false)
    await waitFor(() => a.last('snap').clock > 0)
    const b = await rawClient(srv.url)
    b.send(hello({ quick: true, name: 'Ilmari' }))
    assert.equal((await b.next('welcome')).room, w.room)
    await waitFor(() => { const t = a.last('snap'); return t.heroes.length === NET.botFill && botsIn(t).length === 2 })
    a.bye(); b.bye()
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  it('a private room never has bots', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    await a.next('welcome')
    await waitFor(() => a.last('snap'))
    assert.equal(a.last('snap').heroes.length, 1)
    a.bye()
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  it('a blocked or reserved name is refused as bad_name, like a malformed one', async () => {
    for (const name of ['Bot Ukko', 'V1ttu', 'Admin']) {
      const c = await rawClient(srv.url)
      c.send(hello({ quick: true, name }))
      assert.equal((await c.next('error')).code, 'bad_name')
      await waitFor(() => c.closed !== null)
    }
  })

  it('the 9th socket from one IP is refused with rate_limited; another IP still gets in', async () => {
    const ip = '198.51.100.9'
    const open = []
    for (let i = 0; i < NET.perIpSockets; i++) open.push(await rawClient(srv.url, { ip }))
    const ninth = await rawClient(srv.url, { ip })
    assert.equal((await ninth.next('error')).code, 'rate_limited')
    await waitFor(() => ninth.closed !== null)
    const other = await rawClient(srv.url, { ip: '198.51.100.10' })
    other.send(hello({ create: true }))
    await other.next('welcome')
    for (const c of [...open, other]) c.ws.close()
  })

  it('the 11th hello from one IP inside a minute is refused with rate_limited', async () => {
    const ip = '198.51.100.11'
    for (let i = 0; i < NET.helloBurst; i++) {
      const c = await rawClient(srv.url, { ip })
      c.send(hello({ create: true }))
      await c.next('welcome')
      c.bye()                                               // frees the room, so roomsPerIp never bites
      await waitFor(() => c.closed !== null)
    }
    const late = await rawClient(srv.url, { ip })
    late.send(hello({ create: true }))
    assert.equal((await late.next('error')).code, 'rate_limited')
    await waitFor(() => late.closed !== null)
  })

  it('flooding closes the socket with 1008', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ quick: true }))
    await c.next('welcome')
    for (let i = 0; i < NET.msgBurst + 50; i++) c.send({ type: 'ping', t: i })
    await waitFor(() => c.closed !== null)
    assert.equal(c.closed, 1008)
  })

  it('class spam is ignored, not punished', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ quick: true }))
    await c.next('welcome')
    for (let i = 0; i < 10; i++) c.send({ type: 'class', cls: i % 2 ? 'mage' : 'warrior' })
    await sleep(200)
    assert.equal(c.closed, null)
    c.ws.close()
  })
})

describe('rooms per IP (item 2b)', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('a create beyond NET.roomsPerIp is refused with rate_limited; a quick-join into an existing room does not count', async () => {
    const ip = '198.51.100.13'
    const a = await rawClient(srv.url, { ip })
    a.send(hello({ quick: true }))                          // new public room #1 (1/2)
    await a.next('welcome')
    const b = await rawClient(srv.url, { ip })
    b.send(hello({ quick: true, name: 'Ilmari' }))           // joins room #1 — no new room, doesn't count
    await b.next('welcome')
    const c = await rawClient(srv.url, { ip })
    c.send(hello({ create: true, name: 'Kalle' }))           // new private room #2 (2/2)
    await c.next('welcome')
    const d = await rawClient(srv.url, { ip })
    d.send(hello({ create: true, name: 'Essi' }))            // a 3rd new room: over the cap
    assert.equal((await d.next('error')).code, 'rate_limited')
    await waitFor(() => d.closed !== null)
    for (const s of [a, b, c]) s.ws.close()
  })

  it('closing a room frees its creator\'s slot', async () => {
    const ip = '198.51.100.14'
    const rooms = []
    for (let i = 0; i < NET.roomsPerIp; i++) {
      const c = await rawClient(srv.url, { ip })
      c.send(hello({ create: true }))
      await c.next('welcome')
      rooms.push(c)
    }
    const over = await rawClient(srv.url, { ip })
    over.send(hello({ create: true }))
    assert.equal((await over.next('error')).code, 'rate_limited')
    await waitFor(() => over.closed !== null)
    rooms[0].bye()
    await waitFor(() => rooms[0].closed !== null)
    const after1 = await rawClient(srv.url, { ip })
    after1.send(hello({ create: true }))
    await after1.next('welcome')
    for (const s of [rooms[1], after1]) s.ws.close()
  })

  it('a different IP is unaffected by another IP being at its cap', async () => {
    const ip = '198.51.100.15'
    const rooms = []
    for (let i = 0; i < NET.roomsPerIp; i++) {
      const c = await rawClient(srv.url, { ip })
      c.send(hello({ create: true }))
      await c.next('welcome')
      rooms.push(c)
    }
    const other = await rawClient(srv.url, { ip: '198.51.100.16' })
    other.send(hello({ create: true }))
    await other.next('welcome')
    for (const s of [...rooms, other]) s.ws.close()
  })
})

describe('the idle kick over sockets', async () => {
  const srv = await startServer({ idleKickMs: 300 })
  after(() => srv.close())

  it('an idle client gets error idle and is closed; its room goes with it', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ quick: true }))
    await c.next('welcome')
    assert.equal((await c.next('error', 3000)).code, 'idle')
    await waitFor(() => c.closed !== null)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  it("in a shared public room the idle human's seat goes to a bot", async () => {
    const idle = await rawClient(srv.url)
    idle.send(hello({ quick: true }))
    await idle.next('welcome')
    const busy = await rawClient(srv.url)
    busy.send(hello({ quick: true, name: 'Ilmari' }))
    await busy.next('welcome')
    let seq = 0
    const timer = setInterval(() => busy.send(move(++seq)), 50)
    try {
      assert.equal((await idle.next('error', 3000)).code, 'idle')
      await waitFor(() => { const s = busy.last('snap'); return s && s.heroes.length === NET.botFill && botsIn(s).length === 3 })
      assert.equal(busy.closed, null)
    } finally {
      clearInterval(timer)
      busy.ws.close()
    }
  })
})

describe('the refusal log', () => {
  it('logs counts once per period, and never an address', async () => {
    const lines = []
    const srv = await startServer({ refusalLogMs: 100, log: l => lines.push(l) })
    try {
      const ip = '198.51.100.77'
      const open = []
      for (let i = 0; i < NET.perIpSockets + 1; i++) open.push(await rawClient(srv.url, { ip }))
      await waitFor(() => lines.length > 0)
      assert.match(lines[0], /rate_limited 1/)
      assert.ok(!lines.some(l => l.includes(ip) || l.includes('127.0.0.1')))
      for (const c of open) c.ws.close()
    } finally {
      await srv.close()
    }
  })
})

describe('arena rotation over sockets', async () => {
  const srv = await startServer({ matchLength: 1, resultsDelay: 0.3 })
  after(() => srv.close())

  it('welcome names the arena; after matchStart the snapshots name the next one', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    assert.equal((await a.next('welcome')).arena, 'pillars')
    assert.equal((await a.next('snap')).arena, 'pillars')
    const glade = await waitFor(() => a.messages.find(m => m.type === 'snap' && m.arena === 'glade'), 4000)
    const started = a.messages.filter(m => m.type === 'snap' && m.tick <= glade.tick).flatMap(m => m.events)
    assert.ok(started.some(e => e.type === 'matchStart'), 'the arena changed at a matchStart')
    a.ws.close()
  })
})
