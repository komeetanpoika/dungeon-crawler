// Ground truth for the piece finder: five monsters assembled from the Kenney
// Monster Builder Pack (CC0, sprites in ./kenney) with known placement. Each is
// composited on white into kenney/assembled/<name>.png, and
// kenney/assembled/<name>.truth.json holds { pieces: [{ role, side, mask }] }:
// each limb's alpha minus the body's alpha (the part a flat image can show),
// as run lengths (see mask.js). Node-only.
//   node tools/monster-cutter/fixtures/assemble-kenney.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../../png-read.mjs'
import { writePng } from '../../png-write.mjs'
import { encodeMask } from '../mask.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPRITES = join(HERE, 'kenney')
const OUT = join(SPRITES, 'assembled')
const MARGIN = 24 // white border around each monster
const TUCK = 0.1 // limbs overlap the body edge by this share of their length
const GAP = 3 // limbs must stay this far apart, or the finder would see one limb

// The shoulder or hip ball centre of each limb shape, in sprite px (the pin a
// limb is placed and rotated by; arm E has no ball, so its top end).
const JOINT = {
  arm: { A: [24, 24], B: [17, 17], C: [29, 29], D: [30, 30], E: [35, 16] },
  leg: { A: [25, 25], B: [15, 16], C: [21, 21], D: [21, 21], E: [24, 25] },
}

// Body px, (0,0) = the body sprite's top-left. A limb's joint starts at `at`
// and `angle` turns it clockwise (degrees) about the joint; then tuck() slides
// it toward or away from the body's centre until TUCK of its length lies under
// the body edge. The sprites are image-right limbs (hand and foot point
// right); the left ones are mirrored about the body's centre line unless
// `armsLeft` says otherwise.
const PLACEMENTS = [
  {
    name: 'square', body: 'body_greenA', arm: 'arm_greenA', leg: 'leg_greenA',
    arms: { at: [160, 46], angle: -10 }, legs: { at: [116, 158], angle: 0 },
    eyes: [['eye_human_green', [50, 26]]], mouth: ['mouthA', [48, 100]],
  },
  {
    name: 'round', body: 'body_blueB', arm: 'arm_blueC', leg: 'leg_blueB',
    arms: { at: [180, 62], angle: -55 }, legs: { at: [128, 182], angle: 8 },
    eyes: [['eye_blue', [34, 40]], ['eye_blue', [96, 40]]], mouth: ['mouthC', [58, 118]],
  },
  {
    name: 'egg', body: 'body_redC', arm: 'arm_redB', leg: 'leg_redC',
    arms: { at: [134, 70], angle: -25 }, legs: { at: [96, 180], angle: -6 },
    eyes: [['eye_angry_red', [42, 40]]], mouth: ['mouth_closed_fangs', [46, 118]],
  },
  {
    name: 'pill', body: 'body_darkE', arm: 'arm_darkD', leg: 'leg_darkD',
    arms: { at: [126, 92], angle: -35 }, legs: { at: [90, 236], angle: 0 },
    armsLeft: { at: [6, 92], angle: 100 },
    eyes: [['eye_cute_dark', [34, 40]]], mouth: ['mouthH', [27, 130]],
  },
  {
    name: 'dome', body: 'body_yellowD', arm: 'arm_yellowE', leg: 'leg_yellowE',
    arms: { at: [162, 62], angle: -40 }, legs: { at: [112, 170], angle: 0 },
    eyes: [['eye_yellow', [30, 40]], ['eye_yellow', [82, 40]]], mouth: ['mouthF', [50, 116]],
  },
]

const cache = new Map()
function sprite(name) {
  if (!cache.has(name)) {
    const { width, height, pixels } = readPng(join(SPRITES, `${name}.png`))
    cache.set(name, { w: width, h: height, rgba: pixels })
  }
  return cache.get(name)
}

// A sprite placed on the canvas: its pin goes to `at`, turned by `angle`.
function layer(name, at, { pin = [0, 0], angle = 0, flip = false } = {}) {
  const img = sprite(name), t = angle * Math.PI / 180
  return { name, img, at, pin, flip, cos: Math.cos(t), sin: Math.sin(t) }
}

// canvas point -> sprite point
function toSprite(L, x, y) {
  const dx = x - L.at[0], dy = y - L.at[1]
  const u = dx * L.cos + dy * L.sin, v = -dx * L.sin + dy * L.cos
  return [L.pin[0] + (L.flip ? -u : u), L.pin[1] + v]
}

// sprite point -> canvas point
function toCanvas(L, sx, sy) {
  const u = (L.flip ? -1 : 1) * (sx - L.pin[0]), v = sy - L.pin[1]
  return [L.at[0] + u * L.cos - v * L.sin, L.at[1] + u * L.sin + v * L.cos]
}

function bounds(L) {
  const { w, h } = L.img
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([sx, sy]) => toCanvas(L, sx, sy))
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])),
    Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]
}

// Bilinear, premultiplied RGBA of a layer at canvas pixel (x, y).
function sample(L, x, y) {
  const [sx, sy] = toSprite(L, x + 0.5, y + 0.5)
  const { w, h, rgba } = L.img
  const fx = sx - 0.5, fy = sy - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy)
  const out = [0, 0, 0, 0]
  for (const [ix, iy, wt] of [[x0, y0, (1 - fx + x0) * (1 - fy + y0)], [x0 + 1, y0, (fx - x0) * (1 - fy + y0)],
    [x0, y0 + 1, (1 - fx + x0) * (fy - y0)], [x0 + 1, y0 + 1, (fx - x0) * (fy - y0)]]) {
    if (ix < 0 || iy < 0 || ix >= w || iy >= h || !wt) continue
    const i = (iy * w + ix) * 4, a = rgba[i + 3] / 255
    out[0] += rgba[i] * a * wt; out[1] += rgba[i + 1] * a * wt; out[2] += rgba[i + 2] * a * wt; out[3] += a * wt
  }
  return out
}

// Share of a limb's length under the body: walking its centre line (the
// middle of each sprite row) from the joint end, how far it stays hidden.
// Only the body sprite counts, which sits at (0,0) unturned before the
// canvas offset is applied.
function overlap(L, body) {
  const { w, h, rgba } = L.img
  const rows = []
  for (let y = 0; y < h; y++) {
    let n = 0, sx = 0
    for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= 128) { n++; sx += x + 0.5 }
    if (n) rows.push([sx / n, y + 0.5])
  }
  let k = 0
  while (k < rows.length) {
    const [cx, cy] = toCanvas(L, ...rows[k]).map(Math.floor)
    if (cx < 0 || cy < 0 || cx >= body.w || cy >= body.h || body.rgba[(cy * body.w + cx) * 4 + 3] < 128) break
    k++
  }
  return k / rows.length
}

// Slide a limb away from the body's centre until TUCK of its length lies under the body.
function tuck(L, body) {
  const at = L.at.slice(), d = Math.hypot(at[0] - body.w / 2, at[1] - body.h / 2)
  const ax = (at[0] - body.w / 2) / d, ay = (at[1] - body.h / 2) / d
  const place = s => { L.at = [at[0] + ax * s, at[1] + ay * s]; return overlap(L, body) }
  let lo = -80, hi = 80
  if (place(lo) < TUCK || place(hi) > TUCK) throw new Error(`cannot tuck ${L.name} to ${TUCK}`)
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (place(mid) > TUCK) lo = mid; else hi = mid }
  place(hi)
}

function assemble(P) {
  const body = sprite(P.body)
  const limbs = []
  for (const role of ['leg', 'arm']) {
    const name = P[role], pin = JOINT[role][name.slice(-1)]
    const right = P[`${role}s`], left = P[`${role}sLeft`] || { at: [body.w - right.at[0], right.at[1]], angle: -right.angle }
    limbs.push({ role, side: 'right', L: layer(name, right.at, { pin, angle: right.angle }) })
    limbs.push({ role, side: 'left', L: layer(name, left.at, { pin, angle: left.angle, flip: true }) })
  }
  for (const { L } of limbs) tuck(L, body)
  const bodyL = layer(P.body, [0, 0])
  const faces = [...P.eyes, P.mouth].map(([name, at]) => layer(name, at))
  const all = [...limbs.map(l => l.L), bodyL, ...faces] // back to front
  const bx = all.map(bounds)
  const ox = MARGIN - Math.floor(Math.min(...bx.map(b => b[0]))), oy = MARGIN - Math.floor(Math.min(...bx.map(b => b[1])))
  const w = Math.ceil(Math.max(...bx.map(b => b[2]))) + ox + MARGIN, h = Math.ceil(Math.max(...bx.map(b => b[3]))) + oy + MARGIN
  for (const L of all) L.at = [L.at[0] + ox, L.at[1] + oy]

  const rgba = new Uint8Array(w * h * 4)
  const alpha = L => {
    const a = new Float32Array(w * h)
    const [x0, y0, x1, y1] = bounds(L)
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1) + 1); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1) + 1); x++) a[y * w + x] = sample(L, x, y)[3]
    }
    return a
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 255, g = 255, b = 255 // white backdrop, layers over it back to front
    for (const L of all) {
      const [pr, pg, pb, a] = sample(L, x, y)
      if (!a) continue
      r = pr + r * (1 - a); g = pg + g * (1 - a); b = pb + b * (1 - a)
    }
    const i = (y * w + x) * 4
    rgba[i] = Math.round(r); rgba[i + 1] = Math.round(g); rgba[i + 2] = Math.round(b); rgba[i + 3] = 255
  }

  const bodyA = alpha(bodyL)
  const pieces = limbs.map(({ role, side, L }) => {
    const a = alpha(L), mask = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) if (a[i] >= 0.5 && bodyA[i] < 0.5) mask[i] = 1
    return { role, side, mask }
  })
  // limbs must not touch, or the image shows one limb where the truth has two
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const A = pieces[i].mask, B = pieces[j].mask
    for (let p = 0; p < w * h; p++) {
      if (!A[p]) continue
      const x = p % w, y = (p - x) / w
      for (let dy = -GAP; dy <= GAP; dy++) for (let dx = -GAP; dx <= GAP; dx++) {
        const qx = x + dx, qy = y + dy
        if (qx >= 0 && qy >= 0 && qx < w && qy < h && B[qy * w + qx]) {
          throw new Error(`${P.name}: ${pieces[i].role} ${pieces[i].side} touches ${pieces[j].role} ${pieces[j].side}`)
        }
      }
    }
  }
  return { w, h, rgba, pieces }
}

mkdirSync(OUT, { recursive: true })
for (const P of PLACEMENTS) {
  const { w, h, rgba, pieces } = assemble(P)
  writePng(join(OUT, `${P.name}.png`), w, h, rgba)
  const truth = { pieces: pieces.map(({ role, side, mask }) => ({ role, side, mask: encodeMask(mask) })) }
  writeFileSync(join(OUT, `${P.name}.truth.json`), JSON.stringify(truth) + '\n')
  console.log(`${P.name}: ${w}x${h}`)
}
console.log(`wrote ${PLACEMENTS.length} assemblies`)
