import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { countBosses, spawnBossDrop } from '../renderer/systems/progression.js'

describe('countBosses', () => {
  it('counts only entities flagged isBoss', () => {
    assert.equal(countBosses([{ isBoss: true }, { type: 'guard' }, { isBoss: true }]), 2)
    assert.equal(countBosses([{ type: 'guard' }]), 0)
    assert.equal(countBosses([]), 0)
  })
})

describe('spawnBossDrop', () => {
  it('non-final: drops a key at the tile', () => {
    const drop = spawnBossDrop({ x: 5, y: 9 }, false, ['dagger'])
    assert.deepEqual(drop, { type: 'key', x: 5, y: 9 })
  })

  it('final: drops a treasure with a weapon from the pool', () => {
    const pool = ['longsword', 'axe']
    for (let i = 0; i < 20; i++) {
      const drop = spawnBossDrop({ x: 2, y: 3 }, true, pool)
      assert.equal(drop.type, 'treasure')
      assert.equal(drop.x, 2); assert.equal(drop.y, 3)
      assert.ok(pool.includes(drop.weaponType), `weaponType ${drop.weaponType} not in pool`)
    }
  })

  it('final: weaponPool defaults to dagger', () => {
    const drop = spawnBossDrop({ x: 0, y: 0 }, true)
    assert.equal(drop.weaponType, 'dagger')
  })
})
