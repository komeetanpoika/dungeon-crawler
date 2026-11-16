// How the Wilds' shores are drawn. The rim of terrain/lib.js is square: every
// step of a coast is a right angle, and its eight tiles leave the bank open
// wherever the land turns a corner away from the water or lies on two facing
// sides of a cell. The pass here, run from terrain.js's finish() after that
// rim, does two things. It draws the bank as a slanted line through the
// middle of each one-tile step, so a coast that steps one tile every few
// tiles reads as a slope. And it names every water cell by the coast from
// what lies along its four borders, so that wherever two cells share a
// border the bank one draws up to it is the bank the other takes up there:
// the line crosses at the same point for both, and no land is left bare
// against water.
//
// It is art only. No cell changes what it is: a water cell that shows a
// wedge of land is still water (and named as water), a land cell that shows
// a wedge of water is still land you walk on (and named as land, ow_bank_*).
// The picture never differs from the grid by more than half a tile.
//
// The rule works on the corners of the coast. At each corner two stretches
// of bank meet, one east-west and one north-south:
//   both two tiles or longer      a real corner: left as it is
//   one long, one a single tile   the long one ramps toward the middle of the
//                                 step: over two cells when it is four or
//                                 longer (4 px a cell), else over one (8 px)
//   both a single tile            a 45-degree cut across the corner cell
// A corner where the water turns in (a notch) fills water cells with land;
// one where the land turns out (a tip) cuts land cells with water. A cut is
// only drawn when the fill across its step is, so the line never dangles
// from a square corner; a fill can stand alone, and then the step is half
// as tall as it was, the square bank carrying on down the rest of it. Where
// two pieces want one cell the cut wins over the fill (sooner water shown on
// ground you can walk than land where you cannot).
//
// So along a coast that steps a tile every four the line crosses the cell
// borders a quarter, a half (at the step) and three quarters of a tile up,
// and both cells at each border are drawn from that one crossing.
//
// Two pieces of a kind at the two ends of one single-tile edge both want
// its cell: the end of a pocket or of a one-tile channel (two fills), a
// one-tile bump or the end of a spit (two cuts). They are drawn as one: the
// water cell filled from both corners to a V, the bump cut from both to a
// point with the foot of its bank on the water beyond, the spit's last cell
// tapered from both sides over its whole length. A bump, like any cut,
// needs the fills beside it; a spit's end has only water round it, which
// takes the feet of its two banks and of its point, so it needs none. A cell
// wanted any other way by two of a kind, or by three, stays square.
//
// A piece of ramp is drawn whole or not at all. Not at all when the land of
// one of its cells is not grass, sand or marsh dirt (each cell is drawn in
// the ground of its own land), when something stands on a cell it would
// fill or cut (a bridge deck over a fill is fine, and so is a tree or a rock
// on a cut: they stand at the water's edge anyway), when a cut would open
// water between a path and the bridge it walks onto, or when a water cell it
// draws on has land the piece does not reckon with: the far bank of a channel
// one tile wide, or land at a corner alone. (There is a tile for every set of
// square banks and corners, and one for every piece of ramp, but not for the
// two together.)
//
// The tiles are drawn by tools/make-wilds-shore-tiles.mjs, each from its
// name. tools/wilds/shore-lines.mjs judges from the tiles' own pixels whether
// a drawn coast joins up; test/wilds-shore-lines.test.js holds it to that.
import { isWaterSkin, isPierSkin, WATER_SKINS } from '../terrain/lib.js'

// What a bank is made of: the land's ground, and the rim family lib.js lays there.
export const FAMILIES = [
  { ground: 'grass', rim: 'ow_pond', is: n => n.startsWith('ow_grass') },
  { ground: 'sand', rim: 'ow_shore', is: n => n.startsWith('ow_sand') },
  { ground: 'dirt', rim: 'ow_mud', is: n => n.startsWith('ow_dirt') },
]
// A piece's lie: where the land is of the stretch that ramps (n s w e), then
// the end its corner is at (w e for an east-west stretch, n s for a
// north-south one).
export const LIES = ['nw', 'ne', 'sw', 'se', 'wn', 'ws', 'en', 'es']
const DIAGONAL = ['nw', 'ne', 'sw', 'se']
// Pieces: a b the two cells of a long ramp from the corner, c the one cell of
// a short one, d the 45-degree corner. The doubles lie by one side alone, the
// one their single-tile edge is on: u a bump cut from both corners, v a
// spit's end tapered.
export const cutSkin = (ground, lie, piece) => `ow_bank_${ground}_${lie}_${piece}`
export const isBankSkin = n => typeof n === 'string' && n.startsWith('ow_bank_')
export const SIDES = ['n', 's', 'w', 'e']
export const CUT_SKINS = FAMILIES.flatMap(f => [
  ...LIES.flatMap(l => ['a', 'b', 'c'].map(p => cutSkin(f.ground, l, p))),
  ...DIAGONAL.map(l => cutSkin(f.ground, l, 'd')),
  ...SIDES.flatMap(l => ['u', 'v'].map(p => cutSkin(f.ground, l, p))),
])

// A water cell by the coast is named for what lies along each of its four
// sides, north east south west, and for the land that touches it at a corner
// alone. Two cells that share a border are named from the same bank, so the
// line one draws up to the border is the line the other takes up there.
//   o  nothing: water across the side, or land whose bank has drawn back
//   l  the square bank, along the whole side
//   a b c d e   a fill whose corner is at the side's start (its west end, or
//               its north): the two cells of the long ramp, 8 px to 4 and 4
//               to 0; the short ramp, 8 to 0; the 45-degree corner with the
//               square bank after it (d) or with the bank drawing back into
//               the land cell, which is cut (e)
//   p q r s t   the same with the corner at the side's end
//   u  the end wall of a pocket, filled from both corners to a V
//   g h   the foot of a cut in the land cell across the side, its tip at the
//         side's start: the far cell of a long ramp, 4 px back to 1; a short
//         ramp, 8 to 1
//   i j   the same with the tip at the end
//   m  the foot of a bump, cut back from both ends
// Then the corners where land touches the cell diagonally and its bank comes
// round the corner: 1 north-west, 2 north-east, 4 south-east, 8 south-west.
// The eight cells lib.js has tiles for keep those names.
const SIDE_IX = { n: 0, e: 1, s: 2, w: 3 }
// the sides at the start and the end of each side, and the corner two sides make
const ENDS = [[3, 1], [0, 2], [3, 1], [0, 2]]
const CORNERS = [[1, 0, 3, -1, -1], [2, 0, 1, 1, -1], [4, 2, 1, 1, 1], [8, 2, 3, -1, 1]]   // bit, its two sides, the cell diagonally across
// for each set of sides with land, the corners between two sides without
const OPEN_CORNERS = Array.from({ length: 16 }, (_, land) => CORNERS.reduce((m, [bit, a, c]) => m | (land >> a & 1 || land >> c & 1 ? 0 : bit), 0))
const SIMPLE = { looo: '10', oolo: '12', oool: '01', oloo: '21', lool: '00', lloo: '20', ooll: '02', ollo: '22' }
const SIMPLE_BACK = Object.fromEntries(Object.entries(SIMPLE).map(([k, v]) => [v, k]))
const NO_LAND = /^[oghijm]{4}$/
// (a cell that shows no land of its own is the same on every bank)
export const shoreSkin = (rim, sides, tips = 0) =>
  !tips && SIMPLE[sides] ? `${rim}_${SIMPLE[sides]}` : `${NO_LAND.test(sides) ? 'ow_water' : rim}_k_${sides}_${tips.toString(16)}`
// { rim, sides, tips } of a shore cell's name; null for any other
export function shoreOf(name) {
  let m = /^(ow_pond|ow_shore|ow_mud|ow_water)_k_([a-z]{4})_([0-9a-f])$/.exec(name ?? '')
  if (m) return { rim: m[1] === 'ow_water' ? null : m[1], sides: m[2], tips: parseInt(m[3], 16) }
  m = /^(ow_pond|ow_shore|ow_mud)_(\d\d)$/.exec(name ?? '')
  return m && SIMPLE_BACK[m[2]] ? { rim: m[1], sides: SIMPLE_BACK[m[2]], tips: 0 } : null
}
const FILL_LETTERS = { a: 'ap', b: 'bq', c: 'cr', d: 'ds', e: 'et' }, FOOT_LETTERS = { b: 'gi', c: 'hj' }
// Every name the pass can lay, lib.js's eight apart: [sides, tips].
function shoreKeys() {
  const out = []
  const each = (sides, free) => {
    for (let pick = 0; pick < 1 << free.length; pick++) out.push([sides.join(''), free.reduce((t, bit, k) => t | (pick >> k & 1 ? bit : 0), 0)])
  }
  // square banks on any sides, and round any corner between two open ones
  for (let land = 0; land < 16; land++) {
    const sides = [0, 1, 2, 3].map(k => land >> k & 1 ? 'l' : 'o')
    each(sides, CORNERS.filter(([, a, c]) => sides[a] === 'o' && sides[c] === 'o').map(c => c[0]))
  }
  for (let side = 0; side < 4; side++) {
    const [start, end] = ENDS[side]
    const cell = (letter, more = {}) => { const s = ['o', 'o', 'o', 'o']; s[side] = letter; for (const k in more) s[k] = more[k]; return s }
    // (a cell with a ramp on it never has a corner bank as well: see fits() below)
    for (const piece of 'acde') for (const [k, corner] of [[0, start], [1, end]]) {
      // by the corner the step goes up: square, or drawn back where the land across it is cut
      for (const riser of 'lo') each(cell(FILL_LETTERS[piece][k], { [corner]: riser }), [])
    }
    for (const letter of 'bqghijm') each(cell(letter), [])
    for (const a of 'lo') for (const c of 'lo') each(cell('u', { [start]: a, [end]: c }), [])
  }
  return out.filter(([sides, tips]) => (tips || !SIMPLE[sides]) && (tips || sides !== 'oooo'))
}
export const SHORE_SKINS = shoreKeys().flatMap(([sides, tips]) =>
  NO_LAND.test(sides) ? [shoreSkin(null, sides, tips)] : FAMILIES.map(f => shoreSkin(f.rim, sides, tips)))
export const SLOPE_SKINS = [...CUT_SKINS, ...SHORE_SKINS]
const KNOWN = new Set(SHORE_SKINS)

const mod = (n, m) => ((n % m) + m) % m
const NONE = 0, PIER = 1, OTHER = 2, GROWTH = 3
// What may stand on a land cell the water cuts into.
const GROWS = ['ow_tree_', 'ow_bush_', 'ow_deadtree_', 'ow_shrub_', 'ow_rock_']
const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1]

// Slant the shores of builder `b` (ground, prop: palette indices).
//   X0, Y0   world tile of builder cell (0, 0)
//   frame    { x0, y0, w, h, band, look, far } when `b` is a Wilds piece with
//            its margin: the piece is the w x h cells from (x0, y0). A ramp
//            with a cell within `band` of a piece edge, on either side of
//            it, is decided from the strip along that edge alone: what the
//            ground is and what stands on it `band` deep, where the water
//            lies `look` deep, read past the builder with far(x, y). That is
//            what both pieces see alike and no deal moves. Nothing is drawn
//            where two strips cross.
// Returns { fills, cuts, square, unknown }: the pieces drawn, the ones a
// corner asked for that stayed square, and the cells that asked for a tile
// there is none of (never, if the rule holds; they take their square banks).
export function slopeShores(b, { X0 = 0, Y0 = 0, frame = null } = {}) {
  if (frame) frame = { look: frame.band, ...frame }
  const w = b.w, h = b.h, n = w * h
  // what each palette entry is, once: water or which bank's ground, and what it is when it stands on a cell
  const P = b.palette.length
  const palWet = new Uint8Array(P), palFam = new Int8Array(P), palOn = new Uint8Array(P), palRim = new Int8Array(P).fill(-1), palOpen = new Uint8Array(P)
  for (let k = 0; k < P; k++) {
    const name = b.palette[k]
    palWet[k] = isWaterSkin(name) ? 1 : 0
    palFam[k] = palWet[k] ? -1 : FAMILIES.findIndex(f => f.is(name))
    palOn[k] = isPierSkin(name) ? PIER : GROWS.some(p => name.startsWith(p)) ? GROWTH : OTHER
    if (palWet[k]) palRim[k] = FAMILIES.findIndex(f => name.startsWith(f.rim + '_'))
    palOpen[k] = WATER_SKINS.includes(name) ? 1 : 0
  }
  const wet = new Uint8Array(n), fam = new Int8Array(n), on = new Uint8Array(n)
  for (let y = 0, i = 0; y < h; y++) {
    const gr = b.ground[y], pr = b.prop[y], wr = b.walkG[y]
    for (let x = 0; x < w; x++, i++) {
      const g = gr[x], p = pr[x]
      wet[i] = palWet[g]
      fam[i] = palFam[g]
      if (p < 0) continue
      const o = palOn[p]
      // a deck is one you can walk; growth is growth on land
      on[i] = o === PIER ? (wr[x] ? PIER : OTHER) : o === GROWTH && wet[i] ? OTHER : o
    }
  }
  const { strips, wide } = frame ? stripsOf(w, h, frame) : {}
  const far = frame?.far, lookOf = frame ? (x, y) => bitsOf(x, y, frame, frame.look) : null
  // past the builder: the neighbour piece's own water, or open water where there is none to ask
  const wetAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h ? wet[y * w + x] : far ? (far(x, y) ? 1 : 0) : 1
  // for every water cell, the sides with land across them (1 north, 2 east,
  // 4 south, 8 west) and the corners with land diagonally across (1 north-west,
  // 2 north-east, 4 south-east, 8 south-west)
  const landOf = new Uint8Array(n), diagOf = new Uint8Array(n)
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (!wet[i]) continue
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
      landOf[i] = (wet[i - w] ? 0 : 1) | (wet[i + 1] ? 0 : 2) | (wet[i + w] ? 0 : 4) | (wet[i - 1] ? 0 : 8)
      diagOf[i] = (wet[i - w - 1] ? 0 : 1) | (wet[i - w + 1] ? 0 : 2) | (wet[i + w + 1] ? 0 : 4) | (wet[i + w - 1] ? 0 : 8)
    } else {
      landOf[i] = (wetAt(x, y - 1) ? 0 : 1) | (wetAt(x + 1, y) ? 0 : 2) | (wetAt(x, y + 1) ? 0 : 4) | (wetAt(x - 1, y) ? 0 : 8)
      diagOf[i] = (wetAt(x - 1, y - 1) ? 0 : 1) | (wetAt(x + 1, y - 1) ? 0 : 2) | (wetAt(x + 1, y + 1) ? 0 : 4) | (wetAt(x - 1, y + 1) ? 0 : 8)
    }
  }
  const sideBit = ch => 1 << SIDE_IX[ch]
  // A piece is drawn only where its cells have tiles: a cell that takes a
  // fill or the foot of a cut has land on the sides the piece gives it and
  // water on the rest (a fill in a channel one tile wide would meet the far
  // bank; the cell keeps its two square banks), and no land at a corner
  // alone, whose bank would come round into the cell.
  const lone = (i, land) => landOf[i] === land && !(diagOf[i] & OPEN_CORNERS[land])
  function fits(u) {
    if (u.steps < 0) {
      if (u.notch) return lone(u.q, 15 & ~(1 << ((SIDE_IX[u.lie] + 2) % 4)))
      return u.sides.every(([i, lie]) => lone(i, sideBit(lie[0]))) && lone(u.past, 1 << ((SIDE_IX[u.lie] + 2) % 4))
    }
    const side = sideBit(u.lie[0])
    if (u.notch) return u.water.every((i, k) => lone(i, k === 0 ? side | sideBit(u.lie[1]) : side))
    // (the first cell of a long cut keeps its bank to itself)
    return u.water.every((i, k) => (u.steps === 2 && k === 0) || lone(i, side))
  }

  // Every piece the corners ask for. `strip` on a piece is the strips that
  // hold every cell it was decided from: none, if it had to read past them.
  // What a cell is and what stands on it is read `band` deep on each side of
  // an edge; whether it is water, `look` deep, and past the builder from `far`.
  function scan() {
    const out = new Map()   // vertex -> piece
    let leak = false, seen = 0
    const at = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) { leak = true; seen = 0; return -1 }
      const i = y * w + x
      if (strips) seen &= strips[i]
      return i
    }
    const W = (x, y) => {
      if (x >= 0 && y >= 0 && x < w && y < h) {
        const i = y * w + x
        if (strips) seen &= wide[i]
        return wet[i]
      }
      const bits = far ? lookOf(x, y) : 0
      if (!bits) { leak = true; seen = 0; return -1 }
      seen &= bits
      return far(x, y) ? 1 : 0
    }
    // the corner in hand: Q the odd cell, O the row and column across the bank from it
    let vx = 0, vy = 0, q = 0, Qx = 0, Qy = 0, Ox = 0, Oy = 0, sx = 0, sy = 0
    const col = k => vx + (sx > 0 ? k : -1 - k), row = k => vy + (sy > 0 ? k : -1 - k)
    // does the bank run on, k cells from the corner
    const goes = (east, k) => east
      ? W(col(k), Qy) === q && W(col(k), Oy) === 1 - q
      : W(Qx, row(k)) === q && W(Ox, row(k)) === 1 - q
    for (vy = 1; vy < h; vy++) for (vx = 1; vx < w; vx++) {
      // the four cells round the vertex: one of a kind makes a corner
      const i00 = (vy - 1) * w + vx - 1
      const sum = wet[i00] + wet[i00 + 1] + wet[i00 + w] + wet[i00 + w + 1]
      if (sum !== 1 && sum !== 3) continue
      leak = false
      // (the corner itself within `band`: a neighbour's builder ends there, and it must find the same corners)
      seen = strips ? strips[i00] & strips[i00 + 1] & strips[i00 + w] & strips[i00 + w + 1] : 0
      q = sum === 1 ? 1 : 0   // the one water cell of a notch, the one land cell of a tip
      const qx = wet[i00] === q || wet[i00 + w] === q ? -1 : 0
      const qy = wet[i00] === q || wet[i00 + 1] === q ? -1 : 0
      Qx = vx + qx; Qy = vy + qy; sx = qx === 0 ? 1 : -1; sy = qy === 0 ? 1 : -1
      Oy = vy - 1 - qy; Ox = vx - 1 - qx
      const longH = goes(true, 1), longV = goes(false, 1)
      if (leak || (longH && longV)) continue
      const notch = q === 1
      const steps = !(longH || longV) ? 0 : goes(longH, 2) && goes(longH, 3) ? 2 : 1
      if (leak) continue
      const north = notch ? Oy < Qy : Qy < Oy, west = notch ? Ox < Qx : Qx < Ox
      const lie = longV ? (west ? 'w' : 'e') + (sy > 0 ? 'n' : 's') : (north ? 'n' : 's') + (sx > 0 ? 'w' : 'e')
      // the cells of the ramp from the corner: a water cell and the land cell across the bank from it
      const water = [], land = []
      if (steps === 0) (notch ? water : land).push(at(Qx, Qy))
      else for (let k = 0; k < steps; k++) {
        if (longH) { water.push(at(col(k), notch ? Qy : Oy)); land.push(at(col(k), notch ? Oy : Qy)) }
        else { water.push(at(notch ? Qx : Ox, row(k))); land.push(at(notch ? Ox : Qx, row(k))) }
      }
      // the far ends of the single-tile stretches this piece steps over (past
      // the builder's last cells no corner is looked for, and none is found)
      const acrossV = (vy + sy) * w + vx, acrossH = vy * w + vx + sx
      const u = {
        v: vy * w + vx, notch, lie, piece: steps === 0 ? 'd' : null, steps, water, land,
        claims: null, fams: null, needs: [], farH: -1, wantsE: -1, strip: 0, dead: false, q: Qy * w + Qx,
        touch: null, over: null,
      }
      if (notch) {
        // a fill is the ground of the land across the bank from it, cell by cell
        u.fams = steps === 0 ? [fam[at(Qx, Oy)]] : land.map(i => fam[i])
        if (leak || u.fams.some(f => f < 0)) continue
        if (water.some(i => on[i] === OTHER)) continue
        u.claims = water
        if (steps === 0) u.farH = acrossH
      } else {
        u.fams = land.map(i => fam[i])
        if (u.fams.some(f => f < 0) || land.some(i => on[i] === OTHER)) continue
        // a path that walks off these cells onto a deck must not find water
        // between: nothing may stand on the water across the bank, nor a deck
        // on the water across the step
        const stepH = steps === 0 || longH ? at(Ox, Qy) : -1, stepV = steps === 0 || longV ? at(Qx, Oy) : -1
        if (leak || on[stepH] === PIER || on[stepV] === PIER) continue
        if (water.some(i => on[i] !== NONE)) continue
        u.claims = [...land, ...water]
        // it changes the look of every cell round its corner: the fill across
        // the step loses the bank there, the water off the tip its corner
        u.touch = [...u.claims, i00, i00 + 1, i00 + w, i00 + w + 1]
        // the water cells across the single-tile stretches it steps over, and the side of each that faces it
        u.over = []
        if (stepH >= 0) u.over.push([stepH, Ox < Qx ? 1 : 3])
        if (stepV >= 0) u.over.push([stepV, Oy < Qy ? 2 : 0])
        if (steps === 0 || longH) u.needs.push(acrossV)
        if (steps === 0 || longV) u.needs.push(acrossH)
        // the fill across an east-west step carries this cut's bank on into its far half
        if (steps === 0 || longV) u.wantsE = acrossH
      }
      u.strip = seen
      out.set(u.v, u)
    }
    return out
  }

  // Two pieces of a kind cornered on one cell, at the two ends of one of its
  // edges, and nothing else after that cell: they become one piece, known
  // by either corner. `inStrip`: the pieces are the edge strips' own, and
  // the double must be decided from its strip too; else it must keep out of
  // the strips.
  function pairUp(units, fixed, inStrip) {
    const cornered = new Map(), wanted = new Map()
    for (const set of [fixed, units]) for (const u of set.values()) for (const i of u.claims) wanted.set(i, (wanted.get(i) ?? 0) + 1)
    for (const u of units.values()) { const a = cornered.get(u.q); if (a) a.push(u); else cornered.set(u.q, [u]) }
    for (const [q, pair] of cornered) {
      if (pair.length !== 2 || wanted.get(q) !== 2) continue
      const [a, c] = pair, gap = Math.abs(a.v - c.v)
      if (gap !== 1 && gap !== w) continue   // corners across the cell from each other
      const qx = q % w, qy = (q / w) | 0
      const side = gap === 1 ? (((a.v / w) | 0) === qy ? 'n' : 's') : (a.v % w === qx ? 'w' : 'e')
      // the cell past the edge the two share: a pocket's end wall, the water off a tip
      const ex = qx + (side === 'w' ? -1 : side === 'e' ? 1 : 0), ey = qy + (side === 'n' ? -1 : side === 's' ? 1 : 0)
      if (ex < 0 || ey < 0 || ex >= w || ey >= h) continue
      const past = ey * w + ex
      const m = {
        v: a.v, notch: a.notch, lie: side, piece: 'u', steps: -1, water: [], land: [], sides: [], past, q,
        claims: [q], fams: null, needs: [], farH: -1, wantsE: -1, wantsEs: [], strip: a.strip & c.strip, dead: false,
        touch: null, over: [...(a.over ?? []), ...(c.over ?? [])], vs: [a.v, c.v],
      }
      if (a.notch) {
        if (fam[past] < 0) continue
        m.fams = [fam[past]]
      } else {
        // the water off the tip is redrawn: it must be this land's alone to
        // rim, or another bank's rim would go with it
        if (!wet[past] || on[past] !== NONE) continue
        let alone = true, seen = 15
        for (let d = 0; d < 4 && alone; d++) {
          const x = ex + DX[d], y = ey + DY[d], i = y * w + x
          if (i === q) continue
          if (x < 0 || y < 0 || x >= w || y >= h || !wet[i]) alone = false
          else if (strips) seen &= strips[i]
        }
        if (!alone) continue
        m.strip &= seen
        m.fams = [fam[q]]
        if (a.steps === 0 && c.steps === 0) {
          // a bump: the fills beside it, which are each corner's but for the other corner
          m.needs = [...a.needs.filter(v => v !== c.v), ...c.needs.filter(v => v !== a.v)]
          m.wantsEs = [a.wantsE, c.wantsE].filter(v => v >= 0 && v !== a.v && v !== c.v)
          m.claims = [q, past]
        } else if (a.steps > 0 && c.steps > 0) {
          // a spit's end: the water on either side takes the foot of that side's bank
          m.piece = 'v'
          m.sides = [[a.water[0], a.lie], [c.water[0], c.lie]]
          m.claims = [q, a.water[0], c.water[0], past]
        } else continue
      }
      if (!a.notch) m.touch = [...m.claims, ...a.touch, ...c.touch]
      if (strips) {
        if (inStrip) { m.strip &= strips[past]; if (!m.strip) continue }
        else if ((m.touch ?? m.claims).some(i => strips[i])) continue
      }
      units.set(a.v, m)
      units.set(c.v, m)
    }
  }

  // Which pieces are drawn. `fixed` are pieces already settled (the strips
  // along the piece edges): they stand, and whatever touches them gives way.
  // `ban`: cells no piece may want.
  function settle(units, fixed = new Map(), { inStrip = false, ban = null } = {}) {
    pairUp(units, fixed, inStrip)
    let all = [...new Set(units.values())]
    // a piece with no tile for one of its cells is not there at all
    for (const u of all) if (!fits(u)) u.dead = true
    all = all.filter(u => !u.dead)
    if (ban) for (const u of all) if (u.claims.some(ban)) u.dead = true
    const claimed = new Map()   // cell -> pieces wanting it
    for (const u of [...new Set(fixed.values()), ...all]) for (const i of u.claims) {
      const a = claimed.get(i)
      if (a) a.push(u); else claimed.set(i, [u])
    }
    for (const u of all) for (const i of u.claims) for (const o of claimed.get(i)) {
      if (o === u) continue
      // a settled piece outranks all; else a cut gives way only to a cut, a fill to anything
      if (fixed.has(o.v) || !o.notch || u.notch) u.dead = true
    }
    const live = v => { const u = fixed.get(v) ?? units.get(v); return u && !u.dead ? u : null }
    for (const u of all) {
      if (u.notch || u.dead) continue
      if (u.needs.some(v => !live(v)?.notch)) { u.dead = true; continue }
      // a settled fill keeps the half it has
      for (const v of u.wantsEs ?? [u.wantsE]) {
        const e = v >= 0 ? live(v) : null
        if (e && e.steps === 0 && fixed.has(e.v) && e.piece !== 'e') u.dead = true
      }
    }
    for (const u of all) {
      if (!u.notch || u.dead || u.steps !== 0) continue
      const cut = live(u.farH)
      if (cut && !cut.notch) u.piece = 'e'
    }
    return all
  }

  const asked = scan()
  let drawn
  if (!frame) drawn = settle(asked).filter(u => !u.dead)
  else {
    // the strips first, each from itself alone; a cell in two strips is where they cross
    const strip = new Map([...asked].filter(([, u]) => u.strip))
    const crossing = i => (strips[i] & 3) !== 0 && (strips[i] & 12) !== 0
    settle(strip, undefined, { inStrip: true, ban: crossing })
    const fixed = new Map([...strip].filter(([, u]) => !u.dead))
    // then the inside, which may read anything but may change no cell of a strip
    const inner = new Map([...asked].filter(([, u]) => !(u.touch ?? u.claims).some(i => strips[i])))
    drawn = [...new Set(fixed.values()), ...settle(inner, fixed).filter(u => !u.dead)]
  }

  const put = (i, name) => { b.ground[(i / w) | 0][i % w] = b.skin(name) }
  const open = i => WATER_SKINS[mod(X0 + i % w + Y0 + ((i / w) | 0), 2)]
  // What lies along each side of every cell (as the letters of shoreSkin; x
  // is land whose bank has drawn back), and the corners a live cut is at.
  const O = 111, L = 108, X = 120, OPEN = ((O * 128 + O) * 128 + O) * 128 + O
  const along = new Uint8Array(n * 4).fill(O), rimOf = new Int8Array(n).fill(-1), cutAt = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const land = landOf[i]
    if (!land) continue
    for (let k = 0; k < 4; k++) if (land >> k & 1) along[i * 4 + k] = L
  }
  let fills = 0, cuts = 0
  const pieceOf = (u, k) => u.piece ?? (u.steps === 2 ? 'ab'[k] : 'c')
  const atStart = lie => lie[1] === 'w' || lie[1] === 'n'
  for (const u of drawn) {
    if (!u.notch) continue
    fills++
    if (u.steps < 0) { along[u.q * 4 + SIDE_IX[u.lie]] = 117; rimOf[u.q] = u.fams[0]; continue }
    const side = SIDE_IX[u.lie[0]], k0 = atStart(u.lie) ? 0 : 1
    u.water.forEach((i, k) => { along[i * 4 + side] = FILL_LETTERS[pieceOf(u, k)].charCodeAt(k0); rimOf[i] = u.fams[k] })
  }
  for (const u of drawn) {
    if (u.notch) continue
    cuts++
    for (const v of u.vs ?? [u.v]) cutAt[v] = 1
    // where it steps over a stretch the bank across it is gone: the fill there covers half, the cut opens the rest
    for (const [i, side] of u.over) if (along[i * 4 + side] === L) along[i * 4 + side] = X
    if (u.steps < 0) {
      put(u.q, cutSkin(FAMILIES[u.fams[0]].ground, u.lie, u.piece))
      // the water off the tip takes the foot of the point, a bump's and a spit's alike
      along[u.past * 4 + (SIDE_IX[u.lie] + 2) % 4] = 109
      for (const [i, lie] of u.sides) along[i * 4 + SIDE_IX[lie[0]]] = FOOT_LETTERS.c.charCodeAt(atStart(lie) ? 0 : 1)
      continue
    }
    const side = SIDE_IX[u.lie[0]], k0 = atStart(u.lie) ? 0 : 1
    u.land.forEach((i, k) => put(i, cutSkin(FAMILIES[u.fams[k]].ground, u.lie, pieceOf(u, k))))
    // under the first cell of a long cut the bank's foot does not reach the water cell
    u.water.forEach((i, k) => { const p = pieceOf(u, k); along[i * 4 + side] = p === 'a' ? X : FOOT_LETTERS[p].charCodeAt(k0) })
  }
  // Name every water cell from its sides and corners.
  const names = new Map()
  let unknown = 0
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    // (open water, away from every bank, was never anything else)
    if (!landOf[i] && !diagOf[i]) continue
    let tips = 0, code = 0
    for (let k = 0; k < 4; k++) {
      const [bit, a, c, dx, dy] = CORNERS[k]
      if (!(diagOf[i] & bit) || along[i * 4 + a] !== O || along[i * 4 + c] !== O) continue
      // (the corner of cell (x, y) on that side is vertex (x or x + 1, y or y + 1))
      if (!cutAt[(y + (dy > 0 ? 1 : 0)) * w + x + (dx > 0 ? 1 : 0)]) tips |= bit
    }
    for (let k = 0; k < 4; k++) { const ch = along[i * 4 + k]; code = code * 128 + (ch === X ? O : ch) }
    const g = b.ground[y][x]
    if (!tips && code === OPEN) { if (!palOpen[g]) put(i, open(i)); continue }
    const rim = rimOf[i] >= 0 ? rimOf[i] : Math.max(palRim[g], 0)
    const key = (code * 16 + tips) * 4 + rim
    let name = names.get(key)
    if (!name) {
      const sides = String.fromCharCode(code >> 21, code >> 14 & 127, code >> 7 & 127, code & 127)
      name = shoreSkin(FAMILIES[rim].rim, sides, tips)
      if (!KNOWN.has(name) && (tips || !SIMPLE[sides])) {
        // no tile for it (the rule should never ask for one): the square banks of the land that is there
        unknown++
        name = shoreSkin(FAMILIES[rim].rim, sides.replace(/[^o]/g, 'l'), tips)
      }
      names.set(key, name)
    }
    if (b.palette[g] !== name) put(i, name)
  }
  return { fills, cuts, square: asked.size - drawn.length, unknown }
}

// The strips along the four edges of a piece that hold cell (x, y), `deep`
// cells to each side of the edge: bit 1 west, 2 east, 4 north, 8 south.
const bitsOf = (x, y, { x0, y0, w, h }, deep) =>
  (x >= x0 - deep && x < x0 + deep ? 1 : 0) | (x >= x0 + w - deep && x < x0 + w + deep ? 2 : 0) |
  (y >= y0 - deep && y < y0 + deep ? 4 : 0) | (y >= y0 + h - deep && y < y0 + h + deep ? 8 : 0)
// The same per builder cell, `band` deep and `look` deep. Alike for every piece, so made once.
let stripCache = null
function stripsOf(w, h, frame) {
  const key = [w, h, frame.x0, frame.y0, frame.w, frame.h, frame.band, frame.look].join()
  if (stripCache?.key !== key) {
    const strips = new Uint8Array(w * h), wide = new Uint8Array(w * h)
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      strips[i] = bitsOf(x, y, frame, frame.band)
      wide[i] = bitsOf(x, y, frame, frame.look)
    }
    stripCache = { key, strips, wide }
  }
  return stripCache
}
