import { WEAPON_TYPES, makeRangedContents } from './entities.js'

// Random chest loot: potion 40% / melee weapon 30% / ranged weapon 30%.
// Weapon tier scales with depth, mirroring LEVEL_CONFIG's melee progression.
const MELEE_POOLS  = { shallow: ['dagger', 'sword'],       deep: ['longsword', 'axe'] }
const RANGED_POOLS = { shallow: ['shortbow', 'sparkwand'], deep: ['longbow', 'stormwand'] }
const DEEP_FROM = 3

function pick(pool, rng) {
  return pool[Math.min(Math.floor(rng() * pool.length), pool.length - 1)]
}

export function rollChestLoot(depth, rng = Math.random) {
  const tier = depth >= DEEP_FROM ? 'deep' : 'shallow'
  const r = rng()
  if (r < 0.4) return { type: 'potion', amount: 4 }
  if (r < 0.7) {
    const weaponType = pick(MELEE_POOLS[tier], rng)
    const def = WEAPON_TYPES[weaponType]
    return { type: 'weapon', weaponType, name: def.name, damage: def.damage }
  }
  return makeRangedContents(pick(RANGED_POOLS[tier], rng))
}
