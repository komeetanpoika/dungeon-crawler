// Campfires: built from lumber next to the player, burn for a minute, and
// cook raw meat for whoever stands on them. Pure — game.js wires the sack
// panel, the per-frame tick, cues and messages; canvas.js draws the flame.
import { isWalkable } from './entities.js'
import { makeItem, addItem } from './inventory.js'

const TILE_SIZE = 32
export const CAMPFIRE_COST = 3        // lumber per fire
export const CAMPFIRE_DURATION = 60   // seconds a fire burns
export const CAMPFIRE_FADE = 10       // last seconds, during which the flame dims

// Two fuels build a fire: plain lumber, or a dead tree's grey wood.
export const FUELS = ['lumber', 'deadwood']

const fuelCount = (player, fuel) => player.inventory.filter(i => i.kind === fuel).reduce((n, i) => n + (i.count ?? 1), 0)

export function canBuildCampfire(player, fuel = 'lumber') {
  return fuelCount(player, fuel) >= CAMPFIRE_COST ? { ok: true } : { ok: false, reason: 'lumber' }
}

// Remove CAMPFIRE_COST of the given fuel, emptied stacks vanish.
export function spendLumber(player, fuel = 'lumber') {
  let left = CAMPFIRE_COST
  player.inventory = player.inventory.flatMap(i => {
    if (i.kind !== fuel || left <= 0) return [i]
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

// `eternal` fires (the hermit's hearth) never burn out and are always
// vulnerability/alpha 1 — only stamped onto the object when true, so the
// default fire's shape is unchanged. Likewise `fuel` is only stamped when
// it's the grey deadwood fuel, so a plain lumber fire's shape is unchanged.
export function makeCampfire(x, y, { eternal = false, fuel = 'lumber' } = {}) {
  const fire = { type: 'campfire', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2, t: 0 }
  if (eternal) fire.eternal = true
  if (fuel === 'deadwood') fire.fuel = 'deadwood'   // grey fire: the wraith cannot snuff it and burns in its light
  return fire
}

// A grey fire — built from deadwood. The hermit episode's wraith burns only
// in this light (a later task); a plain lumber fire has no `fuel` field.
export const isDeadwoodFire = e => e?.type === 'campfire' && e.fuel === 'deadwood'

// Age every fire; those past their duration are dropped and returned. Eternal
// fires still age (so campfireAlpha's t-based math stays sane) but never expire.
export function tickCampfires(entities, delta) {
  const expired = []
  const kept = entities.filter(e => {
    if (e.type !== 'campfire') return true
    e.t += delta
    if (e.eternal || e.t < CAMPFIRE_DURATION) return true
    expired.push(e)
    return false
  })
  return { entities: kept, expired }
}

// 1 while burning well; eases down to 0.3 over the final CAMPFIRE_FADE seconds.
// Eternal fires never dim.
export function campfireAlpha(fire) {
  if (fire.eternal) return 1
  const left = CAMPFIRE_DURATION - fire.t
  if (left >= CAMPFIRE_FADE) return 1
  return 0.3 + 0.7 * Math.max(0, left) / CAMPFIRE_FADE
}

// Every raw meat stack becomes cooked meat. Returns how many were cooked.
export function cookMeat(player) {
  const total = player.inventory.reduce((n, it) => it.kind === 'meat' ? n + (it.count ?? 1) : n, 0)
  if (total === 0) return 0
  player.inventory = player.inventory.filter(it => it.kind !== 'meat')
  addItem(player, makeItem('cooked_meat', total))   // the freed slots guarantee room
  return total
}
