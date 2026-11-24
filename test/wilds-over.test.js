import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isStructure, isGate, openTops, clearOfTops } from '../renderer/wilds/over.js'
import { cellOf } from '../renderer/wilds/piece.js'
import { TILE } from '../renderer/systems/entities.js'

// A grid of game cells from rows of glyphs.
const LEGEND = {
  '.': () => cellOf('ow_grass_0', null, true),
  'R': () => cellOf('ow_grass_0', 'ow_roof_red_m', false),
  'W': () => cellOf('ow_grass_0', 'ow_house_wall_stone', false),
  'C': () => cellOf('ow_grass_0', 'ow_city_wall_top_10', false),
  'F': () => cellOf('ow_grass_0', 'ow_city_wall_lower_m', false),
  'T': () => cellOf('ow_grass_0', 'ow_tree_pine_trunk', false),
  '~': () => cellOf('ow_water_0', null, false),
  'S': () => cellOf('ow_grass_0', 'ow_stall_top', false),
  'P': () => cellOf('ow_grass_0', 'ow_prop_barrel_0', false),
  'G': () => cellOf('ow_city_pave_cobble_0', 'ow_city_gate_arch2_um', true),
  'X': () => cellOf('ow_city_pave_cobble_0', 'ow_city_castle_gate2_um', false),
  'N': () => ({ ...cellOf('ow_grass_0', 'ow_city_pennant_a', false), deco: 'ow_city_tower_round3_c01' }),
}
const grid = rows => rows.map(r => [...r].map(ch => LEGEND[ch]()))
const walk = c => c.tile === TILE.FLOOR
const shape = cells => cells.map(r => r.map(c => (c.over ? (walk(c) ? 'o' : 'x') : walk(c) ? '.' : '#')).join(''))

// every walkable cell reached from (x, y), 4-way
function flood(cells, x, y) {
  const seen = new Set(), stack = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop(), k = `${cx},${cy}`
    if (seen.has(k) || !cells[cy]?.[cx] || !walk(cells[cy][cx])) continue
    seen.add(k)
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  return seen
}

describe('what is a structure', () => {
  it('buildings and walls are, by name', () => {
    for (const n of ['ow_roof_red_m', 'ow_house_wall_stone', 'ow_city_wall_top_10', 'ow_city_tower_round3_c00', 'ow_city_church_ridge_l', 'ow_castle_parapet_m', 'ow_brick', 'ow_city_roof_dark_chim'])
      assert.ok(isStructure(n), n)
  })
  it('ground, stalls, props, trees and nothing are not', () => {
    for (const n of ['ow_city_pave_cobble_0', 'ow_city_stall_top_blue', 'ow_stall_top', 'ow_prop_city_lamp', 'ow_deco_city_crier_box', 'ow_tree_pine_top', 'ow_well_top', 'ow_cave_arch_0', 'ow_fence_l', 'ow_tent_00', null, undefined])
      assert.ok(!isStructure(n), String(n))
  })
  it('gate arches are gates', () => {
    assert.ok(isGate('ow_city_gate_arch2_um') && isGate('ow_city_gate_side_m') && isGate('ow_city_castle_gate2open_bm') && isGate('ow_city_castle_gate2_um'))
    assert.ok(!isGate('ow_city_wall_top_10') && !isGate(null))
  })
})

describe('opening the top row', () => {
  it('a house: its first row opens and keeps its art, the rest block', () => {
    const cells = grid(['.....', '.RRR.', '.RRR.', '.WWW.', '.....'])
    const res = openTops(cells)
    assert.deepEqual(shape(cells), ['.....', '.ooo.', '.###.', '.###.', '.....'])
    assert.equal(res.opened, 3)
    assert.equal(cells[1][2].overlay, 'ow_roof_red_m')
    assert.equal(cells[1][2].losClear, undefined)
  })
  it('opens one row only, however tall the building', () => {
    const cells = grid(['...', '.R.', '.R.', '.R.', '.W.', '.W.', '...'])
    openTops(cells)
    assert.deepEqual(shape(cells), ['...', '.o.', '.#.', '.#.', '.#.', '.#.', '...'])
  })
  it('a wall one row deep stays shut', () => {
    const cells = grid(['.....', 'CCCCC', '.....'])
    assert.equal(openTops(cells).opened, 0)
    assert.deepEqual(shape(cells), ['.....', '#####', '.....'])
  })
  it('a wall with a face: the walk opens, the face keeps the two sides apart', () => {
    const cells = grid(['.....', 'CCCCC', 'FFFFF', '.....'])
    openTops(cells)
    assert.deepEqual(shape(cells), ['.....', 'ooooo', '#####', '.....'])
    assert.ok(!flood(cells, 0, 0).has('0,3'))
  })
  it('art laid as deco under a see-through overlay counts', () => {
    const cells = grid(['...', '.N.', '.C.', '...'])
    openTops(cells)
    assert.deepEqual(shape(cells), ['...', '.o.', '.#.', '...'])
    assert.equal(cells[1][1].deco, 'ow_city_tower_round3_c01')
  })
  it('a tower standing in the water stays shut', () => {
    const cells = grid(['~~~~~', '~CCC~', '~CCC~', '~~~~~'])
    assert.equal(openTops(cells).opened, 0)
  })
  it('never joins two places that were apart', () => {
    // two wall runs meeting corner to corner: the west run's last cell has the
    // north side above it and the south side east of it
    const cells = grid([
      '......',
      '...CCC',
      '...FFF',
      'CCC...',
      'FFF...',
      '......',
    ])
    const before = flood(cells, 0, 0)
    assert.ok(!before.has('0,5'))
    openTops(cells)
    const after = flood(cells, 0, 0)
    assert.ok(!after.has('0,5') && !after.has('3,3'), 'the south side is still shut off')
    for (const k of after) { const [x, y] = k.split(',').map(Number); assert.ok(before.has(k) || cells[y][x].over, k) }
    assert.deepEqual(shape(cells), ['......', '...ooo', '...###', 'oo#...', '###...', '......'])
  })
  it('a house against the south side of a wall: the wall opens, the roof does not', () => {
    const cells = grid(['.....', 'CCCCC', '.RRR.', '.WWW.', '.....'])
    openTops(cells)
    assert.deepEqual(shape(cells), ['.....', '#ooo#', '.###.', '.###.', '.....'])
  })
  it('a tree north of one roof cell does not leave a blocked cell under the roof', () => {
    const cells = grid(['..T..', '.RRR.', '.WWW.', '.....'])
    openTops(cells)
    assert.deepEqual(shape(cells), ['..#..', '.ooo.', '.###.', '.....'])
  })
  it('trees, stalls and props never open', () => {
    const cells = grid(['.....', '.TSP.', '.TSP.', '.....'])
    assert.equal(openTops(cells).opened, 0)
  })
  it('the first and the last row never open', () => {
    const cells = grid(['RRR', 'RRR', 'WWW'])
    assert.equal(openTops(cells).opened, 0)
    const more = grid(['...', 'RRR', 'WWW'])
    openTops(more)
    assert.deepEqual(shape(more), ['...', 'ooo', '###'])
  })
  it('a gate is drawn over whoever passes, open or shut', () => {
    const cells = grid(['.....', 'CGGXC', 'FGGXF', '.....'])
    const res = openTops(cells)
    assert.deepEqual(shape(cells), ['.....', 'oooxo', '#oox#', '.....'])
    assert.equal(res.gates, 6)
    assert.equal(cells[1][3].tile, TILE.WALL)
  })
  it('wards what it opens where asked', () => {
    const cells = grid(['.....', '.RRR.', '.WWW.', '.....'])
    openTops(cells, { ward: x => x >= 2 })
    assert.deepEqual(cells[1].map(c => !!c.ward), [false, false, true, true, false])
  })
})

describe('clear of the tops', () => {
  it('a cell under a top gives the nearest open cell that is not', () => {
    const cells = grid(['.....', '.RRR.', '.RRR.', '.WWW.', '.....'])
    openTops(cells)
    assert.deepEqual(clearOfTops(cells, 2, 1), { x: 2, y: 0 })
    assert.deepEqual(clearOfTops(cells, 0, 0), { x: 0, y: 0 })
    assert.deepEqual(clearOfTops(cells, 9, 9), { x: 9, y: 9 })
  })
})
