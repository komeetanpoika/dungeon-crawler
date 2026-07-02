import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, snapshotLayers } from '../tools/tile-editor/history.js'

describe('createHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const h = createHistory()
    assert.equal(h.canUndo, false)
    assert.equal(h.canRedo, false)
    assert.equal(h.undo('cur'), null)
    assert.equal(h.redo('cur'), null)
  })

  it('round-trips push → undo → redo', () => {
    const h = createHistory()
    h.push('s1')                        // state before stroke 1
    assert.equal(h.canUndo, true)
    const back = h.undo('s2')           // current state s2, going back to s1
    assert.equal(back, 's1')
    assert.equal(h.canUndo, false)
    assert.equal(h.canRedo, true)
    const fwd = h.redo('s1')            // current state s1, going forward to s2
    assert.equal(fwd, 's2')
    assert.equal(h.canUndo, true)
    assert.equal(h.canRedo, false)
  })

  it('a new push clears the redo stack', () => {
    const h = createHistory()
    h.push('s1')
    h.undo('s2')
    assert.equal(h.canRedo, true)
    h.push('s3')
    assert.equal(h.canRedo, false)
  })

  it('evicts the oldest snapshot beyond the cap', () => {
    const h = createHistory(2)
    h.push('a'); h.push('b'); h.push('c')   // 'a' evicted
    assert.equal(h.undo('cur'), 'c')
    assert.equal(h.undo('c'), 'b')
    assert.equal(h.undo('b'), null)          // 'a' is gone
  })

  it('clear() empties both stacks', () => {
    const h = createHistory()
    h.push('s1')
    h.undo('s2')
    h.clear()
    assert.equal(h.canUndo, false)
    assert.equal(h.canRedo, false)
  })
})

describe('snapshotLayers', () => {
  const mkGrid = () => ({
    base: [['a', null], [null, 'b']],
    overlay: [[null, 'o'], [null, null]],
    props: [[{ collision: 'wall' }, null], [null, { interaction: { type: 'door' } }]],
  })

  it('copies all three layers', () => {
    const g = mkGrid()
    const s = snapshotLayers(g)
    assert.deepEqual(s, mkGrid())
  })

  it('later mutation of the grid does not leak into the snapshot', () => {
    const g = mkGrid()
    const s = snapshotLayers(g)
    g.base[0][0] = 'CHANGED'
    g.props[0][0].collision = 'walkable'
    assert.equal(s.base[0][0], 'a')
    assert.equal(s.props[0][0].collision, 'wall')
  })
})
