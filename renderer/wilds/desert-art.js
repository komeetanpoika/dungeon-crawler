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
//   dunes          ow_dune_<m>_<v> (desert.js DUNE_PREFIX) on a crest cell: a
//                  walkable cell that hides what lies behind it. The crests
//                  run across the wind, lit on the side towards the light
//                  (the upper left, as for the mountains and the furniture)
//                  and in shade on the slip face beyond; m the sides 1 N /
//                  2 E / 4 S / 8 W where the crest runs on into the next
//                  crest cell. crestAt is the field, layDunes lays it.
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
import { DUNE_PREFIX, inGentleRing } from './desert.js'

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
// (kept apart from DESERT_SKINS: a dune is the one desert ground that hides what is behind it)
export const DUNE_VARIANTS = 3
export const duneSkin = (m, v) => `${DUNE_PREFIX}${m}_${v}`
export const DUNE_SKINS = Array.from({ length: 16 }, (_, m) => Array.from({ length: DUNE_VARIANTS }, (_, v) => duneSkin(m, v))).flat()
export const isDuneSkin = n => typeof n === 'string' && n.startsWith(DUNE_PREFIX)

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
// (and with and without its dunes: off, terrain.js lays none)
let duned = true
export function setDunes(on) { duned = !!on }
export const dunesOn = () => duned

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
// The dune field. Wave kernels on a jittered grid of world tiles, each a
// train of crests square to the wind where it stands (windAt, turned up to
// DUNE.turn either way by a hash) and DUNE.spacing apart by a slow field, are
// summed as complex numbers (phasor noise): the sum's phase climbs steadily
// downwind, over a windward slope, and wraps once a crest. Where kernels of
// slightly other bearing meet, a crest forks or ends, as dunes do. Summed
// kernel by kernel round their own middles, the waves follow the wind's turns
// anywhere in the world without the drift a rotated grid of world tiles
// would build up far from home.
//
// A crest cell is a cell on the high side of a wrap (phase at least half)
// with any of its eight neighbours on the low side (the phase drops by more
// than half to it): the band one to two cells wide along the wrap, two where
// it runs slantwise, and always edge to edge, so no sight line slips between
// two crest cells that touch only at a corner. Where a band would still do so
// (at a fork, or where it is cut off) the cell between them that lies higher
// on the wave is filled; where neither may be, the lower of the two crest
// cells goes.
//
// Crests lie only where every tile within DUNE.desert is desert, so the
// desert's edge stays open, never in the gentle ring round home, and never
// within DUNE.city of Kalevanlinna's pieces (the city lays its own outskirts).
export const DUNE = { lattice: 12, reach: 20, spacing: [11, 17], turn: 15 * Math.PI / 180, desert: 4, city: 8 }
// how far round a rectangle crestField looks at the country
export const DUNE_LOOK = DUNE.desert + 1
const TAU = 2 * Math.PI
const CITY_BOX = {
  x0: CITY.wx0 * PIECE - DUNE.city, x1: (CITY.wx0 + CITY.pieces) * PIECE + DUNE.city,
  y0: CITY.wy0 * PIECE - DUNE.city, y1: (CITY.wy0 + CITY.pieces) * PIECE + DUNE.city,
}

// The wave's phase in [0, 1) at every tile of the w x h rectangle at (x0, y0).
function dunePhase(seed, x0, y0, w, h) {
  const { lattice: L, reach: R, spacing: [lo, hi], turn } = DUNE
  const re = new Float64Array(w * h), im = new Float64Array(w * h)
  for (let j = Math.floor((y0 - R) / L); j <= Math.floor((y0 + h + R) / L); j++)
    for (let i = Math.floor((x0 - R) / L); i <= Math.floor((x0 + w + R) / L); i++) {
      const cx = (i + hashInt(seed, i, j, 7201) / 4294967296) * L
      const cy = (j + hashInt(seed, i, j, 7202) / 4294967296) * L
      const ya = Math.max(y0, Math.ceil(cy - R)), yb = Math.min(y0 + h - 1, Math.floor(cy + R))
      if (ya > yb || cx + R < x0 || cx - R > x0 + w - 1) continue
      const wind = windAt(seed, cx, cy) + (2 * hashInt(seed, i, j, 7203) / 4294967296 - 1) * turn
      const k = TAU / (lo + (hi - lo) * noise2(seed + 7204, cx, cy, { freq: 1 / 120, octaves: 1 }))
      const kx = Math.cos(wind) * k, ky = Math.sin(wind) * k
      const ph = hashInt(seed, i, j, 7205) / 4294967296 * TAU
      // along a row the wave turns by kx a tile: rotate rather than call cos
      // and sin, always from the row's first tile in the kernel's reach, so a
      // tile's phase is the same to the last bit whatever rectangle is asked
      const sx = Math.cos(kx), sy = Math.sin(kx)
      for (let y = ya; y <= yb; y++) {
        const dy = y - cy, half = Math.sqrt(R * R - dy * dy)
        const xs = Math.ceil(cx - half), xb = Math.min(x0 + w - 1, Math.floor(cx + half))
        if (Math.max(x0, xs) > xb) continue
        const a = (xs - cx) * kx + dy * ky + ph
        let c = Math.cos(a), s = Math.sin(a), o = (y - y0) * w + xs - x0
        for (let x = xs; x <= xb; x++, o++) {
          const dx = x - cx, t = 1 - (dx * dx + dy * dy) / (R * R)
          if (t > 0 && x >= x0) { re[o] += t * t * c; im[o] += t * t * s }
          const c2 = c * sx - s * sy
          s = s * sx + c * sy; c = c2
        }
      }
    }
  const q = new Float64Array(w * h)
  for (let o = 0; o < w * h; o++) { const a = Math.atan2(im[o], re[o]) / TAU; q[o] = a < 0 ? a + 1 : a }
  return q
}

// Where a crest may lie, for every tile of the rectangle: 1 or 0. `country`
// is layout.js biomeAt for the tiles within DUNE.desert of the rectangle.
function duneGround(seed, x0, y0, w, h, country) {
  const r = DUNE.desert, bw = w + 2 * r, bh = h + 2 * r
  country ??= biomeSampler(seed, x0 - r, y0 - r, x0 + w - 1 + r, y0 + h - 1 + r)
  // how many tiles not desert above and left of each corner of the grid, to count any square at once
  const sum = new Int32Array((bw + 1) * (bh + 1))
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const not = country(x0 - r + x, y0 - r + y) === 'desert' ? 0 : 1
    sum[(y + 1) * (bw + 1) + x + 1] = not + sum[y * (bw + 1) + x + 1] + sum[(y + 1) * (bw + 1) + x] - sum[y * (bw + 1) + x]
  }
  const ok = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y
    if (inGentleRing(Math.floor(X / PIECE), Math.floor(Y / PIECE))) continue
    if (X >= CITY_BOX.x0 && X < CITY_BOX.x1 && Y >= CITY_BOX.y0 && Y < CITY_BOX.y1) continue
    // the square of side 2r + 1 round (X, Y): its corners in `sum` are (x, y) and (x + 2r + 1, y + 2r + 1)
    const a = y * (bw + 1) + x, d = (y + 2 * r + 1) * (bw + 1) + x + 2 * r + 1
    const b = y * (bw + 1) + x + 2 * r + 1, c = (y + 2 * r + 1) * (bw + 1) + x
    if (sum[d] - sum[b] - sum[c] + sum[a] === 0) ok[y * w + x] = 1
  }
  return ok
}

// The crest field for every tile of the w x h rectangle at (x0, y0): 1 on a
// crest, else 0. What crestAt says of each tile, worked out at once.
// `country`, if given, is biomeAt (seed's) for the tiles within DUNE_LOOK
// of the rectangle: a caller that has them at hand saves the looking up.
export function crestField(seed, x0, y0, w, h, { country = null } = {}) {
  const out = new Uint8Array(w * h)
  // grids one tile wider all round (g), and two (p): a crest looks at its
  // neighbours, and the fill at its neighbours' crests
  const gw = w + 2, gh = h + 2, pw = w + 4
  const ground = duneGround(seed, x0 - 1, y0 - 1, gw, gh, country)
  if (!ground.includes(1)) return out
  const q = dunePhase(seed, x0 - 2, y0 - 2, pw, h + 4)
  const Q = (x, y) => q[(y + 2) * pw + x + 2]   // x, y from -2
  const G = (x, y) => ground[(y + 1) * gw + x + 1] === 1   // from -1
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
  const CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on
    if (R(x, y)) {
      // gone if it touches another crest cell only at a corner, where neither cell between may be crest, and lies the lower
      on = !CORNERS.some(([sx, sy]) => R(x + sx, y + sy) && !R(x + sx, y) && !R(x, y + sy) && !G(x + sx, y) && !G(x, y + sy) && over(x + sx, y + sy, x, y))
    } else {
      // filled if it lies between two crest cells that touch only at a corner, and higher than the other cell between (or that one may not be crest)
      on = G(x, y) && CORNERS.some(([sx, sy]) => R(x + sx, y) && R(x, y + sy) && !R(x + sx, y + sy) && (!G(x + sx, y + sy) || over(x, y, x + sx, y + sy)))
    }
    if (on) out[y * w + x] = 1
  }
  return out
}

// Is world tile (X, Y) on a crest?
export const crestAt = (seed, X, Y) => crestField(seed, X, Y, 1, 1)[0] === 1

// Lay the dunes. `b` is a terrain/lib.js MapBuilder; (X0, Y0) is the world
// tile of builder cell (0, 0). Every crest cell for which `open(x, y)` holds
// takes a crest's ground, shaped by the crest cells laid round it. `open` is
// asked of builder cells and of the ring of cells just outside the builder,
// whose crests shape the builder's outer cells: the caller says whether a
// crest may lie there (on sand, off the ways, the sites and what stands).
// `country` as for crestField, out to DUNE_LOOK + 1 tiles round the builder.
// Ground only. Returns how many cells took a crest.
export function layDunes(b, { X0, Y0, seed, open, country = null }) {
  const { w, h } = b, W = w + 2
  const crest = crestField(seed, X0 - 1, Y0 - 1, W, h + 2, { country })
  if (!crest.includes(1)) return 0
  const laid = new Uint8Array(crest.length)
  for (let i = 0; i < crest.length; i++) if (crest[i] && open(i % W - 1, Math.floor(i / W) - 1)) laid[i] = 1
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y + 1) * W + x + 1
    if (!laid[i]) continue
    const m = (laid[i - W] ? 1 : 0) | (laid[i + 1] ? 2 : 0) | (laid[i + W] ? 4 : 0) | (laid[i - 1] ? 8 : 0)
    b.ground[y][x] = b.skin(duneSkin(m, pick(seed, X0 + x, Y0 + y, 7140, DUNE_VARIANTS)))
    n++
  }
  return n
}
