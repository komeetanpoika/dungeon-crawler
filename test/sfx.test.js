import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeSfx, sfx, drainSfx, CUE_NAMES } from '../renderer/systems/sfx.js'

describe('sfx queue', () => {
  it('makeSfx starts empty and unmuted by default', () => {
    assert.deepEqual(makeSfx(), { cues: [], muted: false })
    assert.equal(makeSfx(true).muted, true)
  })

  it('sfx pushes a named cue with position', () => {
    const state = { sfx: makeSfx() }
    sfx(state, 'melee-hit', { px: 96, py: 128 })
    assert.deepEqual(state.sfx.cues, [{ name: 'melee-hit', px: 96, py: 128 }])
  })

  it('sfx without position queues a positionless cue', () => {
    const state = { sfx: makeSfx() }
    sfx(state, 'ui-open')
    assert.equal(state.sfx.cues.length, 1)
    assert.equal(state.sfx.cues[0].name, 'ui-open')
    assert.equal(state.sfx.cues[0].px, undefined)
  })

  it('sfx is a safe no-op when state.sfx is missing', () => {
    assert.doesNotThrow(() => sfx({}, 'pickup'))
    assert.doesNotThrow(() => sfx(null, 'pickup'))
  })

  it('drainSfx returns queued cues and clears the queue', () => {
    const state = { sfx: makeSfx() }
    sfx(state, 'pickup')
    sfx(state, 'heal')
    const drained = drainSfx(state)
    assert.deepEqual(drained.map(c => c.name), ['pickup', 'heal'])
    assert.deepEqual(state.sfx.cues, [])
  })

  it('drainSfx returns [] when state.sfx is missing', () => {
    assert.deepEqual(drainSfx({}), [])
    assert.deepEqual(drainSfx(null), [])
  })

  it('CUE_NAMES covers the starter set', () => {
    for (const name of ['melee-swing', 'melee-hit', 'player-hurt', 'pickup', 'ui-open'])
      assert.ok(CUE_NAMES.includes(name), `${name} missing from CUE_NAMES`)
    assert.equal(new Set(CUE_NAMES).size, CUE_NAMES.length, 'duplicate cue names')
  })
})
