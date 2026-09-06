// Turn the wolf concept sheet (assets/wolf.png — twelve pixel-art frames on
// a flat magenta backdrop, a 4x3 grid, saved from a JPEG so the key has to
// tolerate compression fringe) into the sprite sheet the wolf NPC blits:
// renderer/assets/npcs/wolf.png plus the generated wolf-sheet.js. Each frame
// is the keyed bounding box inside its grid cell, cropped, downsampled and
// bottom-aligned so the paws stay on the ground across the loop. The twelve
// frames split into three logical rows: `walk` (the trot cycle), `run` (the
// galloping lunge) and `bite` (the snap with its motion marks).
// Usage: node tools/extract-wolf-sheet.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { downsample, writeSheet } from './sprite-sheet-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '../assets/wolf.png')
const OUT_DIR = path.join(HERE, '../renderer/assets/npcs')
const OUT_PNG = path.join(OUT_DIR, 'wolf.png')
const OUT_META = path.join(OUT_DIR, 'wolf-sheet.js')

const COLS = 4, ROWS_IN_GRID = 3
// The backdrop as sampled off the sheet; JPEG ringing smears it toward the
// outline, so a pixel's alpha ramps from 0 at KEY_NEAR to 1 at KEY_FAR
// (colour distance from the key) instead of flipping at one threshold.
const KEY = [213, 60, 213]
const KEY_NEAR = 40, KEY_FAR = 110
const SCALE = 5               // downsample factor: a frame ends up ~48 px wide
const PAD = 1                 // transparent px around each frame (post-scale)
// Sheet frame numbers (1-based, row-major) per logical row.
const ROWS = [
  { name: 'walk', cells: [1, 2, 3, 4, 5, 8, 9] },
  { name: 'run',  cells: [6, 7, 12, 10] },
  { name: 'bite', cells: [11] },
]

if (!fs.existsSync(SRC)) { console.log(`wolf sheet not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const cellW = Math.floor(src.width / COLS), cellH = Math.floor(src.height / ROWS_IN_GRID)

function keyAlpha(r, g, b) {
  const d = Math.hypot(r - KEY[0], g - KEY[1], b - KEY[2])
  return Math.max(0, Math.min(1, (d - KEY_NEAR) / (KEY_FAR - KEY_NEAR)))
}
const alphaAt = (x, y) => { const i = (y * src.width + x) * 4; return keyAlpha(src.pixels[i], src.pixels[i + 1], src.pixels[i + 2]) }
// Despill: the key bleeds purple into the dark outline. The wolf's own
// palette (blue-greys, browns) never has both red and blue well above green,
// so any pixel that does gets pulled back toward neutral.
const DESPILL = 20
function despill(r, g, b) {
  const m = Math.min(r, b) - g - DESPILL
  return m > 0 ? [r - m, g, b - m] : [r, g, b]
}

// Keyed bounding box of one grid cell, then an RGBA crop of it with the
// key's alpha ramp applied.
function cropCell(frameNo) {
  const index = frameNo - 1
  const col = index % COLS, row = Math.floor(index / COLS)
  const cx0 = col * cellW, cx1 = cx0 + cellW, cy0 = row * cellH, cy1 = cy0 + cellH
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    if (alphaAt(x, y) < 0.5) continue
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) throw new Error(`frame ${frameNo}: no keyed pixels in its grid cell`)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((y0 + y) * src.width + (x0 + x)) * 4, o = (y * w + x) * 4
    const [r, g, b] = despill(src.pixels[si], src.pixels[si + 1], src.pixels[si + 2])
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b
    rgba[o + 3] = Math.round(255 * keyAlpha(src.pixels[si], src.pixels[si + 1], src.pixels[si + 2]))
  }
  return { w, h, rgba }
}

function padded({ w, h, rgba }) {
  const W = w + 2 * PAD, H = h + 2 * PAD
  const out = new Uint8Array(W * H * 4)
  for (let y = 0; y < h; y++) out.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), ((y + PAD) * W + PAD) * 4)
  return { w: W, h: H, rgba: out }
}

const rows = ROWS.map(r => ({ name: r.name, frames: r.cells.map(i => padded(downsample(cropCell(i), SCALE))) }))
const { sheetW, sheetH } = writeSheet({
  outPng: OUT_PNG, outMeta: OUT_META, rows, align: 'bottom',
  source: 'tools/extract-wolf-sheet.mjs from assets/wolf.png',
  note: `A fifth of the concept sheet's resolution.`,
})
for (const r of rows) console.log(r.name, r.frames.length, 'frames', r.frames.map(f => `${f.w}x${f.h}`).join(' '))
console.log('wrote', path.relative(process.cwd(), OUT_PNG), `${sheetW}x${sheetH}`, 'and', path.relative(process.cwd(), OUT_META))
