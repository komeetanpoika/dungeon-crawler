import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isEnemy, isHittable, isDead } from '../renderer/systems/factions.js'

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
  it('maahinen and sammunut are enemies; nakki is hittable but never an enemy', () => {
    assert.equal(isEnemy({ type: 'maahinen' }), true)
    assert.equal(isEnemy({ type: 'sammunut' }), true)
    assert.equal(isEnemy({ type: 'nakki' }), false)
    assert.equal(isHittable({ type: 'nakki' }), true)
  })
})

describe('isDead', () => {
  it('a creature with no hp (nakki) is never dead', () => {
    assert.equal(isDead({ type: 'nakki' }), false)
  })
  it('a hittable entity at 0 hp is dead', () => {
    assert.equal(isDead({ type: 'maahinen', hp: 0 }), true)
    assert.equal(isDead({ type: 'npc', hp: 0 }), true)
  })
  it('a non-hittable entity is never dead, even with no hp', () => {
    assert.equal(isDead({ type: 'echo' }), false)
  })
})
