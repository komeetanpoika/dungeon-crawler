// PvP 2a's visuals: the pure helpers in renderer/render/pvp-fx.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { comboShake, holdArrows, fenceGlints, drawGlow } from '../renderer/render/pvp-fx.js'
import { WARRIOR_COMBOS, DOUBLE_SHOT } from '../renderer/data/pvp.js'

describe('pvp fx helpers', () => {
  it('comboShake: only a whirl shakes, fading over its life', () => {
    assert.equal(comboShake({ move: null }), 0)
    assert.equal(comboShake({ move: { kind: 'lunge', t: 0 } }), 0)
    assert.equal(comboShake({ move: { kind: 'whirl', t: 0 } }), 5)
    assert.equal(comboShake({ move: { kind: 'whirl', t: WARRIOR_COMBOS.fxDur } }), 0)
    assert.equal(comboShake(null), 0)
  })
  it('holdArrows: one per move, centred over the head', () => {
    assert.deepEqual(holdArrows({ moves: [] }), [])
    const a = holdArrows({ moves: ['e', 'w'] })
    assert.deepEqual(a.map(x => [x.dir, x.dx]), [['e', -4], ['w', 4]])
    assert.equal(a[1].angle, Math.PI)
  })
  it('fenceGlints: each thrust glints for 0.12 s from its time', () => {
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0 }).map(g => g.i), [0])
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0.13 }).map(g => g.i), [1])
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0.25 }).map(g => g.i), [2])
    assert.deepEqual(fenceGlints({ kind: 'lunge', t: 0 }), [])
  })
  it('drawGlow: the band colour of the draw reached, dim below 30 %', () => {
    assert.equal(drawGlow({ charging: null }), null)
    assert.equal(drawGlow({ charging: { t: 0.1, kind: 'double' } }).color, 'rgba(255,255,255,0.35)')
    const full = drawGlow({ charging: { t: DOUBLE_SHOT.full, kind: 'double' } })
    assert.equal(full.color, DOUBLE_SHOT.bands[0].color)
    assert.equal(full.full, true)
  })
})
