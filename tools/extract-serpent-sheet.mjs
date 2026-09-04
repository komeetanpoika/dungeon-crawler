// Turn the hand-made sea-serpent concept sheet (assets/serpent.png — an
// opaque RGB mockup with a navy backdrop, three labelled animation rows and
// irregularly spaced frames) into a real sprite sheet the `serpent` rig can
// blit: renderer/assets/monsters/serpent.png (uniform cells, transparent
// backdrop, half resolution) plus renderer/assets/monsters/serpent-sheet.js
// describing the grid. Frames are found by scanning each row band for
// columns that differ from the backdrop, the backdrop is flood-filled to
// alpha 0 from the crop edges (so the dark water inside a frame survives),
// and every frame is bottom-aligned so the waterline stays put across rows.
// Usage: node tools/extract-serpent-sheet.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { downsample, writeSheet } from './sprite-sheet-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '../assets/serpent.png')
const OUT_DIR = path.join(HERE, '../renderer/assets/monsters')
const OUT_PNG = path.join(OUT_DIR, 'serpent.png')
const OUT_META = path.join(OUT_DIR, 'serpent-sheet.js')

// Row bands (source px) measured off the sheet's IDLE / SWIM / DIVE labels.
const ROWS = [
  { name: 'idle', y0: 631, y1: 762 },
  { name: 'swim', y0: 825, y1: 908 },
  { name: 'dive', y0: 983, y1: 1076 },
]
const BG = [2, 20, 46]        // backdrop navy — the sheet uses four values within ±4 of this
const KEY_TOL = 14            // |dr|+|dg|+|db| below this counts as backdrop (tight: the
                              // serpent's outline and the in-frame water are only ~20-40 off it)
const SPECK_TOL = 60          // a stray dark speck this close to the backdrop ...
const SPECK_MAX = 10          // ... in a component this small is backdrop noise, not art
const MIN_GAP = 14            // column gaps narrower than this stay inside one frame
const SCALE = 2               // downsample factor
const PAD = 2                 // transparent px left/right/below each frame (pre-scale); none
                              // above — the row labels sit right on top of the idle band

if (!fs.existsSync(SRC)) { console.log(`serpent sheet not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const at = (x, y) => (y * src.width + x) * 4
const bgDist = (x, y) => {
  const i = at(x, y)
  return Math.abs(src.pixels[i] - BG[0]) + Math.abs(src.pixels[i + 1] - BG[1]) + Math.abs(src.pixels[i + 2] - BG[2])
}
const isBg = (x, y) => bgDist(x, y) < KEY_TOL
// Frame finding ignores near-backdrop noise between frames (it would bridge
// neighbouring frames into one band); only clearly-drawn pixels count.
const isArt = (x, y) => bgDist(x, y) >= SPECK_TOL

// Frame column bands per row: runs of columns holding non-backdrop pixels,
// merged across gaps narrower than MIN_GAP (splash droplets, fin tips).
function frameBands(row) {
  const bands = []
  let start = -1
  for (let x = 0; x <= src.width; x++) {
    let hits = 0
    if (x < src.width) for (let y = row.y0; y < row.y1; y++) if (isArt(x, y)) hits++
    if (hits > 1 && start < 0) start = x
    if (hits <= 1 && start >= 0) { bands.push([start, x]); start = -1 }
  }
  const merged = []
  for (const b of bands) {
    if (merged.length && b[0] - merged[merged.length - 1][1] < MIN_GAP) merged[merged.length - 1][1] = b[1]
    else merged.push(b)
  }
  return merged
}

// Crop one frame with PAD and key the backdrop: flood fill from the border so
// only backdrop connected to the outside goes transparent.
function cropKeyed(x0, x1, y0, y1) {
  const w = x1 - x0 + 2 * PAD, h = y1 - y0 + PAD
  const out = new Uint8Array(w * h * 4)
  const bg = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 - PAD + x, sy = y0 + y
    const inside = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height
    const o = (y * w + x) * 4
    if (inside) out.set(src.pixels.subarray(at(sx, sy), at(sx, sy) + 4), o)
    bg[y * w + x] = !inside || isBg(sx, sy) ? 1 : 0
  }
  const clear = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x) }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1) }
  while (stack.length) {
    const i = stack.pop()
    if (clear[i] || !bg[i]) continue
    clear[i] = 1
    const x = i % w, y = (i - x) / w
    if (x > 0) stack.push(i - 1)
    if (x < w - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - w)
    if (y < h - 1) stack.push(i + w)
  }
  for (let i = 0; i < w * h; i++) if (clear[i]) out[i * 4 + 3] = 0
  dropSpecks(out, w, h)
  return { w, h, rgba: out }
}

// Backdrop noise the tight key leaves behind: small islands of opaque pixels
// that are all near-backdrop dark. Real art never forms such islands (spray
// droplets are bright), so they go transparent. Anything touching a bright
// pixel is kept whole.
function dropSpecks(rgba, w, h) {
  const seen = new Uint8Array(w * h)
  const dark = i => rgba[i * 4 + 3] > 0 &&
    Math.abs(rgba[i * 4] - BG[0]) + Math.abs(rgba[i * 4 + 1] - BG[1]) + Math.abs(rgba[i * 4 + 2] - BG[2]) < SPECK_TOL
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || rgba[s * 4 + 3] === 0) continue
    const comp = [], stack = [s]
    let allDark = true
    seen[s] = 1
    while (stack.length) {
      const i = stack.pop()
      comp.push(i)
      if (!dark(i)) allDark = false
      const x = i % w, y = (i - x) / w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || seen[j] || rgba[j * 4 + 3] === 0) continue
        seen[j] = 1; stack.push(j)
      }
    }
    if (allDark && comp.length <= SPECK_MAX) for (const i of comp) rgba[i * 4 + 3] = 0
  }
}

const rows = ROWS.map(row => ({ ...row, frames: frameBands(row).map(([x0, x1]) => downsample(cropKeyed(x0, x1, row.y0, row.y1), SCALE)) }))
const { sheetW, sheetH } = writeSheet({
  outPng: OUT_PNG, outMeta: OUT_META, rows, align: 'bottom',
  source: 'tools/extract-serpent-sheet.mjs from assets/serpent.png',
  note: 'Half the concept sheet\'s resolution.',
})
for (const r of rows) console.log(r.name, r.frames.length, 'frames', r.frames.map(f => `${f.w}x${f.h}`).join(' '))
console.log('wrote', path.relative(process.cwd(), OUT_PNG), `${sheetW}x${sheetH}`, 'and', path.relative(process.cwd(), OUT_META))
