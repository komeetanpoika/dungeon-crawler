import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fightValues, effectiveFight, weaponPatch, fieldStates } from '../tools/monster-bench/fight-fields.js'

const W = { maul: { damage: 2, reach: 34 }, club: { damage: 3, reach: 52 } }
describe('fight-fields', () => {
  it('fightValues reads weapon and overrides', () => {
    assert.deepEqual(fightValues({ behavior: { weapon: 'maul', weaponOverrides: { reach: 40 } } }), { weapon: 'maul', damage: null, reach: 40 })
    assert.deepEqual(fightValues({ behavior: {} }), { weapon: null, damage: null, reach: null })
  })
  it('effectiveFight falls back to the weapon, and to null without one', () => {
    assert.deepEqual(effectiveFight({ weapon: 'maul', damage: null, reach: 40 }, W), { damage: 2, reach: 40 })
    assert.deepEqual(effectiveFight({ weapon: null, damage: 5, reach: 5 }, W), { damage: null, reach: null })
  })
  it('weaponPatch stores only values that differ from the weapon', () => {
    assert.deepEqual(weaponPatch({ weapon: 'maul', damage: 2, reach: 40 }, W), { weapon: 'maul', weaponOverrides: { reach: 40 } })
    assert.deepEqual(weaponPatch({ weapon: 'maul', damage: 2, reach: 34 }, W), { weapon: 'maul', weaponOverrides: null })
    assert.deepEqual(weaponPatch({ weapon: null, damage: 9, reach: 9 }, W), { weapon: null, weaponOverrides: null })
  })
  it('fieldStates disables damage and reach without a weapon, and whatever a hook ignores', () => {
    const s = fieldStates({ weapon: null }, { speed: 'its rush sets its own speed' })
    assert.equal(s.damage.disabled, true)
    assert.equal(s.damage.reason, "No weapon: it can't hit in melee.")
    assert.equal(s.speed.disabled, true)
    assert.equal(s.speed.reason, 'its rush sets its own speed')
    assert.equal(s.hp.disabled, false)
  })
})
