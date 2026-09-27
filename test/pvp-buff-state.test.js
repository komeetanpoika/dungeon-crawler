// Sub-project 2b §1: a hero's buffs — taking, stacking, timing out,
// clearing — Haste in the walk, and the buffs on the wire.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP } from '../renderer/data/pvp.js'
import { grantBuff, tickBuffs, clearBuffs, hasteMul, mightBonus, emptyBuffs } from '../renderer/pvp/buffs.js'
import { makeHero, placeHero, tickHero, applyKit, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { grantRune, endRune } from '../renderer/pvp/pickups.js'
import { startCombo, stepCombo } from '../renderer/pvp/attacks.js'
import { heroSnap, hydrateHero } from '../renderer/net/protocol.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id = 'h', cls = 'warrior', cell = { x: 5, y: 5 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const walkEast = (m, h, n, over = {}) => { for (let i = 0; i < n; i++) tickHero(m, h, { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east', ...over }, dt) }

describe('buff state', () => {
  it('a new hero has no buffs, burn or poison', () => {
    const h = hero()
    assert.deepEqual(h.buffs, emptyBuffs())
    assert.equal(h.burn, null)
    assert.equal(h.poison, null)
  })
  it('taking a buff sets its tier and full time; Ward its pool; an edge its kind', () => {
    const h = hero()
    assert.deepEqual(grantBuff(h, 'haste', 'minor'), { tier: 'minor', t: 8 })
    assert.deepEqual(grantBuff(h, 'ward', 'major'), { tier: 'major', t: 15, pool: 4 })
    assert.deepEqual(grantBuff(h, 'venom', 'minor'), { kind: 'venom', tier: 'minor', t: 10 })
    assert.deepEqual(Object.keys(h.buffs).filter(k => h.buffs[k]), ['haste', 'ward', 'edge'], 'different buffs stack')
    assert.throws(() => grantBuff(h, 'luck', 'minor'), /unknown buff/)
  })
  it('the same buff again keeps the higher tier and the longer time', () => {
    const h = hero()
    grantBuff(h, 'might', 'major'); h.buffs.might.t = 3
    assert.deepEqual(grantBuff(h, 'might', 'minor'), { tier: 'major', t: 8 }, 'major kept, the minor\'s 8 s is longer')
    grantBuff(h, 'haste', 'minor'); h.buffs.haste.t = 7
    assert.deepEqual(grantBuff(h, 'haste', 'major'), { tier: 'major', t: 15 })
    assert.deepEqual(grantBuff(h, 'haste', 'minor'), { tier: 'major', t: 15 }, 'nothing shortens')
  })
  it('Ward keeps the larger pool', () => {
    const h = hero()
    grantBuff(h, 'ward', 'major'); h.buffs.ward.pool = 1; h.buffs.ward.t = 2
    assert.deepEqual(grantBuff(h, 'ward', 'minor'), { tier: 'major', t: 15, pool: 2 })
    grantBuff(h, 'ward', 'major')
    assert.equal(h.buffs.ward.pool, 4)
  })
  it('an edge of the other kind replaces the one held, even a major; the same kind stacks like any buff', () => {
    const h = hero()
    grantBuff(h, 'ember', 'major')
    assert.deepEqual(grantBuff(h, 'venom', 'minor'), { kind: 'venom', tier: 'minor', t: 10 })
    h.buffs.edge.t = 4
    assert.deepEqual(grantBuff(h, 'venom', 'major'), { kind: 'venom', tier: 'major', t: 15 })
    assert.deepEqual(grantBuff(h, 'venom', 'minor'), { kind: 'venom', tier: 'major', t: 15 })
  })
  it('timers count down in the hero tick, and a buff whose time is up is gone', () => {
    const h = hero(); const m = testMatch([h])
    grantBuff(h, 'haste', 'minor'); grantBuff(h, 'ward', 'minor')
    for (let i = 0; i < 239; i++) tickHero(m, h, NEUTRAL_INPUT, dt)
    assert.ok(h.buffs.haste, 'still up a tick before 8 s')
    tickHero(m, h, NEUTRAL_INPUT, dt)
    assert.equal(h.buffs.haste, null)
    assert.ok(Math.abs(h.buffs.ward.t - 7) < 1e-6)
    tickBuffs(h, 7)
    assert.equal(h.buffs.ward, null, 'Ward times out at 15 s unused')
  })
  it('hasteMul and mightBonus by tier, neutral without', () => {
    const h = hero()
    assert.equal(hasteMul(h), 1); assert.equal(mightBonus(h), 0)
    grantBuff(h, 'haste', 'minor'); grantBuff(h, 'might', 'minor')
    assert.equal(hasteMul(h), 1.2); assert.equal(mightBonus(h), 1)
    grantBuff(h, 'haste', 'major'); grantBuff(h, 'might', 'major')
    assert.equal(hasteMul(h), 1.5); assert.equal(mightBonus(h), 2)
  })
})

describe('Haste', () => {
  it('multiplies the walk by 1.2 / 1.5', () => {
    for (const [tier, mul] of [[null, 1], ['minor', 1.2], ['major', 1.5]]) {
      const h = hero('h', 'archer'); const m = testMatch([h])
      if (tier) grantBuff(h, 'haste', tier)
      const x0 = h.px
      walkEast(m, h, 15)
      assert.ok(Math.abs(h.px - x0 - 120 * mul * 15 * dt) < 1e-6, `${tier}: ${h.px - x0}`)
    }
  })
  it("does not lengthen the Warrior's lunge: the dash is its own, not a walk", () => {
    const dash = haste => {
      const h = hero('h', 'warrior'); const m = testMatch([h])
      if (haste) grantBuff(h, 'haste', 'major')
      const x0 = h.px
      startCombo(m, h, { kind: 'lunge', dir: 'e' })
      for (let i = 0; i < 12; i++) stepCombo(m, h, dt)
      return h.px - x0
    }
    assert.equal(dash(true), dash(false))
    assert.ok(Math.abs(dash(false) - 2.5 * 32) < 1e-6)
  })
  it('stacks multiplicatively with sprint and with a slow', () => {
    const run = (buff, over, setup = () => {}) => {
      const h = hero('h', 'archer'); const m = testMatch([h]); setup(h)
      if (buff) grantBuff(h, 'haste', 'major')
      const x0 = h.px
      walkEast(m, h, 6, over)
      return h.px - x0
    }
    const sprint = { sprint: true }
    assert.ok(Math.abs(run(true, sprint) / run(false, sprint) - 1.5) < 1e-9, 'with sprint')
    const slowed = h => { h.slowTimer = 5; h.slowMul = 0.5 }
    assert.ok(Math.abs(run(true, {}, slowed) / run(false, {}, slowed) - 1.5) < 1e-9, 'under a slow')
  })
})

describe('clearing buffs', () => {
  it('a death clears buffs, burn and poison', () => {
    const m = makeMatch({ roster: [{ id: 'a', name: 'A', cls: 'warrior' }, { id: 'b', name: 'B', cls: 'mage' }] })
    const h = m.heroes[0]
    grantBuff(h, 'might', 'major'); grantBuff(h, 'ember', 'minor')
    h.burn = { owner: 'b', t: 1, next: 1 }; h.poison = { owner: 'b', t: 1, next: 1 }
    h.hp = 0
    stepMatch(m, {}, dt)
    assert.equal(h.dead, true)
    assert.deepEqual(h.buffs, emptyBuffs())
    assert.equal(h.burn, null); assert.equal(h.poison, null)
  })
  it('applyKit (a new life) clears them too', () => {
    const h = hero()
    grantBuff(h, 'ward', 'minor'); h.poison = { owner: 'x', t: 1, next: 1 }
    applyKit(h, 'mage')
    assert.deepEqual(h.buffs, emptyBuffs()); assert.equal(h.poison, null)
  })
  it('the rune and buffs coexist: taking or losing the rune leaves the buffs alone', () => {
    const h = hero(); const m = testMatch([h])
    grantBuff(h, 'haste', 'major'); grantBuff(h, 'venom', 'minor')
    const before = JSON.stringify(h.buffs)
    grantRune(m, h)
    assert.equal(JSON.stringify(h.buffs), before)
    endRune(m, h)
    assert.equal(JSON.stringify(h.buffs), before)
  })
  it('clearBuffs is idempotent on a hero that never had any', () => {
    const h = {}
    clearBuffs(h)
    assert.deepEqual(h, { buffs: emptyBuffs(), burn: null, poison: null })
  })
})

describe('buffs on the wire', () => {
  it('heroSnap carries a deep copy of the buffs, and hydrateHero takes it back', () => {
    const h = hero()
    grantBuff(h, 'ward', 'major'); grantBuff(h, 'ember', 'minor')
    const s = heroSnap(h)
    assert.deepEqual(s.buffs, h.buffs)
    h.buffs.ward.pool = 1
    assert.equal(s.buffs.ward.pool, 4, 'a copy, not the live object')
    const back = hydrateHero(null, JSON.parse(JSON.stringify(s)))
    assert.deepEqual(back.buffs, { haste: null, might: null, ward: { tier: 'major', t: 15, pool: 4 }, edge: { kind: 'ember', tier: 'minor', t: 10 } })
  })
})
