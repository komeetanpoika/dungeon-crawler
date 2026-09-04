// The three "leap" maps (docs/superpowers/specs/2026-08-29-leap-episodes-design.md):
//   lake-1-ferry     — Toivo's pier, the Näkki, the orchard bank
//   highland-2-fold  — Aino's fold, the wolf den, the Maahinen's burrow
//   marsh-3-hermit   — Lauri's cold village, the hermit's hearth, the Sammunut
// Every episode POI the game reads is declared here by label; test/leap-maps.test.js
// lists them.
import { MapBuilder, WATER_SKINS, shoreline, mulberry32, makeNoise, validate, plantTree, pruneBrokenTrees, stampHouse3 } from './lib.mjs'
import { PINES, AUTUMN, ROCKS_MOSS, DIRT, pick, isOpen, clearing, forestEdge, grassBase, stampVillage, stampCaveInRocks } from './kit.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/maps')
fs.mkdirSync(OUT, { recursive: true })
const WATER = WATER_SKINS
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
  // PIER_GAP-cell gap of open water (the Näkki's — it sits in the first gap
  // cell, within a swing of the pier end; the rest is room for its sprite
  // sheet body and tail), then the orchard bank
  const PIER_GAP = 4
  const py = cy
  let x0 = cx - rx
  while (!isWater(b, x0, py)) x0++
  const pierLen = 14
  // Pier logs are a walkable prop laid over the lake, never the ground: the
  // log art has transparent rows above and below the planks, so the water
  // skin under it must still be drawn (openmap.js bakes a walkable prop over
  // water ground to a FLOOR cell with a water skin and the log as overlay).
  const layPier = x => { b.clearProp(x, py); b.p(x, py, 'ow_pier_log', { walkable: true }); b.unblock(x, py) }
  for (let x = x0; x < x0 + pierLen; x++) layPier(x)
  const bellX = x0 + pierLen - 1
  b.p(bellX, py - 1, 'ow_pier_post', { walkable: false })
  b.poi('landmark', bellX, py, 'bell')
  b.poi('landmark', bellX, py, 'pier end')
  b.poi('landmark', bellX + 1, py, 'nakki')          // water beside the pier end, right where it meets the pier
  for (let i = 1; i <= PIER_GAP; i++) b.poi('landmark', bellX + i, py, `pier gap ${i}`)   // water until the Näkki is gone
  // the pier resumes after the gap and runs to the east bank
  let x1 = bellX + 1 + PIER_GAP
  while (isWater(b, x1, py)) { layPier(x1); x1++ }
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
    // secluded pocket small relative to total walkable area — never on the
    // pier itself (it sits on water ground and already carries the log
    // prop), or the resumed pier east of the gap would grow tree props that
    // block walking straight across to the orchard
    for (let y = 1; y < b.h - 1; y++) for (let x = cx + 4; x < b.w - 1; x++)
      if (b.walkable(x, y) && b.prop[y][x] === -1 && !isWater(b, x, y) &&
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
  for (const p of b.pois.filter(q => /^pier gap \d+$/.test(q.label))) { b.g(p.x, p.y, pick(rng, WATER)); b.block(p.x, p.y) }
  pruneBrokenTrees(b)
  return b
}

function fold() {
  const rng = mulberry32(909)
  const noise = makeNoise(rng)
  const b = new MapBuilder('highland-2-fold', 'forest', 'highland fold, wolf den, sealed burrow', 120, 80)
  b.notes = "Aino's highland: the fold by the village, the wolves' hollow north, the burrow beyond it."
  grassBase(b, rng)
  const elev = (x, y) => noise(x, y, { freq: 0.05, octaves: 3 }) * 0.7 + ((b.h - y) / b.h) * 0.3
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const e = elev(x, y)
    if (e > 0.64) { b.g(x, y, rng() < 0.2 ? 'ow_stone_ground_0' : 'ow_grass_0'); if (rng() < 0.7) b.p(x, y, pick(rng, ROCKS_MOSS)) }
    else { const d = noise(x + 300, y, { freq: 0.08, octaves: 3 }); if (d > 0.47 && rng() < (d - 0.47) * 3) plantTree(b, rng, x, y, PINES) }
  }
  forestEdge(b, rng, PINES)
  // village south with the fold beside it
  const village = { x: 40, y: 58 }
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'village')
  // the south-east village house's door (stampVillage's [4, 3] spot, door at
  // x+1, y+2 of that house's origin) doubles as Aino's front door.
  b.poi('landmark', village.x + 5, village.y + 5, "Aino's house")
  const fold = { x: village.x + 14, y: village.y }
  for (let y = -3; y <= 3; y++) for (let x = -4; x <= 4; x++) b.clearProp(fold.x + x, fold.y + y)
  for (let x = -4; x <= 4; x++) { b.p(fold.x + x, fold.y - 3, x === -4 ? 'ow_fence_l' : x === 4 ? 'ow_fence_r' : 'ow_fence_m'); if (x !== 0) b.p(fold.x + x, fold.y + 3, x === -4 ? 'ow_fence_l' : x === 4 ? 'ow_fence_r' : 'ow_fence_m') }
  for (let y = -2; y <= 2; y++) { b.p(fold.x - 4, fold.y + y, 'ow_fence_v'); b.p(fold.x + 4, fold.y + y, 'ow_fence_v') }
  b.poi('landmark', fold.x, fold.y, 'fold')
  // the wolves' hollow: a rock ring north-east
  const den = { x: 78, y: 34 }
  clearing(b, den.x, den.y, 4)
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (i !== 9) b.p(den.x + Math.round(Math.cos(a) * 4), den.y + Math.round(Math.sin(a) * 4), pick(rng, ROCKS_MOSS)) }
  b.poi('landmark', den.x, den.y, 'den')
  // the lamb trail: dirt cells from the fold gap past the den to the burrow
  const burrow = { x: 96, y: 18 }
  const trail = [[fold.x, fold.y + 3], [fold.x + 6, fold.y - 6], [den.x - 8, den.y + 6], [den.x + 6, den.y - 4], [burrow.x - 2, burrow.y + 3]]
  for (let i = 1; i < trail.length; i++) {
    const [ax, ay] = trail[i - 1], [bx, by] = trail[i]
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    for (let k = 0; k <= n; k++) { const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n); b.clearProp(x, y); b.g(x, y, pick(rng, DIRT)) }
  }
  // the burrow: a rock pocket whose mouth is three rocks across; the lair inside
  clearing(b, burrow.x, burrow.y, 5)
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const r2 = x * x + y * y
    if (r2 > 16 && r2 <= 25) b.p(burrow.x + x, burrow.y + y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']))
  }
  const mouth = { x: burrow.x, y: burrow.y + 4 }
  for (const dx of [-1, 0, 1]) { b.clearProp(mouth.x + dx, mouth.y); b.p(mouth.x + dx, mouth.y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1'])) }
  b.poi('landmark', mouth.x, mouth.y, 'burrow')
  b.poi('landmark', burrow.x, burrow.y - 1, 'lair')
  b.p(mouth.x, mouth.y + 1, 'tile_0089', { walkable: true }); b.poi('chest', mouth.x, mouth.y + 1, 'fleece cache')
  // the four burn bands: forest pockets the villagers torch in order,
  // marching from the village toward the den. Each must carry enough fuel
  // (tree-prop cells) that converting them to dead trees at burn time reads
  // as a real burn — burn 1 sits close to the village's thinner cover, so
  // guarantee fuel explicitly rather than rely on the base terrain pass.
  const nearFoldOrVillage = (x, y) =>
    (x >= village.x - 10 && x <= village.x + 10 && y >= village.y - 8 && y <= village.y + 8) ||
    (x >= fold.x - 6 && x <= fold.x + 6 && y >= fold.y - 5 && y <= fold.y + 5)
  const isDirtGround = (x, y) => DIRT.includes(b.palette[b.ground[y][x]])
  for (const [i, c] of [[52, 50], [60, 44], [68, 40], [74, 30]].entries()) {
    b.poi('landmark', c[0], c[1], `burn ${i + 1}`)
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = c[0] + dx, y = c[1] + dy
      if (!b.in(x, y) || nearFoldOrVillage(x, y) || isDirtGround(x, y)) continue
      if (isOpen(b)(x, y) && rng() < 0.75) plantTree(b, rng, x, y, PINES)
    }
  }
  // the old mine
  const mine = { x: 20, y: 14 }
  clearing(b, mine.x, mine.y, 3); stampCaveInRocks(b, rng, mine.x, mine.y); b.poi('dungeon_entrance', mine.x, mine.y, 'old mine')
  for (const c of b.scatter(rng, 3, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  stampRunestone(b, village.x - 14, village.y)
  b.p(burrow.x - 14, burrow.y + 8, 'ow_house_arch_stone', { walkable: true }); b.poi('landmark', burrow.x - 14, burrow.y + 8, 'ridge stone')
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  // healFragmentation/ensureReachable must not have breached the burrow:
  // 'lair' is a POI, so ensureReachable carves the nearest path to it —
  // not necessarily through the mouth. Re-stamp the whole ring (undoing any
  // carve anywhere around it, not just at the mouth) before resealing the
  // three-cell mouth on top.
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const r2 = x * x + y * y
    if (r2 > 16 && r2 <= 25) b.p(burrow.x + x, burrow.y + y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']))
  }
  for (const dx of [-1, 0, 1]) b.p(mouth.x + dx, mouth.y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1']))
  // the fleece cache sits right on the ring's radius (r2 === 25) just south
  // of the mouth — the restamp above just re-rocked it; put it back. `p()`'s
  // walkable:true only avoids blocking, it never force-unblocks a cell a
  // prior call already blocked, so unblock explicitly too.
  b.p(mouth.x, mouth.y + 1, 'tile_0089', { walkable: true })
  b.unblock(mouth.x, mouth.y + 1)
  pruneBrokenTrees(b)
  return b
}

function marsh() {
  const rng = mulberry32(1010)
  const noise = makeNoise(rng)
  const b = new MapBuilder('marsh-3-hermit', 'forest', 'autumn marsh, cold village, hermit knoll', 120, 80)
  b.notes = "Lauri's marsh: pools and autumn woods, the cold village south, the hermit's knoll north ringed by dead trees."
  grassBase(b, rng)
  // pools
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const w = noise(x, y, { freq: 0.07, octaves: 2 })
    if (w > 0.62) { b.g(x, y, pick(rng, WATER)); b.block(x, y) }
    else if (w > 0.58) b.g(x, y, pick(rng, DIRT))
  }
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y)) continue
    const d = noise(x + 500, y, { freq: 0.08, octaves: 3 })
    if (d > 0.47 && rng() < (d - 0.47) * 3) plantTree(b, rng, x, y, AUTUMN)
    else if (d > 0.55 && rng() < 0.08) b.p(x, y, 'ow_mushroom')
  }
  forestEdge(b, rng, AUTUMN)
  // the cold village: three hearths in the plaza
  const village = { x: 60, y: 60 }
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'village')
  for (const [i, [dx, dy]] of [[-4, -2], [4, -2], [0, 3]].entries()) {
    b.clearProp(village.x + dx, village.y + dy); b.p(village.x + dx, village.y + dy, 'prop_hearth_cold', { walkable: false })
    b.poi('landmark', village.x + dx, village.y + dy, `hearth ${i + 1}`)
  }
  // the hermit's knoll north, ringed by dead trees, hearth in front of the door
  const hut = { x: 58, y: 18 }
  clearing(b, hut.x, hut.y, 7)
  stampHouse3(b, rng, hut.x, hut.y, 'brown')
  // A landmark, not a village: npcSpawnsForMap anchors the village roster on
  // the first village/camp POI, and the hermit's hut is not the village.
  b.poi('landmark', hut.x + 1, hut.y + 2, 'hermit hut')
  b.clearProp(hut.x + 1, hut.y + 4); b.poi('landmark', hut.x + 1, hut.y + 4, 'hearth')
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2
    const x = hut.x + 1 + Math.round(Math.cos(a) * 7), y = hut.y + 2 + Math.round(Math.sin(a) * 6)
    if (i % 5 !== 0) b.p(x, y, pick(rng, ['ow_deadtree_0', 'ow_deadtree_1']))
  }
  // the mushroom ring east, the rite anchor
  const ring = { x: 92, y: 40 }
  clearing(b, ring.x, ring.y, 4)
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.p(ring.x + Math.round(Math.cos(a) * 3), ring.y + Math.round(Math.sin(a) * 3), 'ow_mushroom') }
  b.poi('landmark', ring.x, ring.y, 'mushroom ring')
  const cave = { x: 22, y: 30 }
  clearing(b, cave.x, cave.y, 3); stampCaveInRocks(b, rng, cave.x, cave.y); b.poi('dungeon_entrance', cave.x, cave.y, 'bog cave')
  for (const c of b.scatter(rng, 3, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  stampRunestone(b, village.x - 16, village.y + 4)
  b.p(hut.x + 14, hut.y + 2, 'ow_house_arch_stone', { walkable: true }); b.poi('landmark', hut.x + 14, hut.y + 2, 'knoll stone')
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  pruneBrokenTrees(b)
  return b
}

export const LEAP_MAPS = [lake, fold, marsh]
for (const make of LEAP_MAPS) {
  const b = make()
  shoreline(b)
  const problems = validate(b)
  // the orchard is deliberately unreachable until the Näkki is fed, and the
  // islet cache is deliberately unreachable by plain walking (only the tree
  // ring/connector, felled, gets you there); the highland lair is
  // deliberately unreachable until the burrow rocks are mined
  const ok = problems.filter(p => !/orchard|pier gap|nakki|islet|lair/.test(p))
  if (ok.length) { console.error(b.name, ok); process.exitCode = 1 }
  fs.writeFileSync(path.join(OUT, `${b.name}.json`), JSON.stringify(b.toJSON()))
  console.log('wrote', b.name, problems.length ? `(expected-unreachable: ${problems.join('; ')})` : '')
}
