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
import { hash, hashInt, noise2, mulberry32 } from './rand.js'
import { MapBuilder, shoreline, WATER_SKINS, isWaterSkin, RIM_TILES, TREE_PAIRS } from '../terrain/lib.js'
import { MTN, stampMountainRim, stampGroundEdge, isMassSkin, LAT_PX, LAT_PY } from '../terrain/mountain.js'
import { stampSandEdge, SAND_EDGES } from '../terrain/beach.js'

const SIZE = PIECE + 2 * MARGIN
const REACH = 2          // how far a cell's rules look at its neighbours
const EXT = MARGIN + 2 * REACH + 1   // a rule's neighbours may themselves look REACH further
const ESIZE = PIECE + 2 * EXT

const PINES = { tall: ['ow_tree_pine_top', 'ow_tree_pine_trunk'], small: ['ow_tree_small', 'ow_tree_small', 'ow_bush_round'] }
const AUTUMN = { tall: ['ow_tree_autumn_top', 'ow_tree_autumn_trunk'], small: ['ow_tree_small_autumn', 'ow_tree_autumn_top'] }
const DEAD = ['ow_deadtree_0', 'ow_deadtree_1']
const BUSHES = ['ow_bush_0', 'ow_bush_1']
const DESERT_FLORA = ['ow_cactus', 'ow_cactus', 'ow_deadtree_0', 'ow_deadtree_1', 'ow_shrub_0', 'ow_shrub_1']
const ROCKS_MOSS = ['ow_rock_gray_moss_0', 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2']
const ROCKS_BROWN = ['ow_rock_brown_0', 'ow_rock_brown_1', 'ow_rock_brown_2']
const ROCKS_GRAY = ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']
const SKERRY = ['ow_rock_water_gray_0', 'ow_rock_water_gray_1', 'ow_rock_water_gray_2']
const GRASS = ['ow_grass_0', 'ow_grass_1', 'ow_grass_2']
const DIRT = ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2', 'ow_dirt_3']
const SAND = ['ow_sand_0', 'ow_sand_flat']
const HARDPAN = ['ow_hardpan_0', 'ow_hardpan_1']
const PIER = { h: 'ow_pier_log', v: 'ow_pier_log_v' }
const TOP_OF = new Map(TREE_PAIRS.map(([top, trunk]) => [trunk, top]))
const TRUNK_OF = new Map(TREE_PAIRS.map(([top, trunk]) => [top, trunk]))

// Every tile name terrain.js can lay. features.js adds its own (FEATURE_SKINS).
export const TERRAIN_SKINS = [...new Set([
  ...GRASS, ...DIRT, ...SAND, ...HARDPAN, ...WATER_SKINS,
  ...RIM_TILES.pond, ...RIM_TILES.shore, ...RIM_TILES.mud, PIER.h, PIER.v,
  ...PINES.tall, ...PINES.small, ...AUTUMN.tall, ...AUTUMN.small, ...DEAD, ...BUSHES, ...DESERT_FLORA,
  ...ROCKS_MOSS, ...ROCKS_BROWN, ...ROCKS_GRAY, ...SKERRY,
  ...MTN.ground, ...MTN.edge, ...MTN.lat.flat(), ...Object.values(MTN.ridge).flat(), ...MTN.rock, ...SAND_EDGES,
])]
// Skins stamped by features.js (villages, caves, ruins, landmarks).
export const FEATURE_SKINS = [
  'ow_cobble_green', 'ow_well', 'ow_well_top', 'ow_sign', 'ow_fence_l', 'ow_fence_m', 'ow_fence_r',
  'ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r', 'ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er',
  'ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r', 'ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r',
  'ow_house_wall_l', 'ow_house_wall_r', 'ow_house_wall_brown_l', 'ow_house_wall_brown_r',
  'ow_house_wall_stone_l', 'ow_house_wall_stone_r',
  'ow_house_door', 'ow_house_door_gray', 'ow_house_door_brown', 'ow_house_arch_stone',
  'ow_cave_arch_0', 'ow_cave_arch_1', 'ow_mushroom', 'ow_boat', 'ow_beehive', 'ow_stump', 'ow_tree_apple',
  'ow_ruin_pillar', 'ow_ruin_pillar_2', 'ow_ruin_rubble', 'ow_ruin_wall_0', 'ow_ruin_wall_1', 'ow_ruin_wall_2',
  'ow_pond_11', 'ow_bush_berry', 'ow_tent_00', 'ow_tent_01', 'ow_tent_10', 'ow_tent_11',
]
export const WILDS_SKINS = [...new Set([...TERRAIN_SKINS, ...FEATURE_SKINS])]

const mod = (n, m) => ((n % m) + m) % m
const smooth = t => t * t * (3 - 2 * t)

export function makeTerrain(seed, wx, wy, deal = 0) {
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

  const grassSkin = (x, y) => { const h = hash(seed, X0 + x, Y0 + y, 40); return h < 0.95 ? GRASS[0] : h < 0.975 ? GRASS[1] : GRASS[2] }
  const floorSkin = (x, y) => MTN.ground[hashInt(seed, X0 + x, Y0 + y, 41) % 7]
  const dirtSkin = (x, y) => DIRT[hashInt(seed, X0 + x, Y0 + y, 42) % DIRT.length]
  const sandSkin = (x, y) => hash(seed, X0 + x, Y0 + y, 43) < 0.8 ? SAND[0] : SAND[1]

  // The ground under a land cell.
  const landGround = memo((x, y) => {
    switch (biome(x, y)) {
      case 'marsh': return fMud(x, y) > 0.53 ? dirtSkin(x, y) : grassSkin(x, y)
      case 'desert': return fHard(x, y) > 0.64 ? (hash(seed, X0 + x, Y0 + y, 44) < 0.75 ? HARDPAN[0] : HARDPAN[1]) : sandSkin(x, y)
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
      if (r < (t > 0.55 ? 0.07 : 0.015)) return { skin: pickBy(DESERT_FLORA, x, y, 22) }
      return rnd(x, y, 23) < (t < 0.4 ? 0.05 : 0.006) ? { skin: pickBy(ROCKS_BROWN, x, y, 22) } : null
    }
    // sea: woods inland, the odd rock on the beach
    if (isGrass(g)) return r < Math.max(0.03, Math.min(0.5, (t - 0.47) * 3)) ? { kit: PINES } : null
    return r < 0.012 ? { skin: pickBy(ROCKS_GRAY, x, y, 22) } : null
  }, () => new Array(ESIZE * ESIZE).fill(undefined))
  // A cell a canopy may sit on: open land with nothing of its own.
  const canopyFree = (x, y) => rawKind(x, y) === 'land' && !corridor(x, y) && !isFloor(landGround(x, y)) && !occupant(x, y)
  const wantsTall = (x, y) => { const o = occupant(x, y); return !!o?.kit && rnd(x, y, 24) < 0.6 }
  const propAt = (x, y) => {
    const o = occupant(x, y)
    if (o) {
      if (!o.kit) return o.skin
      if (wantsTall(x, y)) return canopyFree(x, y - 1) ? o.kit.tall[1] : o.kit.small[0]
      return pickBy(o.kit.small, x, y, 25)
    }
    if (canopyFree(x, y) && wantsTall(x, y + 1)) return occupant(x, y + 1).kit.tall[0]
    return null
  }

  const pathGround = (ground, x, y) =>
    isGrass(ground) || ground.startsWith('ow_dirt') ? dirtSkin(x, y)
      : ground.startsWith('ow_sand') ? HARDPAN[0]
      : ground
  const waterSkin = (x, y) => WATER_SKINS[mod(X0 + x + Y0 + y, 2)]

  // ---- lay the base terrain ------------------------------------------------
  const b = new MapBuilder('wilds', 'wilds', 'wilds', SIZE, SIZE)
  const put = (x, y, ground, prop, walk) => {
    const bx = x + MARGIN, by = y + MARGIN
    b.ground[by][bx] = b.skin(ground)
    b.prop[by][bx] = prop ? b.skin(prop) : -1
    b.walkG[by][bx] = walk
  }
  for (let y = -MARGIN; y < PIECE + MARGIN; y++) for (let x = -MARGIN; x < PIECE + MARGIN; x++) {
    const k = rawKind(x, y), cor = corridor(x, y)
    if (k === 'water') {
      if (cor) put(x, y, waterSkin(x, y), PIER[cor], true)
      else put(x, y, waterSkin(x, y), !nearLand(x, y) && rnd(x, y, 26) < 0.006 ? pickBy(SKERRY, x, y, 22) : null, false)
    } else if (k === 'mass') {
      if (cor) put(x, y, floorSkin(x, y), null, true)
      else put(x, y, floorSkin(x, y), MTN.lat[0][0], false)
    } else if (cor) {
      const g = landGround(x, y)
      put(x, y, laneOf(x, y) ? pathGround(g, x, y) : g, null, true)
    } else {
      const p = propAt(x, y)
      put(x, y, landGround(x, y), p, !p)
    }
  }
  function nearLand(x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rawKind(x + dx, y + dy) !== 'water') return true
    return false
  }
  // The two middle lanes of a gate corridor wear the path.
  function laneOf(x, y) {
    const px = Math.floor(x / PIECE), py = Math.floor(y / PIECE)
    const lx = x - px * PIECE, ly = y - py * PIECE
    const pwx = wx + px, pwy = wy + py
    const mid = (o, g) => o === g || o === g + 1
    if (ly < FRAME && mid(lx, gateOf(pwx, pwy, 'N'))) return true
    if (ly >= PIECE - FRAME && mid(lx, gateOf(pwx, pwy, 'S'))) return true
    if (lx < FRAME && mid(ly, gateOf(pwx, pwy, 'W'))) return true
    if (lx >= PIECE - FRAME && mid(ly, gateOf(pwx, pwy, 'E'))) return true
    return false
  }

  // ---- what features build on ---------------------------------------------
  const skinAt = (grid, x, y) => b.palette[grid[y + MARGIN]?.[x + MARGIN]] ?? null
  const inside = (x, y) => depth(x, y) >= FRAME
  const kind = (x, y) => isMassSkin(skinAt(b.prop, x, y)) ? 'mass' : isWaterSkin(skinAt(b.ground, x, y)) ? 'water' : 'land'
  const free = (x, y) => inside(x, y) && b.walkG[y + MARGIN][x + MARGIN] && b.prop[y + MARGIN][x + MARGIN] === -1

  const dryGround = (x, y) => {
    const bm = biome(x, y)
    return bm === 'sea' || bm === 'desert' ? SAND[0] : bm === 'marsh' ? dirtSkin(x, y) : grassSkin(x, y)
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
  const open = (cx, cy, r = 0) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) openCell(cx + dx, cy + dy)
  }
  // One path cell: a pier over water, a pass through rock, a trail on land.
  const pathCell = (x, y, pier) => {
    if (!inside(x, y)) return
    const bx = x + MARGIN, by = y + MARGIN
    const g = b.palette[b.ground[by][bx]]
    if (isWaterSkin(g)) {
      b.prop[by][bx] = b.skin(pier)
      b.walkG[by][bx] = true
      return
    }
    const was = clearCell(x, y)
    b.ground[by][bx] = b.skin(isMassSkin(was) && !isFloor(g) ? floorSkin(x, y) : pathGround(g, x, y))
    b.walkG[by][bx] = true
  }
  // A gently wandering path between two interior cells.
  const path = (x0, y0, x1, y1, width = 2) => {
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 1) { for (let a = 0; a < width; a++) for (let c = 0; c < width; c++) pathCell(x0 + a, y0 + c, PIER.h); return }
    const nx = -dy / len, ny = dx / len
    const s1 = (hash(dealSeed, x0 * 131 + x1, y0 * 131 + y1, 60) - 0.5) * 2
    const s2 = (hash(dealSeed, x0 * 131 + x1, y0 * 131 + y1, 61) - 0.5) * 2
    const amp = Math.min(7, len * 0.2)
    const pier = Math.abs(dx) >= Math.abs(dy) ? PIER.h : PIER.v
    const n = Math.ceil(len * 2)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const off = amp * (s1 * Math.sin(Math.PI * t) + 0.5 * s2 * Math.sin(2 * Math.PI * t))
      const px = Math.round(x0 + dx * t + nx * off), py = Math.round(y0 + dy * t + ny * off)
      for (let a = 0; a < width; a++) for (let c = 0; c < width; c++) pathCell(px + a, py + c, pier)
    }
  }

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

  // The art passes, run once after features: sand frays into grass, the
  // mountain masses take their faces and the floor its edge, water its rim.
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
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
  }

  return {
    seed, wx, wy, deal, b,
    biome: (x, y) => biome(x, y),
    kind, free, inside, open, path, gates, gateInner, finish,
    // for features: the prop and ground art of a local cell
    propAt: (x, y) => skinAt(b.prop, x, y),
    groundAt: (x, y) => skinAt(b.ground, x, y),
    // stamp helpers in local coordinates, for interior cells only
    setGround: (x, y, skin) => { if (inside(x, y)) b.ground[y + MARGIN][x + MARGIN] = b.skin(skin) },
    setProp: (x, y, skin, { walkable = false } = {}) => {
      if (!inside(x, y)) return
      b.prop[y + MARGIN][x + MARGIN] = b.skin(skin)
      b.walkG[y + MARGIN][x + MARGIN] = walkable
    },
    walkable: (x, y) => !!b.walkG[y + MARGIN]?.[x + MARGIN],
    rnd, dryGround, grassSkin,
  }
}
