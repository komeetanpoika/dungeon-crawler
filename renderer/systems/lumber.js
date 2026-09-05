// Harvestables and lumber: which overlay art is a choppable tree or minable
// rock, which cell a swing lands on, and what harvesting leaves behind. Pure
// map mutation — game.js spawns the lumber pickup, plays the cues and
// persists the record.
//
// Chop/mine damage lives in cell.chopHp and is deliberately invisible: the
// overlay stays the plain tree/rock until the cell is cleared (no bar, no
// number). Per-damage art may come later.
import { TILE } from './entities.js'
import { markTileDirty } from './tile-dirty.js'

export const STUMP = 'ow_stump'
const TILE_SIZE = 32

// Keyed by the overlay buildOpenMap stamps on the blocking cell. Two-cell
// trees are addressed by the trunk; the `_top` overlay sits at y-1.
export const TREES = {
  ow_tree_small:        { hp: 3, yield: 1, cells: 1 },
  ow_tree_small_autumn: { hp: 3, yield: 1, cells: 1 },
  ow_tree_apple:        { hp: 3, yield: 1, cells: 1 },
  ow_deadtree_0:        { hp: 2, yield: 1, cells: 1, drop: 'deadwood' },
  ow_deadtree_1:        { hp: 2, yield: 1, cells: 1, drop: 'deadwood' },
  ow_tree_pine_trunk:   { hp: 4, yield: 2, cells: 2 },
  ow_tree_autumn_trunk: { hp: 4, yield: 2, cells: 2 },
  // The autumn canopy art does double duty: gen-forest.mjs stamps it both as
  // the top of the tall autumn pair and, far more often, as a standalone
  // small tree. Standing alone it is a tree in its own right; sitting on an
  // autumn trunk it is that trunk's canopy (resolveTree checks that first).
  ow_tree_autumn_top:   { hp: 3, yield: 1, cells: 1 },
}

// Rocks that a pick can mine: three blows, no lumber, the cell clears to
// plain floor (no stump-equivalent art — just walkable ground).
const ROCKS = {
  ow_rock_gray_0:        { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_gray_1:        { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_gray_2:        { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_gray_moss_0:   { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_gray_moss_1:   { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_gray_moss_2:   { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_brown_0:       { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_brown_1:       { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_brown_2:       { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_brown_moss_0:  { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_brown_moss_1:  { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  ow_rock_brown_moss_2:  { hp: 3, yield: 0, cells: 1, tool: 'mine' },
  // the Mountain Pass boulders (ow_mtn_rock_N) mine the same way
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`ow_mtn_rock_${i}`, { hp: 3, yield: 0, cells: 1, tool: 'mine' }])),
}

// The full harvestable table: every tree tagged `tool: 'chop'`, plus rocks.
export const HARVEST = {
  ...Object.fromEntries(Object.entries(TREES).map(([k, v]) => [k, { ...v, tool: 'chop' }])),
  ...ROCKS,
}

const isTop = overlay => typeof overlay === 'string' && overlay.endsWith('_top')

// The harvest def of a cell, or undefined. Border cells never count: openmap
// forces the map edge to WALL because the camera is unbounded, so clearing
// one would punch a walkable hole into the void.
function harvestAt(map, x, y) {
  if (!(y > 0 && y < map.length - 1)) return undefined
  if (!(x > 0 && x < map[y].length - 1)) return undefined
  return HARVEST[map[y][x].overlay]
}

// The harvestable a cell belongs to: a canopy over a two-cell trunk resolves
// to that trunk, anything else harvestable resolves to itself. Null
// otherwise (an orphan pine top is scenery).
export function resolveHarvest(map, x, y) {
  if (!map[y]?.[x]) return null
  if (isTop(map[y][x].overlay)) {
    const tdef = harvestAt(map, x, y + 1)
    if (tdef && tdef.cells === 2) return { x, y: y + 1, def: tdef }
  }
  const def = harvestAt(map, x, y)
  return def ? { x, y, def } : null
}

// Thin wrapper: trees only, returning the original TREES def (no `tool`
// field) so callers/tests keyed on that exact shape are unaffected.
export function resolveTree(map, x, y) {
  const r = resolveHarvest(map, x, y)
  if (!r || r.def.tool !== 'chop') return null
  return { x: r.x, y: r.y, def: TREES[map[r.y][r.x].overlay] }
}

// Nearest harvestable trunk/rock whose cell centre lies inside the swing
// wedge — hitAt(dx, dy) is the same test the entity hit uses. Only defs
// whose tool the weapon carries are considered. One harvestable per swing.
export function findHarvestHit(map, player, hitAt, reachPx, weapon) {
  const r = Math.ceil(reachPx / TILE_SIZE) + 1
  let best = null, bestD = Infinity
  for (let y = player.y - r; y <= player.y + r; y++) for (let x = player.x - r; x <= player.x + r; x++) {
    const t = resolveHarvest(map, x, y)
    if (!t || !weapon?.[t.def.tool]) continue
    const dx = x * TILE_SIZE + TILE_SIZE / 2 - player.px
    const dy = y * TILE_SIZE + TILE_SIZE / 2 - player.py
    if (Math.hypot(dx, dy) > reachPx + TILE_SIZE / 2) continue
    if (!hitAt(dx, dy)) continue
    const d = Math.hypot(t.x * TILE_SIZE + TILE_SIZE / 2 - player.px, t.y * TILE_SIZE + TILE_SIZE / 2 - player.py)
    if (d < bestD) { bestD = d; best = { x: t.x, y: t.y } }
  }
  return best
}

// Thin wrapper: chop-only, same shape as before.
export function findTreeHit(map, player, hitAt, reachPx) {
  return findHarvestHit(map, player, hitAt, reachPx, { chop: 1 })
}

function fell(map, x, y, def) {
  const cell = map[y][x]
  cell.tile = TILE.FLOOR
  cell.overlay = STUMP
  delete cell.losSoft
  delete cell.chopHp
  markTileDirty(map, x, y)
  if (def.cells === 2) {
    const top = map[y - 1]?.[x]
    if (top && isTop(top.overlay)) {
      top.tile = TILE.FLOOR
      top.overlay = null
      delete top.losSoft
      markTileDirty(map, x, y - 1)
    }
  }
}

function clearRock(map, x, y) {
  const cell = map[y][x]
  cell.tile = TILE.FLOOR
  cell.overlay = null
  cell.cleared = 'rock'
  delete cell.losSoft
  delete cell.chopHp
  markTileDirty(map, x, y)
}

// Deal `weapon[def.tool]` to the harvestable addressed at (x, y). Felled
// trees become walkable stumps; cleared rocks become plain floor. Only the
// harvestable's own cell is an address: a canopy that resolves to the trunk
// below it is refused, so damage always lands in one place. A tool the
// weapon doesn't carry deals no damage.
export function harvest(map, x, y, weapon) {
  const t = resolveHarvest(map, x, y)
  if (!t || t.x !== x || t.y !== y) return { felled: false, yield: 0, kind: null, drop: null }
  const { def } = t
  const power = weapon?.[def.tool]
  if (!power) return { felled: false, yield: 0, kind: null, drop: null }
  const kind = def.tool === 'chop' ? 'tree' : 'rock'
  const cell = map[y][x]
  cell.chopHp = (cell.chopHp ?? def.hp) - power
  if (cell.chopHp > 0) return { felled: false, yield: 0, kind, drop: null }
  if (def.tool === 'chop') fell(map, x, y, def)
  else clearRock(map, x, y)
  return { felled: true, yield: def.yield, kind, drop: def.drop ?? 'lumber' }
}

// Thin wrapper: trees only, same shape as before.
export function chopTree(map, x, y, chop) {
  const r = harvest(map, x, y, { chop })
  return { felled: r.felled, yield: r.yield }
}

// Save-record helpers: stumps and cleared rocks as "x,y" keys, and their
// re-application on a freshly built map (unknown or already-cleared keys
// are ignored).
export function felledCells(map) {
  const out = []
  for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++)
    if (map[y][x].overlay === STUMP || map[y][x].cleared === 'rock') out.push(`${x},${y}`)
  return out
}

export function applyFelled(map, keys) {
  for (const key of keys ?? []) {
    if (typeof key !== 'string') continue
    const [x, y] = key.split(',').map(Number)
    const def = map[y]?.[x] && harvestAt(map, x, y)
    if (!def) continue
    if (def.tool === 'chop') fell(map, x, y, def)
    else clearRock(map, x, y)
  }
}
