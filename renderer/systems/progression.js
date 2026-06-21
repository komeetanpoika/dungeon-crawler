import { TILE } from './entities.js'

// Number of living bosses among the given entities.
export function countBosses(entities) {
  return entities.filter(e => e.isBoss).length
}

// Materialize a level's exit at the boss's death tile.
//   isFinal=false → carve STAIRS_DOWN there (player walks onto it to descend).
//   isFinal=true  → place victory TREASURE there; returns the tile so the caller
//                   can detect the walk-onto win.
// Returns the victory tile {x,y} on the final level, otherwise null.
export function spawnLevelExit(map, tile, isFinal) {
  const cell = map[tile.y]?.[tile.x]
  if (!cell) return null
  if (isFinal) {
    cell.tile = TILE.TREASURE
    cell.dirty = true
    return { x: tile.x, y: tile.y }
  }
  cell.tile = TILE.STAIRS_DOWN
  cell.stairWidth = 1
  cell.stairCol = 0
  cell.dirty = true
  return null
}
