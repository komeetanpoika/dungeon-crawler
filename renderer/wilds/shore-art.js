// How the Wilds' shores slant. The rim of terrain/lib.js is square: every
// step of a coast is a right angle. The pass here, run from terrain.js's
// finish() after that rim, draws the bank as a slanted line through the
// middle of each one-tile step instead, so a coast that steps one tile every
// few tiles reads as a slope.
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
// as tall as it was. Where two pieces want one cell the cut wins over the
// fill (sooner water shown on ground you can walk than land where you
// cannot), and two of a kind both stay square: that is what leaves one-cell
// channels and spits alone.
//
// A piece of ramp is drawn whole or not at all. Not at all when the land of
// one of its cells is not grass, sand or marsh dirt (each cell is drawn in
// the ground of its own land), when something stands on a cell it would
// fill or cut (a bridge deck over a fill is fine, and so is a tree or a rock
// on a cut: they stand at the water's edge anyway), or when a cut would open
// water between a path and the bridge it walks onto.
//
// The tiles are drawn by tools/make-wilds-shore-tiles.mjs.
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
// a short one, d the 45-degree corner; e is d for a fill whose far half
// carries on the cut of the land cell across it.
export const fillSkin = (rim, lie, piece) => `${rim}_slope_${lie}_${piece}`
export const cutSkin = (ground, lie, piece) => `ow_bank_${ground}_${lie}_${piece}`
// the water cell under a cut, where the foot of the bank comes through
export const foamSkin = (lie, piece) => `ow_water_foam_${lie}_${piece}`
export const isBankSkin = n => typeof n === 'string' && n.startsWith('ow_bank_')

export const SLOPE_SKINS = [
  ...FAMILIES.flatMap(f => [
    ...LIES.flatMap(l => ['a', 'b', 'c'].map(p => fillSkin(f.rim, l, p))),
    ...DIAGONAL.flatMap(l => ['d', 'e'].map(p => fillSkin(f.rim, l, p))),
    ...LIES.flatMap(l => ['a', 'b', 'c'].map(p => cutSkin(f.ground, l, p))),
    ...DIAGONAL.map(l => cutSkin(f.ground, l, 'd')),
  ]),
  ...LIES.flatMap(l => ['b', 'c'].map(p => foamSkin(l, p))),
]

const mod = (n, m) => ((n % m) + m) % m
const NONE = 0, PIER = 1, OTHER = 2, GROWTH = 3
// What may stand on a land cell the water cuts into.
const GROWS = ['ow_tree_', 'ow_bush_', 'ow_deadtree_', 'ow_shrub_', 'ow_rock_']

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
// Returns { fills, cuts, square }: the pieces drawn, and the ones a corner
// asked for that stayed square.
export function slopeShores(b, { X0 = 0, Y0 = 0, frame = null } = {}) {
  if (frame) frame = { look: frame.band, ...frame }
  const w = b.w, h = b.h, n = w * h
  // what each palette entry is, once: water or which bank's ground, and what it is when it stands on a cell
  const P = b.palette.length
  const palWet = new Uint8Array(P), palFam = new Int8Array(P), palOn = new Uint8Array(P)
  for (let k = 0; k < P; k++) {
    const name = b.palette[k]
    palWet[k] = isWaterSkin(name) ? 1 : 0
    palFam[k] = palWet[k] ? -1 : FAMILIES.findIndex(f => f.is(name))
    palOn[k] = isPierSkin(name) ? PIER : GROWS.some(p => name.startsWith(p)) ? GROWTH : OTHER
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
        claims: null, fams: null, needs: [], farH: -1, wantsE: -1, strip: 0, dead: false,
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

  // Which pieces are drawn. `fixed` are pieces already settled (the strips
  // along the piece edges): they stand, and whatever touches them gives way.
  function settle(units, fixed = new Map()) {
    const claimed = new Map()   // cell -> pieces wanting it
    for (const set of [fixed, units]) for (const u of set.values()) for (const i of u.claims) {
      const a = claimed.get(i)
      if (a) a.push(u); else claimed.set(i, [u])
    }
    for (const u of units.values()) for (const i of u.claims) for (const o of claimed.get(i)) {
      if (o === u) continue
      // a settled piece outranks all; else a cut gives way only to a cut, a fill to anything
      if (fixed.has(o.v) || !o.notch || u.notch) u.dead = true
    }
    const live = v => { const u = fixed.get(v) ?? units.get(v); return u && !u.dead ? u : null }
    for (const u of units.values()) {
      if (u.notch || u.dead) continue
      if (u.needs.some(v => !live(v)?.notch)) { u.dead = true; continue }
      // a settled fill keeps the half it has
      const e = u.wantsE >= 0 ? live(u.wantsE) : null
      if (e && e.steps === 0 && fixed.has(e.v) && e.piece !== 'e') u.dead = true
    }
    for (const u of units.values()) {
      if (!u.notch || u.dead || u.steps !== 0) continue
      const cut = live(u.farH)
      if (cut && !cut.notch) u.piece = 'e'
    }
    return units
  }

  const asked = scan()
  let drawn
  if (!frame) drawn = [...settle(asked).values()].filter(u => !u.dead)
  else {
    // the strips first, each from itself alone; a cell in two strips is where they cross
    const strip = new Map([...asked].filter(([, u]) => u.strip))
    const crossing = i => (strips[i] & 3) !== 0 && (strips[i] & 12) !== 0
    for (const u of strip.values()) if (u.claims.some(crossing)) u.dead = true
    settle(strip)
    const fixed = new Map([...strip].filter(([, u]) => !u.dead))
    // then the inside, which may read anything
    const inner = new Map([...asked].filter(([, u]) => !u.claims.some(i => strips[i])))
    settle(inner, fixed)
    drawn = [...fixed.values(), ...[...inner.values()].filter(u => !u.dead)]
  }

  const put = (i, name) => { b.ground[(i / w) | 0][i % w] = b.skin(name) }
  let fills = 0, cuts = 0
  for (const u of drawn) {
    const pieceOf = k => u.piece ?? (u.steps === 2 ? 'ab'[k] : 'c')
    if (u.notch) {
      fills++
      u.water.forEach((i, k) => put(i, fillSkin(FAMILIES[u.fams[k]].rim, u.lie, pieceOf(k))))
    } else {
      cuts++
      u.land.forEach((i, k) => put(i, cutSkin(FAMILIES[u.fams[k]].ground, u.lie, pieceOf(k))))
      // under the first cell of a long cut the bank's foot does not reach the water cell
      u.water.forEach((i, k) => put(i, pieceOf(k) === 'a' ? WATER_SKINS[mod(X0 + i % w + Y0 + ((i / w) | 0), 2)] : foamSkin(u.lie, pieceOf(k))))
    }
  }
  return { fills, cuts, square: asked.size - drawn.length }
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
