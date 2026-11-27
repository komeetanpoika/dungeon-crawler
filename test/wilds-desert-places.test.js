// The wild places in desert dress (renderer/wilds/features.js, sites.js): a
// desert piece's landmark is an oasis ringed with palms, a sandstone pillar,
// a rock arch or the bones of something huge, chosen by a hash of the piece;
// camps pitch tan tents on sand, ruins and watchtowers stand on sand among
// rubble and broken pots, and a cave mouth opens in a sandstone outcrop.
// Which piece gets what, and every record of it, is what it was: only cells
// differ with the desert's dress on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { generatePiece } from '../renderer/wilds/piece.js'
import { mainKind } from '../renderer/wilds/features.js'
import { setDesertDress } from '../renderer/wilds/desert-art.js'
import { isDesert, BEACON_PREFIX } from '../renderer/wilds/desert.js'
import { PIECE, pieceBiome } from '../renderer/wilds/layout.js'
import { WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { TILE } from '../renderer/systems/entities.js'
import { isWaterSkin } from '../renderer/terrain/lib.js'
import { nearCool } from '../renderer/wilds/heat.js'
import { isStructure } from '../renderer/wilds/over.js'
import { classOf, CLASS } from '../renderer/wilds/map.js'

const TILES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'renderer', 'assets', 'tiles')
const SEEDS = [7, 1]
const REACH = 30
// how many of each place the sample holds (spiralling out from home), and of
// those how many are built again with the dress off to compare their records
const WANT = { landmark: 210, camp: 14, ruin: 14, tower: 14, cave: 14 }
const COMPARE = { landmark: 60, camp: 14, ruin: 14, tower: 14, cave: 14 }
const without = fn => { setDesertDress(false); try { return fn() } finally { setDesertDress(true) } }

// Desert pieces whose main thing is one of WANT's kinds and stands on the
// desert's own country, built with the dress on.
let sample = null
function places() {
  if (sample) return sample
  sample = Object.fromEntries(Object.keys(WANT).map(k => [k, []]))
  const full = () => Object.keys(WANT).every(k => sample[k].length >= WANT[k])
  for (const seed of SEEDS) for (let r = 0; r <= REACH && !full(); r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || pieceBiome(seed, wx, wy) !== 'desert') continue
    const kind = mainKind(seed, wx, wy, 0), list = sample[kind]
    if (!list || list.length >= WANT[kind]) continue
    const p = generatePiece(seed, wx, wy, 0)
    if (p.main.kind !== kind || !isDesert(seed, wx * PIECE + p.main.x, wy * PIECE + p.main.y)) continue
    list.push({ seed, wx, wy, p, at: `seed ${seed} ${kind} ${wx},${wy}`, plain: null })
  }
  return sample
}
const plainOf = s => s.plain ??= without(() => generatePiece(s.seed, s.wx, s.wy, 0))

// the cells within Chebyshev distance r of (cx, cy)
const around = (p, cx, cy, r) => {
  const out = []
  for (let y = Math.max(0, cy - r); y <= Math.min(PIECE - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(PIECE - 1, cx + r); x++) out.push({ x, y, c: p.cells[y][x] })
  return out
}
// The walkable cells reached from `from` (cells { x, y }), four ways.
function flood(p, from) {
  const seen = new Uint8Array(PIECE * PIECE), stack = []
  for (const f of from) if (p.cells[f.y]?.[f.x]?.tile === TILE.FLOOR && !seen[f.y * PIECE + f.x]) { seen[f.y * PIECE + f.x] = 1; stack.push(f.y * PIECE + f.x) }
  while (stack.length) {
    const i = stack.pop(), x = i % PIECE, y = (i / PIECE) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * PIECE + nx
      if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen[j] || p.cells[ny][nx].tile !== TILE.FLOOR) continue
      seen[j] = 1; stack.push(j)
    }
  }
  return (x, y) => seen[y * PIECE + x] === 1
}

// What a landmark looks like, by the names of its cells near the main thing
// (the spires and cairns every desert piece holds are none of these).
const LOOKS = { oasis: /^ow_landmark_palm/, pillar: /^ow_landmark_pillar/, arch: /^ow_landmark_arch_/, bones: /^ow_landmark_bones_/ }
const looksOf = p => {
  const seen = new Set()
  for (const { c } of around(p, p.main.x, p.main.y, 7)) for (const [look, re] of Object.entries(LOOKS)) if (re.test(c.overlay ?? '')) seen.add(look)
  return [...seen]
}
const waterNear = (p, r) => around(p, p.main.x, p.main.y, r).filter(({ c }) => isWaterSkin(c.skin))

test('every desert landmark is one of four', () => {
  const L = places().landmark
  assert.ok(L.length >= 200, `only ${L.length} desert landmarks`)
  const count = { oasis: 0, pillar: 0, arch: 0, bones: 0 }
  for (const s of L) {
    const looks = looksOf(s.p)
    assert.equal(looks.length, 1, `${s.at}: ${looks.join(', ') || 'no landmark'}`)
    count[looks[0]]++
    const cells = around(s.p, s.p.main.x, s.p.main.y, 7).filter(({ c }) => LOOKS[looks[0]].test(c.overlay ?? ''))
    assert.ok(cells.some(({ c }) => c.overlay.startsWith(BEACON_PREFIX) && c.losBeacon), `${s.at}: no landmark seen from afar`)
    // no apple tree of the green oasis is left
    assert.ok(!around(s.p, s.p.main.x, s.p.main.y, 6).some(({ c }) => c.overlay === 'ow_tree_apple'), `${s.at}: an apple tree`)
    if (looks[0] === 'oasis') {
      // the oasis keeps its water, where it was
      const water = waterNear(s.p, 2)
      assert.ok(isWaterSkin(s.p.cells[s.p.main.y][s.p.main.x].skin), `${s.at}: no water in the oasis`)
      if (COMPARE.landmark > L.indexOf(s)) assert.equal(water.map(w => `${w.x},${w.y}`).join(' '), waterNear(plainOf(s), 2).map(w => `${w.x},${w.y}`).join(' '), `${s.at}: the pond moved`)
    } else {
      // the others stand on sand (or on the path that runs up to them), with no water
      assert.equal(waterNear(s.p, 2).length, 0, `${s.at}: water by the ${looks[0]}`)
      for (const { x, y, c } of cells) assert.match(c.skin, /^ow_(sand|path_sand_)/, `${s.at}: the ${looks[0]} at ${x},${y} stands on ${c.skin}`)
      // (no grass left of the green oasis's disc, which had a radius of 4)
      for (const { x, y, c } of around(s.p, s.p.main.x, s.p.main.y, 4)) {
        if (Math.hypot(x - s.p.main.x, y - s.p.main.y) <= 3.5) assert.ok(!/^ow_grass/.test(c.skin), `${s.at}: grass at ${x},${y} by the ${looks[0]}`)
      }
    }
  }
  for (const [look, n] of Object.entries(count)) assert.ok(n >= 10, `only ${n} of ${look} in ${L.length}: ${JSON.stringify(count)}`)
})

test('the choice is by hash', () => {
  let n = 0
  for (const s of places().landmark) {
    if (mainKind(s.seed, s.wx, s.wy, 2) !== 'landmark') continue
    const again = generatePiece(s.seed, s.wx, s.wy, 2)
    if (!isDesert(s.seed, s.wx * PIECE + again.main.x, s.wy * PIECE + again.main.y)) continue
    assert.equal(looksOf(again).length, 1, `${s.at}: ${looksOf(again).join(', ') || 'no landmark'} at deal 2`)
    assert.deepEqual(looksOf(again), looksOf(s.p), `${s.at}: another look at deal 2`)
    if (++n >= 25) break
  }
  assert.ok(n >= 10, `only ${n} pieces a landmark at deals 0 and 2`)
})

test('the arch can be walked under', () => {
  let n = 0
  for (const s of places().landmark.filter(s => looksOf(s.p)[0] === 'arch')) {
    const open = around(s.p, s.p.main.x, s.p.main.y, 7).filter(({ c }) => c.overlay === 'ow_landmark_arch_11')
    assert.equal(open.length, 1, `${s.at}: ${open.length} openings`)
    const { x, y, c } = open[0]
    assert.equal(c.tile, TILE.FLOOR, `${s.at}: the arch's opening is blocked`)
    assert.ok(!c.over && !c.losBeacon, `${s.at}: the opening is drawn over the hero, or a beacon`)
    // the arch round it: three cells of span over the opening and a leg either side, all solid and seen from afar
    for (const [dx, dy, name] of [[-1, -1, '00'], [0, -1, '10'], [1, -1, '20'], [-1, 0, '01'], [1, 0, '21']]) {
      const cell = s.p.cells[y + dy][x + dx]
      assert.equal(cell.overlay, `ow_landmark_arch_${name}`, `${s.at}: the arch at ${x + dx},${y + dy}`)
      assert.ok(cell.tile === TILE.WALL && cell.losBeacon, `${s.at}: ${cell.overlay} is not a solid landmark`)
    }
    // walked into from the south, from where the paths meet
    assert.equal(s.p.cells[y + 1][x].tile, TILE.FLOOR, `${s.at}: the way under the arch is blocked`)
    assert.ok(flood(s.p, [s.p.spawnPoint])(x, y), `${s.at}: the opening cannot be reached`)
    n++
  }
  assert.ok(n >= 10, `only ${n} arches`)
})

test('an oasis cools, and its water is to be drunk', () => {
  let n = 0
  for (const s of places().landmark.filter(s => looksOf(s.p)[0] === 'oasis')) {
    const p = s.p
    const water = waterNear(p, 2)
    const feet = around(p, p.main.x, p.main.y, 6).filter(({ c }) => c.overlay === 'ow_landmark_palm')
    assert.ok(feet.length >= 3, `${s.at}: ${feet.length} palms`)
    for (const { x, y, c } of feet) {
      assert.equal(c.tile, TILE.WALL, `${s.at}: the palm at ${x},${y} is walked through`)
      assert.equal(p.cells[y - 1][x].overlay, 'ow_landmark_palm_top', `${s.at}: the palm at ${x},${y} has no crown`)
    }
    for (const { x, y } of water) assert.ok(isWaterSkin(p.cells[y][x].skin))
    // three tiles from a palm's foot, out of the water's own reach, is in the cool
    let shaded = 0
    for (const { x, y } of feet) for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [3, 3], [-3, 3]]) {
      const cx = x + dx, cy = y + dy
      if (water.some(w => Math.max(Math.abs(w.x - cx), Math.abs(w.y - cy)) <= 3)) continue
      assert.ok(nearCool(p.cells, cx, cy), `${s.at}: ${cx},${cy} is three from the palm at ${x},${y} and not cool`)
      shaded++
    }
    assert.ok(shaded > 0, `${s.at}: nowhere to try the palms' shade`)
    // a walkable cell beside the water, reached from where the paths meet
    const reach = flood(p, [p.spawnPoint])
    const bank = water.flatMap(w => around(p, w.x, w.y, 1)).filter(({ x, y, c }) => c.tile === TILE.FLOOR && reach(x, y))
    assert.ok(bank.length > 0, `${s.at}: the water cannot be reached`)
    // reeds by the water, walked over
    for (const { x, y, c } of around(p, p.main.x, p.main.y, 4)) if ((c.overlay ?? '').startsWith('ow_deco_reeds_')) assert.equal(c.tile, TILE.FLOOR, `${s.at}: reeds at ${x},${y} block the way`)
    n++
  }
  assert.ok(n >= 10, `only ${n} oases`)
  assert.ok(places().landmark.some(s => around(s.p, s.p.main.x, s.p.main.y, 4).some(({ c }) => (c.overlay ?? '').startsWith('ow_deco_reeds_'))), 'no reeds by any oasis')
})

// sites.js cave(x, y): the mouth at (x, y) and (x + 1, y), rock in the box
// (x - 4, y - 4)..(x + 5, y + 1), the box's border kept walkable round it
const CAVE_ROCK = [...[-2, -1, 0, 1, 2, 3].map(dx => [dx, -2]), ...[-3, -2, -1, 0, 1, 2, 3, 4].map(dx => [dx, -1]), ...[-3, -2, -1, 2, 3, 4].map(dx => [dx, 0])]
test('desert caves stand in sandstone', () => {
  for (const s of places().cave) {
    const p = s.p, { x, y } = p.caves[0]
    assert.equal(p.caves[1].x, x + 1, `${s.at}: the mouth's two cells`)
    for (const [dx, dy] of CAVE_ROCK) {
      const c = p.cells[y + dy][x + dx]
      assert.ok((c.overlay ?? '').startsWith('ow_outcrop_'), `${s.at}: ${c.overlay} at ${x + dx},${y + dy}, not sandstone`)
      assert.equal(c.tile, TILE.WALL, `${s.at}: the rock at ${x + dx},${y + dy} is walked through`)
    }
    for (const { c, x: cx, y: cy } of around(p, x, y, 6)) {
      if (cx < x - 4 || cx > x + 5 || cy < y - 4 || cy > y + 1) continue
      assert.ok(!(c.overlay ?? '').startsWith('ow_mtn_') && !c.skin.startsWith('ow_mtn_'), `${s.at}: mountain at ${cx},${cy}`)
      assert.ok(!(c.overlay ?? '').startsWith('ow_rock_'), `${s.at}: a boulder at ${cx},${cy}`)
    }
    assert.equal(p.cells[y][x].overlay, 'ow_cave_arch_sand_0', `${s.at}: the mouth`)
    assert.equal(p.cells[y][x + 1].overlay, 'ow_cave_arch_sand_1', `${s.at}: the mouth`)
    // the mouth, and the walk round the rock all the way, reached from the gates
    const reach = flood(p, Object.values(p.gates))
    for (const m of p.caves) assert.ok(reach(m.x, m.y), `${s.at}: the cave at ${m.x},${m.y} cannot be reached`)
    for (let cy = y - 4; cy <= y + 1; cy++) for (let cx = x - 4; cx <= x + 5; cx++) {
      if (cx !== x - 4 && cx !== x + 5 && cy !== y - 4 && cy !== y + 1) continue
      assert.equal(p.cells[cy][cx].tile, TILE.FLOOR, `${s.at}: the walk round the rock is blocked at ${cx},${cy}`)
      assert.ok(reach(cx, cy), `${s.at}: the walk round the rock at ${cx},${cy} cannot be reached`)
    }
  }
  assert.ok(places().cave.length >= 10, `only ${places().cave.length} desert caves`)
})

// The ground the dress lays on a camp's, a ruin's and a watchtower's pad
// (features.js PAD) is sand: no grass, hardpan or dune crest is left on it.
const PAD = { camp: 6, ruin: 8, tower: 8 }
const NOT_SAND = /^ow_(grass|hardpan|dune_|mtn_)/
test('camps, ruins and towers wear the desert', () => {
  let tents = 0
  for (const kind of ['camp', 'ruin', 'tower']) {
    const list = places()[kind]
    assert.ok(list.length >= 10, `only ${list.length} desert ${kind}s`)
    for (const s of list) {
      const p = s.p, { x: mx, y: my } = p.main
      for (const { x, y, c } of around(p, mx, my, PAD[kind])) {
        if ((x - mx) ** 2 + (y - my) ** 2 > PAD[kind] ** 2) continue
        assert.ok(!NOT_SAND.test(c.skin), `${s.at}: ${c.skin} at ${x},${y} on its pad`)
        if ((c.overlay ?? '').startsWith('ow_tent_')) { tents++; assert.ok(c.overlay.startsWith('ow_tent_tan_'), `${s.at}: ${c.overlay} at ${x},${y}`) }
      }
      if (kind === 'camp') continue
      // the ruin's yard: rubble and broken pots half-buried in the sand round the tower
      const door = p.doors.find(d => d.tier === 'ruin')
      assert.ok(door, `${s.at}: no tower`)
      const yard = around(p, door.x, door.y, 7)
      assert.ok(yard.some(({ c }) => c.overlay === 'ow_ruin_rubble' && c.tile === TILE.WALL), `${s.at}: no rubble`)
      const pots = yard.filter(({ c }) => (c.overlay ?? '').startsWith('ow_deco_pottery_'))
      assert.ok(pots.length > 0, `${s.at}: no broken pots`)
      for (const { x, y, c } of pots) assert.equal(c.tile, TILE.FLOOR, `${s.at}: the pot at ${x},${y} blocks the way`)
    }
  }
  assert.ok(tents >= 8, `only ${tents} tent cells in the desert camps`)
})

// What a piece is, apart from its tiles. (Compared as strings, with the first
// difference shown: never a diff of the objects.)
const recordsOf = p => ({
  main: p.main, spawnPoint: p.spawnPoint, road: p.road, coach: p.coach, village: p.village,
  spawns: p.spawns, small: p.small, packs: p.packs, doors: p.doors, caves: p.caves, signs: p.signs, points: p.points, villagePoints: p.villagePoints,
})
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `…${a.slice(Math.max(0, i - 40), i + 60)}… against …${b.slice(Math.max(0, i - 40), i + 60)}…` }
test('every record of a desert place is what it was with the dress off', () => {
  let n = 0
  for (const [kind, list] of Object.entries(places())) for (const s of list.slice(0, COMPARE[kind])) {
    const on = recordsOf(s.p), off = recordsOf(plainOf(s))
    for (const field of Object.keys(on)) {
      const a = JSON.stringify(on[field]), b = JSON.stringify(off[field])
      assert.ok(a === b, `${s.at}: ${field} differs: ${firstDiff(a, b)}`)
    }
    n++
  }
  assert.ok(n >= 100, `only ${n} pieces compared`)
})

// mainKind over 2000 pieces of seed 7, counted at 5fde6cab before this change
// (the desert's dress spends no draw that deals a main thing).
const ODDS = { boss: 179, camp: 208, cave: 209, farmstead: 66, fisher: 22, fold: 21, inn: 47, landmark: 393, mill: 21, orchard: 25, peat: 22, quarry: 26, rest: 73, ring: 1, ruin: 409, shrine: 60, tower: 30, village: 123, well: 65 }
test('the odds are unchanged', () => {
  const counts = {}
  for (let wy = -20; wy < 20; wy++) for (let wx = -25; wx < 25; wx++) { const k = mainKind(7, wx, wy, 0); counts[k] = (counts[k] ?? 0) + 1 }
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(counts).sort())), JSON.stringify(ODDS))
})

test('the new tiles exist, and behave by their names', () => {
  const names = new Set(WILDS_SKINS)
  const fresh = new Set(['ow_landmark_palm_top', 'ow_landmark_palm', 'ow_landmark_pillar_top', 'ow_landmark_pillar',
    ...['00', '10', '20', '01', '11', '21'].map(c => `ow_landmark_arch_${c}`), 'ow_cave_arch_sand_0', 'ow_cave_arch_sand_1'])
  for (const s of places().landmark) for (const { c } of around(s.p, s.p.main.x, s.p.main.y, 7))
    if (/^ow_(landmark_bones_|deco_reeds_)/.test(c.overlay ?? '')) fresh.add(c.overlay)
  assert.ok([...fresh].filter(n => n.startsWith('ow_landmark_bones_')).length >= 8, 'the bones are fewer than eight cells')
  assert.ok([...fresh].some(n => n.startsWith('ow_deco_reeds_')), 'no reeds')
  for (const n of fresh) {
    assert.ok(names.has(n), `${n} is not in WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
    // nothing new is walked behind (over.js), and a landmark is a landmark on the map
    assert.equal(isStructure(n), false, `${n} is walked behind`)
    const cls = classOf({ tile: TILE.WALL, skin: 'ow_sand_0', overlay: n })
    assert.equal(cls === CLASS.landmark, n.startsWith(BEACON_PREFIX), `${n} is on the map as class ${cls}`)
  }
})
