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

  // The kill signal the episodes read (state.creatureKills[type]) is written
  // by game.js, which has no unit tests by design. What is testable here is
  // the predicate it keys off: an unabsorbed strike that takes the creature
  // to 0 hp or below. The wiring itself is covered by live verification.
  it('an unabsorbed strike to 0 hp is what game.js records as a kill', () => {
    const alive = strikeCreature({ type: 'maahinen', hp: 10, maxHp: 24 }, {}, 3)
    assert.equal(alive.absorbed, false)
    assert.equal(alive.entity.hp > 0, true)
    const killed = strikeCreature({ type: 'maahinen', hp: 3, maxHp: 24 }, {}, 3)
    assert.equal(killed.absorbed, false)
    assert.equal(killed.entity.hp <= 0, true)
    const over = strikeCreature({ type: 'maahinen', hp: 2, maxHp: 24 }, {}, 9)
    assert.equal(over.entity.hp <= 0, true)
  })

  // The Näkki carries no hp at all, so the `hp <= 0` kill test can never
  // fire for it — it leaves by feeding, not by dying.
  it('a hp-less creature never trips the hp <= 0 kill test', () => {
    CREATURE_HIT.hpless = e => ({ entity: { ...e }, absorbed: false, cue: 'splash' })
    const r = strikeCreature({ type: 'hpless' }, {}, 4)
    assert.equal(r.entity.hp <= 0, false)
    delete CREATURE_HIT.hpless
  })
})
