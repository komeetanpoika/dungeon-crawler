// Weather painting (docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md).
// Two passes through one quarter-resolution layer: the night wash (multiply,
// with holes punched around fires, drawn before flames so they stay bright)
// and the pier fog (drifting blobs masked to the water cells, drawn after
// flames and over everything on the water). Phases come from look.t — the
// surface animation timer — never the wall clock.

const LAYER_SCALE = 0.25
const BLOB_COUNT = 16
const BLOB_ALPHA = 0.55
const DRIFT_TILES = 0.8      // sine drift amplitude
const FOG_ALPHA = 0.85       // × look.fog
const GLOW_ALPHA = 0.22
const GLOW_RADIUS = 0.6      // × the light's hole radius
const FOG_FLOOR = 0.02

// Two offscreen canvases: `canvas` receives the paint, `mask` the blurred
// cell weights that clip the fog. `createCanvas` is injected so the renderer
// can pass document.createElement and tests a stub.
export function makeWeatherLayer(createCanvas) {
  const canvas = createCanvas(), mask = createCanvas()
  const layer = {
    canvas, ctx: canvas.getContext('2d'), mask, maskCtx: mask.getContext('2d'),
    w: 0, h: 0, k: LAYER_SCALE,
    resize(viewW, viewH) {
      layer.w = Math.ceil(viewW * LAYER_SCALE)
      layer.h = Math.ceil(viewH * LAYER_SCALE)
      canvas.width = mask.width = layer.w
      canvas.height = mask.height = layer.h
    },
  }
  return layer
}

// Reset a layer context to a known state before a pass.
function prep(L, w, h) {
  L.setTransform(1, 0, 0, 1, 0, 0)
  L.globalCompositeOperation = 'source-over'
  L.globalAlpha = 1
  L.filter = 'none'
  L.clearRect(0, 0, w, h)
}

function radial(L, x, y, r, inner, outer) {
  const g = L.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  return g
}

const onLayer = (x, y, r, layer) => x + r >= 0 && y + r >= 0 && x - r <= layer.w && y - r <= layer.h

// Blit the layer over the frame with smoothing on, restoring the nearest-
// neighbour state the rest of the renderer relies on.
function blit(ctx, layer, gco, alpha, W, H) {
  ctx.save()
  ctx.globalCompositeOperation = gco
  ctx.globalAlpha = alpha
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(layer.canvas, 0, 0, layer.w, layer.h, 0, 0, W, H)
  ctx.imageSmoothingEnabled = false   // explicit, not just via restore: the rest of the frame is nearest-neighbour
  ctx.restore()
}

export function drawNight(ctx, layer, look, { camX, camY }, { W, H }, S) {
  if (!(look.dark > 0)) return
  const L = layer.ctx, k = layer.k
  prep(L, layer.w, layer.h)
  const [r, g, b] = look.ambient
  L.fillStyle = `rgb(${r},${g},${b})`
  L.fillRect(0, 0, layer.w, layer.h)
  L.globalCompositeOperation = 'destination-out'
  const visible = []
  for (const l of look.lights) {
    const x = (l.px - camX) * k, y = (l.py - camY) * k, rad = l.r * S * k
    if (!onLayer(x, y, rad, layer)) continue
    visible.push(l)
    L.fillStyle = radial(L, x, y, rad, `rgba(0,0,0,${l.strength})`, 'rgba(0,0,0,0)')
    L.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }
  L.globalCompositeOperation = 'source-over'
  blit(ctx, layer, 'multiply', look.dark, W, H)

  if (!visible.length) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const l of visible) {
    const x = l.px - camX, y = l.py - camY, rad = l.r * S * GLOW_RADIUS
    const flick = 1 + 0.08 * Math.sin(look.t * 9 + l.px)
    const a = GLOW_ALPHA * l.strength * look.dark * flick
    const c = l.grey ? '170,190,220' : '255,160,60'
    ctx.fillStyle = radial(ctx, x, y, rad, `rgba(${c},${a})`, `rgba(${c},0)`)
    ctx.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }
  ctx.restore()
}

// Deterministic 0..1 from an integer — enough to scatter blobs repeatably.
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const blobCache = new WeakMap()

// Sixteen blobs scattered inside the fog radius (tile units, cell centres),
// each with its own size and two slow sine drift terms. Memoised per fog.
export function fogBlobs(fog) {
  let blobs = blobCache.get(fog)
  if (blobs) return blobs
  blobs = []
  for (let i = 0; i < BLOB_COUNT; i++) {
    const ang = hash(i * 7 + 1) * Math.PI * 2
    const dist = Math.sqrt(hash(i * 7 + 2)) * fog.radius * 0.85
    blobs.push({
      x: fog.cx + 0.5 + Math.cos(ang) * dist,
      y: fog.cy + 0.5 + Math.sin(ang) * dist,
      r: 1.5 + hash(i * 7 + 3) * 1.5,
      a: 0.25 + hash(i * 7 + 4) * 0.2,
      b: 0.2 + hash(i * 7 + 5) * 0.2,
      p1: hash(i * 7 + 6) * Math.PI * 2,
      p2: hash(i * 7 + 7) * Math.PI * 2,
    })
  }
  blobCache.set(fog, blobs)
  return blobs
}

export function drawFog(ctx, layer, look, fog, { camX, camY }, { W, H }, S) {
  if (!fog || !(look.fog >= FOG_FLOOR)) return
  const c0 = Math.floor(camX / S), c1 = Math.ceil((camX + W) / S)
  const r0 = Math.floor(camY / S), r1 = Math.ceil((camY + H) / S)
  const cells = fog.cells.filter(c => c.x >= c0 && c.x < c1 && c.y >= r0 && c.y < r1)
  if (!cells.length) return
  const L = layer.ctx, M = layer.maskCtx, k = layer.k

  prep(L, layer.w, layer.h)
  for (const b of fogBlobs(fog)) {
    const wx = (b.x + Math.sin(look.t * b.a + b.p1) * DRIFT_TILES) * S
    const wy = (b.y + Math.cos(look.t * b.b + b.p2) * DRIFT_TILES) * S
    const x = (wx - camX) * k, y = (wy - camY) * k, rad = b.r * S * k
    if (!onLayer(x, y, rad, layer)) continue
    L.fillStyle = radial(L, x, y, rad, `rgba(255,255,255,${BLOB_ALPHA})`, 'rgba(255,255,255,0)')
    L.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }

  prep(M, layer.w, layer.h)
  M.filter = 'blur(2px)'
  for (const c of cells) {
    M.fillStyle = `rgba(0,0,0,${c.w})`
    M.fillRect((c.x * S - camX) * k, (c.y * S - camY) * k, S * k, S * k)
  }
  M.filter = 'none'

  L.globalCompositeOperation = 'destination-in'
  L.drawImage(layer.mask, 0, 0)
  L.globalCompositeOperation = 'source-over'

  blit(ctx, layer, 'source-over', FOG_ALPHA * look.fog, W, H)
}
