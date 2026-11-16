// Klovni (the clown) from a child's drawing (klovni.jpg, a phone
// photo of paper on a table). assets/klovni.png is that photo turned
// upright, cropped to the drawing and shrunk to a half, once, with PIL; this
// script lifts the drawing off the paper and writes it at full size to
// assets/cuts/klovni.png: the monster cutter's source for klovni.
//
// The drawing is a red pencil OUTLINE on white paper, so unlike monsteri
// there is no coloured body to key: the body is whatever the outline
// encloses. Red lines are found by how far red stands over green (paper is
// nearly grey, the wooden table is red too but its blue falls far below its
// green), the lines are grown until the outline is watertight, the world is
// flooded in from the border, and what the flood cannot reach is the clown.
// Inside, the paper becomes one clean white and the lines one crayon red,
// thickened so the face, the bow tie and the hat survive the cutter's
// downsample (about 12x, to 84 art px tall).
//
//   node tools/extract-klovni.mjs [--debug <png>]
import * as fs from 'node:fs'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'

const SRC = 'assets/klovni.png'
const OUT_CUT = 'assets/cuts/klovni.png'

// Measured on assets/klovni.png: paper ~ (208,199,192), so R-G ~ 9; a line
// ~ (180,130,130), R-G 25-55 with G-B under 10; wood ~ (178,140,91).
const RED_STRONG = 20   // R-G of a sure line pixel
const RED_WEAK = 14     // ...and of a faint one touching a sure one
const WOOD_GB = 22      // G-B above this is the table, not the pencil
const RED_PAINT = 19    // R-G of a pixel painted as line (the watertight lines are fatter than the pencil)
const SPECK_MIN = 14    // px: line components smaller than this are paper grain
const CLOSE_R = 5       // px the lines grow by to make the outline watertight
const LINE_GROW = 1     // px a line is thickened by in the output
const WHITE = [246, 242, 234]
const RED = [196, 52, 58]
// Gaps in the outline too wide for CLOSE_R, bridged by hand: [x0, y0, x1, y1].
const BRIDGES = []

if (!fs.existsSync(SRC)) { console.log(`klovni photo not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const W = src.width, H = src.height, px = src.pixels, N = W * H
const red = i => px[i * 4] - px[i * 4 + 1]
const wood = i => px[i * 4 + 1] - px[i * 4 + 2] > WOOD_GB

function flood(seeds, pass, eight = false) {
  const seen = new Uint8Array(N), stack = []
  for (const s of seeds) if (!seen[s] && pass(s)) { seen[s] = 1; stack.push(s) }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || (!eight && dx && dy)) continue
      const X = x + dx, Y = y + dy
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue
      const j = Y * W + X
      if (!seen[j] && pass(j)) { seen[j] = 1; stack.push(j) }
    }
  }
  return seen
}
function components(mask) {
  const label = new Int32Array(N).fill(-1), sizes = []
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s] >= 0) continue
    const id = sizes.length, stack = [s]; label[s] = id; let n = 0
    while (stack.length) {
      const i = stack.pop(); n++
      const x = i % W, y = (i / W) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        const j = Y * W + X
        if (mask[j] && label[j] < 0) { label[j] = id; stack.push(j) }
      }
    }
    sizes.push(n)
  }
  return { label, sizes }
}
function grow(mask, r) {
  const out = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue
    const x = i % W, y = (i / W) | 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const X = x + dx, Y = y + dy
      if (X >= 0 && Y >= 0 && X < W && Y < H) out[Y * W + X] = 1
    }
  }
  return out
}

// 1. the pencil: sure pixels, plus the faint ones that hang on them; no grain
const sure = []
for (let i = 0; i < N; i++) if (red(i) >= RED_STRONG && !wood(i)) sure.push(i)
let ink = flood(sure, i => red(i) >= RED_WEAK && !wood(i), true)
{
  const { label, sizes } = components(ink)
  for (let i = 0; i < N; i++) if (ink[i] && sizes[label[i]] < SPECK_MIN) ink[i] = 0
}
for (const [x0, y0, x1, y1] of BRIDGES) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ink[(y + dy) * W + x + dx] = 1
  }
}

// 2. the clown: what the world cannot reach past the grown lines, given back
//    the band the growing took, plus every line
const wall = grow(ink, CLOSE_R)
const border = []
for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x)
for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1)
const outside = grow(flood(border, i => !wall[i]), CLOSE_R)
let body = new Uint8Array(N)
for (let i = 0; i < N; i++) body[i] = !outside[i] || ink[i] ? 1 : 0

// 3. one drawing: the largest piece; the paper's edge and grain go
{
  const { label, sizes } = components(body)
  const main = sizes.indexOf(Math.max(...sizes))
  for (let i = 0; i < N; i++) if (body[i] && label[i] !== main) body[i] = 0
  console.log(`body ${sizes[main]} px; ${sizes.length - 1} loose bits dropped`)
}

// 4. paint: clean white inside, thick red lines; a line that stands alone
//    (the aerial) is thickened outward too, so it is not lost
const fine = new Uint8Array(N)
for (let i = 0; i < N; i++) fine[i] = ink[i] && red(i) >= RED_PAINT ? 1 : 0
const thick = grow(fine, LINE_GROW)
const lone = new Uint8Array(N)
{
  // ink with no enclosed paper within reach is a free-standing stroke
  const inner = new Uint8Array(N)
  for (let i = 0; i < N; i++) inner[i] = body[i] && !ink[i] ? 1 : 0
  const reach = grow(inner, CLOSE_R + 2)
  for (let i = 0; i < N; i++) lone[i] = ink[i] && body[i] && !reach[i] ? 1 : 0
  const fat = grow(lone, LINE_GROW)
  for (let i = 0; i < N; i++) if (fat[i]) body[i] = 1
}
const out = new Uint8Array(N * 4)
let nBody = 0, nInk = 0
for (let i = 0; i < N; i++) {
  if (!body[i]) continue
  const c = thick[i] ? RED : WHITE
  out.set([c[0], c[1], c[2], 255], i * 4)
  nBody++; if (thick[i]) nInk++
}
writePng(OUT_CUT, W, H, out)
console.log(`wrote ${OUT_CUT} (${W}x${H}): ${nBody} px, ${nInk} of them line`)

const dbg = process.argv.indexOf('--debug')
if (dbg > 0) {
  // the drawing over a grey-green backdrop, for the eye
  const d = new Uint8Array(N * 4)
  for (let i = 0; i < N; i++) d.set(body[i] ? [out[i * 4], out[i * 4 + 1], out[i * 4 + 2], 255] : [70, 110, 80, 255], i * 4)
  writePng(process.argv[dbg + 1], W, H, d)
}
