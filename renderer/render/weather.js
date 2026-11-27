// Weather painting (docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md).
// Passes through one quarter-resolution layer: a sandstorm's haze (drawn
// before the night, which darkens it), the day's heat shimmer at the screen's
// edges (straight onto the frame, no layer), the night wash (multiply,
// with holes punched around fires, drawn before flames so they stay bright)
// and the pier fog (drifting blobs masked to the water cells, drawn after
// flames and over everything on the water). Phases come from look.t — the
// surface animation timer — never the wall clock.

const LAYER_SCALE = 0.25   // quarter logical resolution — an eighth of device pixels at 2x DPR; softer punched holes on HiDPI are accepted
const BLOB_COUNT = 16
const BLOB_ALPHA = 0.55
const DRIFT_TILES = 0.8      // sine drift amplitude
const FOG_ALPHA = 0.85       // × look.fog
const GLOW_ALPHA = 0.22
const GLOW_RADIUS = 0.6      // × the light's hole radius
const FOG_FLOOR = 0.02
const NIGHT_CELL = 32        // CSS px: the grid the night layer is blitted on, where a light reaches
const NIGHT_MARGIN = 2 / LAYER_SCALE   // CSS px past a hole that the smoothed blit still reads it
// CSS px the kept night mask reaches past the view on every side; the view may
// wander this far either way inside it, so wilds/city/fx.js lists the city's
// lights twice this far off screen (LIGHT_SLACK) and none comes or goes in it
export const NIGHT_PAD = 160
const NIGHT_REBUILD_GAP = 6  // frames at least between two builds of the kept mask ...
const NIGHT_GAP_MAX = 64     // ... doubled up to this while each build is undone at once
const STRENGTH_STEPS = 32    // a light's strength as the kept mask is keyed and punched

// Two offscreen canvases: `canvas` receives the paint, `mask` the blurred
// cell weights that clip the fog. `createCanvas` is injected so the renderer
// can pass document.createElement and tests a stub.
export function makeWeatherLayer(createCanvas) {
  const canvas = createCanvas(), mask = createCanvas()
  const layer = {
    canvas, ctx: canvas.getContext('2d'), mask, maskCtx: mask.getContext('2d'),
    w: 0, h: 0, k: LAYER_SCALE, createCanvas, night: null,
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

// Where the night layer must be blitted: the cells of a grid over the view
// that a light's hole (plus the smoothed blit's reach) touches, as bands of
// rows that share one pattern, each with its lit runs of columns:
//   [{ y0, y1, runs: [[x0, x1], ...] }]   CSS px, top to bottom, covering 0..H
// Everywhere else the layer holds the flat ambient colour, so a multiply fill
// there looks the same and costs far less than the smoothed upscale (on a
// software canvas the full-screen blit was most of a night frame's cost).
// The grid is cut on whole device pixels (`dpr`), so a fill and a blit that
// meet share no half-covered pixel. `holes`: [{ x, y, r }] in CSS px.
export function nightBands(holes, W, H, dpr = 1) {
  const cellDev = Math.max(1, Math.round(NIGHT_CELL * dpr)), cell = cellDev / dpr
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell)
  const at = (n, max) => Math.min(max, n * cell)
  const lit = new Uint8Array(cols * rows)
  for (const h of holes) {
    const R = h.r + NIGHT_MARGIN
    const r0 = Math.max(0, Math.floor((h.y - R) / cell)), r1 = Math.min(rows - 1, Math.floor((h.y + R) / cell))
    for (let row = r0; row <= r1; row++) {
      const top = row * cell, bot = top + cell
      const dy = h.y < top ? top - h.y : h.y > bot ? h.y - bot : 0
      if (dy > R) continue
      const half = Math.sqrt(R * R - dy * dy)
      const c0 = Math.max(0, Math.floor((h.x - half) / cell)), c1 = Math.min(cols - 1, Math.floor((h.x + half) / cell))
      for (let c = c0; c <= c1; c++) lit[row * cols + c] = 1
    }
  }
  const bands = []
  let prev = null
  for (let row = 0; row < rows; row++) {
    const runs = []
    let key = ''
    for (let c = 0; c < cols; c++) {
      if (!lit[row * cols + c]) continue
      const c0 = c
      while (c + 1 < cols && lit[row * cols + c + 1]) c++
      runs.push([at(c0, W), at(c + 1, W)])
      key += c0 + '-' + c + ','
    }
    if (prev && prev.key === key) { prev.band.y1 = at(row + 1, H); continue }
    const band = { y0: at(row, H), y1: at(row + 1, H), runs }
    bands.push(band)
    prev = { key, band }
  }
  return bands
}

// The lights a kept mask over the window-px rect (x0, y0, w, h) holds, as a
// key: what it must be built anew for when it changes.
function nightKey(lights, x0, y0, w, h, S, ambient) {
  let key = ambient
  for (const l of lights) {
    const rad = l.r * S
    if (l.px + rad < x0 || l.py + rad < y0 || l.px - rad > x0 + w || l.py - rad > y0 + h) continue
    key += `|${l.px},${l.py},${l.r},${Math.round(l.strength * STRENGTH_STEPS)}`
  }
  return key
}

// The kept night mask: the night layer, quarter resolution as ever, for the
// view plus NIGHT_PAD each way, scaled up (smoothed) once into a canvas of
// CSS px anchored in window px. The lights of the night stand still in the
// world (lamps, lit windows, a campfire), so while none comes, goes or
// changes, and the colour holds, every frame is one plain 1:1 multiply blit
// of it at the camera's offset. That smoothed scale-up was most of a lit
// night frame's cost on a software canvas (3 ms of a 1024 x 693 frame, about
// 2 ms more than a 1:1 blit). Built at most every NIGHT_REBUILD_GAP frames,
// and less often while each build is undone within a few frames by a light
// that changes every frame (a fire burning down): between builds the layer is
// drawn straight onto the frame, as before.
function buildNightMask(N, createCanvas, lights, ambient, camX, camY, W, H, S) {
  const k = LAYER_SCALE
  // a whole number of layer pixels, so the scale-up is exactly 1/k
  const w = Math.ceil((W + 2 * NIGHT_PAD) * k) / k, h = Math.ceil((H + 2 * NIGHT_PAD) * k) / k
  const x0 = Math.floor(camX) - NIGHT_PAD, y0 = Math.floor(camY) - NIGHT_PAD
  N.q ??= createCanvas(); N.full ??= createCanvas()
  if (N.q.width !== w * k || N.q.height !== h * k) { N.q.width = w * k; N.q.height = h * k }
  if (N.full.width !== w || N.full.height !== h) { N.full.width = w; N.full.height = h }
  const Q = N.q.getContext('2d'), F = N.full.getContext('2d')
  prep(Q, w * k, h * k)
  Q.fillStyle = ambient
  Q.fillRect(0, 0, w * k, h * k)
  Q.globalCompositeOperation = 'destination-out'
  for (const l of lights) {
    const x = (l.px - x0) * k, y = (l.py - y0) * k, rad = l.r * S * k
    if (x + rad < 0 || y + rad < 0 || x - rad > w * k || y - rad > h * k) continue
    const a = Math.round(l.strength * STRENGTH_STEPS) / STRENGTH_STEPS
    Q.fillStyle = radial(Q, x, y, rad, `rgba(0,0,0,${a})`, 'rgba(0,0,0,0)')
    Q.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }
  Q.globalCompositeOperation = 'source-over'
  prep(F, w, h)
  F.imageSmoothingEnabled = true
  F.drawImage(N.q, 0, 0, w * k, h * k, 0, 0, w, h)
  N.x0 = x0; N.y0 = y0; N.w = w; N.h = h
  N.key = nightKey(lights, x0, y0, w, h, S, ambient)
  N.since = 0; N.uses = 0; N.stale = false
  N.builds = (N.builds ?? 0) + 1
}

export function drawNight(ctx, layer, look, { camX, camY }, { W, H }, S) {
  if (!(look.dark > 0)) return
  const k = layer.k
  const [r, g, b] = look.ambient
  const ambient = `rgb(${r},${g},${b})`
  const visible = []
  for (const l of look.lights) {
    if (onLayer((l.px - camX) * k, (l.py - camY) * k, l.r * S * k, layer)) visible.push(l)
  }
  // No light in view (the usual case): the layer would hold one flat
  // colour, so the scaled blit is exactly a multiply fill of the frame —
  // and the fill skips the layer clear, fill and smoothed upscale, which
  // together cost a good share of a software-rendered frame.
  if (!visible.length) {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = look.dark
    ctx.fillStyle = ambient
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
    return
  }
  const N = layer.night ??= { since: Infinity, key: null, gap: NIGHT_REBUILD_GAP }
  N.since++
  const inside = N.key !== null && camX >= N.x0 && camY >= N.y0 && camX + W <= N.x0 + N.w && camY + H <= N.y0 + N.h
  const kept = inside && nightKey(look.lights, N.x0, N.y0, N.w, N.h, S, ambient) === N.key
  if (kept) N.uses++
  else if (N.key !== null && !N.stale) {
    // undone: by its lights within a few frames of the build (wait longer next time), or by use
    N.stale = true
    N.gap = inside && N.uses < 3 ? Math.min(NIGHT_GAP_MAX, N.gap * 2) : NIGHT_REBUILD_GAP
  }
  if (!kept && N.since >= N.gap && layer.createCanvas) buildNightMask(N, layer.createCanvas, look.lights, ambient, camX, camY, W, H, S)
  if (kept || N.since === 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = look.dark
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(N.full, N.x0 - camX, N.y0 - camY)
    ctx.restore()
  } else {
    // counted, as the builds are, for the tests and tools/city/perf.mjs
    N.straight = (N.straight ?? 0) + 1
    drawLayer(ctx, layer, look, visible, ambient, camX, camY, W, H, S)
  }
  drawGlows(ctx, look, visible, camX, camY, S)
}

// The night layer drawn straight onto the frame, for this frame only: the
// layer where a light reaches (nightBands), the flat colour everywhere else.
function drawLayer(ctx, layer, look, visible, ambient, camX, camY, W, H, S) {
  const k = layer.k
  const L = layer.ctx
  prep(L, layer.w, layer.h)
  L.fillStyle = ambient
  L.fillRect(0, 0, layer.w, layer.h)
  L.globalCompositeOperation = 'destination-out'
  for (const l of visible) {
    const x = (l.px - camX) * k, y = (l.py - camY) * k, rad = l.r * S * k
    L.fillStyle = radial(L, x, y, rad, `rgba(0,0,0,${l.strength})`, 'rgba(0,0,0,0)')
    L.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }
  L.globalCompositeOperation = 'source-over'
  // the layer where a light reaches, the flat colour everywhere else
  const holes = visible.map(l => ({ x: l.px - camX, y: l.py - camY, r: l.r * S }))
  const dpr = ctx.getTransform?.()?.a || 1
  const sx = layer.w / W, sy = layer.h / H
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = look.dark
  ctx.fillStyle = ambient
  ctx.imageSmoothingEnabled = true
  for (const { y0, y1, runs } of nightBands(holes, W, H, dpr)) {
    let x = 0
    for (const [x0, x1] of runs) {
      if (x0 > x) ctx.fillRect(x, y0, x0 - x, y1 - y0)
      ctx.drawImage(layer.canvas, x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy, x0, y0, x1 - x0, y1 - y0)
      x = x1
    }
    if (x < W) ctx.fillRect(x, y0, W - x, y1 - y0)
  }
  ctx.imageSmoothingEnabled = false   // explicit, not just via restore: the rest of the frame is nearest-neighbour
  ctx.restore()
}

// Each light's warm glow over the washed frame.
function drawGlows(ctx, look, visible, camX, camY, S) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const l of visible) {
    // a light may say how far its warm glow reaches (tiles; 0 none): the
    // city's lamps keep theirs small and its windows have none of this one
    const rad = (l.glow ?? l.r * GLOW_RADIUS) * S
    if (!(rad > 0)) continue
    const x = l.px - camX, y = l.py - camY
    const flick = 1 + 0.08 * Math.sin(look.t * 9 + l.px)
    const a = GLOW_ALPHA * l.strength * look.dark * flick
    const c = l.grey ? '110,170,255' : '255,160,60'   // deadwood burns blue
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

export function drawFog(ctx, layer, look, fog, { camX, camY }, { W, H }, S, map = null) {
  if (!fog || !(look.fog >= FOG_FLOOR)) return
  // One-cell margin: a cell just outside the view still bleeds a blurred
  // edge in, so keep it in the mask rather than clip exactly to view.
  const c0 = Math.floor(camX / S) - 1, c1 = Math.ceil((camX + W) / S) + 1
  const r0 = Math.floor(camY / S) - 1, r1 = Math.ceil((camY + H) / S) + 1
  const shown = c => c.x >= c0 && c.x < c1 && c.y >= r0 && c.y < r1 &&
    !(map && !map[c.y]?.[c.x]?.explored)

  // Count first and bail before any op — cells is walked in place below,
  // no fresh array allocated per frame.
  let any = false
  for (const c of fog.cells) { if (shown(c)) { any = true; break } }
  if (!any) return

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

  // Mask: sum the (unblurred) per-cell weights additively, then blur the
  // mask once as a whole. Blur is linear, so blur(sum of rects) equals
  // blur(their union) — one filtered op instead of one per cell, and no
  // lattice from compositing individually-blurred rects edge to edge.
  prep(M, layer.w, layer.h)
  M.globalCompositeOperation = 'lighter'
  for (const c of fog.cells) {
    if (!shown(c)) continue
    M.fillStyle = `rgba(0,0,0,${c.w})`
    M.fillRect((c.x * S - camX) * k, (c.y * S - camY) * k, S * k, S * k)
  }
  M.globalCompositeOperation = 'source-over'

  L.globalCompositeOperation = 'destination-in'
  L.filter = 'blur(2px)'
  L.drawImage(layer.mask, 0, 0)
  L.filter = 'none'
  L.globalCompositeOperation = 'source-over'

  blit(ctx, layer, 'source-over', FOG_ALPHA * look.fog, W, H)
}

// ---- the sandstorm's haze -------------------------------------------------------------
// (wilds/storm.js; look.storm from systems/weather.js.) Built in the layer:
// the sand's colour all over; over it, clouds of dust rolling and streaks of
// blown sand, each a tile repeated across the layer, blown along the wind at
// its own speed and pinned to the world (they do not ride along with the
// camera); and a soft round patch of clear sand round the hero, thinly
// hazed at his feet and fading into haze that is whole by `whole` tiles
// inside his storm sight: the cells he sees reach a tile past that sight
// (wilds/storm.js LIT_PAD), so their stepped edge and the fog of the cells
// past it lie under whole haze, so no stepped outline or dark ring shows. Then
// onto the frame, thickening fast as the storm rises (so a storm coming in
// reads as sand, not as a grey murk over the land out of sight) and whole at
// full strength.
//
// Kept cheap for a software canvas, where every full-screen pass costs:
// - each tile is drawn already turned to the storm's wind (one wind for the
//   whole storm, wilds/storm.js stormWind, so the tiles are made once a
//   storm), so a pass is a plain repeat of it from a whole-pixel offset, with
//   no resampling, and its drift along that wind never jumps;
// - the layer is smoothed up to half the frame's size and that is doubled
//   onto the frame without smoothing, a pixel of it the size of a pixel of
//   the art: the smoothed scale-up of the whole frame cost about a
//   millisecond more on this machine, and in the web build with the CPU
//   throttled 4x it took a storm frame under 30 fps.
//
// `far`/`near`: the haze's alpha past the patch and at the hero's feet at
// full strength; `whole`: tiles inside the sight radius where the haze is
// whole; `inner`: the share of that radius kept clear before it thickens
// (smoothly, HAZE_EASE); a pass's `size` is its tile's side in layer px,
// `scale` how big its marks are, and `speed` its drift in tiles a second. A
// size divides 80 tiles in layer px (640), so a re-centre of the window
// moves no tile. The clouds are lighter and darker than the sand
// (`light`/`dark`); the streaks of blown sand only a little (`sandLight`/
// `sandDark`), so they read as sand and not as rain.
export const HAZE = {
  far: 1, near: 0.16, whole: 0.5, inner: 0.4,
  colour: [212, 174, 112], light: [248, 228, 184], dark: [150, 110, 64],
  sandLight: [232, 200, 146], sandDark: [178, 138, 84],
  passes: [
    { tile: 'clouds', size: 320, scale: 5, speed: 3.5, alpha: 1 },
    { tile: 'streaks', size: 320, scale: 1, speed: 14, alpha: 1 },
  ],
}
// How much of the clearing is left (1 clear .. 0 whole haze) along the way
// from `inner` to the whole haze: a smoothstep, at five points.
const HAZE_EASE = [0, 0.25, 0.5, 0.75, 1].map(t => [t, 1 - t * t * (3 - 2 * t)])
const TILES_KEPT = 4             // tiles kept: a storm's two, and the last storm's
const mod = (a, n) => ((a % n) + n) % n
const GUSTS = 6                  // bands of blown sand in the streaks' tile

// A tile of the haze turned to `wind`: `clouds`, soft lighter and darker
// blots of dust stretched along the wind; `streaks`, long soft wisps of
// blown sand along it, a little lighter or darker than the haze, gathered in
// a few bands of gusts of uneven strength. Every mark is drawn at each of its
// wrapped places, so the tile repeats without a seam whatever the wind.
function hazeTile(createCanvas, pass, wind) {
  const T = pass.size, s = pass.scale, c = createCanvas()
  c.width = T; c.height = T
  const g = c.getContext('2d')
  let n = pass.tile === 'clouds' ? 4127 : 9781
  const rnd = () => { n = (n * 16807) % 2147483647; return n / 2147483647 }
  const rgba = (rgb, a) => `rgba(${rgb.join(',')},${a.toFixed(2)})`
  const mark = (x, y, reach, draw) => {
    for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) {
      const px = x + ox, py = y + oy
      if (px + reach < 0 || px - reach > T || py + reach < 0 || py - reach > T) continue
      g.save(); g.translate(px, py); g.rotate(wind); draw(); g.restore()
    }
  }
  const count = m => Math.round(m * (T / s / 64) ** 2)   // as many to an area at any size
  if (pass.tile === 'clouds') {
    for (let i = 0; i < count(18); i++) {
      const x = rnd() * T, y = rnd() * T, r = (6 + rnd() * 16) * s, a = 0.18 + rnd() * 0.3
      const rgb = rnd() < 0.55 ? HAZE.light : HAZE.dark
      mark(x, y, 2 * r, () => {
        g.scale(2, 1)
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r)
        grad.addColorStop(0, rgba(rgb, a))
        grad.addColorStop(1, rgba(rgb, 0))
        g.fillStyle = grad
        g.fillRect(-r, -r, 2 * r, 2 * r)
      })
    }
    return c
  }
  // the gusts: GUSTS bands along the wind (across it at `v`), each with its
  // own number of wisps and its own lean to lighter or darker sand
  const cos = Math.cos(wind), sin = Math.sin(wind)
  for (let b = 0; b < GUSTS; b++) {
    const v = rnd() * T, wisps = Math.round(3 + rnd() * rnd() * 14), lean = rnd()
    for (let i = 0; i < wisps; i++) {
      const u = rnd() * T, across = v + (rnd() + rnd() - 1) * 10 * s
      const x = mod(T / 2 + (u - T / 2) * cos - (across - T / 2) * sin, T)
      const y = mod(T / 2 + (u - T / 2) * sin + (across - T / 2) * cos, T)
      const l = (40 + rnd() * 70) * s, h = (4 + rnd() * 6) * s, a = 0.16 + rnd() * 0.2
      const rgb = rnd() < lean ? HAZE.sandLight : HAZE.sandDark
      mark(x, y, l / 2, () => {
        g.scale(l / 2, h / 2)
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1)
        grad.addColorStop(0, rgba(rgb, a))
        grad.addColorStop(1, rgba(rgb, 0))
        g.fillStyle = grad
        g.fillRect(-1, -1, 2, 2)
      })
    }
  }
  return c
}

// The pattern of a pass's tile at the storm's wind, made once and kept.
function hazePattern(layer, pass, wind) {
  if (!layer.createCanvas) return null
  const kept = layer.haze ??= new Map()
  const key = `${pass.tile}:${pass.size}:${wind}`
  if (!kept.has(key)) {
    kept.set(key, layer.ctx.createPattern?.(hazeTile(layer.createCanvas, pass, wind), 'repeat') ?? null)
    if (kept.size > TILES_KEPT) kept.delete(kept.keys().next().value)
  }
  return kept.get(key)
}

export function drawHaze(ctx, layer, look, { camX, camY }, { W, H }, S) {
  const st = look.storm
  if (!st || !(st.s > 0)) return
  const L = layer.ctx, k = layer.k
  prep(L, layer.w, layer.h)
  L.imageSmoothingEnabled = false
  L.fillStyle = `rgb(${HAZE.colour.join(',')})`
  L.fillRect(0, 0, layer.w, layer.h)
  // each pass's tile repeated from a whole-pixel offset: pinned to the world
  // (the view's corner is at camX, camY) and blown downwind with time
  const cos = Math.cos(st.wind), sin = Math.sin(st.wind)
  for (const p of HAZE.passes) {
    const pat = hazePattern(layer, p, st.wind)
    if (!pat) continue
    const d = look.t * p.speed * S * k
    const ox = Math.round(mod(d * cos - camX * k, p.size)), oy = Math.round(mod(d * sin - camY * k, p.size))
    L.save()
    L.globalAlpha = p.alpha
    L.translate(ox, oy)
    L.fillStyle = pat
    L.fillRect(-ox, -oy, layer.w, layer.h)
    L.restore()
  }
  L.imageSmoothingEnabled = true   // the layer's default, for the passes after this one
  // the clear patch round the hero: clear (but for the thin haze at his
  // feet) out to `inner` of the radius where the haze is whole, then eased in
  const x = (st.px - camX) * k, y = (st.py - camY) * k
  const r1 = Math.max(1, st.r - HAZE.whole) * S * k
  const clear = 1 - HAZE.near / HAZE.far
  const g = L.createRadialGradient(x, y, 0, x, y, r1)
  g.addColorStop(0, `rgba(0,0,0,${clear.toFixed(3)})`)
  for (const [at, left] of HAZE_EASE) g.addColorStop(HAZE.inner + (1 - HAZE.inner) * at, `rgba(0,0,0,${(clear * left).toFixed(3)})`)
  L.globalCompositeOperation = 'destination-out'
  L.fillStyle = g
  L.fillRect(x - r1, y - r1, 2 * r1, 2 * r1)
  L.globalCompositeOperation = 'source-over'
  // smoothed up to half the frame, then doubled onto it (see above)
  const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2)
  const half = layer.half ??= layer.createCanvas?.()
  if (!half) { blit(ctx, layer, 'source-over', hazeAlpha(st.s), W, H); return }
  if (half.width !== hw || half.height !== hh) { half.width = hw; half.height = hh }
  const hc = half.getContext('2d')
  hc.clearRect(0, 0, hw, hh)
  hc.imageSmoothingEnabled = true
  hc.drawImage(layer.canvas, 0, 0, layer.w, layer.h, 0, 0, hw, hh)
  ctx.save()
  ctx.globalAlpha = hazeAlpha(st.s)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(half, 0, 0, hw, hh, 0, 0, 2 * hw, 2 * hh)
  ctx.restore()
}
// The haze's alpha past the clear patch at strength s: rising fast, eased out.
export const hazeAlpha = s => HAZE.far * (1 - (1 - s) * (1 - s))

// ---- the day's heat ---------------------------------------------------------------
// (wilds/heat.js; look.heat from systems/weather.js, 0..1, coming and going
// with the heat over a second.) A faint shimmer at the top and bottom of the
// screen while the sun beats on open sand: along each of those two edges a
// soft warm band, deepest at the edge and gone `depth` of the screen's height
// in, whose inner reach wavers along the edge and with time like air over hot
// ground, and whose strength swells and fades a little. It is multiplied on,
// so it warms the sun-baked sand and leaves the dark of the land out of sight
// dark (a pale band laid over that dark read as a glow on the fog). A hint,
// not an effect. Top and bottom only, at every window size: on a wide screen
// the sides lie beyond the hero's sight in the desert and would show nothing,
// while the top and bottom lie inside it; and the sides were half the cost.
//
// Kept cheap for a software canvas: drawn straight onto the frame, with no
// layer and no blit; two filled paths, one along each of those edges, under
// one fill made once and kept. The fill runs across a unit band and the
// transform lays that band along its edge at its depth, so it fades out at
// the band's full reach on both edges and every frame. The fill is a strip
// of BAND_PX pixels painted once with the profile and repeated as a pattern:
// sampled like an image, it cost about 0.6 of shading a gradient over the
// same paths on this machine (a gradient where the layer cannot make a canvas).
//
// `alpha`: at the edge at full heat; `profile`: the band's strength across
// it, [share of the depth, share of alpha]; `waver`: how much of the band its
// inner edge wavers in and out (where it comes in furthest the profile is
// still a third of the way up, so the wavering shows as a soft rim); `step`:
// CSS px between that edge's points; `waves`: the ripples running along it,
// [wavelength px, speed rad/s, weight];
// `breath`: how much the strength swells and fades, at `breathRate` rad/s.
export const SHIMMER = {
  alpha: 0.35, depth: 0.07, waver: 0.4, step: 32, colour: [255, 196, 120],
  profile: [[0, 1], [0.4, 0.5], [0.75, 0.2], [1, 0]],
  waves: [[420, 1.1, 0.6], [150, -2.3, 0.4]], breath: 0.2, breathRate: 1.7,
}
// Each edge's unit band (u along the edge in CSS px, v across it from the
// edge, 0..1) laid onto the frame, [a, b, c, d, e, f] for ctx.transform with
// the band's depth D, and the edge's length: the top, then the bottom.
const EDGES = (D, W, H) => [[1, 0, 0, D, 0, 0, W], [1, 0, 0, -D, 0, H, W]]

// How far in the band reaches at `u` along edge `k` at time t: from 1 - waver to 1.
function reach(u, t, k) {
  let w = 0
  SHIMMER.waves.forEach(([len, speed, weight], j) => { w += weight * Math.sin(2 * Math.PI * u / len + speed * t + (k + 1) * (j + 1.3) * 1.7) })
  return 1 - SHIMMER.waver * (0.5 + 0.5 * w)
}

// The profile as a gradient from 0 to `len` along y.
function profileGradient(ctx, len) {
  const g = ctx.createLinearGradient(0, 0, 0, len)
  const c = SHIMMER.colour.join(',')
  for (const [at, a] of SHIMMER.profile) g.addColorStop(at, `rgba(${c},${a})`)
  return g
}
// The band's fill, made once per context and kept on the layer: the strip as
// a pattern scaled to the unit band, or the gradient itself.
const BAND_PX = 64
function bandFill(ctx, layer) {
  if (layer.heatBand?.ctx === ctx) return layer.heatBand.fill
  let fill = null
  const strip = typeof DOMMatrix === 'function' ? layer.createCanvas?.() : null
  if (strip) {
    strip.width = 1; strip.height = BAND_PX
    const g = strip.getContext('2d')
    g.fillStyle = profileGradient(g, BAND_PX)
    g.fillRect(0, 0, 1, BAND_PX)
    fill = ctx.createPattern?.(strip, 'repeat') ?? null
    if (fill?.setTransform) fill.setTransform(new DOMMatrix([1, 0, 0, 1 / BAND_PX, 0, 0]))
    else fill = null
  }
  layer.heatBand = { ctx, fill: fill ?? profileGradient(ctx, 1) }
  return layer.heatBand.fill
}

export function drawHeat(ctx, layer, look, { W, H }) {
  const s = look.heat
  if (!(s > 0)) return
  const fill = bandFill(ctx, layer)
  const t = look.t ?? 0, D = SHIMMER.depth * H
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = SHIMMER.alpha * s * (1 - SHIMMER.breath * (0.5 + 0.5 * Math.sin(t * SHIMMER.breathRate)))
  ctx.fillStyle = fill
  EDGES(D, W, H).forEach(([a, b, c, d, e, f, L], k) => {
    ctx.save()
    ctx.transform(a, b, c, d, e, f)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    const n = Math.max(1, Math.ceil(L / SHIMMER.step))
    for (let i = 0; i <= n; i++) { const u = (L * i) / n; ctx.lineTo(u, reach(u, t, k)) }
    ctx.lineTo(L, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })
  ctx.restore()
}
