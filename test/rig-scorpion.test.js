import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as rig from '../renderer/render/monster-rigs/scorpion.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { rigContract, poseOf, inked } from './helpers/rig-contract.js'

rigContract(rig, { channels: [{}, { sink: 1 }, { sink: 0.5 }, { eyeGlow: 0.5 }, { eyeGlow: 1 }] })

describe('the scorpion', () => {
  const P = defaultParams(rig.PARAM_SCHEMA)
  it('buried shows far less than out on the sand', () => {
    assert.ok(inked(rig, P, poseOf('idle', { sink: 1 })) < inked(rig, P, poseOf('idle')) * 0.6)
  })
  it('strikes forward of where it rears', () => {
    // facing east: the sting's farthest pixel lies further east at the strike
    assert.ok(rig.stingReach(P, 1) > rig.stingReach(P, 0.5))
  })
  it('the emperor is bigger in drawing and in body', () => {
    const big = { ...P, scale: 1.8 }
    assert.ok(inked(rig, big, poseOf('idle')) > inked(rig, P, poseOf('idle')) * 2)
    assert.ok(rig.hitShape(big).r > rig.hitShape(P).r)
    assert.ok(rig.hitHalf(big) > rig.hitHalf(P))
    assert.ok(rig.hitHalf(P) >= 8 && rig.hitHalf(big) <= 28)
  })
})
