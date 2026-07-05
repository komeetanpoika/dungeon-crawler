import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { buildNavGrid, passable, clearanceFor, nearestPassable, canMoveTo } from '../renderer/systems/nav.js'

// 12x9 map: solid wall border, floor interior, one column at (x=6, y=4)
function columnMap() {
  const map = createMap(12, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 11; x++) map[y][x].tile = TILE.FLOOR
  map[4][6].tile = TILE.COLUMN
  return map
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
