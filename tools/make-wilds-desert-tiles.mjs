// Draws the desert's art into renderer/assets/tiles/ (renderer/wilds/desert-art.js
// lists the names and lays the ground):
//
//   ow_sand_ripple_<o>_<v>       sand swept by the wind: ow_sand_0's colour with
//                                ripples across the wind, family o of RIPPLES,
//                                variant v
//   ow_hardpan_cracked_<m>_<v>   baked clay, crossed by a crack on each side
//                                in m (1 N / 2 E / 4 S / 8 W): the cracks of
//                                neighbouring cells meet into a net
//   ow_hardpan_edge_<M>_<D>_<v>  the clay with sand drifted over it from the
//                                sides and corners that are not clay
//
// In the colours of the Kenney tiles beside them: the sand of ow_sand_0
// (#e6dabf, #d9caa9) with one paler tone for a ripple's lit face, and the
// clay of ow_hardpan_0/1 (#c66527 and its shades, #914a1e for a crack).
//
// How they join:
//   ripples   a family's crest lines are a*x + b*y = c (mod P) with P a whole
//             fraction of 16, the same c in every variant, so a line leaving
//             one tile enters the next where that tile's line begins. A
//             variant breaks its lines into other dashes, and bows only
//             those that lie two pixels clear of every border.
//   cracks    a crack crosses a side at its middle (CROSS), the same in every
//             tile, so a crack leaving one cell enters the next; which sides
//             a cell's cracks cross is desert-art.js's to say, the same for
//             both cells of a border. An edge tile has no crack on its border.
//   edges     the shapes of the road verges (tools/make-wilds-road-tiles.mjs):
//             along an open side a band of sand as deep as a ragged profile
//             that is END px at both ends, filled across to the diagonal
//             between two open sides, a rounded nibble END px along each
//             border at a corner open alone. On an open side the sand runs
//             along the whole border (the sand cell beyond is sand to its
//             edge); on a closed side exactly within END px of an open
//             side's border, where the next edge tile carries the band on.
//             Past the sand the clay is dusted, thinning out over three
//             pixels, and a hairline crack under it is silted up. The check
//             below holds every tile to that.
//
//   node tools/make-wilds-desert-tiles.mjs [--sheet sheet.png]
//
// --sheet also writes a contact sheet at 4x: every tile, a field of each
// ripple family in its mixed variants, and a flat of hardpan in sand laid by
// desert-art.js's own edgeHardpan.
import { writePng } from './png-write.mjs'
import { EDGE_SHAPES } from '../renderer/terrain/edges.js'
import { MapBuilder } from '../renderer/terrain/lib.js'
import {
  RIPPLES, SAND_VARIANTS, HARDPAN_VARIANTS, rippleSkin, crackedSkin, hardpanEdgeSkin, edgeHardpan,
} from '../renderer/wilds/desert-art.js'

const T = 16
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
// a number in [0, 1) from the arguments: the same tile every run
const unit = (...k) => {
  let h = 0x811c9dc5
  for (const v of k) { h = Math.imul(h ^ (v | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12 }
  return (h >>> 0) / 4294967296
}
const tiles = new Map()   // name -> rgba, for the sheet
const save = (name, rgba) => {
  writePng(new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname, T, T, rgba)
  tiles.set(name, rgba)
}
const paint = colours => {
  const rgba = new Uint8Array(T * T * 4)
  for (let i = 0; i < T * T; i++) rgba.set([...hex(colours[i]), 255], i * 4)
  return rgba
}

// ---- rippled sand -------------------------------------------------------------
const SAND = { base: '#e6dabf', shade: '#d9caa9', lit: '#eee6d2' }
// the phase of every family's lines
const PHASE = 0.4

// Crest pixels of family f, variant v: one pixel per column and line for a
// family closer to horizontal, else one per row. A line is laid as dashes of
// 3-7 px with gaps of 3-5, its pattern begun before the tile so that dashes
// run over the border; a dash that lies wholly inside the tile, two pixels
// clear of every border, is bowed a pixel towards the light in its middle,
// the crest of one ripple. `lit` are the pixels of its lit face.
// Family f's lines: `flat` if it is walked along x, how many `lines` cross a
// column (a row), and `at(k, s)`, where line k crosses column (row) s.
function family(f) {
  const { a, b, P } = RIPPLES[f]
  const flat = Math.abs(b) >= Math.abs(a)
  // along: the axis walked (x for a flat family); across: the other
  const [p, q] = flat ? [a, b] : [b, a]
  const lines = Math.round(T * Math.abs(q) / P)
  const at = (k, s) => { const t = (PHASE * P + k * P - p * (s + 0.5)) / q - 0.5; return ((Math.round(t) % T) + T) % T }
  return { flat, lines, at }
}
function crests(f, v) {
  const { flat, lines, at } = family(f)
  const xy = (s, t) => flat ? [s, t] : [t, s]
  const cells = [], lit = []
  for (let k = 0; k < lines; k++) {
    let s = -Math.floor(unit(f, v, k, 4) * 8), on = unit(f, v, k, 5) < 0.6
    while (s < T) {
      const len = on ? 3 + Math.floor(unit(f, v, k, 6, s + 20) * 5) : 3 + Math.floor(unit(f, v, k, 7, s + 20) * 3)
      if (on) {
        const span = Array.from({ length: len }, (_, i) => s + i)
        const bow = len >= 4 && s >= 2 && s + len - 1 <= T - 3 && span.every(ss => at(k, ss) >= 3 && at(k, ss) <= T - 4)
        for (const ss of span) {
          if (ss < 0 || ss >= T) continue
          const mid = bow && ss > s && ss < s + len - 1
          const t = at(k, ss) - (mid ? 1 : 0)
          cells.push(xy(ss, t))
          if (mid && unit(f, v, k, 8, ss) < 0.7) lit.push(xy(ss, t - 1))
        }
      }
      s += len; on = !on
    }
  }
  return { cells, lit }
}

function rippleTile(f, v) {
  const col = new Array(T * T).fill(SAND.base)
  const { cells, lit } = crests(f, v)
  for (const [x, y] of lit) col[y * T + x] = SAND.lit
  for (const [x, y] of cells) col[y * T + x] = SAND.shade
  // on the outer pixel nothing but the family's own lines, unbowed
  const { flat, lines, at } = family(f)
  const onLine = new Set()
  for (let k = 0; k < lines; k++) for (let s = 0; s < T; s++) onLine.add(flat ? at(k, s) * T + s : s * T + at(k, s))
  for (let i = 0; i < T; i++) for (const [x, y] of [[i, 0], [i, T - 1], [0, i], [T - 1, i]]) {
    const c = col[y * T + x]
    if (c === SAND.lit || (c === SAND.shade && !onLine.has(y * T + x))) throw new Error(`${rippleSkin(f, v)}: off its lines on border pixel ${x},${y}`)
  }
  // and a line leaving the tile along its run enters the next where one of its lines begins
  const starts = new Set(Array.from({ length: lines }, (_, k) => at(k, 0)))
  for (let k = 0; k < lines; k++) if (!starts.has(at(k, T))) throw new Error(`${rippleSkin(f, v)}: line ${k} does not run on into the next tile`)
  return paint(col)
}

for (let f = 0; f < RIPPLES.length; f++) for (let v = 0; v < SAND_VARIANTS; v++) save(rippleSkin(f, v), rippleTile(f, v))

// ---- cracked hardpan ----------------------------------------------------------
const CLAY = { base: '#c66527', dark: '#b65e26', lit: '#d27134', crack: '#914a1e', fleck: '#e9ac35', grit: '#cb942a' }
// a one-pixel line (Bresenham's)
function line([x0, y0], [x1, y1], put) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0)
  let x = x0, y = y0, e = dx + dy
  for (;;) {
    put(x, y)
    if (x === x1 && y === y1) return
    const e2 = 2 * e
    if (e2 >= dy) { e += dy; x += sx }
    if (e2 <= dx) { e += dx; y += sy }
  }
}
// Which pixels of the cracked tile (m, v) are crack. Each side in m is
// crossed at its middle (CROSS); the crack leaves the border square to it,
// wanders to a junction near the tile's middle, and meets the others there.
// A crack that crosses only one side ends at the junction in a fork; a tile
// crossed by none has at most a hairline. A crack may put out a spur.
const CROSS = { x: 7, y: 8 }
function crackMask(m, v) {
  const mask = new Uint8Array(T * T)
  const put = (x, y) => { mask[y * T + x] = 1 }
  const key = [m, v, 40]
  const clamp = n => Math.max(1, Math.min(T - 2, Math.round(n)))
  const j = [clamp(CROSS.x + (unit(...key, 1) - 0.5) * 8), clamp(CROSS.y + (unit(...key, 2) - 0.5) * 8)]
  const legs = []
  for (const [bit, from, inward] of [[1, [CROSS.x, 0], [0, 1]], [2, [T - 1, CROSS.y], [-1, 0]], [4, [CROSS.x, T - 1], [0, -1]], [8, [0, CROSS.y], [1, 0]]]) {
    if (!(m & bit)) continue
    const a = [from[0] + inward[0] * 2, from[1] + inward[1] * 2]
    // halfway to the junction, pushed aside up to two and a half pixels
    const side = (unit(...key, 10 + bit) - 0.5) * 5
    const mid = [clamp((a[0] + j[0]) / 2 + inward[1] * side), clamp((a[1] + j[1]) / 2 + inward[0] * side)]
    line(from, a, put); line(a, mid, put); line(mid, j, put)
    legs.push([a, mid])
  }
  if (legs.length === 1) {
    // a crack that ends: a fork at its end
    const [, mid] = legs[0], ang = Math.atan2(j[1] - mid[1], j[0] - mid[0])
    for (const turn of [-0.7, 0.7]) line(j, [clamp(j[0] + Math.cos(ang + turn) * 2), clamp(j[1] + Math.sin(ang + turn) * 2)], put)
  }
  if (legs.length === 0 && unit(...key, 3) < 0.6) {
    const ang = unit(...key, 4) * Math.PI * 2, len = 2 + unit(...key, 5) * 2
    const a = [clamp(j[0] - Math.cos(ang) * len), clamp(j[1] - Math.sin(ang) * len)], c = [clamp(j[0] + Math.cos(ang + 0.6) * len), clamp(j[1] + Math.sin(ang + 0.6) * len)]
    line(a, j, put); line(j, c, put)
  }
  // spurs off the middle of a leg
  for (const [i, [a, mid]] of legs.entries()) {
    if (unit(...key, 20 + i) > 0.45) continue
    const ang = Math.atan2(mid[1] - a[1], mid[0] - a[0]) + (unit(...key, 25 + i) < 0.5 ? 1 : -1) * 1.1
    line(mid, [clamp(mid[0] + Math.cos(ang) * 2.5), clamp(mid[1] + Math.sin(ang) * 2.5)], put)
  }
  // on the outer pixel only the crossings of m
  for (let i = 0; i < T; i++) for (const [x, y] of [[i, 0], [i, T - 1], [0, i], [T - 1, i]]) {
    const want = (y === 0 && x === CROSS.x && m & 1) || (x === T - 1 && y === CROSS.y && m & 2) || (y === T - 1 && x === CROSS.x && m & 4) || (x === 0 && y === CROSS.y && m & 8)
    if (!!mask[y * T + x] !== !!want) throw new Error(`${crackedSkin(m, v)}: a crack ${want ? 'missing' : 'stray'} on border pixel ${x},${y}`)
  }
  return mask
}
function clayColours(m, v) {
  const mask = crackMask(m, v)
  const col = new Array(T * T).fill(CLAY.base)
  const isCrack = (x, y) => x >= 0 && y >= 0 && x < T && y < T && mask[y * T + x]
  // a few darker blotches, as on the pack's hardpan
  const blot = new Uint8Array(T * T)
  for (let k = 0; k < 3; k++) {
    const bx = 1 + Math.floor(unit(v, 33, k) * 13), by = 1 + Math.floor(unit(v, 34, k) * 13), bw = 2 + (unit(v, 35, k) < 0.4 ? 1 : 0)
    for (let y = by; y < by + bw && y < T; y++) for (let x = bx; x < bx + bw && x < T; x++) blot[y * T + x] = 1
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = y * T + x
    if (mask[i]) { col[i] = CLAY.crack; continue }
    // light from the upper left: the lip below or right of a crack catches it, the one above or left is in shade
    if ((isCrack(x - 1, y) || isCrack(x, y - 1)) && unit(m, v, 30, x, y) < 0.6) col[i] = CLAY.lit
    else if ((isCrack(x + 1, y) || isCrack(x, y + 1)) && unit(m, v, 31, x, y) < 0.4) col[i] = CLAY.dark
    else if (blot[i]) col[i] = CLAY.dark
    else {
      const r = unit(v, 32, x, y)
      if (r < 0.01) col[i] = CLAY.fleck
      else if (r < 0.025) col[i] = CLAY.grit
    }
  }
  return { col, mask }
}
for (let m = 0; m < 16; m++) for (let v = 0; v < HARDPAN_VARIANTS; v++) save(crackedSkin(m, v), paint(clayColours(m, v).col))

// ---- hardpan edges --------------------------------------------------------------
const END = 4
const DUST = { light: '#d9ab82', heavy: '#d18e5c', silt: '#b87a4f' }
const SIDES = [
  [1, (x, y) => y, (x, y) => x],             // N
  [2, (x, y) => T - 1 - x, (x, y) => y],     // E
  [4, (x, y) => T - 1 - y, (x, y) => x],     // S
  [8, (x, y) => x, (x, y) => y],             // W
]
const CORNERS = [[1, 1, 2], [2, 4, 2], [4, 4, 8], [8, 1, 8]]
const sideOf = bit => SIDES.find(s => s[0] === bit)
// a band's depth along a side: END at both ends, wandering between 2 and 7
function profile(...key) {
  const ctl = [END, ...[1, 2, 3, 4].map(k => 2 + unit(...key, k) * 5), END]
  return Array.from({ length: T }, (_, i) => {
    if (i === 0 || i === T - 1) return END
    const f = i / (T - 1) * 5, k = Math.min(4, Math.floor(f)), t = f - k
    const s = t * t * (3 - 2 * t)
    const w = ctl[k] * (1 - s) + ctl[k + 1] * s + (unit(...key, 10 + i) < 0.3 ? (unit(...key, 30 + i) < 0.5 ? -1 : 1) : 0)
    return Math.max(2, Math.min(7, Math.round(w)))
  })
}
function edgeTile(M, D, v) {
  const key = [M, D, v, 77]
  const open = SIDES.filter(([bit]) => M & bit).length
  const sand = new Uint8Array(T * T)
  const bands = SIDES.filter(([bit]) => M & bit).map(([bit, dist, along]) => ({ dist, along, depth: profile(...key, bit) }))
  // between two open sides, sand across to the diagonal (short of it when
  // three or four sides are open, so a lone cell keeps a little clay)
  const short = open >= 3 ? 4 : 0
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
      if (da + dc < T - 1 - short + ch.wob[k] * (1 - t) + ch.wob[k + 1] * t) on = true
    }
    for (const n of nibbles) if ((n.a(x, y) + 0.5) ** 2 + (n.c(x, y) + 0.5) ** 2 < (END + 0.3) ** 2) on = true
    if (on) sand[y * T + x] = 1
  }
  const { col: clay, mask } = clayColours(0, v)
  const col = clay.slice()
  // how far each clay pixel is from the sand (4-way steps), out to 4
  const far = new Uint8Array(T * T).fill(9)
  const queue = []
  for (let i = 0; i < T * T; i++) if (sand[i]) { far[i] = 0; queue.push(i) }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % T, y = (i / T) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * T + nx
      if (nx < 0 || ny < 0 || nx >= T || ny >= T || far[j] <= far[i] + 1) continue
      far[j] = far[i] + 1
      if (far[j] < 4) queue.push(j)
    }
  }
  const border = (x, y) => x === 0 || y === 0 || x === T - 1 || y === T - 1
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = y * T + x, d = far[i]
    if (d === 0) {
      // sand, specked like ow_sand_0; at its rim, off the border, the clay shows through here and there
      const rim = !border(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => far[(y + dy) * T + x + dx] === 1)
      col[i] = rim && unit(...key, 60, x, y) < 0.15 ? DUST.light : unit(...key, 61, x, y) < 0.06 ? SAND.shade : SAND.base
      continue
    }
    if (d > 3) continue
    if (mask[i]) { col[i] = unit(...key, 62, x, y) < [0, 0.9, 0.6, 0.3][d] ? DUST.silt : CLAY.crack; continue }
    const r = unit(...key, 63, x, y)
    if (r < [0, 0.7, 0.15, 0][d]) col[i] = DUST.light
    else if (r < [0, 0.95, 0.6, 0.18][d]) col[i] = DUST.heavy
  }
  // the sand on the outer pixel: all along an open side; on a closed side
  // exactly within END px of an open side's border, or of the other border
  // at a nibble's corner
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    for (const [bit, dist] of SIDES) {
      if (dist(x, y) !== 0) continue
      const want = (M & bit) || SIDES.some(([b2, dist2]) => (M & b2) && dist2(x, y) < END)
        || CORNERS.some(([cb, a, c]) => (D & cb) && (a === bit || c === bit) && sideOf(a === bit ? c : a)[1](x, y) < END)
      if (!!sand[y * T + x] !== !!want) throw new Error(`${hardpanEdgeSkin(M, D, v)}: the sand is ${sand[y * T + x] ? '' : 'not '}on border pixel ${x},${y}`)
    }
  }
  return paint(col)
}
let edges = 0
for (const [M, D] of EDGE_SHAPES) for (let v = 0; v < HARDPAN_VARIANTS; v++) { save(hardpanEdgeSkin(M, D, v), edgeTile(M, D, v)); edges++ }
console.log(`wrote ${RIPPLES.length * SAND_VARIANTS} sand, ${16 * HARDPAN_VARIANTS} cracked hardpan and ${edges} hardpan edge tiles`)

// ---- the contact sheet ------------------------------------------------------------
const sheetAt = process.argv.indexOf('--sheet')
if (sheetAt >= 0) {
  const out = process.argv[sheetAt + 1]
  if (!out) throw new Error('--sheet needs a file name')
  const Z = 4, GAP = 4
  const blocks = []   // { x, y, cells: [[name|null]] } in tile units, laid out below
  let cy = 0
  const row = list => { blocks.push({ x: 0, y: cy, cells: [list] }); cy += 1 }
  const grid = (cells, x = 0) => { blocks.push({ x, y: cy, cells }); return cells.length }
  // every ripple tile, a family a row
  for (let f = 0; f < RIPPLES.length; f++) row(Array.from({ length: SAND_VARIANTS }, (_, v) => rippleSkin(f, v)))
  cy += 0.5
  // each family as a field of its variants, picked as desert-art.js picks
  // them: a hash of the column plus a hash of the row
  const mix = (x, y) => (Math.floor(unit(x, 1) * SAND_VARIANTS) + Math.floor(unit(y, 2) * SAND_VARIANTS)) % SAND_VARIANTS
  for (let f = 0; f < RIPPLES.length; f++) grid(Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) => rippleSkin(f, mix(x, y)))), f * 6.5)
  cy += 6.5
  // the cracked clay, a crossing mask a column
  for (let v = 0; v < HARDPAN_VARIANTS; v++) row(Array.from({ length: 16 }, (_, m) => crackedSkin(m, v)))
  cy += 0.5
  // the edges, twelve shapes a row
  for (let i = 0; i < EDGE_SHAPES.length; i += 12) for (let v = 0; v < HARDPAN_VARIANTS; v++) row(EDGE_SHAPES.slice(i, i + 12).map(([M, D]) => hardpanEdgeSkin(M, D, v)))
  cy += 0.5
  // a flat of hardpan in sand, laid by edgeHardpan
  const FLAT = [
    '........................', '.......HHHH.............', '.....HHHHHHHH...........', '....HHHHHHHHHHH......H..',
    '...HHHHHHHHHHHHH........', '...HHHHHHHHHHHHHH.......', '....HHHHHHHHHHHH....HH..', '.....HHHHH..HHHH...HHHH.',
    '......HHH....HH.....HH..', '.H......................', '........................',
  ]
  const b = new MapBuilder('sheet', 'sheet', 'sheet', FLAT[0].length, FLAT.length)
  FLAT.forEach((r, y) => [...r].forEach((ch, x) => { b.ground[y][x] = b.skin(ch === 'H' ? 'ow_hardpan_0' : rippleSkin(2, mix(x, y))) }))
  edgeHardpan(b, { X0: 0, Y0: 0, seed: 1 })
  grid(b.ground.map(r => r.map(i => b.palette[i])))
  cy += FLAT.length
  const W = Math.ceil(Math.max(...blocks.map(b => b.x + b.cells[0].length))) * T * Z + GAP * 2
  const H = Math.ceil(cy) * T * Z + GAP * 2
  const px = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) px.set([24, 24, 32, 255], i * 4)
  for (const blk of blocks) blk.cells.forEach((r, ty) => r.forEach((name, tx) => {
    if (!name) return
    const src = tiles.get(name)
    if (!src) throw new Error(`no tile ${name} for the sheet`)
    const ox = GAP + Math.round((blk.x + tx) * T * Z), oy = GAP + Math.round((blk.y + ty) * T * Z)
    for (let y = 0; y < T * Z; y++) for (let x = 0; x < T * Z; x++) {
      const s = (((y / Z) | 0) * T + ((x / Z) | 0)) * 4
      px.set(src.subarray(s, s + 4), ((oy + y) * W + ox + x) * 4)
    }
  }))
  writePng(out, W, H, px)
  console.log(`wrote ${out}`)
}
