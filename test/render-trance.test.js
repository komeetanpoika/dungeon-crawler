import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeTranceLayer, makeHueWheel, drawRainbow, drawWash, HUE_STEPS }
  from '../renderer/render/trance.js'

// Records every draw with the composite op / alpha / filter in force at the
// time. Unknown methods are recorded generically via the Proxy.
function recordingCtx() {
  const ops = []
  let alpha = 1, gco = 'source-over', filter = 'none', fillStyle = '', smooth = false
  const stack = []
  const base = {
    ops,
    drawImage: (img, ...a) => ops.push({ name: 'drawImage', img, a, gco, alpha, smooth, filter }),
    fillRect: (...a) => ops.push({ name: 'fillRect', a, gco, alpha, filter, fillStyle }),
    clearRect: (...a) => ops.push({ name: 'clearRect', a }),
    createRadialGradient: (...a) => ({ a, stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }),
    save: () => stack.push({ gco, alpha, filter, smooth }),
    restore: () => { const s = stack.pop(); if (s) ({ gco, alpha, filter, smooth } = s) },
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

const fakeCanvas = () => { const ctx = recordingCtx(); return { width: 0, height: 0, ctx, getContext: () => ctx } }
const view = { W: 400, H: 300 }
const blobs = t => [
  { x: 0.2, y: 0.3, r: 0.3, hue: 0 },
  { x: 0.7, y: 0.6, r: 0.35, hue: 120 + t },
  { x: 0.5, y: 0.5, r: 0.28, hue: 240 },
]

describe('makeTranceLayer', () => {
  it('paints at quarter resolution to keep the software canvas honest', () => {
    const layer = makeTranceLayer(fakeCanvas)
    layer.resize(400, 300)
    assert.equal(layer.w, 100)
    assert.equal(layer.h, 75)
    assert.equal(layer.canvas.width, 100)
  })
})

describe('drawRainbow', () => {
  const paint = (alpha, list = blobs(0)) => {
    const ctx = recordingCtx()
    const layer = makeTranceLayer(fakeCanvas)
    layer.resize(view.W, view.H)
    drawRainbow(ctx, layer, { alpha, blobs: list }, view)
    return { ctx, layer }
  }

  it('paints nothing at all before the trip has started', () => {
    assert.equal(paint(0).ctx.ops.length, 0)
  })

  it('lays one gradient per blob onto the layer', () => {
    const { layer } = paint(1)
    assert.equal(layer.ctx.ops.filter(o => o.name === 'fillRect').length, 3)
  })

  it('blends the layer over the frame so the world takes the colour', () => {
    const { ctx } = paint(1)
    const blit = ctx.ops.find(o => o.name === 'drawImage')
    assert.ok(blit, 'the layer reaches the frame')
    assert.equal(blit.gco, 'overlay')
    assert.ok(blit.smooth, 'upscaled smoothly, not as quarter-res blocks')
  })

  it('deepens with the trance instead of arriving all at once', () => {
    const at = a => paint(a).ctx.ops.find(o => o.name === 'drawImage').alpha
    assert.ok(at(1) > at(0.3))
    assert.ok(at(1) <= 0.6, 'never a solid sheet of colour')
  })

  it('leaves the frame nearest-neighbour for everything drawn after it', () => {
    const { ctx } = paint(1)
    assert.equal(ctx.imageSmoothingEnabled, false)
  })

  it('gives each blob its own colour', () => {
    const { layer } = paint(1)
    const fills = layer.ctx.ops.filter(o => o.name === 'fillRect').map(o => JSON.stringify(o.fillStyle))
    assert.equal(new Set(fills).size, 3)
  })
})

describe('drawWash', () => {
  it('is invisible until the call carries the player', () => {
    const ctx = recordingCtx()
    drawWash(ctx, 0, view)
    assert.equal(ctx.ops.length, 0)
  })

  it('covers the whole view at the hand-over so the arrival is unseen', () => {
    const ctx = recordingCtx()
    drawWash(ctx, 1, view)
    const fill = ctx.ops.find(o => o.name === 'fillRect')
    assert.deepEqual(fill.a, [0, 0, 400, 300])
    assert.equal(fill.alpha, 1)
  })

  it('is part-way through at the edges of the pull', () => {
    const ctx = recordingCtx()
    drawWash(ctx, 0.4, view)
    assert.equal(ctx.ops.find(o => o.name === 'fillRect').alpha, 0.4)
  })
})

describe('makeHueWheel', () => {
  const img = { width: 32, height: 32 }

  it('hue-rotates a sprite into its own canvas', () => {
    const wheel = makeHueWheel(fakeCanvas)
    wheel.beginFrame()
    const v = wheel.variant('crab', img, 360 / HUE_STEPS)
    assert.notEqual(v, img, 'a recoloured copy, not the original')
    const draw = v.ctx.ops.find(o => o.name === 'drawImage')
    assert.equal(draw.filter, `hue-rotate(${360 / HUE_STEPS}deg)`)
    assert.equal(v.width, 32)
  })

  it('quantises to HUE_STEPS so a wheel is worth caching', () => {
    const wheel = makeHueWheel(fakeCanvas)
    wheel.beginFrame()
    const step = 360 / HUE_STEPS
    assert.equal(wheel.variant('crab', img, step * 1.1), wheel.variant('crab', img, step * 0.9))
    assert.equal(wheel.built, 1)
  })

  it('copies nothing at all while a sprite is still on its own colour', () => {
    const wheel = makeHueWheel(fakeCanvas)
    wheel.beginFrame()
    // The long early stretch of a trip rounds to step zero — no copy is worth
    // making, and none is: the sprite goes to the screen as it is.
    assert.equal(wheel.variant('crab', img, 4), img)
    assert.equal(wheel.variant('crab', img, 359), img, 'and the same coming round the far side')
    assert.equal(wheel.built, 0)
  })

  it('builds only a few per frame — the rest wait their turn', () => {
    const wheel = makeHueWheel(fakeCanvas, { budget: 2 })
    const DEG = 360 / HUE_STEPS
    wheel.beginFrame()
    wheel.variant('a', img, DEG)
    wheel.variant('b', img, DEG)
    assert.equal(wheel.variant('c', img, DEG), img, 'over budget, drawn plain this frame')
    assert.equal(wheel.built, 2)
    wheel.beginFrame()
    assert.notEqual(wheel.variant('c', img, DEG), img, 'built on the next frame')
  })

  it('spends no budget on a variant it already holds', () => {
    const wheel = makeHueWheel(fakeCanvas, { budget: 2 })
    const DEG = 360 / HUE_STEPS
    wheel.beginFrame()
    const first = wheel.variant('a', img, DEG)
    assert.equal(wheel.variant('a', img, DEG), first)
    assert.notEqual(wheel.variant('b', img, DEG), img, 'the budget was not spent on the cache hit')
  })

  it('drops the whole wheel when the trip ends', () => {
    const wheel = makeHueWheel(fakeCanvas)
    wheel.beginFrame()
    wheel.variant('a', img, 0)
    wheel.clear()
    assert.equal(wheel.built, 0)
  })

  it('hands back the original when there is nothing to recolour', () => {
    const wheel = makeHueWheel(fakeCanvas)
    wheel.beginFrame()
    assert.equal(wheel.variant('a', null, 90), null)
  })
})
