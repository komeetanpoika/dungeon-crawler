import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TALENTS, hasTalent, grantTalent, RUSH_TALENT_LADDER, MAP_CLEAR_TALENTS } from '../renderer/systems/talents.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const mkState = () => ({ player: { talents: [] }, feedback: makeFeedback(), log: [] })

describe('talent registry', () => {
  it('defines the three launch talents', () => {
    for (const id of ['ranged_stance', 'magic_stance', 'heavy_weapons']) {
      assert.ok(TALENTS[id]?.name, id)
    }
  })

  it('rush ladder and map rewards reference real talents', () => {
    for (const id of [...Object.values(RUSH_TALENT_LADDER), ...Object.values(MAP_CLEAR_TALENTS)])
      assert.ok(TALENTS[id], id)
  })
})

describe('grantTalent', () => {
  it('grants once, reports newness, and celebrates', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'magic_stance'), true)
    assert.ok(hasTalent(state.player, 'magic_stance'))
    assert.equal(grantTalent(state, 'magic_stance'), false)     // idempotent
    assert.deepEqual(state.player.talents, ['magic_stance'])
  })

  it('refuses unknown ids', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'levitation'), false)
    assert.deepEqual(state.player.talents, [])
  })

  it('tolerates a player without a talents array', () => {
    const state = { player: {}, feedback: makeFeedback(), log: [] }
    assert.equal(grantTalent(state, 'ranged_stance'), true)
    assert.ok(hasTalent(state.player, 'ranged_stance'))
    assert.equal(hasTalent({ }, 'ranged_stance'), false)
  })

  it('queues a talent-learned cue only when newly learned', () => {
    const state = { player: {}, log: [], feedback: makeFeedback(), sfx: makeSfx() }
    grantTalent(state, 'ranged_stance')
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['talent-learned'])
    grantTalent(state, 'ranged_stance')          // already known — no new cue
    assert.equal(state.sfx.cues.length, 1)
  })
})
