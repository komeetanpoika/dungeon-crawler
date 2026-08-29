import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TREES, STUMP, resolveTree, findTreeHit, chopTree, applyFelled, felledCells } from '../renderer/systems/lumber.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

// 7x7 all-floor map; callers stamp trees.
function grass() {
  const m = createMap(7, 7)
  for (const row of m) for (const c of row) { c.tile = TILE.FLOOR; c.skin = 'ow_grass_0' }
  return m
}
function tree(m, x, y, overlay) { m[y][x].tile = TILE.WALL; m[y][x].overlay = overlay; m[y][x].losSoft = true }
function pine(m, x, y) { tree(m, x, y, 'ow_tree_pine_trunk'); tree(m, x, y - 1, 'ow_tree_pine_top') }
const player = (x, y) => ({ x, y, px: x * 32 + 16, py: y * 32 + 16 })
const anyHit = () => true

describe('tree table', () => {
  it('lists every overworld tree overlay with hp and yield', () => {
    assert.deepEqual(TREES.ow_tree_small, { hp: 3, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_tree_apple, { hp: 3, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_tree_small_autumn, { hp: 3, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_deadtree_0, { hp: 2, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_deadtree_1, { hp: 2, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_tree_pine_trunk, { hp: 4, yield: 2, cells: 2 })
    assert.deepEqual(TREES.ow_tree_autumn_trunk, { hp: 4, yield: 2, cells: 2 })
    assert.deepEqual(TREES.ow_tree_autumn_top, { hp: 3, yield: 1, cells: 1 })
    assert.equal(TREES.ow_tree_pine_top, undefined)
    assert.equal(TREES.ow_bush_0, undefined)
  })
})

describe('resolveTree', () => {
  it('a trunk resolves to itself', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    assert.deepEqual(resolveTree(m, 3, 3), { x: 3, y: 3, def: TREES.ow_tree_small })
  })
  it('a pine top resolves to the trunk below it', () => {
    const m = grass(); pine(m, 3, 3)
    assert.deepEqual(resolveTree(m, 3, 2), { x: 3, y: 3, def: TREES.ow_tree_pine_trunk })
  })
  it('a standalone autumn top is its own small tree', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_autumn_top')
    assert.deepEqual(resolveTree(m, 3, 3), { x: 3, y: 3, def: TREES.ow_tree_autumn_top })
  })
  it('an autumn top above an autumn trunk is that tree\'s canopy', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_autumn_trunk'); tree(m, 3, 2, 'ow_tree_autumn_top')
    assert.deepEqual(resolveTree(m, 3, 2), { x: 3, y: 3, def: TREES.ow_tree_autumn_trunk })
  })
  it('an orphan top, bushes, rocks and grass are not trees', () => {
    const m = grass(); tree(m, 3, 2, 'ow_tree_pine_top'); tree(m, 5, 5, 'ow_bush_0')
    assert.equal(resolveTree(m, 3, 2), null)
    assert.equal(resolveTree(m, 5, 5), null)
    assert.equal(resolveTree(m, 1, 1), null)
    assert.equal(resolveTree(m, -1, 0), null)
  })
})

describe('findTreeHit', () => {
  it('returns the nearest trunk whose centre is inside the wedge', () => {
    const m = grass(); tree(m, 4, 3, 'ow_tree_small'); tree(m, 5, 3, 'ow_tree_small')
    const p = player(3, 3)
    const east = (dx, dy) => dx > 0 && Math.abs(dy) < 16   // a narrow eastward wedge
    assert.deepEqual(findTreeHit(m, p, east, 46), { x: 4, y: 3 })
  })
  it('ignores trees outside the wedge', () => {
    const m = grass(); tree(m, 2, 3, 'ow_tree_small')
    const east = (dx, dy) => dx > 0 && Math.abs(dy) < 16
    assert.equal(findTreeHit(m, player(3, 3), east, 46), null)
  })
  it('a swing that catches only a pine top still chops the trunk', () => {
    const m = grass(); pine(m, 3, 3)   // trunk at (3,3), top at (3,2)
    const p = player(3, 1)             // standing north of the top
    const south = (dx, dy) => dy > 0 && Math.abs(dx) < 16
    assert.deepEqual(findTreeHit(m, p, south, 46), { x: 3, y: 3 })
  })
  it('never looks beyond the reach', () => {
    const m = grass(); tree(m, 6, 3, 'ow_tree_small')
    assert.equal(findTreeHit(m, player(1, 3), anyHit, 34), null)
  })
})

describe('chopTree', () => {
  it('needs hp hits; the overlay stays the plain tree until it falls', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: false, yield: 0 })
    assert.equal(m[3][3].overlay, 'ow_tree_small')
    assert.equal(m[3][3].tile, TILE.WALL)
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: false, yield: 0 })
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: true, yield: 1 })
    assert.equal(m[3][3].tile, TILE.FLOOR)
    assert.equal(m[3][3].overlay, STUMP)
    assert.equal(m[3][3].losSoft, undefined)
    assert.equal(m[3][3].chopHp, undefined)
  })
  it('the axe fells a dead tree in one blow', () => {
    const m = grass(); tree(m, 3, 3, 'ow_deadtree_1')
    assert.deepEqual(chopTree(m, 3, 3, 2), { felled: true, yield: 1 })
  })
  it('a felled pine clears its top as well and yields two', () => {
    const m = grass(); pine(m, 3, 3)
    assert.deepEqual(chopTree(m, 3, 3, 4), { felled: true, yield: 2 })
    assert.equal(m[3][3].overlay, STUMP)
    assert.equal(m[2][3].tile, TILE.FLOOR)
    assert.equal(m[2][3].overlay, null)
    assert.equal(m[2][3].losSoft, undefined)
  })
  it('a standalone autumn top falls in three hits', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_autumn_top')
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: false, yield: 0 })
    assert.deepEqual(chopTree(m, 3, 3, 2), { felled: true, yield: 1 })
    assert.equal(m[3][3].overlay, STUMP)
    assert.equal(m[3][3].tile, TILE.FLOOR)
  })
  it('a canopy over a trunk is not its own address', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_autumn_trunk'); tree(m, 3, 2, 'ow_tree_autumn_top')
    assert.deepEqual(chopTree(m, 3, 2, 9), { felled: false, yield: 0 })
    assert.equal(m[2][3].overlay, 'ow_tree_autumn_top')
    assert.equal(m[3][3].overlay, 'ow_tree_autumn_trunk')
    assert.equal(m[3][3].chopHp, undefined)
  })
  it('a stump or a non-tree cannot be chopped', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    chopTree(m, 3, 3, 3)
    assert.deepEqual(chopTree(m, 3, 3, 3), { felled: false, yield: 0 })
    assert.deepEqual(chopTree(m, 1, 1, 3), { felled: false, yield: 0 })
  })
})

describe('felled record', () => {
  it('felledCells lists stumps as "x,y" and applyFelled restores them idempotently', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small'); pine(m, 5, 4)
    chopTree(m, 3, 3, 3); chopTree(m, 5, 4, 4)
    assert.deepEqual(felledCells(m).sort(), ['3,3', '5,4'])
    const fresh = grass(); tree(fresh, 3, 3, 'ow_tree_small'); pine(fresh, 5, 4)
    applyFelled(fresh, ['3,3', '5,4', '9,9', '1,1'])   // out-of-range and non-tree keys are ignored
    assert.equal(fresh[3][3].overlay, STUMP)
    assert.equal(fresh[4][5].overlay, STUMP)
    assert.equal(fresh[3][5].tile, TILE.FLOOR)
    applyFelled(fresh, ['3,3'])
    assert.equal(fresh[3][3].overlay, STUMP)
    assert.deepEqual(felledCells(fresh).sort(), ['3,3', '5,4'])
  })
})

// The border of an open map is forced to WALL because the camera is
// unbounded (systems/openmap.js) — felling a border tree would punch a
// walkable hole into the void, so border cells are never trees.
describe('border trees', () => {
  it('a tree stamped on the border is not a tree at all', () => {
    const m = grass(); tree(m, 0, 3, 'ow_tree_small'); tree(m, 3, 0, 'ow_tree_small')
    assert.equal(resolveTree(m, 0, 3), null)
    assert.equal(resolveTree(m, 3, 0), null)
    assert.deepEqual(chopTree(m, 0, 3, 9), { felled: false, yield: 0 })
    assert.deepEqual(chopTree(m, 3, 0, 9), { felled: false, yield: 0 })
    assert.equal(m[3][0].tile, TILE.WALL)
    assert.equal(m[3][0].overlay, 'ow_tree_small')
    assert.equal(m[0][3].tile, TILE.WALL)
    assert.equal(m[0][3].overlay, 'ow_tree_small')
  })
  it('a border key in the felled record is ignored', () => {
    const m = grass(); tree(m, 0, 3, 'ow_tree_small')
    applyFelled(m, ['0,3'])
    assert.equal(m[3][0].tile, TILE.WALL)
    assert.equal(m[3][0].overlay, 'ow_tree_small')
  })
  it('a swing never finds a border tree', () => {
    const m = grass(); tree(m, 0, 3, 'ow_tree_small')
    const west = (dx, dy) => dx < 0 && Math.abs(dy) < 16
    assert.equal(findTreeHit(m, player(1, 3), west, 46), null)
  })
})

describe('applyFelled robustness', () => {
  it('ignores keys that are not strings', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    assert.doesNotThrow(() => applyFelled(m, [null, { x: 1 }, 3]))
    assert.equal(m[3][3].overlay, 'ow_tree_small')
    assert.deepEqual(felledCells(m), [])
  })
})
