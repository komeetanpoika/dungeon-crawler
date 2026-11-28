import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as rig from '../renderer/render/monster-rigs/troll.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { rigContract, recordingCtx, poseOf, inked, STATES } from './helpers/rig-contract.js'

const CHANNELS = [{}, { eyeGlow: 0.5 }, { eyeGlow: 1 }, { slab: 1 }, { slab: 0.5 }, { drum: 1.2 }, { drum: 2.7 }, { stirred: 1 },
  { lift: 0.6, eyeGlow: 0.6 }, { lift: 1, eyeGlow: 1 }, { rear: 1, eyeGlow: 1 }, { bellow: 1 }, { facing: Math.PI }]

rigContract(rig, { channels: CHANNELS })

describe('the troll', () => {
  const P = defaultParams(rig.PARAM_SCHEMA)
  const as = (role, over = {}) => ({ ...P, role, ...over })
  const ops = (params, pose) => { const c = recordingCtx(); rig.drawMonster(c, params, pose, 32); return c.ops }
  const fills = (params, pose) => ops(params, pose).filter(o => o[0] === 'fillRect')
  const colours = (params, pose) => {
    const seen = new Set()
    const ctx = new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: (t, k, v) => { if (k === 'fillStyle') seen.add(String(v).toLowerCase()); t[k] = v; return true },
    })
    rig.drawMonster(ctx, params, pose, 32)
    return seen
  }

  it('draws every role in every state and channel, balanced', () => {
    for (const role of [0, 1, 2, 3]) for (const state of STATES) for (const ch of CHANNELS) {
      const o = ops(as(role), poseOf(state, ch))
      assert.ok(o.filter(x => x[0] === 'fillRect').length > 20, `role ${role} ${state}`)
      assert.equal(o.filter(x => x[0] === 'save').length, o.filter(x => x[0] === 'restore').length)
      assert.ok(inked(rig, as(role), poseOf(state, ch)) > 100)
    }
  })

  it('the four are told apart by what they carry', () => {
    const seen = [0, 1, 2, 3].map(role => JSON.stringify(fills(as(role), poseOf('idle'))))
    assert.equal(new Set(seen).size, 4)
  })

  it('the slab up covers more of him than the slab down, and only the fighter has one', () => {
    const down = inked(rig, as(0), poseOf('idle', { slab: 0 })), up = inked(rig, as(0), poseOf('idle', { slab: 1 }))
    assert.notDeepEqual(fills(as(0), poseOf('idle', { slab: 0 })), fills(as(0), poseOf('idle', { slab: 1 })))
    assert.ok(up !== down)
    assert.deepEqual(fills(as(1), poseOf('idle', { slab: 0 })), fills(as(1), poseOf('idle', { slab: 1 })))
  })

  it('a wind-up reaches higher: the mage\'s staff, the King\'s boulder', () => {
    const top = (params, pose) => Math.min(...fills(params, pose).map(f => f[2]))
    assert.ok(top(as(1), poseOf('idle', { eyeGlow: 1 })) < top(as(1), poseOf('idle')))
    assert.ok(top(as(3), poseOf('idle', { lift: 1 })) < top(as(3), poseOf('idle')))
    assert.notDeepEqual(fills(as(3), poseOf('idle', { rear: 1 })), fills(as(3), poseOf('idle')))
    assert.notDeepEqual(fills(as(3), poseOf('idle', { bellow: 1 })), fills(as(3), poseOf('idle')))
  })

  it('the drummer\'s sticks take turns', () => {
    const a = fills(as(2), poseOf('idle', { drum: 1.1 })), b = fills(as(2), poseOf('idle', { drum: 2.1 })), rest = fills(as(2), poseOf('idle', { drum: 0 }))
    assert.notDeepEqual(a, b)
    assert.notDeepEqual(a, rest)
  })

  it('stirred he has other eyes and steam; struck he is all white', () => {
    const calm = colours(as(0), poseOf('idle')), hot = colours(as(0), poseOf('idle', { stirred: 1 }))
    assert.ok([...hot].some(c => !calm.has(c)), 'a colour the calm one has not')
    assert.ok(inked(rig, as(0), poseOf('idle', { stirred: 1 })) > inked(rig, as(0), poseOf('idle')))
    // (all white but his shadow on the ground)
    assert.deepEqual([...colours(as(0), poseOf('hit'))].filter(c => c !== rig.SHADOW), ['#f8f8f8'])
  })

  it('walks: the legs and the bob change with the clock, and it turns to face left or right', () => {
    const frames = new Set([0, 0.1, 0.2, 0.3, 0.4, 0.5].map(t => JSON.stringify(fills(as(0), poseOf('walk', { t })))))
    assert.ok(frames.size >= 3, `${frames.size} walk frames`)
    // (the same rects, mirrored: more ink left of the middle when he faces west with his slab before him)
    assert.deepEqual(fills(as(0), poseOf('idle', { facing: 0 })), fills(as(0), poseOf('idle', { facing: Math.PI })))
    assert.notDeepEqual(ops(as(0), poseOf('idle', { facing: 0 })), ops(as(0), poseOf('idle', { facing: Math.PI })))
    assert.equal(ops(as(0), poseOf('idle', { facing: Math.PI })).filter(o => o[0] === 'scale' && o[1] === -1).length, 1)
    assert.deepEqual(ops(as(0), poseOf('idle', { facing: 0.3 })), ops(as(0), poseOf('idle', { facing: -0.3 })), 'no turning with the heading')
    assert.equal(ops(as(0), poseOf('idle', { facing: 1.2 })).filter(o => o[0] === 'rotate' && o[1] !== 0).length, 0)
    // the side his hook keeps for him wins over the heading
    assert.deepEqual(ops(as(0), poseOf('idle', { facing: 0, side: -1 })), ops(as(0), poseOf('idle', { facing: Math.PI })))
    assert.deepEqual(ops(as(0), poseOf('idle', { facing: Math.PI, side: 1 })), ops(as(0), poseOf('idle', { facing: 0 })))
  })

  it('swings, and falls', () => {
    assert.notDeepEqual(fills(as(0), poseOf('attack', { stateT: 0.02 })), fills(as(0), poseOf('idle')))
    assert.notDeepEqual(fills(as(0), poseOf('attack', { stateT: 0.02 })), fills(as(0), poseOf('attack', { stateT: 0.25 })))
    assert.notDeepEqual(fills(as(3), poseOf('attack', { stateT: 0.02 })), fills(as(3), poseOf('idle')))
    const bottom = pose => Math.min(...fills(as(0), pose).map(f => f[2]))
    assert.ok(bottom(poseOf('death', { stateT: 0.5 })) > bottom(poseOf('idle')), 'lower once fallen')
  })

  it('the King is the same troll, bigger in drawing, in body and in where his bar goes', () => {
    const kingP = as(3, { scale: 2.2 })
    assert.ok(inked(rig, kingP, poseOf('idle')) > inked(rig, as(3), poseOf('idle')) * 3)
    assert.ok(rig.hitShape(kingP).r > rig.hitShape(P).r)
    assert.ok(rig.hitHalf(kingP) >= rig.hitHalf(P))
    assert.ok(rig.hitHalf(P) >= 8 && rig.hitHalf(kingP) <= 16)
    // (px from the centre, up is negative: canvas.js puts the bar at e.py + drawnTop)
    assert.ok(rig.drawnTop(P, 32) < -16 && rig.drawnTop(kingP, 32) < rig.drawnTop(P, 32) * 1.8)
    // about 1.3 tiles tall at scale 1
    assert.ok(rig.height(P) >= 19 && rig.height(P) <= 23, `${rig.height(P)} art px`)
  })

  it('says where his head, chest and hands are', () => {
    for (const which of ['head', 'chest', 'hand', 'drum']) {
      const a = rig.anchor(as(2), poseOf('idle'), 32, which)
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), which)
    }
    assert.ok(rig.anchor(P, poseOf('idle'), 32, 'head').y < rig.anchor(P, poseOf('idle'), 32, 'chest').y)
    assert.ok(rig.anchor(as(3, { scale: 2.2 }), poseOf('idle'), 32, 'head').y < rig.anchor(P, poseOf('idle'), 32, 'head').y)
    // mirrored with the facing
    assert.equal(rig.anchor(as(1), poseOf('idle', { facing: 0 }), 32, 'hand').x, -rig.anchor(as(1), poseOf('idle', { facing: Math.PI }), 32, 'hand').x)
  })
})
