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
// Shields ride alongside melee (one pick in five) and the Leather Coat is the
// one chest outfit (a twentieth of the roll, from tier 2 on); both are in the
// same tiered-pool/teaser ladder as the weapon bands. The three story
// outfits (ranger, robe, plate) are never rolled — they come from the world
// (systems/outfits.js).
import { weaponContents, makeRangedContents, makeWandContents, makeShieldContents, makeOutfitContents, AMMO_KINDS } from './entities.js'
import { canEquip, itemFromContents, canWieldHeavy } from './inventory.js'
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
// The one chest outfit. Story outfits (ranger, robe, plate) are handed out by
// the world (systems/outfits.js), never rolled. No rung at tier 1: the first
// maps are for learning the sack, not filling it.
export const OUTFIT_POOLS = {
  2: ['leather'],
  3: ['leather'],
  4: ['leather'],
}
// Ammo is not tiered: a bundle is only ever worth finding when the player
// carries a bow that fires it, and that ownership is the better gate.
const AMMO_COUNTS = { arrow: 10, bolt: 6, stone: 15 }

// Relative band weights. A locked category keeps TEASER of its own weight and
// whatever is left is renormalised over the survivors — so on the first map,
// where bows, wands and ammo are all out of reach, potions and melee split
// nearly the whole roll between them. Shields take a fifth of the old melee
// weight; the Leather Coat a twentieth of the chest, out of the potion band,
// so a veteran's roll still totals 100.
const BASE_WEIGHTS = { potion: 30, melee: 16, shield: 4, ranged: 15, wand: 15, ammo: 15, outfit: 5 }
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
  if (contents.type === 'shield') return !contents.heavy || canWieldHeavy(player)
  const item = itemFromContents(contents)
  return !item || canEquip(player, item).ok
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
    ? { weight: BASE_WEIGHTS[name], pool: usable, toContents }
    : { weight: BASE_WEIGHTS[name] * TEASER, pool: pools[1], toContents }
}

const meleeContents = wt => ({ type: 'weapon', ...weaponContents(wt) })

export function rollChestLoot(depth, rng = Math.random, player = null) {
  const tier = lootTierFor(depth)
  const ammoKinds = ammoKindsFor(player)
  const bands = [
    { weight: BASE_WEIGHTS.potion, pool: [null], toContents: () => ({ type: 'potion', amount: 4 }) },
    weaponBand('melee',  MELEE_POOLS,  tier, player, meleeContents),
    weaponBand('shield', SHIELD_POOLS, tier, player, makeShieldContents),
    weaponBand('ranged', RANGED_POOLS, tier, player, makeRangedContents),
    weaponBand('wand',   WAND_POOLS,   tier, player, makeWandContents),
    { weight: ammoKinds.length ? BASE_WEIGHTS.ammo : 0, pool: ammoKinds,
      toContents: k => ({ type: 'ammo', ammoKind: k, count: AMMO_COUNTS[k] }) },
    { weight: (OUTFIT_POOLS[tier] ?? []).length ? BASE_WEIGHTS.outfit : 0, pool: OUTFIT_POOLS[tier] ?? [],
      toContents: makeOutfitContents },
  ]
  const total = bands.reduce((sum, b) => sum + b.weight, 0)
  let r = rng() * total
  for (const band of bands) {
    if (band.weight > 0 && r < band.weight) return band.toContents(pick(band.pool, rng))
    r -= band.weight
  }
  return { type: 'potion', amount: 4 }   // unreachable: the potion band is never zero
}
