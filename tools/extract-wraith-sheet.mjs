// Turn the wraith concept sheet (assets/wraith.png — an RGBA mockup whose
// alpha channel already cuts the eight frames out of a smoky backdrop; a
// title, frame digits and a palette strip share the page) into the sprite
// sheet the `wraith` rig blits: renderer/assets/monsters/wraith.png plus the
// generated wraith-sheet.js. Frames sit on a 4x2 grid; each is the alpha
// bounding box inside its grid cell, cropped, downsampled and top-aligned so
// the hood stays put across the loop. The eight-frame loop splits into two
// logical rows: `float` (frames 1-5, the drifting body) and `dissolve`
// (frames 6-8, the body unravelling to a wisp and a pair of eyes).
// Usage: node tools/extract-wraith-sheet.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { downsample, writeSheet } from './sprite-sheet-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '../assets/wraith.png')
const OUT_DIR = path.join(HERE, '../renderer/assets/monsters')
const OUT_PNG = path.join(OUT_DIR, 'wraith.png')
const OUT_META = path.join(OUT_DIR, 'wraith-sheet.js')

const COLS = 4
// Row bands (source px): the blank rows between each frame row and the digit
// labels under it, measured off the sheet.
const GRID_ROWS = [{ y0: 146, y1: 585 }, { y0: 671, y1: 1088 }]
const ALPHA_MIN = 8           // alpha below this is backdrop haze, not art
const SCALE = 5               // downsample factor: a frame ends up ~91 px tall
const PAD = 1                 // transparent px around each frame (post-scale)
const ROWS = [
  { name: 'float',    cells: [0, 1, 2, 3, 4] },
  { name: 'dissolve', cells: [5, 6, 7] },
]

if (!fs.existsSync(SRC)) { console.log(`wraith sheet not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const cellW = Math.floor(src.width / COLS)
const alphaAt = (x, y) => src.pixels[(y * src.width + x) * 4 + 3]

// Alpha bounding box of one grid cell, then a straight RGBA crop of it: the
// sheet's own alpha is the key, so nothing is guessed from colour.
function cropCell(index) {
  const col = index % COLS, band = GRID_ROWS[Math.floor(index / COLS)]
  const cx0 = col * cellW, cx1 = cx0 + cellW
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1
  for (let y = band.y0; y < band.y1; y++) for (let x = cx0; x < cx1; x++) {
    if (alphaAt(x, y) < ALPHA_MIN) continue
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) throw new Error(`frame ${index + 1}: no opaque pixels in its grid cell`)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((y0 + y) * src.width + (x0 + x)) * 4, o = (y * w + x) * 4
    rgba.set(src.pixels.subarray(si, si + 4), o)
    if (rgba[o + 3] < ALPHA_MIN) rgba[o + 3] = 0
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
  outPng: OUT_PNG, outMeta: OUT_META, rows, align: 'top',
  source: 'tools/extract-wraith-sheet.mjs from assets/wraith.png',
  note: `A fifth of the concept sheet's resolution.`,
})
for (const r of rows) console.log(r.name, r.frames.length, 'frames', r.frames.map(f => `${f.w}x${f.h}`).join(' '))
console.log('wrote', path.relative(process.cwd(), OUT_PNG), `${sheetW}x${sheetH}`, 'and', path.relative(process.cwd(), OUT_META))
