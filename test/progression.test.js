import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { countBosses, spawnLevelExit } from '../renderer/systems/progression.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

describe('countBosses', () => {
  it('counts only entities flagged isBoss', () => {
    assert.equal(countBosses([{ isBoss: true }, { type: 'guard' }, { isBoss: true }]), 2)
    assert.equal(countBosses([{ type: 'guard' }]), 0)
    assert.equal(countBosses([]), 0)
  })
})

describe('spawnLevelExit', () => {
  it('non-final: writes STAIRS_DOWN and returns null', () => {
    const map = createMap(10, 10)
    map[5][5].tile = TILE.FLOOR
    const result = spawnLevelExit(map, { x: 5, y: 5 }, false)
    assert.equal(result, null)
    assert.equal(map[5][5].tile, TILE.STAIRS_DOWN)
    assert.equal(map[5][5].stairWidth, 1)
    assert.equal(map[5][5].stairCol, 0)
  })

  it('final: writes TREASURE and returns the victory tile', () => {
    const map = createMap(10, 10)
    map[4][6].tile = TILE.FLOOR
    const result = spawnLevelExit(map, { x: 6, y: 4 }, true)
    assert.deepEqual(result, { x: 6, y: 4 })
    assert.equal(map[4][6].tile, TILE.TREASURE)
  })

  it('out of bounds: returns null and mutates nothing', () => {
    const map = createMap(10, 10)
    assert.equal(spawnLevelExit(map, { x: 99, y: 99 }, false), null)
  })
})
