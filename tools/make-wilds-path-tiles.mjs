// Draws the art of the Wilds' paths into renderer/assets/tiles/.
//
// ow_pier_deck_<b>_<m>[p]: the plank decks renderer/wilds/bridge-art.js lays
// over the water.
//   b  how the planks lie: h east-west, v north-south
//   m  the sides with no deck beside them (1 N / 2 E / 4 S / 8 W): each gets
//      an edge beam, the south one the deck's shaded face as well, and two
//      that meet get a post in the corner
//   p  a post in the middle of a straight edge
// The browns are the pier logs' (ow_pier_log), with two darker ones for the
// beams and posts so a deck holds its shape against water and sand alike.
//
// ow_path_sand_<n>: a path over sand, which is ow_dirt_<n> with its tufts of
// grass turned to drifts of sand (ow_sand_0's two tones).
//
//   node tools/make-wilds-path-tiles.mjs
import { writePng } from './png-write.mjs'
import { DECK_SKINS, deckSkin, deckHasPost } from '../renderer/wilds/bridge-art.js'

const T = 16
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const INK = {
  l: hex('#c8a480'), m: hex('#b98b5e'), d: hex('#8f673f'),   // light, plank, seam: the pier logs' three
  k: hex('#6d4a2f'), i: hex('#4a3122'),                      // beam shade, post outline
}
const N = 1, E = 2, S = 4, W = 8

// Planks lying east-west, four to a tile; each second one has a butt joint.
const JOINT = [5, -1, 11, -1]
const plank = (x, y, joints) => {
  const r = y % 4, board = y >> 2
  if (r === 3) return 'd'
  if (joints && x === JOINT[board]) return 'd'
  return r === 0 ? 'l' : 'm'
}
const POST = ['iiii', 'ilmi', 'immi', 'iiii']

function deck(boards, mask, post) {
  // a deck one plank wide, beamed on both sides of its planks: each plank is
  // one short board from beam to beam, with no joint in it
  const joints = !(boards === 'h' ? (mask & E) && (mask & W) : (mask & N) && (mask & S))
  const g = Array.from({ length: T }, (_, y) => Array.from({ length: T }, (_, x) => boards === 'h' ? plank(x, y, joints) : plank(y, x, joints)))
  const row = (y, ch) => { for (let x = 0; x < T; x++) g[y][x] = ch }
  const col = (x, ch) => { for (let y = 0; y < T; y++) g[y][x] = ch }
  const stamp = (x0, y0) => POST.forEach((line, dy) => [...line].forEach((ch, dx) => { g[y0 + dy][x0 + dx] = ch }))
  // beams: the side ones first, so the north and south ones run over their ends
  if (mask & W) { col(0, 'k'); col(1, 'l'); col(2, 'd') }
  if (mask & E) { col(T - 3, 'd'); col(T - 2, 'l'); col(T - 1, 'k') }
  if (mask & N) { row(0, 'k'); row(1, 'l'); row(2, 'm'); row(3, 'd') }
  // the south edge shows the deck's thickness
  if (mask & S) { row(T - 4, 'l'); row(T - 3, 'm'); row(T - 2, 'k'); row(T - 1, 'i') }
  if ((mask & N) && (mask & W)) stamp(0, 0)
  if ((mask & N) && (mask & E)) stamp(T - 4, 0)
  if ((mask & S) && (mask & W)) stamp(0, T - 4)
  if ((mask & S) && (mask & E)) stamp(T - 4, T - 4)
  if (post) {
    if (mask & W) stamp(0, 6)
    if (mask & E) stamp(T - 4, 6)
    if (mask & N) stamp(6, 0)
    if (mask & S) stamp(6, T - 4)
  }
  const rgba = new Uint8Array(T * T * 4)
  g.forEach((line, y) => line.forEach((ch, x) => rgba.set([...INK[ch], 255], (y * T + x) * 4)))
  return rgba
}

const dir = process.argv[2] ?? new URL('../renderer/assets/tiles/', import.meta.url).pathname
let n = 0
for (const boards of ['h', 'v']) for (let mask = 0; mask < 16; mask++) for (const post of deckHasPost(mask) ? [false, true] : [false]) {
  writePng(`${dir}/${deckSkin(boards, mask, post)}.png`, T, T, deck(boards, mask, post))
  n++
}
if (n !== DECK_SKINS.length) throw new Error(`drew ${n} tiles for ${DECK_SKINS.length} names`)
console.log(`wrote ${n} bridge deck tiles to ${dir}`)

// ow_dirt_0..3 transcribed (they are 4-bit PNGs our reader does not parse):
// a dirt, e its dark specks, c its light ones, and the tuft b/d, which is
// grass there and sand here.
const DIRT = { a: hex('#eaa56c'), e: hex('#cf8254'), c: hex('#fec99c'), b: hex('#e6dabf'), d: hex('#d9caa9') }
const blank = n => Array.from({ length: n }, () => 'aaaaaaaaaaaaaaaa')
const SAND_PATHS = [
  ['aaaaaaaaaaaaabbb', 'aaaaaaaaaccabbbb', 'aaaaaaaaaccabbbd', 'aaaaaaaaaeeaddda', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaeaaa', ...blank(10)],
  [...blank(9), 'aaaaaaaaaaaaeeaa', 'aaaaaaaaaaaaeeaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaeabbba', 'aaaaaaaaaaaabbbb', 'aaaaaaaaaaaadbbb', 'aaaaaaaaaaaaabbb'],
  ['bbbaaaaaaaaaaaaa', 'bbbbaaaaaaaaaaaa', 'dbbbaaaaaaaaaaaa', 'adddaeaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaeeaaaaaaaaaaaa', 'aaeeaaaaaaaaaaaa', ...blank(9)],
  [...blank(10), 'aaaeaaaaaaaaaaaa', 'aaaaaccaaaaaaaaa', 'abbbaccaaaaaaaaa', 'bbbbaeeaaaaaaaaa', 'bbbdaaaaaaaaaaaa', 'bbbaaaaaaaaaaaaa'],
]
SAND_PATHS.forEach((rows, i) => {
  const rgba = new Uint8Array(T * T * 4)
  rows.forEach((line, y) => [...line].forEach((ch, x) => rgba.set([...DIRT[ch], 255], (y * T + x) * 4)))
  writePng(`${dir}/ow_path_sand_${i}.png`, T, T, rgba)
})
console.log(`wrote 4 sand path tiles to ${dir}`)
