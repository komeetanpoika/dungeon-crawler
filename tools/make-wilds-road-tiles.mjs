// Draws the road's own ground into renderer/assets/tiles/: ow_road_<ground>_<n>,
// four tiles for each of the four grounds a road crosses in the Wilds
// (renderer/wilds/terrain.js roadGround picks them):
//   grass  packed earth, paler and less orange than a trail's ow_dirt_*, grey
//          stones pressed into it and a wheel rut here and there
//   sand   the same, darker than the sand round it, with drifts of sand
//   mtn    a pale gravel track that shows on the dark mountain floor
//   marsh  a grey gravel causeway that shows on the orange mud and the grass
// The four tiles share one set of pixel maps, each ground with its palette;
// every map keeps its stones and ruts off the outer pixel and has the plain
// ground colour along all four edges, so any of them tiles with any other
// in both directions without a seam.
//
// Then the verges (renderer/wilds/road-art.js): ow_deco_road_<ground>_<M>_<D>_<V>,
// what a road wears off onto a cell beside it, see-through but for the
// road's own ground and specks, laid as a deco over whatever that cell is.
// See the verge section below for how one is drawn, and where it reaches
// its border on purpose.
//
// Last, ow_prop_milestone: a squat stone post with a rounded head and a
// carved mark, on a plinth, see-through round it, that stands beside the road
// (renderer/wilds/features.js milestones). The Kenney packs' standing stones
// are gravestones.
//
//   node tools/make-wilds-road-tiles.mjs
import { writePng } from './png-write.mjs'
import { EDGE_SHAPES } from '../renderer/terrain/edges.js'
import { ROAD_SETS, VERGE_VARIANTS, vergeSkin } from '../renderer/wilds/road-art.js'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function tile(name, rows, palette) {
  if (rows.length !== 16 || rows.some(r => r.length !== 16)) throw new Error(`${name}: not 16x16`)
  if (/[^.]/.test(rows[0] + rows[15] + rows.map(r => r[0] + r[15]).join(''))) throw new Error(`${name}: something on the edge`)
  const rgba = new Uint8Array(16 * 16 * 4)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!palette[ch]) throw new Error(`${name}: no colour for "${ch}"`)
    rgba.set([...hex(palette[ch]), 255], (y * 16 + x) * 4)
  }))
  const out = new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
  writePng(out, 16, 16, rgba)
  console.log(`wrote ${out}`)
}

// . ground   , a paler fleck   : a darker grain
// r a rut's shadow   u its worn lip
// h s k a stone: light, body, shade
// g G the ground's own touch (a tuft, a drift, grit, a damp patch)
const MAPS = [
  [
    '................',
    '...........:....',
    '................',
    '................',
    '.........rrrr...',
    '..hs.....uuuu...',
    '.hssk...........',
    '..kk............',
    '................',
    '.,..............',
    '.......g........',
    '......gG....hs..',
    '............sk..',
    '................',
    '..........,.....',
    '................',
  ],
  [
    '................',
    '................',
    '...hs...........',
    '...sk......r....',
    '...........ru...',
    '...........ru...',
    '...........ru...',
    '................',
    '................',
    '..:.............',
    '.......hs.......',
    '......hssk......',
    '.......kk.......',
    '.g..............',
    '.Gg........,....',
    '................',
  ],
  [
    '................',
    '........,.......',
    '.....s..........',
    '................',
    '.........hs.....',
    '.........sk.....',
    '................',
    '.............s..',
    '.hs.............',
    '.sk......:......',
    '............gg..',
    '............Gg..',
    '................',
    '.........hs.....',
    '.........sk.....',
    '................',
  ],
  [
    '................',
    '................',
    '..:.............',
    '................',
    '................',
    '................',
    '............,...',
    '................',
    '................',
    '................',
    '........hs......',
    '........sk...g..',
    '.............G..',
    '................',
    '................',
    '................',
  ],
]

const STONE = { h: '#e4e9f0', s: '#c0cbdc', k: '#8b9bb4' }   // Tiny Town's stone greys
const PALETTES = {
  grass: { '.': '#e1c598', ',': '#efdcb5', ':': '#c9a877', r: '#bd9866', u: '#f0e2c2', ...STONE, g: '#84c669', G: '#65a556' },
  sand: { '.': '#cdb184', ',': '#dcc59c', ':': '#b49568', r: '#a88a5e', u: '#dfcca8', ...STONE, g: '#e6dabf', G: '#d9caa9' },
  mtn: { '.': '#ab9f8c', ',': '#c2b7a3', ':': '#8c806e', r: '#857968', u: '#c8bda9', h: '#dfe4ec', s: '#b5bfcf', k: '#6f7d96', g: '#968a77', G: '#7f7363' },
  marsh: { '.': '#d3cbb2', ',': '#e2dcc8', ':': '#b6ad91', r: '#ada386', u: '#e6e0cd', ...STONE, g: '#65a556', G: '#b9ae8f' },
}

for (const [ground, palette] of Object.entries(PALETTES)) MAPS.forEach((rows, i) => tile(`ow_road_${ground}_${i}`, rows, palette))

// ---- the verges -------------------------------------------------------------
// One verge per shape (M the sides with road, 1 N / 2 E / 4 S / 8 W; D the
// corners with road alone, 1 NE / 2 SE / 4 SW / 8 NW), set and variant:
//   band     along each road side, the road's plain ground, as deep as a
//            ragged profile (1 to 6 px) that is exactly END px at both ends
//   corner   between two road sides, filled across to the cell's diagonal
//            (the line through its two other corners, wavering up to a
//            pixel and a half)
//   nibble   at a corner with road alone, a rounded patch END px along each
//            border
//   wear     past all that, specks of the road's colours and the odd stone,
//            thinning out over six pixels; the band's own edge is broken by
//            a few missing pixels, its inside grained like the road
//   mud      (marsh only) a ragged band of wet mud just past the gravel,
//            darkest against it
// The outer pixel. The band is what must join: on a road side it runs along
// the whole border (the road's own edge is its plain ground, so the two meet
// without a seam); on any other side it lies only in the END px where a band
// or a nibble meets that border, the same END px in every tile, so the
// neighbour that carries the band on along the road, or the nibble round
// its end, meets it pixel for pixel. The wear runs up to the border on
// purpose: it only lies within six pixels of the gravel, so the border it
// reaches is one shared with the next verge along the road (or round a
// nibble), which carries its own wear on; held off the border, it left a
// bare stripe at every seam. The check below holds every tile to that.
const END = 3
const T = 16
// a number in [0, 1) from the arguments: the same tile every run
const unit = (...k) => {
  let h = 0x811c9dc5
  for (const v of k) { h = Math.imul(h ^ (v | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12 }
  return (h >>> 0) / 4294967296
}
const VERGE = {
  grass: { band: '#e1c598', fleck: '#efdcb5', grain: '#c9a877', stone: ['#c0cbdc', '#8b9bb4'], speck: 0.36 },
  sand: { band: '#cdb184', fleck: '#dcc59c', grain: '#b49568', stone: ['#c0cbdc', '#8b9bb4'], speck: 0.42 },
  mtn: { band: '#ab9f8c', fleck: '#c2b7a3', grain: '#8c806e', stone: ['#b5bfcf', '#6f7d96'], speck: 0.42 },
  marsh: { band: '#d3cbb2', fleck: '#e2dcc8', grain: '#b6ad91', stone: ['#c0cbdc', '#8b9bb4'], speck: 0.3, mud: ['#6b5238', '#8d6f4c'] },
}
// the four sides: distance of pixel (x, y) from that border, and its place along it
const SIDES = [
  [1, (x, y) => y, (x, y) => x],             // N
  [2, (x, y) => T - 1 - x, (x, y) => y],     // E
  [4, (x, y) => T - 1 - y, (x, y) => x],     // S
  [8, (x, y) => x, (x, y) => y],             // W
]
// the corners: bit, its two sides' bits
const CORNERS = [[1, 1, 2], [2, 4, 2], [4, 4, 8], [8, 1, 8]]
const sideOf = bit => SIDES.find(s => s[0] === bit)

// A band's depth along a side: END at both ends, wandering between 1 and 6
// in between through five control points.
function profile(...key) {
  const ctl = [END, ...[1, 2, 3, 4].map(k => 1.5 + unit(...key, k) * 4.5), END]
  return Array.from({ length: T }, (_, i) => {
    if (i === 0 || i === T - 1) return END
    const f = i / (T - 1) * 5, k = Math.min(4, Math.floor(f)), t = f - k
    const s = t * t * (3 - 2 * t)
    const v = ctl[k] * (1 - s) + ctl[k + 1] * s + (unit(...key, 10 + i) < 0.3 ? (unit(...key, 30 + i) < 0.5 ? -1 : 1) : 0)
    return Math.max(1, Math.min(6, Math.round(v)))
  })
}

function vergeTile(set, M, D, V) {
  const pal = VERGE[set]
  const key = [ROAD_SETS.indexOf(set), M, D, V]
  // which pixels are the road's ground
  const gravel = new Uint8Array(T * T)
  const bands = SIDES.filter(([bit]) => M & bit).map(([bit, dist, along]) => ({ dist, along, depth: profile(...key, bit) }))
  const chamfers = CORNERS.filter(([, a, c]) => (M & a) && (M & c)).map(([bit, a, c]) => {
    const wob = [0, ...[1, 2, 3].map(k => (unit(...key, 50 + bit, k) - 0.5) * 3), 0]
    return { a: sideOf(a)[1], c: sideOf(c)[1], wob }
  })
  const nibbles = CORNERS.filter(([bit]) => D & bit).map(([, a, c]) => ({ a: sideOf(a)[1], c: sideOf(c)[1] }))
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let on = bands.some(b => b.dist(x, y) < b.depth[b.along(x, y)])
    for (const ch of chamfers) {
      const da = ch.a(x, y), dc = ch.c(x, y)
      const f = (da - dc + T - 1) / (2 * (T - 1)) * 4, k = Math.min(3, Math.floor(f)), t = f - k
      if (da + dc < T - 1 + ch.wob[k] * (1 - t) + ch.wob[k + 1] * t) on = true
    }
    for (const n of nibbles) if ((n.a(x, y) + 0.5) ** 2 + (n.c(x, y) + 0.5) ** 2 < 3.3 * 3.3) on = true
    if (on) gravel[y * T + x] = 1
  }
  const rgba = new Uint8Array(T * T * 4)
  const set1 = (x, y, colour) => rgba.set([...hex(colour), 255], (y * T + x) * 4)
  // gravel: 1 drawn, 2 worn through at its edge
  const border = (x, y) => x === 0 || y === 0 || x === T - 1 || y === T - 1
  // the band's own edge: a gravel pixel beside bare ground, off the border, may wear through
  const bareAt = (x, y) => x >= 0 && y >= 0 && x < T && y < T && !gravel[y * T + x]
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (!gravel[y * T + x]) continue
    const rim = bareAt(x - 1, y) || bareAt(x + 1, y) || bareAt(x, y - 1) || bareAt(x, y + 1)
    if (rim && !border(x, y) && unit(...key, 100, x, y) < 0.3) { gravel[y * T + x] = 2; continue }
    const r = unit(...key, 200, x, y)
    set1(x, y, r < 0.06 ? pal.grain : r < 0.11 ? pal.fleck : pal.band)
  }
  // how far each bare pixel is from the gravel (4-way steps), out to 7
  const far = new Uint8Array(T * T).fill(9)
  const queue = []
  for (let i = 0; i < T * T; i++) if (gravel[i] === 1) { far[i] = 0; queue.push(i) }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % T, y = (i / T) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * T + nx
      if (nx < 0 || ny < 0 || nx >= T || ny >= T || far[j] <= far[i] + 1) continue
      far[j] = far[i] + 1
      if (far[j] < 7) queue.push(j)
    }
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = y * T + x, d = far[i]
    if (gravel[i] === 1 || d > 6) continue
    // wet mud, darkest against the causeway
    if (pal.mud && d <= 4 && unit(...key, 300, x, y) < [0, 0.75, 0.6, 0.35, 0.12][d]) { set1(x, y, pal.mud[unit(...key, 301, x, y) < [0, 0.75, 0.4, 0.2, 0.1][d] ? 0 : 1]); continue }
    const r = unit(...key, 400, x, y)
    if (r >= pal.speck * 0.6 ** (d - 1)) continue
    const c = unit(...key, 401, x, y)
    set1(x, y, c < 0.1 ? pal.stone[0] : c < 0.16 ? pal.stone[1] : c < 0.5 ? pal.band : c < 0.75 ? pal.grain : pal.fleck)
  }
  // the band on the outer pixel: all along a road side; on any other side
  // exactly within END px of a road side's border, or of the other border at
  // a nibble's corner
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    for (const [bit, dist] of SIDES) {
      if (dist(x, y) !== 0) continue
      const isBand = gravel[y * T + x] === 1
      const want = (M & bit) || SIDES.some(([b2, dist2]) => (M & b2) && dist2(x, y) < END)
        || CORNERS.some(([cb, a, c]) => (D & cb) && (a === bit || c === bit) && sideOf(a === bit ? c : a)[1](x, y) < END)
      if (isBand !== !!want) throw new Error(`${vergeSkin(set, M, D, V)}: the band is ${isBand ? '' : 'not '}on border pixel ${x},${y}`)
    }
  }
  return rgba
}

let verges = 0
for (const set of ROAD_SETS) for (const [M, D] of EDGE_SHAPES) for (let V = 0; V < VERGE_VARIANTS; V++) {
  writePng(new URL(`../renderer/assets/tiles/${vergeSkin(set, M, D, V)}.png`, import.meta.url).pathname, T, T, vergeTile(set, M, D, V))
  verges++
}
console.log(`wrote ${verges} verge tiles`)

// ---- the milestone ------------------------------------------------------------
// a outline   L l light faces   s body   k shade   c the carved mark   m moss   . see-through
const MILESTONE = [
  '................',
  '................',
  '................',
  '.......aaa......',
  '......aLLsa.....',
  '.....aLLlska....',
  '.....aLlsska....',
  '.....aLscska....',
  '.....aLcscka....',
  '.....aLssska....',
  '.....aLssska....',
  '.....aLssska....',
  '.....amsskka....',
  '....akkkkkkka...',
  '....aaaaaaaaa...',
  '................',
]
{
  const palette = { a: '#4f5b73', L: '#e4e9f0', l: '#d3dbe7', s: '#c0cbdc', k: '#8b9bb4', c: '#6f7d96', m: '#65a556' }
  if (MILESTONE.length !== 16 || MILESTONE.some(r => r.length !== 16)) throw new Error('ow_prop_milestone: not 16x16')
  const rgba = new Uint8Array(16 * 16 * 4)
  MILESTONE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    if (!palette[ch]) throw new Error(`ow_prop_milestone: no colour for "${ch}"`)
    rgba.set([...hex(palette[ch]), 255], (y * 16 + x) * 4)
  }))
  const out = new URL('../renderer/assets/tiles/ow_prop_milestone.png', import.meta.url).pathname
  writePng(out, 16, 16, rgba)
  console.log(`wrote ${out}`)
}
