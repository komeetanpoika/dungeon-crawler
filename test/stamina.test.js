import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAMINA_MAX, meleeCost, GUST_COSTS, canAfford, spendStamina, tickStamina,
  sprintProfile, makeSprintDetector, affordableTier,
} from '../renderer/systems/stamina.js'

const mkPlayer = (over = {}) =>
  ({ stamina: 100, maxStamina: 100, staminaRegenT: 99, ...over })

describe('melee costs', () => {
  it('prices each weapon per tier, axe overcharge at 48', () => {
    assert.equal(meleeCost('dagger', 'full'), 8)
    assert.equal(meleeCost('sword', 'full'), 12)
    assert.equal(meleeCost('longsword', 'tap'), 10)
    assert.equal(meleeCost('longsword', 'over'), 34)
    assert.equal(meleeCost('axe', 'over'), 48)
    assert.equal(meleeCost('maunonmiekka', 'over'), 60)
  })
  it('unknown weapons fall back to the dagger-scale defaults', () => {
    assert.equal(meleeCost('mystery', 'full'), 8)
    assert.equal(meleeCost('mystery', 'tap'), 8)
  })
  it('the hatchet costs between dagger and sword', () => {
    assert.equal(meleeCost('hatchet', 'full'), 10)
  })
})

describe('spend and regen', () => {
  it('spending clamps at zero and resets the regen delay', () => {
    const p = mkPlayer({ stamina: 10 })
    spendStamina(p, 25)
    assert.equal(p.stamina, 0)
    assert.equal(p.staminaRegenT, 0)
  })
  it('canAfford is a plain threshold', () => {
    assert.equal(canAfford(mkPlayer({ stamina: 22 }), 22), true)
    assert.equal(canAfford(mkPlayer({ stamina: 21 }), 22), false)
  })
  it('does not regen during the 0.7s delay, then regens at 18/s', () => {
    const p = mkPlayer({ stamina: 50, staminaRegenT: 0 })
    tickStamina(p, 0.5)
    assert.equal(p.stamina, 50)
    tickStamina(p, 0.2)          // delay ends exactly now
    tickStamina(p, 1.0)
    assert.ok(Math.abs(p.stamina - 68) < 1e-9)
  })
  it('caps at maxStamina', () => {
    const p = mkPlayer({ stamina: 99, staminaRegenT: 99 })
    tickStamina(p, 5)
    assert.equal(p.stamina, 100)
  })
  it('heals a saved player that predates stamina', () => {
    const p = { hp: 10 }
    tickStamina(p, 0.016)
    assert.equal(p.stamina, 100)
    assert.equal(p.maxStamina, 100)
  })
})

describe('sprint profiles', () => {
  it('melee and ranged sprint fast and thirsty, magic slow and cheap', () => {
    assert.deepEqual(sprintProfile('melee'), { speedMul: 1.55, drain: 22 })
    assert.deepEqual(sprintProfile('ranged'), { speedMul: 1.55, drain: 22 })
    assert.deepEqual(sprintProfile('magic'), { speedMul: 1.25, drain: 8 })
  })
})

describe('double-tap sprint detector', () => {
  it('two presses of the same direction within the gap start sprinting', () => {
    const d = makeSprintDetector()
    d.press('w', 1.00)
    assert.equal(d.sprinting(), false)
    d.press('w', 1.25)
    assert.equal(d.sprinting(), true)
  })
  it('a slow second tap does not sprint', () => {
    const d = makeSprintDetector()
    d.press('w', 1.0)
    d.press('w', 1.4)
    assert.equal(d.sprinting(), false)
  })
  it('releasing the sprinting direction stops the sprint', () => {
    const d = makeSprintDetector()
    d.press('a', 1.0); d.press('a', 1.2)
    d.release('a')
    assert.equal(d.sprinting(), false)
  })
  it('releasing a different direction keeps the sprint', () => {
    const d = makeSprintDetector()
    d.press('a', 1.0); d.press('a', 1.2)
    d.release('d')
    assert.equal(d.sprinting(), true)
  })
})

describe('affordableTier', () => {
  const cost = { tap: 14, full: 22, over: 40 }

  it('degrades a hold to the best tier the tank can actually pay for', () => {
    assert.equal(affordableTier(100, cost, 'over'), 'over')
    assert.equal(affordableTier(30, cost, 'over'), 'full')
    assert.equal(affordableTier(15, cost, 'over'), 'tap')
    assert.equal(affordableTier(5, cost, 'over'), null)
  })

  it('never upgrades: a tap stays a tap however full the tank is', () => {
    assert.equal(affordableTier(100, cost, 'tap'), 'tap')
    assert.equal(affordableTier(100, cost, 'full'), 'full')
  })

  it('an unknown tier falls back to tap, not to the overcharge', () => {
    assert.equal(affordableTier(100, cost, 'wibble'), 'tap')
    assert.equal(affordableTier(100, cost, undefined), 'tap')
    assert.equal(affordableTier(5, cost, 'wibble'), null)
  })
})
