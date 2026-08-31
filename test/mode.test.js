import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { modeForDepth } from '../renderer/systems/mode.js'

describe('modeForDepth', () => {
  it('depth 0 is the arena', () => {
    assert.equal(modeForDepth(0), 'arena')
  })
  it('dungeon depths 1-5 and the legacy overworld 6 are rush', () => {
    for (const d of [1, 2, 3, 4, 5, 6]) assert.equal(modeForDepth(d), 'rush', `depth ${d}`)
  })
  it('leap maps 8-10 are timewarp', () => {
    for (const d of [8, 9, 10]) assert.equal(modeForDepth(d), 'timewarp', `depth ${d}`)
  })
  it('the other open maps are adventure', () => {
    for (const d of [7, 11, 12, 13, 14, 15, 16, 17, 18]) assert.equal(modeForDepth(d), 'adventure', `depth ${d}`)
  })
  it('depths past the open maps fall back to rush', () => {
    assert.equal(modeForDepth(19), 'rush')
  })
})
