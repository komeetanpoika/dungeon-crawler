import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePreviewClock, previewZoom } from '../tools/monster-studio/preview-clock.js'
import { makeCutoutRig, CUTOUT_SCHEMA } from '../renderer/render/monster-rigs/cutout.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'

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
  it('faces the way the drawing does, so the preview draws it unmirrored and shows the lunge', () => {
    assert.equal(makePreviewClock().pose(0, {}).facing, Math.PI)               // a cut faces left unless it says right
    assert.equal(makePreviewClock({ faces: 'left' }).pose(0, {}).facing, Math.PI)
    assert.equal(makePreviewClock({ faces: 'right' }).pose(0, {}).facing, 0)
    const recorder = () => { const t = { ops: [] }; return new Proxy(t, { get: (o, k) => (k in o ? o[k] : (...a) => { o.ops.push([k, ...a]) }), set: (o, k, v) => { o[k] = v; return true } }) }
    for (const faces of ['left', 'right']) {
      const parts = { figure: { w: 40, h: 60 }, view: 'front', faces, points: {},
        pieces: [{ id: 'torso', role: 'torso', side: null, parent: null, z: 0, pivot: [20, 30], rect: [0, 0, 20, 30], at: [10, 15], cap: null }] }
      const rig = makeCutoutRig({ id: 'p', parts, imageUrl: null })
      const params = { ...defaultParams(CUTOUT_SCHEMA), lunge: 0.5, anims: { attack: STRIKE } }
      const c = makePreviewClock({ faces })
      c.select('attack', params.anims, 0)
      const ctx = recorder()
      rig.drawMonster(ctx, params, { t: 0.43, stateT: 0, seed: 0, ...c.pose(0.43, params.anims) }, 32) // on the hit
      assert.ok(!ctx.ops.some(o => o[0] === 'scale' && o[1] === -1), `faces ${faces}: drawn as drawn`)
      const lunge = ctx.ops.find(o => o[0] === 'translate')[1]
      assert.equal(lunge, (faces === 'left' ? -1 : 1) * Math.round(0.5 * 32), `faces ${faces}: lunges the way it faces`)
    }
  })
  it('previewZoom opens at 2 when the tallest pose fits, steps down until it does, never below 1', () => {
    const W = 380, H = 400, origin = { x: 0.5, y: 0.82 }                       // 328 px above the centre, 190 across
    assert.equal(previewZoom({ top: -100, halfWidth: 60 }, W, H, origin), 2)
    assert.equal(previewZoom({ top: -200, halfWidth: 60 }, W, H, origin), 1.5)  // 400 px at 2 > 320; 300 at 1.5 fits
    assert.equal(previewZoom({ top: -100, halfWidth: 150 }, W, H, origin), 1)   // too wide at 2 and 1.5
    assert.equal(previewZoom({ top: -900, halfWidth: 60 }, W, H, origin), 1)    // never below the slider's floor
    assert.equal(previewZoom({ top: null }, W, H, origin), 2)                    // a rig without drawnTop
  })
})
