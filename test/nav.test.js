import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { buildNavGrid, passable, clearanceFor, nearestPassable, canMoveTo, findPath, buildFlowField, fieldStep } from '../renderer/systems/nav.js'

// 12x9 map: solid wall border, floor interior, one column at (x=6, y=4)
function columnMap() {
  const map = createMap(12, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 11; x++) map[y][x].tile = TILE.FLOOR
  map[4][6].tile = TILE.COLUMN
  return map
}

// Wall off every neighbour of (9,6) so it becomes a sealed 1-tile pocket.
// (Do this BEFORE buildNavGrid — the nav grid caches on map._nav.)
function sealPocket(map) {
  for (const [x, y] of [[8, 5], [9, 5], [10, 5], [8, 6], [10, 6], [8, 7], [9, 7], [10, 7]]) {
    map[y][x].tile = TILE.WALL
  }
}

describe('clearanceFor', () => {
  it('small entities need clearance 1, wide ones 2', () => {
    assert.equal(clearanceFor(4), 1)    // rats, guards
    assert.equal(clearanceFor(16), 1)   // exactly one tile
    assert.equal(clearanceFor(28), 2)   // cyclops (56px wide)
  })
})

describe('buildNavGrid', () => {
  it('computes walkability and clearance distances', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    assert.equal(nav.w, 12)
    assert.equal(nav.h, 9)
    assert.equal(nav.clear[0 * 12 + 0], 0)          // wall tile: 0
    assert.equal(nav.clear[4 * 12 + 6], 0)          // column tile: 0
    assert.equal(nav.clear[4 * 12 + 5], 1)          // next to column: 1
    assert.ok(nav.clear[2 * 12 + 3] >= 2, 'open interior tile has clearance >= 2')
  })

  it('caches on map._nav', () => {
    const map = columnMap()
    assert.equal(buildNavGrid(map), buildNavGrid(map))
  })
})

describe('passable', () => {
  it('clearance 2 rejects tiles hugging a wall', () => {
    const nav = buildNavGrid(columnMap())
    assert.equal(passable(nav, 1, 1, 1), true)   // corner floor ok for small
    assert.equal(passable(nav, 1, 1, 2), false)  // too tight for wide entities
    assert.equal(passable(nav, 3, 2, 2), true)   // open interior ok
    assert.equal(passable(nav, -1, 0, 1), false) // out of bounds
  })
})

describe('nearestPassable', () => {
  it('finds an adjacent floor tile from inside a wall', () => {
    const nav = buildNavGrid(columnMap())
    const t = nearestPassable(nav, 0, 0, 1)
    assert.ok(t && passable(nav, t.x, t.y, 1))
  })
  it('returns null when nothing is close', () => {
    const map = createMap(30, 30) // all wall
    const nav = buildNavGrid(map)
    assert.equal(nearestPassable(nav, 15, 15, 1), null)
  })
})

describe('canMoveTo', () => {
  it('allows a small body on open floor, blocks overlap with the column', () => {
    const map = columnMap()
    assert.equal(canMoveTo(map, 3 * 32 + 16, 2 * 32 + 16, 4), true)
    // column tile spans x 192..224, y 128..160; body centre 2px left of it overlaps
    assert.equal(canMoveTo(map, 6 * 32 - 2, 4 * 32 + 16, 4), false)
  })
})

describe('findPath', () => {
  it('routes around the column instead of through it', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    const path = findPath(nav, 4, 4, 8, 4, 1)   // column at (6,4) sits on the straight line
    assert.ok(path && path.length >= 4)
    assert.ok(!path.some(p => p.x === 6 && p.y === 4), 'path avoids the column tile')
    assert.deepEqual(path[path.length - 1], { x: 8, y: 4 })
    // contiguous king-moves from the start tile
    let prev = { x: 4, y: 4 }
    for (const p of path) {
      assert.ok(Math.abs(p.x - prev.x) <= 1 && Math.abs(p.y - prev.y) <= 1)
      prev = p
    }
  })

  it('returns [] when start equals target and null when sealed off', () => {
    const map = columnMap()
    sealPocket(map) // walls around (9,6), see helper below
    const nav = buildNavGrid(map)
    assert.deepEqual(findPath(nav, 2, 2, 2, 2, 1), [])
    assert.equal(findPath(nav, 2, 2, 9, 6, 1), null)
  })

  it('wide entities get wide routes', () => {
    // 16x11 map, two rooms joined by a 1-tile-wide door at x=8
    const map = createMap(16, 11)
    for (let y = 1; y < 10; y++) for (let x = 1; x < 15; x++) map[y][x].tile = TILE.FLOOR
    for (let y = 1; y < 10; y++) if (y !== 5) map[y][8].tile = TILE.WALL
    const nav = buildNavGrid(map)
    assert.ok(findPath(nav, 3, 5, 13, 5, 1), 'small entity fits through the door')
    assert.equal(findPath(nav, 3, 5, 13, 5, 2), null, 'wide entity cannot')
  })

  it('substitutes an impassable start or target with the nearest passable tile', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    // target is the column tile (6,4): impassable, resolves to an adjacent floor tile
    const path = findPath(nav, 2, 4, 6, 4, 1)
    assert.ok(path && path.length, 'path found to substituted target')
    const end = path[path.length - 1]
    assert.ok(!(end.x === 6 && end.y === 4), 'does not end on the column')
    assert.equal(Math.max(Math.abs(end.x - 6), Math.abs(end.y - 4)), 1, 'ends adjacent to it')
    // start inside the border wall (0,0) resolves to a floor tile and still paths
    const p2 = findPath(nav, 0, 0, 4, 2, 1)
    assert.ok(p2 && p2.length, 'path found from substituted start')
    assert.deepEqual(p2[p2.length - 1], { x: 4, y: 2 })
  })
})

describe('buildFlowField', () => {
  it('distance is 0 at the target and grows outward around obstacles', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    const f = buildFlowField(nav, 8, 4, 1)
    assert.equal(f.dist[4 * 12 + 8], 0)
    assert.ok(f.dist[4 * 12 + 4] > 3, 'tile behind the column costs more than the crow flies')
    assert.equal(f.dist[0], Infinity)   // wall tile unreachable
  })

  it('clearance-2 field treats a 1-tile door as a wall', () => {
    const map = createMap(16, 11)
    for (let y = 1; y < 10; y++) for (let x = 1; x < 15; x++) map[y][x].tile = TILE.FLOOR
    for (let y = 1; y < 10; y++) if (y !== 5) map[y][8].tile = TILE.WALL
    const nav = buildNavGrid(map)
    const wide = buildFlowField(nav, 3, 5, 2)
    assert.equal(wide.dist[5 * 16 + 13], Infinity, 'far room unreachable for wide entities')
    const small = buildFlowField(nav, 3, 5, 1)
    assert.ok(isFinite(small.dist[5 * 16 + 13]))
  })
})

describe('fieldStep', () => {
  it('descending steps reach the target even around the column', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    const f = buildFlowField(nav, 8, 4, 1)
    let pos = { x: 4, y: 4 }
    for (let i = 0; i < 40; i++) {
      const next = fieldStep(f, nav, pos.x, pos.y, 1, 'down')
      if (!next) break
      pos = next
    }
    assert.deepEqual(pos, { x: 8, y: 4 })
  })

  it('ascending increases distance, and returns null when cornered', () => {
    // dead-end corridor: floor only at y=4, x=1..5; player flood from (5,4)
    const map = createMap(8, 8)
    for (let x = 1; x <= 5; x++) map[4][x].tile = TILE.FLOOR
    const nav = buildNavGrid(map)
    const f = buildFlowField(nav, 5, 4, 1)
    const up = fieldStep(f, nav, 3, 4, 1, 'up')
    assert.deepEqual(up, { x: 2, y: 4 })       // away from the player
    assert.equal(fieldStep(f, nav, 1, 4, 1, 'up'), null)  // closed end: cornered
  })
})
