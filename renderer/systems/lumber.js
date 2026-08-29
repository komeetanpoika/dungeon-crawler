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
  // The autumn canopy art does double duty: gen-forest.mjs stamps it both as
  // the top of the tall autumn pair and, far more often, as a standalone
  // small tree. Standing alone it is a tree in its own right; sitting on an
  // autumn trunk it is that trunk's canopy (resolveTree checks that first).
  ow_tree_autumn_top:   { hp: 3, yield: 1, cells: 1 },
}

const isTop = overlay => typeof overlay === 'string' && overlay.endsWith('_top')

// The tree def of a cell, or undefined. Border cells never count: openmap
// forces the map edge to WALL because the camera is unbounded, so felling
// one would punch a walkable hole into the void.
function treeAt(map, x, y) {
  if (!(y > 0 && y < map.length - 1)) return undefined
  if (!(x > 0 && x < map[y].length - 1)) return undefined
  return TREES[map[y][x].overlay]
}

// The tree a cell belongs to: a canopy over a two-cell trunk resolves to
// that trunk, anything else that is a tree resolves to itself. Null
// otherwise (an orphan pine top is scenery).
export function resolveTree(map, x, y) {
  if (!map[y]?.[x]) return null
  if (isTop(map[y][x].overlay)) {
    const tdef = treeAt(map, x, y + 1)
    if (tdef && tdef.cells === 2) return { x, y: y + 1, def: tdef }
  }
  const def = treeAt(map, x, y)
  return def ? { x, y, def } : null
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
  delete cell.losSoft
  delete cell.chopHp
  if (def.cells === 2) {
    const top = map[y - 1]?.[x]
    if (top && isTop(top.overlay)) {
      top.tile = TILE.FLOOR
      top.overlay = null
      delete top.losSoft
    }
  }
}

// Deal `chop` to the tree addressed at (x, y). Felled trees become walkable
// stumps. Only the tree's own cell is an address: a canopy that resolves to
// the trunk below it is refused, so damage always lands in one place.
export function chopTree(map, x, y, chop) {
  const t = resolveTree(map, x, y)
  if (!t || t.x !== x || t.y !== y) return { felled: false, yield: 0 }
  const { def } = t
  const cell = map[y][x]
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
    if (typeof key !== 'string') continue
    const [x, y] = key.split(',').map(Number)
    const def = map[y]?.[x] && treeAt(map, x, y)
    if (def) fell(map, x, y, def)
  }
}
