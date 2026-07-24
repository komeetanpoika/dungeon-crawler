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

// dragon_boss is deliberately absent — it keeps full ranged immunity.
const BURNABLE = new Set(['guard', 'monster', 'dragon', 'cyclops', 'wizard', 'crab'])

const tileKey = e => `${Math.floor(e.px / TILE_SIZE)},${Math.floor(e.py / TILE_SIZE)}`
const keySet = tiles => new Set(tiles.map(t => `${t.x},${t.y}`))
const cullDead = entities => entities.filter(e => !BURNABLE.has(e.type) || e.hp > 0)

// Initial detonation damage to everything standing on a blast tile. The
// wizard's shield does NOT protect — the fireball is the counter-tool.
export function applyBurst(entities, player, tiles) {
  const keys = keySet(tiles)
  let hitCount = 0
  const updated = entities.map(e => {
    if (!BURNABLE.has(e.type) || e.px === undefined || !keys.has(tileKey(e))) return e
    hitCount++
    return { ...e, hp: e.hp - BURST_DAMAGE, inCombat: true }
  })
  return { entities: cullDead(updated), playerBurned: keys.has(tileKey(player)), hitCount }
}

export function makeFireZone(tiles) {
  return { tiles, age: 0, tickTimer: FIRE_TICK_INTERVAL }
}

// Advance all zones by `delta`. Each zone ticks independently every
// FIRE_TICK_INTERVAL, damaging everything standing on its tiles. Returns
// surviving zones, the updated entity list (tick kills removed), and the
// total damage the player took (game.js applies it via damagePlayer 'dot').
export function updateFireZones(zones, entities, player, delta) {
  let playerDamage = 0
  let updated = entities
  const live = []
  for (const z of zones) {
    const zone = { ...z, age: z.age + delta, tickTimer: z.tickTimer - delta }
    while (zone.tickTimer <= 0) {
      zone.tickTimer += FIRE_TICK_INTERVAL
      const keys = keySet(zone.tiles)
      updated = updated.map(e => {
        if (!BURNABLE.has(e.type) || e.px === undefined || !keys.has(tileKey(e))) return e
        return { ...e, hp: e.hp - FIRE_TICK_DAMAGE, inCombat: true }
      })
      if (keys.has(tileKey(player))) playerDamage += FIRE_TICK_DAMAGE
    }
    if (zone.age < FIRE_DURATION) live.push(zone)
  }
  return { zones: live, entities: cullDead(updated), playerDamage }
}
