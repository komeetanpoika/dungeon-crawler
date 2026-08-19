import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHARGE, isChargeWeapon, resolveCharge, chargeMoveFactor } from '../renderer/systems/melee.js'

describe('charge weapons', () => {
  it('the heavy trio charges; light blades stay instant', () => {
    for (const wt of ['longsword', 'axe', 'maunonmiekka']) assert.ok(isChargeWeapon(wt), wt)
    for (const wt of ['dagger', 'sword', undefined]) assert.ok(!isChargeWeapon(wt), String(wt))
  })

  it('movement while charging is weapon-specific, full speed for the rest', () => {
    assert.equal(chargeMoveFactor('axe'), CHARGE.axe.moveFactor)
    assert.ok(CHARGE.axe.moveFactor < CHARGE.longsword.moveFactor, 'the axe is the heaviest to carry')
    assert.equal(chargeMoveFactor('dagger'), 1)
  })
})

describe('resolveCharge', () => {
  it('a quick release is a tap: lighter, faster to recover', () => {
    const r = resolveCharge('longsword', 0.1)
    assert.equal(r.tier, 'tap')
    assert.ok(r.dmgMul < 1)
    assert.ok(r.cooldownMul < 1)
    assert.equal(r.reachMul, 1)
  })

  it('holding to the full mark swings at the weapon baseline', () => {
    const r = resolveCharge('longsword', CHARGE.longsword.full)
    assert.equal(r.tier, 'full')
    assert.deepEqual([r.dmgMul, r.reachMul, r.kbMul, r.cooldownMul], [1, 1, 1, 1])
  })

  it('overcharging trades recovery for damage, reach and knockback', () => {
    const r = resolveCharge('axe', CHARGE.axe.over + 0.5)
    assert.equal(r.tier, 'over')
    assert.ok(r.dmgMul > 1.5)
    assert.ok(r.reachMul > 1)
    assert.ok(r.kbMul > 1)
    assert.ok(r.cooldownMul > 1)
  })

  it('tier boundaries are per weapon', () => {
    assert.equal(resolveCharge('axe', CHARGE.axe.full - 0.01).tier, 'tap')
    assert.equal(resolveCharge('axe', CHARGE.axe.over - 0.01).tier, 'full')
    assert.equal(resolveCharge('axe', CHARGE.axe.over).tier, 'over')
  })

  it('non-charge weapons always resolve to a plain full swing', () => {
    const r = resolveCharge('dagger', 5)
    assert.equal(r.tier, 'full')
    assert.deepEqual([r.dmgMul, r.reachMul, r.kbMul, r.cooldownMul], [1, 1, 1, 1])
  })
})
