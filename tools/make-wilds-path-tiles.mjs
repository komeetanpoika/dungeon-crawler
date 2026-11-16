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
// ow_pier_deck_<b>_<lie><piece>: a deck cell at the outer corner of a step,
// that corner cut away along a slant and a beam laid on the slant; the water
// under it shows through. ow_prop_fillet_<lie>_<piece>: the timber in the
// inner corner of the step, drawn on the water cell there, see-through but
// for the wedge. lie and piece as in bridge-art.js: the slant falls 8 px
// over the cell (c), or cuts the corner at 45 degrees (d).
//
// ow_path_sand_<n>: a path over sand, which is ow_dirt_<n> with its tufts of
// grass turned to drifts of sand (ow_sand_0's two tones).
//
//   node tools/make-wilds-path-tiles.mjs
import { writePng } from './png-write.mjs'
import { DECK_SKINS, deckSkin, deckHasPost, SLANT_LIES, DECK_CUT_SKINS, FILLET_SKINS, deckCutSkin, filletSkin } from '../renderer/wilds/bridge-art.js'

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

function deckGrid(boards, mask, post) {
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
  return g
}
// (a blank in the grid is see-through)
const paint = g => {
  const rgba = new Uint8Array(T * T * 4)
  g.forEach((line, y) => line.forEach((ch, x) => { if (ch !== ' ') rgba.set([...INK[ch], 255], (y * T + x) * 4) }))
  return rgba
}
const deck = (boards, mask, post) => paint(deckGrid(boards, mask, post))

// The slanted edges. A beam from its outer edge inward, by the side the
// water is on: the edge beams above, laid along a slant.
const BEAM = { n: 'klmd', s: 'ikml', w: 'kld', e: 'kld' }
const FACING = { n: 's', s: 'n', w: 'e', e: 'w' }
const BIT = { n: N, e: E, s: S, w: W }
// A pixel as (u, d): u px along the slanted edge from the corner's end, d px
// into the cell from its side `side`.
const place = (lie, side, x, y) => ({
  u: 'ns'.includes(lie[0]) ? (lie[1] === 'w' ? x : T - 1 - x) : (lie[1] === 'n' ? y : T - 1 - y),
  d: side === 'n' ? y : side === 's' ? T - 1 - y : side === 'w' ? x : T - 1 - x,
})
// How far the slant stands off the grid line, u px from the corner: 8 px at
// the corner. A cut rounds up and a fillet down: where they differ by a
// pixel it is the water that shows.
const reach = (piece, u, cut) => {
  const t = piece === 'c' ? 8 * (1 - (u + 0.5) / T) : Math.max(0, 8 - u - 0.5)
  return cut ? Math.ceil(t) : Math.floor(t)
}
// The deck cell: the deck is on the lie's side of the edge, so the edge is
// the cell's far side, open like the side at the corner's end.
function cutDeck(boards, lie, piece) {
  const open = FACING[lie[0]]
  const g = deckGrid(boards, BIT[open] | BIT[lie[1]], false)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const { u, d } = place(lie, open, x, y), c = reach(piece, u, true)
    if (c === 0) continue
    if (d < c) g[y][x] = ' '
    else if (d < c + BEAM[open].length) g[y][x] = BEAM[open][d - c]
  }
  return paint(g)
}
// The water cell: timber against the deck on the lie's side, its outer edge a beam's.
function fillet(lie, piece) {
  const beam = BEAM[FACING[lie[0]]]
  const g = Array.from({ length: T }, () => new Array(T).fill(' '))
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const { u, d } = place(lie, lie[0], x, y), t = reach(piece, u, false)
    if (d < t) g[y][x] = beam[t - 1 - d] ?? 'm'
  }
  return paint(g)
}

const dir = process.argv[2] ?? new URL('../renderer/assets/tiles/', import.meta.url).pathname
let n = 0
for (const boards of ['h', 'v']) for (let mask = 0; mask < 16; mask++) for (const post of deckHasPost(mask) ? [false, true] : [false]) {
  writePng(`${dir}/${deckSkin(boards, mask, post)}.png`, T, T, deck(boards, mask, post))
  n++
}
if (n !== DECK_SKINS.length) throw new Error(`drew ${n} tiles for ${DECK_SKINS.length} names`)
console.log(`wrote ${n} bridge deck tiles to ${dir}`)

const slanted = new Set()
for (const lie of SLANT_LIES) for (const piece of 'ns'.includes(lie[0]) ? ['c', 'd'] : ['c']) {
  for (const boards of ['h', 'v']) { writePng(`${dir}/${deckCutSkin(boards, lie, piece)}.png`, T, T, cutDeck(boards, lie, piece)); slanted.add(deckCutSkin(boards, lie, piece)) }
  writePng(`${dir}/${filletSkin(lie, piece)}.png`, T, T, fillet(lie, piece))
  slanted.add(filletSkin(lie, piece))
}
if ([...DECK_CUT_SKINS, ...FILLET_SKINS].some(name => !slanted.has(name)) || slanted.size !== DECK_CUT_SKINS.length + FILLET_SKINS.length) throw new Error('the slanted deck tiles drawn are not the ones named')
console.log(`wrote ${slanted.size} slanted deck and fillet tiles to ${dir}`)

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
