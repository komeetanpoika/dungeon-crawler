import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePreviewClock } from '../tools/monster-studio/preview-clock.js'

const STRIKE = { phases: [{ time: 0.30, pose: {} }, { time: 0.35, pose: {} }, { time: 0.08, hit: true, pose: {} }] }
describe('preview clock', () => {
  it('loops the attack: windup then follow-through, again', () => {
    const c = makePreviewClock()
    c.select('attack', { attack: STRIKE }, 0)
    assert.equal(c.pose(0.2, { attack: STRIKE }).attack.phase, 'windup')
    const s = c.pose(0.5, { attack: STRIKE }).attack
    assert.equal(s.phase, 'swing'); assert.ok(Math.abs(s.t - 0.07) < 1e-9)
    const again = c.pose(0.73 + 0.1, { attack: STRIKE }).attack
    assert.equal(again.phase, 'windup'); assert.ok(Math.abs(again.t - 0.1) < 1e-9)
    assert.equal(c.pose(0.2, { attack: STRIKE }).state, 'attack')
  })
  it('walk sets speed01 and animT; switching records a blend', () => {
    const c = makePreviewClock()
    c.select('idle', {}, 0)
    c.select('walk', {}, 1)
    const p = c.pose(1.04, {})
    assert.equal(p.state, 'walk'); assert.equal(p.speed01, 1)
    assert.ok(Math.abs(p.animT - 0.04) < 1e-9)
    assert.equal(p.blend.from, 'idle'); assert.ok(Math.abs(p.blend.t - 0.04) < 1e-9)
  })
})
