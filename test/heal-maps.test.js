import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MapBuilder, shoreline, reshore, validate, layPiersOverWater, fordToStones, carveDirtToGrass, WATER_SKINS } from '../tools/static-overworld/lib.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MTN, EDGE_SHAPES, EDGE_VARIANTS, edgeName, stampMass, stampMountainRim, stampGroundEdge, pruneStrayGround, fillGrassPockets, isMassSkin, isAnchorSkin } from '../tools/static-overworld/mountain.mjs'

const TILES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
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

describe('layPiersOverWater', () => {
  it('turns ground pier logs into a pier overlay over water, the bank ends back to grass', () => {
    const b = riverWithGroundBridge()
    assert.equal(layPiersOverWater(b), 5)
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
    layPiersOverWater(b)
    assert.equal(prop(b, 1, 1), 'ow_pier_log')
    assert.equal(ground(b, 1, 1), 'ow_grass_0')
    assert.equal(layPiersOverWater(b), 0)
  })
  it('lays a north-south pier over an east-west river the same way, and a jetty off the map edge ends in grass', () => {
    const b = new MapBuilder('t', 'forest', 't', 7, 9)
    for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) b.g(x, y, 'ow_grass_0')
    for (let y = 3; y <= 5; y++) for (let x = 0; x < 7; x++) { b.g(x, y, 'ow_water_1'); b.block(x, y) }
    for (let y = 2; y <= 6; y++) { b.g(3, y, 'ow_pier_log'); b.unblock(3, y) }   // across the river
    for (let x = 4; x <= 6; x++) b.g(x, 8, 'ow_pier_log')                       // a jetty on dry land running off the east edge
    assert.equal(layPiersOverWater(b), 8)
    for (let y = 3; y <= 5; y++) assert.ok(WATER_SKINS.includes(ground(b, 3, y)))
    assert.equal(ground(b, 3, 2), 'ow_grass_0'); assert.equal(ground(b, 3, 6), 'ow_grass_0')
    for (let x = 4; x <= 6; x++) { assert.equal(ground(b, x, 8), 'ow_grass_0'); assert.equal(prop(b, x, 8), 'ow_pier_log') }
    assert.equal(b.walkable(3, 4), true)
    assert.equal(b.walkable(6, 8), false)   // the border stays blocked
  })
  it('shoreline then rims the bank cells under the logs like any other water', () => {
    const b = riverWithGroundBridge()
    layPiersOverWater(b); shoreline(b)
    assert.equal(ground(b, 3, 3), 'ow_pond_01')
    assert.equal(ground(b, 5, 3), 'ow_pond_21')
    assert.ok(WATER_SKINS.includes(ground(b, 4, 3)))
    assert.equal(prop(b, 4, 3), 'ow_pier_log')
  })
})

describe('fordToStones', () => {
  // an east-west river three cells wide, cut in two by a one-cell dirt
  // causeway running north-south across it
  function cutRiver() {
    const b = new MapBuilder('t', 'forest', 't', 9, 7)
    for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) b.g(x, y, 'ow_grass_0')
    for (let y = 2; y <= 4; y++) for (let x = 0; x < 9; x++) { b.g(x, y, 'ow_water_0'); b.block(x, y) }
    for (let y = 1; y <= 5; y++) { b.g(4, y, 'ow_dirt_0'); b.unblock(4, y) }
    b.g(7, 1, 'ow_dirt_0')          // a dirt stamp on the bank: water on one side only
    return b
  }
  it('turns the causeway cells with water on both sides into walkable stepping stones over water', () => {
    const b = cutRiver()
    assert.equal(fordToStones(b), 3)
    for (let y = 2; y <= 4; y++) {
      assert.ok(WATER_SKINS.includes(ground(b, 4, y)))
      assert.match(prop(b, 4, y), /^ow_rock_water_gray_[01]$/)
      assert.equal(b.walkable(4, y), true)
    }
    assert.equal(ground(b, 4, 1), 'ow_dirt_0'); assert.equal(ground(b, 4, 5), 'ow_dirt_0')
    assert.equal(ground(b, 7, 1), 'ow_dirt_0')
    assert.equal(fordToStones(b), 0)
  })
  it('the river reads as one body again once the shore is relaid: no bank faces the stones', () => {
    const b = cutRiver()
    fordToStones(b); carveDirtToGrass(b); reshore(b); shoreline(b)
    assert.equal(ground(b, 3, 3), 'ow_water_0')   // open water beside the middle stone
    assert.equal(ground(b, 5, 3), 'ow_water_0')
    assert.equal(ground(b, 3, 2), 'ow_pond_10')   // the north bank rim runs straight past it
    assert.equal(ground(b, 5, 2), 'ow_pond_10')
  })
  it('ignores dirt that carries a prop or is blocked', () => {
    const b = cutRiver()
    b.p(4, 3, 'ow_bush_0'); b.block(4, 2)
    assert.equal(fordToStones(b), 1)
    assert.equal(ground(b, 4, 4)?.startsWith('ow_water'), true)
    assert.equal(ground(b, 4, 3), 'ow_dirt_0'); assert.equal(ground(b, 4, 2), 'ow_dirt_0')
  })
})

describe('carveDirtToGrass', () => {
  it('seven cells is a carve, eight is a trail', () => {
    const b = new MapBuilder('t', 'forest', 't', 12, 5)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) b.g(x, y, 'ow_grass_0')
    for (let x = 1; x <= 7; x++) b.g(x, 1, 'ow_dirt_0')
    for (let x = 1; x <= 8; x++) b.g(x, 3, 'ow_dirt_0')
    assert.equal(carveDirtToGrass(b), 7)
    for (let x = 1; x <= 7; x++) assert.equal(ground(b, x, 1), 'ow_grass_0')
    for (let x = 1; x <= 8; x++) assert.equal(ground(b, x, 3), 'ow_dirt_0')
  })
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
  it('a patch touching a mass only at a corner is adrift (patches are 4-connected); a ruin or a mine mouth anchors one', () => {
    const b = new MapBuilder('t', 'forest', 't', 12, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) b.g(x, y, 'ow_grass_0')
    stampMass(b, rng, 2, 2); b.g(3, 3, 'ow_mtn_ground_0')            // diagonal only
    b.g(6, 5, 'ow_mtn_ground_0'); b.p(6, 5, 'ow_ruin_pillar_2')
    b.g(9, 5, 'ow_mtn_ground_0'); b.g(10, 5, 'ow_mtn_ground_0'); b.p(10, 5, 'ow_cave_gate_l', { walkable: true })
    assert.equal(pruneStrayGround(b), 1)
    assert.equal(ground(b, 3, 3), 'ow_grass_0')
    assert.equal(ground(b, 6, 5), 'ow_mtn_ground_0')
    assert.equal(ground(b, 9, 5), 'ow_mtn_ground_0')
  })
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

describe('stampGroundEdge', () => {
  // a 3x3 block of mountain floor in the grass, one grass cell notched into
  // its north-east corner's diagonal neighbour
  function block() {
    const b = new MapBuilder('t', 'forest', 't', 9, 9)
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) b.g(x, y, 'ow_grass_0')
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) b.g(x, y, 'ow_mtn_ground_0')
    return b
  }
  const shape = n => { const m = /^ow_mtn_edge_(\d+)_(\d+)_(\d)$/.exec(n); return m && { M: +m[1], D: +m[2], V: +m[3] } }
  it('frays every side that faces grass and leaves the interior plain', () => {
    const b = block()
    assert.equal(stampGroundEdge(b), 8)
    assert.equal(ground(b, 4, 4), 'ow_mtn_ground_0')
    assert.deepEqual([shape(ground(b, 4, 3)).M, shape(ground(b, 5, 4)).M, shape(ground(b, 4, 5)).M, shape(ground(b, 3, 4)).M], [1, 2, 4, 8])
    assert.deepEqual([shape(ground(b, 3, 3)).M, shape(ground(b, 5, 3)).M, shape(ground(b, 5, 5)).M, shape(ground(b, 3, 5)).M], [9, 3, 6, 12])
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) assert.equal(shape(ground(b, x, y))?.D ?? 0, 0)
    assert.equal(stampGroundEdge(b), 0)
  })
  it('nibbles a concave corner, never frays against the map edge, and heals a stale edge tile', () => {
    const b = block()
    for (let y = 0; y <= 2; y++) for (let x = 3; x <= 5; x++) b.g(x, y, 'ow_mtn_ground_1')   // the block now reaches the top edge
    b.g(6, 2, 'ow_mtn_ground_1')                                                                // and a spur east of it
    stampGroundEdge(b)
    assert.equal(ground(b, 4, 0), 'ow_mtn_ground_1')          // top edge: off-map is rock, so the column's head stays plain
    assert.equal(ground(b, 4, 1), 'ow_mtn_ground_1')          // interior column
    assert.equal(shape(ground(b, 5, 3)).M, 2)                 // E (6,3) is grass: a frayed side, no nibble
    const concave = shape(ground(b, 5, 2))                      // rock on all four sides, grass on the SE diagonal (6,3): a nibble
    assert.equal(concave.M, 0); assert.equal(concave.D & 2, 2)
    b.g(4, 4, edgeName(15, 0, 0))                                // a stale edge tile in the interior
    assert.equal(stampGroundEdge(b), 1)
    assert.equal(ground(b, 4, 4).startsWith('ow_mtn_ground_'), true)
  })
  it('every shape it can name is a tile on disk, in every variant', () => {
    assert.equal(EDGE_SHAPES.length, 46)
    assert.equal(MTN.edge.length, 46 * EDGE_VARIANTS)
    for (const n of MTN.edge) assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), n)
  })
  it('survives a later rim pass: stampMountainRim leaves edge tiles alone and pushes nothing undefined', () => {
    const b = block()
    stampMass(b, () => 0.5, 4, 4)
    stampMountainRim(b, () => 0.5)
    stampGroundEdge(b)
    const before = b.ground.map(r => [...r])
    stampMountainRim(b, () => 0.5)
    assert.deepEqual(b.ground, before)
    assert.ok(b.palette.every(n => typeof n === 'string'))
  })
})

describe('fillGrassPockets', () => {
  it('turns a few grass cells walled in by mountain floor into floor, leaves the open woods and big clearings', () => {
    const b = new MapBuilder('t', 'forest', 't', 14, 10)
    for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) b.g(x, y, 'ow_mtn_ground_0')
    b.g(3, 0, 'ow_grass_0'); b.g(3, 1, 'ow_grass_0'); b.p(3, 1, 'ow_tree_small_autumn')   // a finger from the map edge
    for (let y = 3; y <= 6; y++) for (let x = 8; x <= 11; x++) b.g(x, y, 'ow_grass_1')    // a 16-cell clearing: stays
    for (let y = 8; y < 10; y++) for (let x = 0; x < 14; x++) b.g(x, y, 'ow_grass_0')     // the woods, open to the edge... and enclosed by off-map
    assert.equal(fillGrassPockets(b), 2)
    assert.ok(ground(b, 3, 0).startsWith('ow_mtn_ground_')); assert.ok(ground(b, 3, 1).startsWith('ow_mtn_ground_'))
    assert.equal(prop(b, 3, 1), 'ow_tree_small_autumn')
    assert.equal(ground(b, 9, 5), 'ow_grass_1')
    assert.equal(ground(b, 5, 9), 'ow_grass_0')
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
  it('are at the fixed point of every heal pass: rerunning them changes nothing', () => {
    for (const m of maps) {
      const b = MapBuilder.fromJSON(m)
      assert.equal(fordToStones(b), 0, `${m.name}: ford`)
      assert.equal(layPiersOverWater(b), 0, `${m.name}: piers`)
      assert.equal(carveDirtToGrass(b), 0, `${m.name}: dirt`)
      assert.equal(pruneStrayGround(b), 0, `${m.name}: stray ground`)
      assert.equal(fillGrassPockets(b), 0, `${m.name}: grass pockets`)
      assert.equal(stampGroundEdge(b), 0, `${m.name}: ground edge`)
    }
  })
  it('still validate: spawn and every POI reachable', () => {
    for (const m of maps) assert.deepEqual(validate(MapBuilder.fromJSON(m)), [], m.name)
  })
  it('no open cell cuts the river: water on opposite sides means a pier or a stepping stone', () => {
    for (const m of maps) for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      if (m.walk[y][x] !== '1') continue
      const wet = (x, y) => { const g = skin(m, 'ground', x, y); return g.startsWith('ow_water') || g.startsWith('ow_pond_') }
      if (!((wet(x, y - 1) && wet(x, y + 1)) || (wet(x - 1, y) && wet(x + 1, y)))) continue
      const p = skin(m, 'prop', x, y) ?? ''
      assert.ok(p === 'ow_pier_log' || p.startsWith('ow_rock_water'), `${m.name}: bare crossing at ${x},${y}`)
      assert.ok(wet(x, y), `${m.name}: crossing at ${x},${y} over ${skin(m, 'ground', x, y)}`)
    }
  })
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
    for (const comp of components(m, (x, y) => skin(m, 'ground', x, y)?.startsWith('ow_mtn_')))
      assert.ok(comp.some(([x, y]) => isAnchorSkin(skin(m, 'prop', x, y))), `${m.name}: ${comp.length} stray mountain ground cells at ${comp[0]}`)
  })
  it('every ground and prop name in the palette is a tile on disk', () => {
    for (const m of maps) for (const n of m.palette) assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), `${m.name}: ${n}`)
  })
})
