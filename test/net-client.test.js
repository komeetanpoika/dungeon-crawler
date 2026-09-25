import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { connect, frame, sessionView, drainCues, drainEvents } from '../renderer/net/client.js'
import { heroSnap } from '../renderer/net/protocol.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

// A properly placed hero (px/py set) — makeMatch does the placeHero a bare
// makeHero() does not.
const lone = () => makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'archer' }] }).heroes[0]

// A fake WebSocket driven entirely by hand: connect() wires onopen/onmessage
// onto it, tests fire onmessage directly with snapshots, never opening a real
// socket.
class FakeWS {
  constructor() { this.sent = [] }
  send(text) { this.sent.push(JSON.parse(text)) }
  close() {}
}

const open = () => connect({ url: 'ws://x', WebSocketImpl: FakeWS, now: () => 0, hello: { name: 'A', cls: 'archer', create: true } })
const welcome = s => s.ws.onmessage({ data: JSON.stringify({ type: 'welcome', room: 'ABCD', heroId: 'p1' }) })

const snapBody = (hero, over = {}) => ({
  type: 'snap', tick: 0, clock: 0, waiting: false, ended: false, matchLength: 240,
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
