// test/stealth.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  propagateNoise, decayNoiseMap, mergeNoiseMaps,
  hasLineOfSight, guardCanSeePlayer, updateGuardAlert, updateDragonSleep,
} from '../renderer/systems/stealth.js'
import { TILE, ALERT, makeGuard, makePlayer, makeDragon } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

describe('propagateNoise', () => {
  it('places noise at source', () => {
    const map = openMap()
    const nm = propagateNoise(map, { x: 5, y: 5 }, 5)
    assert.ok(nm['5,5'] > 0)
  })

  it('decays with distance', () => {
    const map = openMap()
    const nm = propagateNoise(map, { x: 5, y: 5 }, 6)
    assert.ok(nm['5,5'] > (nm['5,6'] ?? 0))
  })

  it('does not pass through walls', () => {
    const map = openMap()
    for (let y = 0; y < 20; y++) map[y][6].tile = TILE.WALL
    const nm = propagateNoise(map, { x: 5, y: 5 }, 10)
    assert.equal(nm['8,5'] ?? 0, 0)
  })
})

describe('decayNoiseMap', () => {
  it('reduces all values by decay amount', () => {
    const nm = { '1,1': 5, '2,2': 3 }
    const result = decayNoiseMap(nm, 2)
    assert.equal(result['1,1'], 3)
    assert.equal(result['2,2'], 1)
  })

  it('removes entries that reach 0 or below', () => {
    const nm = { '1,1': 1 }
    const result = decayNoiseMap(nm, 1)
    assert.equal(result['1,1'], undefined)
  })
})

describe('mergeNoiseMaps', () => {
  it('combines entries from both maps', () => {
    const a = { '1,1': 3 }
    const b = { '2,2': 5 }
    const result = mergeNoiseMaps(a, b)
    assert.equal(result['1,1'], 3)
    assert.equal(result['2,2'], 5)
  })

  it('takes the higher value for overlapping keys', () => {
    const a = { '1,1': 3 }
    const b = { '1,1': 7 }
    const result = mergeNoiseMaps(a, b)
    assert.equal(result['1,1'], 7)
  })

  it('does not modify either input', () => {
    const a = { '1,1': 3 }
    const b = { '1,1': 7 }
    mergeNoiseMaps(a, b)
    assert.equal(a['1,1'], 3)
  })
})

describe('hasLineOfSight', () => {
  it('returns true for adjacent tiles on open map', () => {
    const map = openMap()
    assert.equal(hasLineOfSight(map, 5, 5, 5, 7), true)
  })

  it('returns false when a wall is between source and target', () => {
    const map = openMap()
    map[5][6].tile = TILE.WALL
    assert.equal(hasLineOfSight(map, 5, 5, 5, 8), false)
  })
})

describe('guardCanSeePlayer', () => {
  it('detects player directly in front within range', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    const player = makePlayer(5, 8)
    guard.facing = 'south'
    assert.equal(guardCanSeePlayer(map, guard, player), true)
  })

  it('does not detect player behind the guard', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    const player = makePlayer(5, 2)
    guard.facing = 'south'
    assert.equal(guardCanSeePlayer(map, guard, player), false)
  })

  it('does not detect player beyond fovRange', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    guard.fovRange = 3
    const player = makePlayer(5, 15)
    guard.facing = 'south'
    assert.equal(guardCanSeePlayer(map, guard, player), false)
  })
})

describe('updateGuardAlert', () => {
  it('sets guard to ALERTED when player is in sight', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    guard.facing = 'south'
    const player = makePlayer(5, 7)
    const result = updateGuardAlert(guard, {}, map, player)
    assert.equal(result.alertState, ALERT.ALERTED)
  })

  it('sets guard to CURIOUS when noise is high nearby', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    const player = makePlayer(15, 15)
    const noiseMap = { '5,5': guard.hearingRadius }
    const result = updateGuardAlert(guard, noiseMap, map, player)
    assert.equal(result.alertState, ALERT.CURIOUS)
  })
})

describe('updateDragonSleep', () => {
  it('increases sleep meter when noise is present', () => {
    const dragon = makeDragon(5, 5, 0)
    const noiseMap = { '5,5': 6 }
    const result = updateDragonSleep(dragon, noiseMap)
    assert.ok(result.sleepMeter > 0)
  })

  it('decreases sleep meter when no noise', () => {
    const dragon = { ...makeDragon(5, 5, 0), sleepMeter: 50 }
    const result = updateDragonSleep(dragon, {})
    assert.ok(result.sleepMeter < 50)
  })

  it('sets dragonState to awake at meter >= 100', () => {
    const dragon = { ...makeDragon(5, 5, 0), sleepMeter: 99 }
    const noiseMap = { '5,5': 10 }
    const result = updateDragonSleep(dragon, noiseMap)
    assert.equal(result.dragonState, 'awake')
  })
})
