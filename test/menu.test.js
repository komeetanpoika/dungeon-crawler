import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMetaSummary } from '../renderer/ui/menu.js'

describe('formatMetaSummary', () => {
  it('formats a played meta with treasure stolen', () => {
    const s = formatMetaSummary({ deepestReached: 4, runsCompleted: 12, treasureStolen: true })
    assert.equal(s, 'Deepest: Level 4 · Runs: 12 · Treasure: ✓')
  })

  it('formats a fresh meta without treasure', () => {
    const s = formatMetaSummary({ deepestReached: 0, runsCompleted: 0, treasureStolen: false })
    assert.equal(s, 'Deepest: Level 0 · Runs: 0 · Treasure: ✗')
  })
})
