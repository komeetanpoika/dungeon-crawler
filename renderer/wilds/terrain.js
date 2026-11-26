// The land of one Wilds piece: ground, water, mountains, trees and rocks,
// laid with the same tile art and rim passes as the hand-made open maps.
//
// Every cell is a pure function of its world tile, and — for cells at least
// FRAME tiles inside their own piece — of the piece's deal. That is what
// makes pieces fit: the outer frame of a piece is the same whatever its deal,
// so a piece can lay MARGIN tiles of each neighbour around itself (for shore
// rims, mountain faces and two-tile trees) without generating the neighbour,
// and the two always agree. Nothing here draws from a sequential rng for
// anything a neighbour can see.
//
// Local cell (x, y), 0..PIECE-1, is builder cell (x + MARGIN, y + MARGIN).
import { PIECE, FRAME, BLEND, MARGIN, biomeSampler, gateAt } from './layout.js'
import { roadSides } from './roads.js'
import { inBay } from './city/geometry.js'
import { hash, hashInt, noise2, mulberry32 } from './rand.js'
import { MapBuilder, shoreline, WATER_SKINS, isWaterSkin, isSandySkin, RIM_TILES, TREE_PAIRS } from '../terrain/lib.js'
import { MTN, stampMountainRim, stampGroundEdge, isMassSkin, LAT_PX, LAT_PY } from '../terrain/mountain.js'
import { stampSandEdge, SAND_EDGES } from '../terrain/beach.js'
import { SITE_SKINS } from './sites.js'
import { skinBridges, DECK_SKINS, DECK_CUT_SKINS, DECK_UNDER_SKINS, FILLET_SKINS } from './bridge-art.js'
import { slopeShores, SLOPE_SKINS } from './shore-art.js'
import { vergeRoads, VERGE_SKINS } from './road-art.js'
import { sandSkinAt, edgeHardpan, isHardpanSkin, isRippleSkin, desertDress, DESERT_SKINS, layDunes, dunesOn, DUNE_SKINS, SHADE_SKINS, DUNE_LOOK, duneField, crestField, crestAt, nearCity } from './desert-art.js'
import { CITY_SKINS } from './city/kit.js'
import { TOWNSFOLK_SKINS } from '../data/townsfolk-looks.js'
import { DESERT_LANDMARKS } from './desert.js'

const SIZE = PIECE + 2 * MARGIN
const REACH = 2          // how far a cell's rules look at its neighbours
// The dune field (desert-art.js duneField), worked out once a piece over
// local cells FIELD_LO..FIELD_HI-1: what grows in the desert keeps off its
// crests out to two cells beyond the builder (a two-tile tree looks one
// further), and grows thinner within two of one; the shading of the
// builder's cells looks four beyond it. (An outcrop whose rock lies beyond
// it works out its own few cells.)
const FIELD_LO = -MARGIN - 4, FIELD_HI = PIECE + MARGIN + 4
// a rule's neighbours may themselves look REACH further; the dune field asks
// the country DUNE_LOOK round its own cells
const EXT = Math.max(MARGIN + 2 * REACH + 1, -FIELD_LO + DUNE_LOOK, FIELD_HI - PIECE + DUNE_LOOK)
const ESIZE = PIECE + 2 * EXT

const PINES = { tall: ['ow_tree_pine_top', 'ow_tree_pine_trunk'], small: ['ow_tree_small', 'ow_tree_small', 'ow_bush_round'] }
const AUTUMN = { tall: ['ow_tree_autumn_top', 'ow_tree_autumn_trunk'], small: ['ow_tree_small_autumn', 'ow_tree_autumn_top'] }
const DEAD = ['ow_deadtree_0', 'ow_deadtree_1']
const BUSHES = ['ow_bush_0', 'ow_bush_1']
// What grows in the desert (tools/make-wilds-desert-tiles.mjs draws what the
// packs lack): the palm, two cells tall where the cell above it is free as a
// pine is, else the walled well's one-cell date palm; cacti, the pack's and
// three more; shrubs, the pack's green and three dry; dead trees. On the sand
// mostly cacti and scrub, on and by the hardpan dead wood and dry scrub (each
// list weighted by repeating a name).
const PALMS = { tall: ['ow_tree_palm_top', 'ow_tree_palm'], small: ['ow_tree_palm_small'] }
const SAND_FLORA = ['ow_cactus', 'ow_cactus', 'ow_cactus_barrel', 'ow_cactus_pear', 'ow_cactus_column',
  'ow_shrub_0', 'ow_shrub_1', 'ow_shrub_dry_0', 'ow_shrub_dry_1', 'ow_deadtree_0']
const HARD_FLORA = ['ow_deadtree_0', 'ow_deadtree_1', 'ow_shrub_dry_0', 'ow_shrub_dry_1', 'ow_shrub_dry_2', 'ow_shrub_dry_2', 'ow_cactus_barrel']
export const DESERT_FLORA = [...new Set([...SAND_FLORA, ...HARD_FLORA, ...PALMS.tall, ...PALMS.small])]
// What lies on the sand, walked over: dry grass, tumbleweed, bones, a ribcage, broken pottery.
const DEBRIS = ['ow_deco_drygrass_0', 'ow_deco_drygrass_1', 'ow_deco_drygrass_2', 'ow_deco_drygrass_0', 'ow_deco_drygrass_1', 'ow_deco_drygrass_2',
  'ow_deco_tumbleweed', 'ow_deco_tumbleweed', 'ow_deco_bones_0', 'ow_deco_bones_1', 'ow_deco_ribs', 'ow_deco_pottery_0', 'ow_deco_pottery_1']
export const DESERT_DECO = [...new Set(DEBRIS)]
const isDecoSkin = n => typeof n === 'string' && n.startsWith('ow_deco_')
// How thick it grows, by the share of cells: plants in the desert's groves
// (the tree field high) and in the open, and up to `lush` by hardpan or
// water; debris; lone rocks where the land is rocky (the tree field low) and
// elsewhere. Within two cells of a dune's crest there is `dunes` of each:
// the open dunes are bare. Of the plants, palms are `palms` in a grove or by
// water and `palmsOpen` elsewhere.
const DESERT_GROWTH = { grove: 0.07, open: 0.015, lush: 0.05, debris: 0.03, rocky: 0.03, rock: 0.004, dunes: 0.4, palms: 0.3, palmsOpen: 0.05 }
// Sandstone outcrops: a few cells of rock in the desert (OUTCROP_SHAPES, each
// row and each column of one unbroken), with nothing standing on the cells
// round them, so nothing beside one is ever shut in. One may stand in each
// square of `lattice` world tiles, its middle 3 to lattice - 4 tiles into it
// (so the cells round two never meet), where the land is rocky (a field of
// the world tile below `rocky`) and a hash falls under `odds`; all of it, and
// the cells round it, in desert land off a gate's corridor, and none of its
// rock on a dune's crest. Rimmed by finish() (ow_outcrop_<m>, m the sides 1 N
// / 2 E / 4 S / 8 W it runs on into the next outcrop cell).
const OUTCROP = { lattice: 11, rocky: 0.45, odds: 0.6 }
const OUTCROP_SHAPES = [
  [[0, 0], [1, 0]],
  [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]],
  [[0, -1], [0, 0], [1, 0], [0, 1]],
  [[-1, -1], [0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
  [[0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [2, 0]],
  [[0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1]],
].map(cells => {
  // at[(dy + 3) * 7 + dx + 3]: 1 for its rock, 2 for a cell round it, within three of its middle
  const at = new Uint8Array(49)
  for (const [dx, dy] of cells) for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) {
    const i = (dy + ey + 3) * 7 + dx + ex + 3
    if (!at[i]) at[i] = 2
  }
  for (const [dx, dy] of cells) at[(dy + 3) * 7 + dx + 3] = 1
  const ring = []
  for (let i = 0; i < 49; i++) if (at[i] === 2) ring.push([(i % 7) - 3, Math.floor(i / 7) - 3])
  return { cells, ring, at }
})
// The box round an outcrop's middle that its rock lies in, and the one that
// it and the cells round it lie in, any shape's.
const spanOf = offsets => ({
  x0: Math.min(...offsets.map(([dx]) => dx)), x1: Math.max(...offsets.map(([dx]) => dx)),
  y0: Math.min(...offsets.map(([, dy]) => dy)), y1: Math.max(...offsets.map(([, dy]) => dy)),
})
const OUTCROP_ROCK = spanOf(OUTCROP_SHAPES.flatMap(s => s.cells))
const OUTCROP_SPAN = spanOf(OUTCROP_SHAPES.flatMap(s => s.ring))
export const outcropSkin = m => `ow_outcrop_${m}`
export const OUTCROP_SKINS = Array.from({ length: 16 }, (_, m) => outcropSkin(m))
export const isOutcropSkin = n => typeof n === 'string' && n.startsWith('ow_outcrop_')
// an outcrop cell before finish() gives it its rim
const OUTCROP_LAID = outcropSkin(0)
const ROCKS_MOSS = ['ow_rock_gray_moss_0', 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2']
const ROCKS_BROWN = ['ow_rock_brown_0', 'ow_rock_brown_1', 'ow_rock_brown_2']
const ROCKS_GRAY = ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']
const SKERRY = ['ow_rock_water_gray_0', 'ow_rock_water_gray_1', 'ow_rock_water_gray_2']
const GRASS = ['ow_grass_0', 'ow_grass_1', 'ow_grass_2']
const DIRT = ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2', 'ow_dirt_3']
// A beach's sand; and, with the desert's dress off (desert-art.js), the
// desert's two sand tiles. Dressed, the desert lays its rippled sand.
const SAND = ['ow_sand_0', 'ow_sand_flat']
// Where the desert has hardpan; dressed, finish() turns it to cracked clay
// with edges (desert-art.js edgeHardpan). (ow_hardpan_1 is the pack's left
// edge of a hardpan flat, see-through down one side: as fill it left black
// nicks all over the desert)
const HARDPAN = 'ow_hardpan_0'
// A path over sand: the dirt of a path over grass, its tufts turned to drifts of sand.
const SAND_PATH = ['ow_path_sand_0', 'ow_path_sand_1', 'ow_path_sand_2', 'ow_path_sand_3']
const PIER = { h: 'ow_pier_log', v: 'ow_pier_log_v' }
// the two-tile trees, the desert's palm among them: cleared whole
const TOP_OF = new Map([...TREE_PAIRS, PALMS.tall].map(([top, trunk]) => [trunk, top]))
const TRUNK_OF = new Map([...TREE_PAIRS, PALMS.tall].map(([top, trunk]) => [top, trunk]))
// A road's own ground (tools/make-wilds-road-tiles.mjs), one set for each
// ground it crosses: a trail's dirt would not show on mountain floor or
// marsh mud, nor width alone.
const ROAD = Object.fromEntries(['grass', 'sand', 'mtn', 'marsh'].map(g => [g, [0, 1, 2, 3].map(i => `ow_road_${g}_${i}`)]))
const isRoadSkin = n => typeof n === 'string' && n.startsWith('ow_road_')

// How many cells wide a road is, in the frame and inside a piece. Its lanes
// where it crosses a piece edge are the gate corridor's g..g+2 at three
// wide (g the gate's offset; the corridor is g-1..g+2) and the whole
// corridor at four. Tools may draw the land at the other width; the game
// never changes it.
export let ROAD_WIDTH = 3
export function setRoadWidth(n) {
  if (n !== 3 && n !== 4) throw new Error(`a road is 3 or 4 wide, not ${n}`)
  ROAD_WIDTH = n
}
// The first lane of a road crossing at gate offset g (the city's road spurs
// take the same lanes).
export const roadLane0 = g => g + 1 - (ROAD_WIDTH >> 1)

// Every tile name terrain.js can lay. features.js adds its own (FEATURE_SKINS).
export const TERRAIN_SKINS = [...new Set([
  ...GRASS, ...DIRT, ...SAND, HARDPAN, ...SAND_PATH, ...Object.values(ROAD).flat(), ...WATER_SKINS,
  ...RIM_TILES.pond, ...RIM_TILES.shore, ...RIM_TILES.mud, ...SLOPE_SKINS, PIER.h, PIER.v, ...DECK_SKINS, ...DECK_CUT_SKINS, ...DECK_UNDER_SKINS, ...FILLET_SKINS,
  ...PINES.tall, ...PINES.small, ...AUTUMN.tall, ...AUTUMN.small, ...DEAD, ...BUSHES, ...DESERT_FLORA, ...DESERT_DECO, ...OUTCROP_SKINS,
  ...ROCKS_MOSS, ...ROCKS_BROWN, ...ROCKS_GRAY, ...SKERRY,
  ...MTN.ground, ...MTN.edge, ...MTN.lat.flat(), ...Object.values(MTN.ridge).flat(), ...MTN.rock, ...SAND_EDGES, ...VERGE_SKINS,
  ...DESERT_SKINS, ...DUNE_SKINS, ...SHADE_SKINS,
])]
// Skins stamped by features.js and sites.js (villages, caves, ruins, camps, landmarks,
// the desert's spires and cairns).
export const FEATURE_SKINS = [
  ...SITE_SKINS, ...DESERT_LANDMARKS,
  'ow_mushroom', 'ow_boat', 'ow_stump', 'ow_tree_apple', 'ow_tree_small', 'ow_pond_11', 'ow_bush_berry',
]
// Kalevanlinna (city/kit.js) is laid with the same art and these; its people
// and animals (data/townsfolk-looks.js) are loaded with them.
export const WILDS_SKINS = [...new Set([...TERRAIN_SKINS, ...FEATURE_SKINS, ...CITY_SKINS, ...TOWNSFOLK_SKINS])]

const mod = (n, m) => ((n % m) + m) % m
const smooth = t => t * t * (3 - 2 * t)

// `blank(x, y)` (local cells): cells nobody will look at, laid as plain grass
// without working out what grows there. Kalevanlinna passes the inside of its
// wall, which it lays itself: those cells lie over a dozen tiles from any
// piece edge it keeps, further than any rule or art pass looks.
export function makeTerrain(seed, wx, wy, deal = 0, { blank = null } = {}) {
  const X0 = wx * PIECE, Y0 = wy * PIECE
  const dealSeed = hashInt(seed, wx, wy, 9000 + deal)

  // Edge distance of a cell inside this piece; -1 for a neighbour's cell
  // (always within that neighbour's frame, so never dealt).
  const depth = (x, y) => (x < 0 || y < 0 || x >= PIECE || y >= PIECE) ? -1 : Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y)
  const mix = (x, y) => { const d = depth(x, y); return d < FRAME ? 0 : smooth(Math.min(1, (d - FRAME) / BLEND)) }
  // A terrain field: the world's own in the frame, blending to this deal's
  // inside. The blend keeps the field's spread, so features do not thin out
  // in the ring where the two meet.
  const field = (salt, x, y, opts) => {
    const f0 = noise2(seed + salt, X0 + x, Y0 + y, opts)
    const t = mix(x, y)
    if (t === 0) return f0
    const f1 = noise2(dealSeed + salt, X0 + x, Y0 + y, opts)
    return 0.5 + ((f0 - 0.5) * (1 - t) + (f1 - 0.5) * t) / Math.sqrt((1 - t) * (1 - t) + t * t)
  }
  const rnd = (x, y, salt) => hash(seed, X0 + x, Y0 + y, salt + (depth(x, y) >= FRAME ? (deal + 1) * 7717 : 0))
  const pickBy = (a, x, y, salt) => a[Math.floor(rnd(x, y, salt) * a.length)]

  // Per-piece memo over the cells the rules can touch.
  const memo = (fn, make = () => new Array(ESIZE * ESIZE)) => {
    const store = make()
    return (x, y) => {
      const i = (y + EXT) * ESIZE + (x + EXT)
      let v = store[i]
      if (v === undefined) v = store[i] = fn(x, y)
      return v
    }
  }
  const country = biomeSampler(seed, X0 - EXT, Y0 - EXT, X0 + PIECE + EXT, Y0 + PIECE + EXT)
  const biome = memo((x, y) => country(X0 + x, Y0 + y))
  const fWater = memo((x, y) => field(11, x, y, { freq: 1 / 22, octaves: 3 }))
  const fMass = memo((x, y) => field(12, x, y, { freq: 1 / 18, octaves: 3 }))
  const fMud = memo((x, y) => field(13, x, y, { freq: 1 / 14, octaves: 2 }))
  const fHard = memo((x, y) => field(14, x, y, { freq: 1 / 16, octaves: 2 }))
  const fTree = memo((x, y) => field(15, x, y, { freq: 0.07, octaves: 3 }))
  // The dune field over local cells FIELD_LO..FIELD_HI-1, worked out when
  // first asked; and whether local cell (x, y) is on a crest of it. Pure in
  // the world tile.
  let duneGrid = null
  const FW = FIELD_HI - FIELD_LO
  const dunes = () => duneGrid ??= duneField(seed, X0 + FIELD_LO, Y0 + FIELD_LO, FW, FW, { country: (X, Y) => biome(X - X0, Y - Y0) })
  const fieldAt = (x, y) => (y - FIELD_LO) * FW + x - FIELD_LO
  const onCrest = (x, y) => {
    if (x < FIELD_LO || y < FIELD_LO || x >= FIELD_HI || y >= FIELD_HI) return crestAt(seed, X0 + x, Y0 + y)
    return dunes().crest[fieldAt(x, y)] === 1
  }
  // A dune's crest within two cells: the open dunes, where little grows.
  const nearCrest = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (onCrest(x + dx, y + dy)) return true
    return false
  }

  // The outcrop of the lattice square (i, j) of world tiles (OUTCROP): its
  // middle in local cells and, once asked, its shape (null where none
  // stands). One whose middle lies deep in this piece (its rock and the cells
  // round it all inside the frame) is dealt; any other is the world tile's
  // own, so a neighbour that holds its cells in its margin makes the same of it.
  const squares = new Map()
  const squareOf = (i, j) => {
    const key = i * 65536 + j
    let sq = squares.get(key)
    if (sq === undefined) {
      const L = OUTCROP.lattice
      sq = { cx: i * L + 3 + Math.floor(hash(seed, i, j, 7301) * (L - 6)) - X0, cy: j * L + 3 + Math.floor(hash(seed, i, j, 7302) * (L - 6)) - Y0, shape: undefined }
      squares.set(key, sq)
    }
    return sq
  }
  const shapeOf = (i, j, sq) => {
    if (sq.shape !== undefined) return sq.shape
    const { cx, cy } = sq
    sq.shape = null
    const dealt = depth(cx, cy) >= FRAME + 3 ? (deal + 1) * 7717 : 0
    const h = salt => hash(seed, i, j, salt + dealt)
    if (biome(cx, cy) === 'desert' && h(7303) < OUTCROP.odds && noise2(seed + 16, X0 + cx, Y0 + cy, { freq: 1 / 30, octaves: 2 }) < OUTCROP.rocky) {
      const shape = OUTCROP_SHAPES[Math.floor(h(7304) * OUTCROP_SHAPES.length)]
      // (and none of it on Kalevanlinna's land: the city lays its outskirts with art of its own)
      const land = (x, y) => biome(x, y) === 'desert' && rawKind(x, y) === 'land' && !corridor(x, y) && !nearCity(X0 + x, Y0 + y)
      const fits = shape.cells.every(([dx, dy]) => land(cx + dx, cy + dy)) && shape.ring.every(([dx, dy]) => land(cx + dx, cy + dy))
      if (fits && !rockOnCrest(cx, cy, shape.cells)) sq.shape = shape
    }
    return sq.shape
  }
  // Is any of these cells (offsets from (cx, cy)) on a crest of the dune
  // field? Beyond the piece's field, from the field over the rock's own box:
  // the same answer, a tile's crest being the same in any rectangle asked.
  const inField = (x, y) => x >= FIELD_LO && y >= FIELD_LO && x < FIELD_HI && y < FIELD_HI
  const rockOnCrest = (cx, cy, cells) => {
    if (cells.every(([dx, dy]) => inField(cx + dx, cy + dy))) return cells.some(([dx, dy]) => onCrest(cx + dx, cy + dy))
    const { x0, x1, y0, y1 } = OUTCROP_ROCK, w = x1 - x0 + 1
    const box = crestField(seed, X0 + cx + x0, Y0 + cy + y0, w, y1 - y0 + 1)
    return cells.some(([dx, dy]) => box[(dy - y0) * w + dx - x0] === 1)
  }
  // What an outcrop makes of a local cell (desert only): 1 its rock, 2 a
  // cell round it, where nothing stands; else 0. (An outcrop is decided only
  // where its middle lies near enough to matter.)
  const outcropAt = memo((x, y) => {
    const L = OUTCROP.lattice, S = OUTCROP_SPAN, X = X0 + x, Y = Y0 + y
    let near = 0
    for (let j = Math.floor((Y - S.y1) / L); j <= Math.floor((Y - S.y0) / L); j++) for (let i = Math.floor((X - S.x1) / L); i <= Math.floor((X - S.x0) / L); i++) {
      const sq = squareOf(i, j)
      const dx = x - sq.cx, dy = y - sq.cy
      if (dx < S.x0 || dx > S.x1 || dy < S.y0 || dy > S.y1) continue
      const shape = shapeOf(i, j, sq)
      const v = shape ? shape.at[(dy + 3) * 7 + dx + 3] : 0
      if (v === 1) return 1
      if (v === 2) near = 2
    }
    return near
  })

  // Mountain art never meets sand: no transition tiles exist, so a strip of
  // grass keeps them apart wherever mountain country borders desert or sea.
  const nearSandy = memo((x, y) => {
    for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) {
      const b = biome(x + dx, y + dy)
      if (b === 'desert' || b === 'sea') return true
    }
    return false
  })

  // What the land is before gates, paths and features: 'land', 'water', 'mass'.
  const rawKind = memo((x, y) => {
    if (inBay(X0 + x, Y0 + y)) return 'water'   // pure in the world tile, so neighbours agree
    switch (biome(x, y)) {
      case 'sea': return fWater(x, y) > 0.47 ? 'water' : 'land'
      case 'forest': return fWater(x, y) > 0.75 ? 'water' : 'land'
      case 'autumn': return fWater(x, y) > 0.76 ? 'water' : 'land'
      case 'marsh': return fMud(x, y) > 0.63 ? 'water' : 'land'
      case 'mountain': return !nearSandy(x, y) && fMass(x, y) > 0.54 ? 'mass' : 'land'
      default: return 'land'
    }
  })
  const nearWater = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (rawKind(x + dx, y + dy) === 'water') return true
    return false
  }

  // Gates: the crossing on each edge of the piece a cell belongs to. A cell
  // in a gate corridor is always open: 'v' for a north/south crossing, 'h'
  // for east/west.
  const gateCache = new Map()
  const gateOf = (pwx, pwy, side) => {
    const k = `${pwx},${pwy},${side}`
    let g = gateCache.get(k)
    if (g === undefined) gateCache.set(k, g = gateAt(seed, pwx, pwy, side))
    return g
  }
  const corridor = memo((x, y) => {
    const px = Math.floor(x / PIECE), py = Math.floor(y / PIECE)
    const lx = x - px * PIECE, ly = y - py * PIECE
    const pwx = wx + px, pwy = wy + py
    const inLane = (o, g) => o >= g - 1 && o <= g + 2
    if (ly < FRAME && inLane(lx, gateOf(pwx, pwy, 'N'))) return 'v'
    if (ly >= PIECE - FRAME && inLane(lx, gateOf(pwx, pwy, 'S'))) return 'v'
    if (lx < FRAME && inLane(ly, gateOf(pwx, pwy, 'W'))) return 'h'
    if (lx >= PIECE - FRAME && inLane(ly, gateOf(pwx, pwy, 'E'))) return 'h'
    return null
  }, () => new Array(ESIZE * ESIZE).fill(undefined))
  // Which sides of the piece a cell belongs to carry a road: the edge's, so
  // the neighbour asks the same; never the deal's.
  const sidesCache = new Map()
  const sidesOf = (pwx, pwy) => {
    const k = `${pwx},${pwy}`
    let s = sidesCache.get(k)
    if (s === undefined) sidesCache.set(k, s = roadSides(seed, pwx, pwy))
    return s
  }

  const grassSkin = (x, y) => { const h = hash(seed, X0 + x, Y0 + y, 40); return h < 0.95 ? GRASS[0] : h < 0.975 ? GRASS[1] : GRASS[2] }
  const floorSkin = (x, y) => MTN.ground[hashInt(seed, X0 + x, Y0 + y, 41) % 7]
  const dirtSkin = (x, y) => DIRT[hashInt(seed, X0 + x, Y0 + y, 42) % DIRT.length]
  // the desert's sand: swept by the wind (desert-art.js), pure in the world tile
  const sandSkin = (x, y) => desertDress() ? sandSkinAt(seed, X0 + x, Y0 + y) : hash(seed, X0 + x, Y0 + y, 43) < 0.8 ? SAND[0] : SAND[1]

  // The ground under a land cell.
  const landGround = memo((x, y) => {
    switch (biome(x, y)) {
      case 'marsh': return fMud(x, y) > 0.53 ? dirtSkin(x, y) : grassSkin(x, y)
      case 'desert': return fHard(x, y) > 0.68 ? HARDPAN : sandSkin(x, y)
      case 'sea': return nearWater(x, y, REACH) ? SAND[0] : grassSkin(x, y)
      case 'mountain': return !nearSandy(x, y) && fMass(x, y) > 0.46 ? floorSkin(x, y) : grassSkin(x, y)
      default: return grassSkin(x, y)
    }
  })
  const isGrass = s => s.startsWith('ow_grass')
  const isFloor = s => s.startsWith('ow_mtn_ground')

  // What grows or lies on a land cell, before two-tile trees are resolved:
  // null, or { skin } for a one-cell thing, or { kit } for a tree that may
  // stand two cells tall.
  const occupant = memo((x, y) => {
    if (rawKind(x, y) !== 'land' || corridor(x, y)) return null
    const g = landGround(x, y), b = biome(x, y)
    const r = rnd(x, y, 20), r2 = rnd(x, y, 21)
    if (isFloor(g)) return r < 0.035 ? { skin: pickBy(MTN.rock, x, y, 22) } : null
    const t = fTree(x, y)
    if (b === 'forest' || b === 'autumn') {
      if (r < Math.max(0.012, Math.min(0.8, (t - 0.45) * 4.5))) {
        if (r2 > 0.92) return { skin: pickBy(BUSHES, x, y, 22) }
        return { kit: b === 'forest' ? PINES : AUTUMN }
      }
      return rnd(x, y, 23) < 0.005 ? { skin: pickBy(ROCKS_MOSS, x, y, 22) } : null
    }
    if (b === 'mountain') {
      if (r < Math.max(0.02, Math.min(0.6, (t - 0.5) * 3))) return { kit: PINES }
      return rnd(x, y, 23) < 0.01 ? { skin: pickBy(ROCKS_GRAY, x, y, 22) } : null
    }
    if (b === 'marsh') {
      if (r < Math.max(0.03, Math.min(0.45, (t - 0.48) * 2.5))) {
        if (r2 < 0.5) return { skin: pickBy(DEAD, x, y, 22) }
        if (r2 < 0.7) return { skin: pickBy(BUSHES, x, y, 22) }
        return { kit: AUTUMN }
      }
      return null
    }
    if (b === 'desert') {
      // nothing grows or lies on a dune's crest: it would leave a gap in it to see through
      if (onCrest(x, y)) return null
      // an outcrop's rock, and nothing round it
      const rock = outcropAt(x, y)
      if (rock) return rock === 1 ? { skin: OUTCROP_LAID } : null
      const G = DESERT_GROWTH
      // (a share thinned where the dunes are open: asked only of a cell whose draw falls within the share)
      let dunes = null
      const within = (draw, share) => draw < share && draw < share * ((dunes ??= nearCrest(x, y)) ? G.dunes : 1)
      // a plant: thick in the groves, thin in the open, thicker by hardpan or water
      let plant = within(r, t > 0.55 ? G.grove : G.open)
      let wet = false
      if (!plant && within(r, G.lush)) plant = fHard(x, y) > 0.6 || (wet = nearWater(x, y, 3))
      if (plant) {
        // a palm; by Kalevanlinna (whose outskirts pair only the pack's two-tile trees) one cell tall
        if (rnd(x, y, 27) < (t > 0.6 || wet || nearWater(x, y, 3) ? G.palms : G.palmsOpen))
          return nearCity(X0 + x, Y0 + y) || nearCity(X0 + x, Y0 + y - 1) ? { skin: PALMS.small[0] } : { kit: PALMS }
        return { skin: pickBy(fHard(x, y) > 0.6 ? HARD_FLORA : SAND_FLORA, x, y, 22) }
      }
      // one draw decides between debris, a lone rock and nothing
      const d = rnd(x, y, 23)
      if (!within(d, G.debris + (t < 0.4 ? G.rocky : G.rock))) return null
      return d < G.debris * (dunes ? G.dunes : 1) ? { skin: pickBy(DEBRIS, x, y, 29) } : { skin: pickBy(ROCKS_BROWN, x, y, 22) }
    }
    // sea: woods inland, the odd rock on the beach
    if (isGrass(g)) return r < Math.max(0.03, Math.min(0.5, (t - 0.47) * 3)) ? { kit: PINES } : null
    return r < 0.012 ? { skin: pickBy(ROCKS_GRAY, x, y, 22) } : null
  }, () => new Array(ESIZE * ESIZE).fill(undefined))
  // A cell a canopy may sit on: open land with nothing of its own; in the
  // desert, neither a dune's crest nor beside an outcrop.
  const canopyFree = (x, y) => rawKind(x, y) === 'land' && !corridor(x, y) && !isFloor(landGround(x, y)) && !occupant(x, y) &&
    (biome(x, y) !== 'desert' || (!onCrest(x, y) && !outcropAt(x, y)))
  const wantsTall = (x, y) => { const o = occupant(x, y); return !!o?.kit && rnd(x, y, 24) < 0.6 }
  const propAt = (x, y) => {
    const o = occupant(x, y)
    if (o) {
      if (!o.kit) return o.skin
      if (wantsTall(x, y)) return canopyFree(x, y - 1) ? o.kit.tall[1] : o.kit.small[0]
      return pickBy(o.kit.small, x, y, 25)
    }
    // (the cheaper test first: few cells have a tall tree below them)
    if (wantsTall(x, y + 1) && canopyFree(x, y)) return occupant(x, y + 1).kit.tall[0]
    return null
  }

  const pathGround = (ground, x, y) =>
    isGrass(ground) || ground.startsWith('ow_dirt') ? dirtSkin(x, y)
      : ground.startsWith('ow_sand') || isHardpanSkin(ground) ? SAND_PATH[hashInt(seed, X0 + x, Y0 + y, 42) % SAND_PATH.length]
      : ground
  // A road's ground by what it is laid on: the sand set on sand, the mountain
  // set on mountain floor and anywhere in the mountains (so the floor beside
  // it never frays into a strip of grass), the marsh set in the marsh, else
  // the grass set. Pure in the world tile, as the frame must be.
  const roadGround = (ground, x, y) => {
    if (isRoadSkin(ground)) return ground
    const bm = biome(x, y)
    const set = ground.startsWith('ow_sand') || isHardpanSkin(ground) || SAND_PATH.includes(ground) ? ROAD.sand
      : isFloor(ground) || bm === 'mountain' ? ROAD.mtn
      : bm === 'marsh' ? ROAD.marsh : ROAD.grass
    return set[hashInt(seed, X0 + x, Y0 + y, 46) % set.length]
  }
  const waterSkin = (x, y) => WATER_SKINS[mod(X0 + x + Y0 + y, 2)]

  // ---- lay the base terrain ------------------------------------------------
  const b = new MapBuilder('wilds', 'wilds', 'wilds', SIZE, SIZE)
  // a third layer of art between the ground and what stands on it, builder
  // cell by builder cell: the roads' verges (finish()), and what a site hangs
  // behind a prop (setDeco)
  const deco = new Array(SIZE * SIZE).fill(null)
  const put = (x, y, ground, prop, walk) => {
    const bx = x + MARGIN, by = y + MARGIN
    b.ground[by][bx] = b.skin(ground)
    b.prop[by][bx] = prop ? b.skin(prop) : -1
    b.walkG[by][bx] = walk
  }
  for (let y = -MARGIN; y < PIECE + MARGIN; y++) for (let x = -MARGIN; x < PIECE + MARGIN; x++) {
    if (blank?.(x, y)) { put(x, y, GRASS[0], null, true); continue }
    const k = rawKind(x, y), cor = corridor(x, y)
    if (k === 'water') {
      if (cor) put(x, y, waterSkin(x, y), PIER[cor], true)
      else put(x, y, waterSkin(x, y), !nearLand(x, y) && rnd(x, y, 26) < 0.006 ? pickBy(SKERRY, x, y, 22) : null, false)
    } else if (k === 'mass') {
      if (cor) put(x, y, laneOf(x, y) === 'road' ? roadGround(floorSkin(x, y), x, y) : floorSkin(x, y), null, true)
      else put(x, y, floorSkin(x, y), MTN.lat[0][0], false)
    } else if (cor) {
      const g = landGround(x, y), lane = laneOf(x, y)
      put(x, y, lane === 'road' ? roadGround(g, x, y) : lane ? pathGround(g, x, y) : g, null, true)
    } else {
      // (what lies on the ground, ow_deco_*, is walked over)
      const p = propAt(x, y)
      put(x, y, landGround(x, y), p, !p || isDecoSkin(p))
    }
  }
  function nearLand(x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rawKind(x + dx, y + dy) !== 'water') return true
    return false
  }
  // How the lanes of a gate corridor are worn: on a side that carries a
  // road, ROAD_WIDTH lanes of it ('road'); on any other, the two middle
  // lanes wear the path ('path'). null for the rest of the corridor.
  function laneOf(x, y) {
    const px = Math.floor(x / PIECE), py = Math.floor(y / PIECE)
    const lx = x - px * PIECE, ly = y - py * PIECE
    const pwx = wx + px, pwy = wy + py
    const wear = (o, side) => {
      const g = gateOf(pwx, pwy, side)
      if (!sidesOf(pwx, pwy)[side]) return o === g || o === g + 1 ? 'path' : null
      const a = roadLane0(g)
      return o >= a && o < a + ROAD_WIDTH ? 'road' : null
    }
    return (ly < FRAME && wear(lx, 'N')) || (ly >= PIECE - FRAME && wear(lx, 'S'))
      || (lx < FRAME && wear(ly, 'W')) || (lx >= PIECE - FRAME && wear(ly, 'E')) || null
  }

  // ---- what features build on ---------------------------------------------
  const skinAt = (grid, x, y) => b.palette[grid[y + MARGIN]?.[x + MARGIN]] ?? null
  const inside = (x, y) => depth(x, y) >= FRAME
  const kind = (x, y) => isMassSkin(skinAt(b.prop, x, y)) ? 'mass' : isWaterSkin(skinAt(b.ground, x, y)) ? 'water' : 'land'
  const free = (x, y) => inside(x, y) && b.walkG[y + MARGIN][x + MARGIN] && b.prop[y + MARGIN][x + MARGIN] === -1

  const dryGround = (x, y) => {
    const bm = biome(x, y)
    return bm === 'sea' ? SAND[0] : bm === 'desert' ? sandSkin(x, y) : bm === 'marsh' ? dirtSkin(x, y) : grassSkin(x, y)
  }
  // Remove whatever stands on a cell. A two-tile tree goes whole: half a
  // tree is the broken look the asset review rejected.
  const clearCell = (x, y) => {
    const bx = x + MARGIN, by = y + MARGIN
    const p = b.palette[b.prop[by][bx]]
    if (p === undefined) return null
    if (TOP_OF.has(p) && skinAt(b.prop, x, y - 1) === TOP_OF.get(p)) { b.prop[by - 1][bx] = -1; b.walkG[by - 1][bx] = true }
    if (TRUNK_OF.has(p) && skinAt(b.prop, x, y + 1) === TRUNK_OF.get(p)) { b.prop[by + 1][bx] = -1; b.walkG[by + 1][bx] = true }
    b.prop[by][bx] = -1
    return p
  }
  // Make one interior cell plain walkable ground.
  const openCell = (x, y) => {
    if (!inside(x, y)) return
    const bx = x + MARGIN, by = y + MARGIN
    const was = clearCell(x, y)
    const g = b.palette[b.ground[by][bx]]
    if (isWaterSkin(g)) b.ground[by][bx] = b.skin(dryGround(x, y))
    else if (isMassSkin(was) && !isFloor(g)) b.ground[by][bx] = b.skin(floorSkin(x, y))
    b.walkG[by][bx] = true
  }
  // Ground a site is built on: its opened pad, and whatever else it claims.
  // The paths are laid before the sites are stamped; off this ground nothing
  // solid or wet may then land on a path, so a path is only ever interrupted
  // where a site has ground of its own to walk round what stands on it.
  const siteCells = new Set()
  const claim = (x, y) => { if (inside(x, y)) siteCells.add(y * PIECE + x) }
  const open = (cx, cy, r = 0) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) { openCell(cx + dx, cy + dy); claim(cx + dx, cy + dy) }
  }
  // Ground no dune may lie on (finish() lays them): the disc of interior
  // cells within r of (cx, cy), round what a feature holds and round its pad.
  const keptOpen = new Set()
  const keepOpen = (cx, cy, r = 0) => {
    const n = Math.floor(r)
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++)
      if (dx * dx + dy * dy <= r * r && inside(cx + dx, cy + dy)) keptOpen.add((cy + dy) * PIECE + cx + dx)
  }
  // One path cell: a pier over water, a pass through rock, a trail on land;
  // a road cell is a path cell that wears the road's ground.
  const pathCells = new Set(), roadCells = new Set()
  const pathKept = (x, y) => pathCells.has(y * PIECE + x) && !siteCells.has(y * PIECE + x)
  // (a gate corridor in the frame is path too, though not this deal's to lay)
  const laid = (x, y) => pathCells.has(y * PIECE + x) || !!corridor(x, y)
  // Path cells never touch only at a corner: such a joint cannot be walked
  // over water, through rock or between trees, so a diagonal step takes the
  // cell between as well. That is what makes a one-wide trail a stair, and
  // two bridges that brush past each other one deck. (`has`: what is laid;
  // `add` lays the cell between.)
  const joinCorners = (has, x, y, pier, add) => {
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (!has(x + dx, y + dy) || has(x + dx, y) || has(x, y + dy)) continue
      const along = pier === PIER.h ? inside(x, y + dy) : !inside(x + dx, y)
      if (along) add(x, y + dy); else add(x + dx, y)
    }
  }
  const pathCell = (x, y, pier, road = false) => {
    if (!inside(x, y)) return
    if (road) roadCells.add(y * PIECE + x)
    if (!pathCells.has(y * PIECE + x)) {
      pathCells.add(y * PIECE + x)
      joinCorners(laid, x, y, pier, (cx, cy) => pathCell(cx, cy, pier, road))
    }
    const bx = x + MARGIN, by = y + MARGIN
    const g = b.palette[b.ground[by][bx]]
    if (isWaterSkin(g)) {
      b.prop[by][bx] = b.skin(pier)
      b.walkG[by][bx] = true
      return
    }
    const was = clearCell(x, y)
    const cut = isMassSkin(was) && !isFloor(g)
    b.ground[by][bx] = b.skin(road ? roadGround(cut ? floorSkin(x, y) : g, x, y) : cut ? floorSkin(x, y) : pathGround(g, x, y))
    b.walkG[by][bx] = true
  }
  const clampIn = v => Math.max(FRAME, Math.min(PIECE - 1 - FRAME, v))
  // A gently wandering path between two interior cells: at each step a
  // width x width square of path cells, `lo` from the step's cell. A road's
  // step is held where its whole square stays inside, so the road keeps its
  // width along a border; a path's keeps the old rule (clampIn), and with it
  // every piece laid before roads. (`cell` lays one cell: tracePaths only notes it.)
  const wander = (x0, y0, x1, y1, width, lo, road, cell = pathCell) => {
    const hold = road ? v => Math.max(FRAME - lo, Math.min(PIECE - FRAME - width - lo, v)) : clampIn
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 1) {
      const sx = road ? hold(x0) : x0, sy = road ? hold(y0) : y0
      for (let a = 0; a < width; a++) for (let c = 0; c < width; c++) cell(sx + lo + a, sy + lo + c, PIER.h, road)
      return
    }
    const nx = -dy / len, ny = dx / len
    const s1 = (hash(dealSeed, x0 * 131 + x1, y0 * 131 + y1, 60) - 0.5) * 2
    const s2 = (hash(dealSeed, x0 * 131 + x1, y0 * 131 + y1, 61) - 0.5) * 2
    const amp = Math.min(7, len * 0.2)
    const pier = Math.abs(dx) >= Math.abs(dy) ? PIER.h : PIER.v
    const n = Math.ceil(len * 2)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const off = amp * (s1 * Math.sin(Math.PI * t) + 0.5 * s2 * Math.sin(2 * Math.PI * t))
      // a bulge that would leave the interior slides along its edge instead,
      // so the path never breaks
      const px = hold(Math.round(x0 + dx * t + nx * off)), py = hold(Math.round(y0 + dy * t + ny * off))
      for (let a = 0; a < width; a++) for (let c = 0; c < width; c++) cell(px + lo + a, py + lo + c, pier, road)
    }
  }
  const path = (x0, y0, x1, y1, width = 2) => wander(x0, y0, x1, y1, width, 0, false)
  // The cells these paths ([[x0, y0, x1, y1, width], ...], laid in order on a
  // piece with no other path) would cover, without laying them: for a caller
  // that must decide as if only they were there.
  const tracePaths = calls => {
    const traced = new Set()
    const has = (x, y) => traced.has(y * PIECE + x) || !!corridor(x, y)
    const cell = (x, y, pier) => {
      if (!inside(x, y) || traced.has(y * PIECE + x)) return
      traced.add(y * PIECE + x)
      joinCorners(has, x, y, pier, (cx, cy) => cell(cx, cy, pier))
    }
    for (const [x0, y0, x1, y1, width] of calls) wander(x0, y0, x1, y1, width, 0, false, cell)
    return (x, y) => traced.has(y * PIECE + x)
  }
  // A road: a path ROAD_WIDTH wide wearing the road's ground, set about its
  // line so that from a gate's inner point it covers the frame's road lanes.
  const road = (x0, y0, x1, y1) => wander(x0, y0, x1, y1, ROAD_WIDTH, roadLane0(0), true)

  const gates = {
    N: { x: gateOf(wx, wy, 'N'), y: 0 },
    E: { x: PIECE - 1, y: gateOf(wx, wy, 'E') },
    S: { x: gateOf(wx, wy, 'S'), y: PIECE - 1 },
    W: { x: 0, y: gateOf(wx, wy, 'W') },
  }
  const gateInner = side =>
    side === 'N' ? { x: gates.N.x, y: FRAME }
      : side === 'S' ? { x: gates.S.x, y: PIECE - 1 - FRAME }
      : side === 'W' ? { x: FRAME, y: gates.W.y }
      : { x: PIECE - 1 - FRAME, y: gates.E.y }

  // May a dune crest lie on builder cell (bx, by)? Only on the desert's
  // rippled sand with nothing standing on it, neither on a way (a path, a
  // road, a trail, a gate's corridor) nor beside one, nor on a site's ground
  // or ground kept open. layDunes asks up to two cells beyond the builder
  // too: those lie in a neighbour's frame, where no deal reaches, so they are
  // what the frame's own rules make of them. Paths, sites and kept ground lie
  // in the interior, so a cell within MARGIN of a piece edge is answered the
  // same in the piece and in its neighbour's margin. (The way check of a cell
  // two beyond looks three beyond, into the neighbour's interior, which this
  // piece cannot see; only the lone corners on the builder's outermost line
  // depend on it, so only the outermost margin cells may come out otherwise
  // than the neighbour lays them: see layDunes.)
  const duneOpen = (bx, by) => {
    const x = bx - MARGIN, y = by - MARGIN
    const held = bx >= 0 && by >= 0 && bx < SIZE && by < SIZE
    const ground = held ? b.palette[b.ground[by][bx]] : rawKind(x, y) === 'land' && !corridor(x, y) ? landGround(x, y) : null
    if (!isRippleSkin(ground) || (held ? b.prop[by][bx] !== -1 : propAt(x, y))) return false
    if (inside(x, y) && (siteCells.has(y * PIECE + x) || keptOpen.has(y * PIECE + x))) return false
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (corridor(nx, ny) || (inside(nx, ny) && pathCells.has(ny * PIECE + nx))) return false
    }
    return true
  }
  // Must builder cell (bx, by) stay level, the dunes' shading easing to
  // nothing round it? Any ground but the desert's rippled sand (a way, the
  // hardpan, a shore), and a site's ground or ground kept open. (Where the
  // sand frays into another country, layDunes keeps level by the country
  // itself, which a margin cell at the builder's edge cannot see from its
  // ground.) layDunes asks up to three cells beyond the builder: up to two
  // beyond is a neighbour's frame, answered from the frame's own rules (a
  // corridor lane that wears no road or path is the land's own ground); three
  // beyond is its interior, out of this piece's sight, and asked only for the
  // lone corners on the builder's outermost line (see layDunes).
  const duneFlat = (bx, by) => {
    const x = bx - MARGIN, y = by - MARGIN
    const held = bx >= 0 && by >= 0 && bx < SIZE && by < SIZE
    const ground = held ? b.palette[b.ground[by][bx]] : rawKind(x, y) === 'land' && !(corridor(x, y) && laneOf(x, y)) ? landGround(x, y) : null
    return !isRippleSkin(ground) || (inside(x, y) && (siteCells.has(y * PIECE + x) || keptOpen.has(y * PIECE + x)))
  }

  // The art passes, run once after features: the desert's hardpan frays into
  // the sand round it, sand frays into grass, the mountain masses take their
  // faces and the floor its edge, water its rim; the dunes lie on the sand
  // still bare, and the roads' verges are laid last.
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    // decided from the ground of each cell and of the cells up to two away
    // (a crack looks at its neighbours' neighbours), and the frame's ground
    // is the same whatever the deal, so the outer MARGIN rows come out the
    // same in the piece and in its neighbour's margin
    if (desertDress()) edgeHardpan(b, { X0: X0 - MARGIN, Y0: Y0 - MARGIN, seed })
    // Each outcrop cell takes its rim from the outcrop cells beside it; a
    // cell beyond the builder is what the frame's own rule makes of it.
    const rockCell = b.palette.map(isOutcropSkin)
    const rock = (bx, by) => bx >= 0 && by >= 0 && bx < SIZE && by < SIZE ? rockCell[b.prop[by][bx]] === true : occupant(bx - MARGIN, by - MARGIN)?.skin === OUTCROP_LAID
    const rims = []
    for (let by = 0; by < SIZE; by++) for (let bx = 0; bx < SIZE; bx++) {
      if (!rockCell[b.prop[by][bx]]) continue
      rims.push([bx, by, outcropSkin((rock(bx, by - 1) ? 1 : 0) | (rock(bx + 1, by) ? 2 : 0) | (rock(bx, by + 1) ? 4 : 0) | (rock(bx - 1, by) ? 8 : 0))])
    }
    for (const [bx, by, skin] of rims) b.prop[by][bx] = b.skin(skin)
    stampSandEdge(b)
    stampMountainRim(b, mulberry32(hashInt(seed, wx, wy, 70 + deal)))
    // The cone lattice is global: its cell index comes from the world tile,
    // so cones run on unbroken across piece edges.
    for (let by = 0; by < SIZE; by++) for (let bx = 0; bx < SIZE; bx++) {
      const m = /^ow_mtn_lat_(\d+)_\d+$/.exec(b.palette[b.prop[by][bx]] ?? '')
      if (!m) continue
      const q = mod(X0 + bx - MARGIN, LAT_PX) + LAT_PX * mod(Y0 + by - MARGIN, LAT_PY)
      b.prop[by][bx] = b.skin(`ow_mtn_lat_${m[1]}_${q}`)
    }
    // Ridge pieces are picked by world tile too: the rim pass draws them
    // from a stream, which would differ between a piece and its neighbour's
    // copy of the same cell.
    for (let by = 0; by < SIZE; by++) for (let bx = 0; bx < SIZE; bx++) {
      const m = /^ow_mtn_ridge_(dr|dl)_\d+$/.exec(b.palette[b.prop[by][bx]] ?? '')
      if (!m) continue
      const set = MTN.ridge[m[1]]
      b.prop[by][bx] = b.skin(set[hashInt(seed, X0 + bx - MARGIN, Y0 + by - MARGIN, 45) % set.length])
    }
    stampGroundEdge(b)
    shoreline(b)
    // shoreline() gives a beach its sand-coloured rim only where the land is
    // sand: beside a path laid over the sand, or the desert's hardpan, the
    // water got the green bank of a pond in the grass.
    const beachy = (bx, by) => {
      const n = b.palette[b.ground[by]?.[bx]]
      return isSandySkin(n) || isHardpanSkin(n) || SAND_PATH.includes(n) || ROAD.sand.includes(n)
    }
    // ow_pond_<x><y>: which side the bank is on, 0 west/north, 2 east/south
    const bank = b.palette.map(n => /^ow_pond_([012])([012])$/.exec(n))
    for (let by = 0; by < SIZE; by++) for (let bx = 0; bx < SIZE; bx++) {
      const m = bank[b.ground[by][bx]]
      if (!m) continue
      const dx = m[1] - 1, dy = m[2] - 1
      if ((dx || dy) && (!dx || beachy(bx + dx, by)) && (!dy || beachy(bx, by + dy))) b.ground[by][bx] = b.skin(`ow_shore_${m[1]}${m[2]}`)
    }
    // The rim is square; where a coast steps a tile at a time the bank is
    // redrawn slanted through the middle of each step. Near a piece edge it
    // is decided from what both pieces know of the strip along it: the
    // frame, whose land and water no deal moves.
    slopeShores(b, {
      X0: X0 - MARGIN, Y0: Y0 - MARGIN,
      frame: { x0: MARGIN, y0: MARGIN, w: PIECE, h: PIECE, band: MARGIN, look: FRAME, far: (bx, by) => rawKind(bx - MARGIN, by - MARGIN) === 'water' },
    })
    // Bridges: every pier a path, a corridor or a site laid becomes plank
    // deck cut to what ended up beside it. A corridor's planks follow the
    // corridor, so the frame looks the same whatever is dealt inside; and
    // only a deck dealt inside has its stepped edges slanted.
    skinBridges(b, {
      X0: X0 - MARGIN, Y0: Y0 - MARGIN,
      slant: (bx, by) => inside(bx - MARGIN, by - MARGIN),
      runs: (bx, by) => {
        const x = bx - MARGIN, y = by - MARGIN
        if (inside(x, y)) return null
        const cor = corridor(x, y)
        return cor === 'v' ? 'ns' : cor === 'h' ? 'ew' : null
      },
    })
    // The dunes, on the sand every other pass has left bare (desert-art.js):
    // their crests, none by a road, and the shading of their slopes, level
    // round every way, site and other ground (only where the builder holds
    // desert: a dune stands on desert)
    let desert = false
    for (let y = -MARGIN; y < PIECE + MARGIN && !desert; y++) for (let x = -MARGIN; x < PIECE + MARGIN; x++) if (biome(x, y) === 'desert') { desert = true; break }
    if (desert && desertDress() && dunesOn()) {
      layDunes(b, {
        X0: X0 - MARGIN, Y0: Y0 - MARGIN, seed, open: duneOpen, flat: duneFlat,
        field: { ...dunes(), x0: FIELD_LO + MARGIN, y0: FIELD_LO + MARGIN, w: FW },
      })
    }
    // Last, on the finished ground: every cell beside a road wears its
    // verge, the road's gravel worn off onto it (road-art.js).
    vergeRoads(b, deco, { X0: X0 - MARGIN, Y0: Y0 - MARGIN, seed })
  }

  return {
    seed, wx, wy, deal, b,
    biome: (x, y) => biome(x, y),
    // what the land is before anything is laid on it ('land', 'water', 'mass'), up to EXT cells beyond the piece
    rawKind: (x, y) => rawKind(x, y),
    kind, free, inside, open, claim, keepOpen, clear: openCell, path, road, tracePaths, gates, gateInner, finish,
    // a walkable line one cell wide with no path art: a way through the trees
    // for something that must be reachable but not signposted
    clearLine: (x0, y0, x1, y1) => {
      let x = x0, y = y0
      openCell(x, y)
      while (x !== x1 || y !== y1) {
        const dx = x1 - x, dy = y1 - y
        if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy)
        openCell(x, y)
      }
    },
    dirtSkin: (x, y) => dirtSkin(x, y),
    // for features: the prop and ground art of a local cell
    propAt: (x, y) => skinAt(b.prop, x, y),
    groundAt: (x, y) => skinAt(b.ground, x, y),
    // the deco of a local cell (a road's verge), up to MARGIN cells beyond the piece; after finish()
    decoAt: (x, y) => deco[(y + MARGIN) * SIZE + x + MARGIN] ?? null,
    // stamp helpers in local coordinates, for interior cells only
    setGround: (x, y, skin) => { if (inside(x, y)) b.ground[y + MARGIN][x + MARGIN] = b.skin(skin) },
    setProp: (x, y, skin, { walkable = false } = {}) => {
      if (!inside(x, y) || (!walkable && pathKept(x, y))) return
      b.prop[y + MARGIN][x + MARGIN] = b.skin(skin)
      b.walkG[y + MARGIN][x + MARGIN] = walkable
    },
    // what hangs behind a cell's prop (the wall behind an inn's sign, the stall
    // a horse stands in): its deco, drawn between the ground and the prop; a
    // road's verge (finish()) leaves a deco laid here as it is
    setDeco: (x, y, skin) => { if (inside(x, y)) deco[(y + MARGIN) * SIZE + x + MARGIN] = skin ?? null },
    // a cell of mountain rock (finish() shapes it), and the stony ground it stands on
    setMass: (x, y) => {
      if (!inside(x, y) || pathKept(x, y)) return
      clearCell(x, y)
      b.ground[y + MARGIN][x + MARGIN] = b.skin(floorSkin(x, y))
      b.prop[y + MARGIN][x + MARGIN] = b.skin(MTN.lat[0][0])
      b.walkG[y + MARGIN][x + MARGIN] = false
    },
    // a cell of sandstone outcrop (finish() rims it by the outcrop cells beside
    // it), blocked and opaque to sight, on the dry ground it stands on
    setOutcrop: (x, y) => {
      if (!inside(x, y) || pathKept(x, y)) return
      clearCell(x, y)
      if (isWaterSkin(skinAt(b.ground, x, y))) b.ground[y + MARGIN][x + MARGIN] = b.skin(dryGround(x, y))
      b.prop[y + MARGIN][x + MARGIN] = b.skin(OUTCROP_LAID)
      b.walkG[y + MARGIN][x + MARGIN] = false
    },
    setFloor: (x, y, { roads = false } = {}) => {
      if (!inside(x, y) || isWaterSkin(skinAt(b.ground, x, y)) || (!roads && pathCells.has(y * PIECE + x))) return
      b.ground[y + MARGIN][x + MARGIN] = b.skin(floorSkin(x, y))
    },
    // a pond cell: open water, blocked; finish() gives it its rim
    setWater: (x, y) => {
      if (!inside(x, y) || pathKept(x, y)) return
      clearCell(x, y)
      b.ground[y + MARGIN][x + MARGIN] = b.skin(waterSkin(x, y))
      b.walkG[y + MARGIN][x + MARGIN] = false
    },
    walkable: (x, y) => !!b.walkG[y + MARGIN]?.[x + MARGIN],
    // a cell a path or a road was laid on, and one a road was laid on
    onPath: (x, y) => pathCells.has(y * PIECE + x),
    onRoad: (x, y) => inside(x, y) && roadCells.has(y * PIECE + x),
    onSite: (x, y) => siteCells.has(y * PIECE + x),
    // ground kept open (keepOpen): no dune lies there
    keptOpen: (x, y) => inside(x, y) && keptOpen.has(y * PIECE + x),
    // a cell on a crest of the dune field, laid or not
    onCrest: (x, y) => onCrest(x, y),
    // the road's ground for a local cell whose ground is `ground` (the city lays its outside roads with it)
    roadGround: (ground, x, y) => roadGround(ground, x, y),
    rnd, dryGround, grassSkin,
  }
}
