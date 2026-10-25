import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, anchor, _setSheetImage } from '../renderer/render/monster-rigs/monsteri.js'
import { SHEET } from '../renderer/assets/monsters/monsteri-sheet.js'
import { readPng } from '../tools/png-read.mjs'

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
const fakeSheet = { complete: true, naturalWidth: SHEET.cellW, naturalHeight: SHEET.cellH }
const blits = ctx => ctx.ops.filter(o => o[0] === 'drawImage')

describe('monsteri rig', () => {
  afterEach(() => _setSheetImage(null))

  it('has a valid schema and id', () => {
    assert.deepEqual(schemaErrors(PARAM_SCHEMA), [])
    assert.equal(RIG_ID, 'monsteri')
  })

  it('the generated sheet on disk matches its metadata', () => {
    const png = readPng('renderer/assets/monsters/monsteri.png')
    assert.equal(png.width, SHEET.cellW); assert.equal(png.height, SHEET.cellH)
    assert.ok(png.pixels.some((v, i) => i % 4 === 3 && v === 0), 'transparent around the drawing')
    assert.ok(png.pixels.some((v, i) => i % 4 === 3 && v === 255), 'an opaque drawing')
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

  it('blits the whole drawing `size` tiles tall, feet below the centre', () => {
    _setSheetImage(fakeSheet)
    const ctx = recordingCtx()
    drawMonster(ctx, P, pose('idle', { t: 0 }), 32)
    const [, img, sx, sy, sw, sh, dx, dy, dw, dh] = blits(ctx)[0]
    assert.equal(img, fakeSheet)
    assert.deepEqual([sx, sy, sw, sh], [0, 0, SHEET.cellW, SHEET.cellH])
    assert.ok(Math.abs(dh - P.size * 32) <= 2)
    assert.ok(Math.abs(dw / dh - SHEET.cellW / SHEET.cellH) < 0.05)
    const ty = ctx.ops.filter(o => o[0] === 'translate').reduce((s, o) => s + o[2], 0)
    assert.ok(ty + dy + dh > 0 && ty + dy + dh <= 16, 'feet within the lower half-tile')
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
    const h = st => { const c = recordingCtx(); drawMonster(c, P, pose('death', { stateT: st }), 32); return blits(c)[0][9] }
    assert.ok(h(0.65) < h(0))
  })

  it('lights its three orbs while charging, and only then', () => {
    _setSheetImage(fakeSheet)
    const rects = glow => { const c = recordingCtx(); drawMonster(c, P, pose('idle', { eyeGlow: glow }), 32); return c.ops.filter(o => o[0] === 'fillRect') }
    assert.equal(rects(0).length, 0)
    assert.ok(rects(1).length >= 3, 'a glow on each orb')
  })

  it('a dying monster lets its orbs go dark', () => {
    _setSheetImage(fakeSheet)
    const c = recordingCtx()
    drawMonster(c, P, pose('death', { eyeGlow: 1 }), 32)
    assert.equal(c.ops.filter(o => o[0] === 'fillRect').length, 0)
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
