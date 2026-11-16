// How the Wilds' bridges look. A path, a gate corridor or a site's jetty over
// water is laid as bare pier logs, one tile for the whole run; that reads as
// stray stripes the moment a bridge wanders, widens or meets another. The
// pass here, run from terrain.js's finish(), turns every such cell into a
// piece of plank deck cut to its final neighbourhood: an edge beam on each
// side with no deck beside it, a post where two edges meet (a bridge's ends
// and every outer corner) and now and then along a straight edge, and planks
// laid across the way the bridge runs. It changes prop art only: which cells
// are deck, and that they can be walked, is decided before it.
//
// A deck that steps a tile at a time has its edge slanted through the middle
// of each step, the way shore-art.js slants a bank, and the edge beam goes
// with it: one beam round the whole outline, planks and nothing else inside.
// The deck cell at the outer corner of a step has that corner cut away, the
// beam laid along the slant and water showing past it. The water cell in the
// inner corner takes a fillet: more planking, in the bridge's own direction,
// with the beam on its slanted side. No straight beam is left between a
// fillet and the deck it joins: a deck side a fillet lies on has none, and
// where a fillet thins to less than a beam's width the deck cell under it
// carries the tail of the beam. A cut cell is deck still, by name and to
// walk on; a fillet is a prop on water that stays water: never a pier to any
// reader of names, and no more in the way of sight than the water was. The
// straight edges on either side of a step ramp toward it over one cell; two
// single-tile edges meet in a 45-degree corner.
//
// A tale lays and lifts planks while the game runs (the tar pit's causeway,
// the ferryman's pier): recutDeck is the same cut on the game's own cells.
//
// The tiles are drawn by tools/make-wilds-path-tiles.mjs.
import { isWaterSkin, isPierSkin } from '../terrain/lib.js'
import { TILE } from '../systems/entities.js'
import { markTileDirty } from '../systems/tile-dirty.js'

const N = 1, E = 2, S = 4, W = 8
const DECK = 'ow_pier_deck'
// One open side, or two facing ones: a straight edge, which can carry a post.
const STRAIGHT = new Set([N, E, S, W, N | S, E | W])
const POST_EVERY = 3

// `boards` is how the planks lie: 'h' east-west (for a bridge that runs
// north-south), 'v' north-south. `mask` is the sides with no deck beside them.
export const deckSkin = (boards, mask, post = false) => `${DECK}_${boards}_${mask}${post ? 'p' : ''}`
export const deckHasPost = mask => STRAIGHT.has(mask)
export const DECK_SKINS = ['h', 'v'].flatMap(o => Array.from({ length: 16 }, (_, m) =>
  deckHasPost(m) ? [deckSkin(o, m), deckSkin(o, m, true)] : [deckSkin(o, m)]).flat())
export const isDeckSkin = n => typeof n === 'string' && n.startsWith(DECK)

// A slanted edge's lie, as in shore-art.js: where the deck is of the edge
// that ramps (n s w e), then the end the corner is at. Piece c is the ramp's
// one cell, d the 45-degree corner (named from its east-west edge).
export const SLANT_LIES = ['nw', 'ne', 'sw', 'se', 'wn', 'ws', 'en', 'es']
const BOARDS = ['h', 'v']
// a deck cell with a corner cut away along a slant: planks and the slanted beam
export const deckCutSkin = (boards, lie, piece) => `${DECK}_${boards}_${lie}${piece}`
// a deck cell under the long leg of the ramp fillet of that lie: no beam of
// its own on that side but the tail of the fillet's. `far` is its other
// side: 0 deck, 1 open water and a straight beam, 2 the long leg of the
// ramp that mirrors this one (a one-wide deck stepping the same way on both
// edges; named by the lie that starts n or w)
export const deckUnderSkin = (boards, lie, far) => `${DECK}_${boards}_${lie}u${+far}`
const mirrored = lie => FACING[lie[0]] + FACING[lie[1]]
// the planking in the inner corner of a step, on the water cell there. Piece
// c and d as a cut's; e and f are d where only one of the two deck cells it
// joins is cut: the beam runs on straight along the other, on the fillet's
// side of the line (e along its east-west leg, f along its north-south one).
export const filletSkin = (boards, lie, piece) => `ow_prop_fillet_${boards}_${lie}_${piece}`
export const isFilletSkin = n => typeof n === 'string' && n.startsWith('ow_prop_fillet_')
export const isDeckCutSkin = n => isDeckSkin(n) && /[cd]$/.test(n)
export const isDeckUnderSkin = n => isDeckSkin(n) && /u[012]$/.test(n)
export const DECK_CUT_SKINS = BOARDS.flatMap(o => [...SLANT_LIES.map(l => deckCutSkin(o, l, 'c')), ...SLANT_LIES.slice(0, 4).map(l => deckCutSkin(o, l, 'd'))])
export const DECK_UNDER_SKINS = BOARDS.flatMap(o => SLANT_LIES.flatMap(l => [0, 1, ...('nw'.includes(l[0]) ? [2] : [])].map(far => deckUnderSkin(o, l, far))))
export const FILLET_SKINS = BOARDS.flatMap(o => [...SLANT_LIES.map(l => filletSkin(o, l, 'c')), ...SLANT_LIES.slice(0, 4).flatMap(l => ['d', 'e', 'f'].map(p => filletSkin(o, l, p)))])

const mod = (n, m) => ((n % m) + m) % m
const FACING = { n: 's', s: 'n', w: 'e', e: 'w' }
// A bridge runs east-west when its cells spread this many times wider than tall.
const CLEAR = 2

// The one rule both forms share: the tile of a deck cell at world tile
// (X, Y), given its planking and which of its four neighbours are deck.
// A post stands every few tiles of straight edge, counted along the edge in
// world tiles, so the spacing runs on unbroken from piece to piece.
function cutSkin(boards, n, e, s, w, X, Y) {
  const mask = (n ? 0 : N) | (e ? 0 : E) | (s ? 0 : S) | (w ? 0 : W)
  return deckSkin(boards, mask, deckHasPost(mask) && mod(mask & (N | S) ? X : Y, POST_EVERY) === 0)
}

// Where a deck's edge slants. `kind(x, y)` says what a cell is: DECKED (deck
// over water), OPEN (water with nothing on it but, maybe, a fillet), ALIEN
// (deck that may have no part in a slant: a piece's frame) or anything else.
// The answer for one cell is null, or
//   on water   { fillet, lie, piece, from }: the fillet it takes; `from` is
//              the deck cell whose planking it carries on
//   on deck    { cut, lie, piece }: its corner cut away, or
//              { covered, under }: `covered` the sides (bits) a fillet lies
//              on, which have no beam; `under` { lie, side } when one of
//              those is the long leg of a ramp, whose beam tails off here
//              (`both`: and the far side is the leg of the ramp mirroring it)
//
// Corners are read as shore-art.js reads a coast, the deck for land. An
// inner corner (one water cell among three of deck) is a fillet, an outer
// one (one deck cell among three of water) a cut; both edges two tiles or
// longer make a real corner, which is left; a cell two corners want stays
// square. A cut needs deck on its two far sides, so that it has no edge but
// the slanted one, and the fillet across each single-tile edge it turns on.
// A fillet is laid only beside such a cut: sooner water showing on deck you
// can walk than planks alone where you cannot. A 45-degree fillet joins two
// deck cells; with one of them cut and the other not (the last step before
// a landing, a square end) the slant ends there and the beam runs straight
// on. A ramp's fillet needs plain deck under its long leg, and no fillet
// lies against deck that cannot give up its beam for it.
const DECKED = 1, OPEN = 0, ALIEN = -2
const BIT = { n: N, e: E, s: S, w: W }
const STEP = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }
function slanter(kind) {
  const corners = new Map(), answers = new Map()
  const BIG = 1 << 15
  const key = (x, y) => (y + BIG) * 2 * BIG + x + BIG
  // the corner at grid vertex (vx, vy): the top-left corner of cell (vx, vy)
  const cornerAt = (vx, vy) => {
    const k = key(vx, vy)
    let u = corners.get(k)
    if (u === undefined) corners.set(k, u = read(vx, vy))
    return u
  }
  function read(vx, vy) {
    const a = kind(vx - 1, vy - 1), b = kind(vx, vy - 1), c = kind(vx - 1, vy), d = kind(vx, vy)
    if ((a !== DECKED && a !== OPEN) || (b !== DECKED && b !== OPEN) || (c !== DECKED && c !== OPEN) || (d !== DECKED && d !== OPEN)) return null
    const decks = a + b + c + d
    if (decks !== 1 && decks !== 3) return null
    const q = decks === 1 ? DECKED : OPEN   // the odd cell: the one deck cell of an outer corner, the one water cell of an inner
    const qx = a === q || c === q ? -1 : 0, qy = a === q || b === q ? -1 : 0
    const Qx = vx + qx, Qy = vy + qy, sx = qx === 0 ? 1 : -1, sy = qy === 0 ? 1 : -1
    const Oy = vy - 1 - qy, Ox = vx - 1 - qx   // the row and column across the edge from Q
    const longH = kind(Qx + sx, Qy) === q && kind(Qx + sx, Oy) === 1 - q
    const longV = kind(Qx, Qy + sy) === q && kind(Ox, Qy + sy) === 1 - q
    if (longH && longV) return null
    const cut = q === DECKED
    if (cut && (kind(Qx + sx, Qy) !== DECKED || kind(Qx, Qy + sy) !== DECKED)) return null
    const north = cut ? Qy < Oy : Oy < Qy, west = cut ? Qx < Ox : Ox < Qx
    return {
      x: Qx, y: Qy, cut, piece: longH || longV ? 'c' : 'd',
      lie: longV ? (west ? 'w' : 'e') + (sy > 0 ? 'n' : 's') : (north ? 'n' : 's') + (sx > 0 ? 'w' : 'e'),
      // the far ends of the single-tile edges it turns on: the north-south one first
      needs: [...(longV ? [] : [[vx, vy + sy]]), ...(longH ? [] : [[vx + sx, vy]])],
      // a fillet's two legs lie along the deck across its east-west edge and across its north-south one
      legs: cut ? null : { h: [Qx, Oy], v: [Ox, Qy] },
      long: cut ? null : longH ? [Qx, Oy] : longV ? [Ox, Qy] : null,
    }
  }
  // the one corner that wants cell (x, y), if exactly one does
  const wanting = (x, y) => {
    let one = null
    for (let i = 0; i < 4; i++) {
      const u = cornerAt(x + (i & 1), y + (i >> 1))
      if (!u || u.x !== x || u.y !== y) continue
      if (one) return null
      one = u
    }
    return one
  }
  // the corner at the far end of a single-tile edge, if it is of the other
  // kind and has its cell to itself
  const across = (u, [vx, vy]) => {
    const o = cornerAt(vx, vy)
    return o && o.cut !== u.cut && wanting(o.x, o.y) === o ? o : null
  }
  // a fillet: not against deck that cannot give up its beam for it; and a
  // ramp's, if the deck cell under its long leg has another's long leg on
  // its far side, only when that is the ramp that mirrors this one
  const sound = f => {
    for (const side of 'nesw') if (kind(f.x + STEP[side][0], f.y + STEP[side][1]) === ALIEN) return false
    if (!f.long) return true
    const [lx, ly] = f.long, ox = 2 * lx - f.x, oy = 2 * ly - f.y
    if (kind(ox, oy) !== OPEN) return true
    const o = wanting(ox, oy)
    return !(o && o.long && o.long[0] === lx && o.long[1] === ly) || o.lie === mirrored(f.lie)
  }
  const cutStands = u => u.needs.every(v => { const f = across(u, v); return f && sound(f) })
  function solve(x, y) {
    const k = kind(x, y)
    if (k !== DECKED && k !== OPEN) return null
    const u = wanting(x, y)
    if (k === OPEN) {
      if (!u || !sound(u)) return null
      const stands = u.needs.map(v => { const c = across(u, v); return !!c && cutStands(c) })
      if (u.piece === 'c') return stands[0] ? { fillet: true, lie: u.lie, piece: 'c', from: u.long } : null
      if (!stands[0] && !stands[1]) return null
      return { fillet: true, lie: u.lie, piece: !stands[1] ? 'e' : !stands[0] ? 'f' : 'd', from: stands[1] ? u.legs.h : u.legs.v }
    }
    if (u && cutStands(u)) return { cut: true, lie: u.lie, piece: u.piece }
    let covered = 0, under = null, both = false
    for (const side of 'nesw') {
      const nx = x + STEP[side][0], ny = y + STEP[side][1]
      const f = kind(nx, ny) === OPEN ? answer(nx, ny) : null
      if (!f) continue
      covered |= BIT[side]
      if (f.piece !== 'c' || f.from[0] !== x || f.from[1] !== y) continue
      both = !!under
      under = { lie: f.lie, side }
    }
    return covered ? { covered, under, both } : null
  }
  const answer = (x, y) => {
    const k = key(x, y)
    let a = answers.get(k)
    if (a === undefined) answers.set(k, a = solve(x, y))
    return a
  }
  return answer
}
// The tile of a deck cell with its slant: `a` the answer for it, `open(side)`
// whether that side has no deck beside it.
function slantSkin(a, boards, open, X, Y) {
  if (a.cut) return deckCutSkin(boards, a.lie, a.piece)
  const bare = side => open(side) && !(a.covered & BIT[side])
  if (a.both) return deckUnderSkin(boards, 'nw'.includes(a.under.lie[0]) ? a.under.lie : mirrored(a.under.lie), 2)
  if (a.under) return deckUnderSkin(boards, a.under.lie, bare(FACING[a.under.side]))
  return cutSkin(boards, !bare('n'), !bare('e'), !bare('s'), !bare('w'), X, Y)
}

// Skin every walkable pier cell of builder `b` that lies over water.
//   X0, Y0   world tile of builder cell (0, 0)
//   runs     (x, y) => 'ns' | 'ew' | null: which way the bridge runs where the
//            caller knows (a gate corridor, which must not depend on what a
//            piece deals inside). Elsewhere it is the lie of the whole
//            bridge — all the deck that touches, corners included — so one
//            bridge has one planking however it wanders: east-west when
//            clearly so, else north-south.
//   slant    (x, y) => may this cell have part in a slanted edge; false for
//            none anywhere. A step is slanted only where every cell round
//            it may. A Wilds piece slants what it dealt itself: its frame
//            is square as before.
// Returns how many cells were skinned.
export function skinBridges(b, { X0 = 0, Y0 = 0, runs = () => null, slant = () => true } = {}) {
  const w = b.w, h = b.h
  // 1 = deck to skin, 2 = a pier that is not over water: left alone, but deck to its neighbours
  const pier = new Uint8Array(w * h)
  const cells = []
  // what each palette entry is, once (the deck names laid below come after)
  const isPier = b.palette.map(isPierSkin), isFillet = b.palette.map(isFilletSkin), isWater = b.palette.map(isWaterSkin)
  for (let y = 0; y < h; y++) {
    const props = b.prop[y], walk = b.walkG[y], ground = b.ground[y]
    for (let x = 0; x < w; x++) {
      const p = props[x]
      if (p < 0) continue
      // (a fillet of an earlier pass is laid afresh below)
      if (isFillet[p]) { props[x] = -1; continue }
      if (!walk[x] || !isPier[p]) continue
      const mine = isWater[ground[x]]
      pier[y * w + x] = mine ? 1 : 2
      if (mine) cells.push(y * w + x)
    }
  }
  if (!cells.length) return 0
  // beyond the builder the deck is taken to go on: no beam against the void
  const deck = (x, y) => x < 0 || y < 0 || x >= w || y >= h || pier[y * w + x] !== 0

  // The lie of each bridge: every deck cell that touches, corners included.
  const lie = new Uint8Array(w * h)   // 1 = ns, 2 = ew, 3 = being walked
  for (const start of cells) {
    if (lie[start]) continue
    const comp = [start]
    lie[start] = 3
    let sx = 0, sy = 0, sxx = 0, syy = 0
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i / w) | 0
      sx += x; sy += y; sxx += x * x; syy += y * y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (pier[j] && !lie[j]) { lie[j] = 3; comp.push(j) }
      }
    }
    const n = comp.length
    const v = n > 1 && sxx - sx * sx / n >= CLEAR * (syy - sy * sy / n) ? 2 : 1
    for (const i of comp) lie[i] = v
  }

  for (const i of cells) {
    const x = i % w, y = (i / w) | 0
    const run = runs(x, y) ?? (lie[i] === 2 ? 'ew' : 'ns')
    b.prop[y][x] = b.skin(cutSkin(run === 'ew' ? 'v' : 'h', deck(x, y - 1), deck(x + 1, y), deck(x, y + 1), deck(x - 1, y), X0 + x, Y0 + y))
  }

  // the slanted edges: cuts on the deck, fillets on the water beside it
  if (slant === false) return cells.length
  const kind = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return -1
    const i = y * w + x
    if (!slant(x, y)) return pier[i] === 1 ? ALIEN : -1
    if (pier[i]) return pier[i] === 1 ? DECKED : -1
    return b.prop[y][x] === -1 && !b.walkG[y][x] && isWater[b.ground[y][x]] ? OPEN : -1
  }
  const slantOf = slanter(kind)
  const boardsAt = (x, y) => b.palette[b.prop[y][x]][DECK.length + 1]
  const fillets = new Map()
  for (const i of cells) {
    const x = i % w, y = (i / w) | 0
    const a = slantOf(x, y)
    if (a) b.prop[y][x] = b.skin(slantSkin(a, boardsAt(x, y), side => !deck(x + STEP[side][0], y + STEP[side][1]), X0 + x, Y0 + y))
    // a fillet lies beside a deck cell: look at the eight cells round each
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = (y + dy) * w + x + dx
      if (fillets.has(j) || kind(x + dx, y + dy) !== OPEN) continue
      fillets.set(j, slantOf(x + dx, y + dy))
    }
  }
  for (const [j, f] of fillets) if (f) b.prop[(j / w) | 0][j % w] = b.skin(filletSkin(boardsAt(...f.from), f.lie, f.piece))
  return cells.length
}

// The same cut on the running game's cells ({ tile, skin, overlay }): call it
// after a plank at (x, y) was laid (a walkable pier overlay over water, by
// whatever name) or lifted. The cell and the four beside it are cut again:
// a laid plank takes the planking of the deck it joins, the deck beside it
// loses the beam and posts it had against the gap, and a lifted plank leaves
// its neighbours a proper end. A bridge keeps its planking through all of
// it; only a plank with no bridge to belong to is planked afresh, the way
// the pass above planks so small a deck (a lone plank east-west, a pair
// across the way they lie). Every cell that changed is marked for the tile
// layer. X0, Y0 is the world tile of map cell (0, 0). Returns how many
// cells changed.
//
// A plank moves the corners of the deck, and with them the slanted edges:
// every cell within REACH of it is given the cut, the fillet or the beams
// the new shape asks for. (A cell's tile hangs on nothing further off than
// that: its own corner, the fillets beside it, and the corners those turn on.)
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]]
const REACH = 6
export function recutDeck(map, x, y, { X0 = 0, Y0 = 0 } = {}) {
  const at = (cx, cy) => map[cy]?.[cx]
  if (!at(x, y)) return 0
  // what every cell in reach wears now, the plank and the four beside it first
  const before = []
  const note = (cx, cy) => { const c = at(cx, cy); if (c) before.push([cx, cy, c, c.overlay]) }
  note(x, y)
  for (const [dx, dy] of SIDES) note(x + dx, y + dy)
  for (let cy = y - REACH; cy <= y + REACH; cy++) for (let cx = x - REACH; cx <= x + REACH; cx++) {
    if (Math.abs(cx - x) + Math.abs(cy - y) > 1) note(cx, cy)
  }
  const isDeck = c => !!c && c.tile === TILE.FLOOR && isPierSkin(c.overlay)
  // (off the map the deck is taken to go on, as off the builder)
  const deck = (cx, cy) => { const c = at(cx, cy); return c === undefined || isDeck(c) }
  const cuttable = c => isDeck(c) && isWaterSkin(c.skin)
  const boardsOf = c => isDeckSkin(c?.overlay) ? c.overlay[DECK.length + 1] : null
  const touching = (cx, cy) => SIDES.reduce((k, [dx, dy]) => k + (isDeck(at(cx + dx, cy + dy)) ? 1 : 0), 0)
  const cut = (cx, cy, boards) => {
    at(cx, cy).overlay = cutSkin(boards, deck(cx, cy - 1), deck(cx + 1, cy), deck(cx, cy + 1), deck(cx - 1, cy), X0 + cx, Y0 + cy)
  }

  // the cell itself first, so a new plank is deck by the time its neighbours are cut
  const here = at(x, y)
  let mine = null
  if (cuttable(here)) {
    mine = boardsOf(here)
    // a new plank: the planking of a bridge it joins (a neighbour with more deck behind it)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (mine) break
      const c = at(x + dx, y + dy)
      if (isDeck(c) && touching(x + dx, y + dy) > 1) mine = boardsOf(c)
    }
    mine ??= (isDeck(at(x - 1, y)) || isDeck(at(x + 1, y))) && !(isDeck(at(x, y - 1)) || isDeck(at(x, y + 1))) ? 'v' : 'h'
    cut(x, y, mine)
  }
  for (const [dx, dy] of SIDES) {
    const cx = x + dx, cy = y + dy, c = at(cx, cy)
    if (!cuttable(c)) continue
    const beside = touching(cx, cy)
    // a lone plank the new one reached joins it; one left all alone is planked as a lone plank is
    cut(cx, cy, beside === 0 ? 'h' : mine && beside === 1 ? mine : boardsOf(c) ?? mine ?? 'h')
  }

  // the slants round the change, from the shape as it now is
  const kind = (cx, cy) => {
    const c = at(cx, cy)
    if (!c || !isWaterSkin(c.skin)) return -1
    if (c.tile === TILE.FLOOR) return isPierSkin(c.overlay) ? DECKED : -1
    return !c.overlay || isFilletSkin(c.overlay) ? OPEN : -1
  }
  const slantOf = slanter(kind)
  const open = (cx, cy) => side => !deck(cx + STEP[side][0], cy + STEP[side][1])
  for (const [cx, cy, c] of before) {
    if (kind(cx, cy) !== DECKED) continue
    const a = slantOf(cx, cy), boards = boardsOf(c) ?? 'h'
    if (a) c.overlay = slantSkin(a, boards, open(cx, cy), X0 + cx, Y0 + cy)
    else if (isDeckSkin(c.overlay)) cut(cx, cy, boards)
  }
  for (const [cx, cy, c] of before) {
    if (kind(cx, cy) !== OPEN) continue
    const f = slantOf(cx, cy)
    if (f) c.overlay = filletSkin(boardsOf(at(...f.from)) ?? 'h', f.lie, f.piece)
    else if (c.overlay) delete c.overlay
  }
  let changed = 0
  for (const [cx, cy, c, was] of before) {
    if ((c.overlay ?? null) === (was ?? null)) continue
    markTileDirty(map, cx, cy)
    changed++
  }
  return changed
}
