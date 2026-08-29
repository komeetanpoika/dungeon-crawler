import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isCreature, strikeCreature, CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA, updateCreature } from '../renderer/systems/creatures.js'
describe('creature registry', () => {
  it('unregistered types take plain damage; registered hooks decide', () => {
    assert.equal(isCreature({ type: 'maahinen' }), true); assert.equal(isCreature({ type: 'npc' }), false)
    const e = { type: 'maahinen', hp: 10, maxHp: 24 }
    assert.deepEqual(strikeCreature(e, {}, 3), { entity: { ...e, hp: 7, inCombat: true }, absorbed: false, cue: 'melee-hit' })
    CREATURE_HIT.testtype = (e) => ({ entity: e, absorbed: true, cue: 'chop' })
    assert.equal(strikeCreature({ type: 'testtype', hp: 1 }, {}, 5).absorbed, true)
    delete CREATURE_HIT.testtype
  })
  it('updateCreature is a no-op for a type with no update', () => { assert.doesNotThrow(() => updateCreature({ type: 'nakki' }, {}, 0.016)) })
})
