// The desert's own ground (tools/make-wilds-desert-tiles.mjs draws it):
//
//   rippled sand   ow_sand_ripple_<o>_<v>: plain sand (ow_sand_0's colour)
//                  with wind ripples. A ripple runs across the wind, so the
//                  wind's direction picks the family o of RIPPLES whose lines
//                  lie closest to square with it, and a stretch of desert
//                  reads as swept one way. The wind (windAt) is a slow field
//                  of the world tile: it turns a family or two over a piece.
//   hardpan        where terrain.js puts hardpan (its fHard field), baked
//                  clay, laid by edgeHardpan from the cell and the cells
//                  round it:
//     edge         ow_hardpan_edge_<M>_<D>_<v> on every hardpan cell beside
//                  anything else: sand drifted over the clay from those sides
//                  (M the sides 1 N / 2 E / 4 S / 8 W, D the corners 1 NE /
//                  2 SE / 4 SW / 8 NW whose two sides are clay, the shapes of
//                  terrain/edges.js), so a flat of hardpan fades into the sand
//                  round it instead of ending in a square edge;
//     cracked      ow_hardpan_cracked_<m>_<v> on the rest, the inner clay, in
//                  a net of cracks: m the sides 1 N / 2 E / 4 S / 8 W a crack
//                  crosses. Whether one crosses the border between two cells
//                  of inner clay is a hash of that border (CRACK_ODDS), so the
//                  two cells agree, and the net wanders from tile to tile in
//                  cells of every size rather than repeat a tile's own.
//
// Every tile tiles with every other: within a family a ripple crosses a tile
// border at the same place in every variant, and a crack crosses a border at
// its middle. Which variant a cell takes is (hx(X) + hy(Y)) mod 3 for two
// hashes of its column and row: with an odd count of variants no 2x2 window
// can alternate two of them diagonally, the checker the old pair of sand
// tiles laid.
//
//   dunes          the sand has a height (duneField): large dunes across the
//                  wind, each a long windward slope up to its brink and a
//                  short slip face beyond. Every cell of rippled sand on a
//                  dune is shaded by how its slope faces the light (the
//                  upper left, as for the mountains and the furniture):
//                  ow_sand_shade_<c>_<o>_<v> and ow_sand_slip_<v>, drawn from
//                  the light at the cell's four corners c, so neighbours
//                  meet without a seam. The wind blows towards the
//                  south-east, so the slip face is the side in shade.
//   crests         ow_dune_<c>_<v> (desert.js DUNE_PREFIX) on the brink of a
//                  dune tall enough: a walkable cell that hides what lies
//                  behind it. crestAt is the field, layDunes lays it.
//
// Everything here is pure in the world tile (and the seed): the wind, the
// pick, the dune field, and the hardpan's tiles, which are decided from the
// finished ground of a cell and of the cells up to two away, the same in a
// piece and in its neighbour's margin wherever both hold the cell and those
// round it.
import { EDGE_SHAPES } from '../terrain/edges.js'
import { hashInt, noise2 } from './rand.js'
import { PIECE, biomeSampler } from './layout.js'
import { CITY } from './city/geometry.js'
import { DUNE_PREFIX, inGentleRing, deep, leastDeep, mostDeep, DEEP } from './desert.js'

// The ripple families: crest lines a*x + b*y = c (mod P) in a tile's pixels,
// P a whole fraction of 16 so that the lines run on unbroken from tile to
// tile. Listed by the angle of (a, b), the direction across the ripples,
// which is the wind's: 0 the wind along x (ripples running north-south),
// then about 18, 45, 72, 90, 108, 135 and 162 degrees. The ripples lie about
// 5 px apart in every family.
export const RIPPLES = [
  { a: 1, b: 0, P: 16 / 3 },
  { a: 3, b: 1, P: 16 },
  { a: 1, b: 1, P: 8 },
  { a: 1, b: 3, P: 16 },
  { a: 0, b: 1, P: 16 / 3 },
  { a: -1, b: 3, P: 16 },
  { a: -1, b: 1, P: 8 },
  { a: -3, b: 1, P: 16 },
]
const ACROSS = RIPPLES.map(({ a, b }) => Math.atan2(b, a))
// (odd, for the checker-free pick)
export const SAND_VARIANTS = 3
export const HARDPAN_VARIANTS = 3
// how often a crack crosses the border between two cells of inner clay
export const CRACK_ODDS = 0.55

// (each name made once and handed out after, by its numbers: a piece lays
// thousands, and a fresh string costs its making and its hashing in the
// builder's palette; numbers out of 0..15 make a fresh one)
const small = v => (v | 0) === v && v >= 0 && v < 16
const RIPPLE_NAMES = [], CRACKED_NAMES = [], EDGE_NAMES = []
export const rippleSkin = (o, v) => small(o) && small(v) ? (RIPPLE_NAMES[o * 16 + v] ??= `ow_sand_ripple_${o}_${v}`) : `ow_sand_ripple_${o}_${v}`
export const crackedSkin = (m, v) => small(m) && small(v) ? (CRACKED_NAMES[m * 16 + v] ??= `ow_hardpan_cracked_${m}_${v}`) : `ow_hardpan_cracked_${m}_${v}`
export const hardpanEdgeSkin = (M, D, v) => small(M) && small(D) && small(v)
  ? (EDGE_NAMES[(M * 16 + D) * 16 + v] ??= `ow_hardpan_edge_${M}_${D}_${v}`) : `ow_hardpan_edge_${M}_${D}_${v}`
export const SAND_SKINS = RIPPLES.flatMap((_, o) => Array.from({ length: SAND_VARIANTS }, (_, v) => rippleSkin(o, v)))
export const HARDPAN_SKINS = Array.from({ length: 16 }, (_, m) => Array.from({ length: HARDPAN_VARIANTS }, (_, v) => crackedSkin(m, v))).flat()
export const HARDPAN_EDGES = EDGE_SHAPES.flatMap(([M, D]) => Array.from({ length: HARDPAN_VARIANTS }, (_, v) => hardpanEdgeSkin(M, D, v)))
export const DESERT_SKINS = [...SAND_SKINS, ...HARDPAN_SKINS, ...HARDPAN_EDGES]

export const isRippleSkin = n => typeof n === 'string' && n.startsWith('ow_sand_ripple_')
// any hardpan: the pack's own tiles, the cracked clay and its edges
export const isHardpanSkin = n => typeof n === 'string' && n.startsWith('ow_hardpan')
export const isCrackedSkin = n => typeof n === 'string' && n.startsWith('ow_hardpan_cracked_')
export const isHardpanEdge = n => typeof n === 'string' && n.startsWith('ow_hardpan_edge_')

// The sand paving of a desert village's square and streets (sites.js lays
// it where a green village has its cobbles): ow_pave_sand_<v>, flagstones in
// PAVE_VARIANTS variants, and on every paving cell beside anything that is
// not paving its edge ow_pave_sand_edge_<M>_<D>, sand drifted over the
// stones from those sides (M, D as the hardpan's edges), so the paving
// fades into the sand round it.
export const PAVE_VARIANTS = 3
export const paveSkin = v => `ow_pave_sand_${v}`
export const paveEdgeSkin = (M, D) => `ow_pave_sand_edge_${M}_${D}`
export const PAVE_SKINS = [...Array.from({ length: PAVE_VARIANTS }, (_, v) => paveSkin(v)), ...EDGE_SHAPES.map(([M, D]) => paveEdgeSkin(M, D))]
export const isPaveSkin = n => typeof n === 'string' && n.startsWith('ow_pave_sand_')

// (the tests compare a world with and without the desert's dress: off, the
// desert lays the pack's two sand tiles and its flat hardpan, as before)
let dressed = true
export function setDesertDress(on) { dressed = !!on }
export const desertDress = () => dressed
// (and with and without its dunes: off, terrain.js lays none)
let duned = true
export function setDunes(on) { duned = !!on }
export const dunesOn = () => duned

// The wind, in radians, the way it blows in world tiles (x east, y south):
// towards the south-east (WIND.toward) in every desert, turned up to
// WIND.spread either way for the world by its seed, and swung up to
// WIND.swing either way by a slow field, so that it turns a little over a
// piece and more over a desert. It never blows towards the upper left, so a
// dune's slip face, downwind of its crest, is always turned from the light
// (the upper left), and its windward slope towards it.
export const WIND = { freq: 1 / 200, toward: Math.PI / 4, spread: 15 * Math.PI / 180, swing: 50 * Math.PI / 180 }
// The world's own wind, before the field swings it: WIND.toward turned up to
// WIND.spread either way by the seed (wilds/storm.js blows its storms near it).
export const prevailingWind = seed => WIND.toward + WIND.spread * (2 * hashInt(seed, 0, 0, 7101) / 4294967296 - 1)
export function windAt(seed, X, Y) {
  return prevailingWind(seed) + WIND.swing * 2 * (noise2(seed + 7100, X, Y, { freq: WIND.freq, octaves: 1 }) - 0.5)
}

// The ripple family a wind sweeps, and the one the wind at a tile sweeps.
const familyOf = wind => {
  const t = ((wind % Math.PI) + Math.PI) % Math.PI
  let best = 0, gap = Infinity
  for (let o = 0; o < ACROSS.length; o++) {
    const d = Math.abs(t - ACROSS[o]), g = Math.min(d, Math.PI - d)
    if (g < gap) { gap = g; best = o }
  }
  return best
}
export const rippleAt = (seed, X, Y) => familyOf(windAt(seed, X, Y))

// ---- the dunes' ground --------------------------------------------------------------
// A dune is shaded by the light on its slopes (layDunes): every corner of
// the grid of cells takes a level of SHADE_LEVELS, and a cell's ground is
// drawn from its four corners, NW NE SE SW, as a gradient from one to the
// next, so a cell meets each neighbour along their shared edge exactly and no
// cell shows as a square. The levels: -1 the slip face, in shade; 0 flat sand;
// 1 a slope turned to the light (the upper left); 2 one turned squarely to it.
// Names carry the corners as their level + 1, one digit a corner.
const SHADE_LEVELS = [-1, 0, 1, 2]
const code = c => c.map(l => l + 1).join('')
//   shading        ow_sand_shade_<c>_<o>_<v>: the rippled sand of family o
//                  shaded from corner to corner, corners a level apart at
//                  most; only a cell level all round (a flat of one level)
//                  comes in the SAND_VARIANTS variants v of its ripples, the
//                  rest in v = 0. The slip face is smooth, ripples blown off.
//   slip face      ow_sand_slip_<v>: a cell of slip face all round, the same
//                  in every family.
// Shading tiles are drawn for the families the wind can sweep (WIND), none
// for the rest: rippleAt never picks those.
export const SHADE_FAMILIES = (() => {
  const reach = WIND.spread + WIND.swing, seen = new Set()
  for (let k = 0; k <= 720; k++) seen.add(familyOf(WIND.toward - reach + 2 * reach * k / 720))
  return [...seen].sort((a, b) => a - b)
})()
const even = c => c.every(l => l === c[0])
export const shadeSkin = (c, o, v) => c.every(l => l === -1) ? `ow_sand_slip_${v}` : `ow_sand_shade_${code(c)}_${o}_${even(c) ? v : 0}`
// every corner pattern a shading tile is drawn for: a level apart at most, not level flat sand
const SHADE_CORNERS = (() => {
  const out = []
  for (let k = 0; k < 4 ** 4; k++) {
    const c = [0, 1, 2, 3].map(i => SHADE_LEVELS[(k >> (2 * i)) & 3])
    if (Math.max(...c) - Math.min(...c) <= 1 && !c.every(l => l === 0)) out.push(c)
  }
  return out
})()
export const SHADE_SKINS = [...new Set(SHADE_CORNERS.flatMap(c => SHADE_FAMILIES.flatMap(o =>
  even(c) ? Array.from({ length: SAND_VARIANTS }, (_, v) => shadeSkin(c, o, v)) : [shadeSkin(c, o, 0)])))]
export const isShadeSkin = n => typeof n === 'string' && (n.startsWith('ow_sand_shade_') || n.startsWith('ow_sand_slip_'))
//   crests         ow_dune_<c>_<v> (desert.js DUNE_PREFIX): a cell of a
//                  dune's crest band, walked over but hiding what lies behind
//                  it. Its corners are -1, 0 or 1: the brink runs through the
//                  middle of every side whose corners are 1 and -1 (the
//                  windward top and the slip face), from side to side across
//                  the cell, so it runs on into the next crest cell; a 0
//                  corner (where the band ends) ends it in the cell. The four
//                  patterns with the brink straight across come in
//                  DUNE_VARIANTS variants v, bowed a pixel each way; the rest
//                  in v = 0. (Kept apart from DESERT_SKINS: a dune is the one
//                  desert ground that hides what is behind it.)
export const DUNE_VARIANTS = 3
const STRAIGHT = new Set(['2200', '0022', '2002', '0220'])
export const duneSkin = (c, v) => `${DUNE_PREFIX}${code(c)}_${STRAIGHT.has(code(c)) ? v : 0}`
const DUNE_CORNERS = Array.from({ length: 81 }, (_, k) => [0, 1, 2, 3].map(i => Math.floor(k / 3 ** i) % 3 - 1))
export const DUNE_SKINS = DUNE_CORNERS.flatMap(c => STRAIGHT.has(code(c)) ? Array.from({ length: DUNE_VARIANTS }, (_, v) => duneSkin(c, v)) : [duneSkin(c, 0)])
export const isDuneSkin = n => typeof n === 'string' && n.startsWith(DUNE_PREFIX)
// Does a brink cross a cell with these corners: has it a side whose corners are 1 and -1?
export const crosses = c => c[0] * c[1] === -1 || c[1] * c[2] === -1 || c[2] * c[3] === -1 || c[3] * c[0] === -1
// The corner levels a ground skin is drawn with, NW NE SE SW: [0, 0, 0, 0]
// for plain rippled sand, null for ground that is not the dunes'.
export function cornersOf(n) {
  if (typeof n !== 'string') return null
  if (n.startsWith('ow_sand_ripple_')) return [0, 0, 0, 0]
  if (n.startsWith('ow_sand_slip_')) return [-1, -1, -1, -1]
  const m = /^ow_(?:sand_shade|dune)_(\d)(\d)(\d)(\d)_/.exec(n)
  return m ? [m[1] - 1, m[2] - 1, m[3] - 1, m[4] - 1] : null
}

// A variant for a tile, from its column and its row: never a checker.
const pick = (seed, X, Y, salt, n) => (hashInt(seed, X, 0, salt) % n + hashInt(seed, 0, Y, salt + 1) % n) % n

export const sandSkinAt = (seed, X, Y) => rippleSkin(rippleAt(seed, X, Y), pick(seed, X, Y, 7110, SAND_VARIANTS))
export const hardpanVariant = (seed, X, Y) => pick(seed, X, Y, 7120, HARDPAN_VARIANTS)
// does a crack cross the border on the north side of tile (X, Y), and on its west side?
const crackN = (seed, X, Y) => hashInt(seed, X, Y, 7130) / 4294967296 < CRACK_ODDS
const crackW = (seed, X, Y) => hashInt(seed, X, Y, 7131) / 4294967296 < CRACK_ODDS

// Lay the hardpan. `b` is a terrain/lib.js MapBuilder whose hardpan cells
// carry any hardpan skin; (X0, Y0) is the world tile of builder cell (0, 0).
// A hardpan cell beside anything that is not hardpan (sand, a path, a road,
// water, grass) takes the edge of that shape, every other one the cracked
// clay, crossed by a crack on each side where the cell beyond is cracked
// clay too and the border's hash says so. Off the builder counts as hardpan
// but never as cracked clay, so nothing frays or cracks against its border
// (those cells are a margin no piece draws). `keep(x, y)`, if given, names
// builder cells to leave as they are (Kalevanlinna's walls and what they
// hold): counted like cells off the builder, so the clay beside them neither
// frays nor ends a crack against masonry. Ground only; idempotent. Returns
// how many cells changed.
export function edgeHardpan(b, { X0, Y0, seed, keep = null }) {
  const { w, h } = b
  const hard = b.palette.map(isHardpanSkin)
  const same = (x, y) => x < 0 || y < 0 || x >= w || y >= h || hard[b.ground[y][x]] || !!keep?.(x, y)
  // each hardpan cell's shape, (M | D << 4) + 1, or 1 for inner clay; 0 for no hardpan (or kept)
  const shape = new Int16Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hard[b.ground[y][x]] || keep?.(x, y)) continue
    const M = (same(x, y - 1) ? 0 : 1) | (same(x + 1, y) ? 0 : 2) | (same(x, y + 1) ? 0 : 4) | (same(x - 1, y) ? 0 : 8)
    let D = 0
    if (!(M & 3) && !same(x + 1, y - 1)) D |= 1
    if (!(M & 6) && !same(x + 1, y + 1)) D |= 2
    if (!(M & 12) && !same(x - 1, y + 1)) D |= 4
    if (!(M & 9) && !same(x - 1, y - 1)) D |= 8
    shape[y * w + x] = (M | D << 4) + 1
  }
  const inner = (x, y) => x >= 0 && y >= 0 && x < w && y < h && shape[y * w + x] === 1
  const writes = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = shape[y * w + x]
    if (!s) continue
    const X = X0 + x, Y = Y0 + y, v = hardpanVariant(seed, X, Y)
    let want
    if (s > 1) want = hardpanEdgeSkin((s - 1) & 15, (s - 1) >> 4, v)
    else {
      const m = (inner(x, y - 1) && crackN(seed, X, Y) ? 1 : 0) | (inner(x + 1, y) && crackW(seed, X + 1, Y) ? 2 : 0)
        | (inner(x, y + 1) && crackN(seed, X, Y + 1) ? 4 : 0) | (inner(x - 1, y) && crackW(seed, X, Y) ? 8 : 0)
      want = crackedSkin(m, v)
    }
    if (want !== b.palette[b.ground[y][x]]) writes.push([x, y, want])
  }
  for (const [x, y, skin] of writes) b.ground[y][x] = b.skin(skin)
  return writes.length
}

// ---- dunes ----------------------------------------------------------------------
// The desert's sand has a height (duneField): dunes as large bodies across
// the wind, each a long gentle windward slope up to its brink and a short
// steep slip face beyond, flat sand between them, and sheets of flat sand
// where no dune stands.
//
// Where the dunes run comes from wave kernels on a jittered grid of world
// tiles, each a train of crests square to the wind where it stands (windAt,
// turned up to DUNE.turn either way by a hash) and DUNE.spacing apart by a
// slow field, summed as complex numbers (phasor noise): the sum's phase climbs
// steadily downwind over a dune's windward slope and wraps once at its brink.
// Where kernels of slightly other bearing meet, a dune forks or ends. Summed
// kernel by kernel round their own middles, the waves follow the wind's turns
// anywhere in the world without the drift a rotated grid of world tiles would
// build up far from home.
//
// How tall a dune stands comes from the same kernels: each carries a height
// from a slow field of the world tile (DUNE.amp: none where the field is low,
// the full height where it is high, varied by a hash so that one dune stands
// taller than the next), and a tile takes the kernels' heights weighted as
// their waves are; where the waves of the kernels disagree (a fork, a dune's
// end) the sum is weak against its weights and the dune dies down there. Down
// the wind from its brink the ground drops over the slip face (DUNE.slip of
// the wave on a dune tall enough for a crest, the gentle DUNE.lee on a low
// swell, steepening over the DUNE.steep of height below the crest height),
// lies flat for DUNE.flat, and climbs the windward slope again, from a gentle
// foot, steepest two thirds of the way up and rounding a little towards the
// brink.
// The height eases to nothing towards the desert's edge (over DUNE.desert
// tiles), the gentle ring round home and Kalevanlinna (over DUNE.ease tiles
// beyond its own margin).
//
// A crest cell is a cell on the high side of a wrap (phase at least half) with
// any of its eight neighbours on the low side (the phase drops by more than
// half to it), as high as a crest needs there (DUNE.crest near home): the
// brink of a dune tall enough, one to two cells wide, two where it runs
// slantwise, and always edge to edge, so no sight line slips between two
// crest cells that touch only at a corner. Where
// a band would still do so (at a fork, or where it is cut off) the cell
// between them that lies higher on the wave is filled; where neither may be,
// the lower of the two crest cells goes. Crests lie only where every tile
// within DUNE.desert is desert, so the desert's edge stays open, never in the
// gentle ring round home, and never within DUNE.city of Kalevanlinna's pieces
// (the city lays its own outskirts).
//
// Far from home the dunes close in (desert.js deep, 0 near home to 1 far
// out): the spacing, the heights, the coherence a dune needs and the height
// that gives it a crest ramp from the values here to those in DUNE.deep, so
// that near home the desert is open dune country and deep in it one can get
// lost. A kernel takes its spacing and height by where it stands (over the
// stretch of the ramp where every tile it reaches agrees), a tile its
// coherence and crest height by where it lies: all by world position.
export const DUNE = {
  lattice: 24, reach: 40, spacing: [22, 34], turn: 15 * Math.PI / 180,
  amp: { freq: 1 / 90, lo: 0.12, hi: 0.45, jitter: 0.4 }, coherence: [0.2, 0.5],
  slip: 0.11, lee: 0.3, steep: 0.06, flat: 0.08,
  crest: 0.35, desert: 4, city: 8, ease: 8,
  deep: { spacing: [15, 21], amp: { lo: 0, hi: 0.3 }, coherence: [0.08, 0.25], crest: 0.1 },
}
const mix = (a, b, t) => t === 0 ? a : a + (b - a) * t
// How deep a kernel stands, for its spacing and height: it reaches DUNE.reach
// tiles, so it ramps only where every tile it reaches lies past DEEP.from and
// is deep wherever every tile it reaches lies past DEEP.to; a tile at depth 0
// sums near kernels only, one at depth 1 deep ones only.
const kernelDepth = (cx, cy) => {
  const r = DUNE.reach / PIECE, d = Math.hypot((cx - PIECE / 2) / PIECE, (cy - PIECE / 2) / PIECE)
  const t = (d - DEEP.from - r) / (DEEP.to - DEEP.from - 2 * r)
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
}
// the height that gives a crest at depth t (0 near, 1 deep), and at world tile (X, Y)
const crestAtDepth = t => mix(DUNE.crest, DUNE.deep.crest, t)
export const crestHeightAt = (X, Y) => crestAtDepth(deep(X, Y))
// The light on a slope, as the rise in height per tile along the way the
// light runs (from the upper left to the lower right): a slope rising `lit`
// or more is turned to the light and takes level 1, rising `bright` or more
// level 2; one falling `shade` or more is in shade, -1.
export const LIGHT = { lit: 0.012, bright: 0.035, shade: 0.12 }
// how far round a rectangle duneField looks at the country
export const DUNE_LOOK = DUNE.desert + 1
const TAU = 2 * Math.PI
const CITY_BOX = {
  x0: CITY.wx0 * PIECE - DUNE.city, x1: (CITY.wx0 + CITY.pieces) * PIECE + DUNE.city,
  y0: CITY.wy0 * PIECE - DUNE.city, y1: (CITY.wy0 + CITY.pieces) * PIECE + DUNE.city,
}
// Is world tile (X, Y) on Kalevanlinna's pieces or within DUNE.city of them?
// The city lays its own outskirts there: no dune, and nothing of the desert
// the city's art does not know (terrain.js keeps its outcrops and tall palms out).
export const nearCity = (X, Y) => X >= CITY_BOX.x0 && X < CITY_BOX.x1 && Y >= CITY_BOX.y0 && Y < CITY_BOX.y1
// the gentle ring's pieces (desert.js inGentleRing) in world tiles
const RING_BOX = { x0: -PIECE, x1: 2 * PIECE, y0: -PIECE, y1: 2 * PIECE }
// how many tiles (X, Y) lies beyond a box, 0 inside it
const beyond = (B, X, Y) => Math.max(B.x0 - X, X - B.x1 + 1, B.y0 - Y, Y - B.y1 + 1, 0)
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)

// (a margin on a squared length far wider than any rounding of Math.hypot)
const BELOW = 1 - 1e-9, ABOVE = 1 + 1e-9
// The waves at every tile of the w x h rectangle at (x0, y0): the phase in
// [0, 1), and the height a dune stands to there (its brink's), 0..1.
function duneWaves(seed, x0, y0, w, h) {
  // (every number read once, so the loops below touch no object)
  const L = DUNE.lattice, R = DUNE.reach, turn = DUNE.turn, D = DUNE.deep
  const sLo = DUNE.spacing[0], sHi = DUNE.spacing[1], dsLo = D.spacing[0], dsHi = D.spacing[1]
  const aFreq = DUNE.amp.freq, aLo = DUNE.amp.lo, aHi = DUNE.amp.hi, aJit = DUNE.amp.jitter, daLo = D.amp.lo, daHi = D.amp.hi
  const cLo = DUNE.coherence[0], cHi = DUNE.coherence[1], dcLo = D.coherence[0], dcHi = D.coherence[1]
  const n = w * h, re = new Float64Array(n), im = new Float64Array(n), ws = new Float64Array(n), as = new Float64Array(n)
  for (let j = Math.floor((y0 - R) / L); j <= Math.floor((y0 + h + R) / L); j++)
    for (let i = Math.floor((x0 - R) / L); i <= Math.floor((x0 + w + R) / L); i++) {
      const cx = (i + hashInt(seed, i, j, 7201) / 4294967296) * L
      const cy = (j + hashInt(seed, i, j, 7202) / 4294967296) * L
      const ya = Math.max(y0, Math.ceil(cy - R)), yb = Math.min(y0 + h - 1, Math.floor(cy + R))
      if (ya > yb || cx + R < x0 || cx - R > x0 + w - 1) continue
      const wind = windAt(seed, cx, cy) + (2 * hashInt(seed, i, j, 7203) / 4294967296 - 1) * turn
      // (the kernel's spacing and height by how deep it stands)
      const t = kernelDepth(cx, cy)
      const lo = mix(sLo, dsLo, t), hi = mix(sHi, dsHi, t), alo = mix(aLo, daLo, t), ahi = mix(aHi, daHi, t)
      const k = TAU / (lo + (hi - lo) * noise2(seed + 7204, cx, cy, { freq: 1 / 120, octaves: 1 }))
      const kx = Math.cos(wind) * k, ky = Math.sin(wind) * k
      const ph = hashInt(seed, i, j, 7205) / 4294967296 * TAU
      const tall = Math.max(0, Math.min(1, (noise2(seed + 7206, cx, cy, { freq: aFreq, octaves: 2 }) - alo) / (ahi - alo)))
        * (1 - aJit * hashInt(seed, i, j, 7207) / 4294967296)
      // along a row the wave turns by kx a tile: rotate rather than call cos
      // and sin, always from the row's first tile in the kernel's reach, so a
      // tile's phase and height are the same to the last bit whatever
      // rectangle is asked
      const sx = Math.cos(kx), sy = Math.sin(kx)
      for (let y = ya; y <= yb; y++) {
        const dy = y - cy, half = Math.sqrt(R * R - dy * dy)
        const xs = Math.ceil(cx - half), xb = Math.min(x0 + w - 1, Math.floor(cx + half))
        if (Math.max(x0, xs) > xb) continue
        const a = (xs - cx) * kx + dy * ky + ph
        let c = Math.cos(a), s = Math.sin(a), x = xs
        // (the tiles of the reach left of the rectangle only turn the wave on)
        for (; x < x0; x++) { const c2 = c * sx - s * sy; s = s * sx + c * sy; c = c2 }
        for (let o = (y - y0) * w + x - x0; x <= xb; x++, o++) {
          const dx = x - cx, t = 1 - (dx * dx + dy * dy) / (R * R)
          if (t > 0) { const t2 = t * t; re[o] += t2 * c; im[o] += t2 * s; ws[o] += t2; as[o] += t2 * tall }
          const c2 = c * sx - s * sy
          s = s * sx + c * sy; c = c2
        }
      }
    }
  // (the coherence a dune needs by how deep each tile lies; once for a
  // rectangle all at one depth)
  const phase = new Float64Array(n), peak = new Float64Array(n), least = leastDeep(x0, y0, w, h), one = least === mostDeep(x0, y0, w, h)
  let c0 = mix(cLo, dcLo, least), c1 = mix(cHi, dcHi, least)
  for (let y = 0, o = 0; y < h; y++) for (let x = 0; x < w; x++, o++) {
    const a = Math.atan2(im[o], re[o]) / TAU
    phase[o] = a < 0 ? a + 1 : a
    if (ws[o] === 0) continue
    if (!one) { const t = deep(x0 + x, y0 + y); c0 = mix(cLo, dcLo, t); c1 = mix(cHi, dcHi, t) }
    // (smooth's 0 below c0 and its 1 above c1, where the squared sum settles
    // it by a margin no rounding of Math.hypot crosses; it alone between)
    const W = ws[o], z2 = re[o] * re[o] + im[o] * im[o]
    if (z2 <= c0 * W * c0 * W * BELOW) peak[o] = as[o] / W * 0
    else if (z2 >= c1 * W * c1 * W * ABOVE) peak[o] = as[o] / W * 1
    else peak[o] = as[o] / W * smooth((Math.hypot(re[o], im[o]) / W - c0) / (c1 - c0))
  }
  return { phase, peak }
}

// A dune's height at phase q across it, as a share of its brink's height
// `peak`: the slip face from the brink (q = 0, just downwind of it), steeper
// the taller the dune, then flat sand, then the windward slope rising to the
// brink (q near 1).
function profile(q, peak, crest) {
  const { slip, lee, steep, flat } = DUNE
  const s = slip + (lee - slip) * (1 - smooth((peak - crest + steep) / steep))
  if (q < s) { const u = 1 - q / s; return u * u }
  if (q < s + flat) return 0
  const t = (q - s - flat) / (1 - s - flat)
  return t * t * (2 - t)
}

// For every tile of the rectangle: whether a crest may lie there (1 or 0),
// how far the height eases off (0..1), and whether it or a tile beside it is
// another country (1 or 0). `country` is layout.js biomeAt for the tiles
// within DUNE.desert of the rectangle.
function duneGround(seed, x0, y0, w, h, country) {
  const r = DUNE.desert, bw = w + 2 * r, bh = h + 2 * r
  country ??= biomeSampler(seed, x0 - r, y0 - r, x0 + w - 1 + r, y0 + h - 1 + r)
  // how many tiles not desert above and left of each corner of the grid, to count any square at once
  const sum = new Int32Array((bw + 1) * (bh + 1))
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const not = country(x0 - r + x, y0 - r + y) === 'desert' ? 0 : 1
    sum[(y + 1) * (bw + 1) + x + 1] = not + sum[y * (bw + 1) + x + 1] + sum[(y + 1) * (bw + 1) + x] - sum[y * (bw + 1) + x]
  }
  const ok = new Uint8Array(w * h), ease = new Float64Array(w * h), rim = new Uint8Array(w * h)
  // how many tiles not desert in the square of side 2k + 1 round (x0 + x, y0 + y)
  const notIn = (x, y, k) => {
    const lo = r - k, hi = r + k + 1
    return sum[(y + hi) * (bw + 1) + x + hi] - sum[(y + lo) * (bw + 1) + x + hi] - sum[(y + hi) * (bw + 1) + x + lo] + sum[(y + lo) * (bw + 1) + x + lo]
  }
  // (a rectangle well clear of the gentle ring and the city need not ask each tile)
  const clear = B => B.x0 - (x0 + w - 1) >= DUNE.ease || x0 - (B.x1 - 1) >= DUNE.ease || B.y0 - (y0 + h - 1) >= DUNE.ease || y0 - (B.y1 - 1) >= DUNE.ease
  const open = clear(RING_BOX) && clear(CITY_BOX)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y
    const not = notIn(x, y, r)
    if (not && notIn(x, y, 1)) rim[y * w + x] = 1
    // (none beside other country, the full height r + 1 tiles in from it)
    let e = smooth(1 - not / ((2 * r + 1) * r))
    if (open) {
      ease[y * w + x] = e
      if (not === 0) ok[y * w + x] = 1
      continue
    }
    if (e > 0) e *= smooth(beyond(RING_BOX, X, Y) / DUNE.ease) * smooth(beyond(CITY_BOX, X, Y) / DUNE.ease)
    ease[y * w + x] = e
    if (not === 0 && !inGentleRing(Math.floor(X / PIECE), Math.floor(Y / PIECE)) && !nearCity(X, Y)) ok[y * w + x] = 1
  }
  return { ok, ease, rim }
}

// The dune field for every tile of the w x h rectangle at (x0, y0):
//   crest   1 on a crest, else 0 (what crestAt says of each tile)
//   high    1 on the high side of the wave (its windward slope), else 0
//   height  the ground's height, 0 on flat sand and outside the desert:
//           the dunes' `relief` times `ease`, 1 in the open desert and
//           easing to 0 towards its edge, the gentle ring and the city
//   rim     1 where the tile or one beside it is another country
// `country`, if given, is biomeAt (seed's) for the tiles within DUNE_LOOK of
// the rectangle: a caller that has them at hand saves the looking up. Every
// tile's values are the same in any rectangle that holds it.
export function duneField(seed, x0, y0, w, h, { country = null } = {}) {
  const n = w * h
  const out = { crest: new Uint8Array(n), high: new Uint8Array(n), height: new Float64Array(n), relief: new Float64Array(n), ease: new Float64Array(n), rim: new Uint8Array(n) }
  // grids one tile wider all round (g), and two (p): a crest looks at its
  // neighbours, and the fill at its neighbours' crests
  const gw = w + 2, gh = h + 2, pw = w + 4
  const { ok, ease, rim } = duneGround(seed, x0 - 1, y0 - 1, gw, gh, country)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.rim[y * w + x] = rim[(y + 1) * gw + x + 1]
  if (!ease.some(e => e > 0)) return out
  const { phase: q, peak } = duneWaves(seed, x0 - 2, y0 - 2, pw, h + 4)
  const Q = (x, y) => q[(y + 2) * pw + x + 2]   // x, y from -2
  // (the height that gives a crest, by how deep each tile lies; once for a
  // rectangle all at one depth)
  const relief = new Float64Array(gw * gh), height = new Float64Array(gw * gh), crestH = new Float64Array(gw * gh)
  const least = leastDeep(x0 - 1, y0 - 1, gw, gh), one = least === mostDeep(x0 - 1, y0 - 1, gw, gh), flatH = crestAtDepth(least)
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    const o = (y + 2) * pw + x + 2, g = (y + 1) * gw + x + 1
    crestH[g] = one ? flatH : crestAtDepth(deep(x0 + x, y0 + y))
    relief[g] = peak[o] * profile(q[o], peak[o], crestH[g])
    height[g] = ease[g] * relief[g]
  }
  // whether a tile is high enough for a crest and may hold one (from -1)
  const crestable = new Uint8Array(gw * gh)
  for (let g = 0; g < gw * gh; g++) if (ok[g] === 1 && height[g] >= crestH[g]) crestable[g] = 1
  const G = (x, y) => crestable[(y + 1) * gw + x + 1] === 1
  const raw = new Uint8Array(gw * gh)
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    const c = Q(x, y)
    if (c < 0.5 || !G(x, y)) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && c - Q(x + dx, y + dy) > 0.5) raw[(y + 1) * gw + x + 1] = 1
  }
  const R = (x, y) => raw[(y + 1) * gw + x + 1] === 1
  // of two cells, the one higher on the wave; on a tie the first in reading order
  const over = (ax, ay, bx, by) => Q(ax, ay) > Q(bx, by) || (Q(ax, ay) === Q(bx, by) && (ay < by || (ay === by && ax < bx)))
  // the four diagonal neighbours, (SX[k], SY[k])
  const SX = [1, 1, -1, -1], SY = [1, -1, 1, -1]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on
    if (R(x, y)) {
      // gone if it touches another crest cell only at a corner, where neither cell between may be crest, and lies the lower
      on = true
      for (let k = 0; k < 4 && on; k++) {
        const sx = SX[k], sy = SY[k]
        if (R(x + sx, y + sy) && !R(x + sx, y) && !R(x, y + sy) && !G(x + sx, y) && !G(x, y + sy) && over(x + sx, y + sy, x, y)) on = false
      }
    } else {
      // filled if it lies between two crest cells that touch only at a corner, and higher than the other cell between (or that one may not be crest)
      on = false
      if (G(x, y)) for (let k = 0; k < 4 && !on; k++) {
        const sx = SX[k], sy = SY[k]
        if (R(x + sx, y) && R(x, y + sy) && !R(x + sx, y + sy) && (!G(x + sx, y + sy) || over(x, y, x + sx, y + sy))) on = true
      }
    }
    const i = y * w + x
    if (on) out.crest[i] = 1
    if (Q(x, y) >= 0.5) out.high[i] = 1
    out.height[i] = height[(y + 1) * gw + x + 1]
    out.relief[i] = relief[(y + 1) * gw + x + 1]
    out.ease[i] = ease[(y + 1) * gw + x + 1]
  }
  return out
}

// The crest field alone: duneField's `crest`.
export const crestField = (seed, x0, y0, w, h, opts) => duneField(seed, x0, y0, w, h, opts).crest
// Is world tile (X, Y) on a crest?
export const crestAt = (seed, X, Y) => crestField(seed, X, Y, 1, 1)[0] === 1
// How high the ground stands at world tile (X, Y).
export const duneHeight = (seed, X, Y) => duneField(seed, X, Y, 1, 1).height[0]

// Lay the dunes. `b` is a terrain/lib.js MapBuilder; (X0, Y0) is the world
// tile of builder cell (0, 0). Ground only. Returns how many cells took a crest.
//
// Every crest cell of the field for which `open(x, y)` holds takes a crest's
// ground (`open` is asked of builder cells and of the two rings of cells
// outside: the caller says whether a crest may lie there, on sand, off the
// ways, the sites and what stands). Every other cell of rippled sand is
// shaded from its four corners. A corner's level:
//   - 0 where it touches a cell that must stay level: one `flat(x, y)` names
//     (other ground, a way, a site; asked of cells up to three beyond the
//     builder), one beside another country, or a crest cell of the field
//     not laid;
//   - on a crest band of the field, 1 if the cells off the band round it lie
//     on the dune's high side (its windward top), -1 if on the low side (the
//     slip face below the brink), 0 if both (where the band ends);
//   - elsewhere, the light on the slope there (LIGHT, from the relief of the
//     cells to its north-west and south-east, fading as the height eases off
//     towards the desert's edge, so the easing is no slope), held a level
//     from every other corner of a cell it shares: the light is first brought
//     down where it would stand more than a level, or two, over a corner one,
//     or two, away (a low swell's brink, which has no crest to draw it), then
//     kept within a level of the band's corners and the level ones round it,
//     whatever they turn out to be; and a lone corner of slip face, with no
//     other beside it along a side, is flat sand (it would draw as a dithered
//     diamond).
// So every shaded cell's corners lie a level apart at most, and a crest
// cell's brink runs from the middle of each side whose corners are 1 and -1:
// only ever into another crest cell. A crest cell left with no brink across
// it (level ground beside it smoothed it away) and its corners a level apart
// is not laid: it is shaded like the sand round it, and hides nothing.
// `field`, if given, is a duneField result over builder cells from (x0, y0),
// w wide, holding the cells from four before the builder to four after it;
// else it is worked out here, with `country` as for duneField.
export function layDunes(b, { X0, Y0, seed, open, flat = null, field = null, country = null }) {
  const { w, h } = b
  const P = 4
  field ??= { ...duneField(seed, X0 - P, Y0 - P, w + 2 * P, h + 2 * P, { country }), x0: -P, y0: -P, w: w + 2 * P }
  const ripple = b.palette.map(n => /^ow_sand_ripple_(\d+)_(\d+)$/.exec(n))
  flat ??= (x, y) => x >= 0 && y >= 0 && x < w && y < h && !ripple[b.ground[y][x]]
  // the cells from P before the builder to P after it, row by row
  const CW = w + 2 * P, CH = h + 2 * P, ci = (x, y) => (y + P) * CW + x + P
  const N = CW * CH, band = new Uint8Array(N), high = new Uint8Array(N), relief = new Float64Array(N), ease = new Float64Array(N)
  let any = false
  for (let y = 0; y < CH; y++) {
    const from = (y - P - field.y0) * field.w - P - field.x0
    for (let x = 0; x < CW; x++) {
      const i = y * CW + x, f = from + x
      band[i] = field.crest[f]; high[i] = field.high[f]; relief[i] = field.relief[f]; ease[i] = field.ease[f]
      if (relief[i] > 0 && ease[i] > 0) any = true
    }
  }
  if (!any) return 0
  // The corners, from three before the builder's first to three after its last:
  // corner (x, y) is the north-west corner of cell (x, y), at
  // (y + V) * VW + x + V; its cells NW, NE, SW, SE at c - CW - 1, c - CW, c - 1, c
  // for c = ci(x, y).
  const V = 3, VW = w + 1 + 2 * V, VH = h + 1 + 2 * V, VN = VW * VH
  const FREE = 9
  const cls = new Int8Array(VN).fill(FREE)   // a band corner's level, or FREE
  const lit = new Int8Array(VN).fill(3)      // a free corner's light level; 3 (above any) on the band
  // what lies round a corner, as bits: 1 a band corner of level 1, 2 one of -1, 4 any band corner, 8 a level corner
  const marks = new Uint8Array(VN)
  for (let y = -V; y <= h + V; y++) for (let x = -V; x <= w + V; x++) {
    const v = (y + V) * VW + x + V, se = ci(x, y), sw = se - 1, ne = se - CW, nw = ne - 1
    if (band[nw] | band[ne] | band[sw] | band[se]) {
      let up = 0, down = 0
      if (!band[nw]) { if (high[nw]) up = 1; else down = 1 }
      if (!band[ne]) { if (high[ne]) up = 1; else down = 1 }
      if (!band[sw]) { if (high[sw]) up = 1; else down = 1 }
      if (!band[se]) { if (high[se]) up = 1; else down = 1 }
      const c = up && !down ? 1 : down && !up ? -1 : up && down ? 0 : 1
      cls[v] = c
      marks[v] = 4 | (c === 1 ? 1 : c === -1 ? 2 : 0)
    } else {
      const L = (relief[se] - relief[nw]) / Math.SQRT2 * Math.min(ease[se], ease[nw])
      lit[v] = L >= LIGHT.bright ? 2 : L >= LIGHT.lit ? 1 : L <= -LIGHT.shade ? -1 : 0
    }
  }
  // the cells that must stay level, from three before the builder to three after
  const level = new Uint8Array(N)
  for (let y = -3; y < h + 3; y++) {
    const from = (y - field.y0) * field.w - field.x0
    for (let x = -3; x < w + 3; x++) if (field.rim[from + x] || flat(x, y)) level[ci(x, y)] = 1
  }
  for (let y = -2; y <= h + 2; y++) for (let x = -2; x <= w + 2; x++) {
    const se = ci(x, y)
    if (level[se] | level[se - 1] | level[se - CW] | level[se - CW - 1]) marks[(y + V) * VW + x + V] |= 8
  }
  // Square windows round each corner, a row then a column at a time: the
  // lowest light within one corner and within two, the marks within one and
  // (of -1 band corners) within two.
  const rowMin1 = new Int8Array(VN), rowMin2 = new Int8Array(VN), rowOr1 = new Uint8Array(VN), rowOr2 = new Uint8Array(VN)
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    const i = y * VW + x
    let m1 = lit[i], m2 = m1, o1 = marks[i], o2 = o1 & 2
    for (let d = 1; d <= 2; d++) {
      const l = x - d >= 0 ? i - d : -1, r = x + d < VW ? i + d : -1
      if (l >= 0) { if (lit[l] < m2) m2 = lit[l]; if (d === 1) { if (lit[l] < m1) m1 = lit[l]; o1 |= marks[l] }; o2 |= marks[l] & 2 }
      if (r >= 0) { if (lit[r] < m2) m2 = lit[r]; if (d === 1) { if (lit[r] < m1) m1 = lit[r]; o1 |= marks[r] }; o2 |= marks[r] & 2 }
    }
    rowMin1[i] = m1; rowMin2[i] = m2; rowOr1[i] = o1; rowOr2[i] = o2
  }
  // the crest cells laid, the builder's and the two rings round it
  const laid = new Uint8Array(N)
  for (let y = -2; y <= h + 1; y++) for (let x = -2; x <= w + 1; x++) if (band[ci(x, y)] && open(x, y)) laid[ci(x, y)] = 1
  // every corner of the builder's cells and the ring of corners round them,
  // at (y + 1) * W1 + x + 1
  const W1 = w + 3, ki = (x, y) => (y + 1) * W1 + x + 1, corner = new Int8Array(W1 * (h + 3))
  for (let y = -1; y <= h + 1; y++) for (let x = -1; x <= w + 1; x++) {
    const v = (y + V) * VW + x + V
    let l
    if (marks[v] & 8) l = 0
    else if (cls[v] !== FREE) {
      const se = ci(x, y), sw = se - 1, ne = se - CW, nw = ne - 1
      l = (band[nw] && !laid[nw]) || (band[ne] && !laid[ne]) || (band[sw] && !laid[sw]) || (band[se] && !laid[se]) ? 0 : cls[v]
    } else {
      let low1 = 3, low2 = 3, near1 = 0, near2 = 0
      for (let d = -2; d <= 2; d++) {
        const j = v + d * VW
        if (rowMin2[j] < low2) low2 = rowMin2[j]
        near2 |= rowOr2[j]
        if (d >= -1 && d <= 1) { if (rowMin1[j] < low1) low1 = rowMin1[j]; near1 |= rowOr1[j] }
      }
      l = lit[v]
      if (low1 + 1 < l) l = low1 + 1
      if (low2 + 2 < l) l = low2 + 2
      const hi = near1 & 2 ? 0 : near2 & 2 || near1 & 12 ? 1 : 2, lo = near1 & 1 ? 0 : -1
      l = l > hi ? hi : l < lo ? lo : l
    }
    corner[ki(x, y)] = l
  }
  // A crest cell whose brink level ground has smoothed away, every side of it
  // level with the next, hides nothing: it is shaded like the rest. (Decided
  // for the ring of cells round the builder too, for the corners below.)
  const crested = new Uint8Array(N)
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (!laid[ci(x, y)]) continue
    const k = ki(x, y), nw = corner[k], ne = corner[k + 1], se = corner[k + W1 + 1], sw = corner[k + W1]
    if (crosses([nw, ne, se, sw]) || Math.max(nw, ne, se, sw) - Math.min(nw, ne, se, sw) > 1) crested[ci(x, y)] = 1
  }
  // A lone corner of slip face (a -1 with no -1 beside it along a side, and
  // no crest cell drawing round it) would draw as a dithered diamond: it is
  // flat sand instead. Its cells then span a level at most still: a corner at
  // -1 in a shaded cell has cell-mates at -1 or 0.
  // On the builder's outermost line of corners this asks of the ring of
  // corners round the builder, which hang on crest cells laid two beyond it
  // (whose `open` looks three beyond) and on level ground three beyond: past
  // the frame of the piece beside, in its interior, out of this piece's
  // sight. So the builder's outermost ring of cells may be shaded otherwise
  // than the piece beside shades them, at the corners on that line and only
  // as -1 against 0 (the tests pin it). Nothing drawn reads that ring: a
  // piece's own cells lie MARGIN in, every corner inside the outermost line
  // is decided alike in both pieces, and the verges laid after look only at
  // the roads.
  const lone = []
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    const k = ki(x, y), se = ci(x, y)
    if (corner[k] !== -1 || corner[k - 1] === -1 || corner[k + 1] === -1 || corner[k - W1] === -1 || corner[k + W1] === -1) continue
    if (!(crested[se] | crested[se - 1] | crested[se - CW] | crested[se - CW - 1])) lone.push(k)
  }
  for (const k of lone) corner[k] = 0
  // (each cell reads only its own ground, so it is written in place; the
  // palette index of each shading tile is kept by its corners and ripples,
  // and of each crest tile by its corners and variant)
  const shadeIndex = new Map(), duneIndex = []
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = ki(x, y), nw = corner[k], ne = corner[k + 1], se = corner[k + W1 + 1], sw = corner[k + W1]
    const g = b.ground[y][x], i = ci(x, y)
    if (crested[i]) {
      const v = pick(seed, X0 + x, Y0 + y, 7140, DUNE_VARIANTS)
      const key = (nw + 1) * 64 + (ne + 1) * 16 + (se + 1) * 4 + sw + 1
      b.ground[y][x] = duneIndex[key * DUNE_VARIANTS + v] ??= b.skin(duneSkin([nw, ne, se, sw], v))
      n++
      continue
    }
    const r = ripple[g]
    if (!r || !(nw | ne | se | sw)) continue
    const key = g * 256 + (nw + 1) * 64 + (ne + 1) * 16 + (se + 1) * 4 + sw + 1
    let to = shadeIndex.get(key)
    if (to === undefined) shadeIndex.set(key, to = b.skin(shadeSkin([nw, ne, se, sw], +r[1], +r[2])))
    b.ground[y][x] = to
  }
  return n
}
