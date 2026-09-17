import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer, INVULN_DURATION } from '../renderer/systems/player-damage.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makePlayer, makeShieldContents, makeOutfitContents } from '../renderer/systems/entities.js'

function freshState() {
  return { player: { px: 40, py: 60, hp: 10 }, feedback: makeFeedback() }
}

describe('damagePlayer', () => {
  it("'hit' applies damage, sets invuln, returns true", () => {
    const s = freshState()
    const applied = damagePlayer(s, 3, 'hit')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 7)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
  })

  it("'hit' is blocked while invulnerable (no damage, returns false)", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    const applied = damagePlayer(s, 3, 'hit')
    assert.equal(applied, false)
    assert.equal(s.player.hp, 10)
  })

  it("'dot' always applies and never sets invuln", () => {
    const s = freshState()
    const applied = damagePlayer(s, 1, 'dot')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, undefined)
  })

  it("'dot' applies even while invulnerable, leaving invuln untouched", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    damagePlayer(s, 1, 'dot')
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, 0.5)
  })

  it('queues a player-hurt cue when damage lands', () => {
    const state = freshState()
    state.sfx = makeSfx()
    damagePlayer(state, 3, 'hit')
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['player-hurt'])
    assert.equal(state.sfx.cues[0].px, state.player.px)
  })

  it('queues no cue when i-frames block the hit', () => {
    const state = freshState()
    state.sfx = makeSfx()
    state.player.invulnTimer = 0.5
    damagePlayer(state, 3, 'hit')
    assert.equal(state.sfx.cues.length, 0)
  })
})

describe('damagePlayer with a shield and armour', () => {
  const dressed = (over = {}) => {
    const p = { ...makePlayer(1, 1), px: 40, py: 60, hp: 10, facing: 'east', stamina: 100, ...over }
    return { player: p, feedback: makeFeedback(), sfx: makeSfx() }
  }
  it('a raised shield absorbs a frontal hit: no damage, no i-frames, returns false', () => {
    const s = dressed({ blocking: true })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 3, 'hit', { px: 80, py: 60 }), false)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.invulnTimer ?? 0, 0)
    assert.equal(s.player.stamina, 92)
  })
  it('a hit from behind, a hit with no position, and a dot all get through a raised shield', () => {
    const s = dressed({ blocking: true })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 1, 'hit', { px: 0, py: 60 }), true)
    s.player.invulnTimer = 0
    assert.equal(damagePlayer(s, 1, 'hit'), true)
    assert.equal(damagePlayer(s, 1, 'dot', { px: 80, py: 60 }), true)
    assert.equal(s.player.hp, 7)
  })
  it('worn armour takes protect off every hit, floored at 0, but not off a dot', () => {
    const s = dressed()
    const { type, ...plate } = makeOutfitContents('plate'); s.player.gear.melee.outfit = plate
    assert.equal(damagePlayer(s, 3, 'hit'), true)
    assert.equal(s.player.hp, 9)
    s.player.invulnTimer = 0
    assert.equal(damagePlayer(s, 1, 'hit'), true)     // reduced to 0: still lands, still grants i-frames
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
    assert.equal(damagePlayer(s, 1, 'dot'), true)
    assert.equal(s.player.hp, 8)
  })
  it('the active loadout’s outfit is the one that protects', () => {
    const s = dressed({ attackMode: 'magic' })
    const { type, ...plate } = makeOutfitContents('plate'); s.player.gear.melee.outfit = plate
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 7)
  })
})
