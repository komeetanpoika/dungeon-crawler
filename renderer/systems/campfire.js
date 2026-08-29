// Campfires: built from lumber next to the player, burn for a minute, and
// cook raw meat for whoever stands on them. Pure — game.js wires the sack
// panel, the per-frame tick, cues and messages; canvas.js draws the flame.
import { isWalkable } from './entities.js'
import { makeItem, addItem } from './inventory.js'

const TILE_SIZE = 32
export const CAMPFIRE_COST = 3        // lumber per fire
export const CAMPFIRE_DURATION = 60   // seconds a fire burns
export const CAMPFIRE_FADE = 10       // last seconds, during which the flame dims

const lumberCount = player => player.inventory.filter(i => i.kind === 'lumber').reduce((n, i) => n + (i.count ?? 1), 0)

export function canBuildCampfire(player) {
  return lumberCount(player) >= CAMPFIRE_COST ? { ok: true } : { ok: false, reason: 'lumber' }
}

// Remove CAMPFIRE_COST lumber, emptied stacks vanish.
export function spendLumber(player) {
  let left = CAMPFIRE_COST
  player.inventory = player.inventory.flatMap(i => {
    if (i.kind !== 'lumber' || left <= 0) return [i]
    const take = Math.min(left, i.count ?? 1)
    left -= take
    const count = (i.count ?? 1) - take
    return count > 0 ? [{ ...i, count }] : []
  })
}

// First free orthogonal walkable tile — the same search item drops use.
export function buildSpot(map, entities, player) {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !entities.some(e => e.x === t.x && e.y === t.y)) ?? null
}

export function makeCampfire(x, y) {
  return { type: 'campfire', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2, t: 0 }
}

// Age every fire; those past their duration are dropped and returned.
export function tickCampfires(entities, delta) {
  const expired = []
  const kept = entities.filter(e => {
    if (e.type !== 'campfire') return true
    e.t += delta
    if (e.t < CAMPFIRE_DURATION) return true
    expired.push(e)
    return false
  })
  return { entities: kept, expired }
}

// 1 while burning well; eases down to 0.3 over the final CAMPFIRE_FADE seconds.
export function campfireAlpha(fire) {
  const left = CAMPFIRE_DURATION - fire.t
  if (left >= CAMPFIRE_FADE) return 1
  return 0.3 + 0.7 * Math.max(0, left) / CAMPFIRE_FADE
}

// Every raw meat stack becomes cooked meat. Returns how many were cooked.
export function cookMeat(player) {
  const i = player.inventory.findIndex(it => it.kind === 'meat')
  if (i === -1) return 0
  const n = player.inventory[i].count ?? 1
  player.inventory.splice(i, 1)
  addItem(player, makeItem('cooked_meat', n))   // the freed slot guarantees room
  return n
}
