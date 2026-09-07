// Synthesise the grass-to-rock edge tiles for the Mountain Pass floor.
//
// Mountain ground (ow_mtn_ground_N, opaque gravel) meets the woods' grass in
// a hard tile-grid step. An edge tile is one mountain-ground tile whose open
// sides fray into grass_0: a noisy inset a few pixels deep along every side
// open to grass, a small nibble at every concave corner (a grass cell on the
// diagonal with both flanking sides still rock), and a sprinkle of gravel
// specks on the grass just past the fray. Ground only — collision, props and
// the cone lattice are untouched.
//
//   ow_mtn_edge_<M>_<D>_<V>   M = open-side mask 1 N / 2 E / 4 S / 8 W,
//                             D = concave-corner mask 1 NE / 2 SE / 4 SW / 8 NW
//                             (only corners whose flanking sides are closed),
//                             V = 0..2 picks the ground tile underneath.
//
// Deterministic (hash noise, no Math.random) so a rerun rewrites identical
// PNGs. Run from anywhere: node tools/synth-mountain-edges.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'
import { EDGE_SHAPES, EDGE_VARIANTS, edgeName } from './static-overworld/mountain.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.join(HERE, '../renderer/assets/tiles')
const T = 16
const DEPTH = 3.5       // mean fray depth in pixels along an open side
const NIBBLE = 3.5      // mean concave-corner nibble, in pixels of x+y
const SPECK = 0.22      // chance a grass pixel touching the fray turns to gravel
const SPECK_RGB = [112, 102, 92]

const hash = (a, b, c = 0) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return h >>> 0 }
const unit = (...k) => hash(...k) / 4294967296
// roughly normal: the mean of three uniforms, spread to the wanted sigma
const gauss = (mean, sigma, ...k) => mean + ((unit(...k, 1) + unit(...k, 2) + unit(...k, 3)) / 3 - 0.5) * sigma * Math.sqrt(12 / 3)

const grass = readPng(path.join(TILES, 'ow_grass_0.png'))
const px = (f, x, y) => f.pixels.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4)

function edgeTile(base, M, D, seed) {
  const out = new Uint8Array(grass.pixels)   // starts as grass
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))
  // one inset per pixel column/row of each open side, and one nibble per corner
  const prof = {}
  for (const [bit, s] of [[1, 'N'], [2, 'E'], [4, 'S'], [8, 'W']])
    prof[s] = Array.from({ length: T }, (_, i) => clamp(gauss(DEPTH, 1.3, seed, bit, i), 1, DEPTH + 3))
  const nib = {}
  for (const [bit, c] of [[1, 'NE'], [2, 'SE'], [4, 'SW'], [8, 'NW']])
    nib[c] = clamp(gauss(NIBBLE, 0.8, seed, 16 + bit, 0), 2, 6)
  const rock = new Uint8Array(T * T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let inside = true
    if (M & 1 && y < prof.N[x]) inside = false
    if (M & 4 && T - 1 - y < prof.S[x]) inside = false
    if (M & 8 && x < prof.W[y]) inside = false
    if (M & 2 && T - 1 - x < prof.E[y]) inside = false
    if (D & 1 && (T - 1 - x) + y < nib.NE) inside = false
    if (D & 2 && (T - 1 - x) + (T - 1 - y) < nib.SE) inside = false
    if (D & 4 && x + (T - 1 - y) < nib.SW) inside = false
    if (D & 8 && x + y < nib.NW) inside = false
    if (inside) { rock[y * T + x] = 1; out.set(px(base, x, y), (y * T + x) * 4) }
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (rock[y * T + x]) continue
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => rock[(y + dy) * T + (x + dx)] && x + dx >= 0 && x + dx < T && y + dy >= 0 && y + dy < T)
    if (touches && unit(seed, x, y) < SPECK) out.set([...SPECK_RGB, 255], (y * T + x) * 4)
  }
  return out
}

let n = 0
for (let v = 0; v < EDGE_VARIANTS; v++) {
  const base = readPng(path.join(TILES, `ow_mtn_ground_${v}.png`))
  for (const [M, D] of EDGE_SHAPES) {
    writePng(path.join(TILES, `${edgeName(M, D, v)}.png`), T, T, edgeTile(base, M, D, hash(M, D, v)))
    n++
  }
}
console.log(`wrote ${n} edge tiles to ${path.relative(process.cwd(), TILES)}`)
