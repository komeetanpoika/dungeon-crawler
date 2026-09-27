import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePredictor, predictStep, predictCosmetics, reconcile, tickCorrection, drawnPos } from '../renderer/net/predict.js'
import { heroSnap } from '../renderer/net/protocol.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { NEUTRAL_INPUT, placeHero } from '../renderer/pvp/hero.js'
import { weaponContents } from '../renderer/systems/entities.js'
import { grantBuff } from '../renderer/pvp/buffs.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const east = { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' }
const lone = cls => makeMatch({ roster: [{ id: 'p1', name: 'A', cls }] })

describe('prediction', () => {
  it('replaying the same inputs reproduces the server exactly', () => {
    const m = lone('mage')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    for (let seq = 1; seq <= 20; seq++) {
      const input = { ...east, seq, attack: seq > 5 && seq < 12 }   // a spell wind-up slows the walk
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
    }
    assert.ok(Math.abs(pred.hero.px - m.heroes[0].px) < 1e-9)
    reconcile(pred, heroSnap(m.heroes[0]), 20)
    assert.equal(pred.pending.length, 0)
    assert.deepEqual(pred.corr, { x: 0, y: 0, age: 0 })
    assert.ok(Math.abs(drawnPos(pred).x - m.heroes[0].px) < 1e-9)
  })
  it('a stun mid charge replays in parity: both sides latch needRelease off the same moveHero (m1)', () => {
    const m = lone('mage')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const step = (input, stun) => {
      if (stun !== undefined) { m.heroes[0].stunTimer = stun; pred.hero.stunTimer = stun }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
    }
    step({ ...east, move: { x: 0, y: 0 }, attack: true })          // wind-up begins
    assert.deepEqual(pred.hero.charging, m.heroes[0].charging)
    step({ ...east, move: { x: 0, y: 0 }, attack: true }, 0.1)     // stun cancels it, key still down
    assert.equal(pred.hero.charging, null)
    assert.deepEqual(pred.hero.charging, m.heroes[0].charging)
    assert.equal(pred.hero.needRelease, m.heroes[0].needRelease)
    assert.equal(pred.hero.needRelease, true)
    step({ ...east, move: { x: 0, y: 0 }, attack: true }, 0)       // still held: no new charge either side
    assert.deepEqual(pred.hero.charging, m.heroes[0].charging)
    assert.equal(pred.hero.charging, null)
    step({ ...east, move: { x: 0, y: 0 }, attack: false })         // let go
    step({ ...east, move: { x: 0, y: 0 }, attack: true })          // a fresh press
    assert.deepEqual(pred.hero.charging, m.heroes[0].charging)
    assert.deepEqual(pred.hero.charging, { t: 0, kind: 'spell' })
  })
  it('reconcile replays the unacknowledged inputs on top of the server state', () => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    for (let seq = 1; seq <= 10; seq++) { const input = { ...east, seq }; predictStep(pred, input); pred.pending.push({ seq, input }) }
    const predicted = pred.hero.px
    for (let seq = 1; seq <= 6; seq++) stepMatch(m, { p1: { ...east, seq } }, PVP.tick)
    reconcile(pred, heroSnap(m.heroes[0]), 6)
    assert.equal(pred.pending.length, 4)
    assert.ok(Math.abs(pred.hero.px - predicted) < 1e-9)
  })
  it('a small error blends away over correctionMs; a huge one snaps', () => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const s = heroSnap(m.heroes[0])
    reconcile(pred, { ...s, px: s.px + 10 }, 0)       // the server says we are 10 px further on
    assert.ok(Math.abs(drawnPos(pred).x - s.px) < 1e-9, 'drawn stays put at first')
    tickCorrection(pred, NET.correctionMs / 2)
    assert.ok(Math.abs(drawnPos(pred).x - (s.px + 5)) < 1e-9)
    tickCorrection(pred, NET.correctionMs)
    assert.ok(Math.abs(drawnPos(pred).x - (s.px + 10)) < 1e-9)
    reconcile(pred, { ...s, px: s.px + 500 }, 0)
    assert.equal(drawnPos(pred).x, s.px + 500)
  })
  it('draws the hero alpha of the way through its last step', () => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const x0 = pred.hero.px
    pred.from = { x: x0, y: pred.hero.py }
    predictStep(pred, east)
    const x1 = pred.hero.px
    pred.alpha = 0.5
    assert.ok(Math.abs(drawnPos(pred).x - (x0 + x1) / 2) < 1e-9)
  })
  it('the sword swing animates locally on the release that fires it, not on the press, and once', () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }] })
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const press = { ...NEUTRAL_INPUT, attack: true, facing: 'east' }, let_go = { ...NEUTRAL_INPUT }
    let r = predictStep(pred, press)
    assert.equal(r.released, null)
    predictCosmetics(pred, press, PVP.tick, r.released)
    assert.equal(pred.swing, null, 'the press only begins the hold')
    r = predictStep(pred, let_go)
    assert.deepEqual(r.released, { kind: 'swing', dir: null })
    predictCosmetics(pred, let_go, PVP.tick, r.released)
    assert.ok(pred.swing)
    const first = pred.swing
    predictCosmetics(pred, let_go, PVP.tick, predictStep(pred, let_go).released)
    assert.equal(pred.swing, first)
    reconcile(pred, heroSnap(m.heroes[0]), 0)          // a snapshot that has not seen the swing yet
    predictCosmetics(pred, let_go, PVP.tick, null)
    assert.equal(pred.swing, first, 'reconcile does not restart the local swing')
  })
  it('a combo release draws no local swing: the server draws the combo', () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }] })
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    predictCosmetics(pred, NEUTRAL_INPUT, PVP.tick, { kind: 'lunge', dir: 'e' })
    assert.equal(pred.swing, null)
  })
  it('a predicted spell release pays the cooldown/stamina so a re-press inside it is refused like the server', () => {
    const m = lone('mage')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let seq = 0
    const step = attack => {
      seq++
      const input = { ...east, seq, attack }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
    }
    for (let i = 0; i < 20; i++) step(true)   // hold to a full-tier release
    step(false)                                // release
    step(false)                                // let go one tick (needRelease clears)
    for (let i = 0; i < 6; i++) step(true)     // re-press and hold, inside the cooldown
    assert.equal(pred.hero.charging, m.heroes[0].charging)
    assert.ok(Math.abs(pred.hero.stamina - m.heroes[0].stamina) < 1e-9)
    assert.ok(Math.abs(pred.hero.px - m.heroes[0].px) < 1e-9)
  })
  it('a predicted charge-weapon release pays the cooldown/stamina too (release, let go, re-press)', () => {
    const m = lone('warrior')
    m.heroes[0].weapon = weaponContents('longsword')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let seq = 0
    const step = attack => {
      seq++
      const input = { ...east, seq, attack }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
    }
    for (let i = 0; i < 20; i++) step(true)   // wind up to a full-tier swing
    step(false)                                // release
    step(false)                                // let go one tick
    for (let i = 0; i < 6; i++) step(true)     // re-press and hold, inside the cooldown
    assert.equal(pred.hero.charging, m.heroes[0].charging)
    assert.ok(Math.abs(pred.hero.stamina - m.heroes[0].stamina) < 1e-9)
    assert.ok(Math.abs(pred.hero.px - m.heroes[0].px) < 1e-9)
  })
  it('a tap swing spends stamina under reconcile replay too, so sprint stops exactly when the server stops it', () => {
    const m = lone('warrior')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let seq = 0, snapAt10 = null
    const step = () => {
      seq++
      const input = { ...east, sprint: true, attack: seq % 2 === 1, seq }   // tap, tap, tap: press and release
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
      if (seq === 10) snapAt10 = heroSnap(m.heroes[0])
    }
    for (let i = 0; i < 30; i++) step()
    // An ack behind the head: replays ticks 11-30 through predictStep alone,
    // on top of the tick-10 server state — exactly reconcile's real shape.
    reconcile(pred, snapAt10, 10)
    assert.equal(pred.pending.length, 20)
    assert.ok(Math.abs(pred.hero.stamina - m.heroes[0].stamina) < 1e-9)
    assert.ok(Math.abs(pred.hero.px - m.heroes[0].px) < 1e-9)
  })
})

describe('2a prediction parity', () => {
  // Server and predictor fed the same inputs; `snapAt` takes a snapshot to
  // reconcile from mid-sequence, exactly reconcile's real shape.
  const replay = (cls, inputs, snapAt, setup = () => {}, onTick = () => {}) => {
    const m = lone(cls)
    setup(m.heroes[0])
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let snap = null
    inputs.forEach((over, i) => {
      onTick(i + 1, m.heroes[0], pred.hero)
      const input = { ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over, seq: i + 1 }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq: i + 1, input })
      if (i + 1 === snapAt) snap = heroSnap(m.heroes[0])
    })
    reconcile(pred, snap, snapAt)
    return { server: m.heroes[0], pred: pred.hero }
  }
  const same = ({ server, pred }) => {
    assert.ok(Math.abs(pred.px - server.px) < 1e-9, `px ${pred.px} vs ${server.px}`)
    assert.ok(Math.abs(pred.py - server.py) < 1e-9, `py ${pred.py} vs ${server.py}`)
    assert.ok(Math.abs(pred.stamina - server.stamina) < 1e-9, `stamina ${pred.stamina} vs ${server.stamina}`)
    assert.ok(Math.abs(pred.meleeCooldown - server.meleeCooldown) < 1e-9, 'meleeCooldown')
    assert.equal(pred.facing, server.facing)
    assert.deepEqual(pred.combo, server.combo)
  }
  const E = { x: 1, y: 0 }, N = { x: 0, y: -1 }, S = { x: 0, y: 1 }, O = { x: 0, y: 0 }
  it("the Warrior's slide and the gesture's stamina match the server, reconciled mid-hold", () => {
    const hold = [{ move: E, attack: true }, ...[N, O, N, S, O, S, S, O].map(move => ({ move, attack: true }))]
    same(replay('warrior', [...hold, { move: E }, { move: E }, { move: E }], 4))
  })
  it('a snapshot taken mid-hold carries the gesture, so a direction held across it is not a second move', () => {
    const inputs = [{ move: O, attack: true }, { move: E, attack: true }, ...Array(8).fill({ move: E, attack: true }), { move: O }]
    const r = replay('warrior', inputs, 3)
    same(r)
    assert.equal(r.server.stamina, 100 - 25 - 12)   // one move, then the plain swing (e alone is no combo)
  })
  it('a snapshot taken on the release tick itself reconciles cleanly (fix round 1)', () => {
    const inputs = [{ move: E, attack: true }, { attack: false }, { attack: false }]
    same(replay('warrior', inputs, 2))
  })
  it('a stun cancelling the hold, then a fresh press and a released combo, match through reconcile (fix round 1)', () => {
    const inputs = [
      { move: E, attack: true },    // press: the hold begins
      { move: N, attack: true },    // a move (n), 25 stamina
      { attack: true },             // the stun lands this tick: cancelled, key still down
      { attack: false },            // let go: needRelease clears
      { move: S, attack: true },    // a fresh press
      { move: S, attack: true },    // s, s: a lunge
      { attack: false },            // release: the lunge's cooldown, no swing stamina
    ]
    const onTick = (tick, server, pred) => {
      if (tick === 3) { server.stunTimer = 0.05; pred.stunTimer = 0.05 }
    }
    // Snapshot right after the let-go (tick 4): ticks 5-7 — the fresh press,
    // its combo and its release — replay through predictStep alone, so a
    // divergence between predictCombo and hero.js's releaseCombo would show.
    same(replay('warrior', inputs, 4, undefined, onTick))
  })
  it("the Archer's slowed draw, its release and a re-press inside the cooldown match the server", () => {
    const E = { x: 1, y: 0 }
    const inputs = [
      { move: E, attack: true }, { move: E, attack: true },                 // a plain shot: cooldown 0.6
      ...Array(8).fill({ move: E, alt: true }),                             // Q inside that cooldown: no draw yet
      ...Array(30).fill({ move: E, alt: true }),                            // the draw
      { move: E }, ...Array(5).fill({ move: E, alt: true }),               // release; Q again inside 0.8 s
      ...Array(30).fill({ move: E, alt: true }),
    ]
    const r = replay('archer', inputs, 20)
    same(r)
    assert.deepEqual(r.pred.charging, r.server.charging)
    assert.equal(r.pred.ammo.arrow, r.server.ammo.arrow)
    assert.ok(Math.abs(r.pred.rangedCooldown - r.server.rangedCooldown) < 1e-9)
    assert.equal(r.server.ammo.arrow, 24 - 1 - 2)
  })
  it("the Mage's lightning cooldown is the match's 1.5 s: a re-press after 1.7 s charges (and slows) on both", () => {
    const E = { x: 1, y: 0 }
    const inputs = [{ move: E, attack: true }, { move: E }, ...Array(50).fill({ move: E }), ...Array(6).fill({ move: E, attack: true })]
    const r = replay('mage', inputs, 1)            // the release is replayed, not read off a snapshot
    same(r)
    assert.ok(r.server.charging, 'the server is charging again')
    assert.deepEqual(r.pred.charging, r.server.charging)
    assert.ok(Math.abs(r.pred.magicCooldown - r.server.magicCooldown) < 1e-9)
  })
})

describe('2a prediction: the lunge', () => {
  it('a lunge a snapshot shows mid-dash stops the replayed walk as long as the server stopped it; the dash itself is not predicted', () => {
    const m = lone('warrior')
    placeHero(m.heroes[0], { x: 8, y: 8 })
    const E = { x: 1, y: 0 }, N = { x: 0, y: -1 }, O = { x: 0, y: 0 }
    const inputs = [{ attack: true }, ...[E, O, E].map(move => ({ attack: true, move })), {}, ...Array(10).fill({ move: N })]
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let snap = null
    inputs.forEach((over, i) => {
      const input = { ...NEUTRAL_INPUT, move: O, ...over, seq: i + 1 }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq: i + 1, input })
      if (i + 1 === 6) snap = heroSnap(m.heroes[0])      // the tick after the release: dashing
    })
    assert.equal(snap.move.kind, 'lunge')
    reconcile(pred, snap, 6)
    const server = m.heroes[0]
    assert.ok(Math.abs(pred.hero.py - server.py) < 1e-9, `py pred ${pred.hero.py} server ${server.py}`)
    assert.ok(server.py < snap.py, 'the server walked north after the dash')
    assert.equal(pred.hero.px, snap.px, 'the rest of the dash comes with the next snapshot')
  })
})

describe('2b prediction: Haste', () => {
  // The server hero takes a Haste at the end of tick `at` (as tickPickups
  // would); the snapshot of that tick carries it, and the predictor — which
  // walked those ticks without it — replays the rest with it.
  const run = (tier, t, total = 40, at = 5) => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let snap = null
    for (let seq = 1; seq <= total; seq++) {
      const input = { ...east, seq, sprint: seq > 20 }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
      if (seq === at) { grantBuff(m.heroes[0], 'haste', tier); m.heroes[0].buffs.haste.t = t; snap = heroSnap(m.heroes[0]) }
    }
    reconcile(pred, snap, at)
    return { server: m.heroes[0], pred: pred.hero }
  }
  it('a Haste taken before the snapshot is replayed through moveHero: the walk matches the server', () => {
    const { server, pred } = run('major', 15)
    assert.ok(Math.abs(pred.px - server.px) < 1e-9, `px ${pred.px} vs ${server.px}`)
    assert.ok(Math.abs(pred.stamina - server.stamina) < 1e-9)
    assert.deepEqual(pred.buffs, server.buffs)
  })
  it('a Haste that runs out mid-replay runs out on the same tick on both sides', () => {
    const { server, pred } = run('minor', 0.4)
    assert.equal(server.buffs.haste, null)
    assert.equal(pred.buffs.haste, null)
    assert.ok(Math.abs(pred.px - server.px) < 1e-9, `px ${pred.px} vs ${server.px}`)
  })
})
