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
// Everything here is pure in the world tile (and the seed): the wind, the
// pick, and the hardpan's tiles, which are decided from the finished ground
// of a cell and of the cells up to two away, the same in a piece and in its
// neighbour's margin wherever both hold the cell and those round it.
import { EDGE_SHAPES } from '../terrain/edges.js'
import { hashInt, noise2 } from './rand.js'

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

export const rippleSkin = (o, v) => `ow_sand_ripple_${o}_${v}`
export const crackedSkin = (m, v) => `ow_hardpan_cracked_${m}_${v}`
export const hardpanEdgeSkin = (M, D, v) => `ow_hardpan_edge_${M}_${D}_${v}`
export const SAND_SKINS = RIPPLES.flatMap((_, o) => Array.from({ length: SAND_VARIANTS }, (_, v) => rippleSkin(o, v)))
export const HARDPAN_SKINS = Array.from({ length: 16 }, (_, m) => Array.from({ length: HARDPAN_VARIANTS }, (_, v) => crackedSkin(m, v))).flat()
export const HARDPAN_EDGES = EDGE_SHAPES.flatMap(([M, D]) => Array.from({ length: HARDPAN_VARIANTS }, (_, v) => hardpanEdgeSkin(M, D, v)))
export const DESERT_SKINS = [...SAND_SKINS, ...HARDPAN_SKINS, ...HARDPAN_EDGES]

export const isRippleSkin = n => typeof n === 'string' && n.startsWith('ow_sand_ripple_')
// any hardpan: the pack's own tiles, the cracked clay and its edges
export const isHardpanSkin = n => typeof n === 'string' && n.startsWith('ow_hardpan')
export const isCrackedSkin = n => typeof n === 'string' && n.startsWith('ow_hardpan_cracked_')
export const isHardpanEdge = n => typeof n === 'string' && n.startsWith('ow_hardpan_edge_')

// (the tests compare a world with and without the desert's dress: off, the
// desert lays the pack's two sand tiles and its flat hardpan, as before)
let dressed = true
export function setDesertDress(on) { dressed = !!on }
export const desertDress = () => dressed

// The wind, in radians, the way it blows in world tiles (x east, y south):
// the world's own direction, swung up to WIND.swing either way by a slow
// field, so that it turns a little over a piece and more over a desert.
export const WIND = { freq: 1 / 200, swing: 50 * Math.PI / 180 }
export function windAt(seed, X, Y) {
  const base = hashInt(seed, 0, 0, 7101) / 4294967296 * 2 * Math.PI
  return base + WIND.swing * 2 * (noise2(seed + 7100, X, Y, { freq: WIND.freq, octaves: 1 }) - 0.5)
}

// The ripple family the wind at a tile sweeps.
export function rippleAt(seed, X, Y) {
  const t = ((windAt(seed, X, Y) % Math.PI) + Math.PI) % Math.PI
  let best = 0, gap = Infinity
  for (let o = 0; o < ACROSS.length; o++) {
    const d = Math.abs(t - ACROSS[o]), g = Math.min(d, Math.PI - d)
    if (g < gap) { gap = g; best = o }
  }
  return best
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
// (those cells are a margin no piece draws). Ground only; idempotent.
// Returns how many cells changed.
export function edgeHardpan(b, { X0, Y0, seed }) {
  const { w, h } = b
  const hard = b.palette.map(isHardpanSkin)
  const same = (x, y) => x < 0 || y < 0 || x >= w || y >= h || hard[b.ground[y][x]]
  // each hardpan cell's shape, (M | D << 4) + 1, or 1 for inner clay; 0 for no hardpan
  const shape = new Int16Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hard[b.ground[y][x]]) continue
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
