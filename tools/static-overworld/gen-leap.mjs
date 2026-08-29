// The three "leap" maps (docs/superpowers/specs/2026-08-29-leap-episodes-design.md):
//   lake-1-ferry     — Toivo's pier, the Näkki, the orchard bank
//   highland-2-fold  — Aino's fold, the wolf den, the Maahinen's burrow
//   marsh-3-hermit   — Lauri's cold village, the hermit's hearth, the Sammunut
// Every episode POI the game reads is declared here by label; test/leap-maps.test.js
// lists them.
import { MapBuilder, mulberry32, makeNoise, validate, plantTree, pruneBrokenTrees, stampHouse3 } from './lib.mjs'
import { PINES, ROCKS_MOSS, pick, isOpen, clearing, forestEdge, grassBase, stampVillage, stampCaveInRocks } from './kit.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/maps')
fs.mkdirSync(OUT, { recursive: true })
const WATER = ['ow_water_0', 'ow_water_1', 'ow_water_2', 'ow_water_3']
const isWater = (b, x, y) => b.palette[b.ground[y]?.[x]]?.startsWith('ow_water')

// The arrival runestone: a walkable stone arch with the spawn just south of it.
function stampRunestone(b, x, y) {
  clearing(b, x, y, 2)
  b.p(x, y, 'ow_house_arch_stone', { walkable: true })
  b.poi('landmark', x, y, 'runestone')
  b.playerSpawn = { x, y: y + 1 }
}

function lake() {
  const rng = mulberry32(808)
  const noise = makeNoise(rng)
  const b = new MapBuilder('lake-1-ferry', 'forest', 'lake with a pier, islet, orchard bank', 120, 80)
  b.notes = "Toivo's lake: village west, orchard east, the pier between them, the Näkki beneath it."
  grassBase(b, rng)
  // the lake: a blob centred east of the middle, noise-rimmed
  const cx = 66, cy = 40, rx = 24, ry = 18
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + noise(x, y, { freq: 0.12, octaves: 2 }) * 0.25 - 0.12
    if (d < 1) { b.g(x, y, pick(rng, WATER)); b.block(x, y) }
  }
  // woods everywhere else, thinner near the shore
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y)) continue
    const d = noise(x + 100, y, { freq: 0.08, octaves: 3 })
    if (d > 0.46 && rng() < (d - 0.46) * 3.5) plantTree(b, rng, x, y, PINES)
  }
  forestEdge(b, rng, PINES)
  // village on the west shore
  const village = { x: 28, y: 40 }
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'village')
  // Toivo's hut a little south, with the fish-rack sign
  stampHouse3(b, rng, village.x - 2, village.y + 10, 'brown')
  b.p(village.x + 1, village.y + 12, 'ow_sign', { walkable: false })
  b.poi('landmark', village.x, village.y + 12, "Toivo's hut")
  // the pier: from the west shore straight east to the bell post, then a
  // two-cell gap of open water (the Näkki's), then the orchard bank
  const py = cy
  let x0 = cx - rx
  while (!isWater(b, x0, py)) x0++
  const pierLen = 14
  for (let x = x0; x < x0 + pierLen; x++) { b.clearProp(x, py); b.g(x, py, 'ow_pier_log'); b.unblock(x, py) }
  const bellX = x0 + pierLen - 1
  b.p(bellX, py - 1, 'ow_pier_post', { walkable: false })
  b.poi('landmark', bellX, py, 'bell')
  b.poi('landmark', bellX, py, 'pier end')
  b.poi('landmark', bellX + 1, py, 'nakki')          // water beside the pier end, right where it meets the pier
  b.poi('landmark', bellX + 1, py, 'pier gap 1')          // water until the Näkki is gone
  b.poi('landmark', bellX + 2, py, 'pier gap 2')
  // the pier resumes after the gap and runs to the east bank
  let x1 = bellX + 3
  while (isWater(b, x1, py)) { b.clearProp(x1, py); b.g(x1, py, 'ow_pier_log'); b.unblock(x1, py); x1++ }
  // orchard on the east bank — apple trees on a cleared lawn
  const orchard = { x: x1 + 6, y: py }
  clearing(b, orchard.x, orchard.y, 7)
  for (let y = -5; y <= 5; y += 2) for (let x = -5; x <= 5; x += 2) b.p(orchard.x + x, orchard.y + y, 'ow_tree_apple')
  b.poi('landmark', orchard.x, orchard.y, 'orchard')
  // the east bank must only be reachable across the pier: a solid tree wall
  // straddling the lake's north and south "necks" (its cells are snapshotted
  // and restored verbatim below, after healFragmentation/ensureReachable run
  // — both would otherwise bulldoze straight through it to satisfy every POI
  // and merge every last pocket).
  const sealEastBank = () => {
    for (const [y0, y1] of [[1, cy - ry], [cy + ry, b.h - 1]])
      for (let y = y0; y < y1; y++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx
        b.clearProp(x, y); plantTree(b, rng, x, y, PINES)
      }
    // dense cover east of the wall (the isolated side never has to look
    // walkably sparse — nobody crosses it except across the pier) keeps the
    // secluded pocket small relative to total walkable area — but never on
    // the pier itself, or the resumed pier east of the gap grows tree props
    // that block walking straight across to the orchard
    for (let y = 1; y < b.h - 1; y++) for (let x = cx + 4; x < b.w - 1; x++)
      if (b.walkable(x, y) && b.prop[y][x] === -1 && !isWater(b, x, y) &&
          b.palette[b.ground[y][x]] !== 'ow_pier_log' &&
          Math.hypot(x - orchard.x, y - orchard.y) > 8 && rng() < 0.97)
        plantTree(b, rng, x, y, PINES)
  }
  sealEastBank()
  // the islet: a small dot of land in the lake's south, ringed by trees,
  // holding the clapper cache; reached by felling the ring
  const islet = { x: cx - 6, y: cy + 11 }
  for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++) {
    if (x * x + y * y > 9) continue
    b.g(islet.x + x, islet.y + y, 'ow_grass_0'); b.unblock(islet.x + x, islet.y + y)
  }
  for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++)
    if (x * x + y * y > 4 && x * x + y * y <= 9) b.p(islet.x + x, islet.y + y, 'ow_tree_small')
  b.p(islet.x, islet.y, 'tile_0089', { walkable: true }); b.poi('chest', islet.x, islet.y, 'islet cache')
  // a strip of shore trees joins the islet to the south shore: land under
  // the trees, so it is reachable on foot once chopped, but every crossing
  // cell stays tree-blocked so plain walking never gets there. This column
  // falls inside the EAST_FROM snapshot span below, so ensureReachable's
  // own auto-carve through it is always discarded, never reapplied.
  for (let y = islet.y + 3; isWater(b, islet.x, y); y++) { b.g(islet.x, y, 'ow_grass_0'); b.p(islet.x, y, 'ow_tree_small') }
  // one cave in the north woods
  const cave = { x: 60, y: 10 }
  clearing(b, cave.x, cave.y, 3); stampCaveInRocks(b, rng, cave.x, cave.y); b.poi('dungeon_entrance', cave.x, cave.y, 'lake cave')
  // caches — kept west of the wall, so none strands on the sealed orchard side
  for (const c of b.scatter(rng, 3, 26, (x, y) => isOpen(b)(x, y) && x < cx - 2)) {
    b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache')
  }
  // arrival runestone west of the village, exit runestone by the orchard
  stampRunestone(b, 12, 40)
  b.p(orchard.x + 6, orchard.y, 'ow_house_arch_stone', { walkable: true }); b.poi('landmark', orchard.x + 6, orchard.y, 'orchard stone')
  // Everything from the pier gap eastward (the gap itself, the resumed
  // pier, the wall, the orchard) must stay genuinely cut off pre-episode
  // (fed by the Näkki, a later task) — but healFragmentation treats any
  // pocket over minKeep cells as an accidental gap to bridge, and
  // ensureReachable independently bulldozes a path to every POI including
  // 'orchard'/'orchard stone'/'islet cache' (the islet and its shore
  // connector both sit east of the pier gap too). Both routinely tunnel
  // straight through the wall, the lake, or the islet's tree ring to do it.
  // Snapshot that whole span and restore it verbatim afterward — no carve
  // either pass makes in it is ever kept — while west of it (village, cave)
  // still gets healed and connected normally.
  const EAST_FROM = bellX + 1
  const snapshot = { ground: [], prop: [], walk: [] }
  for (let y = 0; y < b.h; y++) {
    snapshot.ground.push(b.ground[y].slice(EAST_FROM))
    snapshot.prop.push(b.prop[y].slice(EAST_FROM))
    snapshot.walk.push(b.walkG[y].slice(EAST_FROM))
  }
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  for (let y = 0; y < b.h; y++) for (let i = 0; i < snapshot.ground[y].length; i++) {
    b.ground[y][EAST_FROM + i] = snapshot.ground[y][i]
    b.prop[y][EAST_FROM + i] = snapshot.prop[y][i]
    b.walkG[y][EAST_FROM + i] = snapshot.walk[y][i]
  }
  // the pier gap cells must stay water/blocked regardless of what either
  // pass did to them.
  for (const label of ['pier gap 1', 'pier gap 2']) { const p = b.pois.find(q => q.label === label); b.g(p.x, p.y, pick(rng, WATER)); b.block(p.x, p.y) }
  pruneBrokenTrees(b)
  return b
}

export const LEAP_MAPS = [lake]
for (const make of LEAP_MAPS) {
  const b = make()
  const problems = validate(b)
  // the orchard is deliberately unreachable until the Näkki is fed, and the
  // islet cache is deliberately unreachable by plain walking (only the tree
  // ring/connector, felled, gets you there)
  const ok = problems.filter(p => !/orchard|pier gap|nakki|islet/.test(p))
  if (ok.length) { console.error(b.name, ok); process.exitCode = 1 }
  fs.writeFileSync(path.join(OUT, `${b.name}.json`), JSON.stringify(b.toJSON()))
  console.log('wrote', b.name, problems.length ? `(expected-unreachable: ${problems.join('; ')})` : '')
}
