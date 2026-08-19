// Three forest overworld attempts, one technique each:
//   1 clearings — noise-density woods with carved clearings, village, paths
//   2 river     — a river splits dense woods; bridges, lumber camp
//   3 autumn    — autumn highland: rock outcrops, stone circle, hermit hut
import { MapBuilder, mulberry32, makeNoise, validate, plantTree, pruneBrokenTrees, stampHouse3 } from './lib.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/maps')
fs.mkdirSync(OUT, { recursive: true })

const GRASS = ['ow_grass_0', 'ow_grass_0', 'ow_grass_0', 'ow_grass_1', 'ow_grass_2']
// Tree kits (see plantTree): 2-tall pairs plus approved 1-tile trees;
// ow_bush_round reads as a bush, so it is a rare accent, not a tree.
const PINES = { tall: [['ow_tree_pine_top', 'ow_tree_pine_trunk']], small: ['ow_tree_small', 'ow_tree_small', 'ow_bush_round'] }
const AUTUMN = { tall: [['ow_tree_autumn_top', 'ow_tree_autumn_trunk']], small: ['ow_tree_small_autumn', 'ow_tree_autumn_top'] }
const DIRT = ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2', 'ow_dirt_3']
const ROCKS_MOSS = ['ow_rock_gray_moss_0', 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2']
const pick = (rng, a) => a[Math.floor(rng() * a.length)]
const isOpen = b => (x, y) => b.walkable(x, y) && b.prop[y][x] === -1

function grassBase(b, rng) {
  // flower variants are loud — keep them rare accents
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++)
    b.g(x, y, rng() < 0.95 ? 'ow_grass_0' : pick(rng, ['ow_grass_1', 'ow_grass_2']))
}

function stampVillage(b, rng, cx, cy) {
  // clear a plaza and lay cobble
  for (let y = -6; y <= 6; y++) for (let x = -8; x <= 8; x++)
    if (b.in(cx + x, cy + y)) { b.clearProp(cx + x, cy + y); if (x * x + y * y < 14) b.g(cx + x, cy + y, 'ow_cobble_green') }
  const spots = [[-6, -4], [3, -5], [-6, 3], [4, 3]]
  for (const [dx, dy] of spots) stampHouse3(b, rng, cx + dx, cy + dy, rng() < 0.5 ? 'red' : 'brown')
  b.p(cx, cy - 1, 'ow_well_top'); b.p(cx, cy, 'ow_well')
  b.p(cx - 2, cy + 1, 'ow_sign', { walkable: false })
  // fenced yard — l/m/r so the run has finished ends
  for (let x = -2; x <= 2; x++) b.p(cx + x, cy + 5, x === -2 ? 'ow_fence_l' : x === 2 ? 'ow_fence_r' : 'ow_fence_m')
}

function stampCaveInRocks(b, rng, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++)
    if (Math.abs(dx) + Math.abs(dy) < 3 && rng() < 0.92) b.p(x + dx, y + dy, pick(rng, ROCKS_MOSS))
  // the arch is an l+r pair; approach stays clear below both halves
  b.clearProp(x, y + 1); b.clearProp(x + 1, y + 1)
  b.p(x, y, 'ow_cave_arch_0'); b.p(x + 1, y, 'ow_cave_arch_1')
}

// ---------- attempt 1: clearings ----------
function clearings() {
  const rng = mulberry32(404)
  const noise = makeNoise(rng)
  const b = new MapBuilder('forest-1-clearings', 'forest', 'noise-density woods, carved clearings', 120, 80)
  b.notes = 'Dense mixed woods; a village clearing, shrine clearing, mushroom hollow, two caves.'
  grassBase(b, rng)
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const d = noise(x, y, { freq: 0.07, octaves: 3 })
    if (d > 0.42 && rng() < (d - 0.42) * 5) {
      if (rng() < 0.9) plantTree(b, rng, x, y, PINES)
      else b.p(x, y, pick(rng, ['ow_bush_0', 'ow_bush_1', 'ow_mushroom']))
    }
  }
  const clearing = (cx, cy, r) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) b.clearProp(cx + x, cy + y)
  }
  const village = { x: 34, y: 30 }
  clearing(village.x, village.y, 10)
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'Aspengrove')
  const shrine = { x: 88, y: 18 }
  clearing(shrine.x, shrine.y, 5)
  b.p(shrine.x, shrine.y, 'tile_0064'); b.poi('landmark', shrine.x, shrine.y, 'forest shrine')
  const hollow = { x: 66, y: 62 }
  clearing(hollow.x, hollow.y, 6)
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2
    b.p(hollow.x + Math.round(Math.cos(a) * 4), hollow.y + Math.round(Math.sin(a) * 4), 'ow_mushroom', { walkable: false })
  }
  b.poi('landmark', hollow.x, hollow.y, 'mushroom ring')
  // winding dirt paths village -> shrine, village -> hollow
  const wander = (x0, y0, x1, y1) => {
    let x = x0, y = y0
    while (x !== x1 || y !== y1) {
      b.clearProp(x, y); b.g(x, y, pick(rng, DIRT))
      if (rng() < 0.2) { const [dx, dy] = pick(rng, [[0, 1], [0, -1], [1, 0], [-1, 0]]); x = Math.max(1, Math.min(b.w - 2, x + dx)); y = Math.max(1, Math.min(b.h - 2, y + dy)) }
      else if (Math.abs(x1 - x) > Math.abs(y1 - y)) x += Math.sign(x1 - x)
      else y += Math.sign(y1 - y)
    }
    b.clearProp(x, y); b.g(x, y, pick(rng, DIRT))
  }
  wander(village.x + 8, village.y, shrine.x, shrine.y)
  wander(village.x, village.y + 8, hollow.x, hollow.y)
  const caves = [{ x: 12, y: 66 }, { x: 108, y: 50 }]
  caves.forEach((c, i) => { clearing(c.x, c.y, 3); stampCaveInRocks(b, rng, c.x, c.y); b.poi('dungeon_entrance', c.x, c.y, `cave ${i + 1}`) })
  b.p(village.x - 9, village.y - 7, 'ow_beehive')
  for (const c of b.scatter(rng, 4, 28, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: village.x, y: village.y + 2 }
  b.ensureReachable('ow_dirt_0')
  pruneBrokenTrees(b)
  return b
}

// ---------- attempt 2: river ----------
function river() {
  const rng = mulberry32(505)
  const noise = makeNoise(rng)
  const b = new MapBuilder('forest-2-river', 'forest', 'river split, bridges, lumber camp', 120, 80)
  b.notes = 'A north-south river with two log bridges; lumber camp west, dense wilds east.'
  grassBase(b, rng)
  // river: sinuous vertical band
  const riverX = y => 58 + Math.round(Math.sin(y * 0.09) * 10 + noise(0, y, { freq: 0.15, octaves: 2 }) * 8 - 4)
  for (let y = 0; y < b.h; y++) {
    const cx = riverX(y)
    for (let x = cx - 2; x <= cx + 2; x++) {
      b.g(x, y, pick(rng, ['ow_water_0', 'ow_water_1', 'ow_water_2', 'ow_water_3']))
      b.block(x, y)
      if (Math.abs(x - cx) === 2 && rng() < 0.1) b.p(x, y, pick(rng, ['ow_rock_water_gray_0', 'ow_rock_water_gray_1']))
    }
  }
  // woods denser east of the river
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y)) continue
    const d = noise(x, y, { freq: 0.08, octaves: 3 })
    const east = x > riverX(y)
    const thr = east ? 0.40 : 0.47
    if (d > thr && rng() < (d - thr) * (east ? 5 : 3.5)) {
      if (rng() < 0.92) plantTree(b, rng, x, y, PINES)
      else b.p(x, y, pick(rng, ['ow_bush_0', 'ow_bush_berry']))
    }
  }
  // two log bridges
  for (const by of [22, 58]) {
    const cx = riverX(by)
    for (let x = cx - 3; x <= cx + 3; x++) {
      b.clearProp(x, by)
      b.g(x, by, 'ow_pier_log')
      b.unblock(x, by)
    }
    b.poi('landmark', cx, by, by === 22 ? 'north bridge' : 'south bridge')
  }
  // lumber camp west of river
  const camp = { x: 30, y: 40 }
  for (let y = -5; y <= 5; y++) for (let x = -7; x <= 7; x++) b.clearProp(camp.x + x, camp.y + y)
  stampHouse3(b, rng, camp.x - 4, camp.y - 3, 'brown')
  b.p(camp.x + 2, camp.y - 2, 'ow_pier_log', { walkable: false })
  b.p(camp.x + 3, camp.y - 2, 'ow_pier_log', { walkable: false })
  b.p(camp.x + 2, camp.y, 'ow_deadtree_0', { walkable: false })
  b.p(camp.x - 2, camp.y + 3, 'ow_fence_m'); b.p(camp.x - 1, camp.y + 3, 'ow_fence_m')
  b.poi('camp', camp.x, camp.y - 1, 'lumber camp')
  // deep-woods cave east, shrine in a river bend
  stampCaveInRocks(b, rng, 100, 24)
  b.poi('dungeon_entrance', 100, 24, 'bear cave')
  const shrineY = 40, shrineX = riverX(shrineY) + 6
  b.p(shrineX, shrineY, 'tile_0064'); b.poi('landmark', shrineX, shrineY, 'river shrine')
  for (const c of b.scatter(rng, 4, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: camp.x, y: camp.y + 2 }
  b.ensureReachable('ow_dirt_0')
  pruneBrokenTrees(b)
  return b
}

// ---------- attempt 3: autumn highlands ----------
function autumn() {
  const rng = mulberry32(606)
  const noise = makeNoise(rng)
  const b = new MapBuilder('forest-3-autumn', 'forest', 'autumn highland, rock outcrops', 120, 80)
  b.notes = 'Autumn woods climbing to a rocky ridge; stone circle, hermit hut, two mine mouths.'
  grassBase(b, rng)
  // elevation: north-east high. Ridge cells become mossy rock bands.
  const elev = (x, y) => noise(x, y, { freq: 0.05, octaves: 3 }) * 0.7 + (x / b.w) * 0.15 + ((b.h - y) / b.h) * 0.25
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const e = elev(x, y)
    if (e > 0.62) {
      b.g(x, y, rng() < 0.2 ? 'ow_stone_ground_0' : 'ow_grass_0')
      if (rng() < 0.72) b.p(x, y, pick(rng, ROCKS_MOSS))
    } else if (e > 0.58 && rng() < 0.3) b.p(x, y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1']))
    else {
      const d = noise(x + 300, y, { freq: 0.08, octaves: 3 })
      if (d > 0.48 && rng() < (d - 0.48) * 2.5) plantTree(b, rng, x, y, rng() < 0.75 ? AUTUMN : PINES)
    }
  }
  // stone circle on a knoll
  const circ = { x: 84, y: 22 }
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) b.clearProp(circ.x + x, circ.y + y)
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2
    b.p(circ.x + Math.round(Math.cos(a) * 4), circ.y + Math.round(Math.sin(a) * 4), 'ow_ruin_pillar_2')
  }
  b.poi('ruin', circ.x, circ.y, 'stone circle')
  // hermit hut in the south-west woods
  const hut = { x: 22, y: 58 }
  for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) b.clearProp(hut.x + x, hut.y + y)
  stampHouse3(b, rng, hut.x, hut.y, 'brown')
  b.p(hut.x - 2, hut.y + 2, 'ow_beehive')
  b.p(hut.x + 3, hut.y + 1, 'ow_sign', { walkable: false })
  b.poi('village', hut.x + 1, hut.y + 2, 'hermit hut')
  // two mine mouths in the high rocks
  for (const [i, m] of [{ x: 102, y: 12 }, { x: 74, y: 8 }].entries()) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 2; dx++) b.clearProp(m.x + dx, m.y + dy)
    // abandoned mines wear the gated arch pair
    b.p(m.x, m.y, 'ow_cave_gate_l'); b.p(m.x + 1, m.y, 'ow_cave_gate_r')
    b.poi('dungeon_entrance', m.x, m.y, `old mine ${i + 1}`)
  }
  for (const c of b.scatter(rng, 4, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: hut.x + 1, y: hut.y + 3 }
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  pruneBrokenTrees(b)
  return b
}

for (const make of [clearings, river, autumn]) {
  const b = make()
  const problems = validate(b)
  console.log(`${b.name}: ${problems.length ? 'PROBLEMS ' + problems.join('; ') : 'ok'}`)
  fs.writeFileSync(path.join(OUT, b.name + '.json'), JSON.stringify(b.toJSON()))
}
