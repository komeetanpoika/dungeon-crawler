// Turn the mountain-pass concept sheet (assets/mountain pass.png — an opaque
// RGB mockup on a near-black backdrop: two rows of cliff-edge tiles, two rows
// of mountain-peak / scree fills, one row of floor tiles, then an example
// strip) into the game's 16x16 overworld tiles under renderer/assets/tiles/
// with an ow_mtn_ prefix. The sheet is drawn at ~106 px per cell and is not
// true pixel art (single-pixel noise, no block grid), so every cell is
// area-averaged down to 16x16 rather than sampled.
//
// The cliff-edge tiles are organic ridge lines, not a blob autotile. They are
// sorted here by hand into the ridge shapes the map generator's rim pass
// (tools/static-overworld/mountain.mjs) needs: a ridge running left-right
// (h), top-bottom (v), and the four turns named by the two sides the ridge
// leaves through (tl, tr, lb, br). Turns the sheet lacks are mirrored from
// the ones it has — the peaks are lit from above, so a horizontal flip keeps
// the light right. The remaining cells (two diagonals each way and a narrow
// two-ridge pass) come out as spares for the editor.
// Usage: node tools/extract-mountain-tiles.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '../assets/mountain pass.png')
const OUT_DIR = path.join(HERE, '../renderer/assets/tiles')
const T = 16
const BG = [24, 25, 30]      // backdrop
const BG_TOL = 40            // |dr|+|dg|+|db| below this is backdrop
const MIN_CELL = 60          // a run of art shorter than this is a label, not a cell

// Sheet layout: cell index = row * 10 + column for the five tile rows.
// Edge rows are 0-1, peak/scree rows 2-3, the floor row 4.
export const EDGE_SHAPES = {
  h: [2, 7, 8, 15, 16, 17],
  v: [6, 11, 13, 14],
  tl: [19], tr: [5, 12], lb: [4, 18],
}
// Mirrored turns: a horizontal flip swaps left and right in the ridge exits.
const FLIPS = { tl: ['tr'], tr: ['tl'], br: ['lb'] }
const SPARES = { diag: [0, 3, 9, 10], pass: [1] }

if (!fs.existsSync(SRC)) { console.log(`mountain sheet not found at ${SRC}`); process.exit(0) }
const src = readPng(SRC)
const isArt = (x, y) => {
  const i = (y * src.width + x) * 4
  return Math.abs(src.pixels[i] - BG[0]) + Math.abs(src.pixels[i + 1] - BG[1]) + Math.abs(src.pixels[i + 2] - BG[2]) > BG_TOL
}

// Runs of indices where `on(i)` holds, keeping those at least MIN_CELL long.
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

// Row bands come from a strip down the first column of cells; each band's
// column runs then give the cells. The example strip is one wide run and is
// skipped by taking the first five bands only.
const rowBands = runs(src.height, y => { for (let x = 30; x < 120; x += 3) if (isArt(x, y)) return true; return false }).slice(0, 5)
export const cells = rowBands.flatMap(([y0, y1]) =>
  runs(src.width, x => { for (let y = y0; y <= y1; y += 4) if (isArt(x, y)) return true; return false })
    .map(([x0, x1]) => ({ x0, y0, x1, y1 })))
if (cells.length !== 50) throw new Error(`expected 50 cells, found ${cells.length}`)

// Area-average a source box down to TxT: each output pixel averages every
// source pixel whose centre falls inside its (fractional) box.
function resample({ x0, y0, x1, y1 }, flip = false) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const out = new Uint8Array(T * T * 4)
  for (let Y = 0; Y < T; Y++) for (let X = 0; X < T; X++) {
    const sx0 = x0 + Math.floor(X * w / T), sx1 = x0 + Math.floor((X + 1) * w / T)
    const sy0 = y0 + Math.floor(Y * h / T), sy1 = y0 + Math.floor((Y + 1) * h / T)
    let r = 0, g = 0, b = 0, n = 0
    for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
      const i = (y * src.width + x) * 4
      r += src.pixels[i]; g += src.pixels[i + 1]; b += src.pixels[i + 2]; n++
    }
    const o = (Y * T + (flip ? T - 1 - X : X)) * 4
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255
  }
  return out
}

const written = []
const emit = (name, cell, flip) => { writePng(path.join(OUT_DIR, `${name}.png`), T, T, resample(cells[cell], flip)); written.push(name) }

for (const [shape, idx] of Object.entries(EDGE_SHAPES)) idx.forEach((cell, i) => emit(`ow_mtn_edge_${shape}_${i}`, cell, false))
for (const [shape, from] of Object.entries(FLIPS)) {
  let i = EDGE_SHAPES[shape]?.length ?? 0
  for (const f of from) for (const cell of EDGE_SHAPES[f]) emit(`ow_mtn_edge_${shape}_${i++}`, cell, true)
}
for (const [shape, idx] of Object.entries(SPARES)) idx.forEach((cell, i) => emit(`ow_mtn_edge_${shape}_${i}`, cell, false))
for (let i = 0; i < 17; i++) emit(`ow_mtn_peak_${i}`, 20 + i, false)
for (let i = 0; i < 3; i++) emit(`ow_mtn_scree_${i}`, 37 + i, false)
for (let i = 0; i < 10; i++) emit(`ow_mtn_floor_${i}`, 40 + i, false)

console.log(`wrote ${written.length} tiles -> ${OUT_DIR}`)
