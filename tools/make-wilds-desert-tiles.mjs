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
//   ow_dune_<m>_<v>              a dune's crest, running on into the next crest
//                                cell across each side in m (1 N / 2 E / 4 S /
//                                8 W): the top of the windward climb lit by the
//                                light from the upper left, the crest's edge,
//                                the slip face in shade beyond it
//   ow_sand_slope_<l>_<o>_<v>    a dune's windward slope: the rippled sand of
//                                family o, variant v, a step lighter for each
//                                cell nearer the crest (l 1..3, 3 beside it)
//
// and what grows, lies and stands on it (renderer/wilds/terrain.js lays the
// plants, debris and outcrops, features.js the spires and cairns), each a
// see-through tile over the ground:
//   ow_tree_palm_top, ow_tree_palm   the palm, two cells tall (its crown over its trunk)
//   ow_cactus_barrel, _pear, _column three cacti beside the pack's ow_cactus
//   ow_shrub_dry_0..2                a twiggy bush, a sage, a thorn in flower
//   ow_deco_drygrass_0..2, ow_deco_tumbleweed, ow_deco_bones_0..1,
//   ow_deco_ribs, ow_deco_pottery_0..1   debris, walked over
//   ow_outcrop_<m>                   a cell of sandstone outcrop, running on into
//                                    the next outcrop cell across each side in m
//                                    (1 N / 2 E / 4 S / 8 W)
//   ow_landmark_spire_top, ow_landmark_spire, ow_landmark_cairn
//                                    a sandstone spire two cells tall, and a cairn
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
//   crests    a crest leaves a tile at the middle of a side in m, square to
//             it, its slopes the same width there in every tile, so it runs
//             on into the next; on a side not in m the tile is flat sand to
//             the border. Its shape: straight across for two opposite sides,
//             a 45-degree chord between two that meet (square to each side
//             for its first pixels), a spur from the side to the middle that
//             dies away for one, a low mound for none; three or four sides
//             join those. Turned to the light, the upper left, the crest's
//             side wears the top of the climb and, away from the crest, the
//             top slope's tone, which the windward cells beyond its north
//             and west sides wear; turned away, the slip face, paling to the
//             sand's own tone, which the cells beyond its south and east
//             sides wear. The wind blows towards the south-east, so the slip
//             face is the shaded side (renderer/wilds/desert-art.js windAt).
//   slopes    a ripple tile with every tone lifted alike: its ripples join
//             the bare sand's and one another's.
//
//   node tools/make-wilds-desert-tiles.mjs [--sheet sheet.png]
//
// --sheet also writes a contact sheet at 4x: every tile, a field of each
// ripple family in its mixed variants, a flat of hardpan in sand laid by
// desert-art.js's own edgeHardpan, a stretch of desert with its dunes laid by
// layDunes, and what stands on the sand, over the sand.
import { writePng } from './png-write.mjs'
import { EDGE_SHAPES } from '../renderer/terrain/edges.js'
import { MapBuilder } from '../renderer/terrain/lib.js'
import {
  RIPPLES, SAND_VARIANTS, HARDPAN_VARIANTS, DUNE_VARIANTS, WINDWARD_LEVELS, rippleSkin, crackedSkin, hardpanEdgeSkin, duneSkin, windwardSkin, edgeHardpan, layDunes, sandSkinAt,
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

function rippleTile(f, v, pal = SAND) {
  const col = new Array(T * T).fill(pal.base)
  const { cells, lit } = crests(f, v)
  for (const [x, y] of lit) col[y * T + x] = pal.lit
  for (const [x, y] of cells) col[y * T + x] = pal.shade
  // on the outer pixel nothing but the family's own lines, unbowed
  const { flat, lines, at } = family(f)
  const onLine = new Set()
  for (let k = 0; k < lines; k++) for (let s = 0; s < T; s++) onLine.add(flat ? at(k, s) * T + s : s * T + at(k, s))
  for (let i = 0; i < T; i++) for (const [x, y] of [[i, 0], [i, T - 1], [0, i], [T - 1, i]]) {
    const c = col[y * T + x]
    if (c === pal.lit || (c === pal.shade && !onLine.has(y * T + x))) throw new Error(`${rippleSkin(f, v)}: off its lines on border pixel ${x},${y}`)
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

// ---- dune crests and their windward slopes ------------------------------------------
// The sand lit towards a near-white for the slopes and the crest, darkened
// towards a deep tan for the slip face. A windward slope is the rippled sand
// of its family a step lighter for each cell nearer the crest, ripples and
// all (every tone of the ripple tile lifted alike); the crest cell carries the
// rest of the climb, its edge, and the slip face below it.
const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mixTo = (h, to, t) => toHex(hex(h).map((v, i) => v + (to[i] - v) * t))
const HIGH = [252, 249, 240], DARK = [150, 124, 82]
const SLOPE_T = [0.14, 0.28, 0.42]   // levels 1..3, the highest beside the crest
const slopePalette = l => ({ base: mixTo(SAND.base, HIGH, SLOPE_T[l - 1]), shade: mixTo(SAND.shade, HIGH, SLOPE_T[l - 1]), lit: mixTo(SAND.lit, HIGH, SLOPE_T[l - 1]) })
// the windward side of a crest cell, away from its crest, is the top slope
const TOP = slopePalette(WINDWARD_LEVELS)
const DUNE_TONE = {
  edge: mixTo(SAND.base, HIGH, 0.9), lit: mixTo(SAND.base, HIGH, 0.72), lit2: mixTo(SAND.base, HIGH, 0.56),
  under: mixTo(SAND.base, DARK, 0.62), deep: mixTo(SAND.base, DARK, 0.45), mid: mixTo(SAND.base, DARK, 0.3), shade: mixTo(SAND.base, DARK, 0.15),
}
for (let l = 1; l <= WINDWARD_LEVELS; l++) for (let f = 0; f < RIPPLES.length; f++) for (let v = 0; v < SAND_VARIANTS; v++) save(windwardSkin(l, f, v), rippleTile(f, v, slopePalette(l)))

// A crest cell's crest line, as segments [x0, y0, x1, y1, bow] in the tile's
// pixels (bow: px it is bowed by between its ends, never at them). It leaves
// the tile at the middle of each side in m, square to it, so it runs on
// into the next crest cell; on a side not in m the tile is flat to the border.
//   two opposite sides   straight across, bowed by the variant
//   two sides that meet  LEAD pixels in square from each, and a 45-degree
//                        chord between: a crest that steps a cell at a time
//                        (the common way, the wind being south-east) runs on
//                        as a slant through the cells of its band
//   one side             a spur to the middle that dies away
//   none                 a low mound
//   three, four          a straight crest across and a spur, two straights
const MID = { 1: [8, 0], 2: [16, 8], 4: [8, 16], 8: [0, 8] }
const INWARD = { 1: [0, 1], 2: [-1, 0], 4: [0, -1], 8: [1, 0] }
const LEAD = 3
function crestPath(m, A) {
  const bits = [1, 2, 4, 8].filter(b => m & b)
  const across = horizontal => horizontal ? [[0, 8, 16, 8, A]] : [[8, 0, 8, 16, A]]
  const spur = b => [{ spur: true, from: MID[b], dir: INWARD[b] }]
  if (bits.length === 0) return [{ mound: true }]
  if (bits.length === 1) return spur(bits[0])
  if (m === 5) return across(false)
  if (m === 10) return across(true)
  if (bits.length === 2) {
    const [a, c] = bits.map(b => [MID[b], [MID[b][0] + INWARD[b][0] * LEAD, MID[b][1] + INWARD[b][1] * LEAD]])
    return [[...a[0], ...a[1], 0], [...a[1], ...c[1], A], [...c[1], ...c[0], 0]]
  }
  if (bits.length === 4) return [...across(true), ...across(false)]
  const third = { 1: 4, 4: 1, 2: 8, 8: 2 }[15 & ~m]
  return [...across(third === 1 || third === 4), ...spur(third)]
}
// For a point: how far it lies from the crest line (d), the unit normal from
// the line to it (nx, ny), and the share of the crest's height it is near
// (lift: 1, less where a spur dies away, a mound's 0.6).
function nearest(path, x, y) {
  let best = null
  const take = p => { if (!best || p.d / Math.max(0.05, p.lift) < best.d / Math.max(0.05, best.lift)) best = p }
  for (const s of path) {
    if (s.mound) { const vx = x - 8, vy = y - 8, r = Math.hypot(vx, vy) || 1e-9; take({ d: r, nx: vx / r, ny: vy / r, lift: 0.6 }); continue }
    if (s.spur) {
      const [ex, ey] = s.from, [ux, uy] = s.dir
      const t = (x - ex) * ux + (y - ey) * uy, o = (x - ex) * -uy + (y - ey) * ux, end = 8
      const k = Math.min(1, Math.max(0, (t - 2) / 8.5)), lift = 1 - k * k * (3 - 2 * k)
      if (t <= end) { const sg = o < 0 ? -1 : 1; take({ d: Math.abs(o), nx: -uy * sg, ny: ux * sg, lift }); continue }
      const vx = x - (ex + ux * end), vy = y - (ey + uy * end), r = Math.hypot(vx, vy) || 1e-9
      take({ d: r, nx: vx / r, ny: vy / r, lift }); continue
    }
    const [x0, y0, x1, y1, bow] = s, len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len
    const t = (x - x0) * ux + (y - y0) * uy
    if (t < 0 || t > len) {
      // past an end: from the end (a joint with the next segment, or a side's middle)
      const [cx, cy] = t < 0 ? [x0, y0] : [x1, y1], vx = x - cx, vy = y - cy, r = Math.hypot(vx, vy) || 1e-9
      take({ d: r, nx: vx / r, ny: vy / r, lift: 1 }); continue
    }
    const off = (x - x0) * -uy + (y - y0) * ux - bow * Math.sin(Math.PI * t / len) ** 2
    const sg = off < 0 ? -1 : 1
    take({ d: Math.abs(off), nx: -uy * sg, ny: ux * sg, lift: 1 })
  }
  return best
}
// The tone a point takes from the crest line near it, or null for flat
// sand. a is how squarely its side of the line faces the light, the upper
// left (-nx - ny, kept within 1 either way): 1 square to a side of the tile,
// where a crest leaves it, and on a slant. Turned to the light: the edge
// along the crest line, then the lit top of the climb. Turned away: the slip
// face, darkest under the edge, paling towards the sand's own tone. A side
// the light only grazes keeps a thin line of shade. Square to a side a band
// ends between two pixels (the line lies between two), and every band ends
// within 6 px of the line, so none reaches a side the crest does not cross,
// bowed by a pixel or not.
const BAND = { edge: 1, lit: 2, lit2: 4, under: 2, deep: 4, mid: 5, shade: 5 }
function tone({ d, nx, ny, lift }) {
  const a = Math.max(-1, Math.min(1, -nx - ny))
  if (lift < 0.3) return null
  if (a >= 0) {
    if (d < BAND.edge) return DUNE_TONE.edge
    if (d < BAND.edge + BAND.lit * a * lift) return DUNE_TONE.lit
    if (d < BAND.edge + BAND.lit2 * a * lift) return DUNE_TONE.lit2
    return null
  }
  const t = -a
  if (d < BAND.under * t * lift) return DUNE_TONE.under
  if (d < BAND.deep * t * lift) return DUNE_TONE.deep
  if (d < BAND.mid * t * lift) return DUNE_TONE.mid
  if (d < (1 + BAND.shade * t) * lift) return DUNE_TONE.shade
  return null
}
// a 4x4 ordered dither: a pixel takes the lighter of two tones where its threshold lies below the weight
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(k => (k + 0.5) / 16)
function duneTile(m, v) {
  const path = crestPath(m, [0, 1, -1][v])
  const col = new Array(T * T).fill(SAND.base)
  const banded = new Uint8Array(T * T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const near = nearest(path, x + 0.5, y + 0.5)
    const i = y * T + x
    const c = tone(near)
    if (c) { col[i] = c; banded[i] = 1; continue }
    // flat: on the side turned to the light the top slope's tone (what the
    // windward cells beyond the north and west sides wear), beyond the slip
    // face the sand's own (what the cells beyond the south and east wear),
    // dithered from one to the other where the light only grazes the crest
    // (round a mound, past a spur's end), so no hard line runs across the
    // flat; within 3 px of a side the crest does not cross, that side's tone
    const a = -near.nx - near.ny, cx = x + 0.5, cy = y + 0.5
    const toTop = Math.min(m & 1 ? T : cy, m & 8 ? T : cx), toSand = Math.min(m & 4 ? T : T - cy, m & 2 ? T : T - cx)
    let w = Math.min(1, Math.max(0, 0.5 + a / 0.8))
    if (Math.min(toTop, toSand) < 3 && toTop !== toSand) w = toTop < toSand ? 1 : 0
    const pal = BAYER[(y % 4) * 4 + x % 4] < w ? TOP : SAND
    col[i] = near.d > 4 && unit(m, v, 90, x, y) < 0.05 ? pal.shade : pal.base   // a speck, as on ow_sand_0
  }
  // on a side the crest does not cross, flat to the border: the top slope's
  // tone on the north and west, the sand's own on the south and east (the
  // north-east and south-west corner pixels lie on one of each: either)
  for (let i = 0; i < T; i++) for (const [bit, x, y, pal] of [[1, i, 0, TOP], [2, T - 1, i, SAND], [4, i, T - 1, SAND], [8, 0, i, TOP]]) {
    if (m & bit || (x === T - 1 && y === 0) || (x === 0 && y === T - 1)) continue
    const c = col[y * T + x]
    if (banded[y * T + x] || (c !== pal.base && c !== pal.shade)) throw new Error(`${duneSkin(m, v)}: ${c} on the open border pixel ${x},${y}`)
  }
  return { rgba: paint(col), col, banded }
}
// Where a crest crosses a side, every tile that crosses it draws the same
// border pixels within CORE px of the side's middle (the edge, the lit
// climb, the slip face), specks aside: what leaves one tile is what enters
// the next.
const CORE = 4
const crossings = new Map()
for (let m = 0; m < 16; m++) for (let v = 0; v < DUNE_VARIANTS; v++) {
  const { rgba, col, banded } = duneTile(m, v)
  for (const [bit, at] of [[1, i => i], [2, i => i * T + T - 1], [4, i => (T - 1) * T + i], [8, i => i * T]]) {
    if (!(m & bit)) continue
    const line = Array.from({ length: T }, (_, i) => banded[at(i)] && Math.abs(i + 0.5 - T / 2) < CORE ? col[at(i)] : '-').join(' ')
    const was = crossings.get(bit)
    if (was === undefined) crossings.set(bit, { line, name: duneSkin(m, v) })
    else if (was.line !== line) throw new Error(`${duneSkin(m, v)} crosses side ${bit} unlike ${was.name}:\n  ${line}\n  ${was.line}`)
  }
  save(duneSkin(m, v), rgba)
}

console.log(`wrote ${RIPPLES.length * SAND_VARIANTS} sand, ${16 * HARDPAN_VARIANTS} cracked hardpan, ${edges} hardpan edge, ${16 * DUNE_VARIANTS} dune and ${WINDWARD_LEVELS * RIPPLES.length * SAND_VARIANTS} slope tiles`)

// ---- what grows and lies on the sand ------------------------------------------------
// Drawn on a see-through 16x16 grid of colours (null for nothing). The
// desert's own props stand in the style of the pack's cactus, dead trees,
// shrubs and rocks beside them (renderer/assets/tiles/ow_cactus.png and
// the rest): no outline, three tones, lit from the upper left. The palm is
// a tree, in the trees' style: Tiny Town's outline (#3f2631) round its
// leaves and trunk, as the one-cell date palm of the walled well
// (tools/make-wilds-farm-tiles.mjs, ow_tree_palm_small).
const grid = () => Array.from({ length: T }, () => new Array(T).fill(null))
const gridRgba = (g, shadow = null) => {
  const rgba = new Uint8Array(T * T * 4)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const c = g[y][x]
    if (c) rgba.set([...hex(c), 255], (y * T + x) * 4)
    else if (shadow?.[y]?.[x]) rgba.set([...hex(SHADOW.col), SHADOW.alpha], (y * T + x) * 4)
  }
  return rgba
}
// the shadow a thing casts on the sand at its foot: the sand's slip-face tone, half seen
const SHADOW = { col: '#967c52', alpha: 90 }
// A shape from a pixel map ('#' in it) shaded by its own outline: lit where
// the pixel above or to the left is not of the shape, in shade where the
// pixel below or to the right is not (two deep on the right with `deep`),
// the base tone between. Painted over what is there already, so a shape laid
// later stands in front.
function shadeShape(g, rows, pal, { deep = false } = {}) {
  const on = (x, y) => rows[y]?.[x] === '#'
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (!on(x, y)) continue
    const lit = !on(x - 1, y) || !on(x, y - 1)
    const shade = !on(x + 1, y) || !on(x, y + 1) || (deep && !on(x + 2, y))
    g[y][x] = shade ? pal.shade : lit ? pal.light : pal.base
  }
}
// A shape from an ellipse, shaded like a pixel map.
const ellipseRows = (cx, cy, rx, ry) => Array.from({ length: T }, (_, y) => Array.from({ length: T }, (_, x) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 ? '#' : '.').join(''))
// Details laid over a drawing from a pixel map: each character its colour in `pal`, '.' leaves the pixel as it is.
const detail = (g, rows, pal) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') g[y][x] = pal[ch] }))
// Tiny Town's outline round everything drawn, on the pixels beside it (four ways) that are empty.
const INK = '#3f2631'
function outline(g) {
  const add = []
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (g[y][x]) continue
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== INK)) add.push([x, y])
  }
  for (const [x, y] of add) g[y][x] = INK
}
// A thing that stands alone keeps every outer pixel see-through (`clear`),
// so it never shows a cut edge; the sides named in `joins` may carry it on.
function standsAlone(name, g, joins = '') {
  for (let i = 0; i < T; i++) for (const [side, x, y] of [['N', i, 0], ['S', i, T - 1], ['W', 0, i], ['E', T - 1, i]]) {
    if (joins.includes(side)) continue
    if (g[y][x]) throw new Error(`${name}: a stray pixel on its ${side} edge at ${x},${y}`)
  }
}
const drawn = []
const keep = (name, g, { joins = '', shadow = null } = {}) => { standsAlone(name, g, joins); save(name, gridRgba(g, shadow)); drawn.push(name) }
// where a thing stands on the sand: a shadow along the row below its foot, to the lower right
const footShadow = (g, row, from, to) => { const s = grid(); for (let x = from; x <= to; x++) if (!g[row][x]) s[row][x] = 1; return s }

// The pack's own tones: the cactus's greens, the dead trees' wood, the rocks' browns.
const CACTUS = { shade: '#648c32', base: '#7bad2c', light: '#88bd32' }
const BLOOM = { p: '#e86a92', P: '#f7b3c5', y: '#ffc90e', r: '#c43a3a', s: '#a7d65a' }

// a barrel cactus: a ribbed ball, a flower on top
{
  const g = grid()
  shadeShape(g, ellipseRows(8, 10.5, 4.6, 4.1), CACTUS, { deep: true })
  detail(g, [
    '................', '................', '................', '................', '................',
    '................',
    '.......pPp......',
    '......s.p.......',
    '.....s.s..s.....',
    '....s..s...s....',
    '....s..s...s....',
    '....s..s...s....',
    '.....s.s..s.....',
    '................',
    '................',
    '................',
  ], { ...BLOOM, s: CACTUS.shade })
  keep('ow_cactus_barrel', g, { shadow: footShadow(g, 15, 6, 12) })
}
// a prickly pear: flat pads, one growing out of the next, red fruit on their rims
{
  const g = grid()
  shadeShape(g, ellipseRows(4.5, 8.5, 2.6, 3.3), CACTUS)
  shadeShape(g, ellipseRows(11.5, 7.5, 2.6, 3.2), CACTUS)
  shadeShape(g, ellipseRows(7.5, 5.5, 2.4, 3.2), CACTUS)
  shadeShape(g, ellipseRows(8, 11.5, 3.4, 3.2), CACTUS)
  detail(g, [
    '................', '................',
    '.......r........',
    '................',
    '...r.......r....',
    '................', '................', '................',
    '.........s......',
    '......s.........',
    '...........s....',
    '................', '................', '................', '................', '................',
  ], { ...BLOOM, s: CACTUS.light })
  keep('ow_cactus_pear', g, { shadow: footShadow(g, 15, 6, 11) })
}
// a column cactus, taller than the pack's, with one arm
{
  const g = grid()
  shadeShape(g, [
    '................',
    '................',
    '.....###........',
    '....#####.......',
    '....#####.......',
    '....#####..##...',
    '....#####.####..',
    '....#####.####..',
    '....#####.####..',
    '....##########..',
    '....#########...',
    '....#####.......',
    '....#####.......',
    '....#####.......',
    '...#######......',
    '................',
  ], CACTUS, { deep: true })
  detail(g, [
    '................', '................', '................',
    '......s.........', '......s.........', '......s.........', '......s.....s...', '......s.....s...',
    '......s.........', '......s.........', '................', '......s.........', '......s.........',
    '................', '................', '................',
  ], { s: CACTUS.shade })
  detail(g, ['................', '................', '.....y..........'].concat(Array(13).fill('................')), BLOOM)
  keep('ow_cactus_column', g, { shadow: footShadow(g, 15, 4, 10) })
}

// The dry shrubs: a twiggy brown bush, a grey-green sage, a bare thorn in flower.
const DRYBUSH = { shade: '#7e6f3b', base: '#a39255', light: '#c2b277' }
const SAGE = { shade: '#6f7752', base: '#949c72', light: '#b6bd92' }
const THORN = { shade: '#7a5634', base: '#997048', light: '#b48355' }
{
  const g = grid()
  shadeShape(g, [
    '................', '................', '................', '................', '................',
    '................', '................',
    '......#...#.....',
    '...#...#.##..#..',
    '....#.#####.#...',
    '..#.#########...',
    '...##########.#.',
    '..############..',
    '...##########...',
    '....########....',
    '................',
  ], DRYBUSH)
  keep('ow_shrub_dry_0', g, { shadow: footShadow(g, 15, 5, 11) })
}
{
  const g = grid()
  shadeShape(g, [
    '................', '................', '................', '................', '................',
    '................',
    '......####......',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '.##############.',
    '..############..',
    '...##########...',
    '.....######.....',
    '................',
  ], SAGE, { deep: true })
  detail(g, [
    '................', '................', '................', '................', '................',
    '................', '................',
    '.....l...l......',
    '...l...l....l...',
    '......d....d....',
    '....d....d......',
    '..l....l.....d..',
    '.....d....d.....',
    '................', '................', '................',
  ], { l: SAGE.light, d: SAGE.shade })
  keep('ow_shrub_dry_1', g, { shadow: footShadow(g, 15, 4, 12) })
}
{
  const g = grid()
  shadeShape(g, [
    '................', '................', '................', '................',
    '..#.........#...',
    '...#...#...#....',
    '....#..#..#..#..',
    '.#...#.#.#..#...',
    '..#...###..#....',
    '...#...##.#.....',
    '....##.####.....',
    '......####......',
    '.......##.......',
    '.......##.......',
    '......####......',
    '................',
  ], THORN)
  detail(g, [
    '................', '................', '................',
    '..y.........y...',
    '.......y........',
    '.............y..',
    '.y..............',
    '................', '................', '................', '................', '................',
    '................', '................', '................', '................',
  ], BLOOM)
  keep('ow_shrub_dry_2', g, { shadow: footShadow(g, 15, 6, 10) })
}

// The palm: a crown of fronds over the top of its trunk (ow_tree_palm_top),
// and the trunk down to its foot (ow_tree_palm); drawn as one picture two
// cells tall and cut in two, so the trunk runs on across the seam.
// (the crown is the date palm's, its outline touching the sides as that one's
// does: an outline, not a cut edge)
{
  const P = { a: INK, G: '#84c669', g: '#479f4a', k: '#b48355', K: '#8f673f', o: '#c66527' }
  const top = grid(), foot = grid()
  detail(top, [
    '................',
    '...aaa....aaa...',
    '..aGGGa..aGGGa..',
    '.aGGgGGaaGGgGGa.',
    'aGGgaaGGGGaagGGa',
    'aGga.aGGGGa.agGa',
    'aga.aGGggGGa.aga',
    '.a.aGGgaagGGa.a.',
    '..aGGga..agGGa..',
    '..aGga.kK.agGa..',
    '..aga.okKo.aga..',
    '...a..oKko..a...',
    '......akKa......',
    '......aKKa......',
    '......akKa......',
    '......akKa......',
  ], P)
  detail(foot, [
    '......aKKa......',
    '......akKa......',
    '......akKa......',
    '.....akKKa......',
    '.....akKa.......',
    '.....aKKa.......',
    '.....akKa.......',
    '.....akKa.......',
    '....akKKa.......',
    '....akKa........',
    '....aKKa........',
    '....akKa........',
    '...akkKKa.......',
    '...aaaaaa.......',
    '................',
    '................',
  ], P)
  const shadow = grid()
  for (const x of [9, 10, 11]) shadow[13][x] = 1
  keep('ow_tree_palm_top', top, { joins: 'SWE' })
  keep('ow_tree_palm', foot, { joins: 'N', shadow })
}

// ---- debris on the sand, walked over ------------------------------------------------
const STRAW = { d: '#8c7238', s: '#b39550', l: '#dcc684' }
// bleached white, whiter than the sand, with the skull's grey in its shade (ow_deco_skull)
const BONE = { l: '#fbf9f3', b: '#ece8de', s: '#a8a08c', d: '#7f7663' }
const POT = { l: '#e39a5e', b: '#c66527', s: '#9e4d1c', d: '#7a3812', D: '#3f1d0b' }
const DRIFT = { a: SAND.shade, A: '#cbb88f' }
// a tuft of dry grass: blades fanning out of a dark heart
const TUFT = ['l..l..l', '.l.s.l.', '.sl.ls.', '..sds..', '.ddsdd.']
const tufts = (spots, name) => {
  const g = grid()
  for (const [x0, y0, flip] of spots) TUFT.forEach((r, dy) => [...(flip ? [...r].reverse().join('') : r)].forEach((ch, dx) => { if (ch !== '.') g[y0 + dy][x0 + dx] = STRAW[ch] }))
  keep(name, g)
}
tufts([[1, 2, false], [8, 9, true]], 'ow_deco_drygrass_0')
tufts([[7, 1, true], [1, 8, false], [8, 10, false]], 'ow_deco_drygrass_1')
tufts([[4, 6, false]], 'ow_deco_drygrass_2')
// tumbleweed: a loose ball of dry twigs, lit on its upper left
{
  const g = grid()
  detail(g, [
    '................',
    '................',
    '................',
    '.....lblbl......',
    '...ll.b..lbb....',
    '..l..bl.lb..b...',
    '..l.b..lb..b.s..',
    '.l..b.bl.bb..s..',
    '.l.b..lb.b..bs..',
    '.lb..b..bb.bs.s.',
    '..b.b.bb..bs..s.',
    '..bs..b.bbs..s..',
    '...sbb..sb..ss..',
    '.....sssss.s....',
    '................',
    '................',
  ], { l: '#c49a62', b: '#a07a4a', s: '#7d5a36' })
  keep('ow_deco_tumbleweed', g, { shadow: footShadow(g, 14, 5, 12) })
}
// bleached bones: a long bone and a short one, half in the sand
{
  const g = grid()
  detail(g, [
    '................',
    '................',
    '..ll............',
    '.lbbl...........',
    '..lbbb..........',
    '...sbbb.........',
    '....sbbb........',
    '.....sbbb.......',
    '......sbbb......',
    '.......sbbl.....',
    '........sbbl....',
    '.lbbbl.lbbbbl...',
    '.sbbbs..sdsAa...',
    '..aAa....aAa....',
    '................',
    '................',
  ], { ...BONE, ...DRIFT })
  keep('ow_deco_bones_0', g)
}
{
  const g = grid()
  detail(g, [
    '................',
    '................',
    '................',
    '..lbl...........',
    '..sbs.....lbbl..',
    '...b......sbbs..',
    '...b............',
    '..lbl...........',
    '..sds.......l...',
    '.aAa.......lbl..',
    '...........sbs..',
    '.....lbbbl..s...',
    '.....sbbbs......',
    '......aAAa......',
    '................',
    '................',
  ], { ...BONE, ...DRIFT })
  keep('ow_deco_bones_1', g)
}
// a ribcage, the ribs curving up out of the sand from a buried spine
{
  const g = grid()
  detail(g, [
    '................',
    '................',
    '................',
    '....lb...lb.....',
    '...lb..lb..lb...',
    '..lb..lb..lb.b..',
    '..b..lb..lb..bs.',
    '..b..b...b...bs.',
    '..bs.bs..bs..bs.',
    '..bs.bs..bs..bs.',
    '.aAsaAsaaAsaaAsa',
    '.AaaAaaAAaaAAaaA',
    '..AaaaAaaaaAaaA.',
    '................',
    '................',
    '................',
  ], { ...BONE, ...DRIFT })
  // (the drift runs to the tile's sides only inside: a row the tile does not
  // join keeps its outer pixels clear)
  for (let y = 0; y < T; y++) { g[y][0] = null; g[y][T - 1] = null }
  keep('ow_deco_ribs', g)
}
// broken pottery: a jar on its side with its neck snapped off, half buried; and shards
{
  const g = grid()
  detail(g, [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......lllbDD...',
    '.....llbbbbDDs..',
    '....lbbbbbbbbs..',
    '..dd.lbbbbbbbss.',
    '.dDDdlbbbbbbbbs.',
    '.dDDdbbbbbbbbss.',
    '..ddsbbbbbbbss..',
    '.aAAaaAAAaaAAa..',
    '..aAaaaaAaaa....',
    '................',
    '................',
  ], { ...POT, ...DRIFT })
  keep('ow_deco_pottery_0', g)
}
{
  const g = grid()
  detail(g, [
    '................',
    '................',
    '................',
    '..lb............',
    '..bbs.....lbb...',
    '...ss......bbs..',
    '............s...',
    '................',
    '......lb........',
    '.....lbbs.......',
    '.....bbbs.......',
    '......ss...lbs..',
    '...........sd...',
    '................',
    '................',
    '................',
  ], POT)
  keep('ow_deco_pottery_1', g)
}

// ---- sandstone: the outcrops, the spires and the cairns --------------------------------
// One sandstone in every piece of it, redder and darker than the sand, so a
// rock reads against the ground round it and a spire against the dark of
// land not yet seen: lit along its edges towards the light (the upper left),
// in shade along the others, its south face banded where the layers show.
const STONE = { rim: '#e3b98a', top: '#cc9a68', body: '#b98352', face: '#a06a42', band: '#8b5838', shade: '#7c4c30', foot: '#5f3822', crack: '#a8744a' }

// An outcrop cell, ow_outcrop_<m>: m the sides 1 N / 2 E / 4 S / 8 W where
// the rock runs on into the next outcrop cell, to the border there; on the
// others it ends inside the tile, rounded where two such sides meet. On a
// side it runs on, the border pixels are the same in every tile that runs
// on there (an inset at a border is the same in every tile, the bands lie
// in the same rows), so cells of one outcrop meet without a seam. Its top is
// the rock's flat top; where it ends to the south, the face drops to its foot
// and casts a shadow on the sand below.
const INSET = { N: new Array(T).fill(1), S: 2, W: [1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 1, 1], E: [1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1] }
const FACE_FROM = 6   // where a south face begins, in every tile that ends to the south
const BANDS = [8, 11]
const ROUND = 3       // how far a corner where two ends meet is rounded off
const outcropSkin = m => `ow_outcrop_${m}`
function outcropTile(m) {
  const g = grid(), shadow = grid()
  const open = { N: !(m & 1), E: !(m & 2), S: !(m & 4), W: !(m & 8) }
  const top = x => open.N ? INSET.N[x] : 0
  const bottom = open.S ? T - 1 - INSET.S : T - 1   // the foot's row
  const left = y => open.W ? INSET.W[y] : 0
  const right = y => open.E ? T - 1 - INSET.E[y] : T - 1
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= T || y >= T) return false
    if (y < top(x) || y > bottom || x < left(y) || x > right(y)) return false
    // a corner where two ends meet is rounded off
    const dl = x - left(y), dr = right(y) - x, dt = y - top(x), db = bottom - y
    if (open.N && open.W && dl + dt < ROUND) return false
    if (open.N && open.E && dr + dt < ROUND) return false
    if (open.S && open.W && dl + db < ROUND) return false
    if (open.S && open.E && dr + db < ROUND) return false
    return true
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (!inside(x, y)) continue
    // how it is lit: an end towards the light catches it, the others are in shade
    const edgeN = open.N && !inside(x, y - 1), edgeW = open.W && !inside(x - 1, y)
    const edgeS = open.S && !inside(x, y + 1), edgeE = open.E && !inside(x + 1, y), nearE = open.E && !inside(x + 2, y)
    const face = open.S && y >= FACE_FROM
    let c = face ? STONE.face : STONE.top
    if (face && BANDS.includes(y)) c = STONE.band
    if (face && y === FACE_FROM) c = STONE.body   // the lip of the face
    if (nearE) c = face ? STONE.band : STONE.body
    if (edgeE) c = face ? STONE.foot : STONE.shade
    if (edgeW) c = face ? STONE.body : STONE.rim
    if (edgeN) c = STONE.rim
    if (edgeS) c = STONE.foot
    g[y][x] = c
  }
  // grit and a few cracks on the top, and the odd crack down the face, kept
  // two pixels from every border
  const lowest = open.S ? FACE_FROM - 2 : T - 3
  for (let k = 0; k < 7; k++) {
    const x = 2 + Math.floor(unit(m, 303, k) * 12), y = 2 + Math.floor(unit(m, 304, k) * (lowest - 1))
    if (g[y][x] === STONE.top) g[y][x] = STONE.rim
  }
  for (let k = 0; k < 4; k++) {
    const x = 2 + Math.floor(unit(m, 300, k) * 11), y = 2 + Math.floor(unit(m, 301, k) * (lowest - 1))
    if (g[y][x] === STONE.top && g[y][x + 1] === STONE.top) { g[y][x] = STONE.crack; if (unit(m, 302, k) < 0.6) g[y][x + 1] = STONE.crack }
  }
  if (open.S) for (let k = 0; k < 2; k++) {
    const x = 3 + Math.floor(unit(m, 305, k) * 10)
    for (let y = FACE_FROM + 2; y < bottom - 1; y++) if (g[y][x] === STONE.face || g[y][x] === STONE.band) g[y][x] = unit(m, 306, k, y) < 0.7 ? STONE.band : STONE.face
  }
  // its shadow on the sand below the foot, a pixel towards the lower right
  // (on to the border where the next cell's foot carries it on, short of it where the rock ends)
  if (open.S) for (let x = 0; x < T; x++) {
    const under = x > 0 ? g[bottom][x - 1] : !open.W && g[bottom][0]
    if (under && (x < T - 1 || !open.E)) shadow[bottom + 1][x] = 1
  }
  const joins = (m & 1 ? 'N' : '') + (m & 2 ? 'E' : '') + (m & 4 ? 'S' : '') + (m & 8 ? 'W' : '')
  return { g, shadow, joins }
}
// On a side two outcrop cells share, both draw the same border pixels.
const outcropBorders = new Map()
for (let m = 0; m < 16; m++) {
  const { g, shadow, joins } = outcropTile(m)
  for (const [bit, side, at] of [[1, 'N', i => g[0][i]], [2, 'E', i => g[i][T - 1]], [4, 'S', i => g[T - 1][i]], [8, 'W', i => g[i][0]]]) {
    if (!(m & bit)) continue
    // what the next cell across this side draws on its own border there
    const line = Array.from({ length: T }, (_, i) => at(i) ?? '-').join(' ')
    const key = `${side}:${(m & ~bit) & (side === 'N' || side === 'S' ? 10 : 5)}`
    const was = outcropBorders.get(key)
    if (was === undefined) outcropBorders.set(key, { line, name: outcropSkin(m) })
    else if (was.line !== line) throw new Error(`${outcropSkin(m)} draws side ${side} unlike ${was.name}:\n  ${line}\n  ${was.line}`)
  }
  keep(outcropSkin(m), g, { joins, shadow })
}

// A spire of sandstone two cells tall (ow_landmark_spire_top over
// ow_landmark_spire): a column under a cap of harder rock, standing on the
// heap of what has fallen from it, its layers showing in bands; drawn as one
// picture and cut in two. A cairn (ow_landmark_cairn): stones piled in a cell.
{
  const S = { T: STONE.top, R: STONE.rim, B: STONE.body, D: STONE.band, S: STONE.shade, F: STONE.foot, u: STONE.crack, f: STONE.face }
  const top = grid(), foot = grid()
  detail(top, [
    '................',
    '................',
    '.....RTTTTT.....',
    '....RTTTTTTS....',
    '....fFFFFFFF....',
    '......FBBSF.....',
    '......RBBSS.....',
    '......RBBBS.....',
    '......RDDDS.....',
    '......RBBBS.....',
    '......RBBBS.....',
    '.....RRBBBS.....',
    '.....RBDDBSS....',
    '.....RBBBBBS....',
    '.....RBBBBBS....',
    '.....RBBBBBS....',
  ], S)
  detail(foot, [
    '.....RBDDDBS....',
    '.....RBBBBBS....',
    '....RRBBBBBSS...',
    '....RBBBBBBBS...',
    '....RBDDDDBBS...',
    '....RBBBBBBBS...',
    '...RRuBBBBBuSS..',
    '...RBBuBBBuBBS..',
    '..RRBuBBuBBBuSS.',
    '..RBBBBuBBuBBBS.',
    '.RRuBBuBBBBuBBS.',
    '.RBBuBBBuBBBuBS.',
    '.fFFFFFFFFFFFFF.',
    '................',
    '................',
    '................',
  ], S)
  const shadow = grid()
  for (let x = 3; x <= 14; x++) shadow[13][x] = 1
  keep('ow_landmark_spire_top', top, { joins: 'S' })
  keep('ow_landmark_spire', foot, { joins: 'N', shadow })
}
{
  const g = grid()
  const CAIRN = { shade: '#6f675e', base: '#9a9184', light: '#c4bcae' }
  shadeShape(g, ellipseRows(8, 12.6, 5.2, 2.4), CAIRN, { deep: true })
  shadeShape(g, ellipseRows(7.6, 9.6, 3.9, 2.0), CAIRN, { deep: true })
  shadeShape(g, ellipseRows(8.1, 6.9, 2.8, 1.8), CAIRN)
  shadeShape(g, ellipseRows(7.8, 4.5, 1.8, 1.4), CAIRN)
  keep('ow_landmark_cairn', g, { shadow: footShadow(g, 15, 4, 13) })
}
console.log(`wrote ${drawn.length} tiles of what grows, lies and stands in the desert`)

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
  cy += FLAT.length + 0.5
  // the dune crests, a shape a column
  for (let v = 0; v < DUNE_VARIANTS; v++) row(Array.from({ length: 16 }, (_, m) => duneSkin(m, v)))
  cy += 0.5
  // the windward slopes, a level a row (the highest beside the crest last), a ripple family a column
  for (let l = 1; l <= WINDWARD_LEVELS; l++) row(RIPPLES.flatMap((_, f) => [windwardSkin(l, f, 0), windwardSkin(l, f, 1)]))
  cy += 0.5
  // dunes as layDunes lays them, crests and slopes, on a stretch of seed 7's desert (render 7 8 -1 2 2)
  const D = { X0: 660, Y0: -60, w: 32, h: 20 }
  const d = new MapBuilder('sheet', 'sheet', 'sheet', D.w, D.h)
  for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) d.ground[y][x] = d.skin(sandSkinAt(7, D.X0 + x, D.Y0 + y))
  layDunes(d, { X0: D.X0, Y0: D.Y0, seed: 7, open: () => true })
  grid(d.ground.map(r => r.map(i => d.palette[i])))
  cy += D.h + 0.5
  // what stands on the sand, twelve a row (a two-cell thing's top and foot side by side)
  for (let i = 0; i < drawn.length; i += 12) row(drawn.slice(i, i + 12))
  const W = Math.ceil(Math.max(...blocks.map(b => b.x + b.cells[0].length))) * T * Z + GAP * 2
  const H = Math.ceil(cy) * T * Z + GAP * 2
  const px = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) px.set([24, 24, 32, 255], i * 4)
  for (const blk of blocks) blk.cells.forEach((r, ty) => r.forEach((name, tx) => {
    if (!name) return
    const src = tiles.get(name)
    if (!src) throw new Error(`no tile ${name} for the sheet`)
    // (a see-through tile over the sand)
    const under = tiles.get(rippleSkin(2, 0))
    const ox = GAP + Math.round((blk.x + tx) * T * Z), oy = GAP + Math.round((blk.y + ty) * T * Z)
    for (let y = 0; y < T * Z; y++) for (let x = 0; x < T * Z; x++) {
      const s = (((y / Z) | 0) * T + ((x / Z) | 0)) * 4, a = src[s + 3] / 255
      px.set([0, 1, 2].map(k => Math.round(under[s + k] * (1 - a) + src[s + k] * a)).concat(255), ((oy + y) * W + ox + x) * 4)
    }
  }))
  writePng(out, W, H, px)
  console.log(`wrote ${out}`)
}
