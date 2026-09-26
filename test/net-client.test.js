import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { connect, frame, sessionView, drainCues, drainEvents, leave } from '../renderer/net/client.js'
import { heroSnap } from '../renderer/net/protocol.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'

// A properly placed hero (px/py set) — makeMatch does the placeHero a bare
// makeHero() does not.
const lone = () => makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'archer' }] }).heroes[0]
// Two properly placed heroes, for tests that need another hero to track as
// "others".
const pair = () => makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'archer' }, { id: 'p2', name: 'B', cls: 'warrior' }] }).heroes

// A fake WebSocket driven entirely by hand: connect() wires onopen/onmessage
// onto it, tests fire onmessage directly with snapshots, never opening a real
// socket.
class FakeWS {
  // readyState starts at CONNECTING(0), as a real socket's does before its
  // onopen fires; tests that need an OPEN(1) transport (leave() checks it
  // directly, per Minor 4) set it explicitly.
  constructor() { this.sent = []; this.readyState = 0 }
  send(text) { this.sent.push(JSON.parse(text)) }
  close() { this.readyState = 3 }
}

const open = () => connect({ url: 'ws://x', WebSocketImpl: FakeWS, now: () => 0, hello: { name: 'A', cls: 'archer', create: true } })
const welcome = (s, over = {}) => s.ws.onmessage({ data: JSON.stringify({ type: 'welcome', room: 'ABCD', heroId: 'p1', arena: 'pillars', ...over }) })

const snapBody = (hero, over = {}) => ({
  type: 'snap', arena: 'pillars', tick: 0, clock: 0, waiting: false, ended: false, matchLength: 240,
  heroes: [heroSnap(hero)], projectiles: [], lightning: [], strikes: [], arcs: [], shockwaves: [],
  pickups: [], events: [], cues: [], ack: 0, ...over,
})

describe('client backgrounded-tab caps', () => {
  it('200 snapshots with cues arrive without any frame: drainCues returns at most 16', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    for (let i = 0; i < 200; i++) s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: i, cues: [`snd${i}`] })) })
    const cues = drainCues(s)
    assert.ok(cues.length <= NET.maxCues, `${cues.length} cues`)
    // and it is the newest ones, not the oldest
    assert.equal(cues.at(-1), 'snd199')
  })

  it('sessionView after a long gap returns no stale floats', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 0 })) })
    const v0 = sessionView(s, 1000)
    assert.ok(v0, 'first view established')
    // A hit event on our own hero adds a damage float.
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 1, events: [{ type: 'hit', target: 'p1', amount: 3 }] })) })
    assert.equal(s.feedback.floats.length, 1, 'float queued')
    // A tab backgrounded well past PVP.maxFrame, then foregrounded again.
    const v1 = sessionView(s, 1000 + PVP.maxFrame * 1000 + 5000)
    assert.equal(v1.feedback.floats.length, 0, 'stale float must not play on return')
  })

  it('a matchStart and a local kill/respawn survive 200 more hit events piling up behind them unread', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    // matchStart plus the local hero's own kill/respawn fire first...
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 0, events: [{ type: 'matchStart' }] })) })
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 1, events: [{ type: 'kill', victim: 'p1', killer: 'other' }] })) })
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 2, events: [{ type: 'respawn', hero: 'p1' }] })) })
    // ...then 200 more hit events pile up behind them (a backgrounded tab, or
    // a player who simply never called drainEvents) before anything drains.
    for (let i = 0; i < 200; i++) {
      s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 3 + i, events: [{ type: 'hit', target: 'other', amount: 1 }] })) })
    }
    const events = drainEvents(s)
    assert.ok(events.length <= NET.maxEvents, `${events.length} events`)
    assert.ok(events.some(e => e.type === 'matchStart'), 'matchStart kept')
    assert.ok(events.some(e => e.type === 'kill' && e.victim === 'p1'), 'local kill kept')
    assert.ok(events.some(e => e.type === 'respawn' && e.hero === 'p1'), 'local respawn kept')
  })
})

describe('client prediction during results', () => {
  const east = { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' }

  it('frame() does not move the predicted hero while the newest snapshot has ended: true', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 0, ended: true })) })
    assert.ok(s.pred, 'predictor established')
    const before = { x: s.pred.hero.px, y: s.pred.hero.py }
    frame(s, east, 0)
    frame(s, east, 16)
    frame(s, east, 34)
    assert.equal(s.pred.hero.px, before.x)
    assert.equal(s.pred.hero.py, before.y)
    // inputs are still sent to the server
    assert.ok(s.ws.sent.some(m => m.type === 'input'))
  })
})

describe('the arena on the wire (protocol v3)', () => {
  it("welcome builds the named arena's map", () => {
    const s = open()
    welcome(s, { arena: 'glade' })
    assert.equal(s.status, 'open')
    assert.equal(s.arena, 'glade')
    assert.equal(s.map.length, PVP_ARENAS.glade.size.h)
    assert.equal(s.map[0].length, PVP_ARENAS.glade.size.w)
  })
  it('a snapshot naming another arena rebuilds the map, and the predictor walks on the new one', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 0 })) })
    const first = s.map
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 1 })) })
    assert.equal(s.map, first, 'the same arena keeps its map object')
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 2, arena: 'tunnels', events: [{ type: 'matchStart' }] })) })
    assert.notEqual(s.map, first)
    assert.equal(s.arena, 'tunnels')
    assert.equal(s.map[0].length, PVP_ARENAS.tunnels.size.w)
    assert.equal(s.pred.map, s.map)
  })
  it('an arena this build does not know is a version refusal', () => {
    for (const arena of ['volcano', 'toString', undefined]) {
      const s = open()
      welcome(s)
      s.ws.onmessage({ data: JSON.stringify(snapBody(lone(), { tick: 0, arena })) })
      assert.equal(s.status, 'error', String(arena))
      assert.equal(s.error, 'version')
      assert.ok(drainEvents(s).some(e => e.type === 'error' && e.code === 'version'))
      assert.equal(s.pred, null, 'the refused snapshot is not applied')
    }
  })
  // Minor 1 (final review): without a reset, the other hero's frozen old-arena
  // position keeps drawing on top of the new arena for a few ticks, since
  // startNextMatch continues match.tick from the frozen results tick.
  it('an arena change at matchStart drops old-arena snapshots and forgets tracked others', () => {
    const s = open()
    welcome(s)
    const [me, other] = pair()
    s.ws.onmessage({ data: JSON.stringify(snapBody(me, { tick: 0, heroes: [heroSnap(me), heroSnap(other)] })) })
    const before = sessionView(s, 0)
    assert.ok(before.others.some(h => h.id === 'p2'), 'other hero tracked before the switch')
    assert.equal(s.interp.snaps.length, 1)
    s.ws.onmessage({ data: JSON.stringify(snapBody(me, { tick: 1, arena: 'tunnels', events: [{ type: 'matchStart' }], heroes: [heroSnap(me)] })) })
    assert.equal(s.interp.snaps.length, 1, 'the old-arena snapshot is gone, not just superseded')
    assert.equal(s.interp.snaps[0].tick, 1)
    assert.equal(s.others.size, 0, 'no stale other-hero position survives the switch')
  })
  it('an unknown arena in the welcome refuses before the session opens', () => {
    const s = open()
    welcome(s, { arena: 'volcano' })
    assert.equal(s.status, 'error')
    assert.equal(s.heroId, null)
  })
})

describe('leaving', () => {
  it('leave() says bye before closing an open session', () => {
    const s = open()
    welcome(s)
    s.ws.readyState = 1                                       // a welcome could only have arrived on an open socket
    let closed = false
    s.ws.close = () => { closed = true }
    leave(s)
    assert.equal(s.ws.sent.at(-1).type, 'bye')
    assert.equal(closed, true)
  })
  it('before the welcome there is no seat to give up: no bye', () => {
    const s = open()
    leave(s)
    assert.ok(!s.ws.sent.some(m => m.type === 'bye'))
  })
  // Minor 4 (final review): the hello may already have reached the server and
  // been seated even though the client is still 'connecting' — sending bye
  // whenever the socket is actually OPEN (not gated on session status) frees
  // the seat at once instead of leaving a statue for the reconnect grace.
  it('leave() while still connecting sends bye if the underlying socket is already open', () => {
    const s = open()
    s.ws.readyState = 1                                       // WebSocket.OPEN, but no welcome received yet
    let closed = false
    s.ws.close = () => { closed = true }
    assert.equal(s.status, 'connecting')
    leave(s)
    assert.equal(s.ws.sent.at(-1).type, 'bye')
    assert.equal(closed, true)
  })
  it('leave() while connecting sends no bye if the socket never opened', () => {
    const s = open()
    assert.equal(s.ws.readyState, 0)
    leave(s)
    assert.ok(!s.ws.sent.some(m => m.type === 'bye'))
  })
})

describe('reconnect', () => {
  // A hand-driven socket that remembers every instance: open() and recv()
  // play the server, close() fires onclose as a real drop would.
  class Sock {
    static all = []
    constructor(url) { this.url = url; this.sent = []; this.closed = false; Sock.all.push(this) }
    send(text) { this.sent.push(JSON.parse(text)) }
    close(code) { if (this.closed) return; this.closed = true; this.onclose?.({ code }) }
    open() { this.onopen?.() }
    recv(msg) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  }
  const TOK = 'a'.repeat(32), TOK2 = 'b'.repeat(32)
  const hi = (token, over = {}) => ({ type: 'welcome', room: 'ABCD', heroId: 'p1', arena: 'pillars', token, ...over })
  let t = 0
  const start = (hello = { name: 'A', cls: 'archer', quick: true }) => {
    Sock.all = []
    t = 0
    const s = connect({ url: 'ws://x', WebSocketImpl: Sock, now: () => t, hello })
    Sock.all[0].open()
    Sock.all[0].recv(hi(TOK))
    drainEvents(s)
    return s
  }
  const drop = s => { t = 1000; Sock.all.at(-1).close(); return s }
  // Frames every 50 ms from now until `until`; each new socket is handed to onSocket.
  const run = (s, until, onSocket = () => {}) => {
    for (; t <= until; t += 50) {
      const n = Sock.all.length
      frame(s, NEUTRAL_INPUT, t)
      if (Sock.all.length > n) onSocket(Sock.all.at(-1), t)
    }
  }

  it('carries the spec numbers', () => {
    assert.deepEqual(NET.reconnectDelaysMs, [500, 1000, 2000, 4000, 8000])
    assert.equal(NET.reconnectGraceMs, 20000)
  })
  it('an unexpected drop after the welcome: Reconnecting, then hello.resume at 0.5, 1.5, 3.5, 7.5 and 15.5 s, then lost', () => {
    const s = drop(start())
    assert.equal(s.status, 'reconnecting')
    assert.deepEqual(drainEvents(s).map(e => e.type), ['reconnecting'])
    const at = []
    run(s, 25000, (sock, when) => {
      at.push(when - 1000)
      sock.open()
      assert.deepEqual(sock.sent[0], { type: 'hello', v: NET.protocolVersion, resume: TOK })
      sock.close()                                           // the attempt fails
    })
    assert.deepEqual(at, [500, 1500, 3500, 7500, 15500])
    assert.equal(s.status, 'lost')
    assert.deepEqual(drainEvents(s).filter(e => e.type === 'closed'), [{ type: 'closed', status: 'lost' }])
  })
  it('a resume that works: open again with a new token, the session reset, and the next snapshot rebuilds the view', () => {
    const s = start()
    Sock.all[0].recv(snapBody(lone(), { tick: 5 }))
    frame(s, NEUTRAL_INPUT, 0); frame(s, NEUTRAL_INPUT, 100)
    assert.ok(s.pred && s.seq > 0)
    drop(s)
    run(s, 1500, sock => { sock.open(); sock.recv(hi(TOK2)) })
    assert.equal(s.status, 'open')
    assert.equal(s.token, TOK2)
    assert.equal(s.heroId, 'p1')
    assert.equal(s.pred, null)
    assert.equal(s.seq, 0)
    assert.equal(Sock.all.length, 2, 'one attempt was enough')
    assert.deepEqual(drainEvents(s).filter(e => e.type === 'welcome').map(e => [e.resumed, e.token]), [[true, TOK2]])
    Sock.all[1].recv(snapBody(lone(), { tick: 50 }))
    assert.ok(sessionView(s, t))
    frame(s, NEUTRAL_INPUT, t)
    frame(s, NEUTRAL_INPUT, t + 40)
    assert.equal(Sock.all[1].sent.find(m => m.type === 'input').seq, 1, 'inputs are numbered afresh')
  })
  // fix round 1, item 2: pre-drop cues/floats must not play late after the
  // resume, and the first sessionView() call back must not mistake the gap
  // since the (pre-drop) lastView for a backgrounded tab and wipe the
  // float/cue a snapshot arriving with the resume itself just queued.
  it('a resume clears pre-drop cues/floats; the first view back does not wipe the ones a fresh snapshot just queued', () => {
    const s = start()
    Sock.all[0].recv(snapBody(lone(), { tick: 5, events: [{ type: 'hit', target: 'p1', amount: 3 }], cues: ['pre-drop-cue'] }))
    frame(s, NEUTRAL_INPUT, 0); frame(s, NEUTRAL_INPUT, 100)
    assert.equal(s.feedback.floats.length, 1, 'pre-drop float queued')
    assert.deepEqual(s.cues, ['pre-drop-cue'])
    sessionView(s, 200)                                      // establishes a (soon stale) lastView
    drop(s)
    run(s, 1500, sock => { sock.open(); sock.recv(hi(TOK2)) })
    assert.equal(s.status, 'open')
    assert.equal(s.cues.length, 0, 'pre-drop cues are gone')
    assert.equal(s.feedback.floats.length, 0, 'pre-drop floats are gone')
    assert.equal(s.lastView, null, 'lastView is reset, not left pointing at the pre-drop gap')
    // A snapshot right after the resume carries its own fresh float/cue.
    Sock.all[1].recv(snapBody(lone(), { tick: 50, events: [{ type: 'hit', target: 'p1', amount: 5 }], cues: ['post-resume-cue'] }))
    assert.equal(s.feedback.floats.length, 1, 'the fresh float is queued')
    assert.deepEqual(s.cues, ['post-resume-cue'])
    // Far from the old (pre-drop) lastView in wall-clock terms — with
    // lastView left stale this would look like a long-backgrounded tab and
    // wipe the float/cue that just arrived with the resume.
    const v = sessionView(s, t + 5000)
    assert.ok(v)
    assert.equal(s.feedback.floats.length, 1, 'the fresh float survives the first post-resume view')
    assert.deepEqual(s.cues, ['post-resume-cue'], 'the fresh cue survives the first post-resume view')
  })
  it('resuming into a match that has moved to another arena rebuilds the map', () => {
    const s = drop(start())
    const before = s.map
    run(s, 1500, sock => { sock.open(); sock.recv(hi(TOK2, { arena: 'glade' })) })
    assert.equal(s.status, 'open')
    assert.equal(s.arena, 'glade')
    assert.notEqual(s.map, before)
    assert.equal(s.map[0].length, PVP_ARENAS.glade.size.w)
  })
  it('resume_failed ends it: Connection lost', () => {
    const s = drop(start())
    run(s, 1500, sock => { sock.open(); sock.recv({ type: 'error', code: 'resume_failed' }); sock.close() })
    assert.equal(s.status, 'lost')
    assert.equal(Sock.all.length, 2, 'no more attempts')
    assert.deepEqual(drainEvents(s).filter(e => e.type === 'closed').map(e => e.status), ['lost'])
  })
  it('a newer server during a resume: a version error flagged as a reconnect', () => {
    const s = drop(start())
    run(s, 1500, sock => { sock.open(); sock.recv({ type: 'error', code: 'version' }); sock.close() })
    assert.equal(s.status, 'error')
    assert.deepEqual(drainEvents(s).find(e => e.type === 'error'), { type: 'error', code: 'version', reconnect: true })
  })
  it('a rate-limited attempt costs that attempt only: the next one still goes out', () => {
    const s = drop(start())
    let n = 0
    run(s, 3000, sock => {
      sock.open()
      if (n++ === 0) { sock.recv({ type: 'error', code: 'rate_limited' }); sock.close() }
      else sock.recv(hi(TOK2))
    })
    assert.equal(n, 2)
    assert.equal(s.status, 'open')
  })
  it('a tab hidden past the grace gives up at its first frame back, opening no socket', () => {
    const s = drop(start())
    frame(s, NEUTRAL_INPUT, 1000 + NET.reconnectGraceMs + 5000)
    assert.equal(s.status, 'lost')
    assert.equal(Sock.all.length, 1)
  })
  it('an attempt still hanging when the next is due is abandoned for it', () => {
    const s = drop(start())
    const opened = []
    run(s, 3000, sock => opened.push(sock))                 // never answers
    assert.equal(opened.length, 2)
    assert.equal(opened[0].closed, true)
    assert.equal(s.ws, opened[1])
    opened[0].recv(hi(TOK2))                                 // a late answer on the abandoned one is ignored
    assert.equal(s.status, 'reconnecting')
  })
  // fix round 1, item 1 (verify): the abandoned attempt may in fact have
  // reached the server and been superseded there once the next attempt's
  // resume lands (closeSuperseded, server/pvp-server.js) — its own close,
  // whatever code it carries, must land on a socket that is no longer
  // `s.ws` and so change nothing about the live session.
  it('a close (even 4001) arriving late on an already-abandoned attempt changes nothing: s.ws has already moved on', () => {
    const s = drop(start())
    const opened = []
    run(s, 3000, sock => opened.push(sock))                 // never answers
    assert.equal(opened.length, 2)
    assert.equal(s.ws, opened[1])
    opened[0].onclose({ code: 4001 })                        // the server's own close for the superseded attempt
    assert.equal(s.status, 'reconnecting')
    assert.equal(s.ws, opened[1])
  })
  it('Leave while reconnecting stops the retries', () => {
    const s = drop(start())
    drainEvents(s)
    leave(s)
    assert.equal(s.status, 'left')
    run(s, 25000)
    assert.equal(Sock.all.length, 1)
    assert.deepEqual(drainEvents(s), [{ type: 'closed', status: 'left' }])
  })
  it('a clean leave or a drop before the welcome never reconnects', () => {
    const a = start()
    leave(a)
    assert.equal(a.status, 'left')
    assert.ok(!drainEvents(a).some(e => e.type === 'reconnecting'))
    Sock.all = []
    const b = connect({ url: 'ws://x', WebSocketImpl: Sock, now: () => t, hello: { name: 'A', cls: 'archer', quick: true } })
    Sock.all[0].open()
    Sock.all[0].close()
    assert.equal(b.status, 'lost')
  })
  it('hello { resume } from the start (a reloaded tab) sends it and keeps the token for later drops', () => {
    Sock.all = []
    const s = connect({ url: 'ws://x', WebSocketImpl: Sock, now: () => t, hello: { resume: TOK } })
    Sock.all[0].open()
    assert.deepEqual(Sock.all[0].sent[0], { type: 'hello', v: NET.protocolVersion, resume: TOK })
    Sock.all[0].recv(hi(TOK2))
    assert.equal(s.status, 'open')
    assert.equal(s.token, TOK2)
  })
  // Server-side rule (Task 6): another connection resuming into this same
  // seat's token closes THIS socket 4001 'replaced' while it is still live.
  it('a 4001 close (another connection took this seat over) is a final loss, not a drop: no reconnect attempt', () => {
    const s = start()
    drainEvents(s)
    Sock.all[0].close(4001)
    assert.equal(s.status, 'lost')
    assert.equal(Sock.all.length, 1, 'no resume attempt opened')
    const events = drainEvents(s)
    assert.deepEqual(events, [{ type: 'closed', status: 'lost' }])
    run(s, 25000)
    assert.equal(Sock.all.length, 1, 'still no attempt, even past the whole retry schedule')
  })
  it('a 4001 close while already reconnecting also ends it at once', () => {
    const s = drop(start())
    assert.equal(s.status, 'reconnecting')
    drainEvents(s)
    frame(s, NEUTRAL_INPUT, 1500)                             // the first resume attempt opens (drop was at t=1000)
    assert.equal(Sock.all.length, 2)
    Sock.all[1].close(4001)
    assert.equal(s.status, 'lost')
    run(s, 25000)
    assert.equal(Sock.all.length, 2, 'no further attempt after the 4001')
  })
})
