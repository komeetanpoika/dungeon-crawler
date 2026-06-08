import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tickWalk, walkTilt, MAX_TILT } from '../renderer/systems/walk.js'

describe('tickWalk', () => {
  it('advances walkPhase when the entity moves', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)          // first call seeds _wpx/_wpy, no movement yet
    const p0 = e.walkPhase ?? 0
    e.px = 10
    tickWalk(e, 0.016)
    assert.ok(e.walkPhase > p0, 'walkPhase should increase after moving')
  })

  it('does not advance walkPhase when the entity is still', () => {
    const e = { px: 5, py: 5 }
    tickWalk(e, 0.016)
    const p0 = e.walkPhase ?? 0
    tickWalk(e, 0.016)          // px/py unchanged
    assert.equal(e.walkPhase ?? 0, p0)
  })

  it('ramps swayAmp up toward 1 while moving', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 30; i++) { e.px += 2; tickWalk(e, 0.016) }
    assert.ok(e.swayAmp > 0.5, `swayAmp should rise while moving, got ${e.swayAmp}`)
  })

  it('decays swayAmp toward 0 when stopped', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 30; i++) { e.px += 2; tickWalk(e, 0.016) }  // build amp up
    for (let i = 0; i < 60; i++) { tickWalk(e, 0.016) }              // now hold still
    assert.ok(e.swayAmp < 0.01, `swayAmp should decay when idle, got ${e.swayAmp}`)
  })
})

describe('walkTilt', () => {
  it('is exactly 0 when idle (settles upright)', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 60; i++) { tickWalk(e, 0.016) }
    assert.equal(walkTilt(e), 0)
  })

  it('tilt returns to exactly 0 after walking then settling', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 30; i++) { e.px += 3; tickWalk(e, 0.016) }  // build amp + non-zero phase
    for (let i = 0; i < 60; i++) { tickWalk(e, 0.016) }              // settle
    assert.ok(Object.is(walkTilt(e), 0) || Object.is(walkTilt(e), -0), 'tilt should be exactly 0 (including -0)')
  })

  it('is non-zero at some point mid-stride while moving', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    let sawTilt = false
    for (let i = 0; i < 40; i++) { e.px += 3; tickWalk(e, 0.016); if (Math.abs(walkTilt(e)) > 0.5) sawTilt = true }
    assert.ok(sawTilt, 'tilt should be non-zero while walking')
  })

  it('never exceeds MAX_TILT in magnitude', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 200; i++) { e.px += 4; tickWalk(e, 0.016); assert.ok(Math.abs(walkTilt(e)) <= MAX_TILT + 1e-9) }
  })

  it('returns 0 for a fresh entity with no walk state', () => {
    assert.equal(walkTilt({}), 0)
  })
})
