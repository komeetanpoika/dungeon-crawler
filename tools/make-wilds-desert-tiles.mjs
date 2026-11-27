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
//   ow_sand_shade_<c>_<o>_<v>    the rippled sand of family o on a dune's slope,
//                                shaded from corner to corner: c the levels of
//                                its corners NW NE SE SW, each the level + 1
//                                (-1 the slip face, 0 flat sand, 1 a slope
//                                turned to the light, 2 turned squarely to it)
//   ow_sand_slip_<v>             a cell of slip face all round: smooth, shaded
//   ow_dune_<c>_<v>              a cell of a dune's crest band, c its corners
//                                (-1, 0 or 1): the brink across it, the lit
//                                top of the climb on one side, the slip face
//                                in shade on the other
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
//   shading   a pixel takes the level its corners blend to at its middle,
//             dithered between the two levels it lies between, and that
//             level's sand: the ripple tile with every tone lifted alike, or
//             the smooth slip face. Two cells that share an edge share its
//             corners (desert-art.js layDunes), so the gradient runs on across
//             it, and the ripples run on as they do on bare sand.
//   crests    the brink leaves a tile at the middle of a side whose corners
//             are 1 and -1, square to it, its edge, lit climb and slip face
//             the same there in every tile, so it runs on into the next crest
//             cell. Its shape: straight across for two opposite sides, a
//             45-degree chord between two that meet (square to each side for
//             its first pixels), a spur that dies away for one (where the
//             band ends), a cross for four, a low mound for none. Its windward
//             side is the lit level and its lee side the slip face, easing to
//             the blend of the corners where a spur dies away, so every side
//             the brink does not cross is what a shading tile draws there.
//
//   node tools/make-wilds-desert-tiles.mjs [--sheet sheet.png]
//
// --sheet also writes a contact sheet at 4x: every tile (the shading of one
// ripple family), a field of each ripple family in its mixed variants, a flat
// of hardpan in sand laid by desert-art.js's own edgeHardpan, a stretch of
// desert with its dunes laid by layDunes, and what stands on the sand, over
// the sand.
import { writePng } from './png-write.mjs'
import { EDGE_SHAPES } from '../renderer/terrain/edges.js'
import { MapBuilder } from '../renderer/terrain/lib.js'
import {
  RIPPLES, SAND_VARIANTS, HARDPAN_VARIANTS, DUNE_SKINS, SHADE_SKINS, rippleSkin, crackedSkin, hardpanEdgeSkin, cornersOf, edgeHardpan, layDunes, sandSkinAt,
  PAVE_VARIANTS, paveSkin, paveEdgeSkin,
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

function rippleColours(f, v, pal = SAND) {
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
  return col
}
const rippleTile = (f, v) => paint(rippleColours(f, v))

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
// What an edge frays: the hardpan's clay, crossed by its hairline crack
// (sand silts it up near the band), or the village's paving (sites.js) with
// its joints. `salt` keys the band's ragged profile.
const HARDPAN_EDGE = { salt: 77, base: v => clayColours(0, v), dust: DUST, line: CLAY.crack, name: hardpanEdgeSkin }
function edgeTile(M, D, v, kind = HARDPAN_EDGE) {
  const key = [M, D, v, kind.salt]
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
  const { col: clay, mask } = kind.base(v)
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
      col[i] = rim && unit(...key, 60, x, y) < 0.15 ? kind.dust.light : unit(...key, 61, x, y) < 0.06 ? SAND.shade : SAND.base
      continue
    }
    if (d > 3) continue
    if (mask[i]) { col[i] = unit(...key, 62, x, y) < [0, 0.9, 0.6, 0.3][d] ? kind.dust.silt : kind.line; continue }
    const r = unit(...key, 63, x, y)
    if (r < [0, 0.7, 0.15, 0][d]) col[i] = kind.dust.light
    else if (r < [0, 0.95, 0.6, 0.18][d]) col[i] = kind.dust.heavy
  }
  // the sand on the outer pixel: all along an open side; on a closed side
  // exactly within END px of an open side's border, or of the other border
  // at a nibble's corner
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    for (const [bit, dist] of SIDES) {
      if (dist(x, y) !== 0) continue
      const want = (M & bit) || SIDES.some(([b2, dist2]) => (M & b2) && dist2(x, y) < END)
        || CORNERS.some(([cb, a, c]) => (D & cb) && (a === bit || c === bit) && sideOf(a === bit ? c : a)[1](x, y) < END)
      if (!!sand[y * T + x] !== !!want) throw new Error(`${kind.name(M, D, v)}: the sand is ${sand[y * T + x] ? '' : 'not '}on border pixel ${x},${y}`)
    }
  }
  return paint(col)
}
let edges = 0
for (const [M, D] of EDGE_SHAPES) for (let v = 0; v < HARDPAN_VARIANTS; v++) { save(hardpanEdgeSkin(M, D, v), edgeTile(M, D, v)); edges++ }

// ---- the dunes: their shading and their crests ---------------------------------------
// A level's sand: flat sand is ow_sand_0's (SAND); a slope turned to the
// light is the same lit towards a near-white, a step more for level 2,
// ripples and all (every tone of the ripple tile lifted alike); the slip face,
// -1, is smooth sand darkened towards a deep tan, its ripples blown off.
const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mixTo = (h, to, t) => toHex(hex(h).map((v, i) => v + (to[i] - v) * t))
const HIGH = [252, 249, 240], DARK = [150, 124, 82]
const LIFT = { 1: 0.26, 2: 0.52 }
const lifted = l => l === 0 ? SAND : { base: mixTo(SAND.base, HIGH, LIFT[l]), shade: mixTo(SAND.shade, HIGH, LIFT[l]), lit: mixTo(SAND.lit, HIGH, LIFT[l]) }
const SLIP = { base: mixTo(SAND.base, DARK, 0.32), speck: mixTo(SAND.base, DARK, 0.4) }
// a 4x4 ordered dither: a pixel takes the higher of two levels where its threshold lies below the weight
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(k => (k + 0.5) / 16)
// The level a pixel takes between the corner levels c (NW NE SE SW): their
// bilinear blend, from the corners at the corner pixels, so that a border
// pixel's blend is its side's own and the cell beyond draws the same beside
// it; dithered between the two levels it lies between.
const blend = (c, x, y) => {
  const u = x / (T - 1), v = y / (T - 1)
  return c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * u * v + c[3] * (1 - u) * v
}
const dither = (f, x, y) => { const lo = Math.floor(f); return lo + (BAYER[(y % 4) * 4 + x % 4] < f - lo ? 1 : 0) }
// the slip face's speckled sand, the same in every tile at a pixel (of variant v)
const slipAt = (v, x, y) => unit(v, 95, x, y) < 0.06 ? SLIP.speck : SLIP.base

// A shading tile: every pixel the sand of the level it is dithered to, the
// ripples of family f (variant v) on the levels that keep them. Two tiles
// that share an edge share its corners, so the gradient runs on across it,
// and the ripples run on as they do on bare sand.
function shadeTile(c, f, v) {
  const ripples = { 0: rippleColours(f, v, lifted(0)), 1: rippleColours(f, v, lifted(1)), 2: rippleColours(f, v, lifted(2)) }
  const col = new Array(T * T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const l = dither(blend(c, x, y), x, y)
    col[y * T + x] = l < 0 ? slipAt(v, x, y) : ripples[l][y * T + x]
  }
  return paint(col)
}
let shades = 0
for (const name of SHADE_SKINS) {
  const c = cornersOf(name)
  const m = /_(\d+)_(\d+)$/.exec(name)
  if (name.startsWith('ow_sand_slip_')) save(name, paint(Array.from({ length: T * T }, (_, i) => slipAt(+/(\d+)$/.exec(name)[1], i % T, (i / T) | 0))))
  else save(name, shadeTile(c, +m[1], +m[2]))
  shades++
}

// A crest cell. Its brink runs through the middle of every side whose
// corners are 1 and -1 (a crossing), square to it for the first LEAD pixels
// so that it runs on into the next crest cell:
//   two opposite sides   straight across, bowed a pixel by the variant
//   two sides that meet  a 45-degree chord between the leads: a brink that
//                        steps a cell at a time runs on as a slant
//   one side             a spur to the middle that dies away (the band ends)
//   four (a saddle)      a cross, its four arms apart
//   none                 a low mound in the middle
// On the brink's windward side (where its corners are 1) the ground is the
// lit level, on the lee side the slip face, both easing to the plain blend of
// the corners where a spur dies away, so that every side the brink does not
// cross is the blend a shading tile draws there; along the brink the edge
// catches the light, and the slip face is darkest just under it.
const MID = { 1: [8, 0], 2: [16, 8], 4: [8, 16], 8: [0, 8] }
const INWARD = { 1: [0, 1], 2: [-1, 0], 4: [0, -1], 8: [1, 0] }
// each side's two corners, the first the one a turn anticlockwise (NW NE SE SW = 0 1 2 3)
const SIDE_CORNERS = { 1: [0, 1], 2: [1, 2], 4: [3, 2], 8: [0, 3] }
const CORNER_AT = [[0, 0], [16, 0], [16, 16], [0, 16]]
const LEAD = 3
// The brink's segments [x0, y0, x1, y1] with `bow` (pixels it is bowed by
// between its ends), `spur` (it dies away from its start), and the unit
// normal (px, py) to the windward side.
function brinkPath(c, A) {
  const bits = [1, 2, 4, 8].filter(b => c[SIDE_CORNERS[b][0]] * c[SIDE_CORNERS[b][1]] === -1)
  // the normal of a segment pointing to the side a corner lies on
  const towards = (s, k) => {
    const [x0, y0, x1, y1] = s, len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len, ny = (x1 - x0) / len
    const [cx, cy] = CORNER_AT[k], side = (cx - x0) * nx + (cy - y0) * ny >= 0 ? 1 : -1
    return [nx * side, ny * side]
  }
  // the windward normal of a segment that leaves side b: towards that side's corner at 1
  const fromSide = (s, b) => { const [i, j] = SIDE_CORNERS[b]; return towards(s, c[i] === 1 ? i : j) }
  const seg = (x0, y0, x1, y1, extra = {}) => ({ s: [x0, y0, x1, y1], bow: 0, ...extra })
  const lead = b => [MID[b][0] + INWARD[b][0] * LEAD, MID[b][1] + INWARD[b][1] * LEAD]
  if (bits.length === 0) return []
  if (bits.length === 1) {
    const b = bits[0], [x0, y0] = MID[b], p = seg(x0, y0, x0 + INWARD[b][0] * 8, y0 + INWARD[b][1] * 8, { spur: true })
    p.n = fromSide(p.s, b)
    return [p]
  }
  if (bits.length === 4) {
    // four arms from the middle, each windward towards its own side's corner at 1
    return bits.map(b => { const p = seg(MID[b][0], MID[b][1], 8, 8); p.n = fromSide(p.s, b); return p })
  }
  const [a, b] = bits
  if (a * 4 === b || b * 4 === a) {
    // straight across
    const p = seg(...MID[a], ...MID[b], { bow: A })
    p.n = fromSide(p.s, a)
    return [p]
  }
  // a bend: the corner between the two sides is the one it cuts off
  const cut = [0, 1, 2, 3].find(k => SIDE_CORNERS[a].includes(k) && SIDE_CORNERS[b].includes(k))
  const la = lead(a), lb = lead(b)
  const parts = [seg(...MID[a], ...la), seg(...la, ...lb), seg(...lb, ...MID[b])]
  for (const p of parts) { const n = towards(p.s, cut); p.n = c[cut] === 1 ? n : [-n[0], -n[1]] }
  return parts
}
// For a point: its distance d from the brink, which side it lies on (1
// windward, -1 lee), and how much of the brink's height it is near (lift: 1,
// less where a spur dies away).
function nearestBrink(path, x, y) {
  let best = null
  for (const p of path) {
    const [x0, y0, x1, y1] = p.s, len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len
    const t = Math.max(0, Math.min(len, (x - x0) * ux + (y - y0) * uy))
    const bow = p.bow * Math.sin(Math.PI * t / len) ** 2
    // the nearest point of the segment (bowed towards its windward side by `bow`)
    const qx = x0 + ux * t + p.n[0] * bow, qy = y0 + uy * t + p.n[1] * bow
    const d = Math.hypot(x - qx, y - qy)
    const k = Math.min(1, Math.max(0, (t - 1) / 6)), lift = p.spur ? 1 - k * k * (3 - 2 * k) : 1
    const side = (x - qx) * p.n[0] + (y - qy) * p.n[1] >= 0 ? 1 : -1
    const cand = { d, side, lift }
    if (!best || d / Math.max(0.05, lift) < best.d / Math.max(0.05, best.lift)) best = cand
  }
  return best
}
const CREST = {
  edge: mixTo(SAND.base, HIGH, 0.9), lit: mixTo(SAND.base, HIGH, 0.65),
  under: mixTo(SAND.base, DARK, 0.62), deep: mixTo(SAND.base, DARK, 0.46),
}
// the smooth sand of a level on a crest cell (no ripples on a crest)
const smoothAt = (l, v, x, y) => l < 0 ? slipAt(v, x, y) : unit(l, v, 96, x, y) < 0.05 ? lifted(l).shade : lifted(l).base
function crestTile(c, v) {
  const path = brinkPath(c, [0, 1, -1][v])
  const side = s => c.map(l => (l === -s ? s : l))   // the corners as seen from one side of the brink
  const col = new Array(T * T), label = new Array(T * T)   // label: what a pixel is, specks aside
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = y * T + x, f = blend(c, x, y)
    let l, tone = null
    if (!path.length) {
      // a band cell with no brink across it: the blend, with a low mound in the middle
      l = dither(f, x, y)
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8)
      tone = r < 1.6 ? 'edge' : r < 2.6 ? (x + y < 15 ? 'lit' : 'under') : null
    } else {
      const near = nearestBrink(path, x + 0.5, y + 0.5)
      l = dither(f + near.lift * (blend(side(near.side), x, y) - f), x, y)
      if (near.lift >= 0.3) {
        if (near.side > 0) tone = near.d < 1 ? 'edge' : near.d < 1 + 2 * near.lift ? 'lit' : null
        else tone = near.d < 2 * near.lift ? 'under' : near.d < 4 * near.lift ? 'deep' : null
      }
    }
    col[i] = tone ? CREST[tone] : smoothAt(l, v, x, y)
    label[i] = tone ?? `level ${l}`
  }
  return { rgba: paint(col), label }
}
// Where a brink crosses a side, every tile that crosses it the same way
// draws the same border pixels within CORE px of the side's middle (the edge,
// the lit climb, the slip face), specks aside: what leaves one tile is what
// enters the next.
const CORE = 4
const crossingSeen = new Map()
for (const name of DUNE_SKINS) {
  const c = cornersOf(name), v = +/_(\d+)$/.exec(name)[1]
  const { rgba, label } = crestTile(c, v)
  for (const [bit, at] of [[1, i => i], [2, i => i * T + T - 1], [4, i => (T - 1) * T + i], [8, i => i * T]]) {
    const [p, q] = SIDE_CORNERS[bit]
    if (c[p] * c[q] !== -1) continue
    const line = Array.from({ length: T }, (_, i) => Math.abs(i + 0.5 - T / 2) < CORE ? label[at(i)] : '-').join(', ')
    const key = `${bit}:${c[p]}`, was = crossingSeen.get(key)
    if (was === undefined) crossingSeen.set(key, { line, name })
    else if (was.line !== line) throw new Error(`${name} crosses side ${bit} unlike ${was.name}:\n  ${line}\n  ${was.line}`)
  }
  save(name, rgba)
}

console.log(`wrote ${RIPPLES.length * SAND_VARIANTS} sand, ${16 * HARDPAN_VARIANTS} cracked hardpan, ${edges} hardpan edge, ${DUNE_SKINS.length} crest and ${shades} shading tiles`)

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

// ---- the desert village (renderer/wilds/sites.js village(…, desert)) -------------------
// Flat-roofed houses of mud brick, warm tan against the pale sand, laid in the
// rows of Tiny Town's houses beside them (ow_roof_red_*, ow_house_wall_*) and
// outlined as they are, two pixels of INK round the roof's back and sides and
// down the walls' sides; lit from the upper left:
//   ow_roof_adobe_l, _m, _r      the roof's back row: the parapet's rim along the
//                                back and the sides, the back parapet's inner face
//                                and the thin shadow it and the west parapet cast
//                                on the flat deck, the deck
//   ow_roof_adobe_el, _em, _er   its front row: the deck, the front parapet's rim,
//                                and the top of the front wall below it with the
//                                ends of the roof beams, each casting its shadow
//   ow_roof_adobe_hatch, _pot    the back row's middle with a wooden roof hatch or
//                                a clay vent pot (where Tiny Town has a chimney)
//   ow_roof_adobe_step           the front row's middle with the parapet stepped up
//                                over the door (where Tiny Town has a gable)
//   ow_house_adobe_wall_l, _wall, _wall_r   a storey of plastered mud brick, the
//                                plaster fallen away here and there, its west
//                                corner rounded into the light, its east one in
//                                shade, its foot darker where the rain splashes
//   ow_house_adobe_win, _door, _dbl_l, _dbl_r   a deep-set window with shutters, a
//                                plank door, a double door, each a dark opening
//                                under a wooden lintel; `_blue`: the woodwork painted
//   ow_house_adobe_up_l, _up_win, _up_r   an upper storey, the ends of its floor
//                                beams along its foot
//   ow_pave_sand_<v>             flagstones laid in courses, the same joints in
//                                every variant so they run on from cell to cell
//   ow_pave_sand_edge_<M>_<D>    where the paving ends: sand drifted over the
//                                stones from the sides and corners that are not
//                                paving, the hardpan's edges (edgeTile)
//   ow_stall_awning_<c>          a shade awning of striped cloth over a stall
//   ow_stall_awning_<c>_front_l, _m, _r   its scalloped front edge, on a pole at
//                                each end
//   ow_deco_bloom_0..1           desert flowers in the sand (walked over)
//   ow_deco_sprout_0..1          young date palms in a row (walked over)
const villageTiles = []
const MUD = { light: '#ebc893', lit: '#ddae76', base: '#cd9862', mid: '#bf8955', shade: '#a2703f', dark: '#7c5030', brick: '#b27c49', joint: '#8f5f37' }
const DECK = { base: '#dcad76', grit: '#cf9f68', fleck: '#e8c18c', crack: '#b5854f', shadow: '#b4834d' }
const RIM = { top: '#f4d8a6', edge: '#e5bf88' }
const WOOD = { light: '#b5814f', base: '#8e5c35', shade: '#673f25' }
const TRIM = { '': WOOD, _blue: { light: '#86afd6', base: '#4f7bab', shade: '#375a84' } }
const HOLE = '#2a1b21', LATCH = '#c0cbdc'
const full = c => Array.from({ length: T }, () => new Array(T).fill(c))
const fill = (g, x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < T && y < T) g[y][x] = c }
const saveVillage = (name, g, shadow = null) => { save(name, gridRgba(g, shadow)); villageTiles.push(name) }

// Mud plaster over rows y0..y1: flecks, and in `patches` a spot where it has
// fallen away and two courses of brick show, its upper rim in shade and its
// lower rim catching the light; kept two pixels inside the tile's sides.
function plaster(g, salt, y0 = 0, y1 = T - 1, patches = 1) {
  for (let y = y0; y <= y1; y++) for (let x = 0; x < T; x++) {
    const r = unit(salt, 400, x, y)
    g[y][x] = r < 0.07 ? MUD.mid : r < 0.1 ? MUD.lit : MUD.base
  }
  for (let k = 0; k < patches; k++) {
    if (unit(salt, 401, k) > 0.75) continue
    const px = 4 + Math.floor(unit(salt, 402, k) * 6), py = y0 + 2 + Math.floor(unit(salt, 403, k) * Math.max(1, y1 - y0 - 6))
    fill(g, px, py, px + 4, py + 2, MUD.brick)
    fill(g, px, py + 1, px + 4, py + 1, MUD.joint)
    g[py][px + 2] = MUD.joint; g[py + 2][px + 1] = MUD.joint; g[py + 2][px + 4] = MUD.joint
    fill(g, px, py - 1, px + 4, py - 1, MUD.shade)
    fill(g, px + 1, py + 3, px + 5, py + 3, MUD.light)
  }
}
// A corner of the building: the west one rounded into the light, the east one turned away from it.
function corner(g, side, y0 = 0, y1 = T - 1) {
  for (let y = y0; y <= y1; y++) {
    if (side === 'l') { g[y][0] = INK; g[y][1] = INK; g[y][2] = MUD.light; g[y][3] = y % 2 ? MUD.lit : MUD.light }
    else { g[y][15] = INK; g[y][14] = INK; g[y][13] = MUD.shade; g[y][12] = y % 2 ? MUD.mid : MUD.shade }
  }
}
// The ends of a row of beams through the wall at row y: two pixels square,
// every four along so they run on from cell to cell, each casting its shadow
// on the wall a pixel down and to the right.
function beamEnds(g, y, xs) {
  for (const x of xs) {
    g[y][x] = WOOD.light; g[y][x + 1] = WOOD.base; g[y + 1][x] = WOOD.base; g[y + 1][x + 1] = WOOD.shade
    if (y + 2 < T) { g[y + 2][x + 1] = MUD.shade; if (x + 2 < T && g[y + 2][x + 2] !== INK) g[y + 2][x + 2] = MUD.shade }
  }
}
const BEAMS = { l: [5, 9, 13], m: [1, 5, 9, 13], r: [1, 5, 9] }
// A storey's wall; `foot`: the ground floor's, darker along its foot.
function wall(side, { foot = true, salt = 0 } = {}) {
  const g = full(MUD.base)
  plaster(g, salt, 0, T - 1, side === 'm' ? 1 : 0)
  if (foot) for (let x = 0; x < T; x++) { g[15][x] = MUD.shade; if (unit(salt, 404, x) < 0.5) g[14][x] = MUD.mid }
  if (side !== 'm') corner(g, side, 0, foot ? 14 : 15)
  if (foot && side === 'l') { g[15][2] = MUD.lit; g[15][3] = MUD.mid }
  if (foot && side === 'r') { g[15][12] = MUD.dark; g[15][13] = MUD.dark }
  return g
}
// A wooden lintel over an opening, x0..x1, its top at row y.
function lintel(g, x0, x1, y) {
  fill(g, x0, y, x1, y, WOOD.light); fill(g, x0, y + 1, x1, y + 1, WOOD.base)
  g[y + 1][x1] = WOOD.shade
  for (let x = x0 + 1; x <= x1 + 1 && x < T; x++) if (g[y + 2][x] !== INK) g[y + 2][x] = MUD.shade
}
// A deep-set window, its lintel's top at row y: the dark opening, a shutter
// folded back each side, the sill lit, its shadow under it.
function windowAt(g, trim, y = 2) {
  const c = TRIM[trim]
  lintel(g, 3, 12, y)
  fill(g, 5, y + 2, 10, y + 6, HOLE)
  fill(g, 3, y + 2, 4, y + 6, c.base); fill(g, 3, y + 2, 3, y + 6, c.light)
  fill(g, 11, y + 2, 12, y + 6, c.base); fill(g, 12, y + 2, 12, y + 6, c.shade)
  for (const sy of [y + 3, y + 5]) { g[sy][4] = c.shade; g[sy][11] = c.shade }
  g[y + 2][10] = '#3b2730'
  fill(g, 4, y + 7, 11, y + 7, MUD.light)
  fill(g, 5, y + 8, 12, y + 8, MUD.shade)
}
// A plank door from row 4 down to the ground, in an opening x0..x1 (x1 > 15 runs on into the next cell).
function doorAt(g, trim, x0, x1, { seamL = false, seamR = false } = {}) {
  const c = TRIM[trim]
  lintel(g, Math.max(0, x0 - 1), Math.min(15, x1 + 1), 2)
  for (let y = 4; y < T; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || x > 15) continue
    const frameL = x === x0 && !seamL, frameR = x === x1 && !seamR
    g[y][x] = y === 4 || frameL || frameR ? INK : c.base
  }
  for (let x = x0 + 1; x < x1; x++) if (x >= 0 && x < T) g[5][x] = c.shade
  return c
}

// the walls, a storey and an upper storey
saveVillage('ow_house_adobe_wall_l', wall('l', { salt: 1 }))
saveVillage('ow_house_adobe_wall', wall('m', { salt: 2 }))
saveVillage('ow_house_adobe_wall_r', wall('r', { salt: 3 }))
{
  const g = wall('l', { foot: false, salt: 4 }); beamEnds(g, 12, BEAMS.l); saveVillage('ow_house_adobe_up_l', g)
}
{
  const g = wall('r', { foot: false, salt: 5 }); beamEnds(g, 12, BEAMS.r); saveVillage('ow_house_adobe_up_r', g)
}
for (const trim of ['', '_blue']) {
  {
    const g = wall('m', { salt: 6 }); plaster(g, 16, 0, 13, 0)
    windowAt(g, trim, 2); saveVillage(`ow_house_adobe_win${trim}`, g)
  }
  {
    const g = wall('m', { foot: false, salt: 7 }); plaster(g, 17, 0, 11, 0)
    windowAt(g, trim, 1); beamEnds(g, 12, BEAMS.m); saveVillage(`ow_house_adobe_up_win${trim}`, g)
  }
  {
    const g = wall('m', { salt: 8 }); plaster(g, 18, 0, 13, 0)
    const c = doorAt(g, trim, 4, 11)
    fill(g, 5, 6, 5, 15, c.light)
    for (const x of [7, 9]) fill(g, x, 6, x, 15, c.shade)
    g[10][9] = LATCH; g[11][9] = LATCH
    saveVillage(`ow_house_adobe_door${trim}`, g)
  }
  {
    // the double door: two leaves meeting on the border between the cells
    const L = wall('m', { salt: 9 }); plaster(L, 19, 0, 13, 0)
    const c = doorAt(L, trim, 4, 16, { seamR: true })
    fill(L, 5, 6, 5, 15, c.light)
    for (const x of [8, 11]) fill(L, x, 6, x, 15, c.shade)
    fill(L, 15, 5, 15, 15, INK)
    L[10][13] = LATCH; L[11][13] = LATCH
    saveVillage(`ow_house_adobe_dbl${trim}_l`, L)
    const R = wall('m', { salt: 10 }); plaster(R, 20, 0, 13, 0)
    doorAt(R, trim, -1, 11, { seamL: true })
    fill(R, 0, 6, 0, 15, c.light)
    for (const x of [4, 7]) fill(R, x, 6, x, 15, c.shade)
    R[10][2] = LATCH; R[11][2] = LATCH
    saveVillage(`ow_house_adobe_dbl${trim}_r`, R)
  }
}

// The flat roof's deck over rows y0..y1: packed mud, grit, and a crack or
// two kept two pixels inside the tile.
function deck(g, salt, y0, y1) {
  for (let y = y0; y <= y1; y++) for (let x = 0; x < T; x++) {
    const r = unit(salt, 420, x, y)
    g[y][x] = r < 0.08 ? DECK.grit : r < 0.11 ? DECK.fleck : DECK.base
  }
  for (let k = 0; k < 2; k++) {
    if (unit(salt, 421, k) < 0.4) continue
    let x = 4 + Math.floor(unit(salt, 422, k) * 8), y = y0 + 2 + Math.floor(unit(salt, 423, k) * Math.max(1, y1 - y0 - 4))
    for (let i = 0; i < 3 && x < T - 2 && y <= y1 - 2; i++) { g[y][x] = DECK.crack; x++; if (unit(salt, 424, k, i) < 0.5) y++ }
  }
}
// The back row of the roof: the parapet's rim along the back (and the
// side), its inner face, the shadow it casts on the deck.
function roofBack(side, salt) {
  const g = full(DECK.base)
  deck(g, salt, 6, T - 1)
  fill(g, 0, 0, 15, 1, INK)
  fill(g, 0, 2, 15, 2, RIM.top); fill(g, 0, 3, 15, 3, RIM.edge)
  fill(g, 0, 4, 15, 4, MUD.base); fill(g, 0, 5, 15, 5, MUD.mid)
  for (let x = 0; x < T; x++) { g[6][x] = DECK.shadow; if (x % 2) g[7][x] = DECK.shadow }
  if (side === 'l') {
    fill(g, 0, 0, 1, 15, INK); fill(g, 2, 2, 2, 15, RIM.top); fill(g, 3, 2, 3, 15, RIM.edge)
    fill(g, 4, 6, 4, 15, DECK.shadow); for (let y = 6; y < T; y++) if (y % 2) g[y][5] = DECK.shadow
    g[4][4] = MUD.mid; g[5][4] = MUD.shade
  }
  if (side === 'r') { fill(g, 14, 0, 15, 15, INK); fill(g, 12, 2, 12, 15, RIM.top); fill(g, 13, 2, 13, 15, RIM.edge); g[4][11] = MUD.mid; g[5][11] = MUD.shade }
  return g
}
// The front row: the deck, the front parapet's rim, the top of the front
// wall under it with the roof beams' ends.
function roofFront(side, salt) {
  const g = full(DECK.base)
  deck(g, salt, 0, 9)
  fill(g, 0, 10, 15, 10, RIM.top); fill(g, 0, 11, 15, 11, RIM.edge)
  plaster(g, salt + 50, 12, 15, 0)
  fill(g, 0, 12, 15, 12, MUD.shade)
  beamEnds(g, 13, BEAMS[side])
  if (side === 'l') {
    fill(g, 0, 0, 1, 15, INK); fill(g, 2, 0, 2, 11, RIM.top); fill(g, 3, 0, 3, 11, RIM.edge)
    fill(g, 4, 0, 4, 9, DECK.shadow); for (let y = 0; y <= 9; y++) if (y % 2) g[y][5] = DECK.shadow
    corner(g, 'l', 12, 15)
  }
  if (side === 'r') {
    fill(g, 14, 0, 15, 15, INK); fill(g, 12, 0, 12, 11, RIM.top); fill(g, 13, 0, 13, 11, RIM.edge)
    corner(g, 'r', 12, 15)
  }
  return g
}
saveVillage('ow_roof_adobe_l', roofBack('l', 31))
saveVillage('ow_roof_adobe_m', roofBack('m', 32))
saveVillage('ow_roof_adobe_r', roofBack('r', 33))
saveVillage('ow_roof_adobe_el', roofFront('l', 34))
saveVillage('ow_roof_adobe_em', roofFront('m', 35))
saveVillage('ow_roof_adobe_er', roofFront('r', 36))
{
  // a wooden hatch in the deck, its shadow to the lower right
  const g = roofBack('m', 37)
  fill(g, 5, 9, 10, 13, WOOD.shade); fill(g, 6, 10, 9, 12, WOOD.base); fill(g, 6, 10, 9, 10, WOOD.light)
  fill(g, 7, 11, 7, 12, WOOD.shade)
  fill(g, 11, 10, 11, 14, DECK.shadow); fill(g, 6, 14, 11, 14, DECK.shadow)
  saveVillage('ow_roof_adobe_hatch', g)
}
{
  // a clay vent pot standing on the deck, its dark mouth up, its shadow to the lower right
  const g = roofBack('m', 38)
  fill(g, 6, 9, 9, 13, POT.b); fill(g, 6, 9, 6, 13, POT.l); fill(g, 9, 9, 9, 13, POT.s); fill(g, 6, 13, 9, 13, POT.s)
  fill(g, 6, 8, 9, 8, POT.l); fill(g, 7, 8, 8, 9, POT.D)
  fill(g, 10, 10, 10, 14, DECK.shadow); fill(g, 7, 14, 10, 14, DECK.shadow)
  saveVillage('ow_roof_adobe_pot', g)
}
{
  // the front parapet stepped up over the door, a little niche in it
  const g = roofFront('m', 39)
  const face = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = unit(39, 430, x, y) < 0.07 ? MUD.mid : MUD.base }
  face(4, 8, 11, 12); face(2, 10, 3, 12); face(12, 10, 13, 12)
  fill(g, 4, 6, 11, 6, RIM.top); fill(g, 4, 7, 11, 7, RIM.edge)
  for (const x0 of [2, 12]) { fill(g, x0, 8, x0 + 1, 8, RIM.top); fill(g, x0, 9, x0 + 1, 9, RIM.edge) }
  fill(g, 5, 8, 11, 8, MUD.shade); fill(g, 3, 10, 3, 10, MUD.shade); fill(g, 12, 10, 13, 10, MUD.shade)
  fill(g, 4, 8, 4, 12, MUD.lit); fill(g, 2, 10, 2, 12, MUD.lit)
  fill(g, 11, 9, 11, 12, MUD.mid); fill(g, 13, 11, 13, 12, MUD.mid)
  fill(g, 7, 9, 8, 10, HOLE); fill(g, 7, 11, 8, 11, MUD.light)
  saveVillage('ow_roof_adobe_step', g)
}

// ---- the sand paving ----------------------------------------------------------------
// Flagstones in courses: a joint along rows 0, 5 and 10, and in each course
// the joints at the same columns in every variant; a stone is lit along its
// top and west side and shaded along its foot. A variant deals the stones'
// tones, except of a stone that runs on across the tile's side, which keeps
// one tone in every variant so it does not change halfway.
const PAVE = { joint: '#b19b76', lit: '#e3d4b3', shade: '#c2ad87', tones: ['#d5c3a0', '#cdba95', '#dccbaa'], speck: '#c4b08a' }
const PAVE_DUST = { light: '#ddd0b1', heavy: '#d2c3a1', silt: SAND.shade }
const COURSES = [{ y0: 1, y1: 4, joints: [3, 10] }, { y0: 6, y1: 9, joints: [6, 13] }, { y0: 11, y1: 15, joints: [1, 8] }]
function paveColours(v) {
  const col = new Array(T * T).fill(PAVE.joint), mask = new Uint8Array(T * T).fill(1)
  COURSES.forEach(({ y0, y1, joints }, ci) => {
    // the stones of the course, as runs of columns between joints (wrapping round)
    const starts = joints.map(j => (j + 1) % T)
    starts.forEach((sx, si) => {
      const end = joints[(si + 1) % joints.length]
      const xs = []
      for (let x = sx; x !== end; x = (x + 1) % T) xs.push(x)
      const wraps = xs.some((x, i) => i > 0 && x === 0)
      const tone = wraps ? PAVE.tones[0] : PAVE.tones[Math.floor(unit(v, 500, ci, si) * PAVE.tones.length)]
      xs.forEach((x, i) => {
        for (let y = y0; y <= y1; y++) {
          const k = y * T + x
          mask[k] = 0
          let c = tone
          if (y === y1) c = PAVE.shade
          else if (y === y0 || i === 0) c = PAVE.lit
          else if (unit(v, 501, x, y) < 0.07) c = PAVE.speck
          col[k] = c
        }
      })
    })
  })
  return { col, mask }
}
const PAVE_EDGE = { salt: 78, base: paveColours, dust: PAVE_DUST, line: PAVE.joint, name: (M, D) => paveEdgeSkin(M, D) }
for (let v = 0; v < PAVE_VARIANTS; v++) { save(paveSkin(v), paint(paveColours(v).col)); villageTiles.push(paveSkin(v)) }
for (const [M, D] of EDGE_SHAPES) { save(paveEdgeSkin(M, D), edgeTile(M, D, 0, PAVE_EDGE)); villageTiles.push(paveEdgeSkin(M, D)) }

// ---- the stall's awning ---------------------------------------------------------------
// Striped cloth stretched from a rail at the back over the stall to a pole at
// each end of its front, where a scalloped edge hangs; a stripe four pixels
// wide so the stripes run on from cell to cell, the cloth lit near the rail.
const CLOTH = [{ base: '#4f6ea8', shade: '#3b5486', lit: '#7090c6' }, { base: '#b5493a', shade: '#913a2f', lit: '#cf6d57' }]
const CREAM = { base: '#f0e5c9', shade: '#d6c6a3', lit: '#fbf5e5' }
const stripeAt = (c, x, tone) => (Math.floor(x / 4) % 2 ? CLOTH[c] : CREAM)[tone]
CLOTH.forEach((_, c) => {
  const top = full(null)
  for (let x = 0; x < T; x++) {
    top[0][x] = WOOD.base
    for (let y = 1; y < T; y++) top[y][x] = stripeAt(c, x, y <= 2 ? 'lit' : x % 4 === 3 ? 'shade' : 'base')
  }
  saveVillage(`ow_stall_awning_${c}`, top)
  for (const end of ['l', 'm', 'r']) {
    const g = full(null), shadow = grid()
    for (let x = 0; x < T; x++) {
      for (let y = 0; y <= 5; y++) g[y][x] = stripeAt(c, x, x % 4 === 3 ? 'shade' : 'base')
      // the hanging edge: a fold, then scallops, a stripe each
      g[6][x] = stripeAt(c, x, 'shade')
      for (let y = 7; y <= 9; y++) {
        const k = x % 4
        if (y === 9 && (k === 0 || k === 3)) continue
        g[y][x] = stripeAt(c, x, y === 7 ? 'lit' : 'base')
      }
      if (x % 4 === 1 || x % 4 === 2) g[10][x] = stripeAt(c, x, 'shade')
    }
    const pole = end === 'l' ? 1 : end === 'r' ? 13 : -1
    if (pole >= 0) {
      for (let y = 10; y < T - 1; y++) { g[y][pole] = WOOD.light; g[y][pole + 1] = WOOD.base }
      g[T - 1][pole] = WOOD.base; g[T - 1][pole + 1] = WOOD.shade
      shadow[T - 1][pole + 2] = 1
    }
    saveVillage(`ow_stall_awning_${c}_front_${end}`, g, shadow)
  }
})

// ---- the date garden's mud wall ------------------------------------------------------------
// Where the farms' wall block (ow_prop_wall_sand, tools/make-wilds-farm-tiles.mjs:
// its cap seen from above, then its brick face) runs east and west, these
// run north and south and turn the corners, in its colours: the wall's cap
// as a strip down the middle of the cell (lit on its west side, in shade on
// its east, a joint every four rows so its courses run on from cell to
// cell), its shadow cast to the east; at a corner the cap turns into the
// block's, and the block's face shows only where the wall runs east or west
// in front of it.
//   ow_prop_wall_sand_v                 the wall running north and south
//   ow_prop_wall_sand_tl, _tr           the back corners: the strip runs south from the block
//   ow_prop_wall_sand_bl, _br           the front corners: the strip runs north into the block
{
  const W = { c: '#efe0b9', C: '#d9c08a', m: '#c9a46a', M: '#a8834e', s: '#8a6a3f' }
  const BLOCK = [   // the farms' wall block, rows 5 to 15
    'cccccccccccccccc', 'CCCCCCCCCCCCCCCC', 'mmmmmMmmmmmmmMmm', 'mmmmmMmmmmmmmMmm', 'MMMMMMMMMMMMMMMM',
    'mmMmmmmmmMmmmmmm', 'mmMmmmmmmMmmmmmm', 'MMMMMMMMMMMMMMMM', 'mmmmmMmmmmmmmMmm', 'mmmmmMmmmmmmmMmm', 'ssssssssssssssss',
  ]
  const STRIP = { x0: 6, x1: 10 }
  const strip = (g, y0, y1) => {
    for (let y = y0; y <= y1; y++) {
      const joint = y % 4 === 3
      g[y][STRIP.x0] = W.c
      for (let x = STRIP.x0 + 1; x < STRIP.x1; x++) g[y][x] = joint ? W.m : W.C
      g[y][STRIP.x1] = W.m
    }
  }
  const block = (g, { capFrom = 0, capTo = T - 1, faceFrom = 0, faceTo = T - 1 } = {}) => {
    for (let y = 5; y < T; y++) for (let x = 0; x < T; x++) {
      const face = y >= 7
      if (face ? x < faceFrom || x > faceTo : x < capFrom || x > capTo) continue
      g[y][x] = W[BLOCK[y - 5][x]]
    }
  }
  const pieces = {
    ow_prop_wall_sand_v: (g, sh) => { strip(g, 0, T - 1); for (let y = 0; y < T; y++) sh[y][STRIP.x1 + 1] = 1 },
    ow_prop_wall_sand_tl: g => {
      block(g, { capFrom: STRIP.x0, faceFrom: STRIP.x1 + 1 })
      g[5][STRIP.x0] = W.c; g[6][STRIP.x0] = W.c
      strip(g, 7, T - 1)
    },
    ow_prop_wall_sand_tr: (g, sh) => {
      block(g, { capTo: STRIP.x1, faceTo: STRIP.x0 - 1 })
      g[5][STRIP.x1] = W.C; g[6][STRIP.x1] = W.m
      strip(g, 7, T - 1)
      for (let y = 5; y < T; y++) sh[y][STRIP.x1 + 1] = 1
    },
    ow_prop_wall_sand_bl: (g, sh) => {
      strip(g, 0, 4)
      block(g, { capFrom: STRIP.x0, faceFrom: STRIP.x0 })
      g[5][STRIP.x0] = W.c; g[6][STRIP.x0] = W.c
      for (let y = 0; y <= 4; y++) sh[y][STRIP.x1 + 1] = 1
    },
    ow_prop_wall_sand_br: (g, sh) => {
      strip(g, 0, 4)
      block(g, { capTo: STRIP.x1, faceTo: STRIP.x1 })
      g[5][STRIP.x1] = W.C; g[6][STRIP.x1] = W.m
      for (let y = 7; y < T - 1; y++) g[y][STRIP.x1] = W.M
      for (let y = 0; y < T; y++) sh[y][STRIP.x1 + 1] = 1
    },
  }
  for (const [name, draw] of Object.entries(pieces)) {
    const g = grid(), sh = grid()
    draw(g, sh)
    saveVillage(name, g, sh)
  }
}

// ---- what grows in the village ---------------------------------------------------------------
// Desert flowers: a tuft of grey-green leaves with blossoms, two to a cell.
{
  const P0 = { l: SAGE.light, b: SAGE.base, s: SAGE.shade, p: '#f7b3c5', P: '#e86a92', y: '#ffc90e' }
  const P1 = { l: SAGE.light, b: SAGE.base, s: SAGE.shade, p: '#ffe08a', P: '#e8a417', y: '#c4562e' }
  const tuft = ['.pPp.', 'p.y.p', '.lPl.', 'lbsbl', '.sbs.']
  const tuftB = ['..p..', '.pyp.', 'l.p.l', '.lbl.', '.sbs.']
  ;[[P0, [[2, 5, tuft], [9, 10, tuftB]]], [P1, [[8, 3, tuftB], [3, 9, tuft]]]].forEach(([pal, spots], i) => {
    const g = grid()
    for (const [x0, y0, rows] of spots) rows.forEach((r, dy) => [...r].forEach((ch, dx) => { if (ch !== '.') g[y0 + dy][x0 + dx] = pal[ch] }))
    standsAlone(`ow_deco_bloom_${i}`, g); saveVillage(`ow_deco_bloom_${i}`, g)
  })
}
// Young date palms in a row: a fan of fronds out of a little heap of sand.
{
  const P = { g: '#479f4a', G: '#84c669', d: '#2f7a3a', a: DRIFT.a, A: DRIFT.A }
  const shoot = ['G...G', '.GgG.', 'GdgdG', '..d..', '.aAa.']
  const shootB = ['.G.G.', 'G.g.G', '.GdG.', '..d..', 'aAAa.']
  ;[[[1, 9, shoot], [9, 9, shootB]], [[5, 9, shootB], [12, 8, ['.G.', 'GdG', '.d.', 'aA.', '...']]]].forEach((spots, i) => {
    const g = grid()
    for (const [x0, y0, rows] of spots) rows.forEach((r, dy) => [...r].forEach((ch, dx) => { if (ch !== '.') g[y0 + dy][x0 + dx] = P[ch] }))
    standsAlone(`ow_deco_sprout_${i}`, g); saveVillage(`ow_deco_sprout_${i}`, g)
  })
}
console.log(`wrote ${villageTiles.length} tiles of the desert village`)

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
  // the crest cells, 27 a row
  for (let i = 0; i < DUNE_SKINS.length; i += 27) row(DUNE_SKINS.slice(i, i + 27))
  cy += 0.5
  // the shading of ripple family 2, 24 a row, and the slip face
  const shading = [...SHADE_SKINS.filter(n => /^ow_sand_shade_\d{4}_2_/.test(n)), ...SHADE_SKINS.filter(n => n.startsWith('ow_sand_slip_'))]
  for (let i = 0; i < shading.length; i += 24) row(shading.slice(i, i + 24))
  cy += 0.5
  // dunes as layDunes lays them, crests and shading, on a stretch of seed 7's desert (render 7 8 -1 2 2)
  const D = { X0: 700, Y0: -40, w: 48, h: 32 }
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
