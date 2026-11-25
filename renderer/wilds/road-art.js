// How a Wilds road meets the land beside it. A road cell is square: its
// ground (ow_road_<set>_<n>, tools/make-wilds-road-tiles.mjs) meets grass,
// sand, mud or mountain floor in a straight line, stepping in whole tiles
// where the road runs on a slant. The pass here, run last from terrain.js's
// finish() (and from the city's finishLand for its roads outside the walls),
// lays a verge on every cell that touches a road: a deco of the road's own
// gravel wearing off onto that cell, drawn over whatever ground it has, so
// one set of tiles serves grass, sand, mud, mountain floor, a trail's dirt or
// a village's cobbles alike. A verge is
//   along each side the road lies on   a band of the road's ground, ragged,
//                                      thinning into specks and the odd stone
//   in the corner of two such sides    filled across to the diagonal, so a
//                                      road stepping a tile at a time reads as
//                                      a slant and a bend has a rounded inside
//   at a corner the road touches alone a small nibble, which the bands of the
//                                      two cells beside it run into
// in the shapes of terrain/edges.js (M the sides 1 N / 2 E / 4 S / 8 W, D
// the corners 1 NE / 2 SE / 4 SW / 8 NW whose two sides are not road). Where
// a road's ground changes set along its length (grass to sand, say), the
// lower set's cells take the higher's verge on their sides that meet it, so
// that join frays too.
//
// It is art only: no cell changes its ground, what stands on it, or whether
// it can be walked or seen across; a verge is a deco, which only the screen
// draws (the readers of decos, over.js and the city's masonry, look for
// walls and gates by name). Water, a bank, a bridge deck, mountain rock and
// buildings take none. Every verge is a function of the cell's world
// tile and of the cells round it, and the frame's cells and their neighbours
// are the same whatever is dealt, so a piece and its neighbour lay the same
// verge on the cells they both see.
import { EDGE_SHAPES } from '../terrain/edges.js'
import { isWaterSkin, isPierSkin } from '../terrain/lib.js'
import { isMassSkin } from '../terrain/mountain.js'
import { isBankSkin } from './shore-art.js'
import { isFilletSkin } from './bridge-art.js'
import { isStructure } from './over.js'
import { hashInt } from './rand.js'

// A road's ground sets, and the order in which one frays over another.
export const ROAD_SETS = ['grass', 'marsh', 'mtn', 'sand']
export const VERGE_VARIANTS = 2
export const vergeSkin = (set, M, D, V) => `ow_deco_road_${set}_${M}_${D}_${V}`
export const VERGE_SKINS = ROAD_SETS.flatMap(set => EDGE_SHAPES.flatMap(([M, D]) =>
  Array.from({ length: VERGE_VARIANTS }, (_, V) => vergeSkin(set, M, D, V))))
export const isVergeSkin = n => typeof n === 'string' && n.startsWith('ow_deco_road_')
// the set of a road's ground (ow_road_<set>_<n>), or null
export const roadSetOf = n => /^ow_road_([a-z]+)_\d+$/.exec(n ?? '')?.[1] ?? null

// (the tests compare a world with and without its verges)
let enabled = true
export function setRoadVerges(on) { enabled = on }

// A cell that takes no verge, by its ground and what stands on it.
const bare = (ground, prop) => isWaterSkin(ground) || isBankSkin(ground)
  || isPierSkin(prop) || isFilletSkin(prop) || isMassSkin(prop) || isStructure(prop)

// Lay the verges. `b` is a terrain/lib.js MapBuilder, `deco` an array of its
// w * h cells (row by row) that takes the deco names; a cell already holding
// one keeps it. (X0, Y0) is the world tile of builder cell (0, 0), `seed`
// the world's. `skip(bx, by)` names cells to leave alone (the city's own).
// Off the builder counts as no road. Returns how many cells took a verge.
export function vergeRoads(b, deco, { X0, Y0, seed, skip = null }) {
  if (!enabled) return 0
  const { w, h } = b
  const rankOf = b.palette.map(n => ROAD_SETS.indexOf(roadSetOf(n)))
  const rank = new Int8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rank[y * w + x] = rankOf[b.ground[y][x]]
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : rank[y * w + x]
  let laid = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, own = rank[i]
    // what frays onto this cell: any road beside it, or for a road cell a
    // road of a higher set
    const n = at(x, y - 1), e = at(x + 1, y), s = at(x, y + 1), wst = at(x - 1, y)
    const M = (n > own ? 1 : 0) | (e > own ? 2 : 0) | (s > own ? 4 : 0) | (wst > own ? 8 : 0)
    const ne = M & 3 ? -1 : at(x + 1, y - 1), se = M & 6 ? -1 : at(x + 1, y + 1)
    const sw = M & 12 ? -1 : at(x - 1, y + 1), nw = M & 9 ? -1 : at(x - 1, y - 1)
    const D = (ne > own ? 1 : 0) | (se > own ? 2 : 0) | (sw > own ? 4 : 0) | (nw > own ? 8 : 0)
    if (!M && !D) continue
    if (deco[i] || skip?.(x, y)) continue
    if (own < 0 && bare(b.palette[b.ground[y][x]], b.palette[b.prop[y][x]])) continue
    // the verge of the highest set that frays onto it
    let top = -1
    for (const r of [n, e, s, wst, ne, se, sw, nw]) if (r > own && r > top) top = r
    deco[i] = vergeSkin(ROAD_SETS[top], M, D, hashInt(seed, X0 + x, Y0 + y, 47) % VERGE_VARIANTS)
    laid++
  }
  return laid
}
