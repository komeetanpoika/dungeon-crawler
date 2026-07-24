import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollChestLoot } from '../renderer/systems/loot.js'

// rng stub that returns the given values in order.
function seq(...vals) { let i = 0; return () => vals[i++] ?? 0 }

describe('rollChestLoot categories', () => {
  it('r < 0.5 is a potion', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.0)), { type: 'potion', amount: 4 })
    assert.deepEqual(rollChestLoot(1, seq(0.499)), { type: 'potion', amount: 4 })
  })

  it('0.5 <= r < 0.75 is a melee weapon with full stats', () => {
    const c = rollChestLoot(1, seq(0.5, 0.0))
    assert.deepEqual(c, { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
    assert.equal(rollChestLoot(1, seq(0.749, 0.0)).type, 'weapon')
  })

  it('r >= 0.75 is a full-ammo ranged weapon', () => {
    const c = rollChestLoot(1, seq(0.75, 0.0))
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'shortbow')
    assert.equal(c.ammo, c.maxAmmo)
  })
})

describe('rollChestLoot depth tiers', () => {
  it('shallow (depth <= 2) draws from the light pools', () => {
    assert.equal(rollChestLoot(2, seq(0.5, 0.99)).weaponType, 'sword')
    assert.equal(rollChestLoot(2, seq(0.99, 0.99)).weaponType, 'sparkwand')
  })

  it('deep (depth >= 3) draws from the heavy pools', () => {
    assert.equal(rollChestLoot(3, seq(0.5, 0.0)).weaponType, 'longsword')
    assert.equal(rollChestLoot(3, seq(0.5, 0.99)).weaponType, 'axe')
    assert.equal(rollChestLoot(5, seq(0.99, 0.0)).weaponType, 'longbow')
    assert.equal(rollChestLoot(5, seq(0.99, 0.99)).weaponType, 'stormwand')
  })

  it('never yields the cheat sword', () => {
    for (let i = 0; i < 200; i++) {
      const c = rollChestLoot(5)
      assert.notEqual(c.weaponType, 'maunonmiekka')
    }
  })
})
