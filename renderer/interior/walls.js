// A plan (interior/plan.js) turned into game cells: wall tops autotiled from
// their wall-top neighbours, face rows with end pieces where they meet a wall
// or a doorway, each room its floor, a doormat at the way out, nothing drawn
// outside. Cells follow the open-map model: `skin` is the ground art, `deco`
// a rug or mat, `overlay` what stands there (furnish.js lays those).
import { TILE } from '../systems/entities.js'
import { createMap } from '../systems/map.js'
import { WALLS, MISC, N, E, S, W } from './kit.js'

const contains = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1

// opts: { palette, floorOf: roomId -> floor tile name }
export function buildCells(plan, { palette, floorOf }) {
  const { w, h, grid, rooms } = plan
  const kit = WALLS[palette]
  if (!kit) throw new Error(`buildCells: unknown palette "${palette}"`)
  const at = (x, y) => grid[y]?.[x] ?? ' '
  const roomAt = (x, y) => rooms.find(r => contains(r, x, y)) ?? null
  const map = createMap(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = map[y][x], ch = at(x, y)
    c.locked = true
    if (ch === '#') {
      const m = (at(x, y - 1) === '#' ? N : 0) | (at(x + 1, y) === '#' ? E : 0) | (at(x, y + 1) === '#' ? S : 0) | (at(x - 1, y) === '#' ? W : 0)
      c.skin = kit.top[m]
    } else if (ch === 'u' || ch === 'l') {
      const l = at(x - 1, y) !== ch, r = at(x + 1, y) !== ch
      const set = ch === 'u' ? kit.faceU : kit.faceL
      c.skin = l && r ? (set.lr ?? set.m) : l ? set.l : r ? set.r : set.m
      c.roomId = roomAt(x, y)?.id ?? null
    } else if (ch === '.' || ch === 'd' || ch === 'E') {
      // a doorway takes the floor of the room it opens into (below, then beside)
      const room = roomAt(x, y) ?? roomAt(x, y + 1) ?? roomAt(x + 1, y) ?? roomAt(x - 1, y) ?? roomAt(x, y - 1)
      c.tile = TILE.FLOOR_WOOD
      c.skin = floorOf(room?.id ?? plan.entry)
      c.roomId = room?.id ?? null
      if (ch === 'E') { c.deco = MISC.doormat; c.roomId = plan.entry; c.skin = floorOf(plan.entry) }
    } else {
      c.skin = MISC.void
    }
  }
  return map
}
