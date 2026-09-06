import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeFeedback, addFloat, tickFeedback, speak, think, announce, speakFrom,
  queueToast, drainToasts,
  FLOAT_DUR, BUBBLE_DUR, BANNER_DUR,
} from '../renderer/systems/feedback.js'
import { damagePlayer } from '../renderer/systems/player-damage.js'

const freshState = () => ({
  player: { px: 100, py: 200, hp: 10, invulnTimer: 0 },
  feedback: makeFeedback(),
})

describe('floats', () => {
  it('addFloat records position, text and kind at age 0', () => {
    const fb = makeFeedback()
    addFloat(fb, { px: 10, py: 20, text: '-3', kind: 'taken' })
    assert.deepEqual(fb.floats, [{ px: 10, py: 20, text: '-3', kind: 'taken', t: 0 }])
  })

  it('tickFeedback ages floats and drops the expired', () => {
    const fb = makeFeedback()
    addFloat(fb, { px: 0, py: 0, text: '-1', kind: 'dealt' })
    tickFeedback(fb, FLOAT_DUR / 2)
    assert.equal(fb.floats.length, 1)
    assert.ok(Math.abs(fb.floats[0].t - FLOAT_DUR / 2) < 1e-9)
    tickFeedback(fb, FLOAT_DUR)
    assert.equal(fb.floats.length, 0)
  })
})

describe('bubbles', () => {
  it('speak sets a speech bubble', () => {
    const state = freshState()
    speak(state, 'Found Longsword!')
    assert.equal(state.feedback.bubble.kind, 'speech')
    assert.equal(state.feedback.bubble.text, 'Found Longsword!')
  })

  it('think sets a thought bubble', () => {
    const state = freshState()
    think(state, 'The door is locked…')
    assert.equal(state.feedback.bubble.kind, 'thought')
  })

  it('a new bubble replaces the old and resets its age', () => {
    const state = freshState()
    speak(state, 'first')
    tickFeedback(state.feedback, 1)
    think(state, 'second')
    assert.equal(state.feedback.bubble.text, 'second')
    assert.equal(state.feedback.bubble.t, 0)
  })

  it('bubbles expire after BUBBLE_DUR', () => {
    const state = freshState()
    speak(state, 'gone soon')
    tickFeedback(state.feedback, BUBBLE_DUR + 0.01)
    assert.equal(state.feedback.bubble, null)
  })
})

describe('banner', () => {
  it('announce sets the banner; expires after BANNER_DUR', () => {
    const state = freshState()
    announce(state, 'You step out into the open…')
    assert.equal(state.feedback.banner.text, 'You step out into the open…')
    tickFeedback(state.feedback, BANNER_DUR + 0.01)
    assert.equal(state.feedback.banner, null)
  })
})

describe('damagePlayer emits a taken-float', () => {
  it('floats the amount over the player', () => {
    const state = freshState()
    damagePlayer(state, 3, 'hit')
    assert.equal(state.feedback.floats.length, 1)
    assert.deepEqual(state.feedback.floats[0], { px: 100, py: 200, text: '-3', kind: 'taken', t: 0 })
  })

  it('emits nothing while i-frames block the hit', () => {
    const state = freshState()
    state.player.invulnTimer = 0.5
    damagePlayer(state, 3, 'hit')
    assert.equal(state.feedback.floats.length, 0)
    assert.equal(state.player.hp, 10)
  })

  it('tolerates states without feedback (arena tests build bare states)', () => {
    const state = { player: { px: 0, py: 0, hp: 5, invulnTimer: 0 } }
    assert.equal(damagePlayer(state, 2, 'hit'), true)
    assert.equal(state.player.hp, 3)
  })
})

describe('toast queue', () => {
  it('queues and drains toasts in order', () => {
    const state = { feedback: makeFeedback() }
    queueToast(state, { title: 'Talent learned', lines: ['Gust'] })
    queueToast(state, { title: 'Second', lines: [] })
    const drained = drainToasts(state)
    assert.equal(drained.length, 2)
    assert.equal(drained[0].title, 'Talent learned')
    assert.deepEqual(drainToasts(state), [])
  })
  it('is a no-op without feedback state', () => {
    assert.doesNotThrow(() => queueToast({}, { title: 'x', lines: [] }))
  })
})

describe('speakFrom', () => {
  it('anchors the bubble to the speaker', () => {
    const state = { feedback: makeFeedback() }
    speakFrom(state, { id: 'npc:x:1' }, 'Hello.')
    assert.deepEqual(state.feedback.bubble, { text: 'Hello.', kind: 'speech', t: 0, anchorId: 'npc:x:1' })
  })
})
