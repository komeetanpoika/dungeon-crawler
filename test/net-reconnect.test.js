import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { startServer, rawClient, waitFor, sleep, drive, laggy } from './net-helpers.js'
import { connect, sessionView, drainEvents, leave } from '../renderer/net/client.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
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

  it('a dropped client resumes within the grace: same hero, kills kept, the same token, snapshots again', async () => {
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
    // CONTROLLER RULING (2026-09-26, spec §2 amended): the token is stable
    // across a resume, not spent — a single-use token let a slow retry lose
    // the seat (an abandoned attempt whose hello still reached the server
    // spent the only token the client had).
    assert.equal(w2.token, w.token)
    assert.equal(srv.pvp.tokens.has(w.token), true, 'the token is still live, naming the same seat')
    const snap = await b.next('snap')
    assert.equal(snap.heroes.find(h => h.id === w.heroId).kills, 2)
    assert.equal(room.players.get(w.heroId).away, false)
    b.bye()
    await waitFor(() => !srv.pvp.tokens.has(w.token))
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
    // The same, stable token comes back — a takeover is still a resume.
    assert.equal(w2.token, w.token)
    const snap = await b.next('snap')
    assert.equal(snap.heroes.find(h => h.id === w.heroId).kills, 3, 'the same hero, kills kept')

    await waitFor(() => a.closed !== null)
    assert.equal(a.closed, 4001, 'the superseded socket is closed')
    assert.equal(room.players.get(w.heroId).away, false, 'the seat was never marked away')
    assert.equal(botsIn(other.last('snap')).length, 2, 'no bot replaced it')
    assert.equal(srv.pvp.tokens.has(w.token), true, 'the token is still live: a takeover does not spend it either')
    b.bye(); other.bye()
  })

  // CONTROLLER RULING (2026-09-26, spec §2 amended, fix round 1): the token
  // is no longer single-use, so the old "a spent token is refused" test no
  // longer applies. Replaced with the two behaviours the ruling actually
  // specifies: the same token resumes again after a second drop, and only a
  // token whose seat has actually been freed (or one that was never real)
  // is refused.
  it('the same token resumes again after another drop: a token is not spent by using it', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    a.ws.terminate()
    await waitFor(() => roomOf(srv, w.room).players.get(w.heroId)?.away)
    const back = await rawClient(srv.url)
    back.send(resumeHello(w.token))
    const w2 = await back.next('welcome')
    assert.equal(w2.token, w.token, 'unchanged by the first resume')
    back.ws.terminate()                                     // drop again, no bye
    await waitFor(() => roomOf(srv, w.room).players.get(w.heroId)?.away)
    const c = await rawClient(srv.url)
    c.send(resumeHello(w.token))                            // the very same token, a second time
    const w3 = await c.next('welcome')
    assert.equal(w3.heroId, w.heroId)
    assert.equal(w3.token, w.token, 'still unchanged by the second resume')
    const snap = await c.next('snap')
    assert.equal(snap.heroes.find(h => h.id === w.heroId).id, w.heroId)
    c.bye()
  })

  it('a made-up token, and a token whose seat has since been freed, both get resume_failed', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    a.bye()                                                 // frees the seat and its token at once
    await waitFor(() => !srv.pvp.tokens.has(w.token))
    for (const token of [w.token, 'f'.repeat(32)]) {
      const c = await rawClient(srv.url)
      c.send(resumeHello(token))
      assert.equal((await c.next('error')).code, 'resume_failed')
    }
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

  // Final-review Minor 2: leaveNow=true (flood) used to only take effect
  // once the close event actually fired; a resume racing in during that
  // window (before the close handshake completes) could still find the
  // token live and rescue the seat the flood just refused. The token must
  // die in the flood handler itself, not wait for 'close'.
  it('a resume racing a flood refusal does not rescue the seat: the token is already gone', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ create: true }))
    const w = await c.next('welcome')
    for (let i = 0; i < NET.msgBurst + 50; i++) c.send({ type: 'ping', t: i })
    // Sent immediately, racing c's own close handshake.
    const other = await rawClient(srv.url)
    other.send(resumeHello(w.token))
    assert.equal((await other.next('error')).code, 'resume_failed')
    await waitFor(() => c.closed !== null)
    assert.equal(c.closed, 1008)
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

describe('the client gets its seat back over a real socket', async () => {
  const srv = await startServer()
  after(() => srv.close())
  // ws's WebSocket, from its own made-up address like rawClient's.
  class FromIp extends WebSocket { constructor(url) { super(url, { headers: { 'x-forwarded-for': '10.7.0.1' } }) } }

  it('a socket killed mid-match: Reconnecting, then the same hero within a second, and snapshots again', async () => {
    const s = connect({ url: srv.url, WebSocketImpl: FromIp, now: () => performance.now(), hello: { name: 'Aino', cls: 'mage', quick: true } })
    await waitFor(() => s.status === 'open' && s.pred, 3000)
    const heroId = s.heroId
    srv.pvp.lobby.rooms.get(s.room).match.heroes.find(h => h.id === heroId).kills = 3
    s.ws.terminate()
    await waitFor(() => s.status === 'reconnecting')
    const t0 = performance.now()
    await drive(s, () => NEUTRAL_INPUT, 1500)
    assert.equal(s.status, 'open')
    assert.equal(s.heroId, heroId)
    assert.ok(performance.now() - t0 < 2000)
    const v = await waitFor(() => sessionView(s, performance.now()), 2000)
    assert.equal(v.me.id, heroId)
    assert.equal(v.me.kills, 3)
    const types = drainEvents(s).map(e => e.type)
    assert.ok(types.includes('reconnecting') && types.includes('welcome'), types.join(','))
    leave(s)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  // The server closes a superseded live seat 4001 'replaced' (Task 6). This
  // socket must not fight the connection that just won the seat by trying
  // its own hello.resume — it is a final loss, not a drop.
  it('a live seat resumed elsewhere: the server closes it 4001, a final loss with no reconnect attempts', async () => {
    const s = connect({ url: srv.url, WebSocketImpl: FromIp, now: () => performance.now(), hello: { name: 'Aino', cls: 'mage', quick: true } })
    await waitFor(() => s.status === 'open' && s.pred, 3000)
    const token = s.token
    const other = await rawClient(srv.url)
    other.send(resumeHello(token))
    await other.next('welcome')
    await waitFor(() => s.status === 'lost')
    // Drive it a while: no reconnect attempt must ever fire from here.
    await drive(s, () => NEUTRAL_INPUT, 1000)
    assert.equal(s.status, 'lost')
    const types = drainEvents(s).map(e => e.type)
    assert.ok(!types.includes('reconnecting'), types.join(','))
    assert.ok(types.includes('closed'))
    other.bye()
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  // CONTROLLER RULING (2026-09-26, spec §2 amended, fix round 1): this is
  // the exact bug the stable token fixes. The first resume attempt's hello
  // reaches the server and succeeds there (the seat is re-seated on it)
  // before its welcome makes it back to the client — slow enough that
  // tickReconnect abandons that attempt for the next one first. With a
  // single-use token the second attempt's hello.resume would have carried a
  // token the server had already deleted, so it would have gotten
  // resume_failed. With the token stable, the second attempt resumes the
  // same hero on the very same token.
  it('an attempt whose welcome is delayed gets abandoned; the next attempt still resumes the same hero', async () => {
    const s = connect({ url: srv.url, WebSocketImpl: FromIp, now: () => performance.now(), hello: { name: 'Aino', cls: 'mage', quick: true } })
    await waitFor(() => s.status === 'open' && s.pred, 3000)
    const heroId = s.heroId
    const token = s.token
    s.ws.terminate()
    await waitFor(() => s.status === 'reconnecting')
    // From here on every socket this session opens is laggy on the way down
    // only (hello reaches the server promptly; its own reply is what is
    // slow) — long enough that the first resume attempt (due at +0.5 s) is
    // abandoned for the second (due at +1.5 s) before its welcome arrives,
    // but short enough that the second attempt's own welcome lands before
    // it, too, would be abandoned (due at +3.5 s).
    s.WebSocketImpl = laggy({ down: 1300 })
    await drive(s, () => NEUTRAL_INPUT, 6000)
    assert.equal(s.status, 'open')
    assert.equal(s.heroId, heroId)
    assert.equal(s.token, token, 'the stable token carried the seat through the abandoned attempt')
    const v = await waitFor(() => sessionView(s, performance.now()), 3000)
    assert.equal(v.me.id, heroId)
    leave(s)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })
})
