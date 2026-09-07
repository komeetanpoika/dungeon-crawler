import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MapBuilder, shoreline, pierOverWater, carveDirtToGrass, WATER_SKINS } from '../tools/static-overworld/lib.mjs'
import { stampMass, pruneStrayGround, isMassSkin } from '../tools/static-overworld/mountain.mjs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

const ground = (b, x, y) => b.palette[b.ground[y][x]]
const prop = (b, x, y) => (b.prop[y][x] >= 0 ? b.palette[b.prop[y][x]] : null)

// 9x7 grass map with a 3-wide vertical river at x 3..5 and a log bridge laid
// the old way — pier logs painted as GROUND from x 2..6 on row 3, two cells
// of it on the banks.
function riverWithGroundBridge() {
  const b = new MapBuilder('t', 'forest', 't', 9, 7)
  for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) b.g(x, y, 'ow_grass_0')
  for (let y = 0; y < 7; y++) for (let x = 3; x <= 5; x++) { b.g(x, y, 'ow_water_0'); b.block(x, y) }
  for (let x = 2; x <= 6; x++) { b.g(x, 3, 'ow_pier_log'); b.unblock(x, 3) }
  b.p(1, 1, 'ow_pier_log')   // a log pile on the grass: a prop, not a bridge
  return b
}

describe('pierOverWater', () => {
  it('turns ground pier logs into a pier overlay over water, the bank ends back to grass', () => {
    const b = riverWithGroundBridge()
    assert.equal(pierOverWater(b), 5)
    for (let x = 3; x <= 5; x++) {
      assert.ok(WATER_SKINS.includes(ground(b, x, 3)), `water under the pier at ${x}`)
      assert.equal(prop(b, x, 3), 'ow_pier_log')
      assert.equal(b.walkable(x, 3), true)
    }
    for (const x of [2, 6]) {
      assert.equal(ground(b, x, 3), 'ow_grass_0')
      assert.equal(prop(b, x, 3), 'ow_pier_log')
      assert.equal(b.walkable(x, 3), true)
    }
  })
  it('leaves pier props alone and is idempotent', () => {
    const b = riverWithGroundBridge()
    pierOverWater(b)
    assert.equal(prop(b, 1, 1), 'ow_pier_log')
    assert.equal(ground(b, 1, 1), 'ow_grass_0')
    assert.equal(pierOverWater(b), 0)
  })
  it('shoreline then rims the bank cells under the logs like any other water', () => {
    const b = riverWithGroundBridge()
    pierOverWater(b); shoreline(b)
    assert.equal(ground(b, 3, 3), 'ow_pond_01')
    assert.equal(ground(b, 5, 3), 'ow_pond_21')
    assert.ok(WATER_SKINS.includes(ground(b, 4, 3)))
    assert.equal(prop(b, 4, 3), 'ow_pier_log')
  })
})

describe('carveDirtToGrass', () => {
  it('repaints small dirt components (reachability carves) as grass and keeps long trails', () => {
    const b = new MapBuilder('t', 'forest', 't', 12, 6)
    for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) b.g(x, y, 'ow_grass_1')
    b.g(2, 2, 'ow_dirt_0')                                      // a lone carve stamp
    b.g(5, 4, 'ow_dirt_2'); b.g(6, 4, 'ow_dirt_0')              // a two-cell carve
    for (let x = 1; x <= 10; x++) b.g(x, 0, 'ow_dirt_1')        // a ten-cell trail
    assert.equal(carveDirtToGrass(b), 3)
    assert.equal(ground(b, 2, 2), 'ow_grass_0')
    assert.equal(ground(b, 5, 4), 'ow_grass_0')
    assert.equal(ground(b, 6, 4), 'ow_grass_0')
    for (let x = 1; x <= 10; x++) assert.equal(ground(b, x, 0), 'ow_dirt_1')
    assert.equal(ground(b, 3, 3), 'ow_grass_1')                 // untouched grass keeps its variant
  })
  it('never changes walkability or props', () => {
    const b = new MapBuilder('t', 'forest', 't', 5, 5)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) b.g(x, y, 'ow_grass_0')
    b.g(2, 2, 'ow_dirt_0'); b.p(2, 2, 'tile_0089', { walkable: true })
    b.g(3, 2, 'ow_dirt_0'); b.block(3, 2)
    carveDirtToGrass(b)
    assert.equal(prop(b, 2, 2), 'tile_0089')
    assert.equal(b.walkable(2, 2), true)
    assert.equal(b.walkable(3, 2), false)
  })
})

describe('pruneStrayGround', () => {
  const rng = () => 0.5
  function grassWithPatches() {
    const b = new MapBuilder('t', 'forest', 't', 14, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) b.g(x, y, 'ow_grass_0')
    // a mass with its foot of mountain ground: stays
    stampMass(b, rng, 2, 2); b.g(2, 3, 'ow_mtn_ground_0'); b.g(3, 3, 'ow_mtn_ground_1')
    // a stray strip in the grass with trees on it: goes
    for (let x = 6; x <= 9; x++) b.g(x, 5, 'ow_mtn_ground_2')
    b.p(7, 5, 'ow_tree_small_autumn')
    // a yard with a house on it: stays
    for (let y = 1; y <= 3; y++) for (let x = 10; x <= 12; x++) b.g(x, y, 'ow_mtn_ground_3')
    b.p(11, 2, 'ow_house_door_brown')
    return b
  }
  it('repaints mountain ground that touches no mass and holds no building', () => {
    const b = grassWithPatches()
    assert.equal(pruneStrayGround(b), 4)
    for (let x = 6; x <= 9; x++) assert.equal(ground(b, x, 5), 'ow_grass_0')
    assert.equal(prop(b, 7, 5), 'ow_tree_small_autumn')
    assert.equal(ground(b, 2, 3), 'ow_mtn_ground_0')
    assert.equal(ground(b, 3, 3), 'ow_mtn_ground_1')
    assert.ok(isMassSkin(prop(b, 2, 2)))
    for (let y = 1; y <= 3; y++) for (let x = 10; x <= 12; x++) assert.equal(ground(b, x, y), 'ow_mtn_ground_3')
  })
})

// The two Adventure maps this pass healed: River Split (11) and the
// Mountain Pass (12). Guards on the shipped data so the defects cannot
// creep back through a regeneration or an editor round-trip.
describe('shipped River Split and Mountain Pass', () => {
  const maps = [OPEN_MAPS[11], OPEN_MAPS[12]]
  const skin = (m, l, x, y) => (m[l][y]?.[x] >= 0 ? m.palette[m[l][y][x]] : null)
  const components = (m, pred) => {
    const seen = new Set(), out = []
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!pred(x, y) || seen.has(y * m.w + x)) continue
      const comp = [], stack = [[x, y]]; seen.add(y * m.w + x)
      while (stack.length) {
        const [cx, cy] = stack.pop(); comp.push([cx, cy])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || seen.has(ny * m.w + nx) || !pred(nx, ny)) continue
          seen.add(ny * m.w + nx); stack.push([nx, ny])
        }
      }
      out.push(comp)
    }
    return out
  }
  it('lay every log bridge as a pier overlay over water — never as bare pier ground', () => {
    for (const m of maps) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++)
      assert.notEqual(skin(m, 'ground', x, y), 'ow_pier_log', `${m.name}: pier ground at ${x},${y}`)
  })
  it('a pier over the river always has water or a bank beneath it', () => {
    for (const m of maps) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (skin(m, 'prop', x, y) !== 'ow_pier_log' || m.walk[y][x] !== '1') continue
      const g = skin(m, 'ground', x, y)
      assert.ok(g.startsWith('ow_water') || g.startsWith('ow_pond_') || g.startsWith('ow_grass'), `${m.name}: pier at ${x},${y} over ${g}`)
    }
  })
  it('carry no dirt carve stamps: every dirt patch is a trail of eight cells or more', () => {
    for (const m of maps)
      for (const comp of components(m, (x, y) => skin(m, 'ground', x, y)?.startsWith('ow_dirt')))
        assert.ok(comp.length >= 8, `${m.name}: ${comp.length}-cell dirt patch at ${comp[0]}`)
  })
  it('keep mountain ground at the foot of a mass or in a yard, never adrift in the woods', () => {
    const m = OPEN_MAPS[12]
    const anchored = (x, y) => { const p = skin(m, 'prop', x, y) ?? ''; return isMassSkin(p) || p.startsWith('ow_house') || p.startsWith('ow_roof') }
    for (const comp of components(m, (x, y) => skin(m, 'ground', x, y)?.startsWith('ow_mtn_')))
      assert.ok(comp.some(([x, y]) => anchored(x, y)), `${m.name}: ${comp.length} stray mountain ground cells at ${comp[0]}`)
  })
})
