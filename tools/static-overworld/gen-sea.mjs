// Three seaside overworld attempts:
//   1 suomenlinna — derived from an aerial photo of the Helsinki sea fortress
//   2 fishing village — noise coastline, piers, lighthouse islet
//   3 archipelago — island chain linked by causeways, ruined monastery
import { MapBuilder, mulberry32, makeNoise, validate, plantTree, pruneBrokenTrees } from './lib.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out/maps')
fs.mkdirSync(OUT, { recursive: true })

const WATER = ['ow_water_0', 'ow_water_1', 'ow_water_2', 'ow_water_3']
const GRASS = ['ow_grass_0', 'ow_grass_1', 'ow_grass_2']
const PINES = { tall: [['ow_tree_pine_top', 'ow_tree_pine_trunk']], small: ['ow_tree_small', 'ow_tree_small', 'ow_bush_round'], tallChance: 0.5 }
const ROCKS_G = ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']
const SKERRY = ['ow_rock_water_gray_0', 'ow_rock_water_gray_1', 'ow_rock_water_gray_2']
const pick = (rng, a) => a[Math.floor(rng() * a.length)]
const isOpen = b => (x, y) => b.walkable(x, y) && b.prop[y][x] === -1
// pier logs belong on water; a bridge crossing a tree pocket just fells the trees
const pierOverWater = b => (x, y) => b.palette[b.ground[y][x]]?.startsWith('ow_water') ? 'ow_pier_log' : null

function water(b, rng, x, y) {
  b.g(x, y, pick(rng, WATER))
  b.block(x, y)
}

// ---------- attempt 1: Suomenlinna ----------
function suomenlinna() {
  const rng = mulberry32(707)
  const grid = JSON.parse(fs.readFileSync(path.join(HERE, 'out/suomenlinna-grid.json'), 'utf8'))
  const gh = grid.length, gw = grid[0].length
  const b = new MapBuilder('sea-1-suomenlinna', 'seaside', 'derived from an aerial photo of the real fortress islands', gw, gh)
  b.notes = 'Tile grid classified from a Wikimedia aerial of Suomenlinna. Causeways stand in for the real bridges/ferries.'
  const classify = ([r, g, bl]) => {
    if (bl > g && bl > r * 1.12) return 'water'
    const bright = (r + g + bl) / 3
    if (Math.abs(r - g) < 18 && Math.abs(g - bl) < 22 && bright > 150) return 'stone'
    if (r > g * 1.22 && r > 120) return 'brick'
    if (bright > 160 && bl < g) return 'path'
    return bright < 92 ? 'trees' : 'grass'
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    switch (classify(grid[y][x])) {
      case 'water': water(b, rng, x, y); break
      case 'stone': b.g(x, y, 'ow_grass_0'); b.p(x, y, 'ow_house_wall_stone'); break
      case 'brick': b.g(x, y, 'ow_grass_0'); b.p(x, y, 'ow_roof_red_m'); break
      case 'path': b.g(x, y, pick(rng, ['ow_dirt_0', 'ow_dirt_1'])); break
      case 'trees': b.g(x, y, 'ow_grass_0'); plantTree(b, rng, x, y, PINES); break
      default: b.g(x, y, rng() < 0.94 ? 'ow_grass_0' : pick(rng, GRASS))
    }
  }
  // rocky shoreline: land cells touching water sometimes get shore rocks
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    if (!b.walkable(x, y) || b.prop[y][x] !== -1) continue
    const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => b.palette[b.ground[y + dy]?.[x + dx]]?.startsWith('ow_water'))
    if (nearWater && rng() < 0.18) b.p(x, y, pick(rng, ROCKS_G))
  }
  // skerries and boats in open water
  for (const s of b.scatter(rng, 26, 6, (x, y) => b.palette[b.ground[y][x]]?.startsWith('ow_water'))) {
    b.prop[s.y][s.x] = b.skin(rng() < 0.75 ? pick(rng, SKERRY) : 'ow_boat')
  }
  // Join the islands FIRST (shortest crossings become the bridges), then pin
  // every POI to the joined main component — placing POIs before healing let
  // them land on pockets the healer then sealed, and ensureReachable answered
  // with pier lines carved across half the map.
  b.healFragmentation({ minKeep: 40, fill: (x, y) => { if (b.prop[y][x] === -1) b.p(x, y, pick(rng, ROCKS_G)) }, groundSkin: pierOverWater(b) })
  const main = b.largestComponent()
  const snap = (x, y) => {
    for (let r = 0; r < Math.max(b.w, b.h); r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (main[y + dy]?.[x + dx] && b.prop[y + dy][x + dx] === -1) return { x: x + dx, y: y + dy }
      }
    return { x, y }
  }
  // POIs at real landmarks (approximate photo positions)
  const church = snap(96, 12)
  b.poi('landmark', church.x, church.y, 'church island')
  const dock = snap(58, 30)
  b.poi('village', dock.x, dock.y, 'dry dock')
  const gate = snap(18, 48)
  b.p(gate.x, gate.y, 'ow_ruin_gate')
  b.poi('ruin', gate.x, gate.y, "King's Gate walls")
  for (const [i, c] of [snap(10, 44), snap(82, 34)].entries()) {
    b.p(c.x, c.y, 'ow_cave_arch_0'); b.p(c.x + 1, c.y, 'ow_cave_arch_1')
    b.poi('dungeon_entrance', c.x, c.y, `casemate ${i + 1}`)
  }
  for (const c of b.scatter(rng, 3, 25, (x, y) => main[y][x] && b.prop[y][x] === -1)) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = snap(58, 32)
  b.ensureReachable(pierOverWater(b))
  pruneBrokenTrees(b)
  return b
}

// ---------- attempt 2: fishing village ----------
function fishingVillage() {
  const rng = mulberry32(808)
  const noise = makeNoise(rng)
  const b = new MapBuilder('sea-2-fishing-village', 'seaside', 'noise coastline, piers, lighthouse islet', 120, 80)
  b.notes = 'Mainland west, open sea east. Beach strip, two piers with boats, lighthouse islet, sea cave.'
  // coastline: x threshold wobbles with y
  const coastX = y => 78 + Math.round(noise(0, y, { freq: 0.06, octaves: 3 }) * 24 - 12)
  for (let y = 0; y < b.h; y++) {
    const cx = coastX(y)
    for (let x = 0; x < b.w; x++) {
      if (x > cx) water(b, rng, x, y)
      else if (x > cx - 4) b.g(x, y, 'ow_sand_0')          // beach
      else b.g(x, y, rng() < 0.93 ? 'ow_grass_0' : pick(rng, GRASS))
    }
  }
  // woods inland
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y) || x > coastX(y) - 6) continue
    const d = noise(x, y, { freq: 0.08, octaves: 3 })
    if (d > 0.45 && rng() < (d - 0.45) * 4) plantTree(b, rng, x, y, PINES)
  }
  // village on the shore
  const vy = 38, vx = coastX(vy) - 8
  for (let y = vy - 8; y <= vy + 8; y++) for (let x = vx - 8; x <= vx + 8; x++) if (b.in(x, y)) b.clearProp(x, y)
  const house = (x, y, kind) => {
    const roof = kind === 'red' ? ['ow_roof_red_l', 'ow_roof_red_r'] : ['ow_roof_gray_l', 'ow_roof_gray_r']
    b.p(x, y, roof[0]); b.p(x + 1, y, roof[1])
    b.p(x, y + 1, 'ow_house_wall'); b.p(x + 1, y + 1, 'ow_house_door')
  }
  house(vx - 5, vy - 6, 'red'); house(vx + 1, vy - 5, 'gray'); house(vx - 6, vy, 'gray'); house(vx, vy + 3, 'red')
  b.p(vx - 2, vy - 2, 'ow_well_top'); b.p(vx - 2, vy - 1, 'ow_well')
  b.poi('village', vx, vy - 2, 'Seagrave')
  // two piers with boats
  for (const py of [vy - 3, vy + 6]) {
    const start = coastX(py)
    for (let x = start - 2; x <= start + 5; x++) {
      b.clearProp(x, py); b.g(x, py, x === start + 5 ? 'ow_pier_post' : 'ow_pier_log'); b.unblock(x, py)
    }
    b.prop[py + 1]?.[start + 4] === -1 && b.p(start + 4, py + 1, 'ow_boat')
  }
  b.poi('landmark', coastX(vy - 3) + 4, vy - 3, 'north pier')
  // lighthouse islet
  const li = { x: 106, y: 16 }
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++)
    if (x * x + y * y <= 5) { b.g(li.x + x, li.y + y, 'ow_stone_ground_0'); b.unblock(li.x + x, li.y + y); b.clearProp(li.x + x, li.y + y) }
  b.p(li.x, li.y - 1, 'ow_roof_gray_m')
  b.p(li.x, li.y, 'ow_house_wall_stone')
  b.poi('landmark', li.x, li.y, 'lighthouse')
  // sea cave in a rocky headland
  const cave = { x: coastX(64) - 1, y: 64 }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 2; dx++) if (rng() < 0.9) b.p(cave.x + dx, cave.y + dy, pick(rng, ROCKS_G))
  b.clearProp(cave.x, cave.y); b.clearProp(cave.x + 1, cave.y)
  b.p(cave.x, cave.y, 'ow_cave_arch_0'); b.p(cave.x + 1, cave.y, 'ow_cave_arch_1')
  b.clearProp(cave.x, cave.y + 1); b.clearProp(cave.x + 1, cave.y + 1)
  b.poi('dungeon_entrance', cave.x, cave.y, 'sea cave')
  // skerries + boats offshore
  for (const s of b.scatter(rng, 22, 5, (x, y) => b.palette[b.ground[y][x]]?.startsWith('ow_water') && x > coastX(y) + 3)) {
    b.prop[s.y][s.x] = b.skin(rng() < 0.8 ? pick(rng, SKERRY) : 'ow_boat')
  }
  // dunes: sand ridge with shrubs on the beach
  for (let y = 2; y < b.h - 2; y++) if (rng() < 0.3) b.p(coastX(y) - 3, y, 'ow_shrub_1')
  for (const c of b.scatter(rng, 4, 26, (x, y) => isOpen(b)(x, y) && x < coastX(y) - 5)) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: vx, y: vy + 1 }
  b.healFragmentation({ minKeep: 30, fill: (x, y) => { if (b.prop[y][x] === -1) b.p(x, y, pick(rng, ROCKS_G)) }, groundSkin: pierOverWater(b) })
  b.ensureReachable(pierOverWater(b))
  pruneBrokenTrees(b)
  return b
}

// ---------- attempt 3: archipelago ----------
function archipelago() {
  const rng = mulberry32(909)
  const noise = makeNoise(rng)
  const b = new MapBuilder('sea-3-archipelago', 'seaside', 'island chain linked by causeways', 120, 80)
  b.notes = 'Blob-noise islands strung on log causeways; monastery ruin, fishing huts, two grottos.'
  // islands: thresholded blob noise, sea everywhere else
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const n = noise(x, y, { freq: 0.055, octaves: 3 })
    const edge = Math.min(x, y, b.w - 1 - x, b.h - 1 - y) / 12   // fade to sea at borders
    if (n * Math.min(1, edge) > 0.56) {
      b.g(x, y, rng() < 0.92 ? 'ow_grass_0' : pick(rng, GRASS))
    } else water(b, rng, x, y)
  }
  // trees + shore rocks
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y)) continue
    const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => b.palette[b.ground[y + dy]?.[x + dx]]?.startsWith('ow_water'))
    if (nearWater) { if (rng() < 0.2) b.p(x, y, pick(rng, ROCKS_G)); continue }
    const d = noise(x + 200, y, { freq: 0.09, octaves: 2 })
    if (d > 0.52 && rng() < (d - 0.52) * 4) plantTree(b, rng, x, y, PINES)
  }
  // find the three biggest islands for POIs
  const comps = b.components().slice(0, 3)
  const centroid = c => {
    const s = c.reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0])
    return { x: Math.round(s[0] / c.length), y: Math.round(s[1] / c.length) }
  }
  if (comps[0]) {
    const m = centroid(comps[0])
    // monastery ruin: walls + gate + pillars
    for (let dx = -3; dx <= 3; dx++) { b.p(m.x + dx, m.y - 2, dx === 0 ? 'ow_ruin_gate' : 'ow_ruin_wall_0') }
    for (const dy of [0, 2]) for (const dx of [-3, 3]) b.p(m.x + dx, m.y + dy, 'ow_ruin_pillar_2')
    b.clearProp(m.x, m.y - 1)
    b.poi('ruin', m.x, m.y - 2, 'monastery ruin')
    b.poi('dungeon_entrance', m.x - 5, m.y + 4, 'crypt')
    b.clearProp(m.x - 5, m.y + 4); b.clearProp(m.x - 4, m.y + 4)
    b.p(m.x - 5, m.y + 4, 'ow_cave_gate_l'); b.p(m.x - 4, m.y + 4, 'ow_cave_gate_r')
  }
  if (comps[1]) {
    const m = centroid(comps[1])
    b.clearProp(m.x, m.y); b.clearProp(m.x + 1, m.y)
    b.p(m.x, m.y - 1, 'ow_roof_gray_l'); b.p(m.x + 1, m.y - 1, 'ow_roof_gray_r')
    b.p(m.x, m.y, 'ow_house_wall'); b.p(m.x + 1, m.y, 'ow_house_door_2')
    b.p(m.x + 3, m.y, 'ow_boat', { walkable: false })
    b.poi('village', m.x, m.y, 'fisher huts')
  }
  if (comps[2]) {
    const m = centroid(comps[2])
    b.clearProp(m.x, m.y); b.clearProp(m.x + 1, m.y)
    b.p(m.x, m.y, 'ow_cave_arch_0'); b.p(m.x + 1, m.y, 'ow_cave_arch_1')
    b.poi('dungeon_entrance', m.x, m.y, 'grotto')
  }
  // boats + skerries
  for (const s of b.scatter(rng, 24, 5, (x, y) => b.palette[b.ground[y][x]]?.startsWith('ow_water'))) {
    b.prop[s.y][s.x] = b.skin(rng() < 0.8 ? pick(rng, SKERRY) : 'ow_boat')
  }
  // causeways join every island big enough to matter — before POI placement,
  // so nothing lands on a pocket the healer would seal
  b.healFragmentation({ minKeep: 25, fill: (x, y) => { if (b.prop[y][x] === -1) b.p(x, y, pick(rng, ROCKS_G)) }, groundSkin: pierOverWater(b) })
  const main = b.largestComponent()
  for (const c of b.scatter(rng, 4, 22, (x, y) => main[y][x] && b.prop[y][x] === -1)) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  const home = comps[1] ? centroid(comps[1]) : { x: 20, y: 20 }
  b.playerSpawn = { x: home.x, y: home.y + 2 }
  b.ensureReachable(pierOverWater(b))
  pruneBrokenTrees(b)
  return b
}

for (const make of [suomenlinna, fishingVillage, archipelago]) {
  const b = make()
  const problems = validate(b)
  console.log(`${b.name}: ${problems.length ? 'PROBLEMS ' + problems.join('; ') : 'ok'}`)
  fs.writeFileSync(path.join(OUT, b.name + '.json'), JSON.stringify(b.toJSON()))
}
