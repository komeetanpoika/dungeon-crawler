// Fireball wand: blast flood-fill, burst damage, and lingering fire zones.
// Pure logic — game.js owns detonation wiring, player damage application
// (damagePlayer), and visuals (canvas.js draws state.fireZones).
import { isWalkable } from './entities.js'

const TILE_SIZE = 32

export const FIREBALL_RANGE_TILES = 10 // projectile detonates after this many tiles
export const BLAST_TILES = 16          // flood-fill size
export const BURST_DAMAGE = 4
export const FIRE_DURATION = 3.0       // seconds a zone burns
export const FIRE_TICK_INTERVAL = 1.0
export const FIRE_TICK_DAMAGE = 1

// 4-neighbor BFS from the detonation tile through walkable tiles, gas-like:
// blocked by walls, spills around corners. Returns up to `count` {x, y}
// tiles in BFS order ([] if the origin itself is unwalkable).
export function computeBlastTiles(map, tileX, tileY, count = BLAST_TILES) {
  const origin = map[tileY]?.[tileX]
  if (!origin || !isWalkable(origin.tile, origin)) return []
  const tiles = []
  const seen = new Set([`${tileX},${tileY}`])
  const queue = [{ x: tileX, y: tileY }]
  while (queue.length && tiles.length < count) {
    const t = queue.shift()
    tiles.push(t)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = t.x + dx, ny = t.y + dy
      const k = `${nx},${ny}`
      if (seen.has(k)) continue
      seen.add(k)
      const cell = map[ny]?.[nx]
      if (cell && isWalkable(cell.tile, cell)) queue.push({ x: nx, y: ny })
    }
  }
  return tiles
}
