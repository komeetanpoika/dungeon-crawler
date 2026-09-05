// Turn the mountain-pass concept sheet (assets/mountainpass2.png — an opaque
// RGB mockup on a near-black backdrop: three rows of ridge/cluster pieces,
// three rows of peak cones and rock scatters, one row of floor tiles, then
// example strips) into the game's 16x16 overworld tiles under
// renderer/assets/tiles/ with an ow_mtn_ prefix. The sheet is drawn at ~73 px
// per cell and is not true pixel art (single-pixel noise, no block grid), so
// every cell is tight-cropped, inset past its drawn frame and area-averaged
// down to 16x16 rather than sampled.
//
// What comes out (see tools/static-overworld/mountain.mjs for how it is laid):
//   ow_mtn_ground_N / shade_N             opaque floor, and the same floor with
//                                          a shadow gradient down from its top
//                                          edge (the ground just south of a mass)
//   ow_mtn_lat_M_Q                         the mass itself: one cell of a global
//                                          jittered half-offset cone lattice
//                                          (period 64x48 game px, Q = cell
//                                          position 0..11 = x%4 + 4*(y%3)), with
//                                          the sides named by the 4-bit mask M
//                                          (1 N, 2 E, 4 S, 8 W) open: no cone
//                                          crosses an open side and everything
//                                          beyond the cone silhouette on that
//                                          side is transparent, so the ground
//                                          shows between the tips
//   ow_mtn_ridge_{dr|dl|lb|br|v}_N         keyed (transparent backdrop) ridge
//                                          lines for one-cell-thick walls:
//                                          "/" (dr), "\" (dl), hooks, steep
//   ow_mtn_rock_N                          keyed rock scatters (boulders)
// (the sheet's standalone peak clusters, V-dip tips and single cones are only
// used as lattice sources: spur tips and islands are lattice cells too)
// Nothing is mirrored: the art is lit from the top-left, and a flipped copy
// is lit from the wrong side. The one exception is `br`, the mirror of the
// only hook the sheet has (lb), because a corner needs both hands.
// Usage: node tools/extract-mountain-tiles.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '../assets/mountainpass2.png')
const OUT_DIR = path.join(HERE, '../renderer/assets/tiles')
const T = 16
const BG = [21, 24, 29]      // sheet backdrop between cells
const BG_TOL = 40            // |dr|+|dg|+|db| below this is sheet backdrop
const MIN_CELL = 40          // a run of art shorter than this is a label, not a cell
const INSET = 2              // source px shaved off every cell side: the drawn frame + bevel
const KEY_TOL = 26           // |dr|+|dg|+|db| to the cell's own backdrop that keys out
const COLS = 15

// Cell index = row * 15 + column over the six tile rows: ridge rows 0-2,
// cone rows 3-5 (the last seven of row 5 are rock scatters); row 6 is floor.
// Classified by hand (loop-1 audit): what each ridge line actually does.
export const RIDGE = {
  dr: [0, 1, 4, 6, 7, 9, 17, 18, 20, 23, 25, 27, 34],    // "/" bottom-left to top-right (20, 23 bowed)
  dl: [3, 5, 8, 10, 11, 15, 16, 19, 21, 22, 24, 26, 35], // "\" top-left to bottom-right
  lb: [2, 12],                                           // hook leaving left and bottom
  v: [33],                                               // steep, bottom to top
}
export const TIP = [31, 36, 37]                          // V dips: a spur tip pointing south
export const CLUSTER = [13, 14, 28, 29, 30, 32, 38, 39, 40, 41, 42, 43, 44]
export const CONE = [...Array.from({ length: 30 }, (_, i) => 45 + i), 75, 76, 77, 78, 79, 80, 81, 82]
export const ROCK = [84, 85, 86, 87, 88, 89]             // 83 is a dark hollow, not a scatter
const FLOOR_ROW = 6
const SHADE_TOP = 0.7, SHADE_RAMP = 0.8   // shade tile: rows 0-1 at SHADE_TOP, rows 2-7 ramp SHADE_RAMP -> 1

if (!fs.existsSync(SRC)) { console.log(`mountain sheet not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const at = (x, y) => (y * src.width + x) * 4
const dist = (i, c) => Math.abs(src.pixels[i] - c[0]) + Math.abs(src.pixels[i + 1] - c[1]) + Math.abs(src.pixels[i + 2] - c[2])
const isArt = (x, y) => dist(at(x, y), BG) > BG_TOL

function runs(n, on) {
  const out = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    const v = i < n && on(i)
    if (v && start < 0) start = i
    if (!v && start >= 0) { if (i - start >= MIN_CELL) out.push([start, i - 1]); start = -1 }
  }
  return out
}

// Row bands from a strip down the first column; then per band the column
// runs; then each cell is tightened to its own bounding box and inset.
const rowBands = runs(src.height, y => { for (let x = 30; x < 95; x += 3) if (isArt(x, y)) return true; return false }).slice(0, 7)
function tight(x0, y0, x1, y1) {
  let ax = x1, ay = y1, bx = x0, by = y0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isArt(x, y)) { ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y) }
  // centred square so a narrow cell is not stretched
  const s = Math.min(bx - ax, by - ay) + 1 - 2 * INSET
  const cx = (ax + bx) / 2, cy = (ay + by) / 2
  return { x0: Math.round(cx - s / 2), y0: Math.round(cy - s / 2), x1: Math.round(cx - s / 2) + s - 1, y1: Math.round(cy - s / 2) + s - 1 }
}
const rawRows = rowBands.map(([y0, y1]) =>
  runs(src.width, x => { for (let y = y0; y <= y1; y += 3) if (isArt(x, y)) return true; return false })
    .map(([x0, x1]) => ({ x0, y0, x1, y1 })))
for (let r = 0; r < 6; r++) if (rawRows[r].length !== COLS) throw new Error(`row ${r}: expected ${COLS} cells, found ${rawRows[r].length}`)
const rows = rawRows.map(row => row.map(c => tight(c.x0, c.y0, c.x1, c.y1)))
export const cells = rows.slice(0, 6).flat()
// the cell's full drawn box less its one-pixel frame (art bbox, inset 1)
const frameBox = rawRows.slice(0, 6).flat().map(({ x0, y0, x1, y1 }) => {
  let ax = x1, ay = y1, bx = x0, by = y0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isArt(x, y)) { ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y) }
  return { x0: ax + 1, y0: ay + 1, x1: bx - 1, y1: by - 1 }
})
const floorCells = rows[FLOOR_ROW]

// The cell's own backdrop: the median colour of its border ring.
function cellBackdrop({ x0, y0, x1, y1 }) {
  const ch = [[], [], []]
  for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) for (let c = 0; c < 3; c++) ch[c].push(src.pixels[at(x, y) + c])
  for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) for (let c = 0; c < 3; c++) ch[c].push(src.pixels[at(x, y) + c])
  return ch.map(a => a.sort((p, q) => p - q)[a.length >> 1])
}

// Crop a cell as RGBA; with `key`, flood-fill the backdrop transparent from
// the border so dark pixels inside the art survive.
function crop(box, key) {
  const { x0, y0, x1, y1 } = box
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x0 + x, y0 + y), o = (y * w + x) * 4
    out[o] = src.pixels[i]; out[o + 1] = src.pixels[i + 1]; out[o + 2] = src.pixels[i + 2]; out[o + 3] = 255
  }
  if (key) {
    const bd = cellBackdrop(box)
    const isBd = i => Math.abs(out[i] - bd[0]) + Math.abs(out[i + 1] - bd[1]) + Math.abs(out[i + 2] - bd[2]) < KEY_TOL
    const seen = new Uint8Array(w * h)
    const stack = []
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x)
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1)
    while (stack.length) {
      const p = stack.pop()
      if (seen[p] || !isBd(p * 4)) continue
      seen[p] = 1
      out[p * 4 + 3] = 0
      const x = p % w, y = (p - x) / w
      if (x > 0) stack.push(p - 1)
      if (x < w - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - w)
      if (y < h - 1) stack.push(p + w)
    }
  }
  return { w, h, rgba: out }
}

// Area-average an RGBA frame to WxH with alpha-weighted colour.
function resample(f, W = T, H = T) {
  const out = new Uint8Array(W * H * 4)
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const sx0 = Math.floor(X * f.w / W), sx1 = Math.max(sx0 + 1, Math.floor((X + 1) * f.w / W))
    const sy0 = Math.floor(Y * f.h / H), sy1 = Math.max(sy0 + 1, Math.floor((Y + 1) * f.h / H))
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
      const i = (y * f.w + x) * 4, al = f.rgba[i + 3] / 255
      r += f.rgba[i] * al; g += f.rgba[i + 1] * al; b += f.rgba[i + 2] * al; a += al; n++
    }
    const o = (Y * W + X) * 4
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a) }
    out[o + 3] = Math.round(255 * a / n)
  }
  return { w: W, h: H, rgba: out }
}
const hardenAlpha = f => { for (let i = 3; i < f.rgba.length; i += 4) f.rgba[i] = f.rgba[i] < 96 ? 0 : 255; return f }

const hash = (a, b, c) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return h >>> 0 }
const written = []
const emit = (name, f) => { writePng(path.join(OUT_DIR, `${name}.png`), f.w, f.h, f.rgba); written.push(name) }
// Pad a frame to a square of its longer side with transparent margins, so a
// narrow cell is neither cut nor stretched when it becomes a square tile.
function padSquare(f) {
  const s = Math.max(f.w, f.h)
  if (s === f.w && s === f.h) return f
  const out = new Uint8Array(s * s * 4)
  const ox = (s - f.w) >> 1, oy = (s - f.h) >> 1
  for (let y = 0; y < f.h; y++) out.set(f.rgba.subarray(y * f.w * 4, (y + 1) * f.w * 4), ((oy + y) * s + ox) * 4)
  return { w: s, h: s, rgba: out }
}
// The bounding box of a keyed frame's opaque pixels.
function alphaBox(f) {
  let ax = f.w, ay = f.h, bx = -1, by = -1
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.rgba[(y * f.w + x) * 4 + 3]) { ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y) }
  const w = bx - ax + 1, h = by - ay + 1
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) out.set(f.rgba.subarray(((ay + y) * f.w + ax) * 4, ((ay + y) * f.w + ax + w) * 4), y * w * 4)
  return { w, h, rgba: out }
}
// keyed pieces keep the artist's registration (they are drawn to meet at the
// cell edges), so they use the full cell box inset by one frame pixel,
// padded square rather than squashed
const series = (prefix, idx, key) => idx.forEach((c, i) => emit(`${prefix}_${i}`, hardenAlpha(resample(padSquare(crop(frameBox[c], key))))))
const flipX = f => { const o = new Uint8Array(f.rgba.length); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) o.set(f.rgba.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4), (y * f.w + f.w - 1 - x) * 4); return { w: f.w, h: f.h, rgba: o } }

// --- floor: equalise every tile's mean luminance to the first so open
// ground shows no tile grid; shaded copies for the ring round a mass ---
const floors = floorCells.map(c => resample(crop(c, false)))
const lum = f => { let s = 0; for (let i = 0; i < f.rgba.length; i += 4) s += 0.299 * f.rgba[i] + 0.587 * f.rgba[i + 1] + 0.114 * f.rgba[i + 2]; return s / (f.rgba.length / 4) }
const scale = (f, k) => ({ w: f.w, h: f.h, rgba: f.rgba.map((v, i) => i % 4 === 3 ? v : Math.max(0, Math.min(255, Math.round(v * k)))) })
const L0 = 102   // the example strips' ground luminance: every tile is normalised to it
const speckle = (f, i) => ({ w: f.w, h: f.h, rgba: f.rgba.map((v, j) => {
  if (j % 4 === 3) return v
  return hash(i + 1, j >> 2, 9) % 33 === 0 ? Math.round(v * 0.55) : v   // ~3% dark gravel specks
}) })
const shadeRows = f => ({ w: f.w, h: f.h, rgba: f.rgba.map((v, i) => {
  if (i % 4 === 3) return v
  const y = Math.floor(i / 4 / f.w)
  const k = y < 2 ? SHADE_TOP : y < 8 ? SHADE_RAMP + (1 - SHADE_RAMP) * (y - 2) / 6 : 1
  return Math.max(0, Math.min(255, Math.round(v * k)))
}) })
floors.forEach((f, i) => {
  const eq = speckle(scale(f, L0 / lum(f)), i)
  emit(`ow_mtn_ground_${i}`, eq)
  emit(`ow_mtn_shade_${i}`, shadeRows(eq))
})

// --- keyed pieces ---
series('ow_mtn_ridge_dr', RIDGE.dr, true)
series('ow_mtn_ridge_dl', RIDGE.dl, true)
series('ow_mtn_ridge_lb', RIDGE.lb, true)
RIDGE.lb.forEach((c, i) => emit(`ow_mtn_ridge_br_${i}`, flipX(hardenAlpha(resample(padSquare(crop(frameBox[c], true)))))))
series('ow_mtn_ridge_v', RIDGE.v, true)
series('ow_mtn_rock', ROCK, true)

// --- the mass: one global cone lattice, rendered cell by cell ---
// Cones sit on a half-offset grid (pitch 8 across, 6 down — measured off the
// sheet's own example strip), each jittered a little and drawn a little
// bigger or smaller, and the lattice repeats every 64x48 game px, so a cell
// at lattice position (qx, qy) always draws the same cones as its
// neighbours and the picture is seamless across cells. Rows are drawn back
// to front, each cone with a one-pixel dark base line, and the dark rock
// between cones fills what is left. A cell whose side is open (mask bit:
// 1 N, 2 E, 4 S, 8 W) draws no cone that would cross that side, and leaves
// everything beyond the cone silhouette on that side transparent.
const PX = 64, PY = 48, PITCH = 8, ROW = 6
const DARK = [48, 44, 46]       // the rock between cones: mid-dark, not black
const BASE = [30, 27, 29]       // a cone's one-pixel base line
const CONTRAST = 1.15
const coneCache = new Map()
const coneAt = (idx, w, h) => {
  const key = `${idx}:${w}:${h}`
  if (!coneCache.has(key)) {
    const f = hardenAlpha(resample(padSquare(alphaBox(crop(frameBox[CONE[idx]], true))), w, h))
    for (let i = 0; i < f.rgba.length; i += 4) for (let c = 0; c < 3; c++) f.rgba[i + c] = Math.max(0, Math.min(255, Math.round((f.rgba[i + c] - 110) * CONTRAST + 110)))
    coneCache.set(key, f)
  }
  return coneCache.get(key)
}
// every cone of one lattice period, in draw order (back to front, left to right)
// No cone may straddle a cell corner (a point (16i, 16j)): a cell open on
// one side excludes the cones crossing that side, so a cone over a corner
// would be drawn whole by one neighbour and cut flat by the two others at
// every concave corner. A jitter that lands on a corner is re-rolled, and
// failing that the cone shrinks; the corner then sits in the dark gap.
const straddlesCorner = (x, y, w, h) => {
  for (let cx = Math.ceil((x + 1) / T) * T; cx < x + w; cx += T)
    for (let cy = Math.ceil((y + 1) / T) * T; cy < y + h; cy += T) return true
  return false
}
const CONES = []
for (let r = 0; r < PY / ROW; r++) for (let i = 0; i < PX / PITCH; i++) {
  // 7-12 px wide, 10-13 tall; one in six is a big 13-14 px cone that breaks
  // the diagonal gap chains of an exact lattice
  const big = hash(r, i, 6) % 6 === 0
  let w = big ? 13 + hash(r, i, 1) % 2 : 7 + hash(r, i, 1) % 6, h = big ? 13 + hash(r, i, 2) % 2 : 10 + hash(r, i, 2) % 4
  const base = i * PITCH + (r & 1 ? PITCH / 2 : 0)
  let placed = null
  for (let attempt = 0; attempt < 40 && !placed; attempt++) {
    const jx = (hash(r, i, 3 + attempt) % 5) - 2, jy = (hash(r, i, 40 + attempt) % 3) - 1
    const x = Math.round(base + jx - w / 2), y = r * ROW + jy
    if (!straddlesCorner(x, y, w, h)) placed = { x, y }
    else if (attempt % 8 === 7 && w > 6) { w--; h-- }
  }
  if (!placed) { w = 6; h = 8; placed = { x: Math.round(base - w / 2), y: r * ROW } }
  CONES.push({ ...placed, w, h, idx: hash(r, i, 5) % CONE.length })
}
// The rim: on every open side a chain of three round-topped boulder lumps
// (squat cones, 5-7 px, overlapping, each with its own one-pixel dark
// underside) runs along that side in a band BAND px deep, in front of the
// cones. Nothing is filled behind the lumps, so the contour wobbles lump by
// lump and the ground shows in the notches. A chain always spans its own
// cell exactly — first lump on the left boundary, last on the right — and
// never crosses into a neighbour, so it abuts the next cell's chain on a
// straight face and ends cleanly at a concave corner.
const BAND = 6
function lumpsFor(side, qx, qy) {
  const salt = { N: 11, S: 23, E: 37, W: 53 }[side]
  const w0 = 5 + hash(qx, qy, salt) % 3, w1 = 5 + hash(qx, qy, salt + 1) % 3, w2 = 5 + hash(qx, qy, salt + 2) % 3
  const mid = Math.round((w0 + (T - w2)) / 2 - w1 / 2) + (hash(qx, qy, salt + 3) % 3) - 1
  return [[0, w0], [mid, w1], [T - w2, w2]].map(([along, w], k) => ({
    along, w, h: w - (hash(qx, qy, salt + 4 + k) % 2), across: hash(qx, qy, salt + 7 + k) % 3, idx: hash(qx, qy, salt + 10 + k) % CONE.length,
  }))
}

function latticeCell(mask, qx, qy) {
  const L = qx * T, Tp = qy * T, R = L + T, B = Tp + T
  const out = new Uint8Array(T * T * 4)
  const openN = mask & 1, openE = mask & 2, openS = mask & 4, openW = mask & 8
  // cones are clipped at an open side (never crossing it); the rim lumps
  // are drawn over them, and the rock fill stays out of the rim band so the
  // notches between lumps show ground
  const iT = Tp, iB = B, iL = L, iR = R
  const fT = openN ? Tp + BAND : Tp, fB = openS ? B - BAND : B, fL = openW ? L + BAND : L, fR = openE ? R - BAND : R
  // cones from this period and the eight around it, in draw order
  const list = []
  for (let py = -1; py <= 1; py++) for (let px = -1; px <= 1; px++) for (const c of CONES) list.push({ ...c, x: c.x + px * PX, y: c.y + py * PY })
  list.sort((a, b) => a.y - b.y || a.x - b.x)
  const stampCone = (c, f) => {
    const base = new Array(c.w).fill(-1)
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 4
      if (f.rgba[i + 3] === 0) continue
      base[x] = y
      const gx = c.x + x - L, gy = c.y + y - Tp
      if (gx < 0 || gx >= T || gy < 0 || gy >= T) continue
      const o = (gy * T + gx) * 4
      out[o] = f.rgba[i]; out[o + 1] = f.rgba[i + 1]; out[o + 2] = f.rgba[i + 2]; out[o + 3] = 255
    }
    for (let x = 0; x < c.w; x++) {
      if (base[x] < 0) continue
      const gx = c.x + x - L, gy = c.y + base[x] + 1 - Tp
      if (gx < 0 || gx >= T || gy < 0 || gy >= T) continue
      const o = (gy * T + gx) * 4
      out[o] = BASE[0]; out[o + 1] = BASE[1]; out[o + 2] = BASE[2]; out[o + 3] = 255
    }
  }
  for (const c of list) {
    if (c.x + c.w <= L || c.x >= R || c.y + c.h <= Tp || c.y >= B) continue
    if (openN && c.y < iT) continue
    if (openS && c.y + c.h > iB) continue
    if (openW && c.x < iL) continue
    if (openE && c.x + c.w > iR) continue
    stampCone(c, coneAt(c.idx, c.w, c.h))
  }
  // the rim lumps, in front, along the open sides
  const rim = []
  if (openN) for (const l of lumpsFor('N', qx, qy)) rim.push({ x: L + l.along, y: Tp + l.across, w: l.w, h: l.h, idx: l.idx })
  if (openS) for (const l of lumpsFor('S', qx, qy)) rim.push({ x: L + l.along, y: B - l.h - l.across, w: l.w, h: l.h, idx: l.idx })
  if (openW) for (const l of lumpsFor('W', qx, qy)) rim.push({ x: L + l.across, y: Tp + l.along, w: l.w, h: l.h, idx: l.idx })
  if (openE) for (const l of lumpsFor('E', qx, qy)) rim.push({ x: R - l.w - l.across, y: Tp + l.along, w: l.w, h: l.h, idx: l.idx })
  rim.sort((a, b) => a.y - b.y || a.x - b.x)
  for (const c of rim) stampCone(c, coneAt(c.idx, c.w, c.h))
  // beyond the silhouette on an open side stays transparent; the rest is rock
  const opaque = (x, y) => out[(y * T + x) * 4 + 3] === 255
  const outside = new Uint8Array(T * T)
  if (openN) for (let x = 0; x < T; x++) for (let y = 0; y < T && !opaque(x, y); y++) outside[y * T + x] = 1
  if (openS) for (let x = 0; x < T; x++) for (let y = T - 1; y >= 0 && !opaque(x, y); y--) outside[y * T + x] = 1
  if (openW) for (let y = 0; y < T; y++) for (let x = 0; x < T && !opaque(x, y); x++) outside[y * T + x] = 1
  if (openE) for (let y = 0; y < T; y++) for (let x = T - 1; x >= 0 && !opaque(x, y); x--) outside[y * T + x] = 1
  // the rock between cones fills the cone region only; the rim band stays
  // open between its lumps
  for (let i = 0; i < T * T; i++) {
    const x = L + (i % T), y = Tp + Math.floor(i / T)
    const inner = x >= fL && x < fR && y >= fT && y < fB
    if (inner && !outside[i] && out[i * 4 + 3] === 0) { out[i * 4] = DARK[0]; out[i * 4 + 1] = DARK[1]; out[i * 4 + 2] = DARK[2]; out[i * 4 + 3] = 255 }
  }
  return { w: T, h: T, rgba: out }
}
for (let mask = 0; mask < 16; mask++) for (let qy = 0; qy < PY / T; qy++) for (let qx = 0; qx < PX / T; qx++)
  emit(`ow_mtn_lat_${mask}_${qx + (PX / T) * qy}`, latticeCell(mask, qx, qy))

// sweep stale tiles from earlier sheets / classifications
for (const f of fs.readdirSync(OUT_DIR)) {
  const n = f.slice(0, -4)
  if (n.startsWith('ow_mtn_') && !written.includes(n)) fs.unlinkSync(path.join(OUT_DIR, f))
}
console.log(`wrote ${written.length} tiles -> ${OUT_DIR} (floor row had ${floorCells.length} cells)`)
