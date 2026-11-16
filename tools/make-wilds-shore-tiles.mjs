// Draws the shore tiles renderer/wilds/shore-art.js lays, into
// renderer/assets/tiles/.
//
// Every tile is a slice of one picture: the bank of the square rim tiles
// (ow_pond_10 and its kin: a strip of bank top, the brown waterline, a band
// of foam) following a line. `L` is where the bank top lies along one side
// of a cell, in pixels from the grid line between land and water, positive
// into the water; a square rim has it at 0 and 1 by turns.
//   a fill   L runs 7..0 from the corner: land drawn on the water cell
//   a cut    L runs -8..-1 from the corner: water drawn on the land cell
// over 32 px for the long ramp, 16 for the short one and 8 for the 45-degree
// corner. Both round toward the water, so that where the two disagree by a
// pixel it is the water that shows.
//
// A water cell's tile is drawn from its name alone (shoreSkin in
// shore-art.js): the line along each of its four sides, and the corners a
// bank comes round. A pixel is as far past the bank as the nearest of those
// has it, so a line that reaches a border at some height is taken up at that
// height by any tile whose name has the same bank on that border, and no
// name can leave land bare against water.
//
//   <rim>_k_<sides>_<corners>      a water cell with land of its own (ow_pond grass, ow_shore sand, ow_mud marsh dirt)
//   ow_water_k_<sides>_<corners>   one that shows only the feet of banks: the same for every bank
//   ow_bank_<ground>_<lie>_<piece> a cut, on that bank's own ground; u and v
//                                  are two cuts on one cell, a bump and the
//                                  last cell of a spit
//
// The land is the bank's plain ground (ow_grass_0, ow_sand_0, the dirt of
// ow_dirt_*), the water ow_water_0, so a tile sits flush with its neighbours.
//
//   node tools/make-wilds-shore-tiles.mjs
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'
import { FAMILIES, LIES, SIDES, SLOPE_SKINS, SHORE_SKINS, cutSkin, shoreOf } from '../renderer/wilds/shore-art.js'

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

// The cuts. How far past its bank top a pixel lies for one piece (under 0 is
// land), and the side that bank's land is on. `lie` as in shore-art.js; `index` is the
// cell along the stretch from the corner; `row` 'water' or 'land'.
function past({ kind, lie, steps, piece, index = 0, row }, x, y) {
  const [side, end] = lie
  // along the stretch from the corner, and across it from the grid line
  const along = side === 'n' || side === 's' ? x : y, across = side === 'n' || side === 's' ? y : x
  const u = index * T + (end === 'w' || end === 'n' ? along : T - 1 - along)
  const depth = side === 'n' || side === 'w' ? across : T - 1 - across
  return { d: (row === 'water' ? depth : depth - T) - lineOf(kind, steps, piece)(u), side }
}
// One tile: a piece, or `parts` for two on one cell.
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

// A water cell. Where the bank top lies `t` px along a side, by the side's
// letter; the letters whose corner is at the side's end are the mirrors.
const MIRROR = { p: 'a', q: 'b', r: 'c', s: 'd', t: 'e', i: 'g', j: 'h' }
const LINE = {
  a: u => Math.floor(8 * (1 - (u + 0.5) / 32)),
  b: u => Math.floor(8 * (1 - (u + 16.5) / 32)),
  c: u => Math.floor(8 * (1 - (u + 0.5) / 16)),
  d: u => (u >= 8 ? 0 : 7 - u),
  e: u => 7 - u,
  u: u => Math.max(7 - u, u - 8),
  g: u => Math.floor(-8 * (1 - (u + 16.5) / 32)),
  h: u => Math.floor(-8 * (1 - (u + 0.5) / 16)),
  m: u => Math.min(u - 8, 7 - u),
}
const SIDE_OF = 'nesw'
function shoreTile(name) {
  const { rim, sides, tips } = shoreOf(name)
  const ground = FAMILIES.find(f => f.rim === rim)?.ground
  const rgba = new Uint8Array(T * T * 4)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    // the nearest bank: how far past it the pixel is, its band, and whether it is the square bank's doubled top
    let d = 99, band = null, top = false
    for (let k = 0; k < 4; k++) {
      const ch = sides[k]
      if (ch === 'o') continue
      const t = k % 2 ? y : x, depth = [y, T - 1 - x, T - 1 - y, x][k]
      // the square bank's top is one pixel and two by turns, as lib.js's rims have it
      const at = ch === 'l' ? depth - (t % 8 < 4 ? 1 : 0) : depth - LINE[MIRROR[ch] ?? ch](MIRROR[ch] ? T - 1 - t : t)
      if (at < d) { d = at; band = BAND[SIDE_OF[k]]; top = ch === 'l' }
    }
    // land at a corner alone: its bank comes round, a quarter circle with no top of its own
    for (const [bit, cx, cy] of [[1, 0, 0], [2, T, 0], [4, T, T], [8, 0, T]]) {
      if (!(tips & bit)) continue
      const at = Math.max(1, Math.ceil(Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) - 1)
      if (at < d) { d = at; band = BAND.s; top = false }
    }
    let c
    if (d < 0 && !top) c = GROUND[ground]?.(x, y)
    else if (d < 0) c = BANK_TOP[ground]
    else if (band && d < band.length) c = band[d] === 'G' ? BANK_TOP[ground] : INK[band[d]]
    else c = isGlint(x, y) ? GLINT : WATER
    if (!c) throw new Error(`${name}: land on a tile that is no bank's`)
    rgba.set([...c, 255], (y * T + x) * 4)
  }
  return rgba
}

const PIECES = { a: [2, 0], b: [2, 1], c: [1, 0], d: [0, 0] }
const wrote = new Set()
const write = (name, spec) => { writePng(`${dir}/${name}.png`, T, T, tile({ name, ...spec })); wrote.add(name) }
for (const lie of LIES) for (const [piece, [steps, index]] of Object.entries(PIECES)) {
  if (steps === 0 && (lie[0] === 'w' || lie[0] === 'e')) continue
  for (const f of FAMILIES) write(cutSkin(f.ground, lie, piece), { kind: 'cut', lie, steps, piece, index, row: 'land', ground: f.ground })
}
// the doubles, by the side their single-tile edge is on
const FACING = { n: 's', s: 'n', w: 'e', e: 'w' }
for (const side of SIDES) {
  const ends = 'ns'.includes(side) ? ['w', 'e'] : ['n', 's']
  // a bump: a 45-degree cut off each corner of its tip, the land being behind it
  const bump = ends.map(end => ({ kind: 'cut', lie: FACING[side] + end, steps: 0, piece: 'd' }))
  // a spit's end: a short ramp down each side to the tip
  const spit = ends.map(end => ({ kind: 'cut', lie: FACING[end] + side, steps: 1, piece: 'c' }))
  for (const f of FAMILIES) {
    write(cutSkin(f.ground, side, 'u'), { parts: bump, row: 'land', ground: f.ground })
    write(cutSkin(f.ground, side, 'v'), { parts: spit, row: 'land', ground: f.ground })
  }
}
for (const name of SHORE_SKINS) { writePng(`${dir}/${name}.png`, T, T, shoreTile(name)); wrote.add(name) }
const missing = SLOPE_SKINS.filter(n => !wrote.has(n))
if (missing.length || wrote.size !== SLOPE_SKINS.length) throw new Error(`drew ${wrote.size} tiles for ${SLOPE_SKINS.length} names; missing ${missing.join(' ')}`)
console.log(`wrote ${wrote.size} shore tiles to ${dir}`)
