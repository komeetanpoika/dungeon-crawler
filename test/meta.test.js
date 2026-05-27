// test/meta.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getInitialMeta, applyRunResult, getStartingItems, validateMeta, MILESTONES,
} from '../renderer/systems/meta.js'

describe('getInitialMeta', () => {
  it('returns zero-state meta', () => {
    const meta = getInitialMeta()
    assert.equal(meta.deepestReached, 0)
    assert.deepEqual(meta.unlockedBonuses, [])
    assert.equal(meta.runsCompleted, 0)
    assert.equal(meta.treasureStolen, false)
  })
})

describe('applyRunResult', () => {
  it('updates deepestReached', () => {
    const meta = getInitialMeta()
    const next = applyRunResult(meta, { deepestLevel: 4, won: false })
    assert.equal(next.deepestReached, 4)
  })

  it('does not decrease deepestReached', () => {
    const meta = { ...getInitialMeta(), deepestReached: 6 }
    const next = applyRunResult(meta, { deepestLevel: 2, won: false })
    assert.equal(next.deepestReached, 6)
  })

  it('unlocks bonus when milestone depth is reached', () => {
    const meta = getInitialMeta()
    const milestone = MILESTONES[0]
    const next = applyRunResult(meta, { deepestLevel: milestone.depth, won: false })
    assert.ok(next.unlockedBonuses.includes(milestone.bonus))
  })

  it('does not duplicate bonuses on subsequent runs', () => {
    const meta = getInitialMeta()
    const milestone = MILESTONES[0]
    const once = applyRunResult(meta, { deepestLevel: milestone.depth, won: false })
    const twice = applyRunResult(once, { deepestLevel: milestone.depth, won: false })
    assert.equal(twice.unlockedBonuses.filter(b => b === milestone.bonus).length, 1)
  })

  it('sets treasureStolen on win', () => {
    const meta = getInitialMeta()
    const next = applyRunResult(meta, { deepestLevel: 9, won: true })
    assert.equal(next.treasureStolen, true)
  })

  it('increments runsCompleted', () => {
    const meta = getInitialMeta()
    const next = applyRunResult(meta, { deepestLevel: 1, won: false })
    assert.equal(meta.runsCompleted, 0)
    assert.equal(next.runsCompleted, 1)
  })
})

describe('getStartingItems', () => {
  it('returns empty array when starting_potion bonus is not unlocked', () => {
    const meta = getInitialMeta()
    assert.deepEqual(getStartingItems(meta), [])
  })

  it('returns one potion when starting_potion is unlocked', () => {
    const meta = { ...getInitialMeta(), unlockedBonuses: ['starting_potion'] }
    const items = getStartingItems(meta)
    assert.equal(items.length, 1)
    assert.equal(items[0].use, 'heal')
  })
})

describe('validateMeta', () => {
  it('returns true for valid meta', () => {
    assert.equal(validateMeta(getInitialMeta()), true)
  })

  it('returns false for null', () => {
    assert.equal(validateMeta(null), false)
  })

  it('returns false for missing fields', () => {
    assert.equal(validateMeta({ deepestReached: 0 }), false)
  })
})
