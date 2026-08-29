// Trees and lumber: which overlay art is a choppable tree, which cell a
// swing lands on, and what felling leaves behind. Pure map mutation —
// game.js spawns the lumber pickup, plays the cues and persists the record.
//
// Chop damage lives in cell.chopHp and is deliberately invisible: the
// overlay stays the plain tree until the cell is felled (no bar, no
// number). Per-damage tree art may come later.
import { TILE } from './entities.js'

export const STUMP = 'ow_stump'
const TILE_SIZE = 32

// Keyed by the overlay buildOpenMap stamps on the blocking cell. Two-cell
// trees are addressed by the trunk; the `_top` overlay sits at y-1.
export const TREES = {
  ow_tree_small:        { hp: 3, yield: 1, cells: 1 },
  ow_tree_small_autumn: { hp: 3, yield: 1, cells: 1 },
  ow_tree_apple:        { hp: 3, yield: 1, cells: 1 },
  ow_deadtree_0:        { hp: 2, yield: 1, cells: 1 },
  ow_deadtree_1:        { hp: 2, yield: 1, cells: 1 },
  ow_tree_pine_trunk:   { hp: 4, yield: 2, cells: 2 },
  ow_tree_autumn_trunk: { hp: 4, yield: 2, cells: 2 },
}

const isTop = overlay => typeof overlay === 'string' && overlay.endsWith('_top')

// The tree a cell belongs to: trunks resolve to themselves, tops to the
// trunk directly below. Null for anything else (an orphan top is scenery).
export function resolveTree(map, x, y) {
  const cell = map[y]?.[x]
  if (!cell) return null
  const def = TREES[cell.overlay]
  if (def) return { x, y, def }
  if (isTop(cell.overlay)) {
    const below = map[y + 1]?.[x]
    const tdef = below && TREES[below.overlay]
    if (tdef && tdef.cells === 2) return { x, y: y + 1, def: tdef }
  }
  return null
}

// Nearest tree trunk whose cell centre lies inside the swing wedge —
// hitAt(dx, dy) is the same test the entity hit uses. One tree per swing.
export function findTreeHit(map, player, hitAt, reachPx) {
  const r = Math.ceil(reachPx / TILE_SIZE) + 1
  let best = null, bestD = Infinity
  for (let y = player.y - r; y <= player.y + r; y++) for (let x = player.x - r; x <= player.x + r; x++) {
    const t = resolveTree(map, x, y)
    if (!t) continue
    const dx = x * TILE_SIZE + TILE_SIZE / 2 - player.px
    const dy = y * TILE_SIZE + TILE_SIZE / 2 - player.py
    if (Math.hypot(dx, dy) > reachPx + TILE_SIZE / 2) continue
    if (!hitAt(dx, dy)) continue
    const d = Math.hypot(t.x * TILE_SIZE + TILE_SIZE / 2 - player.px, t.y * TILE_SIZE + TILE_SIZE / 2 - player.py)
    if (d < bestD) { bestD = d; best = { x: t.x, y: t.y } }
  }
  return best
}

function fell(map, x, y, def) {
  const cell = map[y][x]
  cell.tile = TILE.FLOOR
  cell.overlay = STUMP
  cell.dirty = true
  delete cell.losSoft
  delete cell.chopHp
  if (def.cells === 2) {
    const top = map[y - 1]?.[x]
    if (top && isTop(top.overlay)) {
      top.tile = TILE.FLOOR
      top.overlay = null
      top.dirty = true
      delete top.losSoft
    }
  }
}

// Deal `chop` to the trunk at (x, y). Felled trunks become walkable stumps.
export function chopTree(map, x, y, chop) {
  const cell = map[y]?.[x]
  const def = cell && TREES[cell.overlay]
  if (!def) return { felled: false, yield: 0 }
  cell.chopHp = (cell.chopHp ?? def.hp) - chop
  if (cell.chopHp > 0) return { felled: false, yield: 0 }
  fell(map, x, y, def)
  return { felled: true, yield: def.yield }
}

// Save-record helpers: stumps as "x,y" keys, and their re-application on a
// freshly built map (unknown or already-felled keys are ignored).
export function felledCells(map) {
  const out = []
  for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++)
    if (map[y][x].overlay === STUMP) out.push(`${x},${y}`)
  return out
}

export function applyFelled(map, keys) {
  for (const key of keys ?? []) {
    const [x, y] = key.split(',').map(Number)
    const cell = map[y]?.[x]
    const def = cell && TREES[cell.overlay]
    if (def) fell(map, x, y, def)
  }
}
