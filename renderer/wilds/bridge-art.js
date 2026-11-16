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

const mod = (n, m) => ((n % m) + m) % m
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

// Skin every walkable pier cell of builder `b` that lies over water.
//   X0, Y0   world tile of builder cell (0, 0)
//   runs     (x, y) => 'ns' | 'ew' | null: which way the bridge runs where the
//            caller knows (a gate corridor, which must not depend on what a
//            piece deals inside). Elsewhere it is the lie of the whole
//            bridge — all the deck that touches, corners included — so one
//            bridge has one planking however it wanders: east-west when
//            clearly so, else north-south.
// Returns how many cells were skinned.
export function skinBridges(b, { X0 = 0, Y0 = 0, runs = () => null } = {}) {
  const w = b.w, h = b.h
  // 1 = deck to skin, 2 = a pier that is not over water: left alone, but deck to its neighbours
  const pier = new Uint8Array(w * h)
  const cells = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!b.walkG[y][x] || !isPierSkin(b.palette[b.prop[y][x]])) continue
    const mine = isWaterSkin(b.palette[b.ground[y][x]])
    pier[y * w + x] = mine ? 1 : 2
    if (mine) cells.push(y * w + x)
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
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]]
export function recutDeck(map, x, y, { X0 = 0, Y0 = 0 } = {}) {
  const at = (cx, cy) => map[cy]?.[cx]
  const isDeck = c => !!c && c.tile === TILE.FLOOR && isPierSkin(c.overlay)
  // (off the map the deck is taken to go on, as off the builder)
  const deck = (cx, cy) => { const c = at(cx, cy); return c === undefined || isDeck(c) }
  const cuttable = c => isDeck(c) && isWaterSkin(c.skin)
  const boardsOf = c => isDeckSkin(c?.overlay) ? c.overlay[DECK.length + 1] : null
  const touching = (cx, cy) => SIDES.reduce((k, [dx, dy]) => k + (isDeck(at(cx + dx, cy + dy)) ? 1 : 0), 0)
  let changed = 0
  const cut = (cx, cy, boards) => {
    const c = at(cx, cy)
    const want = cutSkin(boards, deck(cx, cy - 1), deck(cx + 1, cy), deck(cx, cy + 1), deck(cx - 1, cy), X0 + cx, Y0 + cy)
    if (c.overlay === want) return
    c.overlay = want
    markTileDirty(map, cx, cy)
    changed++
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
  return changed
}
