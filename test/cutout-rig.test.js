import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { CUTOUT_SCHEMA, pieceTransforms, makeCutoutRig } from '../renderer/render/monster-rigs/cutout.js'
import { makeSoftCanvas } from '../tools/monster-cutter/soft-canvas.js'
import { composeCut } from '../tools/monster-cutter/compose.js'
import { encodeMask } from '../tools/monster-cutter/mask.js'

function recordingCtx() {
  const target = { ops: [] }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}

// A synthetic figure on a 120x100 source, one source px per art px: torso,
// head above, arms at both sides (cut on the torso's edge column), two legs
// below, a tail low on the right.
const COL = { torso: [200, 60, 60], head: [60, 200, 60], arm_l: [60, 60, 220], arm_r: [220, 220, 60], leg_l: [200, 60, 200], leg_r: [60, 200, 200], tail: [240, 140, 40] }
const BOXES = {
  torso: [40, 30, 40, 50], head: [50, 10, 20, 20], arm_l: [26, 40, 14, 20], arm_r: [80, 40, 10, 20],
  leg_l: [45, 80, 10, 20], leg_r: [65, 80, 10, 20], tail: [80, 68, 13, 6],
}
function makeFigure({ only = null, points = null } = {}) {
  const W = 120, H = 100
  const mask = new Uint8Array(W * H), rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) rgba.set([255, 255, 255, 255], i * 4)
  const ids = only ?? Object.keys(BOXES)
  for (const id of ids) {
    const [x, y, w, h] = BOXES[id]
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { mask[j * W + i] = 1; rgba.set([...COL[id], 255], (j * W + i) * 4) }
  }
  const all = [
    { id: 'torso', role: 'torso', side: null, parent: null, seed: [60, 55], cut: null, pivot: [60, 55], z: 0, claims: [] },
    { id: 'head', role: 'head', side: null, parent: 'torso', seed: [60, 20], cut: [[49, 30], [70, 30]], pivot: [60, 30], z: 1, claims: [] },
    { id: 'arm_l', role: 'arm', side: 'left', parent: 'torso', seed: [32, 50], cut: [[40, 39], [40, 60]], pivot: [40, 50], z: 1, claims: [] },
    { id: 'arm_r', role: 'arm', side: 'right', parent: 'torso', seed: [85, 50], cut: [[79, 39], [79, 60]], pivot: [79, 50], z: 1, claims: [] },
    { id: 'leg_l', role: 'leg', side: 'left', parent: 'torso', seed: [50, 90], cut: [[44, 79], [55, 79]], pivot: [50, 79], z: 1, claims: [] },
    { id: 'leg_r', role: 'leg', side: 'right', parent: 'torso', seed: [70, 90], cut: [[64, 79], [75, 79]], pivot: [70, 79], z: 1, claims: [] },
    { id: 'tail', role: 'tail', side: null, parent: 'torso', seed: [86, 70], cut: [[79, 67], [79, 74]], pivot: [79, 70], z: 1, claims: [] },
  ]
  const pieces = all.filter(p => ids.includes(p.id))
  const cut = {
    version: 1, name: 't', source: 't.png', credit: null, w: W, h: H, mask: encodeMask(mask),
    view: 'front', faces: 'left', outHeight: 100, outline: '#102030', pieces,
    points: points ?? { head: { piece: 'head', x: 60, y: 20 }, chest: { piece: 'torso', x: 60, y: 50 } },
  }
  const { atlas, parts } = composeCut({ w: W, h: H, rgba }, cut)
  const image = { w: atlas.w, h: atlas.h, rgba: atlas.rgba, width: atlas.w, height: atlas.h, naturalWidth: atlas.w, complete: true }
  return { parts, image }
}

const { parts: PARTS, image: IMAGE } = makeFigure()
const P = defaultParams(CUTOUT_SCHEMA)
const extremes = which => Object.fromEntries(CUTOUT_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))
const pose = (state, over = {}) => ({ t: 1.25, state, stateT: 0.1, facing: 0, speed01: state === 'walk' ? 1 : 0, seed: 3, ...over })
const walkAt = (params, i, over = {}) => pose('walk', { t: (i + 0.5) / params.gaitFreq, ...over })
const angle = m => Math.atan2(m[1], m[0]) * 180 / Math.PI
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)
const blits = ctx => ctx.ops.filter(o => o[0] === 'drawImage')
const rigOf = (over = {}) => makeCutoutRig({ id: 'fig', parts: PARTS, imageUrl: null, ...over })
const withImage = (parts = PARTS, image = IMAGE, over = {}) => { const r = makeCutoutRig({ id: 'fig', parts, imageUrl: null, ...over }); r._setSheetImage(image); return r }
const drawable = PARTS.pieces.filter(p => p.rect[2] > 0 && p.rect[3] > 0)
const capCount = PARTS.pieces.filter(p => p.cap && p.cap[2] > 0 && p.cap[3] > 0).length

describe('cutout rig', () => {
  it('has a valid schema and the given id', () => {
    assert.deepEqual(schemaErrors(CUTOUT_SCHEMA), [])
    assert.equal(rigOf().RIG_ID, 'fig')
    assert.deepEqual(rigOf().PARAM_SCHEMA, CUTOUT_SCHEMA)
    const d = k => CUTOUT_SCHEMA.find(p => p.key === k).default
    assert.deepEqual(['size', 'body', 'lift', 'bob', 'wobble', 'gaitFreq', 'lunge', 'armSwing', 'stepHeight', 'legSwing', 'headNod', 'tailSway', 'attackReach'].map(d),
      [3, 0.5, 1.1, 0.4, 3, 6, 0.2, 20, 0.12, 20, 3, 8, 35])
  })

  for (const state of ['idle', 'walk', 'attack', 'hit', 'death']) {
    it(`draws a balanced silhouette without the image in state ${state} at defaults, min and max`, () => {
      const rig = rigOf()
      for (const params of [P, extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => rig.drawMonster(ctx, params, pose(state), 32))
        assert.equal(ctx.ops.filter(o => o[0] === 'fillRect').length, drawable.length)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
        assert.equal(blits(ctx).length, 0)
      }
    })
  }

  it('with the image: one blit per piece and one per cap', () => {
    const rig = withImage()
    for (const state of ['idle', 'walk', 'attack', 'hit', 'death']) {
      const ctx = recordingCtx()
      rig.drawMonster(ctx, P, pose(state), 32)
      assert.equal(blits(ctx).length, drawable.length + capCount, state)
      assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
    }
  })

  it('skips an empty piece and an empty cap', () => {
    const parts = { ...PARTS, pieces: [...PARTS.pieces, { id: 'ghost', role: 'extra', side: null, parent: 'torso', z: 9, pivot: [5, 5], rect: [0, 0, 0, 4], at: [0, 0], cap: [0, 0, 0, 0, 0, 0] }] }
    const ctx = recordingCtx()
    withImage(parts).drawMonster(ctx, P, pose('idle'), 32)
    assert.equal(blits(ctx).length, drawable.length + capCount)
  })

  it('flips to face east and not west when faces is left; the reverse when right', () => {
    const flipped = (rig, facing) => { const c = recordingCtx(); rig.drawMonster(c, P, pose('idle', { facing }), 32); return c.ops.some(o => o[0] === 'scale' && o[1] === -1) }
    const left = withImage(), right = withImage({ ...PARTS, faces: 'right' })
    assert.ok(flipped(left, 0)); assert.ok(!flipped(left, Math.PI))
    assert.ok(!flipped(right, 0)); assert.ok(flipped(right, Math.PI))
  })

  it('facing straight north or south keeps the drawing as drawn', () => {
    for (const parts of [PARTS, { ...PARTS, faces: 'right' }])
      for (const facing of [-Math.PI / 2, Math.PI / 2]) {
        const c = recordingCtx()
        withImage(parts).drawMonster(c, P, pose('idle', { facing }), 32)
        assert.ok(!c.ops.some(o => o[0] === 'scale' && o[1] === -1))
      }
  })

  it('arms swing in opposite phase while walking', () => {
    const arm = (i, id) => angle(pieceTransforms(PARTS, P, walkAt(P, i)).get(id))
    near(arm(0, 'arm_l'), P.armSwing); near(arm(2, 'arm_l'), -P.armSwing)
    near(arm(0, 'arm_r'), -P.armSwing); near(arm(2, 'arm_r'), P.armSwing)
    near(arm(1, 'arm_l'), 0)
  })

  it('front-view legs lift in turn; side-view legs swing', () => {
    const pivotY = (tr, id) => { const p = PARTS.pieces.find(q => q.id === id); const m = tr.get(id); return m[1] * p.pivot[0] + m[3] * p.pivot[1] + m[5] }
    const lift = P.stepHeight * PARTS.figure.h / P.size
    const leg = PARTS.pieces.find(p => p.id === 'leg_l')
    for (const [i, lifted, other] of [[0, 'leg_l', 'leg_r'], [2, 'leg_r', 'leg_l']]) {
      const tr = pieceTransforms(PARTS, P, walkAt(P, i))
      near(pivotY(tr, lifted), leg.pivot[1] - lift, 1e-6)
      assert.ok(Math.abs(angle(tr.get(lifted))) > 0, 'a tilt while lifted')
      assert.deepEqual(tr.get(other).map(v => Math.round(v * 1e9) / 1e9), [1, 0, 0, 1, 0, 0])
    }
    const side = { ...PARTS, view: 'side' }
    for (const i of [0, 1, 2, 3]) {
      const tr = pieceTransforms(side, P, walkAt(P, i))
      const s = [1, 0, -1, 0][i]
      near(angle(tr.get('leg_l')), P.legSwing * s); near(angle(tr.get('leg_r')), -P.legSwing * s)
    }
  })

  it('attack raises both arms outward', () => {
    const tr = pieceTransforms(PARTS, P, pose('attack'))
    near(angle(tr.get('arm_l')), P.attackReach); near(angle(tr.get('arm_r')), -P.attackReach)
    const side = pieceTransforms({ ...PARTS, view: 'side' }, P, pose('attack'))   // faces left: forward +1
    near(angle(side.get('arm_l')), P.attackReach); near(angle(side.get('arm_r')), P.attackReach)
  })

  it('idle barely moves; walking changes the drawing between gait steps', () => {
    for (const t of [0.25, 0.75, 1.25, 1.75]) {
      const tr = pieceTransforms(PARTS, P, pose('idle', { t }))
      for (const id of ['arm_l', 'arm_r']) assert.ok(Math.abs(angle(tr.get(id))) <= P.armSwing / 4 + 1e-9)
      for (const id of ['head', 'leg_l', 'leg_r']) near(angle(tr.get(id)), 0)
      assert.ok(Math.abs(angle(tr.get('tail'))) <= P.tailSway / 2 + 1e-9)
    }
    const rig = withImage()
    const at = i => { const c = recordingCtx(); rig.drawMonster(c, P, walkAt(P, i), 32); return JSON.stringify(c.ops) }
    assert.ok(new Set([0, 1, 2, 3].map(at)).size >= 3)
  })

  it('death shrinks the figure', () => {
    const rig = withImage()
    const k = st => { const c = recordingCtx(); rig.drawMonster(c, P, pose('death', { stateT: st }), 32); return c.ops.filter(o => o[0] === 'scale' && o[1] === o[2]).pop()[1] }
    assert.ok(k(0.65) < k(0))
  })

  it('the figure is size tiles tall with the feet just below the centre', () => {
    const c = recordingCtx()
    withImage().drawMonster(c, P, pose('idle', { t: 0 }), 32)
    const kk = c.ops.filter(o => o[0] === 'scale' && o[1] === o[2]).pop()[1]
    near(kk * PARTS.figure.h, P.size * 32, 1e-6)
    const ty = c.ops.filter(o => o[0] === 'translate')
    assert.equal(ty[0][2], Math.round(0.45 * 32))
  })

  it('anchor follows the posed head', () => {
    const rig = rigOf()
    const p = { ...P, headNod: 15 }
    const idle = rig.anchor(p, pose('idle', { t: 0 }), 32, 'head')
    const walk = rig.anchor(p, walkAt(p, 0), 32, 'head')
    assert.notDeepEqual(walk, idle)
    const west = rig.anchor(p, walkAt(p, 0, { facing: Math.PI }), 32, 'head')
    const east = rig.anchor(p, walkAt(p, 0, { facing: 0 }), 32, 'head')
    assert.equal(east.x, -west.x); assert.equal(east.y, west.y)
    assert.ok(rig.anchor(P, pose('idle'), 32, 'head').y < rig.anchor(P, pose('idle'), 32, 'chest').y)
  })

  it('drawnTop is the top of the tallest living pose', () => {
    const rig = withImage()
    const topRow = (params, ps) => {
      const { ctx, img } = makeSoftCanvas(300, 300)
      ctx.translate(150, 200)
      rig.drawMonster(ctx, params, ps, 32)
      for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) if (img.rgba[(y * 300 + x) * 4 + 3] > 0) return y - 200
      return Infinity
    }
    const poses = [pose('idle', { t: 0.25 }), pose('idle', { t: 1.25 }), ...[0, 1, 2, 3].map(i => walkAt(P, i)), pose('attack', { t: 0.25 }), pose('attack', { t: 1.25 }), pose('hit', { t: 0.25 }), pose('hit', { t: 1.25 })]
    for (const params of [P, { ...P, wobble: 0, headNod: 0 }]) {
      const tops = poses.map(ps => topRow(params, ps))
      const dt = rig.drawnTop(params, 32)
      for (const t of tops) assert.ok(dt <= t, `drawnTop ${dt} vs ${t}`)
      if (params.wobble === 0) assert.ok(Math.min(...tops) - dt <= 1, `tight: ${dt} vs ${Math.min(...tops)}`)
    }
    assert.equal(rig.drawnTop(P, 32), rig.drawnTop(P, 32))
  })

  it('hit radius stays within 8..28 and sits on the body', () => {
    const rig = rigOf()
    for (const p of [P, extremes('min'), extremes('max')]) {
      assert.ok(rig.hitHalf(p) >= 8 && rig.hitHalf(p) <= 28)
      const s = rig.hitShape(p)
      assert.equal(s.r, rig.hitHalf(p)); assert.ok(s.oy <= 0)
    }
  })

  it('a torso-only cut draws, holds still and still answers head and chest anchors', () => {
    const { parts, image } = makeFigure({ only: ['torso'], points: {} })
    const rig = makeCutoutRig({ id: 'solo', parts, imageUrl: null })
    const c = recordingCtx()
    assert.doesNotThrow(() => rig.drawMonster(c, P, pose('walk'), 32))
    rig._setSheetImage(image)
    for (const state of ['idle', 'walk', 'attack']) for (const i of [0, 1, 2, 3]) {
      const m = pieceTransforms(parts, P, walkAt(P, i, { state })).get('torso')
      assert.deepEqual(m, [1, 0, 0, 1, 0, 0])
    }
    const c2 = recordingCtx(); rig.drawMonster(c2, P, pose('walk'), 32)
    assert.equal(blits(c2).length, 1)
    const k = P.size * 32 / parts.figure.h
    const head = rig.anchor(P, pose('idle', { facing: Math.PI }), 32, 'head'), chest = rig.anchor(P, pose('idle', { facing: Math.PI }), 32, 'chest')
    assert.equal(head.x, 0)
    assert.equal(head.y, Math.round(Math.round(0.45 * 32) - parts.figure.h * k))
    assert.equal(chest.y, Math.round(Math.round(0.45 * 32) - parts.figure.h * k / 2))
  })

  it('extend runs after the pieces in figure space and can ask for posed points', () => {
    const seen = []
    const rig = withImage(PARTS, IMAGE, { extend: (ctx, p, ps, S, { point }) => { seen.push(point('head'), point('nowhere')); ctx.fillRect(1, 2, 3, 4) } })
    const c = recordingCtx(); rig.drawMonster(c, P, pose('idle'), 32)
    assert.deepEqual(c.ops.slice(-3).map(o => o[0]), ['fillRect', 'restore', 'restore'])
    assert.equal(seen.length, 2)
    near(seen[0].x, PARTS.points.head.x, 1e-9)   // idle t=1.25: the head is not turned
  })

  it('a turned limb opens no gap at its joint', () => {
    const rig = withImage()
    const fh = PARTS.figure.h, fw = PARTS.figure.w
    const params = { ...P, size: fh / 32, wobble: 0, bob: 0 }
    const render = ps => {
      const { ctx, img } = makeSoftCanvas(240, 240)
      ctx.translate(120, 120)
      rig.drawMonster(ctx, params, ps, 32)
      return img
    }
    const oy = 120 + Math.round(0.45 * 32) - fh, ox = 120 - fw / 2   // device px of art (0,0)
    const rest = render(pose('idle', { t: 0.25 })), max = render(walkAt({ ...params, armSwing: 60 }, 0))
    const limb = PARTS.pieces.find(p => p.id === 'arm_l')
    const cutLen = Math.hypot(0, 60 - 39)
    const r = cutLen / 2 - 1
    let n = 0
    const alpha = (img, x, y) => img.rgba[(y * 240 + x) * 4 + 3]
    for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
      const ax = x - ox + 0.5, ay = y - oy + 0.5
      if (Math.hypot(ax - limb.pivot[0], ay - limb.pivot[1]) > r) continue
      n++
      assert.equal(alpha(rest, x, y), 255, `rest ${ax},${ay}`)
      assert.equal(alpha(max, x, y), 255, `turned ${ax},${ay}`)
    }
    assert.ok(n > 200)
  })
})
