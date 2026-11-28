import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as seal from '../renderer/render/monster-rigs/seal.js'
import * as gong from '../renderer/render/monster-rigs/gong.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { makeSoftCanvas } from '../tools/monster-cutter/soft-canvas.js'
import { rigContract, recordingCtx, STATES, poseOf, inked } from './helpers/rig-contract.js'

const CHANNELS = [{}, { eyeGlow: 0.6 }, { eyeGlow: 1 }, { sing: 1 }, { doze: 1 }, { winded: 1 }, { air: 0.7 },
  { charge: 1 }, { charge: 1, eyeGlow: 0.5 }, { bellow: 1 }, { laugh: 1 }, { flicker: 1 }]

rigContract(seal, { channels: CHANNELS })
rigContract(gong, { channels: [{}, { flicker: 1 }, { flicker: 0.4 }] })

const P = defaultParams(seal.PARAM_SCHEMA)
const ROLE = { trader: { ...P, role: 0 }, singer: { ...P, role: 1 }, guard: { ...P, role: 2 }, walrus: { ...P, role: 3, scale: 2, bodyColor: '#8a5a3c' } }

// The ink of a pose on a 256 px canvas at S = 32, centred: how much, its
// box and its middle's height (px from the centre, y down), and how much of
// it is the hit's white.
function ink(rig, params, pose) {
  const { ctx, img } = makeSoftCanvas(256, 256)
  ctx.translate(128, 128)
  rig.drawMonster(ctx, params, pose, 32)
  let n = 0, white = 0, sumY = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const o = (y * 256 + x) * 4
    if (!(img.rgba[o + 3] > 0)) continue
    n++; sumY += y - 128
    if (img.rgba[o] > 240 && img.rgba[o + 1] > 240 && img.rgba[o + 2] > 240) white++
    x0 = Math.min(x0, x - 128); x1 = Math.max(x1, x - 128); y0 = Math.min(y0, y - 128); y1 = Math.max(y1, y - 128)
  }
  return { n, white, x0, x1, y0, y1, cy: sumY / n, rgba: img.rgba }
}
const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }

describe('the seal folk drawn', () => {
  it('every role draws in every state and channel, balanced, on both canvases', () => {
    for (const [name, params] of Object.entries(ROLE)) for (const state of STATES) for (const ch of CHANNELS) {
      const ctx = recordingCtx()
      seal.drawMonster(ctx, params, poseOf(state, ch), 32)
      assert.ok(ctx.ops.length > 4, `${name} ${state}`)
      assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length, `${name} ${state}`)
      assert.ok(inked(seal, params, poseOf(state, ch)) > 0, `${name} ${state}`)
    }
  })

  it('a seal is about a tile tall and stands in its tile; the walrus is about twice that', () => {
    const s = ink(seal, ROLE.trader, poseOf('idle')), w = ink(seal, ROLE.walrus, poseOf('idle'))
    assert.ok(s.y1 - s.y0 >= 26 && s.y1 - s.y0 <= 44, `a seal ${s.y1 - s.y0} px tall`)
    assert.ok(s.y1 <= 18, `its foot at ${s.y1}`)
    assert.ok(w.y1 - w.y0 >= 1.7 * (s.y1 - s.y0) && w.y1 - w.y0 <= 80, `the walrus ${w.y1 - w.y0} px tall`)
    assert.ok(w.n > s.n * 2.5)
  })

  it('the four roles are four pictures', () => {
    const pics = Object.values(ROLE).map(p => ink(seal, { ...p, scale: 1 }, poseOf('idle')).rgba)
    for (let i = 0; i < pics.length; i++) for (let j = i + 1; j < pics.length; j++) assert.equal(same(pics[i], pics[j]), false, `${i} vs ${j}`)
  })

  it('turns with its facing: left is the mirror of right', () => {
    for (const params of Object.values(ROLE)) {
      const r = ink(seal, params, poseOf('idle', { facing: 0 })), l = ink(seal, params, poseOf('idle', { facing: Math.PI }))
      assert.equal(r.n, l.n)
      assert.ok(Math.abs(r.x1 + l.x0) <= 2 && Math.abs(r.x0 + l.x1) <= 2, `${r.x0}..${r.x1} vs ${l.x0}..${l.x1}`)
    }
    assert.equal(same(ink(seal, ROLE.guard, poseOf('idle', { facing: 0 })).rgba, ink(seal, ROLE.guard, poseOf('idle', { facing: Math.PI })).rgba), false)
  })

  it('it gallumphs: a walk is not one still picture', () => {
    const frames = [0, 0.08, 0.16, 0.24, 0.32, 0.4].map(t => ink(seal, ROLE.trader, poseOf('walk', { t })).rgba)
    assert.ok(frames.some(f => !same(f, frames[0])))
  })

  it('the guard holds a harpoon above its head, and its arm goes back to throw', () => {
    const guard = ink(seal, ROLE.guard, poseOf('idle')), trader = ink(seal, ROLE.trader, poseOf('idle'))
    assert.ok(guard.y0 < trader.y0 - 4, `harpoon tip ${guard.y0} vs head ${trader.y0}`)
    const back = ink(seal, ROLE.guard, poseOf('idle', { eyeGlow: 0.8 }))
    assert.equal(same(back.rgba, guard.rgba), false)
    assert.ok(back.x0 < guard.x0 - 2, 'the harpoon lies back over the shoulder')
    assert.equal(same(ink(seal, ROLE.guard, poseOf('idle', { eyeGlow: 1 })).rgba, back.rgba), false)
  })

  it('the singer sings with her head back, and curls up low to doze', () => {
    const sit = ink(seal, ROLE.singer, poseOf('idle')), sing = ink(seal, ROLE.singer, poseOf('idle', { sing: 1 })), doze = ink(seal, ROLE.singer, poseOf('idle', { doze: 1 }))
    assert.equal(same(sit.rgba, sing.rgba), false)
    assert.ok(doze.cy > sit.cy + 4, `asleep she lies low: ${doze.cy} vs ${sit.cy}`)
    assert.ok(doze.x1 - doze.x0 > sit.x1 - sit.x0)
  })

  it('the walrus rears tall, puts its head down, leaves the ground, and sits winded', () => {
    const idle = ink(seal, ROLE.walrus, poseOf('idle'))
    const rear = ink(seal, ROLE.walrus, poseOf('idle', { eyeGlow: 1 }))
    const down = ink(seal, ROLE.walrus, poseOf('idle', { charge: 1, eyeGlow: 1 }))
    const air = ink(seal, ROLE.walrus, poseOf('idle', { air: 1 }))
    const winded = ink(seal, ROLE.walrus, poseOf('idle', { winded: 1 }))
    assert.ok(rear.y0 < idle.y0 - 3, `reared ${rear.y0} vs ${idle.y0}`)
    assert.ok(down.y0 > idle.y0 + 3, `head down ${down.y0} vs ${idle.y0}`)
    assert.ok(air.y0 < idle.y0 - 12, `in the air ${air.y0} vs ${idle.y0}`)
    assert.ok(winded.cy > idle.cy + 2, `winded he sits slumped: ${winded.cy} vs ${idle.cy}`)
    for (const ch of [{ bellow: 1 }, { laugh: 1 }]) assert.equal(same(ink(seal, ROLE.walrus, poseOf('idle', ch)).rgba, idle.rgba), false)
  })

  it('a blow flashes it white, and dead it lies down', () => {
    for (const params of Object.values(ROLE)) {
      const hit = ink(seal, params, poseOf('hit'))
      assert.ok(hit.white > hit.n * 0.6, `${hit.white} of ${hit.n} white`)
      const idle = ink(seal, params, poseOf('idle')), dead = ink(seal, params, poseOf('death', { stateT: 0.5 }))
      assert.ok(dead.y0 > idle.y0 + 4)
    }
  })

  it('has a body to hit that grows with it, a collision box that fits a tile, and a top for the health bar', () => {
    const a = seal.hitShape(ROLE.trader), b = seal.hitShape(ROLE.walrus)
    assert.ok(a.r >= 8 && a.r <= 14 && b.r >= 16 && b.r <= 28, `${a.r} ${b.r}`)
    assert.ok(seal.hitHalf(ROLE.trader) >= 8 && seal.hitHalf(ROLE.walrus) > seal.hitHalf(ROLE.trader) && seal.hitHalf(ROLE.walrus) < 16)
    assert.ok(seal.hitHalf({ ...P, role: 3, scale: 2.4 }) <= 28)
    for (const params of Object.values(ROLE)) {
      const top = seal.drawnTop(params, 32)
      assert.ok(top < 0 && top <= ink(seal, params, poseOf('idle')).y0 + 1, `${top}`)
      assert.ok(top >= ink(seal, params, poseOf('idle')).y0 - 14)
    }
  })

  it('says where its head and mouth are, turned with it', () => {
    for (const params of Object.values(ROLE)) for (const name of ['head', 'mouth']) {
      const r = seal.anchor(params, poseOf('idle', { facing: 0 }), 32, name), l = seal.anchor(params, poseOf('idle', { facing: Math.PI }), 32, name)
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && r.y < 0)
      assert.equal(r.x + l.x, 0)
    }
    assert.ok(seal.anchor(ROLE.walrus, poseOf('idle'), 32, 'head').y < seal.anchor(ROLE.trader, poseOf('idle'), 32, 'head').y)
  })
})

describe('the gong drawn', () => {
  const G = defaultParams(gong.PARAM_SCHEMA)
  it('stands taller than a seal, and swings when it rings', () => {
    const still = ink(gong, G, poseOf('idle')), s = ink(seal, ROLE.trader, poseOf('idle'))
    assert.ok(still.y1 - still.y0 > s.y1 - s.y0)
    const rung = [0, 0.05, 0.1, 0.15].map(t => ink(gong, G, poseOf('idle', { flicker: 1, t })))
    assert.ok(rung.every(r => !same(r.rgba, still.rgba)))
    assert.ok(rung.some(r => !same(r.rgba, rung[0].rgba)), 'it moves while it rings')
    assert.ok(rung[0].n > still.n, 'and the ringing shows')
  })
  it('has a body to strike and a top', () => {
    const h = gong.hitShape(G)
    assert.ok(h.r >= 10 && h.r <= 20)
    assert.ok(gong.hitHalf(G) >= 8 && gong.hitHalf(G) <= 16)
    assert.ok(gong.drawnTop(G, 32) < 0)
  })
})
