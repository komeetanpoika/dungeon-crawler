// What every shape-drawn rig owes the registry, checked on a recording
// context and on the tools' software canvas: a valid schema, a drawing in
// every state at the schema's defaults and extremes, balanced save/restore,
// a deterministic op stream, and only what both canvases can draw
// (fillRect in #rrggbb).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../../renderer/render/monster-rigs/schema.js'
import { makeSoftCanvas } from '../../tools/monster-cutter/soft-canvas.js'

export function recordingCtx() {
  const target = { ops: [] }
  return new Proxy(target, {
    get(t, k) { return k in t ? t[k] : (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}
export const STATES = ['idle', 'walk', 'attack', 'hit', 'death']
export const poseOf = (state, over = {}) =>
  ({ t: 1.25, state, stateT: 0.1, facing: 0.3, speed01: state === 'walk' ? 1 : 0, seed: 7, sink: 0, burn: 0, flicker: 0, eyeGlow: 0, ...over })

// Opaque pixels a pose leaves on a 256 px software canvas at S = 32.
export function inked(rig, params, pose) {
  const { ctx, img } = makeSoftCanvas(256, 256)
  ctx.translate(128, 128)
  rig.drawMonster(ctx, params, pose, 32)
  let n = 0
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 0) n++
  return n
}

export function rigContract(rig, { channels = [{}] } = {}) {
  const extremes = which => Object.fromEntries(rig.PARAM_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))
  describe(`${rig.RIG_ID} rig contract`, () => {
    it('has a valid schema', () => assert.deepEqual(schemaErrors(rig.PARAM_SCHEMA), []))
    for (const state of STATES) it(`draws in state "${state}" at defaults and both extremes, on both canvases`, () => {
      for (const params of [defaultParams(rig.PARAM_SCHEMA), extremes('min'), extremes('max')]) for (const ch of channels) {
        const ctx = recordingCtx()
        rig.drawMonster(ctx, params, poseOf(state, ch), 32)
        assert.ok(ctx.ops.length > 4, `${state}: ${ctx.ops.length} ops`)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
        assert.ok(inked(rig, params, poseOf(state, ch)) > 0)
      }
    })
    it('is deterministic', () => {
      const a = recordingCtx(), b = recordingCtx()
      rig.drawMonster(a, defaultParams(rig.PARAM_SCHEMA), poseOf('walk'), 32)
      rig.drawMonster(b, defaultParams(rig.PARAM_SCHEMA), poseOf('walk'), 32)
      assert.deepEqual(a.ops, b.ops)
    })
  })
}
