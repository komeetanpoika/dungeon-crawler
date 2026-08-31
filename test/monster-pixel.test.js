import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE_ART_PX, snapFacing, palette, frameOf, withPixelStage }
  from '../renderer/render/monster-rigs/pixel.js'

// Same recording proxy as monster-rigs.test.js: methods log ops, property
// sets are stored, gradients inert.
function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k]
      return (...a) => { t.ops.push([k, ...a]) }
    },
    set(t, k, v) { t[k] = v; return true },
  })
}

describe('snapFacing', () => {
  it('snaps to the nearest of 8 directions (45° steps)', () => {
    assert.equal(snapFacing(0.1), 0)
    assert.equal(snapFacing(-0.1), 0)
    assert.equal(snapFacing(Math.PI / 4 + 0.05), Math.PI / 4)
    assert.equal(snapFacing(Math.PI / 2 - 0.2), Math.PI / 2)
  })
  it('produces exactly 8 distinct outputs over a full sweep', () => {
    const outs = new Set()
    for (let a = 0; a < Math.PI * 2; a += 0.01) outs.add(snapFacing(a))
    assert.equal(outs.size, 8)
  })
  it('normalizes angles outside [0, 2π)', () => {
    assert.equal(snapFacing(Math.PI * 2 + 0.1), 0)
    assert.equal(snapFacing(-Math.PI * 2 + 0.1), 0)
  })
})

describe('palette', () => {
  it('returns outline darker than base darker than light', () => {
    const p = palette('#7c4a24')
    const lum = c => {
      const n = parseInt(c.slice(1), 16)
      return (n >> 16) + ((n >> 8) & 255) + (n & 255)
    }
    assert.ok(lum(p.outline) < lum(p.base))
    assert.ok(lum(p.base) < lum(p.light))
  })
  it('quantizes every channel to 8-step levels (16-bit-ish ramp)', () => {
    const p = palette('#7c4a24')
    for (const c of [p.outline, p.base, p.light]) {
      const n = parseInt(c.slice(1), 16)
      for (const ch of [n >> 16, (n >> 8) & 255, n & 255]) assert.equal(ch % 8, 0, `${c} channel ${ch}`)
    }
  })
  it('is deterministic', () => {
    assert.deepEqual(palette('#5d3a1e'), palette('#5d3a1e'))
  })
})

describe('frameOf', () => {
  it('steps through frames at the given rate and wraps', () => {
    assert.equal(frameOf(0, 8, 4), 0)
    assert.equal(frameOf(0.13, 8, 4), 1)
    assert.equal(frameOf(0.26, 8, 4), 2)
    assert.equal(frameOf(0.5, 8, 4), 0)     // 4 frames at 8fps wrap after 0.5s
  })
  it('returns the same frame for nearby times inside one frame', () => {
    assert.equal(frameOf(0.01, 8, 4), frameOf(0.02, 8, 4))
  })
})

describe('withPixelStage (node fallback path)', () => {
  it('rotates by the snapped angle, scales art px to screen px, balances save/restore', () => {
    const ctx = recordingCtx()
    withPixelStage(ctx, 32, 48, 0.1, 32, c => { c.fillRect(-4, -8, 8, 16) })
    const rot = ctx.ops.find(o => o[0] === 'rotate')
    assert.ok(rot, 'no rotate op')
    assert.equal(rot[1], 0)                              // 0.1 snaps to 0
    const scale = ctx.ops.find(o => o[0] === 'scale')
    assert.ok(scale, 'no scale op')
    assert.equal(scale[1], 32 / TILE_ART_PX)             // S=32 -> 2 screen px per art px
    assert.equal(scale[2], 32 / TILE_ART_PX)
    assert.ok(ctx.ops.some(o => o[0] === 'fillRect'))
    const saves = ctx.ops.filter(o => o[0] === 'save').length
    assert.equal(saves, ctx.ops.filter(o => o[0] === 'restore').length)
    assert.ok(saves >= 1)
  })
  it('draws identically for two angles that snap to the same direction', () => {
    const a = recordingCtx(), b = recordingCtx()
    const draw = c => { c.fillRect(0, 0, 4, 4) }
    withPixelStage(a, 16, 16, 0.05, 32, draw)
    withPixelStage(b, 16, 16, -0.05, 32, draw)
    assert.deepEqual(a.ops, b.ops)
  })
})
