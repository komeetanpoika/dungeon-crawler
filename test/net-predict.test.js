import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePredictor, predictStep, predictCosmetics, reconcile, tickCorrection, drawnPos } from '../renderer/net/predict.js'
import { heroSnap } from '../renderer/net/protocol.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { weaponContents } from '../renderer/systems/entities.js'
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
  it('the tap swing animates locally at once and not again until its cooldown passes', () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }] })
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const swing = { ...NEUTRAL_INPUT, attack: true, facing: 'east' }
    predictCosmetics(pred, swing, PVP.tick)
    assert.ok(pred.swing)
    const first = pred.swing
    predictCosmetics(pred, swing, PVP.tick)
    assert.equal(pred.swing, first)
    reconcile(pred, heroSnap(m.heroes[0]), 0)          // a snapshot that has not seen the swing yet
    predictCosmetics(pred, swing, PVP.tick)
    assert.equal(pred.swing, first, 'reconcile does not restart the local swing')
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
    const sprintAttack = { ...east, sprint: true, attack: true }
    let seq = 0, snapAt10 = null
    const step = () => {
      seq++
      const input = { ...sprintAttack, seq }
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
