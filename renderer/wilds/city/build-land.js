// The land round Kalevanlinna: the Wilds' own terrain under the four city
// pieces, kept exactly as makeTerrain lays it in the outer FRAME (so the
// neighbours, which lay that band from the world's noise, agree), blended
// over the next few tiles into tamed outskirts: thinning woods, grass and
// beaches, the bay; then the ring road outside the wall with a spur to every
// edge crossing, the stone moles along the harbour walls, and the farms.
// The art passes of terrain.js's finish() run once more over the whole city
// grid, and the frame is put back as the terrain finished it.
import { makeTerrain } from '../terrain.js'
import { PIECE, FRAME, MARGIN } from '../layout.js'
import { CITY_KEYS, inBay, fromCity } from './geometry.js'
import { PLAN, insideWalls, wallCells } from './plan.js'
import { hash, hashInt, noise2, mulberry32 } from '../rand.js'
import { isWaterSkin, isPierSkin, isSandySkin, isMuddySkin, WATER_SKINS, TREE_PAIRS } from '../../terrain/lib.js'
import { MTN, stampMountainRim, stampGroundEdge, isMassSkin, isMountainGround, LAT_PX, LAT_PY } from '../../terrain/mountain.js'
import { stampSandEdge } from '../../terrain/beach.js'
import { skinBridges } from '../bridge-art.js'
import { slopeShores } from '../shore-art.js'
import { HARBOUR } from './kit.js'
import { N, M, TAG, lay, house } from './stamps.js'

const BLEND = 5    // tiles inside the frame where the terrain is kept as it is
const DIRT = ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2', 'ow_dirt_3']
const SAND_PATH = ['ow_path_sand_0', 'ow_path_sand_1', 'ow_path_sand_2', 'ow_path_sand_3']
const PIER = { h: 'ow_pier_log', v: 'ow_pier_log_v' }
const TOP_OF = new Map(TREE_PAIRS.map(([top, trunk]) => [trunk, top]))
const TRUNK_OF = new Map(TREE_PAIRS.map(([top, trunk]) => [top, trunk]))
const GROWS = ['ow_tree_', 'ow_bush_', 'ow_deadtree_', 'ow_shrub_', 'ow_rock_', 'ow_cactus']

export const edgeDepth = (x, y) => Math.min(x, y, N - 1 - x, N - 1 - y)
// Inside the wall or on it: ground the city lays every cell of itself.
const walled = (x, y) => x >= 0 && y >= 0 && x < N && y < N && (insideWalls(x, y) || wallCells().has(y * N + x))
// The city's own cells: inside the frame.
export const own = (x, y) => x >= 0 && y >= 0 && x < N && y < N && edgeDepth(x, y) >= FRAME

// ---- the terrain under the city -------------------------------------------------
// Each city piece's terrain as makeTerrain lays it (deal 0): before its art
// passes (what the city builds on) and after (what the frame keeps).
export function terrainUnder(seed) {
  const T = {}
  for (const key of CITY_KEYS) {
    const [wx, wy] = key.split(',').map(Number)
    // (the inside of the wall is the city's to lay: the terrain need not work it out)
    const t = makeTerrain(seed, wx, wy, 0, { blank: (x, y) => walled(x + wx * PIECE, y + (wy - 2) * PIECE) })
    const b = t.b
    const raw = { g: b.ground.map(r => r.slice()), p: b.prop.map(r => r.slice()), w: b.walkG.map(r => r.slice()) }
    t.finish()
    T[key] = { wx, wy, t, raw }
  }
  // the piece's terrain a city tile (or a margin tile beyond the city) is taken from, and the tile there
  const of = (cx, cy) => {
    const wx = cx < PIECE ? 0 : 1, wy = cy < PIECE ? 2 : 3
    return { T: T[`${wx},${wy}`], lx: cx - wx * PIECE, ly: cy - (wy - 2) * PIECE }
  }
  return { seed, T, of }
}

// Lay the raw terrain over the whole grid, margin included: each piece's
// quarter, and the margin beyond the city from the piece beside it.
export function layTerrain(G, land) {
  const b = G.b
  for (const T of Object.values(land.T)) {
    const map = T.t.b.palette.map(n => b.skin(n))
    const ox = T.wx * PIECE, oy = (T.wy - 2) * PIECE
    const x0 = T.wx === 0 ? -M : PIECE, x1 = T.wx === 0 ? PIECE - 1 : N + M - 1
    const y0 = T.wy === 2 ? -M : PIECE, y1 = T.wy === 2 ? PIECE - 1 : N + M - 1
    for (let y = y0; y <= y1; y++) {
      const rg = T.raw.g[y - oy + MARGIN], rp = T.raw.p[y - oy + MARGIN], rw = T.raw.w[y - oy + MARGIN]
      const g = b.ground[y + M], p = b.prop[y + M], w = b.walkG[y + M]
      for (let x = x0; x <= x1; x++) {
        const bx = x - ox + MARGIN, q = rp[bx]
        g[x + M] = map[rg[bx]]; p[x + M] = q < 0 ? -1 : map[q]; w[x + M] = rw[bx]
      }
    }
  }
}

// Take whatever stands on a cell away; a two-tile tree goes whole. A tree
// whose other half is in the frame stays (half a tree is the broken look).
export function clearWhole(G, x, y) {
  const p = G.prop(x, y)
  if (!p) return true
  if (TOP_OF.has(p) && G.prop(x, y - 1) === TOP_OF.get(p)) { if (!own(x, y - 1)) return false; G.setProp(x, y - 1, null, true) }
  if (TRUNK_OF.has(p) && G.prop(x, y + 1) === TRUNK_OF.get(p)) { if (!own(x, y + 1)) return false; G.setProp(x, y + 1, null, true) }
  G.setProp(x, y, null, true)
  return true
}
const isGrowth = n => !!n && GROWS.some(p => n.startsWith(p))

// ---- the outskirts ---------------------------------------------------------------
// Inside the blend the land is the terrain's. Beyond it the city tames it:
// lakes and rock give way to grass a few tiles further in (where exactly
// wanders with the world's noise), woods thin out towards the wall, and the
// bay stays the bay.
export function layOutskirts(G, land) {
  const { seed } = land
  const wild = (x, y) => {
    const { X, Y } = fromCity(x, y)
    return edgeDepth(x, y) < FRAME + BLEND + Math.floor(noise2(seed + 4141, X, Y, { freq: 1 / 9, octaves: 2 }) * 4)
  }
  // (inside the wall's box the city lays every cell itself)
  const tamed = (x, y) => edgeDepth(x, y) >= FRAME + BLEND && !walled(x, y)
  const sea = new Uint8Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!tamed(x, y)) continue
    const { X, Y } = fromCity(x, y)
    const { T, lx, ly } = land.of(x, y)
    const g = G.ground(x, y), p = G.prop(x, y)
    if (inBay(X, Y)) { if (!isWaterSkin(g)) { G.setGround(x, y, WATER_SKINS[(X + Y) & 1]); G.setProp(x, y, null, false) } continue }
    if ((isWaterSkin(g) || isMassSkin(p)) && !wild(x, y)) {
      clearWhole(G, x, y)
      G.setGround(x, y, T.t.biome(lx, ly) === 'desert' ? 'ow_sand_0' : T.t.grassSkin(lx, ly))
      G.setProp(x, y, null, true)
      sea[y * N + x] = 1
    } else if (isMountainGround(g) && !wild(x, y)) G.setGround(x, y, T.t.grassSkin(lx, ly))
  }
  // a beach only where there is still water beside it
  const wet = new Uint8Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!isWaterSkin(G.ground(x, y))) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < N && ny < N) wet[ny * N + nx] = 1
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!tamed(x, y)) continue
    const g = G.ground(x, y), sand = g.startsWith('ow_sand')
    if (!sand && !sea[y * N + x]) continue
    const { T, lx, ly } = land.of(x, y)
    const b = T.t.biome(lx, ly)
    if (sand && b !== 'desert' && !wet[y * N + x]) G.setGround(x, y, T.t.grassSkin(lx, ly))
    else if (sea[y * N + x] && b === 'sea' && wet[y * N + x]) G.setGround(x, y, 'ow_sand_0')
  }
  // the woods thin out towards the city (a two-tile tree is judged by its trunk)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!tamed(x, y)) continue
    const p = G.prop(x, y)
    if (!isGrowth(p) || (TRUNK_OF.has(p) && G.prop(x, y + 1) === TRUNK_OF.get(p))) continue
    const { X, Y } = fromCity(x, y)
    const keep = Math.max(0.15, 1 - (edgeDepth(x, y) - FRAME - BLEND) / 5)
    if (hash(seed, X, Y, 4242) >= keep) clearWhole(G, x, y)
  }
}

// Nothing grows against the wall, on the roads or round the farm buildings.
export function clearRound(G, r = 2) {
  const near = (x, y) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const t = G.tagAt(x + dx, y + dy)
      if (t === TAG.CITY || t === TAG.ROAD) return true
    }
    return false
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (own(x, y) && !walled(x, y) && G.tagAt(x, y) === TAG.LAND && isGrowth(G.prop(x, y)) && near(x, y)) clearWhole(G, x, y)
}

// ---- roads -----------------------------------------------------------------------
// One road cell out in the country: a trail on land, a pier over water, a
// pass through rock. Never in the frame.
function roadCell(G, x, y, along) {
  if (!own(x, y) || G.tagAt(x, y) === TAG.CITY) return
  const g = G.ground(x, y), p = G.prop(x, y)
  if (isWaterSkin(g)) { if (p && !isPierSkin(p)) G.setProp(x, y, null); G.setProp(x, y, PIER[along], true) }
  else {
    clearWhole(G, x, y)
    if (isMassSkin(G.prop(x, y))) G.setProp(x, y, null, true)
    const h = hashInt(0, x, y, 42)
    G.setGround(x, y, g.startsWith('ow_grass') || g.startsWith('ow_dirt') ? DIRT[h % 4]
      : g.startsWith('ow_sand') || g === 'ow_hardpan_0' ? SAND_PATH[h % 4]
      : isMountainGround(g) ? g : DIRT[h % 4])
    G.setProp(x, y, null, true)
  }
  G.setTag(x, y, TAG.ROAD)
}
const rect = (G, x0, y0, x1, y1, fn) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y) }
const roadRect = (G, x0, y0, x1, y1) => rect(G, x0, y0, x1, y1, (x, y) => roadCell(G, x, y, x1 - x0 >= y1 - y0 ? 'h' : 'v'))
const moleCell = (G, x, y) => lay(G, x, y, null, { walk: true, ground: HARBOUR.mole[(x + y) & 1] })

// The ring road: round the north of the city outside the wall, down both
// sides to the farmland, along the south wall to the moles, and along the
// shore to them; a spur from every edge crossing; the stone moles along the
// outside of the harbour walls, up to the water gates into the harbour.
export const RING = {
  north: [15, 15, 144, 16], west: [15, 15, 16, 144], east: [143, 15, 144, 144],
  southW: [15, 124, 58, 125], southE: [102, 124, 144, 125], shoreW: [15, 143, 58, 144], shoreE: [102, 143, 144, 144],
  moleW: [59, 124, 60, 144], moleE: [100, 124, 101, 144],
}
export function layRoads(G, land, rec) {
  for (const k of ['north', 'west', 'east', 'southW', 'southE', 'shoreW', 'shoreE']) roadRect(G, ...RING[k])
  // the approaches to the three land gates
  roadRect(G, 79, 17, 81, 19); roadRect(G, 17, 67, 19, 69); roadRect(G, 141, 74, 142, 76)
  // a spur from every crossing of the city's outer edges to the ring
  for (const { wx, wy, t } of Object.values(land.T)) {
    const ox = wx * PIECE, oy = (wy - 2) * PIECE
    for (const side of ['N', 'E', 'S', 'W']) {
      if ((side === 'N' && wy !== 2) || (side === 'S' && wy !== 3) || (side === 'W' && wx !== 0) || (side === 'E' && wx !== 1)) continue
      const g = t.gateInner(side), x = g.x + ox, y = g.y + oy
      if (side === 'N') roadRect(G, x, y, x + 1, RING.north[1] - 1)
      if (side === 'S') roadRect(G, x, RING.shoreW[3] + 1, x + 1, y)
      if (side === 'W') roadRect(G, x, y, RING.west[0] - 1, y + 1)
      if (side === 'E') roadRect(G, RING.east[2] + 1, y, x, y + 1)
    }
  }
  // the moles: stone along the outside of the harbour walls, out to the shore road
  for (const k of ['moleW', 'moleE']) rect(G, ...RING[k], (x, y) => moleCell(G, x, y))
  // and up to the water gates (plan.js) into the harbour
  for (const g of PLAN.waterGates) for (let d = -1; d <= 1; d++) moleCell(G, g.dir === 'W' ? g.x - 1 : g.x + 1, g.y + d)
  // where a mole ends in the water, its face
  for (const k of ['moleW', 'moleE']) {
    const [x0, , x1, y1] = RING[k]
    for (let x = x0; x <= x1; x++) if (isWaterSkin(G.ground(x, y1 + 1)) && G.tagAt(x, y1 + 1) !== TAG.ROAD) lay(G, x, y1 + 1, HARBOUR.face)
  }
  // signposts by the gates
  const sign = (x, y, lines) => { lay(G, x, y, 'ow_sign'); rec.signs.push({ x, y, title: 'Kalevanlinna', lines }) }
  sign(77, 17, ['North gate.', 'The road north goes to Koivula.'])
  sign(18, 65, ['West gate.', 'The church is just inside.'])
  sign(142, 72, ['East gate.', 'The crafts quarter and the mill are inside.'])
  sign(58, 130, ['Harbour gate.', 'Mind the nets.'])
  sign(102, 130, ['Harbour gate.', 'Mind the nets.'])
}
// ---- farms -----------------------------------------------------------------------
// Fields, an orchard, pastures and cottages in the farmland between the
// south wall and the shore road, either side of the harbour.
const FARMS = [
  { field: [19, 128, 29, 134], orchard: [32, 128, 44, 138], pasture: [46, 127, 54, 133], cottages: [[20, 3, 'red'], [25, 4, 'blue'], [39, 3, 'blue']] },
  { field: [118, 128, 129, 134], orchard: [132, 128, 141, 138], pasture: [105, 127, 113, 133], cottages: [[118, 3, 'blue'], [123, 4, 'red'], [134, 3, 'red']] },
]
const FENCE = { tl: 'ow_fence_l', t: 'ow_fence_m', tr: 'ow_fence_r', side: ['ow_fence_side_l', 'ow_fence_side_r'], bl: 'ow_fence_bl', br: 'ow_fence_br', endL: 'ow_fence_end_l', endR: 'ow_fence_end_r' }
const farmCell = (G, x, y, prop, walk, ground = null) => {
  if (G.tagAt(x, y) !== TAG.LAND || isWaterSkin(G.ground(x, y))) return false
  clearWhole(G, x, y)
  if (ground) G.setGround(x, y, ground)
  G.setProp(x, y, prop, walk); G.setDeco(x, y, null); G.setTag(x, y, TAG.FARM)
  return true
}
function fence(G, x0, y0, x1, y1, gateX) {
  for (let x = x0; x <= x1; x++) {
    if (x === gateX || x === gateX + 1) { farmCell(G, x, y0, null, true); continue }
    const n = x === x0 ? FENCE.tl : x === x1 ? FENCE.tr : x === gateX + 2 ? FENCE.endL : x === gateX - 1 ? FENCE.endR : FENCE.t
    farmCell(G, x, y0, n, false)
    farmCell(G, x, y1, x === x0 ? FENCE.bl : x === x1 ? FENCE.br : FENCE.t, false)
  }
  for (let y = y0 + 1; y < y1; y++) { farmCell(G, x0, y, FENCE.side[0], false); farmCell(G, x1, y, FENCE.side[1], false) }
}
export function layFarms(G, land, rec) {
  const rng = mulberry32(hashInt(land.seed, 0, 2, 9201))
  let n = 0
  const animal = (species, x0, y0, x1, y1) => {
    for (let tries = 0; tries < 40; tries++) {
      const x = x0 + Math.floor(rng() * (x1 - x0 + 1)), y = y0 + Math.floor(rng() * (y1 - y0 + 1))
      if (!G.walkable(x, y) || G.prop(x, y) || isWaterSkin(G.ground(x, y)) || rec.spawns.some(s => s.x === x && s.y === y)) continue
      rec.spawns.push({ kind: 'npc', species, id: `npc:city:${n++}`, x, y })
      return
    }
  }
  for (const f of FARMS) {
    const [fx0, fy0, fx1, fy1] = f.field
    fence(G, fx0, fy0, fx1, fy1, (fx0 + fx1) >> 1)
    for (let y = fy0 + 1; y < fy1; y++) for (let x = fx0 + 1; x < fx1; x++) {
      const v = y === fy0 + 1 ? 't' : y === fy1 - 1 ? 'b' : '', h = x === fx0 + 1 ? 'l' : x === fx1 - 1 ? 'r' : ''
      farmCell(G, x, y, (y - fy0) % 2 ? 'ow_deco_crop_0' : 'ow_deco_crop_1', true, `ow_patch_${v + h || 'm'}`)
    }
    const [ox0, oy0, ox1, oy1] = f.orchard
    for (let y = oy0 + 1; y < oy1; y += 3) for (let x = ox0 + 1; x < ox1; x += 2) if (rng() < 0.9) farmCell(G, x, y, 'ow_tree_apple', false)
    const [px0, py0, px1, py1] = f.pasture
    fence(G, px0, py0, px1, py1, (px0 + px1) >> 1)
    for (let i = 0; i < 3; i++) animal('sheep', px0 + 1, py0 + 1, px1 - 1, py1 - 1)
    animal('goat', px0 + 1, py0 + 1, px1 - 1, py1 - 1)
    for (const [cx, w, roof] of f.cottages) {
      const yFace = RING.shoreW[1] - 2, x1 = cx + w - 1
      if (!rect2(G, cx - 1, yFace - 3, x1 + 1, yFace + 1).every(([x, y]) => G.tagAt(x, y) === TAG.LAND && !isWaterSkin(G.ground(x, y)))) continue
      for (const [x, y] of rect2(G, cx - 1, yFace - 2, x1 + 1, yFace + 1)) clearWhole(G, x, y)
      const door = { x: cx + 1, y: yFace }
      house(G, rec, { x0: cx, x1, top: yFace - 2, storeys: 1, view: 'front', wall: 'wood', roof, door, chim: cx + 1 + (w > 3 && rng() < 0.5 ? 1 : 0),
        info: { kind: 'home', look: { w, storeys: 1, wall: 'wood' } } })
      farmCell(G, cx - 1, yFace, 'ow_prop_woodpile', false)
      for (let i = 0; i < 2; i++) animal('chicken', x1 + 1, yFace - 1, x1 + 2, yFace + 1)
    }
  }
}
const rect2 = (G, x0, y0, x1, y1) => { const out = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]); return out }

// ---- the art passes, and the frame put back ----------------------------------------
const RIM_KEYS = { N: '10', S: '12', W: '01', E: '21', NW: '00', NE: '20', SW: '02', SE: '22' }
const rimSet = prefix => Object.fromEntries(Object.entries(RIM_KEYS).map(([k, v]) => [k, `${prefix}_${v}`]))
const RIM = rimSet('ow_pond'), SHORE_RIM = rimSet('ow_shore'), MUD_RIM = rimSet('ow_mud')
const mod = (n, m) => ((n % m) + m) % m

// shoreline() of terrain/lib.js, but the city's stone counts as water: a
// mole or a quay meets the sea with its own kerb, not a bank of grass.
function cityShoreline(G) {
  const b = G.b
  const palWet = b.palette.map(n => isWaterSkin(n) || isPierSkin(n)), palOpen = b.palette.map(n => n.startsWith('ow_water'))
  const wet = (x, y) => !G.in(x, y) || G.tagAt(x, y) === TAG.CITY || palWet[b.ground[y + M][x + M]]
  const repaint = []
  for (let y = -M; y < N + M; y++) for (let x = -M; x < N + M; x++) {
    if (!palOpen[b.ground[y + M][x + M]] || G.tagAt(x, y) === TAG.CITY) continue
    const ns = !wet(x, y - 1) ? 'N' : !wet(x, y + 1) ? 'S' : ''
    const ew = !wet(x - 1, y) ? 'W' : !wet(x + 1, y) ? 'E' : ''
    if (!ns && !ew) continue
    const land = [ns === 'N' ? [x, y - 1] : ns === 'S' ? [x, y + 1] : null, ew === 'W' ? [x - 1, y] : ew === 'E' ? [x + 1, y] : null].filter(Boolean).map(([lx, ly]) => G.ground(lx, ly))
    const set = land.every(isSandySkin) ? SHORE_RIM : land.every(isMuddySkin) ? MUD_RIM : RIM
    repaint.push([x, y, set[ns + ew]])
  }
  for (const [x, y, n] of repaint) G.setGround(x, y, n)
  // the beach's sand-coloured bank wherever the land beside it is sand
  const beachy = (x, y) => { const n = G.ground(x, y); return isSandySkin(n) || n === 'ow_hardpan_0' || SAND_PATH.includes(n) }
  const bank = b.palette.map(n => /^ow_pond_([012])([012])$/.exec(n))
  for (let y = -M; y < N + M; y++) for (let x = -M; x < N + M; x++) {
    const m = bank[b.ground[y + M][x + M]]
    if (!m || G.tagAt(x, y) === TAG.CITY) continue
    const dx = m[1] - 1, dy = m[2] - 1
    if ((dx || dy) && (!dx || beachy(x + dx, y)) && (!dy || beachy(x, y + dy))) G.setGround(x, y, `ow_shore_${m[1]}${m[2]}`)
  }
}

export function finishLand(G, land) {
  const b = G.b
  const X0 = -M, Y0 = 2 * PIECE - M   // the world tile of builder cell (0, 0)
  // only the passes something on the city's own land needs (the frame is put back after)
  const used = new Uint8Array(b.palette.length)
  for (let y = FRAME; y < N - FRAME; y++) {
    const g = b.ground[y + M], p = b.prop[y + M]
    for (let x = FRAME; x < N - FRAME; x++) { used[g[x + M]] = 1; if (p[x + M] >= 0) used[p[x + M]] = 1 }
  }
  const has = test => b.palette.some((n, i) => used[i] && test(n))
  if (has(n => n.startsWith('ow_sand'))) stampSandEdge(b)
  const rock = has(isMassSkin) || has(isMountainGround)
  if (rock) {
    stampMountainRim(b, mulberry32(hashInt(land.seed, 0, 2, 70)))
    // the cone lattice and the ridge pieces by world tile, as terrain.js has them
    const lat = b.palette.map(n => /^ow_mtn_lat_(\d+)_\d+$/.exec(n)?.[1] ?? null)
    const ridge = b.palette.map(n => /^ow_mtn_ridge_(dr|dl)_\d+$/.exec(n)?.[1] ?? null)
    for (let by = 0; by < G.S; by++) for (let bx = 0; bx < G.S; bx++) {
      const p = b.prop[by][bx]
      if (p < 0) continue
      if (lat[p]) b.prop[by][bx] = b.skin(`ow_mtn_lat_${lat[p]}_${mod(X0 + bx, LAT_PX) + LAT_PX * mod(Y0 + by, LAT_PY)}`)
      else if (ridge[p]) { const set = MTN.ridge[ridge[p]]; b.prop[by][bx] = b.skin(set[hashInt(land.seed, X0 + bx, Y0 + by, 45) % set.length]) }
    }
  }
  if (rock) stampGroundEdge(b)
  cityShoreline(G)
  // the slanting of shores is for natural coasts: the city's stone and the water against it keep their art
  const before = b.ground.map(r => r.slice())
  slopeShores(b, {
    X0, Y0,
    frame: { x0: M, y0: M, w: N, h: N, band: MARGIN, look: FRAME, far: (bx, by) => { const { T, lx, ly } = land.of(bx - M, by - M); return T.t.rawKind(lx, ly) === 'water' } },
  })
  for (let y = -M; y < N + M; y++) for (let x = -M; x < N + M; x++) {
    if (b.ground[y + M][x + M] === before[y + M][x + M]) continue
    const keep = G.tagAt(x, y) === TAG.CITY || (isWaterSkin(G.ground(x, y)) && (G.tagAt(x + 1, y) === TAG.CITY || G.tagAt(x - 1, y) === TAG.CITY || G.tagAt(x, y + 1) === TAG.CITY || G.tagAt(x, y - 1) === TAG.CITY))
    if (keep) b.ground[y + M][x + M] = before[y + M][x + M]
  }
  skinBridges(b, { X0, Y0, slant: (bx, by) => own(bx - M, by - M) })
  // the frame, exactly as the terrain finished it
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (edgeDepth(x, y) >= FRAME) continue
    const { T, lx, ly } = land.of(x, y)
    const tb = T.t.b, bx = lx + MARGIN, by = ly + MARGIN
    G.setGround(x, y, tb.palette[tb.ground[by][bx]])
    G.setProp(x, y, tb.palette[tb.prop[by][bx]] ?? null, tb.walkG[by][bx])
    G.setDeco(x, y, null); G.setTag(x, y, TAG.LAND)
  }
}
