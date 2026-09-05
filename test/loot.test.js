import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollChestLoot } from '../renderer/systems/loot.js'

// rng stub that returns the given values in order.
function seq(...vals) { let i = 0; return () => vals[i++] ?? 0 }

// Bands: potion 40% / melee 15% / ranged 15% / wand 15% / ammo 15%.
describe('rollChestLoot bands', () => {
  it('r < 0.40 is a potion', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.0)), { type: 'potion', amount: 4 })
    assert.deepEqual(rollChestLoot(1, seq(0.399)), { type: 'potion', amount: 4 })
  })

  it('0.40 <= r < 0.55 is a melee weapon with full stats', () => {
    const c = rollChestLoot(1, seq(0.40, 0.0))
    assert.deepEqual(c, { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
    assert.equal(rollChestLoot(1, seq(0.549, 0.0)).type, 'weapon')
  })

  it('0.55 <= r < 0.70 is a ranged weapon (pool contents, no ammo/maxAmmo)', () => {
    const c = rollChestLoot(1, seq(0.55, 0.0))
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'shortbow')
    assert.equal(c.ammo, undefined)
    assert.equal(c.maxAmmo, undefined)
    assert.equal(c.ammoKind, 'arrow')
    assert.ok(c.bundle > 0)
  })

  it('0.70 <= r < 0.85 is a wand', () => {
    const c = rollChestLoot(1, seq(0.70, 0.0))
    assert.equal(c.type, 'wand')
    assert.equal(c.weaponType, 'sparkwand')
  })

  it('r >= 0.85 is an ammo bundle', () => {
    const c = rollChestLoot(1, seq(0.85, 0.0))
    assert.deepEqual(c, { type: 'ammo', ammoKind: 'arrow', count: 10 })
  })
})

describe('rollChestLoot exact bands at the brief\'s sample rolls', () => {
  it('depth 1 (shallow): 0.1/0.45/0.6/0.75/0.9 -> potion/melee/ranged/wand/ammo', () => {
    assert.equal(rollChestLoot(1, seq(0.1)).type, 'potion')
    assert.equal(rollChestLoot(1, seq(0.45, 0)).type, 'weapon')
    assert.equal(rollChestLoot(1, seq(0.6, 0)).type, 'ranged')
    assert.equal(rollChestLoot(1, seq(0.75, 0)).type, 'wand')
    assert.equal(rollChestLoot(1, seq(0.9, 0)).type, 'ammo')
  })

  it('depth 4 (deep): 0.1/0.45/0.6/0.75/0.9 -> potion/melee/ranged/wand/ammo', () => {
    assert.equal(rollChestLoot(4, seq(0.1)).type, 'potion')
    assert.equal(rollChestLoot(4, seq(0.45, 0)).type, 'weapon')
    assert.equal(rollChestLoot(4, seq(0.6, 0)).type, 'ranged')
    assert.equal(rollChestLoot(4, seq(0.75, 0)).type, 'wand')
    assert.equal(rollChestLoot(4, seq(0.9, 0)).type, 'ammo')
  })
})

describe('rollChestLoot depth tiers', () => {
  it('shallow (depth < 3) draws from the light pools', () => {
    assert.equal(rollChestLoot(2, seq(0.40, 0.99)).weaponType, 'sword')
    assert.equal(rollChestLoot(2, seq(0.55, 0.99)).weaponType, 'sling')
    assert.equal(rollChestLoot(2, seq(0.70, 0.99)).weaponType, 'frostwand')
    assert.notEqual(rollChestLoot(2, seq(0.70, 0.99)).weaponType, 'firewand', 'no fireballs above depth 3')
    const shallowAmmo = rollChestLoot(2, seq(0.85, 0.99))
    assert.deepEqual(shallowAmmo, { type: 'ammo', ammoKind: 'stone', count: 15 })
    assert.notEqual(rollChestLoot(2, seq(0.85, 0.5)).ammoKind, 'bolt', 'no bolts above depth 3')
  })

  it('deep (depth >= 3) draws from the heavy pools', () => {
    assert.equal(rollChestLoot(3, seq(0.40, 0.0)).weaponType, 'longsword')
    assert.equal(rollChestLoot(3, seq(0.40, 0.99)).weaponType, 'axe')
    assert.equal(rollChestLoot(5, seq(0.55, 0.0)).weaponType, 'longbow')
    assert.equal(rollChestLoot(5, seq(0.55, 0.99)).weaponType, 'crossbow')
    assert.equal(rollChestLoot(5, seq(0.70, 0.5)).weaponType, 'blinkwand')
    assert.equal(rollChestLoot(5, seq(0.70, 0.99)).weaponType, 'stormwand')
    assert.deepEqual(rollChestLoot(5, seq(0.85, 0.5)), { type: 'ammo', ammoKind: 'bolt', count: 6 })
    assert.deepEqual(rollChestLoot(5, seq(0.85, 0.99)), { type: 'ammo', ammoKind: 'stone', count: 15 })
  })

  it('never yields the cheat sword', () => {
    for (let i = 0; i < 200; i++) {
      const c = rollChestLoot(5)
      assert.notEqual(c.weaponType, 'maunonmiekka')
    }
  })
})
