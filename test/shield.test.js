import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SHIELD_DROP, BLOCK_HALF_ARC, heldShield, tickShield, inBlockArc, tryBlock } from '../renderer/systems/shield.js'
import { makePlayer, makeShieldContents } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const buckler = () => { const { type, ...s } = makeShieldContents('buckler'); return { kind: 'shield', ...s } }
const mk = (over = {}) => {
  const p = { ...makePlayer(1, 1), px: 100, py: 100, facing: 'east', stamina: 100, ...over }
  p.gear.melee.off = buckler()
  return p
}
const state = p => ({ player: p, feedback: makeFeedback(), sfx: makeSfx() })

describe('raising the shield', () => {
  it('blocks only while Q is held, a shield is in the offhand, and stamina remains', () => {
    const p = mk()
    assert.equal(tickShield(p, true, 0.016), true)
    assert.equal(p.blocking, true)
    assert.equal(tickShield(p, false, 0.016), false)
    p.gear.melee.off = { kind: 'consumable', item: 'potion' }
    assert.equal(tickShield(p, true, 0.016), false)
    assert.equal(heldShield(p), null)
    const q = mk({ stamina: 0 })
    assert.equal(tickShield(q, true, 0.016), false)
  })
  it('stays down for SHIELD_DROP after the tank empties', () => {
    const p = mk({ shieldDropT: SHIELD_DROP })
    assert.equal(tickShield(p, true, 0.1), false)
    tickShield(p, true, SHIELD_DROP)
    assert.equal(tickShield(p, true, 0.016), true)
  })
})

describe('the block arc', () => {
  it('covers 60 degrees either side of the facing', () => {
    const p = mk({ blocking: true })
    assert.equal(inBlockArc(p, { px: 140, py: 100 }), true)                           // dead ahead
    assert.equal(inBlockArc(p, { px: 120, py: 100 + 20 * Math.tan(BLOCK_HALF_ARC - 0.05) }), true)
    assert.equal(inBlockArc(p, { px: 120, py: 100 + 20 * Math.tan(BLOCK_HALF_ARC + 0.05) }), false)
    assert.equal(inBlockArc(p, { px: 60, py: 100 }), false)                           // behind
    assert.equal(inBlockArc(p, null), false)
    assert.equal(inBlockArc(p, { px: NaN, py: 1 }), false)
  })
  it('follows the facing', () => {
    const p = mk({ blocking: true, facing: 'north' })
    assert.equal(inBlockArc(p, { px: 100, py: 60 }), true)
    assert.equal(inBlockArc(p, { px: 100, py: 140 }), false)
  })
})

describe('tryBlock', () => {
  it('absorbs a frontal hit for the shield’s stamina and cues the block', () => {
    const p = mk({ blocking: true })
    const s = state(p)
    assert.equal(tryBlock(s, { px: 140, py: 100 }), true)
    assert.equal(p.stamina, 92)
    assert.equal(p.blockedHit, true)
    assert.deepEqual(s.sfx.cues.map(c => c.name), ['shield-block'])
  })
  it('does nothing when not blocking or when the hit comes from behind', () => {
    const p = mk({ blocking: false })
    assert.equal(tryBlock(state(p), { px: 140, py: 100 }), false)
    p.blocking = true
    assert.equal(tryBlock(state(p), { px: 60, py: 100 }), false)
    assert.equal(p.stamina, 100)
  })
  it('a block that empties the tank drops the shield for SHIELD_DROP and flashes the bar', () => {
    const p = mk({ blocking: true, stamina: 5 })
    assert.equal(tryBlock(state(p), { px: 140, py: 100 }), true)
    assert.equal(p.stamina, 0)
    assert.equal(p.blocking, false)
    assert.equal(p.shieldDropT, SHIELD_DROP)
    assert.equal(p.staminaRefusedT, 0.4)
  })
  it('does nothing when blocking is stale and no shield is currently held', () => {
    const p = mk({ blocking: true })
    p.gear.melee.off = { kind: 'consumable', item: 'potion' }
    const s = state(p)
    assert.equal(tryBlock(s, { px: 140, py: 100 }), false)
    assert.equal(p.stamina, 100)
    assert.deepEqual(s.sfx.cues, [])
  })
})
