import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as rig from '../renderer/render/monster-rigs/sandworm.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { makeSoftCanvas } from '../tools/monster-cutter/soft-canvas.js'
import { rigContract, poseOf, inked } from './helpers/rig-contract.js'

rigContract(rig, { channels: [{}, { sink: 1 }, { sink: 0.5 }, { sink: 1, flicker: 0.6 }, { eyeGlow: 1 }, { sink: 1, trail: [{ x: 20, y: 0, a: 0.8 }, { x: 44, y: 6, a: 0.3 }] }] })

// The topmost inked row of a pose, in px above the centre at S = 32.
function top(params, pose) {
  const { ctx, img } = makeSoftCanvas(256, 256)
  ctx.translate(128, 160)
  rig.drawMonster(ctx, params, pose, 32)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (img.rgba[(y * 256 + x) * 4 + 3] > 0) return 160 - y
  return 0
}

describe('the sand worm', () => {
  const P = defaultParams(rig.PARAM_SCHEMA)
  it('rises out of the sand as its sink falls', () => {
    const under = top(P, poseOf('idle', { sink: 1 })), half = top(P, poseOf('idle', { sink: 0.5 })), up = top(P, poseOf('idle', { sink: 0 }))
    assert.ok(under < 20, `the mound is low (${under})`)
    assert.ok(half > under + 8 && up > half + 8, `${under} < ${half} < ${up}`)
    assert.ok(up >= P.height * 32 * 0.8)
  })
  it('says where its drawing tops out, for the health bar', () => {
    assert.ok(rig.drawnTop(P, 32) >= P.height * 32 * 0.8)
  })
  it('the tell marks the ground round it', () => {
    assert.ok(inked(rig, P, poseOf('idle', { sink: 1, flicker: 1 })) > inked(rig, P, poseOf('idle', { sink: 1 })) * 1.3)
  })
  it('a furrow trails behind the mound', () => {
    assert.ok(inked(rig, P, poseOf('idle', { sink: 1, trail: [{ x: 30, y: 0, a: 1 }, { x: 60, y: 0, a: 0.5 }] })) > inked(rig, P, poseOf('idle', { sink: 1 })))
  })
  it('has a body to hit', () => {
    const h = rig.hitShape(P)
    assert.ok(h.r >= 8 && h.r <= 20)
    assert.ok(rig.hitHalf(P) >= 8 && rig.hitHalf(P) <= 28)
  })
})
