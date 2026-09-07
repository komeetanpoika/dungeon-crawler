// Synthesise the ground edge tiles: one material frayed into the ground
// beside it. Two sets today —
//   ow_mtn_edge_M_D_V   mountain floor (ow_mtn_ground_V gravel) into grass
//   ow_sand_edge_M_D_V  beach sand (ow_sand_0) into grass
// Shapes are edges.mjs's: M = open-side mask 1 N / 2 E / 4 S / 8 W, D =
// concave-corner mask 1 NE / 2 SE / 4 SW / 8 NW (only corners whose flanking
// sides are closed), V = variant. An edge tile is the material over grass_0
// with a noisy inset a few pixels deep along every open side, a small nibble
// at every concave corner, and a sprinkle of specks on the grass just past
// the fray. Ground only — collision, props and everything on the prop layer
// are untouched.
//
// Deterministic (hash noise, no Math.random) so a rerun rewrites identical
// PNGs. Run from anywhere: node tools/synth-ground-edges.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'
import { EDGE_SHAPES, hash } from './static-overworld/edges.mjs'
import { EDGE_VARIANTS, edgeName } from './static-overworld/mountain.mjs'
import { SAND_EDGE_VARIANTS, sandEdgeName } from './static-overworld/beach.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.join(HERE, '../renderer/assets/tiles')
const T = 16
const DEPTH = 4         // mean fray depth in pixels along an open side
const NIBBLE = 3.5      // mean concave-corner nibble, in pixels of x+y
const SPECK = 0.22      // chance a grass pixel touching the fray turns to a speck

const unit = (...k) => hash(...k) / 4294967296
// roughly normal: the mean of three uniforms (sd 1/6) scaled to sigma
const gauss = (mean, sigma, ...k) => mean + ((unit(...k, 1) + unit(...k, 2) + unit(...k, 3)) / 3 - 0.5) * sigma * 6

const grass = readPng(path.join(TILES, 'ow_grass_0.png'))
const px = (f, x, y) => f.pixels.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4)

function edgeTile(base, M, D, seed, speckRgb) {
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
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      x + dx >= 0 && x + dx < T && y + dy >= 0 && y + dy < T && rock[(y + dy) * T + (x + dx)])
    if (touches && unit(seed, x, y) < SPECK) out.set([...speckRgb, 255], (y * T + x) * 4)
  }
  return out
}

// the darkest colour in a tile, for the specks the fray scatters onto the grass
const darkest = f => {
  let best = null, lum = Infinity
  for (let i = 0; i < f.pixels.length; i += 4) {
    const l = f.pixels[i] * 0.299 + f.pixels[i + 1] * 0.587 + f.pixels[i + 2] * 0.114
    if (l < lum) { lum = l; best = [f.pixels[i], f.pixels[i + 1], f.pixels[i + 2]] }
  }
  return best
}

const SETS = [
  // mountain floor: each variant is its own gravel tile, specks a mid gravel grey
  { variants: EDGE_VARIANTS, name: edgeName, base: v => readPng(path.join(TILES, `ow_mtn_ground_${v}.png`)), speck: () => [112, 102, 92], seed: (M, D, v) => hash(M, D, v) },
  // beach: one sand tile, the variants differ by their fray; specks the sand's own dark grain
  { variants: SAND_EDGE_VARIANTS, name: sandEdgeName, base: () => readPng(path.join(TILES, 'ow_sand_0.png')), speck: darkest, seed: (M, D, v) => hash(M, D, 100 + v) },
]
let n = 0
for (const set of SETS) for (let v = 0; v < set.variants; v++) {
  const base = set.base(v)
  for (const [M, D] of EDGE_SHAPES) {
    writePng(path.join(TILES, `${set.name(M, D, v)}.png`), T, T, edgeTile(base, M, D, set.seed(M, D, v), set.speck(base)))
    n++
  }
}
console.log(`wrote ${n} edge tiles to ${path.relative(process.cwd(), TILES)}`)
