// Track trails: the dirt a heavy animal leaves between two places. A trail
// restains the ground (cell.skin) rather than adding an overlay — dirt is
// ground art, and as an overlay it would read as a solid patch and fight with
// the props already on the cell. Nothing here is persisted: the save records
// stumps and cleared rock, not skins, so a quest module re-stamps its current
// trail on every arrival. Pure map mutation.
import { buildNavGrid, findPath } from '../nav.js'
import { markTileDirty } from '../tile-dirty.js'
import { isWalkable } from '../entities.js'

export const TRACK_SKINS = ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2', 'ow_dirt_3']
export const TRACK_EVERY = 2     // stain every Nth cell of the path

// Bare grass only: never cover a bush, a flower or a rock, never restain
// water, cobble or dirt that is already there, and never touch a wall.
export function isStampable(cell) {
  if (!cell || !isWalkable(cell.tile, cell)) return false
  if (cell.overlay) return false
  return typeof cell.skin === 'string' && cell.skin.startsWith('ow_grass')
}

// Stains a thinned-out line of cells along the walkable path from `from` to
// `to`. Returns how many cells it stained — 0 when the path is blocked, which
// callers treat as "no trail today" rather than an error.
export function stampTrail(map, from, to, { every = TRACK_EVERY } = {}) {
  const path = findPath(buildNavGrid(map), from.x, from.y, to.x, to.y, 1)
  if (!path?.length) return 0
  let n = 0
  path.forEach((c, i) => {
    if (i % every) return
    const cell = map[c.y]?.[c.x]
    if (!isStampable(cell)) return
    cell.skin = TRACK_SKINS[(c.x * 7 + c.y * 13) % TRACK_SKINS.length]
    markTileDirty(map, c.x, c.y)
    n++
  })
  return n
}
