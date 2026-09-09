// The mushroom trip's rendering: the rainbow that creeps over the world during
// the minute after ingestion, the whiteout that carries the player to the ring,
// and the wheel of hue-rotated sprites that lets every object shine in its own
// colour at its own rate (hues come from systems/rites.js spriteHue).
//
// Everything here is shaped by the software canvas Electron falls back to on
// this machine: the rainbow is painted once at quarter resolution and blitted,
// and the hue wheel is built a couple of sprites per frame — never in one hitch
// — and thrown away when the trip ends.

const LAYER_SCALE = 0.25   // quarter logical resolution, as the weather layer
const RAINBOW_MAX = 0.5    // composite alpha at the peak of the trip
export const HUE_STEPS = 12
const STEP_DEG = 360 / HUE_STEPS

// `createCanvas` is injected so the renderer can pass document.createElement
// and tests a stub.
export function makeTranceLayer(createCanvas) {
  const canvas = createCanvas()
  const layer = {
    canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, k: LAYER_SCALE,
    resize(viewW, viewH) {
      layer.w = Math.ceil(viewW * LAYER_SCALE)
      layer.h = Math.ceil(viewH * LAYER_SCALE)
      canvas.width = layer.w
      canvas.height = layer.h
    },
  }
  return layer
}

// Soft colour blobs drifting over the whole frame, composited with `overlay`:
// where the layer is clear the frame is untouched, and under a blob the world
// keeps its own light and darkness while taking the blob's hue.
export function drawRainbow(ctx, layer, rainbow, { W, H }) {
  if (!layer || !(rainbow?.alpha > 0) || !rainbow.blobs?.length) return
  const L = layer.ctx
  L.setTransform(1, 0, 0, 1, 0, 0)
  L.globalCompositeOperation = 'source-over'
  L.globalAlpha = 1
  L.filter = 'none'
  L.clearRect(0, 0, layer.w, layer.h)
  const span = Math.max(layer.w, layer.h)
  for (const b of rainbow.blobs) {
    const x = b.x * layer.w, y = b.y * layer.h, r = Math.max(1, b.r * span)
    const g = L.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `hsla(${b.hue}, 100%, 55%, 0.9)`)
    g.addColorStop(1, `hsla(${b.hue}, 100%, 55%, 0)`)
    L.fillStyle = g
    L.fillRect(x - r, y - r, 2 * r, 2 * r)
  }
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = RAINBOW_MAX * Math.min(1, rainbow.alpha)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(layer.canvas, 0, 0, layer.w, layer.h, 0, 0, W, H)
  ctx.imageSmoothingEnabled = false   // explicit: the rest of the frame is nearest-neighbour
  ctx.restore()
}

// The call's whiteout. Full at the hand-over, which is where the player is
// moved, so the arrival is never seen.
export function drawWash(ctx, wash, { W, H }) {
  if (!(wash > 0)) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, wash)
  ctx.fillStyle = '#eafff0'
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

// Hue-rotated copies of sprites, quantised to HUE_STEPS and cached by
// key+step. Only what is actually on screen is ever built, at most `budget` new
// images per frame; anything still unbuilt is drawn in its own colours that
// frame and picked up on a later one.
export function makeHueWheel(createCanvas, { budget = 3 } = {}) {
  const cache = new Map()
  let spent = 0
  return {
    get built() { return cache.size },
    beginFrame() { spent = 0 },
    clear() { cache.clear() },
    variant(key, img, hue) {
      if (!img) return img
      const step = Math.round(hue / STEP_DEG) % HUE_STEPS
      // Step zero is the sprite's own colour — the long early stretch of a
      // trip — so no copy is worth making and none is made.
      if (step === 0) return img
      const id = `${key}#${step}`
      const hit = cache.get(id)
      if (hit) return hit
      if (spent >= budget) return img
      spent++
      const c = createCanvas()
      c.width = img.width
      c.height = img.height
      const cx = c.getContext('2d')
      cx.imageSmoothingEnabled = false
      cx.filter = `hue-rotate(${step * STEP_DEG}deg)`
      cx.drawImage(img, 0, 0)
      cx.filter = 'none'
      cache.set(id, c)
      return c
    },
  }
}
