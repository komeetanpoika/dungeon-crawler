// Three desert overworld attempts, one technique each:
//   1 dunes-and-oasis — noise-layered open erg
//   2 canyon          — carved wadi network through solid rock (the mountain tileset)
//   3 lost-city       — ruined sandstone city half-buried in sand
import { MapBuilder, mulberry32, makeNoise, validate, stampEdgeBand } from './lib.mjs'
import { stampMass, stampMountainRim } from './mountain.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/maps')
fs.mkdirSync(OUT, { recursive: true })

// Only blob-center and flat tiles: the other slices carry baked edge notches
// that read as dirt dashes when used as fill.
const SAND = ['ow_sand_0', 'ow_sand_0', 'ow_sand_0', 'ow_sand_flat']
const ROCKS_B = ['ow_rock_brown_0', 'ow_rock_brown_1', 'ow_rock_brown_2']
const ROCKS_G = ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']
const pick = (rng, a) => a[Math.floor(rng() * a.length)]
const desertEdge = (b, rng) => stampEdgeBand(b, rng, (x, y) => b.p(x, y, pick(rng, ROCKS_B)))

function sandBase(b, rng, noise) {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const n = noise(x, y, { freq: 0.06, octaves: 3 })
    b.g(x, y, n < 0.33 ? 'ow_hardpan_0'
      : rng() < 0.9 ? 'ow_sand_0' : pick(rng, SAND))
  }
}

// 3x3 pond + grass ring + palms-for-the-poor (round trees) and shrubs.
function stampOasis(b, rng, cx, cy) {
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++)
    if (x * x + y * y <= 13 && b.in(cx + x, cy + y)) b.g(cx + x, cy + y, rng() < 0.7 ? 'ow_grass_rpg_0' : 'ow_grass_rpg_1')
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    b.g(cx - 1 + x, cy - 1 + y, `ow_pond_${x}${y}`)
    b.block(cx - 1 + x, cy - 1 + y)
  }
  const flora = [[-3, -1, 'ow_bush_round'], [3, 0, 'ow_tree_apple'], [-1, -3, 'ow_bush_0'], [2, 2, 'ow_shrub_0'], [-2, 2, 'ow_bush_1']]
  for (const [dx, dy, s] of flora) if (rng() < 0.85) b.p(cx + dx, cy + dy, s)
}

function stampCamp(b, rng, x, y) {
  b.p(x, y, 'ow_tent_00'); b.p(x + 1, y, 'ow_tent_10')
  b.p(x, y + 1, 'ow_tent_01'); b.p(x + 1, y + 1, 'ow_tent_11')
  b.p(x + 3, y + 1, 'ow_sign', { walkable: false })
}

// A rock outcrop with a dark cave mouth: the map's dungeon entrance.
function stampCaveOutcrop(b, rng, x, y, rocks = ROCKS_G) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++)
    if (Math.abs(dx) + Math.abs(dy) < 3 && rng() < 0.9) b.p(x + dx, y + dy, pick(rng, rocks))
  b.clearProp(x, y); b.clearProp(x + 1, y)
  b.clearProp(x, y + 1); b.clearProp(x + 1, y + 1)
  b.p(x, y, 'ow_cave_arch_0', { walkable: true }); b.p(x + 1, y, 'ow_cave_arch_1', { walkable: true })
}

function scatterFlora(b, rng, n, kinds, ok) {
  for (const s of b.scatter(rng, n, 3, ok)) b.p(s.x, s.y, pick(rng, kinds))
}

const isOpen = b => (x, y) => b.walkable(x, y) && b.prop[y][x] === -1

// ---------- attempt 1: dunes and oasis ----------
function dunes() {
  const rng = mulberry32(101)
  const noise = makeNoise(rng)
  const b = new MapBuilder('desert-1-dunes', 'desert', 'noise-layered open erg', 120, 80)
  b.notes = 'Open sand sea. Crescent rock ridges as dune crests, twin oases, nomad camps.'
  sandBase(b, rng, noise)
  // dune crests: narrow bands of a second noise field become rock ridges
  const ridge = makeNoise(rng)
  for (let y = 2; y < b.h - 2; y++) for (let x = 2; x < b.w - 2; x++) {
    const v = ridge(x, y, { freq: 0.045, octaves: 2 })
    if (v > 0.585 && v < 0.615) b.p(x, y, pick(rng, ROCKS_B))
  }
  const oases = b.scatter(rng, 2, 45, isOpen(b))
  for (const o of oases) stampOasis(b, rng, o.x, o.y)
  const camps = b.scatter(rng, 2, 40, (x, y) => isOpen(b)(x, y) && oases.some(o => Math.abs(o.x - x) + Math.abs(o.y - y) < 22))
  for (const c of camps) { stampCamp(b, rng, c.x, c.y); b.poi('camp', c.x, c.y, 'nomad camp') }
  oases.forEach((o, i) => b.poi('landmark', o.x, o.y - 2, i ? 'far oasis' : 'oasis'))
  const caves = b.scatter(rng, 2, 55, (x, y) => isOpen(b)(x, y) && oases.every(o => Math.abs(o.x - x) + Math.abs(o.y - y) > 25))
  caves.forEach((c, i) => { stampCaveOutcrop(b, rng, c.x, c.y); b.poi('dungeon_entrance', c.x, c.y, `cave ${i + 1}`) })
  // a small ruin
  const [r] = b.scatter(rng, 1, 30, isOpen(b))
  if (r) {
    for (const [dx, dy, s] of [[-2, 0, 'ow_ruin_pillar'], [2, 0, 'ow_ruin_pillar_2'], [0, -2, 'ow_ruin_crack_0'], [-1, 2, 'ow_ruin_crack_1']])
      b.p(r.x + dx, r.y + dy, s)
    b.poi('ruin', r.x, r.y, 'toppled shrine')
  }
  scatterFlora(b, rng, 55, ['ow_cactus', 'ow_cactus', 'ow_deadtree_0', 'ow_deadtree_1', 'ow_shrub_0', 'ow_shrub_1'], isOpen(b))
  for (const c of b.scatter(rng, 5, 25, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  const spawn = camps[0] ?? { x: 10, y: 10 }
  b.playerSpawn = { x: spawn.x - 2, y: spawn.y + 2 }
  desertEdge(b, rng)
  b.ensureReachable('ow_sand_0')
  return b
}

// ---------- attempt 2: canyon ----------
function canyon() {
  const rng = mulberry32(202)
  const noise = makeNoise(rng)
  const b = new MapBuilder('desert-2-canyon', 'desert', 'carved wadi network in solid rock', 120, 80)
  b.notes = 'Everything mountain except carved canyons. Chambers hold an oasis, a buried temple, caves.'
  // solid rock massif: a mountain mass everywhere (mountain.mjs), carved
  // below. The draws the old boulder scatter made are kept so the wadis
  // walk exactly where they did.
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    b.g(x, y, rng() < 0.15 ? 'ow_stone_ground_0' : 'ow_sand_0')
    if (rng() < 0.65) { rng(); rng() }
    stampMass(b, rng, x, y)
  }
  const carve = (x, y) => { b.clearProp(x, y); b.g(x, y, rng() < 0.75 ? 'ow_hardpan_0' : 'ow_hardpan_1') }
  const chamber = (cx, cy, r) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r && b.in(cx + x, cy + y) && cx + x > 0 && cy + y > 0 && cx + x < b.w - 1 && cy + y < b.h - 1) carve(cx + x, cy + y)
  }
  // main wadi: biased random walk west->east with width 2-3
  const walk = (x, y, tx, ty, width) => {
    while ((x !== tx || y !== ty)) {
      for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++)
        if (x + dx > 0 && y + dy > 0 && x + dx < b.w - 1 && y + dy < b.h - 1) carve(x + dx, y + dy)
      const dxs = Math.sign(tx - x), dys = Math.sign(ty - y)
      if (rng() < 0.6 && dxs) x += dxs
      else if (rng() < 0.75 && dys) y += dys
      else { x += Math.floor(rng() * 3) - 1; y += Math.floor(rng() * 3) - 1 }
      x = Math.max(1, Math.min(b.w - width - 1, x)); y = Math.max(1, Math.min(b.h - width - 1, y))
    }
  }
  const spots = [
    { x: 8, y: 40 }, { x: 40, y: 18 }, { x: 45, y: 62 }, { x: 78, y: 30 }, { x: 74, y: 66 }, { x: 110, y: 44 },
  ]
  walk(spots[0].x, spots[0].y, spots[1].x, spots[1].y, 3)
  walk(spots[1].x, spots[1].y, spots[3].x, spots[3].y, 2)
  walk(spots[0].x, spots[0].y, spots[2].x, spots[2].y, 2)
  walk(spots[2].x, spots[2].y, spots[4].x, spots[4].y, 3)
  walk(spots[3].x, spots[3].y, spots[5].x, spots[5].y, 3)
  walk(spots[4].x, spots[4].y, spots[5].x, spots[5].y, 2)
  chamber(spots[1].x, spots[1].y, 6)   // oasis chamber
  chamber(spots[4].x, spots[4].y, 7)   // temple chamber
  chamber(spots[5].x, spots[5].y, 5)
  chamber(spots[0].x, spots[0].y, 4)
  stampOasis(b, rng, spots[1].x, spots[1].y)
  b.poi('landmark', spots[1].x, spots[1].y - 2, 'hidden oasis')
  // buried temple: gate front, pillar rows
  const t = spots[4]
  b.p(t.x - 1, t.y - 2, 'ow_ruin_wall_0'); b.p(t.x, t.y - 2, 'ow_ruin_gate'); b.p(t.x + 1, t.y - 2, 'ow_ruin_gate_r'); b.p(t.x + 2, t.y - 2, 'ow_ruin_wall_1')
  for (const dx of [-2, 2]) for (const dy of [0, 2]) b.p(t.x + dx, t.y + dy, dy ? 'ow_ruin_pillar_2' : 'ow_ruin_pillar')
  b.poi('ruin', t.x, t.y - 2, 'buried temple')
  b.poi('dungeon_entrance', spots[5].x, spots[5].y, 'deep cave')
  stampCaveOutcrop(b, rng, spots[5].x, spots[5].y)
  stampCamp(b, rng, spots[0].x - 1, spots[0].y - 1)
  b.poi('camp', spots[0].x, spots[0].y, 'wadi camp')
  scatterFlora(b, rng, 30, ['ow_cactus', 'ow_deadtree_0', 'ow_shrub_0', 'ow_shrub_1'], isOpen(b))
  for (const c of b.scatter(rng, 4, 30, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: spots[0].x + 2, y: spots[0].y + 2 }
  desertEdge(b, rng)
  b.ensureReachable('ow_hardpan_0')
  stampMountainRim(b, rng)
  return b
}

// ---------- attempt 3: lost city ----------
function lostCity() {
  const rng = mulberry32(303)
  const noise = makeNoise(rng)
  const b = new MapBuilder('desert-3-lost-city', 'desert', 'ruined sandstone city, half-buried', 120, 80)
  b.notes = 'A street grid of ruined blocks; the east side drowns in dunes. Palace gate, catacombs.'
  // calm base: plain sand only, so the city reads
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++)
    b.g(x, y, rng() < 0.92 ? 'ow_sand_0' : 'ow_sand_flat')
  // burial field: the further east, the more dune rocks swallow the streets
  const buried = x => Math.max(0, (x / b.w - 0.5) * 0.9)
  // city district: hardpan streets on a grid, ruined blocks between them
  const cityX = 16, cityY = 10, cols = 5, rows = 3, SX = 19, SY = 16
  for (let by = 0; by <= rows; by++)
    for (let x = cityX - 2; x <= cityX + cols * SX; x++) { b.g(x, cityY - 2 + by * SY, 'ow_hardpan_0'); b.g(x, cityY - 1 + by * SY, 'ow_hardpan_0') }
  for (let bx = 0; bx <= cols; bx++)
    for (let y = cityY - 2; y <= cityY + rows * SY; y++) { b.g(cityX - 2 + bx * SX, y, 'ow_hardpan_0'); b.g(cityX - 1 + bx * SX, y, 'ow_hardpan_0') }
  // streets erode under the eastern dunes
  for (let y = cityY - 2; y <= cityY + rows * SY; y++) for (let x = cityX - 2; x <= cityX + cols * SX; x++)
    if (b.in(x, y) && rng() < buried(x) * 0.9) { const g = b.ground[y][x]; if (b.palette[g] === 'ow_hardpan_0') b.g(x, y, 'ow_sand_0') }
  let palace = null
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    const isPalace = bx === 2 && by === 1
    if (!isPalace && rng() < 0.12) continue
    const x = cityX + bx * SX + 1, y = cityY + by * SY + 1
    const w = 10 + Math.floor(rng() * 4), h = 9 + Math.floor(rng() * 4)
    // cracked slab floor inside
    for (let cy = y + 1; cy < y + h - 1; cy++) for (let cx = x + 1; cx < x + w - 1; cx++)
      b.g(cx, cy, rng() < 0.25 ? pick(rng, ['ow_ruin_crack_0', 'ow_ruin_crack_1', 'ow_ruin_crack_2']) : 'ow_sand_flat')
    // ruined perimeter: wall tiles with erosion gaps that grow eastward
    const wallAt = (cx, cy, fallback) => {
      if (rng() < 0.12 + buried(cx)) { if (rng() < 0.4) b.p(cx, cy, pick(rng, ['ow_ruin_crack_0', 'ow_ruin_crack_2'])); return }
      b.p(cx, cy, rng() < 0.9 ? pick(rng, ['ow_ruin_wall_0', 'ow_ruin_wall_1']) : fallback)
    }
    for (let cx = x; cx < x + w; cx++) for (const cy of [y, y + h - 1]) wallAt(cx, cy, 'ow_ruin_wall_2')
    for (let cy = y + 1; cy < y + h - 1; cy++) for (const cx of [x, x + w - 1]) wallAt(cx, cy, 'ow_ruin_pillar_2')
    // a gate on the south side
    const gx = x + 2 + Math.floor(rng() * (w - 5))
    b.clearProp(gx, y + h - 1); b.clearProp(gx + 1, y + h - 1)
    if (!palace && bx === 2 && by === 1) {
      palace = { x: x + (w >> 1), y }
      b.p(palace.x - 1, y, 'ow_ruin_wall_0'); b.p(palace.x, y, 'ow_ruin_gate'); b.p(palace.x + 1, y, 'ow_ruin_gate_r')
      for (const dx of [-3, 3]) { b.p(palace.x + dx, y + 3, 'ow_ruin_pillar'); b.p(palace.x + dx, y + 6, 'ow_ruin_pillar_2') }
    }
  }
  if (palace) b.poi('ruin', palace.x, palace.y, 'palace gate')
  // dune belts swallowing the east side
  for (let y = 2; y < b.h - 2; y++) for (let x = 2; x < b.w - 2; x++) {
    const v = noise(x + 500, y, { freq: 0.05, octaves: 2 })
    if (v > 0.55 && rng() < buried(x) + (x > b.w * 0.62 ? 0.3 : 0)) b.p(x, y, pick(rng, ROCKS_B))
  }
  // catacombs entrance in the north-east rocks, an oasis south-west
  stampCaveOutcrop(b, rng, 100, 20)
  b.poi('dungeon_entrance', 100, 20, 'catacombs')
  stampOasis(b, rng, 16, 66)
  b.poi('landmark', 16, 64, 'oasis')
  stampCamp(b, rng, 24, 60)
  b.poi('camp', 25, 61, 'dig camp')
  scatterFlora(b, rng, 40, ['ow_cactus', 'ow_deadtree_0', 'ow_deadtree_1', 'ow_shrub_0'], (x, y) => isOpen(b)(x, y) && (x < cityX || x > cityX + cols * 18 || y < cityY || y > cityY + rows * 15))
  for (const c of b.scatter(rng, 5, 24, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: 24, y: 63 }
  desertEdge(b, rng)
  b.ensureReachable('ow_sand_0')
  return b
}

for (const make of [dunes, canyon, lostCity]) {
  const b = make()
  const problems = validate(b)
  if (problems.length) console.log(`${b.name}: PROBLEMS`, problems)
  else console.log(`${b.name}: ok`)
  fs.writeFileSync(path.join(OUT, b.name + '.json'), JSON.stringify(b.toJSON()))
}
