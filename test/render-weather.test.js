import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeWeatherLayer, fogBlobs, drawNight, drawFog } from '../renderer/render/weather.js'

// Records every draw with the composite op / alpha / smoothing in force at
// the time. Unknown methods are recorded generically via the Proxy.
function recordingCtx() {
  const ops = []
  let alpha = 1, gco = 'source-over', filter = 'none', fillStyle = '', smooth = false
  const base = {
    ops,
    drawImage: (img, ...a) => ops.push({ name: 'drawImage', img, a, gco, alpha, smooth }),
    fillRect: (...a) => ops.push({ name: 'fillRect', a, gco, alpha, filter, fillStyle }),
    clearRect: (...a) => ops.push({ name: 'clearRect', a }),
    createRadialGradient: () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }),
    get imageSmoothingEnabled() { return smooth }, set imageSmoothingEnabled(v) { smooth = v },
    get globalAlpha() { return alpha }, set globalAlpha(v) { alpha = v },
    get globalCompositeOperation() { return gco }, set globalCompositeOperation(v) { gco = v },
    get filter() { return filter }, set filter(v) { filter = v },
    get fillStyle() { return fillStyle }, set fillStyle(v) { fillStyle = v },
  }
  return new Proxy(base, {
    get(t, p, r) { if (p in t) return Reflect.get(t, p, r); return (...args) => { ops.push({ name: p, args }) } },
  })
}

function fakeCanvas() {
  const ctx = recordingCtx()
  return { width: 0, height: 0, ctx, getContext: () => ctx }
}

function layerWith(viewW = 400, viewH = 300) {
  const layer = makeWeatherLayer(fakeCanvas)
  layer.resize(viewW, viewH)
  return layer
}

const cam = { camX: 0, camY: 0 }
const view = { W: 400, H: 300 }
const S = 32

describe('makeWeatherLayer', () => {
  it('holds two quarter-resolution canvases sized on resize', () => {
    const layer = layerWith(401, 301)
    assert.equal(layer.k, 0.25)
    assert.equal(layer.w, 101)
    assert.equal(layer.h, 76)
    assert.equal(layer.canvas.width, 101)
    assert.equal(layer.mask.width, 101)
    assert.equal(layer.mask.height, 76)
  })
})

describe('fogBlobs', () => {
  const fog = { cx: 57, cy: 40, radius: 9, cells: [] }

  it('makes 16 deterministic blobs inside the radius and memoises them', () => {
    const blobs = fogBlobs(fog)
    assert.equal(blobs.length, 16)
    for (const b of blobs) {
      assert.ok(Math.hypot(b.x - 57.5, b.y - 40.5) <= 9)
      assert.ok(b.r >= 1.5 && b.r <= 3)
    }
    assert.equal(fogBlobs(fog), blobs)
    assert.deepEqual(fogBlobs({ ...fog, cells: [] }), blobs)   // same anchor → same blobs
  })
})

describe('drawNight', () => {
  const look = (over = {}) => ({ dark: 0.85, ambient: [40, 60, 120], fog: 1, t: 0, lights: [], ...over })

  it('draws nothing when dark is 0', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawNight(ctx, layer, look({ dark: 0 }), cam, view, S)
    assert.deepEqual(ctx.ops, [])
    assert.deepEqual(layer.ctx.ops, [])
  })

  it('fills the layer with the ambient colour and blits it with multiply at the dark alpha, smoothed', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawNight(ctx, layer, look(), cam, view, S)
    const fill = layer.ctx.ops.find(o => o.name === 'fillRect')
    assert.equal(fill.fillStyle, 'rgb(40,60,120)')
    assert.deepEqual(fill.a, [0, 0, 100, 75])
    const blit = ctx.ops.find(o => o.name === 'drawImage')
    assert.equal(blit.img, layer.canvas)
    assert.equal(blit.gco, 'multiply')
    assert.equal(blit.alpha, 0.85)
    assert.equal(blit.smooth, true)
    assert.deepEqual(blit.a, [0, 0, 100, 75, 0, 0, 400, 300])
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing restored')
  })

  it('punches a destination-out hole per light in the layer and adds a lighter glow on the frame', () => {
    const ctx = recordingCtx(), layer = layerWith()
    const light = { px: 100, py: 100, r: 4.5, strength: 1, grey: false }
    drawNight(ctx, layer, look({ lights: [light] }), cam, view, S)
    const hole = layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'destination-out')
    assert.equal(hole.length, 1)
    const r = 4.5 * 32 * 0.25
    assert.deepEqual(hole[0].a, [25 - r, 25 - r, 2 * r, 2 * r])
    const glow = ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'lighter')
    assert.equal(glow.length, 1)
    const blitIdx = ctx.ops.findIndex(o => o.name === 'drawImage')
    assert.ok(ctx.ops.indexOf(glow[0]) > blitIdx, 'glow lands after the wash')
  })

  it('skips lights that are off the layer', () => {
    const ctx = recordingCtx(), layer = layerWith()
    const far = { px: 5000, py: 5000, r: 2, strength: 1, grey: false }
    drawNight(ctx, layer, look({ lights: [far] }), cam, view, S)
    assert.equal(layer.ctx.ops.filter(o => o.gco === 'destination-out').length, 0)
    assert.equal(ctx.ops.filter(o => o.gco === 'lighter').length, 0)
  })
})

describe('drawFog', () => {
  const look = (over = {}) => ({ dark: 0, ambient: [255, 255, 255], fog: 1, t: 3, lights: [], ...over })
  const fog = { cx: 5, cy: 4, radius: 3, cells: [{ x: 5, y: 4, w: 1 }, { x: 6, y: 4, w: 0.5 }] }

  it('draws nothing without fog, below the fog floor, or with no cell in view', () => {
    let ctx = recordingCtx(), layer = layerWith()
    drawFog(ctx, layer, look(), null, cam, view, S)
    assert.deepEqual(ctx.ops, [])
    drawFog(ctx, layer, look({ fog: 0.01 }), fog, cam, view, S)
    assert.deepEqual(ctx.ops, [])
    drawFog(ctx, layer, look(), fog, { camX: 10000, camY: 10000 }, view, S)
    assert.deepEqual(ctx.ops, [])
  })

  it('paints blobs, masks them through a blurred cell mask, and blits at 0.85 × fog level', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawFog(ctx, layer, look({ fog: 0.5 }), fog, cam, view, S)
    // blobs: source-over gradient fills in the layer
    assert.ok(layer.ctx.ops.some(o => o.name === 'fillRect' && o.gco === 'source-over'))
    // mask: one blurred rect per visible cell, alpha from the cell weight
    const maskRects = layer.maskCtx.ops.filter(o => o.name === 'fillRect')
    assert.equal(maskRects.length, 2)
    assert.equal(maskRects[0].filter, 'blur(2px)')
    assert.equal(maskRects[0].fillStyle, 'rgba(0,0,0,1)')
    assert.deepEqual(maskRects[0].a, [5 * 32 * 0.25, 4 * 32 * 0.25, 8, 8])
    assert.equal(maskRects[1].fillStyle, 'rgba(0,0,0,0.5)')
    // mask applied with one destination-in drawImage of the mask canvas
    const applied = layer.ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(applied.length, 1)
    assert.equal(applied[0].img, layer.mask)
    assert.equal(applied[0].gco, 'destination-in')
    // final blit
    const blit = ctx.ops.find(o => o.name === 'drawImage')
    assert.equal(blit.img, layer.canvas)
    assert.equal(blit.gco, 'source-over')
    assert.ok(Math.abs(blit.alpha - 0.425) < 1e-9)
    assert.equal(blit.smooth, true)
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing restored')
  })

  it('moves the blobs with the animation timer', () => {
    const a = recordingCtx(), b = recordingCtx(), layer = layerWith()
    drawFog(a, layer, look({ t: 0 }), fog, cam, view, S)
    const first = layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'source-over').map(o => o.a)
    layer.ctx.ops.length = 0
    drawFog(b, layer, look({ t: 5 }), fog, cam, view, S)
    const second = layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'source-over').map(o => o.a)
    assert.notDeepEqual(first, second)
  })
})
