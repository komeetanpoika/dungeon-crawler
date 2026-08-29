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
  log: [],
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
  it('speak sets a speech bubble and logs the text', () => {
    const state = freshState()
    speak(state, 'Found Longsword!')
    assert.equal(state.feedback.bubble.kind, 'speech')
    assert.equal(state.feedback.bubble.text, 'Found Longsword!')
    assert.deepEqual(state.log, ['Found Longsword!'])
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

  it('log history is capped at five entries', () => {
    const state = freshState()
    for (let i = 0; i < 7; i++) speak(state, `msg ${i}`)
    assert.equal(state.log.length, 5)
    assert.equal(state.log.at(-1), 'msg 6')
  })
})

describe('banner', () => {
  it('announce sets the banner and logs; expires after BANNER_DUR', () => {
    const state = freshState()
    announce(state, 'You step out into the open…')
    assert.equal(state.feedback.banner.text, 'You step out into the open…')
    assert.deepEqual(state.log, ['You step out into the open…'])
    tickFeedback(state.feedback, BANNER_DUR + 0.01)
    assert.equal(state.feedback.banner, null)
  })
})

describe('damagePlayer emits a taken-float', () => {
  it('floats the amount over the player and still logs the message', () => {
    const state = freshState()
    damagePlayer(state, 3, 'hit', 'Ouch! (-3 HP)')
    assert.equal(state.feedback.floats.length, 1)
    assert.deepEqual(state.feedback.floats[0], { px: 100, py: 200, text: '-3', kind: 'taken', t: 0 })
    assert.deepEqual(state.log, ['Ouch! (-3 HP)'])
  })

  it('emits nothing while i-frames block the hit', () => {
    const state = freshState()
    state.player.invulnTimer = 0.5
    damagePlayer(state, 3, 'hit', 'blocked')
    assert.equal(state.feedback.floats.length, 0)
    assert.equal(state.player.hp, 10)
  })

  it('tolerates states without feedback (arena tests build bare states)', () => {
    const state = { player: { px: 0, py: 0, hp: 5, invulnTimer: 0 }, log: [] }
    assert.equal(damagePlayer(state, 2, 'hit', 'msg'), true)
    assert.equal(state.player.hp, 3)
  })
})

describe('toast queue', () => {
  it('queues and drains toasts in order', () => {
    const state = { log: [], feedback: makeFeedback() }
    queueToast(state, { title: 'Talent learned', lines: ['Gust'] })
    queueToast(state, { title: 'Second', lines: [] })
    const drained = drainToasts(state)
    assert.equal(drained.length, 2)
    assert.equal(drained[0].title, 'Talent learned')
    assert.deepEqual(drainToasts(state), [])
  })
  it('logs the toast title so state.log history stays complete', () => {
    const state = { log: [], feedback: makeFeedback() }
    queueToast(state, { title: 'You awaken back in Aspengrove…', lines: [] })
    assert.equal(state.log.at(-1), 'You awaken back in Aspengrove…')
  })
  it('is a no-op without feedback state', () => {
    assert.doesNotThrow(() => queueToast({ log: [] }, { title: 'x', lines: [] }))
  })
})

describe('speakFrom', () => {
  it('anchors the bubble to the speaker and logs the line', () => {
    const state = { log: [], feedback: makeFeedback() }
    speakFrom(state, { id: 'npc:x:1' }, 'Hello.')
    assert.deepEqual(state.feedback.bubble, { text: 'Hello.', kind: 'speech', t: 0, anchorId: 'npc:x:1' })
    assert.deepEqual(state.log, ['Hello.'])
  })
})
