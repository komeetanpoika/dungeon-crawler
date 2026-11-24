import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isStructure, isGate, isTop, openTops, clearOfTops } from '../renderer/wilds/over.js'
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

describe('gates', () => {
  it('a tower south of a gate down the wall line keeps its cap shut: no way round the gate', () => {
    // a side gate: three cells down a north-south wall, a tower's cap row under it
    const cells = grid([
      '...C...',
      '...G...',
      '...G...',
      '...G...',
      '..CCC..',
      '..CCC..',
      '...C...',
    ])
    openTops(cells)
    assert.deepEqual(shape(cells).slice(4), ['..o#o..', '..###..', '...#...'])
    // with the gate shut, west and east are apart
    for (const y of [1, 2, 3]) cells[y][3].tile = TILE.WALL
    assert.ok(!flood(cells, 0, 3).has('6,3'))
  })
  it('regions are counted with the gates shut: a walk that would join inside and outside stays shut', () => {
    // outside north, inside south, joined only by the gate at the east end;
    // the west run's last cell has outside above it and inside east of it
    const cells = grid([
      '.......',
      '...CCCG',
      '...FFFG',
      'CCC....',
      'FFF....',
      '.......',
    ])
    openTops(cells)
    assert.deepEqual(shape(cells), ['.......', '...oooo', '...###o', 'oo#....', '###....', '.......'])
    for (const row of cells) for (const c of row) if (isGate(c.overlay)) c.tile = TILE.WALL
    const out = flood(cells, 0, 0)
    assert.ok(!out.has('0,5') && !out.has('3,3'), 'no way in but the gate')
  })
})

describe('clear of the tops', () => {
  it('goes by foot, not as the crow flies: never to the far side of the building', () => {
    // a top whose north is a tree: the nearest open cell by distance is south of the house
    const cells = grid(['TTTTT', 'TRRRT', '.WWW.', '.....'])
    for (const c of cells[1]) if (c.overlay === 'ow_roof_red_m') { c.tile = TILE.FLOOR; c.over = true }
    assert.deepEqual(clearOfTops(cells, 2, 1), { x: 2, y: 1 }, 'nowhere to go on foot: it stays')
    cells[1][0] = LEGEND['.']()
    assert.deepEqual(clearOfTops(cells, 2, 1), { x: 0, y: 1 })
  })
  it('a cell under a top gives the nearest open cell that is not', () => {
    const cells = grid(['.....', '.RRR.', '.RRR.', '.WWW.', '.....'])
    openTops(cells)
    assert.deepEqual(clearOfTops(cells, 2, 1), { x: 2, y: 0 })
    assert.deepEqual(clearOfTops(cells, 0, 0), { x: 0, y: 0 })
    assert.deepEqual(clearOfTops(cells, 9, 9), { x: 9, y: 9 })
  })
})

// ---- the real generators ---------------------------------------------------------
import { generatePiece } from '../renderer/wilds/piece.js'
import { setOpenTops } from '../renderer/wilds/over.js'
import { buildCity } from '../renderer/wilds/city/build.js'
import { insideWalls, PLAN } from '../renderer/wilds/city/plan.js'
import { isCityPiece } from '../renderer/wilds/city/geometry.js'
import { GATE, CASTLE } from '../renderer/wilds/city/kit.js'

const without = fn => { setOpenTops(false); try { return fn() } finally { setOpenTops(true) } }
const floodAll = (cells, from, pass) => {
  const H = cells.length, W = cells[0].length, seen = new Uint8Array(W * H), stack = [from.y * W + from.x]
  if (!pass(cells[from.y][from.x])) return seen
  seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const k = ny * W + nx
      if (!seen[k] && pass(cells[ny][nx])) { seen[k] = 1; stack.push(k) }
    }
  }
  return seen
}

describe('the pieces of the Wilds', () => {
  const spots = []
  for (const seed of [1, 7, 4242]) for (let wy = -2; wy <= 2; wy++) for (let wx = -2; wx <= 2; wx++)
    if (!isCityPiece(wx, wy)) spots.push({ seed, wx, wy })

  it('a top opens only over more of its building, and joins nothing', () => {
    let opened = 0
    for (const { seed, wx, wy } of spots) {
      const piece = generatePiece(seed, wx, wy)
      const cells = piece.cells, W = cells[0].length
      const old = floodAll(cells, piece.spawnPoint, c => c.tile === TILE.FLOOR && !c.over)
      const now = floodAll(cells, piece.spawnPoint, c => c.tile === TILE.FLOOR)
      for (let y = 0; y < cells.length; y++) for (let x = 0; x < W; x++) {
        const c = cells[y][x]
        if (c.over) {
          opened++
          assert.ok(cells[y + 1][x].tile === TILE.WALL, `${seed} ${piece.key} ${x},${y}: something solid south of a top`)
          assert.ok(isStructure(c.overlay) || isStructure(c.deco), `${seed} ${piece.key} ${x},${y}: ${c.overlay}`)
        } else if (now[y * W + x]) assert.ok(old[y * W + x] === 1, `${seed} ${piece.key} ${x},${y} became reachable`)
      }
    }
    assert.ok(opened > 100, `tops opened: ${opened}`)
  })

  it('the home village has roofs to walk under', () => {
    const piece = generatePiece(7, 0, 0)
    assert.ok(piece.cells.flat().filter(c => c.over).length >= 6)
  })

  it('places everything where it did before', () => {
    for (const { seed, wx, wy } of spots.filter((_, i) => i % 3 === 0)) {
      const a = generatePiece(seed, wx, wy), b = without(() => generatePiece(seed, wx, wy))
      for (const k of ['spawns', 'doors', 'caves', 'packs', 'points', 'signs', 'spawnPoint', 'gates'])
        assert.ok(JSON.stringify(a[k]) === JSON.stringify(b[k]), `${seed} ${a.key}: ${k} differ`)
      // and no cell differs but the opened ones
      for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
        const ca = a.cells[y][x], cb = b.cells[y][x]
        assert.ok(ca.skin === cb.skin && ca.overlay === cb.overlay, `${seed} ${a.key} ${x},${y}: art`)
        if (!ca.over) assert.ok(ca.tile === cb.tile, `${seed} ${a.key} ${x},${y}: tile`)
      }
    }
  })
})

describe('Kalevanlinna', () => {
  const city = buildCity(7), plain = without(() => buildCity(7))
  buildCity(7)   // (leave the kept city the real one)
  const N = city.cells.length

  it('opens the top of its walls and houses', () => {
    const over = city.cells.flat().filter(c => c.over).length
    assert.ok(over > 300, `over cells: ${over}`)
  })

  it('every gate arch is walked under', () => {
    const names = new Set([...GATE.arch2.flat(), ...GATE.arch3.flat(), ...GATE.side, ...CASTLE.gate2Open.flat(), ...CASTLE.gate2.flat()])
    let gates = 0
    for (const row of city.cells) for (const c of row) if (names.has(c.overlay)) { gates++; assert.ok(c.over === true) }
    assert.ok(gates >= 6 * 2 + 3 * 2 + 6, `gate cells: ${gates}`)
  })

  it('wards what it opens inside the walls', () => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = city.cells[y][x]
      if (c.over && c.tile === TILE.FLOOR && insideWalls(x, y)) assert.ok(c.ward === true, `${x},${y}`)
    }
  })

  it('keeps monsters out as before: no way in that is not warded', () => {
    const from = { x: PLAN.gates.N.x, y: 2 }
    assert.ok(city.cells[from.y][from.x].tile === TILE.FLOOR && !city.cells[from.y][from.x].ward)
    const seen = floodAll(city.cells, from, c => c.tile === TILE.FLOOR && !c.ward)
    const was = floodAll(plain.cells, from, c => c.tile === TILE.FLOOR && !c.ward)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!seen[y * N + x]) continue
      assert.ok(!insideWalls(x, y), `${x},${y} is inside the walls`)
      assert.ok(was[y * N + x] === 1 || city.cells[y][x].over, `${x},${y} became reachable from outside`)
    }
  })

  it('with its gates shut, there is no way through the wall', () => {
    const shut = c => c.tile === TILE.FLOOR && !isGate(c.overlay) && !isGate(c.deco)
    const from = { x: PLAN.gates.N.x, y: 2 }
    const seen = floodAll(city.cells, from, shut)
    let outside = 0
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!seen[y * N + x]) continue
      outside++
      assert.ok(!insideWalls(x, y), `${x},${y} is inside the walls`)
    }
    assert.ok(outside > 3000, `the country round the town: ${outside} cells`)
    // and the patrols' side cells are not under a roof (runtime.js steps the partner one to the right)
    assert.ok(city.cells.flat().some(c => isTop(c)) && city.cells.flat().filter(c => c.over && !isTop(c)).length >= 24)
  })

  it('joins nothing on foot either, and lays the same doors, spots and streets', () => {
    const from = city.inn.doorstep
    const now = floodAll(city.cells, from, c => c.tile === TILE.FLOOR)
    const was = floodAll(plain.cells, from, c => c.tile === TILE.FLOOR)
    for (let i = 0; i < N * N; i++) if (now[i] && !was[i]) assert.ok(city.cells[(i / N) | 0][i % N].over, `${i % N},${(i / N) | 0} became reachable`)
    for (const k of ['doors', 'signs', 'lamps', 'chimneys', 'windows', 'spots', 'inn', 'spawns', 'yards'])
      assert.ok(JSON.stringify(city[k]) === JSON.stringify(plain[k]), `${k} differ`)
    assert.ok(JSON.stringify(city.streets) === JSON.stringify(plain.streets), 'the street graph differs')
  })
})
