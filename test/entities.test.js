// test/entities.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard, makeMonster, makeDragon, TILE, hasLineOfSight, isWalkable, makeKey, makeExitDoor, makeTreasure } from '../renderer/systems/entities.js'
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

  it('has SAND distinct from WALL, FLOOR, COLUMN, SNARE and is walkable', () => {
    assert.equal(typeof TILE.SAND, 'number')
    assert.notEqual(TILE.SAND, TILE.WALL)
    assert.notEqual(TILE.SAND, TILE.FLOOR)
    assert.notEqual(TILE.SAND, TILE.COLUMN)
    assert.notEqual(TILE.SAND, TILE.SNARE)
    assert.equal(isWalkable(TILE.SAND), true)
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

describe('boss-drop and exit-door factories', () => {
  it('makeKey produces a key entity', () => {
    assert.deepEqual(makeKey(3, 4), { type: 'key', x: 3, y: 4 })
  })

  it('makeExitDoor produces a locked exit door using door frames', () => {
    const d = makeExitDoor(5, 6)
    assert.equal(d.type, 'door')
    assert.equal(d.x, 5); assert.equal(d.y, 6)
    assert.equal(d.locked, true)
    assert.equal(d.isExit, true)
    assert.equal(d.frame, 0)
    assert.equal(d.opening, false)
  })

  it('makeTreasure carries its weapon type', () => {
    const t = makeTreasure(7, 8, 'axe')
    assert.equal(t.type, 'treasure')
    assert.equal(t.x, 7); assert.equal(t.y, 8)
    assert.equal(t.weaponType, 'axe')
  })
})
