// Three forest overworld attempts, one technique each:
//   1 clearings — noise-density woods with carved clearings, village, paths
//   2 river     — a river splits dense woods; bridges, lumber camp
//   3 autumn    — autumn woods below a mountain pass (ow_mtn_ tiles), stone circle, hermit hut
import { MapBuilder, WATER_SKINS, shoreline, mulberry32, makeNoise, validate, plantTree, pruneBrokenTrees, stampHouse3 } from './lib.mjs'
import { GRASS, PINES, AUTUMN, DIRT, pick, isOpen, clearing, forestEdge, grassBase, stampVillage, stampCaveInRocks } from './kit.mjs'
import { MTN, MTN_FLOOR_WEIGHTED, isMass, stampMass, clearMountain, clearMountainRect, stampMountainRim } from './mountain.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/maps')
fs.mkdirSync(OUT, { recursive: true })

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
  forestEdge(b, rng, PINES)
  const village = { x: 34, y: 30 }
  clearing(b, village.x, village.y, 10)
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'Aspengrove')
  const shrine = { x: 88, y: 18 }
  clearing(b, shrine.x, shrine.y, 5)
  b.p(shrine.x, shrine.y, 'tile_0064'); b.poi('landmark', shrine.x, shrine.y, 'forest shrine')
  const hollow = { x: 66, y: 62 }
  clearing(b, hollow.x, hollow.y, 6)
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
  caves.forEach((c, i) => { clearing(b, c.x, c.y, 3); stampCaveInRocks(b, rng, c.x, c.y); b.poi('dungeon_entrance', c.x, c.y, `cave ${i + 1}`) })
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
      b.g(x, y, pick(rng, WATER_SKINS))
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
  forestEdge(b, rng, PINES)
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
  // deep-woods cave east, shrine in a river bend — clear a buffer first
  // (unlike the dense woods around it) so the gate stamp's flank walls
  // don't pinch the only approach down to nothing
  clearing(b, 100, 24, 3)
  stampCaveInRocks(b, rng, 100, 24)
  b.poi('dungeon_entrance', 100, 24, 'bear cave')
  const shrineY = 40, shrineX = riverX(shrineY) + 6
  b.p(shrineX, shrineY, 'tile_0064'); b.poi('landmark', shrineX, shrineY, 'river shrine')
  for (const c of b.scatter(rng, 4, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: camp.x, y: camp.y + 2 }
  // the blocked border removed the old around-the-edge routes; join what the
  // river and the woods now split
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1'])), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  pruneBrokenTrees(b)
  return b
}

// ---------- attempt 3: autumn highlands -> mountain pass ----------
// The high ground wears the mountain-pass tileset (mountain.mjs): solid peak
// masses with cliff-edge rims, winding floor passes between them, scree
// boulders on the approaches. The woods below are untouched — the rng draws
// the old rock passes made are kept (unused) so every tree lands exactly
// where it did before the rocks became mountains.
function autumn() {
  const rng = mulberry32(606)
  const noise = makeNoise(rng)
  const b = new MapBuilder('forest-3-autumn', 'forest', 'autumn woods below a mountain pass', 120, 80)
  b.notes = 'Autumn woods climbing to a mountain pass; stone circle, hermit hut, two mine mouths in the peaks.'
  grassBase(b, rng)
  // elevation: north-east high. High ground is mountain floor; the highest
  // cells become peak masses, threaded by passes where a second noise sits
  // near its middle value.
  const elev = (x, y) => noise(x, y, { freq: 0.05, octaves: 3 }) * 0.7 + (x / b.w) * 0.15 + ((b.h - y) / b.h) * 0.25
  const isPass = (x, y) => Math.abs(noise(x + 700, y + 700, { freq: 0.06, octaves: 2 }) - 0.5) < 0.045
  const high = (x, y) => elev(x, y) > 0.58
  const mtnFloor = (x, y) => high(x, y) ? pick(rng, MTN_FLOOR_WEIGHTED) : 'ow_dirt_0'
  // Where the old generator put a rock (or would have planted a tree that
  // is now a mountain), remembered so the tree planter can ask "was the cell
  // above free?" of the OLD map, not this one — same draws, same trees.
  const oldProp = Array.from({ length: b.h }, () => new Array(b.w).fill(false))
  const oldFree = (x, y) => b.in(x, y) && !b.isBorder(x, y) && !oldProp[y][x] && b.prop[y][x] === -1
  // plantTree with the old map's tall-or-small decision; a tree that would
  // stand on a mountain is remembered instead of planted, a tall pair whose
  // top would land on one becomes a small tree.
  const plantAsBefore = (x, y, kit) => {
    if (oldFree(x, y - 1) && rng() < 0.6) {
      const [top, trunk] = pick(rng, kit.tall)
      if (isMass(b, x, y)) oldProp[y - 1][x] = oldProp[y][x] = true
      else if (isMass(b, x, y - 1)) b.p(x, y, kit.small[0])
      else { b.p(x, y - 1, top); b.p(x, y, trunk) }
    } else {
      const small = pick(rng, kit.small)
      if (isMass(b, x, y)) oldProp[y][x] = true
      else b.p(x, y, small)
    }
  }
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const e = elev(x, y)
    const at = (a, r) => a[Math.floor(r * a.length)]
    if (e > 0.62) {
      const r0 = rng(), r1 = rng(), r2 = r1 < 0.72 ? rng() : r1
      oldProp[y][x] = r1 < 0.72
      b.g(x, y, at(MTN_FLOOR_WEIGHTED, r0))
      if (e > 0.64 && !isPass(x, y)) stampMass(b, rng, x, y, at(MTN.peak, r2))
      else if (r0 < 0.08) { b.g(x, y, at(MTN.scree, r2)); b.block(x, y) }
    } else {
      // the fringe band (0.58-0.62) rolled for a loose rock and, missing,
      // fell through to the woods — so it grows trees, now on mountain floor
      const band = e > 0.58
      if (band) b.g(x, y, MTN_FLOOR_WEIGHTED[(x * 31 + y * 17) % MTN_FLOOR_WEIGHTED.length])
      const r0 = band ? rng() : 1
      if (r0 < 0.3) {
        const r1 = rng()
        if (r0 < 0.06) { b.g(x, y, at(MTN.scree, r1)); b.block(x, y) }
        oldProp[y][x] = true
      } else {
        const d = noise(x + 300, y, { freq: 0.08, octaves: 3 })
        if (d > 0.48 && rng() < (d - 0.48) * 2.5) plantAsBefore(x, y, rng() < 0.75 ? AUTUMN : PINES)
      }
    }
  }
  // the peaks run off the map: border cells on high ground join the mass
  // (they are blocked anyway) so the range shows no rim against the edge
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++)
    if (b.isBorder(x, y) && elev(x, y) > 0.64 && !isPass(x, y)) stampMass(b, rng, x, y, MTN.peak[(x * 7 + y * 13) % MTN.peak.length])
  // the edge band stays autumn trees (stampEdgeBand, with the old map's
  // draws: a cell that held a rock never drew), except where the mountains
  // already reach the edge — the peaks are their own visible border
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const dist = Math.min(x, y, b.w - 1 - x, b.h - 1 - y)
    if (dist > 2 || b.prop[y][x] !== -1 || oldProp[y][x]) continue
    if (dist <= 1 || rng() < 0.5) plantAsBefore(x, y, AUTUMN)
  }
  // stone circle on a knoll
  const circ = { x: 84, y: 22 }
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) b.clearProp(circ.x + x, circ.y + y)
  clearMountain(b, rng, circ.x, circ.y, 5)
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2
    b.p(circ.x + Math.round(Math.cos(a) * 4), circ.y + Math.round(Math.sin(a) * 4), 'ow_ruin_pillar_2')
  }
  b.poi('ruin', circ.x, circ.y, 'stone circle')
  // hermit hut in the south-west woods
  const hut = { x: 22, y: 58 }
  for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) b.clearProp(hut.x + x, hut.y + y)
  clearMountainRect(b, rng, hut.x - 5, hut.y - 4, hut.x + 5, hut.y + 4)
  stampHouse3(b, rng, hut.x, hut.y, 'brown')
  b.p(hut.x - 2, hut.y + 2, 'ow_beehive')
  b.p(hut.x + 3, hut.y + 1, 'ow_sign', { walkable: false })
  b.poi('village', hut.x + 1, hut.y + 2, 'hermit hut')
  // two mine mouths in the peaks: a pocket of floor opened in the mass with
  // the gate pair at its top, so the arch reads as cut into the mountain
  for (const [i, m] of [{ x: 102, y: 12 }, { x: 74, y: 8 }].entries()) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 2; dx++) b.clearProp(m.x + dx, m.y + dy)
    clearMountain(b, rng, m.x + 1, m.y + 1, 2)
    // abandoned mines wear the gated arch pair — enterable: walking in is
    // pushing the gate open
    b.clearProp(m.x, m.y); b.clearProp(m.x + 1, m.y)
    b.p(m.x, m.y, 'ow_cave_gate_l', { walkable: true }); b.p(m.x + 1, m.y, 'ow_cave_gate_r', { walkable: true })
    b.poi('dungeon_entrance', m.x, m.y, `old mine ${i + 1}`)
  }
  for (const c of b.scatter(rng, 4, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  b.playerSpawn = { x: hut.x + 1, y: hut.y + 3 }
  // pockets inside the mountains fill with peaks, pockets in the woods with
  // a scree boulder; bridges are mountain floor up high, dirt below
  // bridges cut through the mountains, never the woods (unless a pocket is
  // walled in by trees alone); a mine's pocket is small but must be bridged,
  // not filled. Pockets inside the mountains fill with peaks, pockets in
  // the woods with a tree.
  b.healFragmentation({
    minKeep: 8,
    fill: (x, y) => {
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isMass(b, x + dx, y + dy))) stampMass(b, rng, x, y)
      else b.p(x, y, pick(rng, AUTUMN.small))
    },
    groundSkin: mtnFloor,
    avoid: (x, y) => b.prop[y][x] !== -1,
  })
  b.ensureReachable(mtnFloor)
  pruneBrokenTrees(b)
  stampMountainRim(b, rng)
  return b
}

// forest-2-river was hand-painted in the editor after generation (its
// shoreline and log bridges); regenerating it would throw that away, so it
// is only rewritten with --all.
const HAND_FINISHED = new Set(['forest-2-river'])
const writeAll = process.argv.includes('--all')
for (const make of [clearings, river, autumn]) {
  const b = make()
  shoreline(b)
  const problems = validate(b)
  const skip = HAND_FINISHED.has(b.name) && !writeAll
  console.log(`${b.name}: ${problems.length ? 'PROBLEMS ' + problems.join('; ') : 'ok'}${skip ? ' (hand-finished, not written; pass --all to overwrite)' : ''}`)
  if (!skip) fs.writeFileSync(path.join(OUT, b.name + '.json'), JSON.stringify(b.toJSON()))
}
