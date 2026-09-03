import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stepFade } from '../renderer/systems/fade.js'

describe('stepFade', () => {
  it('starts at the target when the entity has no fadeA yet', () => {
    assert.equal(stepFade({}, 0, 0.016), 0)
    assert.equal(stepFade({}, 1, 0.016), 1)
  })
  it('rises toward 1 at 1/inTime per second and clamps', () => {
    const e = { fadeA: 0 }
    stepFade(e, 1, 0.25, { inTime: 0.5 })
    assert.ok(Math.abs(e.fadeA - 0.5) < 1e-9)
    stepFade(e, 1, 5, { inTime: 0.5 })
    assert.equal(e.fadeA, 1)
  })
  it('falls toward 0 at 1/outTime per second', () => {
    const e = { fadeA: 1 }
    stepFade(e, 0, 0.175, { outTime: 0.35 })
    assert.ok(Math.abs(e.fadeA - 0.5) < 1e-9)
    stepFade(e, 0, 5, { outTime: 0.35 })
    assert.equal(e.fadeA, 0)
  })
  it('returns the new value', () => {
    const e = { fadeA: 0.2 }
    assert.equal(stepFade(e, 0.2, 1), 0.2)
  })
})
