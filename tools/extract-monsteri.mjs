// Monsteri from the user's crayon drawing (monsteri.jpg, a phone photo of
// paper on a table). assets/monsteri.png is that photo turned upright and
// shrunk to a quarter, once, with PIL; this script lifts the drawing off
// the paper and writes the one-frame sheet renderer/assets/monsters/
// monsteri.png + monsteri-sheet.js that render/monster-rigs/monsteri.js
// draws.
//
// Keying: paper is bright and nearly grey; the table and the jeans around
// it are flood-filled away from the photo's border; everything else on the
// paper (red crayon, pencil lines, the yellow orbs) is the drawing.
// Crayon hatching leaves paper showing between strokes, so the mask is
// closed and its small holes filled to make a solid body, and inside the
// mask the paper gaps take the crayon colour around them. Crayon on white
// photographs pale, so every colour's distance from the paper is doubled. Pencil lines are
// thickened first so the claws and stalks survive the downsample. A dark
// one-pixel outline keeps it readable on any floor.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readPng } from './png-read.mjs'
import { downsample, writeSheet } from './sprite-sheet-lib.mjs'

const SRC = 'assets/monsteri.png'
const OUT_PNG = 'renderer/assets/monsters/monsteri.png'
const OUT_META = 'renderer/assets/monsters/monsteri-sheet.js'

// Measured on assets/monsteri.png (paper ~ (212,202,191), crayon ~ (205,160,150),
// pencil ~ (120,110,105), wood ~ (178,140,91), jeans ~ (43,42,38)).
const PAPER_LUM = 168        // paper is at least this bright...
const PAPER_CHROMA = 32      // ...and at most this colourful (max - min channel)
const CRAYON_RED = 22        // crayon: R exceeds both G and B by this much...
const CRAYON_GB = 28         // ...while G and B stay this close (wood's B falls far below G)
const CRAYON_LUM = 120       // ...and it is light: crayon on paper, not the dark floor
const PENCIL_LUM = 150       // pencil: darker than this, and not crayon
const PENCIL_GROW = 2        // px a pencil line is thickened by
const CLOSE_R = 3            // px: closing radius that joins hatching strokes
const HOLE_MAX = 900         // px: enclosed paper smaller than this becomes body
const SPECK_MIN = 60         // px: ink components smaller than this are paper grain
const SCALE = 8              // downsample factor: ~95 px tall
const ALPHA_CUT = 110        // after downsampling, coverage below this is dropped
const KEEP_MARGIN = 30       // px: pieces this close to the body's box belong to it (the orbs)
const PAPER = [212, 202, 191] // the paper's colour, for the crayon boost
const BOOST = 2              // crayon on paper photographs pale: distance from paper x this
const OUTLINE = [58, 20, 22]

if (!fs.existsSync(SRC)) { console.log(`monsteri photo not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const W = src.width, H = src.height, px = src.pixels
const N = W * H
const at = i => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b
const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b)
const isPaper = c => lum(c) >= PAPER_LUM && chroma(c) <= PAPER_CHROMA
const isCrayon = c => c[0] - Math.max(c[1], c[2]) >= CRAYON_RED && Math.abs(c[1] - c[2]) <= CRAYON_GB && lum(c) >= CRAYON_LUM
const isYellow = ([r, g, b]) => r > 170 && g > 160 && r - b > 45 && g - b > 35 && Math.abs(r - g) < 30

function flood(seeds, pass) {
  const seen = new Uint8Array(N), stack = []
  for (const s of seeds) if (pass(s) && !seen[s]) { seen[s] = 1; stack.push(s) }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
      if (j >= 0 && !seen[j] && pass(j)) { seen[j] = 1; stack.push(j) }
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
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && mask[j] && label[j] < 0) { label[j] = id; stack.push(j) }
    }
    sizes.push(n)
  }
  return { label, sizes }
}
function morph(mask, r, grow) {
  const out = new Uint8Array(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let hit = !grow
    for (let dy = -r; dy <= r && hit !== grow; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const X = x + dx, Y = y + dy
      const v = X >= 0 && X < W && Y >= 0 && Y < H ? mask[Y * W + X] : 0
      if (grow && v) { hit = true; break }
      if (!grow && !v) { hit = false; break }
    }
    out[y * W + x] = hit ? 1 : 0
  }
  return out
}

// 1. the world outside the paper: everything reachable from the photo's
//    border without crossing paper or crayon
const border = []
for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x)
for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1)
const outside = flood(border, i => { const c = at(i); return !isPaper(c) && !isCrayon(c) })

// 2. ink on the paper, minus specks
const crayon = new Uint8Array(N), pencil = new Uint8Array(N), ink = new Uint8Array(N)
for (let i = 0; i < N; i++) {
  if (outside[i]) continue
  const c = at(i)
  if (isCrayon(c) || isYellow(c)) crayon[i] = 1
  else if (lum(c) < PENCIL_LUM) pencil[i] = 1
}
const grown = morph(pencil, PENCIL_GROW, true)
for (let i = 0; i < N; i++) ink[i] = crayon[i] || (grown[i] && !outside[i]) ? 1 : 0
{
  const { label, sizes } = components(ink)
  for (let i = 0; i < N; i++) if (ink[i] && sizes[label[i]] < SPECK_MIN) ink[i] = 0
}

// 3. solid body: close the hatching, fill small enclosed holes
let mask = morph(morph(ink, CLOSE_R, true), CLOSE_R, false)
for (let i = 0; i < N; i++) if (ink[i]) mask[i] = 1
{
  const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = mask[i] ? 0 : 1
  const { label, sizes } = components(inv)
  const touches = new Set()
  for (const b of border) if (inv[b]) touches.add(label[b])
  for (let i = 0; i < N; i++) if (inv[i] && !touches.has(label[i]) && sizes[label[i]] < HOLE_MAX) mask[i] = 1
}

// 3b. one drawing: the body (the largest piece) and whatever sits within
//     KEEP_MARGIN of its box (orbs, stray claws); grain and floor go
{
  const { label, sizes } = components(mask)
  const body = sizes.indexOf(Math.max(...sizes))
  const box = [W, H, -1, -1], boxes = sizes.map(() => [W, H, -1, -1])
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue
    const b = boxes[label[i]], x = i % W, y = (i / W) | 0
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y)
  }
  box.splice(0, 4, ...boxes[body])
  const near = b => b[2] >= box[0] - KEEP_MARGIN && b[0] <= box[2] + KEEP_MARGIN && b[3] >= box[1] - KEEP_MARGIN && b[1] <= box[3] + KEEP_MARGIN
  for (let i = 0; i < N; i++) if (mask[i] && !near(boxes[label[i]])) mask[i] = 0
}

// 4. colour: drawing pixels keep their own colour; paper showing through
//    the mask takes the mean crayon colour of its neighbourhood
const R = 6
const rgba = new Uint8Array(N * 4)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x
  if (!mask[i]) continue
  let c = at(i)
  if (!crayon[i] && !pencil[i]) {
    let r = 0, g = 0, b = 0, n = 0
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx, Y = y + dy
      if (X < 0 || X >= W || Y < 0 || Y >= H || !crayon[Y * W + X]) continue
      const k = (Y * W + X) * 4; r += px[k]; g += px[k + 1]; b += px[k + 2]; n++
    }
    if (n) c = [r / n, g / n, b / n]
  }
  const k = ch => Math.max(0, Math.min(255, Math.round(PAPER[ch] + (c[ch] - PAPER[ch]) * BOOST)))
  rgba.set([k(0), k(1), k(2), 255], i * 4)
}

// 5. crop, downsample, harden the edge, outline
let x0 = W, x1 = -1, y0 = H, y1 = -1
for (let i = 0; i < N; i++) if (mask[i]) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
const cw = x1 - x0 + 1, ch = y1 - y0 + 1
const crop = new Uint8Array(cw * ch * 4)
for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1 + 1) * 4), y * cw * 4)
const small = downsample({ w: cw, h: ch, rgba: crop }, SCALE)
const P = 1, fw = small.w + 2 * P, fh = small.h + 2 * P
const frame = new Uint8Array(fw * fh * 4)
for (let y = 0; y < small.h; y++) for (let x = 0; x < small.w; x++) {
  const s = (y * small.w + x) * 4
  if (small.rgba[s + 3] < ALPHA_CUT) continue
  frame.set([small.rgba[s], small.rgba[s + 1], small.rgba[s + 2], 255], ((y + P) * fw + x + P) * 4)
}
const solid = i => frame[i * 4 + 3] === 255
const lined = new Uint8Array(frame)
for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
  const i = y * fw + x
  if (solid(i)) continue
  if ((x > 0 && solid(i - 1)) || (x < fw - 1 && solid(i + 1)) || (y > 0 && solid(i - fw)) || (y < fh - 1 && solid(i + fw)))
    lined.set([...OUTLINE, 255], i * 4)
}

const { sheetW, sheetH } = writeSheet({
  outPng: OUT_PNG, outMeta: OUT_META, rows: [{ name: 'idle', frames: [{ w: fw, h: fh, rgba: lined }] }],
  align: 'bottom', source: 'tools/extract-monsteri.mjs from assets/monsteri.png',
  note: 'One frame: the rig animates it whole.',
})
console.log(`drawing ${cw}x${ch} px on the photo → ${fw}x${fh} frame; wrote ${path.relative(process.cwd(), OUT_PNG)} ${sheetW}x${sheetH}`)
