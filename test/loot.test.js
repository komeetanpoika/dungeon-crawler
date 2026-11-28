import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollChestLoot, lootTierFor, lootBands, BASE_WEIGHTS, ARMOR_POOLS, HEAD_POOLS, BOOTS_POOLS, RING_POOLS } from '../renderer/systems/loot.js'
import { emptyAmmo, makeRangedContents, makeWornContents, WORN_TYPES } from '../renderer/systems/entities.js'
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

// The first rng value that lands `f` of the way into the band `name` of this
// chest, read off the bands the roll itself uses, so the tests name a band
// and not a fraction that moves whenever a weight is retuned.
function into(depth, player, name, f = 0.5) {
  const bands = lootBands(depth, player)
  const total = bands.reduce((sum, b) => sum + b.weight, 0)
  let before = 0
  for (const b of bands) {
    if (b.name === name) { assert.ok(b.weight > 0, `the ${name} band is empty here`); return (before + f * b.weight) / total }
    before += b.weight
  }
  throw new Error(`no band ${name}`)
}
const roll = (depth, player, name, pick = 0, f = 0.5) => rollChestLoot(depth, seq(into(depth, player, name, f), pick), player)
const weights = (depth, player) => Object.fromEntries(lootBands(depth, player).map(b => [b.name, b.weight]))

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

describe('the weights of a chest', () => {
  it('are these, and a hundred in all', () => {
    assert.deepEqual(BASE_WEIGHTS, { potion: 26, melee: 15, shield: 4, ranged: 14, wand: 14, ammo: 14, armor: 5, head: 4, boots: 2, ring: 2 })
    assert.equal(Object.values(BASE_WEIGHTS).reduce((a, b) => a + b, 0), 100)
  })
  it('show through unchanged for a player who can use everything, from tier 3', () => {
    assert.deepEqual(weights(4, veteran()), BASE_WEIGHTS)     // depth 4 = tier 3
    assert.deepEqual(weights(5, veteran()), BASE_WEIGHTS)     // depth 5 = tier 4
  })
  it('a band with no pool at a tier weighs nothing: the first maps are for learning the bag', () => {
    const t1 = weights(1, veteran())
    assert.deepEqual([t1.armor, t1.boots, t1.ring], [0, 0, 0])
    assert.equal(t1.head, BASE_WEIGHTS.head)
    const t2 = weights(3, veteran())                          // depth 3 = tier 2
    assert.deepEqual([t2.armor, t2.head, t2.boots, t2.ring], [5, 4, 2, 0])
  })
  it('the bands come in this order, and each gives its own kind from end to end', () => {
    const kinds = { potion: 'potion', melee: 'weapon', shield: 'shield', ranged: 'ranged', wand: 'wand', ammo: 'ammo', armor: 'armor', head: 'head', boots: 'boots', ring: 'ring' }
    assert.deepEqual(lootBands(5, veteran()).map(b => b.name), Object.keys(kinds))
    for (const [name, type] of Object.entries(kinds)) for (const f of [0, 0.999])
      assert.equal(roll(5, veteran(), name, 0, f).type, type, `${name} at ${f}`)
  })
})

describe('what a band holds', () => {
  it('a potion of four', () => {
    assert.deepEqual(roll(1, veteran(), 'potion'), { type: 'potion', amount: 4 })
  })
  it('a melee weapon with full stats', () => {
    assert.deepEqual(roll(1, veteran(), 'melee'), { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
  })
  it('a shield', () => {
    assert.deepEqual(roll(1, veteran(), 'shield'), { type: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 })
  })
  it('a ranged weapon carrying its bundle but no ammo count', () => {
    const c = roll(1, veteran(), 'ranged')
    assert.equal(c.type, 'ranged')
    assert.equal(c.ammo, undefined)
    assert.equal(c.maxAmmo, undefined)
    assert.ok(c.bundle > 0)
  })
  it('a worn piece, whole, as the table has it', () => {
    assert.deepEqual(roll(3, veteran(), 'armor'), makeWornContents('leather'))
    assert.deepEqual(roll(3, veteran(), 'armor'), { type: 'armor', gearType: 'leather', name: 'Leather Jerkin', armor: 2 })
    assert.deepEqual(roll(1, veteran(), 'head'), makeWornContents('cap'))
  })
})

describe('tier pools', () => {
  const melee  = (d, p) => roll(d, veteran(), 'melee', p).weaponType
  const ranged = (d, p) => roll(d, veteran(), 'ranged', p).weaponType
  const wand   = (d, p) => roll(d, veteran(), 'wand', p).weaponType

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

describe('worn pieces in chests', () => {
  it('the pools are these', () => {
    assert.deepEqual(ARMOR_POOLS, { 2: ['leather'], 3: ['leather', 'chain'], 4: ['chain', 'plate'] })
    assert.deepEqual(HEAD_POOLS, { 1: ['cap'], 2: ['cap', 'cloth'], 3: ['helm', 'cloth', 'horned'], 4: ['helm', 'horned'] })
    assert.deepEqual(BOOTS_POOLS, { 2: ['wayfarer'], 3: ['wayfarer', 'ironshod'], 4: ['ironshod'] })
    assert.deepEqual(RING_POOLS, { 3: ['breath', 'miser'], 4: ['breath', 'miser', 'mending', 'smith'] })
  })
  it('every key in a pool is a piece of that band\'s slot', () => {
    for (const [slot, pools] of Object.entries({ armor: ARMOR_POOLS, head: HEAD_POOLS, boots: BOOTS_POOLS, ring: RING_POOLS }))
      for (const key of Object.values(pools).flat()) assert.equal(WORN_TYPES[key]?.slot, slot, `${key} in the ${slot} pools`)
  })
  it('a band rolls from its tier\'s pool, first to last', () => {
    const got = (depth, name, pick) => roll(depth, veteran(), name, pick).gearType
    assert.deepEqual([got(4, 'armor', 0), got(4, 'armor', 0.99)], ['leather', 'chain'])
    assert.deepEqual([got(5, 'armor', 0), got(5, 'armor', 0.99)], ['chain', 'plate'])
    assert.deepEqual([got(4, 'head', 0), got(4, 'head', 0.5), got(4, 'head', 0.99)], ['helm', 'cloth', 'horned'])
    assert.deepEqual([got(4, 'boots', 0), got(4, 'boots', 0.99)], ['wayfarer', 'ironshod'])
    assert.deepEqual([got(5, 'ring', 0), got(5, 'ring', 0.99)], ['breath', 'smith'])
  })
  it('the cuirass is for a hero who can lift it: without the tabard the band gives mail, at full weight', () => {
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    assert.equal(weights(18, p).armor, BASE_WEIGHTS.armor)
    for (const pick of [0.0, 0.99]) assert.equal(roll(18, p, 'armor', pick).gearType, 'chain')
    assert.equal(roll(18, null, 'armor', 0.99).gearType, 'plate')
  })
  it('no armor, boots or ring at tier 1, and the elder\'s boots and the story outfits never', () => {
    for (let i = 0; i < 300; i++) assert.ok(!['armor', 'boots', 'ring'].includes(rollChestLoot(1, Math.random, veteran()).type))
    for (let i = 0; i < 600; i++) {
      const c = rollChestLoot(18, Math.random, veteran())
      assert.notEqual(c.type, 'outfit')
      assert.notEqual(c.gearType, 'elk')
    }
  })
})

// A category the player cannot equip at all shrinks to a fifth of its weight
// and yields the humblest example of its kind, so a first-map chest hints at
// what is coming instead of handing over endgame gear.
describe('a locked category shrinks to a teaser', () => {
  const fresh = () => mkPlayer()

  it('leaves the potion and melee bands as the bulk of the roll', () => {
    const w = weights(7, fresh())
    assert.deepEqual([w.potion, w.melee, w.shield, w.ammo], [26, 15, 4, 0])
    assert.ok(Math.abs(w.ranged - 14 * 0.2) < 1e-9 && Math.abs(w.wand - 14 * 0.2) < 1e-9)
    const total = Object.values(w).reduce((a, b) => a + b, 0)
    assert.ok((w.potion + w.melee) / total > 0.7, 'potions and blades are most of a first chest')
    assert.equal(rollChestLoot(7, seq(0.3), fresh()).type, 'potion')
  })

  it('a locked bow and wand are the tier\'s humblest', () => {
    assert.equal(roll(7, fresh(), 'ranged').type, 'ranged')
    assert.equal(roll(7, fresh(), 'wand').weaponType, 'sparkwand')
  })

  it('draws a locked bow teaser from tier 1 even on a tier-4 map', () => {
    const p = mkPlayer({ outfits: ['robe', 'plate'] })
    assert.ok(Math.abs(weights(18, p).ranged - 14 * 0.2) < 1e-9)
    const c = roll(18, p, 'ranged', 0.99)
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'shortbow', 'tier-1 pool, not the tier-4 crossbow')
  })

  it('draws a locked wand teaser from tier 1 even on a tier-4 map', () => {
    const p = mkPlayer({ outfits: ['ranger', 'plate'], ranged: 'shortbow' })
    const c = roll(18, p, 'wand', 0.99)
    assert.equal(c.type, 'wand')
    assert.equal(c.weaponType, 'sparkwand', 'tier-1 pool, not the tier-4 Storm Wand')
  })

  it('falls back to a tier-1 melee teaser when the whole tier is too heavy', () => {
    // Tier 4 melee is axe/longsword, both heavy — nothing usable without the tabard.
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    assert.ok(Math.abs(weights(18, p).melee - 15 * 0.2) < 1e-9)
    const c = roll(18, p, 'melee', 0.0)
    assert.equal(c.type, 'weapon')
    assert.equal(c.weaponType, 'dagger')
  })

  it('a tier-4 kite shield without the tabard is a buckler teaser', () => {
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    assert.ok(Math.abs(weights(18, p).shield - 4 * 0.2) < 1e-9)
    const c = roll(18, p, 'shield', 0.99)
    assert.equal(c.type, 'shield')
    assert.equal(c.weaponType, 'buckler')
  })
})

// A category is only locked when nothing in its tier is usable; where the tier
// still holds one usable item, the band keeps its full weight and simply skips
// what the player cannot lift.
describe('a partly usable tier keeps its full weight', () => {
  it('yields only the sword from a tier-2 melee roll without the tabard', () => {
    // Tier 2 is sword/longsword; only the sword is liftable.
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    assert.equal(weights(12, p).melee, BASE_WEIGHTS.melee)
    for (const pick of [0.0, 0.99]) assert.equal(roll(12, p, 'melee', pick).weaponType, 'sword')
  })
})

describe('ammo follows the bows the player carries', () => {
  it('never drops a bundle for a player with no bow at all', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS })
    assert.equal(weights(18, p).ammo, 0)
    for (let i = 0; i < 400; i++) {
      assert.notEqual(rollChestLoot(18, Math.random, p).type, 'ammo')
    }
  })

  it('yields stones for a held sling', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS, ranged: 'sling' })
    for (const pick of [0.0, 0.99]) {
      assert.deepEqual(roll(18, p, 'ammo', pick), { type: 'ammo', ammoKind: 'stone', count: 15 })
    }
  })

  it('yields bolts for a crossbow left in the sack', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS, sack: ['crossbow'] })
    assert.deepEqual(roll(18, p, 'ammo', 0.0), { type: 'ammo', ammoKind: 'bolt', count: 6 })
  })

  it('splits the band between the kinds a player has bows for', () => {
    const p = mkPlayer({ outfits: ALL_OUTFITS, ranged: 'shortbow', sack: ['sling'] })
    assert.equal(roll(18, p, 'ammo', 0.0).ammoKind, 'arrow')
    assert.equal(roll(18, p, 'ammo', 0.99).ammoKind, 'stone')
  })
})

describe('a missing player', () => {
  it('is treated as able to use everything', () => {
    assert.equal(roll(5, null, 'ranged', 0.99).weaponType, 'crossbow')
    assert.equal(roll(5, null, 'wand', 0.99).weaponType, 'stormwand')
    assert.equal(roll(5, null, 'ammo', 0.0).type, 'ammo')
    assert.deepEqual(weights(5, null), BASE_WEIGHTS)
  })
})

describe('shield rungs', () => {
  it('tier 3 offers both shields, tier 4 the kite', () => {
    const shield = (d, p) => roll(d, veteran(), 'shield', p).weaponType
    assert.equal(shield(4, 0.0), 'buckler')   // depth 4 = tier 3
    assert.equal(shield(4, 0.99), 'kite')
    assert.equal(shield(5, 0.0), 'kite')      // depth 5 = tier 4
    assert.equal(shield(1, 0.99), 'buckler')
  })
  it('a hero in the tabard draws the kite; a null player draws everything', () => {
    assert.equal(roll(5, veteran(), 'shield', 0.99).weaponType, 'kite')
    assert.equal(roll(5, null, 'shield', 0.99).weaponType, 'kite')
  })
})
