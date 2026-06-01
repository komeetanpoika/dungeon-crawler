// test/entities.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard, makeMonster, makeDragon, TILE, hasLineOfSight } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

describe('TILE', () => {
  it('has a SNARE constant distinct from WALL, FLOOR, COLUMN', () => {
    assert.equal(typeof TILE.SNARE, 'number')
    assert.notEqual(TILE.SNARE, TILE.WALL)
    assert.notEqual(TILE.SNARE, TILE.FLOOR)
    assert.notEqual(TILE.SNARE, TILE.COLUMN)
  })
})

describe('makeGuard', () => {
  it('has hp, maxHp, inCombat — no patrol or alertState', () => {
    const g = makeGuard(5, 5)
    assert.equal(g.hp, 4)
    assert.equal(g.maxHp, 4)
    assert.equal(g.inCombat, false)
    assert.equal(g.patrol, undefined)
    assert.equal(g.alertState, undefined)
  })
})

describe('makeMonster', () => {
  it('has hp and maxHp matching variant — no alertState', () => {
    const cases = [['weak', 1], ['medium', 2], ['strong', 3], ['boss', 5]]
    for (const [variant, hp] of cases) {
      const m = makeMonster(5, 5, variant)
      assert.equal(m.hp, hp)
      assert.equal(m.maxHp, hp)
      assert.equal(m.alertState, undefined)
    }
  })
})

describe('makeDragon', () => {
  it('has hp:12, maxHp:12, inCombat:false — no sleepMeter or snareTimer', () => {
    const d = makeDragon(5, 5, 1)
    assert.equal(d.hp, 12)
    assert.equal(d.maxHp, 12)
    assert.equal(d.inCombat, false)
    assert.equal(d.sleepMeter, undefined)
    assert.equal(d.snareTimer, undefined)
  })
})

describe('hasLineOfSight', () => {
  it('returns true for two points with open floor between them', () => {
    const map = openMap()
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), true)
  })

  it('returns false when a wall blocks the line', () => {
    const map = openMap()
    for (let y = 0; y < 20; y++) map[y][7].tile = TILE.WALL
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), false)
  })
})
