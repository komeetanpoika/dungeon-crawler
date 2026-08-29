import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isEnemy, isHittable } from '../renderer/systems/factions.js'

describe('isEnemy / isHittable', () => {
  it('a hostile npc is an enemy and hittable', () => {
    const e = { type: 'npc', species: 'villager', hostile: true }
    assert.equal(isEnemy(e), true)
    assert.equal(isHittable(e), true)
  })
  it('a peaceful npc is hittable but not an enemy', () => {
    const e = { type: 'npc', species: 'chicken', hostile: false }
    assert.equal(isEnemy(e), false)
    assert.equal(isHittable(e), true)
  })
  it('a guard is both', () => {
    assert.equal(isEnemy({ type: 'guard' }), true)
    assert.equal(isHittable({ type: 'guard' }), true)
  })
  it('every monster type counts as an enemy', () => {
    for (const type of ['monster', 'dragon', 'cyclops', 'wizard', 'crab', 'dragon_boss']) {
      assert.equal(isEnemy({ type }), true, type)
    }
  })
  it('a chest or a prop is neither', () => {
    for (const type of ['chest', 'prop', 'door', 'trap']) {
      assert.equal(isEnemy({ type }), false, type)
      assert.equal(isHittable({ type }), false, type)
    }
  })
})
