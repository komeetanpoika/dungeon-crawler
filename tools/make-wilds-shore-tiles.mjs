// Draws the slanted shore tiles renderer/wilds/shore-art.js lays, into
// renderer/assets/tiles/.
//
// Every tile is a slice of one picture: the bank of the square rim tiles
// (ow_pond_10 and its kin: a strip of bank top, the brown waterline, a band
// of foam) sheared along a stretch of coast, a pixel at a time. `L` is where
// the bank top lies, in pixels from the grid line between land and water,
// positive into the water; a square rim has it at 0.
//   a fill   L runs 7..0 from the corner: land drawn on the water cell
//   a cut    L runs -8..-1 from the corner: water drawn on the land cell
// over 32 px for the long ramp (pieces a, b), 16 for the short one (c) and 8
// for the 45-degree corner (d; e is the fill that carries a cut's line on
// across its far half). Both round toward the water, so that where the two
// disagree by a pixel it is the water that shows.
//
//   <rim>_slope_<lie>_<piece>      a fill, per bank (ow_pond grass, ow_shore sand, ow_mud marsh dirt)
//   ow_bank_<ground>_<lie>_<piece> a cut, on that bank's own ground
//   ow_water_foam_<lie>_<piece>    the water cell under a cut: the foot of the bank, the same for every bank
//
// A double (pieces u and v, lying by one side) is two of those on one cell:
// land wherever either of two fills has land, water wherever either of two
// cuts has water. u is two 45-degree corners, the end of a pocket or a bump
// with the foam tile for the water off its tip; v the two short ramps down
// the sides of a spit's last cell.
//
// The land is the bank's plain ground (ow_grass_0, ow_sand_0, the dirt of
// ow_dirt_*), the water ow_water_0, so a tile sits flush with its neighbours.
//
//   node tools/make-wilds-shore-tiles.mjs
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'
import { FAMILIES, LIES, SIDES, SLOPE_SKINS, fillSkin, cutSkin, foamSkin } from '../renderer/wilds/shore-art.js'

const T = 16
const dir = process.argv[2] ?? new URL('../renderer/assets/tiles/', import.meta.url).pathname
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
// the rim tiles' own colours
const INK = { '#': hex('#8f673f'), o: hex('#c58f5c'), x: hex('#b48355'), '~': hex('#8ed4db') }
const WATER = hex('#63c5cf'), GLINT = INK['~']
const BANK_TOP = { grass: hex('#8dc435'), sand: hex('#e6dabf'), dirt: hex('#eaa56c') }
const px = (f, x, y) => [...f.pixels.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 3)]
const sand = readPng(`${dir}/ow_sand_0.png`), water = readPng(`${dir}/ow_water_0.png`)
const GROUND = {
  grass: () => hex('#84c669'),
  sand: (x, y) => px(sand, x, y),
  // (ow_dirt_* are 4-bit PNGs the reader does not parse, and each wears a tuft of grass: plain dirt)
  dirt: () => hex('#eaa56c'),
}
const isGlint = (x, y) => px(water, x, y).join() === GLINT.join()

// Where the bank top lies, `u` px along the stretch from the corner.
const lineOf = (kind, steps, piece) => u => {
  if (steps === 0) return kind === 'fill' ? (piece === 'd' && u >= 8 ? 0 : 7 - u) : u - 8
  const t = 8 * (1 - (u + 0.5) / (T * steps))
  return kind === 'fill' ? Math.floor(t) : Math.floor(-t)
}
// What is drawn `d` px on the water side of the bank top: the top itself, the
// waterline, and the foam. A bank that faces north shows a face under the line.
const BAND = { n: 'G#ox~~', s: 'G#o~~~', w: 'G#o~~~', e: 'G#o~~~' }

// How far past its bank top a pixel lies for one piece (under 0 is land), and
// the side that bank's land is on. `lie` as in shore-art.js; `index` is the
// cell along the stretch from the corner; `row` 'water' or 'land'.
function past({ kind, lie, steps, piece, index = 0, row }, x, y) {
  const [side, end] = lie
  // along the stretch from the corner, and across it from the grid line
  const along = side === 'n' || side === 's' ? x : y, across = side === 'n' || side === 's' ? y : x
  const u = index * T + (end === 'w' || end === 'n' ? along : T - 1 - along)
  const depth = side === 'n' || side === 'w' ? across : T - 1 - across
  return { d: (row === 'water' ? depth : depth - T) - lineOf(kind, steps, piece)(u), side }
}
// One tile: a piece, or `parts` for two on one cell. `ground` null draws no
// land at all (the foam tiles, which have none to draw).
function tile(spec) {
  const parts = spec.parts ?? [spec], fill = parts[0].kind === 'fill', { ground } = spec
  const rgba = new Uint8Array(T * T * 4)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let at = null
    for (const part of parts) {
      const p = past({ row: spec.row, ...part }, x, y)
      if (!at || (fill ? p.d < at.d : p.d > at.d)) at = p
    }
    const { d, side } = at
    let c
    if (d < 0) c = GROUND[ground]?.(x, y)
    else if (d < BAND[side].length) c = BAND[side][d] === 'G' ? BANK_TOP[ground] : INK[BAND[side][d]]
    else c = isGlint(x, y) ? GLINT : WATER
    if (!c) throw new Error(`${spec.name}: land where a foam tile has none`)
    rgba.set([...c, 255], (y * T + x) * 4)
  }
  return rgba
}

const PIECES = { a: [2, 0], b: [2, 1], c: [1, 0], d: [0, 0], e: [0, 0] }
const wrote = new Set()
const write = (name, spec) => { writePng(`${dir}/${name}.png`, T, T, tile({ name, ...spec })); wrote.add(name) }
for (const lie of LIES) for (const [piece, [steps, index]] of Object.entries(PIECES)) {
  if (steps === 0 && (lie[0] === 'w' || lie[0] === 'e')) continue
  for (const f of FAMILIES) {
    write(fillSkin(f.rim, lie, piece), { kind: 'fill', lie, steps, piece, index, row: 'water', ground: f.ground })
    if (piece !== 'e') write(cutSkin(f.ground, lie, piece), { kind: 'cut', lie, steps, piece, index, row: 'land', ground: f.ground })
  }
  if (piece === 'b' || piece === 'c') write(foamSkin(lie, piece), { kind: 'cut', lie, steps, piece, index, row: 'water', ground: null })
}
// the doubles, by the side their single-tile edge is on
const FACING = { n: 's', s: 'n', w: 'e', e: 'w' }
for (const side of SIDES) {
  const ends = 'ns'.includes(side) ? ['w', 'e'] : ['n', 's']
  // a pocket's end: a 45-degree fill in each corner against its end wall
  const pocket = ends.map(end => ({ kind: 'fill', lie: side + end, steps: 0, piece: 'e' }))
  // a bump: a 45-degree cut off each corner of its tip, the land being behind it
  const bump = ends.map(end => ({ kind: 'cut', lie: FACING[side] + end, steps: 0, piece: 'd' }))
  // a spit's end: a short ramp down each side to the tip
  const spit = ends.map(end => ({ kind: 'cut', lie: FACING[end] + side, steps: 1, piece: 'c' }))
  for (const f of FAMILIES) {
    write(fillSkin(f.rim, side, 'u'), { parts: pocket, row: 'water', ground: f.ground })
    write(cutSkin(f.ground, side, 'u'), { parts: bump, row: 'land', ground: f.ground })
    write(cutSkin(f.ground, side, 'v'), { parts: spit, row: 'land', ground: f.ground })
  }
  write(foamSkin(side, 'u'), { parts: bump, row: 'water', ground: null })
}
const missing = SLOPE_SKINS.filter(n => !wrote.has(n))
if (missing.length || wrote.size !== SLOPE_SKINS.length) throw new Error(`drew ${wrote.size} tiles for ${SLOPE_SKINS.length} names; missing ${missing.join(' ')}`)
console.log(`wrote ${wrote.size} shore slope tiles to ${dir}`)
