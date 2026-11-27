import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeWeatherLayer, fogBlobs, drawNight, drawFog, drawHaze, nightBands, HAZE } from '../renderer/render/weather.js'

// Records every draw with the composite op / alpha / smoothing in force at
// the time. Unknown methods are recorded generically via the Proxy.
function recordingCtx() {
  const ops = []
  let alpha = 1, gco = 'source-over', filter = 'none', fillStyle = '', smooth = false
  const stack = []
  const base = {
    ops,
    drawImage: (img, ...a) => ops.push({ name: 'drawImage', img, a, gco, alpha, smooth, filter }),
    fillRect: (...a) => ops.push({ name: 'fillRect', a, gco, alpha, filter, fillStyle }),
    clearRect: (...a) => ops.push({ name: 'clearRect', a }),
    createRadialGradient: () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }),
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

function fakeCanvas() {
  const ctx = recordingCtx()
  return { width: 0, height: 0, ctx, getContext: () => ctx }
}

function layerWith(viewW = 400, viewH = 300) {
  const layer = makeWeatherLayer(fakeCanvas)
  layer.resize(viewW, viewH)
  return layer
}
// a layer that cannot keep a night mask: every lit frame draws the layer straight on
function directLayer(viewW, viewH) {
  const layer = layerWith(viewW, viewH)
  layer.createCanvas = null
  return layer
}

const cam = { camX: 0, camY: 0 }
// How many times each pixel of a 400 x 300 frame is washed (a fill or a blit of the layer) by the night's ops on ctx.
function washCountOf(ctx, layer) {
  const n = new Uint8Array(400 * 300)
  for (const o of ctx.ops) {
    const isBlit = o.name === 'drawImage' && o.img === layer.canvas
    const isFill = o.name === 'fillRect' && o.gco === 'multiply'
    if (!isBlit && !isFill) continue
    const [x, y, w, h] = isBlit ? o.a.slice(4) : o.a
    for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) n[j * 400 + i]++
  }
  return n
}
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

  it('with no light in view, washes the frame with one multiply fill and leaves the layer untouched', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawNight(ctx, layer, look(), cam, view, S)
    assert.deepEqual(layer.ctx.ops, [])
    const wash = ctx.ops.filter(o => o.name === 'fillRect')
    assert.equal(wash.length, 1)
    assert.equal(wash[0].fillStyle, 'rgb(40,60,120)')
    assert.equal(wash[0].gco, 'multiply')
    assert.equal(wash[0].alpha, 0.85)
    assert.deepEqual(wash[0].a, [0, 0, 400, 300])
    assert.equal(ctx.ops.some(o => o.name === 'drawImage'), false)
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
  })

  const washCount = (ctx, layer) => washCountOf(ctx, layer)

  it('drawn straight on (no kept mask), a light fills the layer with the ambient colour and blits it with multiply at the dark alpha, smoothed, where the light reaches', () => {
    const ctx = recordingCtx(), layer = directLayer()
    drawNight(ctx, layer, look({ lights: [{ px: 100, py: 100, r: 4.5, strength: 1, grey: false }] }), cam, view, S)
    const fill = layer.ctx.ops.find(o => o.name === 'fillRect')
    assert.equal(fill.fillStyle, 'rgb(40,60,120)')
    assert.deepEqual(fill.a, [0, 0, 100, 75])
    const blits = ctx.ops.filter(o => o.name === 'drawImage')
    assert.ok(blits.length > 0)
    for (const blit of blits) {
      assert.equal(blit.img, layer.canvas)
      assert.equal(blit.gco, 'multiply')
      assert.equal(blit.alpha, 0.85)
      assert.equal(blit.smooth, true)
      // the layer's part under it, at the whole frame's scale (layer 100 x 75 over 400 x 300)
      const [sx, sy, sw, sh, dx, dy, dw, dh] = blit.a
      assert.deepEqual([sx, sy, sw, sh], [dx / 4, dy / 4, dw / 4, dh / 4])
    }
    // the rest of the frame is the flat colour the layer holds there, at the same alpha
    const fills = ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'multiply')
    assert.ok(fills.length > 0)
    for (const f of fills) { assert.equal(f.fillStyle, 'rgb(40,60,120)'); assert.equal(f.alpha, 0.85) }
    // every pixel washed exactly once; every pixel the light's hole reaches by the layer
    const n = washCount(ctx, layer)
    assert.ok(n.every(v => v === 1), 'fills and blits cover the frame once')
    const blitted = new Uint8Array(view.W * view.H)
    for (const b of blits) { const [x, y, w, h] = b.a.slice(4); for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) blitted[j * view.W + i] = 1 }
    const R = 4.5 * 32 + 8
    for (let j = 0; j < view.H; j++) for (let i = 0; i < view.W; i++) {
      if (Math.hypot(i + 0.5 - 100, j + 0.5 - 100) <= R) assert.equal(blitted[j * view.W + i], 1, `pixel ${i},${j} in the light is blitted`)
    }
    assert.ok(blitted.reduce((a, v) => a + v, 0) < 0.6 * view.W * view.H, 'a light in a corner blits well under the frame')
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing restored')
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
    assert.equal(ctx.filter, 'none', 'ctx filter settled')
  })

  it('punches a destination-out hole per light in the layer and adds a lighter glow on the frame', () => {
    const ctx = recordingCtx(), layer = directLayer()
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
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
    assert.equal(ctx.filter, 'none', 'ctx filter settled')
  })

  it('a grey (deadwood) light glows blue, an ordinary one orange', () => {
    const ctx = recordingCtx(), layer = layerWith()
    const lights = [{ px: 100, py: 100, r: 4.5, strength: 1, grey: true }, { px: 200, py: 100, r: 4.5, strength: 1, grey: false }]
    drawNight(ctx, layer, look({ lights }), cam, view, S)
    const glow = ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'lighter').map(o => o.fillStyle.stops[0][1])
    assert.equal(glow.length, 2)
    const [br, bg, bb] = glow[0].match(/rgba\((\d+),(\d+),(\d+)/).slice(1).map(Number)
    assert.ok(bb > br + 80 && bb > bg, `blue glow, got ${glow[0]}`)
    const [or, og, ob] = glow[1].match(/rgba\((\d+),(\d+),(\d+)/).slice(1).map(Number)
    assert.ok(or > ob && og > ob, `orange glow, got ${glow[1]}`)
  })

  it('a light\'s glow says how far its warm glow reaches (tiles), 0 none: the hole is punched all the same', () => {
    const ctx = recordingCtx(), layer = directLayer()
    const lights = [{ px: 100, py: 100, r: 3, strength: 1, grey: false, glow: 1 }, { px: 200, py: 100, r: 1.5, strength: 0.7, grey: false, glow: 0 }]
    drawNight(ctx, layer, look({ lights }), cam, view, S)
    assert.equal(layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'destination-out').length, 2, 'both punch their hole')
    const glow = ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'lighter')
    assert.equal(glow.length, 1, 'only the first glows')
    assert.deepEqual(glow[0].a, [100 - 32, 100 - 32, 64, 64], 'a glow of one tile round it')
  })

  it('lights all over the frame still wash every pixel once', () => {
    const ctx = recordingCtx(), layer = directLayer()
    const lights = []
    for (let i = 0; i < 12; i++) lights.push({ px: (i * 97) % 400, py: (i * 61) % 300, r: i % 2 ? 3 : 1.5, strength: 1, grey: false, glow: 0 })
    drawNight(ctx, layer, look({ lights }), cam, view, S)
    assert.ok(washCount(ctx, layer).every(v => v === 1))
  })

  it('cuts the bands on whole device pixels, top to bottom, with runs inside the frame', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 1.1]) {
      const W = 1023, H = 701
      const bands = nightBands([{ x: 300, y: 200, r: 96 }, { x: 900, y: 650, r: 48 }, { x: 310, y: 260, r: 48 }], W, H, dpr)
      assert.equal(bands[0].y0, 0); assert.equal(bands.at(-1).y1, H)
      const whole = v => v === W || v === H || Math.abs(v * dpr - Math.round(v * dpr)) < 1e-6
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i]
        if (i) assert.equal(b.y0, bands[i - 1].y1, 'bands follow on')
        assert.ok(whole(b.y0) && whole(b.y1), `band edge on a device pixel at dpr ${dpr}`)
        let x = 0
        for (const [x0, x1] of b.runs) {
          assert.ok(x0 >= x && x1 > x0 && x1 <= W)
          assert.ok(whole(x0) && whole(x1), `run edge on a device pixel at dpr ${dpr}`)
          x = x1
        }
      }
      // two bands in a row never have the same runs (they are one band then)
      for (let i = 1; i < bands.length; i++) assert.notDeepEqual(bands[i].runs, bands[i - 1].runs)
    }
    assert.deepEqual(nightBands([], 400, 300), [{ y0: 0, y1: 300, runs: [] }], 'no hole: one band, all flat')
  })

  // The kept night mask: the layer for the view and a pad of 160 px, scaled up once.
  const lamp = { px: 100, py: 100, r: 3, strength: 1, grey: false, glow: 0 }
  const opsOf = c => c ? c.ctx.ops.length : 0

  it('a lit frame keeps a night mask: the layer for the view and a pad, scaled up once, blitted 1:1 with multiply', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawNight(ctx, layer, look({ lights: [lamp] }), { camX: 10.5, camY: 20 }, view, S)
    const N = layer.night
    // 400 + 320 by 300 + 320 css px over a quarter-resolution layer of 180 x 155
    assert.deepEqual([N.full.width, N.full.height, N.q.width, N.q.height], [720, 620, 180, 155])
    assert.deepEqual([N.x0, N.y0], [10 - 160, 20 - 160])
    const fill = N.q.ctx.ops.find(o => o.name === 'fillRect')
    assert.equal(fill.fillStyle, 'rgb(40,60,120)'); assert.deepEqual(fill.a, [0, 0, 180, 155])
    const holes = N.q.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'destination-out')
    assert.equal(holes.length, 1)
    const r = 3 * 32 * 0.25, hx = (100 - N.x0) * 0.25, hy = (100 - N.y0) * 0.25
    assert.deepEqual(holes[0].a, [hx - r, hy - r, 2 * r, 2 * r])
    const up = N.full.ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(up.length, 1)
    assert.equal(up[0].img, N.q); assert.equal(up[0].smooth, true)
    assert.deepEqual(up[0].a, [0, 0, 180, 155, 0, 0, 720, 620], 'exactly four times')
    const blits = ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(blits.length, 1)
    assert.equal(blits[0].img, N.full)
    assert.equal(blits[0].gco, 'multiply'); assert.equal(blits[0].alpha, 0.85); assert.equal(blits[0].smooth, false)
    assert.deepEqual(blits[0].a, [N.x0 - 10.5, N.y0 - 20])
    assert.equal(layer.ctx.ops.length, 0, 'the view layer is not drawn')
    assert.equal(ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'multiply').length, 0)
    assert.equal(ctx.imageSmoothingEnabled, false); assert.equal(ctx.globalCompositeOperation, 'source-over'); assert.equal(ctx.globalAlpha, 1)
  })

  it('the next frames blit the kept mask at the camera\'s offset while the lights hold and the view stays inside it', () => {
    const layer = layerWith()
    drawNight(recordingCtx(), layer, look({ lights: [lamp] }), cam, view, S)
    const N = layer.night, q = opsOf(N.q), full = opsOf(N.full)
    for (const [camX, camY] of [[40, 0], [160, 160], [-160, -100], [7.25, 3]]) {
      const ctx = recordingCtx()
      // the same lights, made anew as every frame does
      drawNight(ctx, layer, look({ lights: [{ ...lamp }], t: camX }), { camX, camY }, view, S)
      assert.equal(opsOf(N.q), q, 'not built again'); assert.equal(opsOf(N.full), full)
      const b = ctx.ops.filter(o => o.name === 'drawImage')
      assert.equal(b.length, 1); assert.equal(b[0].img, N.full)
      assert.deepEqual(b[0].a, [N.x0 - camX, N.y0 - camY])
    }
    assert.equal(N.builds, 1)
  })

  it('the view leaving the mask, a light that comes or changes, or a new colour builds it anew', () => {
    const cases = [
      ['the view leaves it', { camX: 161, camY: 0 }, look({ lights: [lamp] })],
      ['a light comes', cam, look({ lights: [lamp, { ...lamp, px: 300 }] })],
      ['a light changes', cam, look({ lights: [{ ...lamp, strength: 0.5 }] })],
      ['the colour changes', cam, look({ lights: [lamp], ambient: [41, 60, 120] })],
    ]
    for (const [what, c, lk] of cases) {
      const layer = layerWith()
      drawNight(recordingCtx(), layer, look({ lights: [lamp] }), cam, view, S)
      for (let i = 0; i < 6; i++) drawNight(recordingCtx(), layer, look({ lights: [lamp] }), cam, view, S)
      const ctx = recordingCtx()
      drawNight(ctx, layer, lk, c, view, S)
      assert.equal(layer.night.builds, 2, what)
      assert.equal(ctx.ops.filter(o => o.name === 'drawImage')[0].img, layer.night.full, what)
    }
    // a light far outside the mask changes nothing
    const layer = layerWith()
    drawNight(recordingCtx(), layer, look({ lights: [lamp] }), cam, view, S)
    for (let i = 0; i < 8; i++) drawNight(recordingCtx(), layer, look({ lights: [lamp, { ...lamp, px: 3000, strength: i / 8 }] }), cam, view, S)
    assert.equal(layer.night.builds, 1)
    // nor does the darkness alone (it is the blit's alpha)
    const ctx = recordingCtx()
    drawNight(ctx, layer, look({ lights: [lamp], dark: 0.4 }), cam, view, S)
    assert.equal(layer.night.builds, 1)
    assert.equal(ctx.ops.find(o => o.name === 'drawImage').alpha, 0.4)
  })

  it('built at most every six frames, and less often while each build is undone at once: the frames between draw the layer straight on', () => {
    const layer = layerWith()
    // a light that is never the same two frames running
    const frame = n => { const ctx = recordingCtx(); drawNight(ctx, layer, look({ lights: [{ ...lamp, px: 100 + n / 2, strength: 1 - n / 400 }] }), cam, view, S); return ctx }
    let direct = 0
    for (let n = 0; n < 200; n++) {
      const ctx = frame(n)
      const b = ctx.ops.filter(o => o.name === 'drawImage')
      if (b.length && b[0].img === layer.canvas) {
        direct++
        assert.ok(washCountOf(ctx, layer).every(v => v === 1), 'a straight frame washes every pixel once')
      } else assert.equal(b[0].img, layer.night.full)
    }
    assert.ok(layer.night.builds <= 8, `a light changing every frame: ${layer.night.builds} builds in 200 frames`)
    assert.equal(direct, 200 - layer.night.builds, 'every other frame straight on')
    assert.equal(layer.night.straight, direct, 'and counted')
    // then the lights hold: built once more and kept
    const before = layer.night.builds
    for (let n = 0; n < 80; n++) drawNight(recordingCtx(), layer, look({ lights: [lamp] }), cam, view, S)
    assert.equal(layer.night.builds, before + 1)
    // and a mask that was kept a while is built anew within six frames of the next change
    const moved = { ...lamp, px: 140 }
    let n = 0
    while (layer.night.builds === before + 1 && n < 20) { drawNight(recordingCtx(), layer, look({ lights: [moved] }), cam, view, S); n++ }
    assert.ok(n <= 6, `built again after ${n} frames`)
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

  it('paints blobs, masks them additively then blurs the mask in one blit, and blits at 0.85 × fog level', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawFog(ctx, layer, look({ fog: 0.5 }), fog, cam, view, S)
    // blobs: source-over gradient fills in the layer
    assert.ok(layer.ctx.ops.some(o => o.name === 'fillRect' && o.gco === 'source-over'))
    // mask: one unblurred rect per visible cell, summed additively, alpha from the cell weight
    const maskRects = layer.maskCtx.ops.filter(o => o.name === 'fillRect')
    assert.equal(maskRects.length, 2)
    assert.equal(maskRects[0].gco, 'lighter')
    assert.equal(maskRects[0].filter, 'none')
    assert.equal(maskRects[0].fillStyle, 'rgba(0,0,0,1)')
    assert.deepEqual(maskRects[0].a, [5 * 32 * 0.25, 4 * 32 * 0.25, 8, 8])
    assert.equal(maskRects[1].fillStyle, 'rgba(0,0,0,0.5)')
    // mask applied with one blurred destination-in drawImage of the mask canvas
    const applied = layer.ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(applied.length, 1)
    assert.equal(applied[0].img, layer.mask)
    assert.equal(applied[0].gco, 'destination-in')
    assert.equal(applied[0].filter, 'blur(2px)')
    // final blit
    const blit = ctx.ops.find(o => o.name === 'drawImage')
    assert.equal(blit.img, layer.canvas)
    assert.equal(blit.gco, 'source-over')
    assert.ok(Math.abs(blit.alpha - 0.425) < 1e-9)
    assert.equal(blit.smooth, true)
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing restored')
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
    assert.equal(ctx.filter, 'none', 'ctx filter settled')
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

  it('keeps a one-cell margin outside the view but clips beyond it', () => {
    // c0 = floor(0/32) = 0, so x = -1 is one column left of view, x = -2 is two.
    const near = { cx: -1, cy: 4, radius: 3, cells: [{ x: -1, y: 4, w: 1 }] }
    const nearCtx = recordingCtx(), nearLayer = layerWith()
    drawFog(nearCtx, nearLayer, look(), near, cam, view, S)
    assert.equal(nearLayer.maskCtx.ops.filter(o => o.name === 'fillRect').length, 1, 'one cell left of view is still drawn')

    const far = { cx: -2, cy: 4, radius: 3, cells: [{ x: -2, y: 4, w: 1 }] }
    const farCtx = recordingCtx(), farLayer = layerWith()
    drawFog(farCtx, farLayer, look(), far, cam, view, S)
    assert.deepEqual(farCtx.ops, [], 'two cells left of view draws nothing')
  })

  it('skips an unexplored cell, draws an explored one, and gates nothing when no map is passed', () => {
    // fog cells: (5,4) and (6,4). Mark (5,4) unexplored, (6,4) explored.
    const map = { 4: { 5: { explored: false }, 6: { explored: true } } }
    const ctx1 = recordingCtx(), layer1 = layerWith()
    drawFog(ctx1, layer1, look(), fog, cam, view, S, map)
    assert.equal(layer1.maskCtx.ops.filter(o => o.name === 'fillRect').length, 1, 'only the explored cell is drawn into the mask')

    const explored = { 4: { 5: { explored: true }, 6: { explored: true } } }
    const ctx2 = recordingCtx(), layer2 = layerWith()
    drawFog(ctx2, layer2, look(), fog, cam, view, S, explored)
    assert.equal(layer2.maskCtx.ops.filter(o => o.name === 'fillRect').length, 2, 'both explored cells are drawn')

    const ctx3 = recordingCtx(), layer3 = layerWith()
    drawFog(ctx3, layer3, look(), fog, cam, view, S)   // no map ⇒ no explored gating
    assert.equal(layer3.maskCtx.ops.filter(o => o.name === 'fillRect').length, 2)
  })
})

describe('drawHaze', () => {
  const look = storm => ({ dark: 0, ambient: [255, 255, 255], fog: 0.15, t: 3, lights: [], storm })
  const storm = (over = {}) => ({ s: 1, wind: Math.PI / 4, px: 200, py: 150, r: 4, ...over })

  it('draws nothing without a storm', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawHaze(ctx, layer, look(null), cam, view, S)
    drawHaze(ctx, layer, look(storm({ s: 0 })), cam, view, S)
    assert.deepEqual(ctx.ops, [])
    assert.deepEqual(layer.ctx.ops, [])
  })

  it('fills the layer with sand, clears a disc round the hero, and lays it on the frame at the storm\'s strength', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawHaze(ctx, layer, look(storm()), cam, view, S)
    const fills = layer.ctx.ops.filter(o => o.name === 'fillRect')
    assert.equal(fills[0].gco, 'source-over')
    assert.deepEqual(fills[0].a, [0, 0, layer.w, layer.h])
    const hole = fills.find(o => o.gco === 'destination-out')
    assert.ok(hole, 'no clear disc')
    const g = hole.fillStyle
    assert.ok(g.stops.length >= 2)
    // smoothed up to half the frame, then doubled onto it without smoothing: one blit onto the frame
    const up = layer.half.ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(up.length, 1)
    assert.equal(up[0].img, layer.canvas)
    assert.equal(up[0].smooth, true)
    assert.deepEqual(up[0].a.slice(4), [0, 0, 200, 150])
    const blits = ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(blits.length, 1)
    assert.equal(blits[0].img, layer.half)
    assert.equal(blits[0].gco, 'source-over')
    assert.equal(blits[0].smooth, false)
    assert.ok(Math.abs(blits[0].alpha - HAZE.far) < 1e-9)
    assert.deepEqual(blits[0].a.slice(4), [0, 0, 400, 300])
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing as the frame keeps it')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    // a layer that cannot make a canvas blits itself, smoothed
    const plain = recordingCtx(), direct = directLayer(400, 300)
    drawHaze(plain, direct, look(storm()), cam, view, S)
    const one = plain.ops.filter(o => o.name === 'drawImage')
    assert.equal(one.length, 1)
    assert.equal(one[0].img, direct.canvas)
    assert.equal(one[0].smooth, true)
    // half a storm: already three quarters of the haze (it thickens fast as the storm rises)
    const half = recordingCtx()
    drawHaze(half, layerWith(), look(storm({ s: 0.5 })), cam, view, S)
    assert.ok(Math.abs(half.ops.find(o => o.name === 'drawImage').alpha - HAZE.far * 0.75) < 1e-9)
    const faint = recordingCtx()
    drawHaze(faint, layerWith(), look(storm({ s: 0.1 })), cam, view, S)
    assert.ok(faint.ops.find(o => o.name === 'drawImage').alpha < HAZE.far * 0.25)
  })

  it('the clear disc sits on the hero and is as wide as his sight', () => {
    const at = (st, c = cam) => {
      const layer = layerWith()
      layer.ctx.createRadialGradient = (x0, y0, r0, x1, y1, r1) => ({ x: x1, y: y1, r: r1, stops: [], addColorStop(o, col) { this.stops.push([o, col]) } })
      drawHaze(recordingCtx(), layer, look(storm(st)), c, view, S)
      return layer.ctx.ops.find(o => o.name === 'fillRect' && o.gco === 'destination-out').fillStyle
    }
    const a = at({}), k = 0.25
    assert.equal(a.x, 200 * k)
    assert.equal(a.y, 150 * k)
    const b = at({}, { camX: 64, camY: 32 })
    assert.equal(b.x, (200 - 64) * k)
    assert.equal(b.y, (150 - 32) * k)
    const wide = at({ r: 8 })
    assert.ok(wide.r > a.r, 'a wider sight, a wider disc')
  })

  it('the dust and the streaks blow along the wind, drift with time, and stay put in the world', () => {
    let made = []
    const layer = () => {
      const l = layerWith()
      l.createCanvas = () => { const c = fakeCanvas(); made.push(c); return c }
      l.ctx.createPattern = img => ({ img })
      return l
    }
    const offsets = (l, t, c = cam, wind = Math.PI / 4) => {
      drawHaze(recordingCtx(), l, { ...look(storm({ wind })), t }, c, view, S)
      const ops = l.ctx.ops.filter(o => o.name === 'translate').map(o => o.args)
      l.ctx.ops.length = 0
      return ops
    }
    const l = layer()
    const a = offsets(l, 0)
    assert.equal(a.length, HAZE.passes.length, 'one repeat of a tile per pass')
    assert.ok(a.every(args => args.every(Number.isInteger)), 'repeated from whole pixels: no resampling')
    // each tile drawn once, turned to the wind, and kept (and one canvas for the frame's half size)
    const tiles = () => made.filter(c => c !== l.half)
    assert.equal(tiles().length, HAZE.passes.length)
    for (const c of tiles()) assert.ok(c.ctx.ops.some(o => o.name === 'rotate' && Math.abs(o.args[0] - Math.PI / 4) < 1e-9), 'a tile not turned to the wind')
    offsets(l, 0.5)
    assert.equal(made.length, HAZE.passes.length + 1, 'the tiles are made again')
    assert.notDeepEqual(offsets(l, 0.5), a, 'no drift')
    assert.notDeepEqual(offsets(l, 0, { camX: 40, camY: 8 }), a, 'pinned to the screen, not the world')
    // a re-centre of the window (80 tiles) moves no tile
    assert.deepEqual(offsets(l, 0, { camX: 80 * S, camY: -80 * S }), a)
    // another wind, other tiles
    made = []
    offsets(l, 0, cam, 0)
    assert.equal(tiles().length, HAZE.passes.length)
  })
})
