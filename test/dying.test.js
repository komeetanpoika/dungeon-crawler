import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEATH_TIME, beginDying, cullDead, tickDying, dyingAlpha } from '../renderer/systems/dying.js'
import { isEnemy, isHittable, isDead } from '../renderer/systems/factions.js'

const rig = e => e.type === 'rigged'

describe('dying phase', () => {
  it('a rigged monster at 0 hp enters dying instead of being culled', () => {
    const m = { type: 'rigged', hp: 0, attack: { t: 0 } }
    const out = cullDead([m, { type: 'guard', hp: 0 }, { type: 'guard', hp: 3 }], rig)
    assert.deepEqual(out.map(e => e.type), ['rigged', 'guard'])
    assert.equal(m.dying, DEATH_TIME)
    assert.equal(m.attack, null)
  })
  it('does not restart a phase already running', () => {
    const m = { type: 'rigged', hp: -2, dying: 0.2 }
    cullDead([m], rig)
    assert.equal(m.dying, 0.2)
  })
  it('tickDying counts down and drops the expired', () => {
    const m = { type: 'rigged', hp: 0, dying: 0.1 }
    assert.equal(tickDying([m], 0.05).length, 1)
    assert.ok(Math.abs(m.dying - 0.05) < 1e-9)
    assert.equal(tickDying([m], 0.05).length, 0)
  })
  it('a dying monster is neither hittable, an enemy nor dead', () => {
    const m = { type: 'guard', hp: 0, dying: 0.3 }
    assert.equal(isHittable(m), false)
    assert.equal(isEnemy(m), false)
    assert.equal(isDead(m), false)
  })
  it('dyingAlpha holds 1 then ramps to 0 over the last 40 %', () => {
    assert.equal(dyingAlpha({}), 1)
    assert.equal(dyingAlpha({ dying: DEATH_TIME }), 1)
    assert.ok(Math.abs(dyingAlpha({ dying: DEATH_TIME * 0.2 }) - 0.5) < 1e-9)
    assert.equal(dyingAlpha({ dying: 0 }), 0)
  })
})
