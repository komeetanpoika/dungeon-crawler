import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applySlow, applyRoot, applyFreeze, tickStatus, shatterBonus } from '../renderer/systems/status.js'

describe('applySlow / applyRoot / applyFreeze', () => {
  it('applySlow sets slowTimer and slowMul', () => {
    const e = {}
    applySlow(e, 0.4, 2)
    assert.equal(e.slowTimer, 2)
    assert.equal(e.slowMul, 0.4)
  })

  it('applyRoot sets rootTimer', () => {
    const e = {}
    applyRoot(e, 1.5)
    assert.equal(e.rootTimer, 1.5)
  })

  it('applyFreeze sets stunTimer (max of current and dur) and frozen', () => {
    const e = { stunTimer: 0.5 }
    applyFreeze(e, 2)
    assert.equal(e.stunTimer, 2)
    assert.equal(e.frozen, true)
    // a shorter freeze does not shorten an existing longer stun
    applyFreeze(e, 0.1)
    assert.equal(e.stunTimer, 2)
    assert.equal(e.frozen, true)
  })
})

describe('tickStatus', () => {
  it('decrements slowTimer and rootTimer by delta', () => {
    const e = { slowTimer: 1, rootTimer: 1, stunTimer: 0 }
    tickStatus(e, 0.4)
    assert.equal(Math.round(e.slowTimer * 10) / 10, 0.6)
    assert.equal(Math.round(e.rootTimer * 10) / 10, 0.6)
  })

  it('clears frozen once stunTimer counts down to zero', () => {
    // stunTimer itself is decremented by game.js's existing enemy loop, not
    // by tickStatus — simulate that here to isolate tickStatus's own job.
    const e = { stunTimer: 0.3, frozen: true }
    e.stunTimer -= 0.2
    tickStatus(e, 0.2)
    assert.equal(e.frozen, true, 'still frozen mid-stun')
    e.stunTimer -= 0.2
    tickStatus(e, 0.2)
    assert.ok(e.stunTimer <= 0)
    assert.equal(e.frozen, false, 'frozen clears once the stun ends')
  })

  it('is a no-op on an enemy with no status fields set', () => {
    const e = {}
    assert.doesNotThrow(() => tickStatus(e, 0.5))
  })
})

describe('shatterBonus', () => {
  it('returns 2 once for a frozen enemy, then clears frozen and returns 0', () => {
    const e = { frozen: true, stunTimer: 5 }
    assert.equal(shatterBonus(e), 2)
    assert.equal(e.frozen, false)
    assert.equal(shatterBonus(e), 0)
  })

  it('returns 0 for a non-frozen enemy', () => {
    const e = {}
    assert.equal(shatterBonus(e), 0)
  })
})
