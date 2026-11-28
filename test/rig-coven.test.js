import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as crone from '../renderer/render/monster-rigs/crone.js'
import * as para from '../renderer/render/monster-rigs/para.js'
import * as viper from '../renderer/render/monster-rigs/viper.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { makeSoftCanvas } from '../tools/monster-cutter/soft-canvas.js'
import { rigContract, recordingCtx, poseOf, inked, STATES } from './helpers/rig-contract.js'

const E = 0, W = Math.PI, N = -Math.PI / 2

rigContract(crone, { channels: [{}, { eyeGlow: 0.5 }, { eyeGlow: 1 }, { knit: 1 }, { cup: 1 }, { point: 1 }, { scream: 1 }, { facing: W }] })
rigContract(para, { channels: [{}, { carry: 1 }, { cower: 1 }, { raspberry: 1 }, { carry: 1, cower: 1 }, { facing: W }] })
rigContract(viper, { channels: [{}, { eyeGlow: 0.5 }, { eyeGlow: 1 }, { facing: N }, { facing: Math.PI / 4 }] })

// What a pose inks on a 256 px software canvas at S = 32: the box of it, in
// px from the entity's centre (y up is negative), and how many pixels are
// nearer `tint` than anything else asked about.
function shot(rig, params, pose) {
  const { ctx, img } = makeSoftCanvas(256, 256)
  ctx.translate(128, 128)
  rig.drawMonster(ctx, params, pose, 32)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0, green = 0, red = 0
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const o = (y * 256 + x) * 4
    if (!img.rgba[o + 3]) continue
    n++
    minX = Math.min(minX, x - 128); maxX = Math.max(maxX, x - 128)
    minY = Math.min(minY, y - 128); maxY = Math.max(maxY, y - 128)
    const [r, g, b] = [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]]
    if (g > 150 && g > r * 1.25 && g > b * 1.4) green++
    if (r > 150 && r > g * 2 && r > b * 2) red++
  }
  return { minX, maxX, minY, maxY, n, green, red }
}
const ops = (rig, params, pose) => { const c = recordingCtx(); rig.drawMonster(c, params, pose, 32); return JSON.stringify(c.ops) }

describe('the crone', () => {
  const P = defaultParams(crone.PARAM_SCHEMA)
  const witch = { ...P, role: 0 }, kuppari = { ...P, role: 1 }, syo = { ...P, role: 2, scale: 2 }

  it('every role draws in every state and under every channel', () => {
    for (const params of [witch, kuppari, syo]) for (const state of STATES)
      for (const ch of [{}, { eyeGlow: 0.6 }, { eyeGlow: 1 }, { knit: 1 }, { cup: 1 }, { point: 1 }, { scream: 1 }])
        assert.ok(inked(crone, params, poseOf(state, ch)) > 40, `role ${params.role} ${state} ${JSON.stringify(ch)}`)
  })

  it('stands taller than the hero, and thin', () => {
    const b = shot(crone, witch, poseOf('idle', { facing: E }))
    assert.ok(b.maxY - b.minY > 36, `${b.maxY - b.minY} px tall`)
    assert.ok(b.maxY <= 16 && b.maxY >= 10, `feet at ${b.maxY}`)
    assert.ok(b.maxX - b.minX < b.maxY - b.minY, 'taller than wide')
  })

  it('is flipped left and right by her facing, never turned', () => {
    const east = shot(crone, witch, poseOf('idle', { facing: E, eyeGlow: 1 })), west = shot(crone, witch, poseOf('idle', { facing: W, eyeGlow: 1 }))
    assert.ok(east.maxX > -east.minX + 4, 'the arm points east')
    assert.ok(-west.minX > west.maxX + 4, 'and west')
    assert.equal(east.maxY, west.maxY)
    // (looking north or south she keeps the side she had: no rotation at all)
    assert.ok(!ops(crone, witch, poseOf('idle', { facing: N })).includes('"rotate"'))
  })

  it('the witch points with a green glow at her fingertip, further out than her idle arm', () => {
    const idle = shot(crone, witch, poseOf('idle', { facing: E })), half = shot(crone, witch, poseOf('idle', { facing: E, eyeGlow: 0.5 })), full = shot(crone, witch, poseOf('idle', { facing: E, eyeGlow: 1 }))
    assert.ok(full.maxX > idle.maxX + 4, `${idle.maxX} -> ${full.maxX}`)
    assert.equal(idle.green, 0)
    assert.ok(half.green > 0 && full.green > half.green, `${half.green} -> ${full.green}`)
  })

  it('knits: the needles click from frame to frame', () => {
    const a = ops(crone, witch, poseOf('idle', { knit: 1, t: 0 })), b = ops(crone, witch, poseOf('idle', { knit: 1, t: 0.13 }))
    assert.notEqual(a, b)
    assert.notEqual(a, ops(crone, witch, poseOf('idle', { t: 0 })))
  })

  it('the kuppari holds her horn out to cup, red at its mouth', () => {
    const idle = shot(crone, kuppari, poseOf('idle', { facing: E })), cup = shot(crone, kuppari, poseOf('idle', { facing: E, cup: 1 }))
    assert.ok(cup.maxX > idle.maxX + 2, `${idle.maxX} -> ${cup.maxX}`)
    assert.ok(cup.red > idle.red)
    assert.notEqual(ops(crone, kuppari, poseOf('idle')), ops(crone, witch, poseOf('idle')))
  })

  it('Syöjätär is about twice the witch, spits with her head back and screams with her arms up', () => {
    const w = shot(crone, witch, poseOf('idle', { facing: E })), s = shot(crone, syo, poseOf('idle', { facing: E }))
    assert.ok(s.maxY - s.minY > (w.maxY - w.minY) * 1.7, `${w.maxY - w.minY} -> ${s.maxY - s.minY}`)
    assert.ok(Math.abs(s.maxY - w.maxY) <= 4, 'on the same ground')
    assert.ok(s.green > 0, 'snakes in her hair')
    const idle = ops(crone, syo, poseOf('idle', { facing: E }))
    const spit = ops(crone, syo, poseOf('idle', { facing: E, eyeGlow: 1 })), scream = ops(crone, syo, poseOf('idle', { facing: E, scream: 1 }))
    assert.notEqual(spit, idle); assert.notEqual(scream, idle); assert.notEqual(spit, scream)
    const up = shot(crone, syo, poseOf('idle', { facing: E, scream: 1 }))
    assert.ok(up.maxX - up.minX > s.maxX - s.minX, 'arms flung wide')
  })

  it('walks: the frames of the cycle differ', () => {
    for (const params of [witch, kuppari, syo]) {
      const frames = new Set([0, 0.1, 0.2, 0.3, 0.4, 0.5].map(t => ops(crone, params, poseOf('walk', { t }))))
      assert.ok(frames.size >= 2, `role ${params.role}`)
    }
  })

  it('flashes white when hit and lies down to die', () => {
    const hit = shot(crone, witch, poseOf('hit')), idle = shot(crone, witch, poseOf('idle'))
    assert.equal(hit.green + hit.red, 0)
    assert.ok(Math.abs(hit.n - idle.n) < idle.n * 0.5)
    const dead = shot(crone, witch, poseOf('death', { stateT: 0.5 }))
    assert.ok(dead.maxY - dead.minY < (idle.maxY - idle.minY) * 0.7, 'lower than standing')
  })

  it('says where its drawing tops out, where its hand and mouth are, and what there is to hit', () => {
    for (const params of [witch, syo]) {
      const b = shot(crone, params, poseOf('idle', { facing: E }))
      // (an offset from the centre, up negative: canvas.js draws the bar at e.py + drawnTop)
      const top = crone.drawnTop(params, 32)
      assert.ok(top <= b.minY + 2 && top >= b.minY - 12, `role ${params.role}: bar at ${top}, head at ${b.minY}`)
      const hand = crone.anchor(params, poseOf('idle', { facing: E, eyeGlow: 1 }), 32, 'hand'), left = crone.anchor(params, poseOf('idle', { facing: W, eyeGlow: 1 }), 32, 'hand')
      assert.ok(hand.x > 8 && left.x === -hand.x && hand.y === left.y && hand.y < 0)
      const mouth = crone.anchor(params, poseOf('idle', { facing: E }), 32, 'mouth')
      assert.ok(mouth.x > 0 && mouth.x < hand.x && mouth.y < 0, 'the mouth is nearer her than her fingertip')
      assert.equal(crone.anchor(params, poseOf('idle', { facing: E }), 64, 'hand').x, 2 * crone.anchor(params, poseOf('idle', { facing: E }), 32, 'hand').x)
    }
    assert.ok(crone.hitShape(syo).r > crone.hitShape(witch).r)
    assert.ok(crone.hitShape(witch).r >= 8 && crone.hitShape(syo).r <= 28)
    assert.ok(crone.hitHalf(witch) >= 6 && crone.hitHalf(syo) <= 16, 'one tile of clearance, whatever her size')
  })
})

describe('the para', () => {
  const P = defaultParams(para.PARAM_SCHEMA)
  it('is smaller than the hero', () => {
    const b = shot(para, P, poseOf('idle', { facing: E }))
    assert.ok(b.maxY - b.minY <= 32 && b.maxX - b.minX <= 40, `${b.maxX - b.minX} x ${b.maxY - b.minY}`)
    assert.ok(b.n > 150)
  })
  it('scuttles: its legs move from frame to frame', () => {
    const frames = new Set([0, 0.03, 0.06, 0.09, 0.12, 0.15].map(t => ops(para, P, poseOf('walk', { t }))))
    assert.ok(frames.size >= 3)
  })
  it('carries a bundle on its back', () => {
    const bare = shot(para, P, poseOf('idle', { facing: E })), laden = shot(para, P, poseOf('idle', { facing: E, carry: 1 }))
    assert.ok(laden.minY < bare.minY - 3, `top ${bare.minY} -> ${laden.minY}`)
    assert.ok(laden.n > bare.n + 20)
  })
  it('cowers low, and sticks its tongue out for a raspberry', () => {
    const up = shot(para, P, poseOf('idle', { facing: E })), down = shot(para, P, poseOf('idle', { facing: E, cower: 1 }))
    assert.ok(down.minY > up.minY, `top ${up.minY} -> ${down.minY}`)
    assert.notEqual(ops(para, P, poseOf('idle', { raspberry: 1 })), ops(para, P, poseOf('idle')))
  })
  it('looks the way it runs', () => {
    assert.notEqual(ops(para, P, poseOf('walk', { facing: E })), ops(para, P, poseOf('walk', { facing: W })))
  })
  it('has a small body to hit', () => {
    assert.ok(para.hitShape(P).r >= 6 && para.hitShape(P).r <= 12)
    assert.ok(para.hitHalf(P) >= 4 && para.hitHalf(P) <= 10)
  })
})

describe('the viper', () => {
  const P = defaultParams(viper.PARAM_SCHEMA)
  it('is turned with its facing on the pixel stage', () => {
    const north = recordingCtx(), east = recordingCtx()
    viper.drawMonster(north, P, poseOf('idle', { facing: N }), 32)
    viper.drawMonster(east, P, poseOf('idle', { facing: E }), 32)
    const rot = c => c.ops.find(o => o[0] === 'rotate')[1]
    assert.ok(Math.abs(rot(east) - rot(north) - Math.PI / 2) < 1e-9)
  })
  it('wriggles as it goes and flicks its tongue as it lies', () => {
    assert.ok(new Set([0, 0.05, 0.1, 0.15, 0.2, 0.25].map(t => ops(viper, P, poseOf('walk', { t })))).size >= 3)
    assert.ok(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map(t => ops(viper, P, poseOf('idle', { t })))).size >= 2)
  })
  it('coils back before it strikes, and strikes out past where it lay', () => {
    assert.ok(viper.headReach(P, 0.6) < viper.headReach(P, 0))
    assert.ok(viper.headReach(P, 1) > viper.headReach(P, 0) + 2)
    const lying = shot(viper, P, poseOf('idle', { facing: N })), struck = shot(viper, P, poseOf('idle', { facing: N, eyeGlow: 1 }))
    assert.ok(struck.minY < lying.minY - 2, `${lying.minY} -> ${struck.minY}`)
  })
  it('is a thin thing with a body to hit', () => {
    const b = shot(viper, P, poseOf('idle', { facing: N }))
    assert.ok(b.maxX - b.minX < b.maxY - b.minY, 'longer than wide')
    const h = viper.hitShape(P)
    assert.ok(h.r >= 4 && h.r <= 10 && h.front > 0 && h.back > 0)
    assert.ok(viper.hitHalf(P) >= 4 && viper.hitHalf(P) <= 12)
  })
})
