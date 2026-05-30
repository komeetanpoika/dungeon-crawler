// test/entities.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard, makeMonster, makeDragon, TILE } from '../renderer/systems/entities.js'

describe('makeGuard', () => {
  it('has maxHp: 4 and inCombat: false', () => {
    const g = makeGuard(5, 5)
    assert.equal(g.maxHp, 4)
    assert.equal(g.inCombat, false)
  })
})

describe('makeMonster', () => {
  it('has maxHp matching hp for each variant and inCombat: false', () => {
    const cases = [['weak', 1], ['medium', 2], ['strong', 3], ['boss', 5]]
    for (const [variant, expectedHp] of cases) {
      const m = makeMonster(5, 5, variant)
      assert.equal(m.maxHp, expectedHp, `maxHp for variant ${variant}`)
      assert.equal(m.inCombat, false, `inCombat for variant ${variant}`)
    }
  })
})

describe('TILE', () => {
  it('has a SNARE constant', () => {
    assert.equal(typeof TILE.SNARE, 'number')
    assert.notEqual(TILE.SNARE, TILE.WALL)
    assert.notEqual(TILE.SNARE, TILE.FLOOR)
    assert.notEqual(TILE.SNARE, TILE.COLUMN)
  })
})

describe('makeDragon', () => {
  it('has hp, maxHp, snareTimer, and inCombat fields', () => {
    const d = makeDragon(5, 5, 1)
    assert.equal(d.hp, 12)
    assert.equal(d.maxHp, 12)
    assert.equal(d.snareTimer, 0)
    assert.equal(d.inCombat, false)
  })
})
