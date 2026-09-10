import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollChestLoot, lootTierFor } from '../renderer/systems/loot.js'
import { emptyAmmo, makeRangedContents } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'

// rng stub that returns the given values in order.
function seq(...vals) { let i = 0; return () => vals[i++] ?? 0 }

const ALL_TALENTS = ['ranged_stance', 'magic_stance', 'heavy_weapons']

function mkPlayer({ talents = [], ranged = null, sack = [] } = {}) {
  return {
    talents: [...talents],
    weapon: null,
    ranged: ranged ? makeRangedContents(ranged) : null,
    wand: null,
    ammo: emptyAmmo(),
    inventory: sack.map(wt => itemFromContents(makeRangedContents(wt))),
  }
}

// A veteran: every talent learned and a bow of each ammo kind carried, so no
// category is ever suppressed and the base weights show through unchanged.
const veteran = () => mkPlayer({ talents: ALL_TALENTS, ranged: 'shortbow', sack: ['crossbow', 'sling'] })

describe('lootTierFor', () => {
  it('climbs 1,1,2,3,4 across the dungeon depths', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(lootTierFor), [1, 1, 2, 3, 4])
  })

  it("puts the Clearings' surface on the same rung as the caves inside it", () => {
    // The old bug: depth 7 rolled the endgame pools while its own caves
    // (depths 1-2) rolled the starter ones.
    assert.equal(lootTierFor(7), 1)
    assert.equal(lootTierFor(1), 1)
    assert.equal(lootTierFor(2), 1)
  })

  it('climbs from 1 to 4 across the nine Adventure maps', () => {
    const chain = [7, 11, 12, 13, 14, 15, 16, 17, 18]
    assert.deepEqual(chain.map(lootTierFor), [1, 1, 2, 2, 3, 3, 3, 4, 4])
  })

  it('falls back to tier 1 for a depth with no level config', () => {
    assert.equal(lootTierFor(99), 1)
  })
})

// Weights: potion 35 / melee 20 / ranged 15 / wand 15 / ammo 15 = 100, so the
// cumulative boundaries read straight off the roll.
describe('bands for a player who can use everything', () => {
  it('r < 0.35 is a potion', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.0), veteran()), { type: 'potion', amount: 4 })
    assert.deepEqual(rollChestLoot(1, seq(0.349), veteran()), { type: 'potion', amount: 4 })
  })

  it('0.35 <= r < 0.55 is a melee weapon with full stats', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.35, 0.0), veteran()),
      { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
    assert.equal(rollChestLoot(1, seq(0.549, 0.0), veteran()).type, 'weapon')
  })

  it('0.55 <= r < 0.70 is a ranged weapon carrying its bundle but no ammo count', () => {
    const c = rollChestLoot(1, seq(0.55, 0.0), veteran())
    assert.equal(c.type, 'ranged')
    assert.equal(c.ammo, undefined)
    assert.equal(c.maxAmmo, undefined)
    assert.ok(c.bundle > 0)
  })

  it('0.70 <= r < 0.85 is a wand', () => {
    assert.equal(rollChestLoot(1, seq(0.70, 0.0), veteran()).type, 'wand')
  })

  it('r >= 0.85 is an ammo bundle', () => {
    assert.equal(rollChestLoot(1, seq(0.85, 0.0), veteran()).type, 'ammo')
  })
})

describe('tier pools', () => {
  const melee  = (d, p) => rollChestLoot(d, seq(0.35, p), veteran()).weaponType
  const ranged = (d, p) => rollChestLoot(d, seq(0.55, p), veteran()).weaponType
  const wand   = (d, p) => rollChestLoot(d, seq(0.70, p), veteran()).weaponType

  it('tier 1 melee is the dagger and the sword', () => {
    assert.equal(melee(1, 0.0), 'dagger')
    assert.equal(melee(1, 0.99), 'sword')
  })

  it('tier 4 melee is the axe and the longsword', () => {
    assert.equal(melee(5, 0.0), 'axe')
    assert.equal(melee(5, 0.99), 'longsword')
  })

  it('tier 1 ranged is the sling and the shortbow', () => {
    assert.equal(ranged(1, 0.0), 'sling')
    assert.equal(ranged(1, 0.99), 'shortbow')
  })

  it('tier 4 ranged reaches the crossbow', () => {
    assert.equal(ranged(5, 0.0), 'longbow')
    assert.equal(ranged(5, 0.99), 'crossbow')
  })

  it('tier 1 wands are Spark Wands only', () => {
    assert.equal(wand(1, 0.0), 'sparkwand')
    assert.equal(wand(1, 0.99), 'sparkwand')
  })

  it('tier 4 wands reach the Storm Wand', () => {
    assert.equal(wand(5, 0.99), 'stormwand')
    assert.equal(wand(5, 0.0), 'firewand')
  })

  it('never yields the cheat sword', () => {
    for (let i = 0; i < 300; i++) {
      assert.notEqual(rollChestLoot(5, Math.random, veteran()).weaponType, 'maunonmiekka')
    }
  })
})

// A category the player cannot equip at all shrinks to a fifth of its weight
// and yields the humblest example of its kind, so a first-map chest hints at
// what is coming instead of handing over endgame gear.
describe('a locked category shrinks to a teaser', () => {
  // Fresh adventurer, tier 1: potion 35 / melee 20 / ranged 3 / wand 3 /
  // ammo 0 = 61. Boundaries: .5738 / .9016 / .9508 / 1.
  const fresh = () => mkPlayer()

  it('leaves the potion and melee bands as the bulk of the roll', () => {
    assert.equal(rollChestLoot(7, seq(0.5), fresh()).type, 'potion')
    assert.equal(rollChestLoot(7, seq(0.7, 0.0), fresh()).type, 'weapon')
  })

  it('squeezes the locked bow and wand into the top tenth', () => {
    assert.equal(rollChestLoot(7, seq(0.92, 0.0), fresh()).type, 'ranged')
    assert.equal(rollChestLoot(7, seq(0.97, 0.0), fresh()).type, 'wand')
  })

  it('draws a locked bow teaser from tier 1 even on a tier-4 map', () => {
    const p = mkPlayer({ talents: ['magic_stance', 'heavy_weapons'] })
    // ranged locked: potion 35 / melee 20 / ranged 3 / wand 15 / ammo 0 = 73.
    const c = rollChestLoot(18, seq(55 / 73 + 0.001, 0.99), p)
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'shortbow', 'tier-1 pool, not the tier-4 crossbow')
  })

  it('draws a locked wand teaser from tier 1 even on a tier-4 map', () => {
    const p = mkPlayer({ talents: ['ranged_stance', 'heavy_weapons'], ranged: 'shortbow' })
    // wand locked: potion 35 / melee 20 / ranged 15 / wand 3 / ammo 15 = 88.
    const c = rollChestLoot(18, seq(70 / 88 + 0.001, 0.99), p)
    assert.equal(c.type, 'wand')
    assert.equal(c.weaponType, 'sparkwand', 'tier-1 pool, not the tier-4 Storm Wand')
  })

  it('falls back to a tier-1 melee teaser when the whole tier is too heavy', () => {
    // Tier 4 melee is axe/longsword, both heavy — nothing usable without Might.
    const p = mkPlayer({ talents: ['ranged_stance', 'magic_stance'], ranged: 'shortbow' })
    // melee locked: potion 35 / melee 4 / ranged 15 / wand 15 / ammo 15 = 84.
    const c = rollChestLoot(18, seq(35 / 84 + 0.001, 0.0), p)
    assert.equal(c.type, 'weapon')
    assert.equal(c.weaponType, 'dagger')
  })
})

// A category is only locked when nothing in its tier is usable; where the tier
// still holds one usable item, the band keeps its full weight and simply skips
// what the player cannot lift.
describe('a partly usable tier keeps its full weight', () => {
  it('drops the crossbow from a tier-4 ranged roll without Might', () => {
    const p = mkPlayer({ talents: ['ranged_stance', 'magic_stance'], ranged: 'shortbow' })
    // ranged usable (longbow, splitbow): potion 35 / melee 4 / ranged 15 /
    // wand 15 / ammo 15 = 84. Ranged band spans 39..54.
    for (const pick of [0.0, 0.5, 0.99]) {
      const c = rollChestLoot(18, seq(45 / 84, pick), p)
      assert.equal(c.type, 'ranged')
      assert.notEqual(c.weaponType, 'crossbow')
    }
  })

  it('yields only the sword from a tier-2 melee roll without Might', () => {
    // Tier 2 is sword/longsword; only the sword is liftable.
    const p = mkPlayer({ talents: ALL_TALENTS.filter(t => t !== 'heavy_weapons'), ranged: 'shortbow' })
    for (const pick of [0.0, 0.99]) {
      assert.equal(rollChestLoot(12, seq(0.4, pick), p).weaponType, 'sword')
    }
  })
})

describe('ammo follows the bows the player carries', () => {
  it('never drops a bundle for a player with no bow at all', () => {
    const p = mkPlayer({ talents: ALL_TALENTS })
    for (let i = 0; i < 400; i++) {
      assert.notEqual(rollChestLoot(18, Math.random, p).type, 'ammo')
    }
  })

  it('yields stones for a held sling', () => {
    const p = mkPlayer({ talents: ALL_TALENTS, ranged: 'sling' })
    // potion 35 / melee 20 / ranged 15 / wand 15 / ammo 15 = 100.
    for (const pick of [0.0, 0.99]) {
      assert.deepEqual(rollChestLoot(18, seq(0.9, pick), p), { type: 'ammo', ammoKind: 'stone', count: 15 })
    }
  })

  it('yields bolts for a crossbow left in the sack', () => {
    const p = mkPlayer({ talents: ALL_TALENTS, sack: ['crossbow'] })
    assert.deepEqual(rollChestLoot(18, seq(0.9, 0.0), p), { type: 'ammo', ammoKind: 'bolt', count: 6 })
  })

  it('splits the band between the kinds a player has bows for', () => {
    const p = mkPlayer({ talents: ALL_TALENTS, ranged: 'shortbow', sack: ['sling'] })
    assert.equal(rollChestLoot(18, seq(0.9, 0.0), p).ammoKind, 'arrow')
    assert.equal(rollChestLoot(18, seq(0.9, 0.99), p).ammoKind, 'stone')
  })
})

describe('a missing player', () => {
  it('is treated as able to use everything', () => {
    assert.equal(rollChestLoot(5, seq(0.55, 0.99)).weaponType, 'crossbow')
    assert.equal(rollChestLoot(5, seq(0.70, 0.99)).weaponType, 'stormwand')
    assert.equal(rollChestLoot(5, seq(0.9, 0.0)).type, 'ammo')
  })
})
