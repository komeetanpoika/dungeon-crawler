import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TALENTS, hasTalent, grantTalent, RUSH_START_TALENTS } from '../renderer/systems/talents.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const mkState = () => ({ player: { talents: [] }, feedback: makeFeedback() })

describe('talent registry', () => {
  it('defines ski-legs and no stance talents', () => {
    assert.deepEqual(Object.keys(TALENTS), ['ski_legs'])
  })

  it('a rush run starts with every talent', () => {
    assert.deepEqual([...RUSH_START_TALENTS].sort(), Object.keys(TALENTS).sort())
  })
})

describe('grantTalent', () => {
  it('grants once, reports newness, and celebrates', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'ski_legs'), true)
    assert.ok(hasTalent(state.player, 'ski_legs'))
    assert.equal(grantTalent(state, 'ski_legs'), false)     // idempotent
    assert.deepEqual(state.player.talents, ['ski_legs'])
  })

  it('refuses unknown ids', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'levitation'), false)
    assert.equal(grantTalent(state, 'magic_stance'), false)
    assert.deepEqual(state.player.talents, [])
  })

  it('tolerates a player without a talents array', () => {
    const state = { player: {}, feedback: makeFeedback() }
    assert.equal(grantTalent(state, 'ski_legs'), true)
    assert.ok(hasTalent(state.player, 'ski_legs'))
    assert.equal(hasTalent({ }, 'ski_legs'), false)
  })

  it('queues a talent-learned cue only when newly learned', () => {
    const state = { player: {}, feedback: makeFeedback(), sfx: makeSfx() }
    grantTalent(state, 'ski_legs')
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['talent-learned'])
    grantTalent(state, 'ski_legs')          // already known — no new cue
    assert.equal(state.sfx.cues.length, 1)
  })
})

describe('ski-legs', () => {
  it('is a real talent with a name and a description', () => {
    assert.ok(TALENTS.ski_legs?.name)
    assert.ok(TALENTS.ski_legs?.desc)
  })
  it('grants once and reports only the first time', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'ski_legs'), true)
    assert.equal(grantTalent(state, 'ski_legs'), false)
    assert.equal(hasTalent(state.player, 'ski_legs'), true)
  })
})
