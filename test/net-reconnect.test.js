import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { NET } from '../renderer/data/net.js'

const hello = (over = {}) => ({ type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'archer', ...over })
const resumeHello = token => ({ type: 'hello', v: NET.protocolVersion, resume: token })
const botsIn = snap => snap.heroes.filter(h => h.name.startsWith('Bot '))
const roomOf = (srv, code) => srv.pvp.lobby.rooms.get(code)

describe('seat tokens and resume over sockets', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('welcome carries a fresh 32-hex-character token, held only in memory', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    assert.match(w.token, /^[0-9a-f]{32}$/)
    assert.deepEqual(srv.pvp.tokens.get(w.token), { roomCode: w.room, heroId: w.heroId })
    a.bye()
    await waitFor(() => !srv.pvp.tokens.has(w.token))
  })

  it('a dropped client resumes within the grace: same hero, kills kept, a new token, snapshots again', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    const room = roomOf(srv, w.room)
    room.match.heroes.find(h => h.id === w.heroId).kills = 2
    a.ws.terminate()                                        // no bye, no close handshake
    await waitFor(() => room.players.get(w.heroId)?.away)
    assert.equal(room.match.heroes.filter(h => h.id === w.heroId).length, 1, 'the hero stays in the match')
    const b = await rawClient(srv.url)
    b.send(resumeHello(w.token))
    const w2 = await b.next('welcome')
    assert.equal(w2.heroId, w.heroId)
    assert.equal(w2.room, w.room)
    assert.match(w2.token, /^[0-9a-f]{32}$/)
    assert.notEqual(w2.token, w.token)
    assert.equal(srv.pvp.tokens.has(w.token), false, 'the old token is spent')
    const snap = await b.next('snap')
    assert.equal(snap.heroes.find(h => h.id === w.heroId).kills, 2)
    assert.equal(room.players.get(w.heroId).away, false)
    b.bye()
  })

  // CONTROLLER RULING (2026-09-26, design §2, amending the brief's original
  // "a live seat is refused" test): a resume whose token names a seat whose
  // original socket is still open TAKES OVER that seat instead of being
  // refused — rooms.js's resumeSeat already succeeds for a live seat (Task
  // 5); this proves the socket layer completes the takeover: the new socket
  // is welcomed into the same hero with its kills intact, the superseded
  // socket is closed 4001, and the seat is never marked away nor handed to a
  // bot in the interim.
  it('a resume on a live seat takes it over: new socket seated, old one closed 4001, no bot fill', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    const room = roomOf(srv, w.room)
    room.match.heroes.find(h => h.id === w.heroId).kills = 3
    const other = await rawClient(srv.url)
    other.send(hello({ quick: true, name: 'Ilmari' }))
    await other.next('welcome')
    await waitFor(() => botsIn(other.last('snap') ?? { heroes: [] }).length === 2)

    const b = await rawClient(srv.url)
    b.send(resumeHello(w.token))                            // a's socket is still open
    const w2 = await b.next('welcome')
    assert.equal(w2.heroId, w.heroId)
    assert.equal(w2.room, w.room)
    assert.match(w2.token, /^[0-9a-f]{32}$/)
    assert.notEqual(w2.token, w.token)
    const snap = await b.next('snap')
    assert.equal(snap.heroes.find(h => h.id === w.heroId).kills, 3, 'the same hero, kills kept')

    await waitFor(() => a.closed !== null)
    assert.equal(a.closed, 4001, 'the superseded socket is closed')
    assert.equal(room.players.get(w.heroId).away, false, 'the seat was never marked away')
    assert.equal(botsIn(other.last('snap')).length, 2, 'no bot replaced it')
    assert.equal(srv.pvp.tokens.has(w.token), false, 'the old token is spent')
    b.bye(); other.bye()
  })

  it('a spent token and a made-up token get resume_failed', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    a.ws.terminate()
    await waitFor(() => roomOf(srv, w.room).players.get(w.heroId)?.away)
    const back = await rawClient(srv.url)
    back.send(resumeHello(w.token))
    await back.next('welcome')
    for (const token of [w.token, 'f'.repeat(32)]) {
      const c = await rawClient(srv.url)
      c.send(resumeHello(token))
      assert.equal((await c.next('error')).code, 'resume_failed')
    }
    back.bye()
  })

  it('a bye releases the seat at once: a bot takes it and the token is dead', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const wa = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ quick: true, name: 'Ilmari' }))
    await b.next('welcome')
    await waitFor(() => botsIn(b.last('snap') ?? { heroes: [] }).length === 2)
    const t0 = performance.now()
    a.bye()
    await waitFor(() => botsIn(b.last('snap')).length === 3)
    assert.ok(performance.now() - t0 < NET.reconnectGraceMs / 4, 'no grace period')
    const c = await rawClient(srv.url)
    c.send(resumeHello(wa.token))
    assert.equal((await c.next('error')).code, 'resume_failed')
    b.bye()
  })

  it('a flood refusal is not a drop: the seat goes at once, with no grace', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ create: true }))
    const w = await c.next('welcome')
    for (let i = 0; i < NET.msgBurst + 50; i++) c.send({ type: 'ping', t: i })
    await waitFor(() => c.closed !== null)
    assert.equal(c.closed, 1008)
    await waitFor(() => !roomOf(srv, w.room), 1000)
    assert.equal(srv.pvp.tokens.has(w.token), false)
  })

  it('a resume spends a hello like any other', async () => {
    const ip = '198.51.100.40'
    for (let i = 0; i < NET.helloBurst; i++) {
      const c = await rawClient(srv.url, { ip })
      c.send(resumeHello('0'.repeat(32)))
      assert.equal((await c.next('error')).code, 'resume_failed')
      await waitFor(() => c.closed !== null)
    }
    const late = await rawClient(srv.url, { ip })
    late.send(resumeHello('0'.repeat(32)))
    assert.equal((await late.next('error')).code, 'rate_limited')
  })
})

describe('the grace period over sockets', async () => {
  const srv = await startServer({ reconnectGraceMs: 300 })
  after(() => srv.close())

  it('after the grace: resume_failed, and in a public room a bot takes the seat', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const wa = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ quick: true, name: 'Ilmari' }))
    await b.next('welcome')
    await waitFor(() => botsIn(b.last('snap') ?? { heroes: [] }).length === 2)
    a.ws.terminate()
    await sleep(100)
    assert.equal(botsIn(b.last('snap')).length, 2, 'the seat is held during the grace')
    await waitFor(() => botsIn(b.last('snap')).length === 3, 3000)
    assert.equal(srv.pvp.tokens.has(wa.token), false)
    const c = await rawClient(srv.url)
    c.send(resumeHello(wa.token))
    assert.equal((await c.next('error')).code, 'resume_failed')
    b.bye()
  })

  it('a lone player who never comes back: the room closes when the grace runs out', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    a.ws.terminate()
    await sleep(100)
    assert.ok(roomOf(srv, w.room), 'still open during the grace')
    await waitFor(() => !roomOf(srv, w.room), 3000)
    const c = await rawClient(srv.url)
    c.send(resumeHello(w.token))
    assert.equal((await c.next('error')).code, 'resume_failed')
  })

  it('an idle kick is not a drop: the seat goes at once, with no grace', async () => {
    const lazy = await startServer({ idleKickMs: 300 })
    try {
      const a = await rawClient(lazy.url)
      a.send(hello({ quick: true }))
      const w = await a.next('welcome')
      assert.equal((await a.next('error', 3000)).code, 'idle')
      await waitFor(() => !lazy.pvp.lobby.rooms.has(w.room))
      assert.equal(lazy.pvp.tokens.size, 0)
    } finally { await lazy.close() }
  })
})
