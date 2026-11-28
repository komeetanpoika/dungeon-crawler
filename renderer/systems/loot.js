// What a chest holds. Two things shape the roll: the level's difficulty rung
// (`lootTier`, data/levels.js) picks the pool, and what the player is wearing
// decides whether a category is worth offering at all.
//
// The outfit rule exists because the three weapon categories are gated —
// bows on the Ranger's Coat, wands on the Mage's Robe, heavy blades on the
// Plated Armor (see canEquip) — and an Adventure run starts in none of them. A chest that
// rolls a Storm Wand on the first map is not a reward, it is a slot in the
// sack the player cannot empty. So a category the player cannot use at all
// keeps only a fifth of its weight and offers the humblest example of its
// kind: enough to hint that bows exist, not enough to bury the run in gear.
// A bow teaser is not wasted even so — a pickup's arrow bundle reaches the
// pool whether or not the weapon can be equipped (autoEquipOnPickup).
//
// Shields ride alongside melee (one pick in five), and the four kinds of
// worn piece (armor, headwear, boots, rings: entities.js WORN_TYPES) have a
// small band each, on the same tiered-pool ladder as the weapons. A tier
// with no pool for a band gives it no weight: the first maps roll no armor,
// boots or rings. The three story outfits (ranger, robe, the tabard) and
// the elder's Elk-hide Boots are never rolled — they come from the world
// (systems/outfits.js, systems/quests/clearings.js).
import { weaponContents, makeRangedContents, makeWandContents, makeShieldContents, makeWornContents, AMMO_KINDS } from './entities.js'
import { canEquip, itemFromContents, canWieldHeavy } from './inventory.js'
import { WORN_SLOTS } from './entities.js'
import { LEVEL_CONFIG } from '../data/levels.js'

// Four rungs, one per pool. A tier's melee and ranged rows both hold at least
// one item a player without the plate can lift, right up to tier 4 — where the
// melee row cannot, and the teaser rule below takes over.
const MELEE_POOLS = {
  1: ['dagger', 'sword'],
  2: ['sword', 'longsword'],
  3: ['longsword', 'axe'],
  4: ['axe', 'longsword'],
}
const RANGED_POOLS = {
  1: ['sling', 'shortbow'],
  2: ['shortbow', 'hunterbow'],
  3: ['hunterbow', 'longbow', 'splitbow'],
  4: ['longbow', 'splitbow', 'crossbow'],
}
const WAND_POOLS = {
  1: ['sparkwand'],
  2: ['sparkwand', 'frostwand'],
  3: ['frostwand', 'firewand', 'bramblewand'],
  4: ['firewand', 'bramblewand', 'blinkwand', 'stormwand'],
}
// Shields ride in the melee category (one pick in five); the tall kite
// shield needs the plate, so a tier that holds only the kite locks like a
// heavy melee tier and teases the buckler instead.
export const SHIELD_POOLS = {
  1: ['buckler'],
  2: ['buckler'],
  3: ['buckler', 'kite'],
  4: ['kite'],
}
// Worn pieces (entities.js WORN_TYPES keys). A missing rung is a band that
// does not roll at that tier: the first maps are for learning the sack, not
// filling it. The Plate Cuirass is heavy, so it is offered only to a hero in
// the tabard (canUse); the mail beside it keeps the band at full weight.
export const ARMOR_POOLS = {
  2: ['leather'],
  3: ['leather', 'chain'],
  4: ['chain', 'plate'],
}
export const HEAD_POOLS = {
  1: ['cap'],
  2: ['cap', 'cloth'],
  3: ['helm', 'cloth', 'horned'],
  4: ['helm', 'horned'],
}
export const BOOTS_POOLS = {
  2: ['wayfarer'],
  3: ['wayfarer', 'ironshod'],
  4: ['ironshod'],
}
export const RING_POOLS = {
  3: ['breath', 'miser'],
  4: ['breath', 'miser', 'mending', 'smith'],
}
// Ammo is not tiered: a bundle is only ever worth finding when the player
// carries a bow that fires it, and that ownership is the better gate.
const AMMO_COUNTS = { arrow: 10, bolt: 6, stone: 15 }

// Relative band weights. A locked category keeps TEASER of its own weight and
// whatever is left is renormalised over the survivors — so on the first map,
// where bows, wands and ammo are all out of reach, potions and melee split
// nearly the whole roll between them. Worn pieces are 13 of a veteran's
// hundred in all (armor 5, headwear 4, boots 2, rings 2), taken a little
// from every other band.
export const BASE_WEIGHTS = { potion: 26, melee: 15, shield: 4, ranged: 14, wand: 14, ammo: 14, armor: 5, head: 4, boots: 2, ring: 2 }
const TEASER = 0.2

function pick(pool, rng) {
  return pool[Math.min(Math.floor(rng() * pool.length), pool.length - 1)]
}

export function lootTierFor(depth) {
  return LEVEL_CONFIG.find(c => c.depth === depth)?.lootTier ?? 1
}

// A null player means "no run to ask" — treat everything as usable, so a call
// site with no player to hand behaves as it did before the gear gate entered the roll.
function canUse(player, contents) {
  if (!player) return true
  // Shields keep their own rule rather than routing through canEquip's
  // 'off' slot: canEquipOffhand also refuses a heavy main hand or a closed
  // loadout, neither of which should keep a shield out of the loot pool —
  // the plate gate is the only one that matters here.
  if (contents.type === 'shield') return !contents.heavy || canWieldHeavy(player)
  const item = itemFromContents(contents)
  if (!item) return true
  // A worn piece is judged for its own slot (a heavy one needs the tabard).
  return canEquip(player, item, WORN_SLOTS.includes(item.kind) ? item.kind : 'main').ok
}

// The ammo kinds the player actually owns a bow for, hand or sack, in
// AMMO_KINDS order so the roll is stable. A null player owns every kind.
function ammoKindsFor(player) {
  if (!player) return [...AMMO_KINDS]
  const held = [player.ranged, ...(player.inventory ?? [])
    .filter(i => i.kind === 'ranged').map(i => i.payload)]
  const kinds = new Set(held.filter(Boolean).map(w => w.ammoKind))
  return AMMO_KINDS.filter(k => kinds.has(k))
}

// One weapon category's band: the tier's pool minus what the player cannot
// wield. Emptied entirely, the category is locked — a fifth of the weight,
// drawn from tier 1 instead.
function weaponBand(name, pools, tier, player, toContents) {
  const usable = pools[tier].filter(wt => canUse(player, toContents(wt)))
  return usable.length
    ? { name, weight: BASE_WEIGHTS[name], pool: usable, toContents }
    : { name, weight: BASE_WEIGHTS[name] * TEASER, pool: pools[1], toContents }
}

// A worn slot's band: the tier's pool minus what the player cannot wear. No
// pool at this tier, no band; a pool he can wear none of teases the lowest
// rung's pieces at a fifth of the weight, as a weapon band does.
function wornBand(name, pools, tier, player) {
  const pool = pools[tier] ?? []
  if (!pool.length) return { name, weight: 0, pool, toContents: makeWornContents }
  const usable = pool.filter(key => canUse(player, makeWornContents(key)))
  const lowest = pools[Math.min(...Object.keys(pools).map(Number))]
  return usable.length
    ? { name, weight: BASE_WEIGHTS[name], pool: usable, toContents: makeWornContents }
    : { name, weight: BASE_WEIGHTS[name] * TEASER, pool: lowest, toContents: makeWornContents }
}

const meleeContents = wt => ({ type: 'weapon', ...weaponContents(wt) })

// The bands of a chest at this depth for this player, in roll order:
// [{ name, weight, pool, toContents }]. rollChestLoot rolls over them; the
// tests and tools/verify-loot.mjs read them.
export function lootBands(depth, player = null) {
  const tier = lootTierFor(depth)
  const ammoKinds = ammoKindsFor(player)
  return [
    { name: 'potion', weight: BASE_WEIGHTS.potion, pool: [null], toContents: () => ({ type: 'potion', amount: 4 }) },
    weaponBand('melee',  MELEE_POOLS,  tier, player, meleeContents),
    weaponBand('shield', SHIELD_POOLS, tier, player, makeShieldContents),
    weaponBand('ranged', RANGED_POOLS, tier, player, makeRangedContents),
    weaponBand('wand',   WAND_POOLS,   tier, player, makeWandContents),
    { name: 'ammo', weight: ammoKinds.length ? BASE_WEIGHTS.ammo : 0, pool: ammoKinds,
      toContents: k => ({ type: 'ammo', ammoKind: k, count: AMMO_COUNTS[k] }) },
    wornBand('armor', ARMOR_POOLS, tier, player),
    wornBand('head',  HEAD_POOLS,  tier, player),
    wornBand('boots', BOOTS_POOLS, tier, player),
    wornBand('ring',  RING_POOLS,  tier, player),
  ]
}

export function rollChestLoot(depth, rng = Math.random, player = null) {
  const bands = lootBands(depth, player)
  const total = bands.reduce((sum, b) => sum + b.weight, 0)
  let r = rng() * total
  for (const band of bands) {
    if (band.weight > 0 && r < band.weight) return band.toContents(pick(band.pool, rng))
    r -= band.weight
  }
  return { type: 'potion', amount: 4 }   // unreachable: the potion band is never zero
}
