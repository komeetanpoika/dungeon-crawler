import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stampTrail, TRACK_SKINS, TRACK_EVERY, isStampable } from '../renderer/systems/quests/trail.js'
import { takeDirtyTiles } from '../renderer/systems/tile-dirty.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const N = 24

function grassMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    map[y][x].tile = TILE.FLOOR
    map[y][x].skin = 'ow_grass_0'
  }
  return map
}

const stained = map => {
  const out = []
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (TRACK_SKINS.includes(map[y][x].skin)) out.push({ x, y })
  return out
}

describe('isStampable', () => {
  it('takes bare grass only', () => {
    assert.equal(isStampable({ tile: TILE.FLOOR, skin: 'ow_grass_2' }), true)
    assert.equal(isStampable({ tile: TILE.FLOOR, skin: 'ow_water_0' }), false)
    assert.equal(isStampable({ tile: TILE.FLOOR, skin: 'ow_grass_0', overlay: 'ow_bush_round' }), false)
    assert.equal(isStampable({ tile: TILE.WALL, skin: 'ow_grass_0' }), false)
    assert.equal(isStampable(undefined), false)
  })
})

describe('stampTrail', () => {
  it('stains a run of cells between the two points and marks them dirty', () => {
    const map = grassMap()
    const n = stampTrail(map, { x: 3, y: 3 }, { x: 14, y: 3 })
    assert.ok(n > 0)
    assert.equal(stained(map).length, n)
    const dirty = takeDirtyTiles(map)
    assert.equal(dirty.length, n * 2, 'one x,y pair per stained cell')
  })
  it('thins the trail out — not every cell on the path', () => {
    const map = grassMap()
    const n = stampTrail(map, { x: 3, y: 3 }, { x: 14, y: 3 })
    assert.ok(n <= Math.ceil(12 / TRACK_EVERY) + 1, `stained ${n} of ~12`)
  })
  it('never overwrites art or non-grass ground', () => {
    const map = grassMap()
    for (let x = 3; x <= 14; x++) map[3][x].overlay = 'ow_bush_round'
    assert.equal(stampTrail(map, { x: 3, y: 3 }, { x: 14, y: 3 }), 0)
    assert.equal(stained(map).length, 0)
  })
  it('is idempotent — a second stamp stains nothing new', () => {
    const map = grassMap()
    const first = stampTrail(map, { x: 3, y: 3 }, { x: 14, y: 3 })
    takeDirtyTiles(map)
    const second = stampTrail(map, { x: 3, y: 3 }, { x: 14, y: 3 })
    assert.equal(second, 0)
    assert.equal(stained(map).length, first)
  })
  it('returns 0 for an unreachable target instead of throwing', () => {
    const map = grassMap()
    for (let y = 1; y < N - 1; y++) { map[y][10].tile = TILE.WALL; delete map[y][10].skin }
    assert.equal(stampTrail(map, { x: 3, y: 3 }, { x: 14, y: 3 }), 0)
  })
})
