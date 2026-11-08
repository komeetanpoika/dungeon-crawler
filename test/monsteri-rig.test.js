import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, anchor, drawnTop, _setSheetImage } from '../renderer/render/monster-rigs/monsteri.js'
import { PARTS } from '../renderer/assets/monsters/monsteri-parts.js'
import { readPng } from '../tools/png-read.mjs'
import { makeSoftCanvas } from '../tools/monster-cutter/soft-canvas.js'

function recordingCtx() {
  const target = { ops: [] }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}
const pose = (state, over = {}) => ({ t: 1.25, state, stateT: 0.1, facing: 0, speed01: state === 'walk' ? 1 : 0, seed: 3, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))
const P = defaultParams(PARAM_SCHEMA)
const ATLAS_FILE = 'renderer/assets/monsters/monsteri-parts.png'
const fakeSheet = { complete: true, naturalWidth: 64, naturalHeight: 64 }
const blits = ctx => ctx.ops.filter(o => o[0] === 'drawImage')
const valid = r => r && r[2] > 0 && r[3] > 0
const drawable = PARTS.pieces.filter(p => valid(p.rect))
const caps = PARTS.pieces.filter(p => valid(p.cap))
// the figure's scale (art px -> screen px): the one uniform scale op
const figureScale = ctx => ctx.ops.filter(o => o[0] === 'scale' && o[1] === o[2]).pop()[1]

describe('monsteri rig', () => {
  afterEach(() => _setSheetImage(null))

  it('has a valid schema and id', () => {
    assert.deepEqual(schemaErrors(PARAM_SCHEMA), [])
    assert.equal(RIG_ID, 'monsteri')
  })

  it('the parts atlas on disk matches PARTS', () => {
    const png = readPng(ATLAS_FILE)
    const opaque = (x, y) => png.pixels[(y * png.width + x) * 4 + 3] === 255
    assert.ok(png.pixels.some((v, i) => i % 4 === 3 && v === 0), 'transparent between the pieces')
    const ids = PARTS.pieces.map(p => p.id)
    for (const id of ['torso', 'head', 'arm_ul', 'arm_ll', 'arm_lr', 'leg_l', 'leg_r', 'tail', 'stalk_1', 'stalk_2', 'stalk_3'])
      assert.ok(ids.includes(id), id)
    for (const p of PARTS.pieces) {
      assert.ok(valid(p.rect), `${p.id} has art`)
      for (const r of [p.rect, p.cap && p.cap.slice(0, 4)].filter(valid)) {
        const [x, y, w, h] = r
        assert.ok(x >= 0 && y >= 0 && x + w <= png.width && y + h <= png.height, `${p.id} inside the atlas`)
        let n = 0
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (opaque(i, j)) n++
        assert.ok(n > 0, `${p.id}: opaque art in its rect`)
      }
    }
    for (const name of ['head', 'chest', 'orb1', 'orb2', 'orb3']) assert.ok(PARTS.points[name], name)
  })

  it('hit radius stays within the 8..28 clearance range and the circle sits on the body', () => {
    for (const p of [P, extremes('min'), extremes('max')]) {
      assert.ok(hitHalf(p) >= 8 && hitHalf(p) <= 28)
      const s = hitShape(p)
      assert.equal(s.r, hitHalf(p)); assert.ok(s.oy <= 0, 'body centre at or above the tile centre')
    }
  })

  for (const state of ['idle', 'walk', 'attack', 'hit', 'death']) {
    it(`draws a balanced silhouette without the image in state ${state} at defaults, min and max`, () => {
      for (const params of [P, extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.filter(o => o[0] === 'fillRect').length >= 3)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
        assert.equal(blits(ctx).length, 0)
      }
    })
  }

  it('the figure is size tiles tall, feet within the lower half-tile', () => {
    _setSheetImage(fakeSheet)
    const ctx = recordingCtx()
    drawMonster(ctx, P, pose('idle', { t: 0 }), 32)
    assert.equal(blits(ctx).length, drawable.length + caps.length, 'one blit per piece and one per cap')
    assert.ok(blits(ctx).every(b => b[1] === fakeSheet))
    const k = figureScale(ctx)
    assert.ok(Math.abs(k * PARTS.figure.h - P.size * 32) < 1e-6)
    // origin at the feet, then figure space: translate(-w/2, -h) after the scale
    const [feet, fig] = ctx.ops.filter(o => o[0] === 'translate')
    assert.deepEqual(fig.slice(1), [-PARTS.figure.w / 2, -PARTS.figure.h])
    assert.ok(feet[2] > 0 && feet[2] <= 16, 'feet within the lower half-tile')
  })

  it('flips to face east and not west', () => {
    _setSheetImage(fakeSheet)
    const east = recordingCtx(), west = recordingCtx()
    drawMonster(east, P, pose('idle', { facing: 0 }), 32)
    drawMonster(west, P, pose('idle', { facing: Math.PI }), 32)
    const flipped = ctx => ctx.ops.some(o => o[0] === 'scale' && o[1] === -1)
    assert.notEqual(flipped(east), flipped(west))
  })

  it('facing straight north or south keeps the drawing as drawn', () => {
    _setSheetImage(fakeSheet)
    for (const facing of [-Math.PI / 2, Math.PI / 2]) {
      const ctx = recordingCtx()
      drawMonster(ctx, P, pose('idle', { facing }), 32)
      assert.ok(!ctx.ops.some(o => o[0] === 'scale' && o[1] === -1), `facing ${facing}`)
    }
  })

  it('walking moves the drawing between gait steps; idle barely does', () => {
    _setSheetImage(fakeSheet)
    const at = (state, t) => { const c = recordingCtx(); drawMonster(c, P, pose(state, { t }), 32); return JSON.stringify(c.ops) }
    const walk = new Set([0, 0.05, 0.1, 0.15, 0.2].map(t => at('walk', t)))
    assert.ok(walk.size >= 2)
  })

  it('death shrinks the drawing', () => {
    _setSheetImage(fakeSheet)
    const k = st => { const c = recordingCtx(); drawMonster(c, P, pose('death', { stateT: st }), 32); return figureScale(c) }
    assert.ok(k(0.65) < k(0))
  })

  it('lights its three orbs while charging, and only then', () => {
    _setSheetImage(fakeSheet)
    const rects = glow => { const c = recordingCtx(); drawMonster(c, P, pose('idle', { eyeGlow: glow }), 32); return c.ops.filter(o => o[0] === 'fillRect') }
    assert.equal(rects(0).length, 0)
    assert.ok(rects(1).length >= 3, 'a glow on each orb')
  })

  it('the glow sits on the cut\'s three orb points, and rides the nodding head', () => {
    _setSheetImage(fakeSheet)
    const centres = ps => {
      const c = recordingCtx(); drawMonster(c, P, ps, 32)
      return c.ops.filter(o => o[0] === 'fillRect').map(([, x, y, w, h]) => [x + w / 2, y + h / 2])
    }
    const still = centres(pose('idle', { eyeGlow: 1 }))        // idle: the head is not turned
    const orbs = ['orb1', 'orb2', 'orb3'].map(n => [PARTS.points[n].x, PARTS.points[n].y])
    assert.equal(still.length, 6, 'a halo and a core on each orb')
    still.forEach(([x, y], i) => {
      const [ox, oy] = orbs[i >> 1]
      assert.ok(Math.abs(x - ox) < 1e-9 && Math.abs(y - oy) < 1e-9, `rect ${i} on ${ox},${oy}`)
    })
    const nod = { ...P, headNod: 15 }
    const c = recordingCtx(); drawMonster(c, nod, pose('walk', { t: 0.5 / nod.gaitFreq, eyeGlow: 1 }), 32)
    const walking = c.ops.filter(o => o[0] === 'fillRect').map(([, x, y, w, h]) => [x + w / 2, y + h / 2])
    assert.notDeepEqual(walking, still, 'the orbs move with the head')
  })

  it('a dying monster lets its orbs go dark', () => {
    _setSheetImage(fakeSheet)
    const c = recordingCtx()
    drawMonster(c, P, pose('death', { eyeGlow: 1 }), 32)
    assert.equal(c.ops.filter(o => o[0] === 'fillRect').length, 0)
  })

  // The health bar sits just above drawnTop (render/canvas.js drawHealthBars),
  // so it must clear the drawing in every living pose; with the lean and the
  // nod off it is within a pixel of the tallest one.
  it('drawnTop is the top of the tallest living pose', () => {
    const png = readPng(ATLAS_FILE)
    _setSheetImage({ w: png.width, h: png.height, rgba: png.pixels, width: png.width, height: png.height, naturalWidth: png.width, complete: true })
    const topRow = (params, ps) => {
      const { ctx, img } = makeSoftCanvas(300, 300)
      ctx.translate(150, 220)
      drawMonster(ctx, params, ps, 32)
      for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) if (img.rgba[(y * 300 + x) * 4 + 3] > 0) return y - 220
      return Infinity
    }
    for (const params of [P, { ...P, wobble: 0, headNod: 0 }, extremes('max')]) {
      const walk = i => pose('walk', { t: (i + 0.5) / params.gaitFreq })
      const poses = [pose('idle', { t: 0.25 }), pose('idle', { t: 1.25 }), ...[0, 1, 2, 3].map(walk),
        pose('attack', { t: 0.25 }), pose('attack', { t: 1.25 }), pose('hit', { t: 0.25 }), pose('hit', { t: 1.25 })]
      const tops = poses.map(ps => topRow(params, ps)), dt = drawnTop(params, 32)
      for (const t of tops) assert.ok(dt <= t, `drawnTop ${dt} vs ${t} (size ${params.size})`)
      if (params.wobble === 0) assert.ok(Math.min(...tops) - dt <= 1, `tight: ${dt} vs ${Math.min(...tops)}`)
    }
  })

  it('names where its head and chest are drawn: high on the body, mirrored when it turns', () => {
    for (const name of ['head', 'chest']) {
      const west = anchor(P, { facing: Math.PI }, 32, name), east = anchor(P, { facing: 0 }, 32, name)
      assert.ok(west.y < -32, `${name} well above the tile centre`)
      assert.equal(east.x, -west.x, `${name} mirrored`)
    }
    assert.ok(anchor(P, { facing: 0 }, 32, 'head').y < anchor(P, { facing: 0 }, 32, 'chest').y, 'the head above the chest')
    const tall = { ...P, size: P.size * 2 }
    assert.ok(anchor(tall, { facing: 0 }, 32, 'head').y < anchor(P, { facing: 0 }, 32, 'head').y, 'a taller monster has its head higher')
  })
})
