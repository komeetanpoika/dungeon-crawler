import { weaponContents, makeRangedContents, makeWandContents } from './entities.js'

// Random chest loot: potion 40% / melee weapon 15% / ranged weapon 15% /
// wand 15% / ammo bundle 15%. Weapon/ranged/wand tier scales with depth,
// mirroring LEVEL_CONFIG's melee progression; ammo bundles widen deep (bolts
// join once the crossbow itself can drop).
const MELEE_POOLS  = { shallow: ['dagger', 'sword'],                     deep: ['longsword', 'axe'] }
const RANGED_POOLS = { shallow: ['shortbow', 'hunterbow', 'sling'],      deep: ['longbow', 'splitbow', 'crossbow'] }
const WAND_POOLS   = { shallow: ['sparkwand', 'frostwand'],              deep: ['firewand', 'bramblewand', 'blinkwand', 'stormwand'] }
// [ammoKind, count] pairs — not a sack item, so these skip itemFromContents.
const AMMO_POOLS   = {
  shallow: [['arrow', 10], ['stone', 15]],
  deep:    [['arrow', 10], ['bolt', 6], ['stone', 15]],
}
const DEEP_FROM = 3

function pick(pool, rng) {
  return pool[Math.min(Math.floor(rng() * pool.length), pool.length - 1)]
}

export function rollChestLoot(depth, rng = Math.random) {
  const tier = depth >= DEEP_FROM ? 'deep' : 'shallow'
  const r = rng()
  if (r < 0.40) return { type: 'potion', amount: 4 }
  if (r < 0.55) return { type: 'weapon', ...weaponContents(pick(MELEE_POOLS[tier], rng)) }
  if (r < 0.70) return makeRangedContents(pick(RANGED_POOLS[tier], rng))
  if (r < 0.85) return makeWandContents(pick(WAND_POOLS[tier], rng))
  const [ammoKind, count] = pick(AMMO_POOLS[tier], rng)
  return { type: 'ammo', ammoKind, count }
}
