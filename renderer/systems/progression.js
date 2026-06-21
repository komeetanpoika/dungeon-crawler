import { makeKey, makeTreasure } from './entities.js'

// Number of living bosses among the given entities.
export function countBosses(entities) {
  return entities.filter(e => e.isBoss).length
}

// The boss's death drop, placed at the boss's last tile.
//   non-final → a key that opens the level's pre-placed exit door.
//   final     → a treasure (placeholder: a random weapon from the depth's pool),
//               which wins the run when collected.
export function spawnBossDrop(tile, isFinal, weaponPool = ['dagger']) {
  if (isFinal) {
    const weaponType = weaponPool[Math.floor(Math.random() * weaponPool.length)]
    return makeTreasure(tile.x, tile.y, weaponType)
  }
  return makeKey(tile.x, tile.y)
}
