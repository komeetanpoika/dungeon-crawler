// test/map.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateLevel, isFullyConnected, createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

describe('isFullyConnected', () => {
  it('returns true for a single-room map', () => {
    const map = createMap(10, 10)
    map[1][1].tile = TILE.FLOOR
    map[1][2].tile = TILE.FLOOR
    map[2][1].tile = TILE.FLOOR
    assert.equal(isFullyConnected(map), true)
  })

  it('returns false when two floor regions are separated by walls', () => {
    const map = createMap(10, 10)
    map[1][1].tile = TILE.FLOOR
    map[8][8].tile = TILE.FLOOR
    assert.equal(isFullyConnected(map), false)
  })
})

describe('generateLevel', () => {
  it('produces a connected map for each depth 1–9', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map } = generateLevel(depth)
      assert.equal(isFullyConnected(map), true, `depth ${depth} not connected`)
    }
  })

  it('includes a playerSpawn object with x and y', () => {
    const { playerSpawn } = generateLevel(1)
    assert.equal(typeof playerSpawn.x, 'number')
    assert.equal(typeof playerSpawn.y, 'number')
  })

  it('places STAIRS_DOWN on non-final levels', () => {
    const { map } = generateLevel(1)
    const hasStairs = map.some(row => row.some(t => t.tile === TILE.STAIRS_DOWN))
    assert.equal(hasStairs, true)
  })

  it('does not place STAIRS_DOWN on level 9', () => {
    const { map } = generateLevel(9)
    const hasStairs = map.some(row => row.some(t => t.tile === TILE.STAIRS_DOWN))
    assert.equal(hasStairs, false)
  })

  it('places a TREASURE tile on level 9', () => {
    const { map } = generateLevel(9)
    const hasTreasure = map.some(row => row.some(t => t.tile === TILE.TREASURE))
    assert.equal(hasTreasure, true)
  })

  it('returns entitySpawns as an array', () => {
    const { entitySpawns } = generateLevel(1)
    assert.ok(Array.isArray(entitySpawns))
  })
})
