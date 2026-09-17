import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollChestLoot, lootTierFor } from '../renderer/systems/loot.js'
import { emptyAmmo, makeRangedContents } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'
import { gearWearing } from './helpers/outfits.js'

// rng stub that returns the given values in order.
function seq(...vals) { let i = 0; return () => vals[i++] ?? 0 }

const ALL_OUTFITS = ['ranger', 'robe', 'plate']

function mkPlayer({ outfits = [], ranged = null, sack = [] } = {}) {
  return {
    gear: gearWearing(...outfits),
    weapon: null,
    ranged: ranged ? makeRangedContents(ranged) : null,
    wand: null,
    ammo: emptyAmmo(),
    inventory: sack.map(wt => itemFromContents(makeRangedContents(wt))),
  }
}

// A veteran: every outfit worn and a bow of each ammo kind carried, so no
// category is ever suppressed and the base weights show through unchanged.
const veteran = () => mkPlayer({ outfits: ALL_OUTFITS, ranged: 'shortbow', sack: ['crossbow', 'sling'] })

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

describe('bands for a player who can use everything', () => {
  // Tier 1 has no outfit pool: potion 30 / melee 16 / shield 4 / ranged 15 /
  // wand 15 / ammo 15 = 95. Boundaries .3158 / .4842 / .5263 / .6842 / .8421.
  it('the first three tenths are a potion', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.0), veteran()), { type: 'potion', amount: 4 })
    assert.deepEqual(rollChestLoot(1, seq(0.31), veteran()), { type: 'potion', amount: 4 })
  })
  it('then a melee weapon with full stats', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.32, 0.0), veteran()),
      { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
    assert.equal(rollChestLoot(1, seq(0.48, 0.0), veteran()).type, 'weapon')
  })
  it('one melee pick in five is a shield', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.49, 0.0), veteran()),
      { type: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 })
    assert.equal(rollChestLoot(1, seq(0.525, 0.0), veteran()).type, 'shield')
  })
  it('then a ranged weapon carrying its bundle but no ammo count', () => {
    const c = rollChestLoot(1, seq(0.53, 0.0), veteran())
    assert.equal(c.type, 'ranged')
    assert.equal(c.ammo, undefined)
    assert.equal(c.maxAmmo, undefined)
    assert.ok(c.bundle > 0)
  })
  it('then a wand, then ammo', () => {
    assert.equal(rollChestLoot(1, seq(0.69, 0.0), veteran()).type, 'wand')
    assert.equal(rollChestLoot(1, seq(0.85, 0.0), veteran()).type, 'ammo')
    assert.equal(rollChestLoot(1, seq(0.999, 0.0), veteran()).type, 'ammo')
  })
  it('from tier 2 the last twentieth is the Leather Coat', () => {
    // potion 30 / melee 16 / shield 4 / ranged 15 / wand 15 / ammo 15 / outfit 5 = 100.
    assert.equal(rollChestLoot(3, seq(0.949, 0.0), veteran()).type, 'ammo')
    assert.deepEqual(rollChestLoot(3, seq(0.95, 0.0), veteran()),
      { type: 'outfit', outfitType: 'leather', name: 'Leather Coat', loadout: null, protect: 1 })
    assert.equal(rollChestLoot(3, seq(0.999, 0.0), veteran()).type, 'outfit')
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
    const p = mkPlayer({ outfits: ['robe', 'plate'] })
    // ranged locked: potion 30 / melee 16 / shield 4 / ranged 3 / wand 15 / ammo 0 / outfit 5 = 73.
    const c = rollChestLoot(18, seq(50 / 73 + 0.001, 0.99), p)
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'shortbow', 'tier-1 pool, not the tier-4 crossbow')
  })

  it('draws a locked wand teaser from tier 1 even on a tier-4 map', () => {
    const p = mkPlayer({ outfits: ['ranger', 'plate'], ranged: 'shortbow' })
    // wand locked: potion 30 / melee 16 / shield 4 / ranged 15 / wand 3 / ammo 15 / outfit 5 = 88.
    const c = rollChestLoot(18, seq(65 / 88 + 0.001, 0.99), p)
    assert.equal(c.type, 'wand')
    assert.equal(c.weaponType, 'sparkwand', 'tier-1 pool, not the tier-4 Storm Wand')
  })

  it('falls back to a tier-1 melee teaser when the whole tier is too heavy', () => {
    // Tier 4 melee is axe/longsword, both heavy — nothing usable without Might.
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    // melee locked: potion 30 / melee 3.2 / shield 0.8 / ranged 15 / wand 15 / ammo 15 / outfit 5 = 84.
    const c = rollChestLoot(18, seq(30 / 84 + 0.001, 0.0), p)
    assert.equal(c.type, 'weapon')
    assert.equal(c.weaponType, 'dagger')
  })

  it('a tier-4 kite shield without the plate is a buckler teaser', () => {
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    // shield locked (tier 4 is the kite alone): 0.8 of 84, right after the melee teaser.
    const c = rollChestLoot(18, seq(33.2 / 84 + 0.001, 0.99), p)
    assert.equal(c.type, 'shield')
    assert.equal(c.weaponType, 'buckler')
  })
})

// A category is only locked when nothing in its tier is usable; where the tier
// still holds one usable item, the band keeps its full weight and simply skips
// what the player cannot lift. The crossbow needs only the ranger coat now
// (Task 3: plate belongs to the Warrior), so every ranged item in every tier
// is usable once ranged is open at all — melee is the only category left
// where a tier can be partly locked (longsword/axe need the plate).
describe('a partly usable tier keeps its full weight', () => {
  it('yields only the sword from a tier-2 melee roll without Might', () => {
    // Tier 2 is sword/longsword; only the sword is liftable.
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    for (const pick of [0.0, 0.99]) {
      assert.equal(rollChestLoot(12, seq(0.4, pick), p).weaponType, 'sword')
    }
  })
})

describe('ammo follows the bows the player carries', () => {
  it('never drops a bundle for a player with no bow at all', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS })
    for (let i = 0; i < 400; i++) {
      assert.notEqual(rollChestLoot(18, Math.random, p).type, 'ammo')
    }
  })

  it('yields stones for a held sling', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS, ranged: 'sling' })
    // potion 35 / melee 20 / ranged 15 / wand 15 / ammo 15 = 100.
    for (const pick of [0.0, 0.99]) {
      assert.deepEqual(rollChestLoot(18, seq(0.9, pick), p), { type: 'ammo', ammoKind: 'stone', count: 15 })
    }
  })

  it('yields bolts for a crossbow left in the sack', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS, sack: ['crossbow'] })
    assert.deepEqual(rollChestLoot(18, seq(0.9, 0.0), p), { type: 'ammo', ammoKind: 'bolt', count: 6 })
  })

  it('splits the band between the kinds a player has bows for', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS, ranged: 'shortbow', sack: ['sling'] })
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

describe('shield and outfit rungs', () => {
  it('tier 3 offers both shields, tier 4 the kite', () => {
    // 0.49 sits inside the shield band [46,50) of both totals: /100 at tiers
    // 3-4 (0.46-0.50) and /95 at tier 1 (0.4842-0.5263) — 0.47 only clears
    // the first.
    const shield = (d, p) => rollChestLoot(d, seq(0.49, p), veteran()).weaponType
    assert.equal(shield(4, 0.0), 'buckler')   // depth 4 = tier 3
    assert.equal(shield(4, 0.99), 'kite')
    assert.equal(shield(5, 0.0), 'kite')      // depth 5 = tier 4
    assert.equal(shield(1, 0.99), 'buckler')
  })
  it('no outfit rolls at tier 1', () => {
    for (let i = 0; i < 300; i++) assert.notEqual(rollChestLoot(1, Math.random, veteran()).type, 'outfit')
  })
  it('story outfits never roll', () => {
    for (let i = 0; i < 500; i++) {
      const c = rollChestLoot(18, Math.random, veteran())
      if (c.type === 'outfit') assert.equal(c.outfitType, 'leather')
    }
  })
  it('a plated player draws the kite; a null player draws everything', () => {
    assert.equal(rollChestLoot(5, seq(0.47, 0.99), mkPlayer({ outfits: ALL_OUTFITS, ranged: 'shortbow', sack: ['crossbow', 'sling'] })).weaponType, 'kite')
    assert.equal(rollChestLoot(5, seq(0.47, 0.99)).weaponType, 'kite')
    assert.equal(rollChestLoot(5, seq(0.96, 0.0)).type, 'outfit')
  })
})
