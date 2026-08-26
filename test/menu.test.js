import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMetaSummary, navActionFor } from '../renderer/ui/menu.js'

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

describe('navActionFor', () => {
  it('maps arrows and stick keys to menu movement', () => {
    assert.equal(navActionFor('ArrowDown'), 'down')
    assert.equal(navActionFor('s'), 'down')
    assert.equal(navActionFor('ArrowUp'), 'up')
    assert.equal(navActionFor('w'), 'up')
  })
  it('maps Enter and Space (the red button) to confirm', () => {
    assert.equal(navActionFor('Enter'), 'confirm')
    assert.equal(navActionFor(' '), 'confirm')
  })
  it('leaves other keys to the cheat buffer', () => {
    assert.equal(navActionFor('m'), null)
    assert.equal(navActionFor('Escape'), null)
  })
})
