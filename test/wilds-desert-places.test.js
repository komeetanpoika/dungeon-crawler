// The wild places in desert dress (renderer/wilds/features.js, sites.js): a
// desert piece's landmark is an oasis ringed with palms, standing stones,
// a rock arch or the bones of something huge, chosen by a hash of the piece;
// camps pitch striped tents on sand, ruins and watchtowers stand on sand among
// rubble and broken pots, and a cave mouth opens in a sandstone outcrop. By
// the roads, a rest pitches a striped tent with a palm by its fire, a shrine
// is a sandstone stele, the crossroads inn is a caravanserai of mud brick with
// awnings over its front and a shaded pen for its horses, and the farmland's
// date garden grows palms two cells tall.
// Which piece gets what, and every record of it, is what it was: only cells
// differ with the desert's dress on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePiece, cellOf } from '../renderer/wilds/piece.js'
import { dressDesertLandmark, mainKind } from '../renderer/wilds/features.js'
import { setDesertDress } from '../renderer/wilds/desert-art.js'
import { isDesert, BEACON_PREFIX } from '../renderer/wilds/desert.js'
import { PIECE, pieceBiome, villagesNear } from '../renderer/wilds/layout.js'
import { pieceClass } from '../renderer/wilds/roads.js'
import { taleOf } from '../renderer/wilds/tales.js'
import { makeTerrain, WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { TILE } from '../renderer/systems/entities.js'
import { isWaterSkin } from '../renderer/terrain/lib.js'
import { nearCool, tickHeat, HEAT } from '../renderer/wilds/heat.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'
import { isStructure, setOpenTops } from '../renderer/wilds/over.js'
import { classOf, CLASS } from '../renderer/wilds/map.js'
import { houseSpec } from '../renderer/interior/versions.js'
import { generateInterior } from '../renderer/interior/index.js'

const TILES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'assets', 'tiles')
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
const plainOf = s => s.plain ??= without(() => generatePiece(s.seed, s.wx, s.wy, s.deal ?? 0, null, s.tale ?? null))

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
      // the others stand on sand (or on the path that runs up to them: sand, or a dirt trail out of the next country), with no water
      assert.equal(waterNear(s.p, 2).length, 0, `${s.at}: water by the ${looks[0]}`)
      for (const { x, y, c } of cells) assert.match(c.skin, /^ow_(sand|path_sand_|dirt_)/, `${s.at}: the ${looks[0]} at ${x},${y} stands on ${c.skin}`)
      // (no grass left of the green oasis's disc, which had a radius of 4)
      for (const { x, y, c } of around(s.p, s.p.main.x, s.p.main.y, 4)) {
        if (Math.hypot(x - s.p.main.x, y - s.p.main.y) <= 3.5) assert.ok(!/^ow_grass/.test(c.skin), `${s.at}: grass at ${x},${y} by the ${looks[0]}`)
      }
      // the standing stones stand whole: the tall pillar, the shorter one and the stump, six cells
      if (looks[0] === 'pillar') assert.equal(new Set(cells.map(({ c }) => c.overlay)).size, 6, `${s.at}: ${cells.map(({ c }) => c.overlay).join(' ')}`)
      // and no chest stands just north of its top in any column, as if set on top of it
      const tops = new Map()
      for (const { x, y } of cells) if (!tops.has(x) || y < tops.get(x)) tops.set(x, y)
      for (const [x, y] of tops) assert.ok(!s.p.spawns.some(o => o.kind === 'chest' && o.x === x && o.y === y - 1), `${s.at}: a chest on top of the ${looks[0]} at ${x},${y - 1}`)
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
        if ((c.overlay ?? '').startsWith('ow_tent_')) { tents++; assert.ok(c.overlay.startsWith('ow_tent_stripe_'), `${s.at}: ${c.overlay} at ${x},${y}`) }
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
// A house of the desert kit says so in its door's look (`look.wall: 'adobe'`):
// a desert village's houses and the walled well's keeper's house (`houses`
// says which of the piece's doors may be one), and a hut out on desert
// country (sites.js hut: a small hut whose door stands on the desert's
// country). Such a door is put back to the wall its draws gave it, which was
// stone or wood, before the records are compared.
const isDesertHut = (s, d) => d.tier === 'hut' && s.p.small.some(q => q.kind === 'hut' && q.x === d.x && q.y === d.y) && isDesert(s.seed, s.wx * PIECE + d.x, s.wy * PIECE + d.y)
function wallsAsDrawn(s, on, off, houses = () => false) {
  on.doors = on.doors.map((d, i) => {
    if (d.look?.wall !== 'adobe') return d
    const was = off.doors[i]?.look?.wall
    assert.ok((houses(d) || isDesertHut(s, d)) && ['stone', 'wood'].includes(was), `${s.at}: an adobe door at ${d.x},${d.y} (${d.tier}), its wall ${was} with the dress off`)
    return { ...d, look: { ...d.look, wall: was } }
  })
}
test('every record of a desert place is what it was with the dress off', () => {
  let n = 0
  for (const [kind, list] of Object.entries(places())) for (const s of list.slice(0, COMPARE[kind])) {
    const on = recordsOf(s.p), off = recordsOf(plainOf(s))
    wallsAsDrawn(s, on, off)
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
  const fresh = new Set(['ow_landmark_palm_top', 'ow_landmark_palm', ...['10', '11', '12', '01', '02', '22'].map(c => `ow_landmark_pillar_${c}`),
    ...['00', '10', '20', '01', '11', '21'].map(c => `ow_landmark_arch_${c}`), 'ow_cave_arch_sand_0', 'ow_cave_arch_sand_1',
    ...['00', '10', '01', '11'].map(c => `ow_tent_stripe_${c}`)])
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

// A landmark that finds nowhere to stand (never seen in a real piece: here,
// every cell round it is held) is the oasis it was stamped as: its pond and
// its ring of trees are put back, the trees as palms, on the green disc.
test('a landmark with nowhere to stand is an oasis after all', () => {
  const s = places().landmark[0]
  const t = makeTerrain(s.seed, s.wx, s.wy, 0)
  const mx = 40, my = 40
  t.open(mx, my, 7)
  const water = [[-1, 0], [0, 0], [1, 0]].map(([dx, dy]) => ({ x: mx + dx, y: my + dy }))
  for (const { x, y } of water) t.setWater(x, y)
  const trees = [0, 1, 2, 3, 4].map(i => ({ x: mx + Math.round(Math.cos(i / 5 * Math.PI * 2) * 3), y: my + Math.round(Math.sin(i / 5 * Math.PI * 2) * 3) }))
  trees.forEach(({ x, y }, i) => t.setProp(x, y, i % 2 ? 'ow_tree_small' : 'ow_tree_apple'))
  for (const look of ['pillar', 'arch', 'bones']) {
    dressDesertLandmark(t, { look, x: mx, y: my, water, trees, under: new Map() }, () => true, { x: mx, y: my + 2 })
    for (const { x, y } of water) assert.equal(t.kind(x, y), 'water', `${look}: the pond at ${x},${y} is gone`)
    for (const { x, y } of trees) assert.equal(t.propAt(x, y), 'ow_tree_palm_small', `${look}: ${t.propAt(x, y)} at ${x},${y}, not a palm`)
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) assert.ok(!(t.propAt(mx + dx, my + dy) ?? '').startsWith('ow_landmark_'), `${look}: ${t.propAt(mx + dx, my + dy)} at ${mx + dx},${my + dy}`)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.hypot(dx, dy) > 3.5 || t.kind(mx + dx, my + dy) === 'water') continue
      assert.match(t.groundAt(mx + dx, my + dy), /^ow_grass/, `${look}: the oasis's disc at ${mx + dx},${my + dy}`)
    }
  }
})

// ---- by the desert's roads --------------------------------------------------------------
// The rests, shrines and crossroads inns of desert roadside pieces, and the
// walled wells of desert farmland, on seeds 7, 42 and 1: for each piece of
// the right class near home whose country is desert, the first deal up to
// WAYSIDE_DEALS that deals the kind, kept where its main thing stands on the
// desert's own country (an inn only where it is the big one, nine wide).
// Built once, with the dress on.
const WAYSIDE_SEEDS = [7, 42, 1]
const WAYSIDE_WANT = { rest: 4, shrine: 4, inn: 4, well: 4 }   // of each, a seed
const WAYSIDE_DEALS = 15, WAYSIDE_REACH = 16
let roadSample = null
function wayside() {
  if (roadSample) return roadSample
  roadSample = Object.fromEntries(Object.keys(WAYSIDE_WANT).map(k => [k, []]))
  for (const seed of WAYSIDE_SEEDS) {
    const got = Object.fromEntries(Object.keys(WAYSIDE_WANT).map(k => [k, 0]))
    const full = () => Object.keys(WAYSIDE_WANT).every(k => got[k] >= WAYSIDE_WANT[k])
    for (let r = 1; r <= WAYSIDE_REACH && !full(); r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
      if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || pieceBiome(seed, wx, wy) !== 'desert') continue
      const cls = pieceClass(seed, wx, wy)
      for (const kind of Object.keys(WAYSIDE_WANT)) {
        if (got[kind] >= WAYSIDE_WANT[kind] || cls !== (kind === 'well' ? 'farmland' : 'roadside')) continue
        let deal = 0
        while (deal <= WAYSIDE_DEALS && mainKind(seed, wx, wy, deal) !== kind) deal++
        if (deal > WAYSIDE_DEALS) continue
        const p = generatePiece(seed, wx, wy, deal)
        if (p.main.kind !== kind || !isDesert(seed, wx * PIECE + p.main.x, wy * PIECE + p.main.y)) continue
        if (kind === 'inn' && p.doors.find(d => d.kind === 'inn')?.look.w !== 9) continue
        roadSample[kind].push({ seed, wx, wy, deal, p, at: `seed ${seed} ${kind} ${wx},${wy} deal ${deal}`, plain: null })
        got[kind]++
      }
    }
  }
  return roadSample
}
const PALM_FOOT = 'ow_tree_palm', PALM_CROWN = 'ow_tree_palm_top', PALM_ONE = 'ow_tree_palm_small'
const innDoor = p => p.doors.find(d => d.kind === 'inn')

test('desert rests, shrines and inns wear the desert', () => {
  const W = wayside()
  for (const kind of ['rest', 'shrine', 'inn']) assert.ok(W[kind].length >= 10, `only ${W[kind].length} desert ${kind}s`)
  // a rest: a striped tent and a palm by its fire, on its pad of sand
  let tall = 0
  for (const s of W.rest) {
    const p = s.p, { x: mx, y: my } = p.main
    let tents = 0
    for (const { x, y, c } of around(p, mx, my, 7)) {
      if ((x - mx) ** 2 + (y - my) ** 2 <= 25) assert.ok(!NOT_SAND.test(c.skin), `${s.at}: ${c.skin} at ${x},${y} on its pad`)
      if ((c.overlay ?? '').startsWith('ow_tent_')) { tents++; assert.ok(c.overlay.startsWith('ow_tent_stripe_'), `${s.at}: ${c.overlay} at ${x},${y}`) }
    }
    assert.equal(tents, 4, `${s.at}: ${tents} cells of tent`)
    const fire = p.spawns.find(o => o.kind === 'campfire')
    assert.ok(fire, `${s.at}: no fire`)
    const palms = around(p, fire.x, fire.y, 2).filter(({ c }) => c.overlay === PALM_FOOT || c.overlay === PALM_ONE)
    assert.equal(palms.length, 1, `${s.at}: ${palms.length} palms by the fire at ${fire.x},${fire.y}`)
    const { x, y, c } = palms[0]
    assert.equal(c.tile, TILE.WALL, `${s.at}: the palm at ${x},${y} is walked through`)
    if (c.overlay === PALM_FOOT) {
      assert.ok(p.cells[y - 1][x].overlay === PALM_CROWN && p.cells[y - 1][x].tile === TILE.WALL, `${s.at}: the palm at ${x},${y} has no crown`)
      tall++
    }
  }
  assert.ok(tall >= W.rest.length * 0.75, `only ${tall} of ${W.rest.length} rests have a palm two cells tall`)

  // a shrine: a sandstone stele on sand paving, its flowers and its chest, on its pad of sand
  for (const s of W.shrine) {
    const p = s.p, { x: mx, y: my } = p.main
    const near = around(p, mx, my, 8)
    assert.ok(!near.some(({ c }) => (c.overlay ?? '').startsWith('ow_statue')), `${s.at}: the green shrine's statue`)
    const feet = near.filter(({ c }) => c.overlay === 'ow_prop_stele')
    assert.equal(feet.length, 1, `${s.at}: ${feet.length} steles`)
    const { x, y, c } = feet[0], top = p.cells[y - 1][x]
    assert.equal(top.overlay, 'ow_prop_stele_top', `${s.at}: the stele at ${x},${y} has no top`)
    for (const cell of [c, top]) assert.ok(cell.tile === TILE.WALL && cell.losClear, `${s.at}: the stele is walked through or hides what is behind it`)
    assert.ok(around(p, x, y, 2).some(({ c }) => c.skin.startsWith('ow_pave_sand')), `${s.at}: no paving round the stele`)
    assert.ok(near.some(({ c }) => (c.overlay ?? '').startsWith('ow_deco_bloom_')), `${s.at}: no flowers`)
    assert.ok(p.spawns.some(o => o.kind === 'chest' && Math.hypot(o.x - x, o.y - y) <= 6), `${s.at}: no chest`)
    for (const { x: cx, y: cy, c: cell } of around(p, mx, my, 5)) if ((cx - mx) ** 2 + (cy - my) ** 2 <= 25) assert.ok(!NOT_SAND.test(cell.skin), `${s.at}: ${cell.skin} at ${cx},${cy} on its pad`)
  }

  // the inn: a caravanserai of mud brick nine wide, awnings over its front, its horses in a shaded pen
  let awned = 0
  for (const s of W.inn) {
    const p = s.p, door = innDoor(p)
    assert.equal(JSON.stringify(door.look), JSON.stringify({ w: 9, storeys: 2, wall: 'plaster' }), `${s.at}: the inn's look`)
    const x0 = door.x - 4, x1 = door.x + 4, top = door.y - 3
    const ov = (x, y) => p.cells[y][x].overlay ?? '', deco = (x, y) => p.cells[y][x].deco ?? ''
    for (let x = x0; x <= x1; x++) {
      assert.match(ov(x, top), /^ow_roof_adobe_/, `${s.at}: the roof at ${x},${top}`)
      assert.match(ov(x, top + 1), /^ow_roof_adobe_/, `${s.at}: the roof's front at ${x},${top + 1}`)
      assert.match(ov(x, top + 2) === 'ow_city_sign_inn' ? deco(x, top + 2) : ov(x, top + 2), /^ow_house_adobe_up/, `${s.at}: the upper storey at ${x},${top + 2}`)
      assert.match(ov(x, door.y), /^ow_house_adobe_/, `${s.at}: the ground floor at ${x},${door.y}`)
      assert.ok(!/^ow_(house|roof|city_house|city_roof)_/.test(ov(x, door.y + 1)), `${s.at}: something of the house below it at ${x}`)
    }
    assert.ok(ov(x0, door.y) === 'ow_house_adobe_wall_l' && ov(x1, door.y) === 'ow_house_adobe_wall_r', `${s.at}: the inn is not nine wide`)
    assert.ok(/^ow_house_adobe_gate/.test(ov(door.x, door.y)) && p.cells[door.y][door.x].tile === TILE.FLOOR, `${s.at}: the door is ${ov(door.x, door.y)}, not the gateway walked into`)
    assert.ok([door.x - 1, door.x + 1].some(x => ov(x, door.y - 1) === 'ow_city_sign_inn'), `${s.at}: no inn sign beside the door`)
    const yard = around(p, door.x, door.y, 14)
    for (const { x, y, c } of yard) assert.ok(!/^ow_(city_house_|city_roof_|house_stable_)/.test(c.overlay ?? '') && !/^ow_(city_house_|house_stable_)/.test(c.deco ?? ''), `${s.at}: ${c.overlay}/${c.deco} of Kalevanlinna's house or stable at ${x},${y}`)
    // the pen: two or three horses in a row under its shade, the trough, hay and the cart by it
    const horses = yard.filter(({ c }) => /^ow_prop_horse_[ew]$/.test(c.overlay ?? ''))
    assert.ok(horses.length >= 2 && horses.length <= 3, `${s.at}: ${horses.length} horses`)
    for (const { x, y, c } of horses) {
      assert.match(c.deco ?? '', /^ow_prop_pen_[lmr]$/, `${s.at}: the horse at ${x},${y} is not in the pen`)
      assert.match(ov(x, y - 1), /^ow_prop_pen_front_[lmr]$/, `${s.at}: no shade over the horse at ${x},${y}`)
      assert.match(ov(x, y - 2), /^ow_prop_pen_top_[lmr]$/, `${s.at}: no shade over the horse at ${x},${y}`)
      assert.equal(c.tile, TILE.WALL, `${s.at}: the horse at ${x},${y} is walked through`)
    }
    const pen = yard.filter(({ c }) => /^ow_prop_pen_[lmr]$/.test(c.overlay ?? '') || /^ow_prop_pen_[lmr]$/.test(c.deco ?? ''))
    assert.ok(pen.length >= 3 && pen.every(q => q.y === horses[0].y), `${s.at}: ${pen.length} cells of pen`)
    // the stable hand outside (two lines of his own, hearing of no town), by the pen
    const hands = p.spawns.filter(o => o.kind === 'npc' && o.species === 'villager' && Array.isArray(o.lines) && o.lines.length === 2 && !o.hears && Math.hypot(o.x - door.x, o.y - door.y) <= 16)
    assert.equal(hands.length, 1, `${s.at}: ${hands.length} stable hands`)
    assert.ok(pen.some(c => Math.hypot(c.x - hands[0].x, c.y - hands[0].y) <= 4), `${s.at}: the stable hand at ${hands[0].x},${hands[0].y} is not by the pen`)
    assert.ok(yard.some(({ c }) => c.overlay === 'ow_prop_trough'), `${s.at}: no trough`)
    assert.ok(yard.some(({ c }) => /^ow_prop_hay_/.test(c.overlay ?? '')), `${s.at}: no hay`)
    assert.ok(yard.some(({ x, y, c }) => c.overlay === 'ow_prop_city_cart_horse' && ov(x + 1, y) === 'ow_prop_city_cart'), `${s.at}: no cart`)
    // the awnings: before the front either side of the doorstep, a row of cloth over a row of its front edge, low things;
    // three columns wide, or the two by the doorstep
    const cloth = yard.filter(({ c }) => (c.overlay ?? '').startsWith('ow_prop_awning_'))
    for (const { x, y, c } of cloth) {
      assert.ok((y === door.y + 1 || y === door.y + 2) && x >= x0 && x <= x1 && Math.abs(x - door.x) >= 2, `${s.at}: an awning at ${x},${y}`)
      assert.ok(c.tile === TILE.WALL && c.losClear, `${s.at}: the awning at ${x},${y} is walked through or hides what is behind it`)
      assert.match(ov(x, y === door.y + 1 ? y + 1 : y - 1), /^ow_prop_awning_/, `${s.at}: the awning at ${x},${y} is half of one`)
    }
    for (const side of [-1, 1]) {
      const cols = new Set(cloth.filter(q => Math.sign(q.x - door.x) === side).map(q => Math.abs(q.x - door.x)))
      assert.ok([[], [2, 3], [2, 3, 4]].some(w => w.length === cols.size && w.every(d => cols.has(d))), `${s.at}: an awning before columns ${[...cols]} on the ${side < 0 ? 'west' : 'east'}`)
    }
    if (cloth.length) awned++
    // the yard before it is sand
    for (const { x, y, c } of around(p, door.x, door.y + 3, 2)) assert.ok(!NOT_SAND.test(c.skin), `${s.at}: ${c.skin} at ${x},${y} before the inn`)
  }
  assert.ok(awned >= W.inn.length * 0.75, `only ${awned} of ${W.inn.length} desert inns have an awning`)
})

test('the inn is the same inn', () => {
  for (const s of wayside().inn) {
    const on = s.p, off = plainOf(s), dOn = innDoor(on), dOff = innDoor(off)
    assert.ok(JSON.stringify(dOn) === JSON.stringify(dOff), `${s.at}: the door differs: ${firstDiff(JSON.stringify(dOn), JSON.stringify(dOff))}`)
    // the innkeeper and the guests, inside
    const inside = d => JSON.stringify(generateInterior(houseSpec(d, { worldSeed: s.seed })).entitySpawns.filter(o => o.kind === 'npc'))
    const a = inside(dOn), b = inside(dOff)
    assert.ok(a === b, `${s.at}: the people inside differ: ${firstDiff(a, b)}`)
    assert.ok(JSON.parse(a).some(o => o.id.endsWith(':keeper')), `${s.at}: no innkeeper`)
    // the stable hand, outside
    const hand = p => JSON.stringify(p.spawns.filter(o => o.kind === 'npc' && o.species === 'villager' && Math.hypot(o.x - dOn.x, o.y - dOn.y) <= 16))
    assert.ok(hand(on) === hand(off), `${s.at}: the stable hand differs: ${firstDiff(hand(on), hand(off))}`)
    assert.ok(hand(on) !== '[]', `${s.at}: no stable hand`)
  }
})

// The smaller inn, where the roads leave no room for the big one (6 of 137
// desert inns in the probe): in the desert its house is of mud brick and its
// yard walled with it, but its door record keeps the wall the draws gave it,
// so it and the house inside are what they are with the dress off. Four
// known ones, two of wood and two of stone.
const SMALL_INNS = [[7, 4, 0, 8], [1, 6, -2, 3], [7, 12, 9, 0], [1, 5, -1, 10]]
test('the smaller desert inn is of mud brick, and the same inn', () => {
  const walls = new Set()
  for (const [seed, wx, wy, deal] of SMALL_INNS) {
    const s = { seed, wx, wy, deal, p: generatePiece(seed, wx, wy, deal), at: `seed ${seed} small inn ${wx},${wy} deal ${deal}`, plain: null }
    const p = s.p, door = innDoor(p), plain = plainOf(s)
    assert.ok(p.main.kind === 'inn' && isDesert(seed, wx * PIECE + p.main.x, wy * PIECE + p.main.y), `${s.at}: not an inn in the desert`)
    assert.ok(door.look.w === 5 && door.look.storeys === 2, `${s.at}: not the smaller inn: ${JSON.stringify(door.look)}`)
    // its record says the wall the draws gave it, not the kit it is built of
    assert.ok(['stone', 'wood'].includes(door.look.wall), `${s.at}: the inn's look is ${JSON.stringify(door.look)}`)
    walls.add(door.look.wall)
    // every record of the piece is what it was with the dress off, its door included
    // (but a hut out on desert country, whose door says it is of the desert kit)
    const on = recordsOf(p), off = recordsOf(plain)
    wallsAsDrawn(s, on, off)
    for (const field of Object.keys(on)) {
      const a = JSON.stringify(on[field]), b = JSON.stringify(off[field])
      assert.ok(a === b, `${s.at}: ${field} differs: ${firstDiff(a, b)}`)
    }
    // and so is the house inside
    const spec = d => JSON.stringify(houseSpec(d, { worldSeed: seed }))
    assert.ok(spec(door) === spec(innDoor(plain)), `${s.at}: another house inside`)
    // built of mud brick, its yard walled with it (round the place's middle: a house a path runs
    // under moves a few cells off, its yard stays)
    assert.match(p.cells[door.y][door.x].overlay ?? '', /^ow_house_adobe_(door|dbl)/, `${s.at}: the door`)
    const yard = [...around(p, p.main.x, p.main.y, 10), ...around(p, door.x, door.y, 6)]
    assert.ok(yard.filter(({ c }) => (c.overlay ?? '').startsWith('ow_prop_wall_sand')).length >= 4, `${s.at}: no mud-brick wall round its yard`)
    assert.ok(!yard.some(({ c }) => /^ow_(fence_|house_wall|house_win|house_door|roof_(red|blue))/.test(c.overlay ?? '')), `${s.at}: Tiny Town's fence or house by the inn`)
  }
  assert.equal(walls.size, 2, `the small inns are all of ${[...walls]}`)
})

test('the inn opens behind', () => {
  for (const s of wayside().inn) {
    const p = s.p, door = innDoor(p), top = door.y - 3
    const shut = (() => { setOpenTops(false); try { return generatePiece(s.seed, s.wx, s.wy, s.deal) } finally { setOpenTops(true) } })()
    for (let x = door.x - 4; x <= door.x + 4; x++) {
      const c = p.cells[top][x]
      assert.ok(c.over === true && c.tile === TILE.FLOOR && (c.overlay ?? '').startsWith('ow_roof_adobe_'), `${s.at}: the inn's roof at ${x},${top} (${c.overlay}) is not walked under`)
      assert.equal(shut.cells[top][x].tile, TILE.WALL, `${s.at}: the roof at ${x},${top} is open with the tops shut`)
      for (let y = top + 1; y <= door.y; y++) if (y !== door.y || x !== door.x) assert.ok(!p.cells[y][x].over && p.cells[y][x].tile === TILE.WALL, `${s.at}: the inn at ${x},${y}`)
    }
    // its pen and its awnings are low things, never walked under
    for (const { x, y, c } of around(p, door.x, door.y, 14)) if (/^ow_prop_(pen|awning)_/.test(c.overlay ?? '')) assert.ok(!c.over && c.tile === TILE.WALL, `${s.at}: ${c.overlay} at ${x},${y} is walked under`)
  }
})

// The walled well of desert farmland: its keeper's house of the desert kit
// (its door says so, as a desert village's do: the house inside is the same),
// its wall of mud brick turning its corners, and its date palms two cells tall.
const ADOBE = /^ow_(roof|house)_adobe_/
test("the desert farmland's walled well is of mud brick, its date palms two cells tall", () => {
  let tall = 0
  const farms = wayside().well
  assert.ok(farms.length >= 10, `only ${farms.length} desert wells`)
  for (const s of farms) {
    const p = s.p, { x: mx, y: my } = p.main, plain = plainOf(s)
    // the keeper's house: adobe from its roof to its door, its door record the same but for its look's wall
    const i = p.doors.findIndex(o => o.tier === 'safe' && Math.hypot(o.x - mx, o.y - my) <= 6)
    assert.ok(i >= 0, `${s.at}: no keeper's house`)
    const d = p.doors[i], was = plain.doors[i]
    assert.equal(d.look.wall, 'adobe', `${s.at}: the house's look is ${JSON.stringify(d.look)}`)
    assert.ok(['stone', 'wood'].includes(was.look.wall), `${s.at}: with the dress off the house's look is ${JSON.stringify(was.look)}`)
    const spec = door => houseSpec(door, { worldSeed: s.seed })
    assert.equal(JSON.stringify(spec(d)), JSON.stringify(spec(was)), `${s.at}: another house inside`)
    const dcol = d.look.w === 3 ? 1 : 2
    for (let y = d.y - d.look.storeys - 1; y <= d.y; y++) for (let x = d.x - dcol; x < d.x - dcol + d.look.w; x++)
      assert.match(p.cells[y][x].overlay ?? '', ADOBE, `${s.at}: ${p.cells[y][x].overlay} at ${x},${y} of the house at ${d.x},${d.y}`)
    // its wall: the pieces a fence would have, in mud brick, round its box; nothing of it inside
    const wall = around(p, mx, my, 8).filter(({ c }) => (c.overlay ?? '').startsWith('ow_prop_wall_sand'))
    assert.ok(wall.length >= 24, `${s.at}: ${wall.length} cells of wall`)
    const X0 = Math.min(...wall.map(q => q.x)), X1 = Math.max(...wall.map(q => q.x)), Y0 = Math.min(...wall.map(q => q.y)), Y1 = Math.max(...wall.map(q => q.y))
    assert.ok(X1 - X0 === 8 && Y1 - Y0 === 8, `${s.at}: a wall ${X1 - X0 + 1} by ${Y1 - Y0 + 1}`)
    for (const { x, y, c } of wall) {
      const side = x === X0 ? 'l' : x === X1 ? 'r' : '', end = y === Y0 ? 't' : y === Y1 ? 'b' : ''
      assert.ok(side || end, `${s.at}: wall inside the garden at ${x},${y}`)
      assert.equal(c.overlay, side ? (end ? `ow_prop_wall_sand_${end}${side}` : 'ow_prop_wall_sand_v') : 'ow_prop_wall_sand', `${s.at}: the wall at ${x},${y}`)
      assert.equal(c.tile, TILE.WALL, `${s.at}: the wall at ${x},${y} is walked through`)
    }
    // the same cells walled, the same gaps, as with the dress off
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      if (x !== X0 && x !== X1 && y !== Y0 && y !== Y1) continue
      const on = (p.cells[y][x].overlay ?? '').startsWith('ow_prop_wall_sand'), off = (plain.cells[y][x].overlay ?? '').startsWith('ow_prop_wall_sand')
      assert.equal(on, off, `${s.at}: the wall at ${x},${y} ${on ? 'stands' : 'is gone'} with the dress on`)
    }
    // the date palms inside it
    let mine = 0
    for (const { x, y, c } of around(p, mx, my, 8)) {
      if (x <= X0 || x >= X1 || y <= Y0 || y >= Y1) continue
      if (c.overlay === PALM_FOOT) {
        const crown = p.cells[y - 1][x]
        assert.ok(crown.overlay === PALM_CROWN && crown.tile === TILE.WALL && c.tile === TILE.WALL, `${s.at}: the palm at ${x},${y} has no crown`)
        mine++
      }
    }
    if (mine) tall++
  }
  assert.ok(tall >= farms.length * 0.75, `only ${tall} of ${farms.length} date gardens have a palm two cells tall`)
})

test('every record of a desert wayside place is what it was with the dress off', () => {
  let n = 0
  for (const list of Object.values(wayside())) for (const s of list) {
    const on = recordsOf(s.p), off = recordsOf(plainOf(s))
    // (a house of the desert kit says so in its door's look, as a desert village's
    // houses do: of these places only the walled well's keeper's house is one, and
    // a hut out on desert country; the inns keep theirs)
    wallsAsDrawn(s, on, off, d => s.p.main.kind === 'well' && d.tier === 'safe')
    for (const field of Object.keys(on)) {
      const a = JSON.stringify(on[field]), b = JSON.stringify(off[field])
      assert.ok(a === b, `${s.at}: ${field} differs: ${firstDiff(a, b)}`)
    }
    n++
  }
  assert.ok(n >= 40, `only ${n} pieces compared`)
})

test("the wayside's new tiles exist, and behave by their names", () => {
  const names = new Set(WILDS_SKINS)
  const low = ['ow_prop_stele_top', 'ow_prop_stele',
    ...[0, 1].flatMap(c => ['l', 'm', 'r'].flatMap(e => [`ow_prop_awning_${c}_${e}`, `ow_prop_awning_${c}_front_${e}`])),
    ...['l', 'm', 'r'].flatMap(e => [`ow_prop_pen_top_${e}`, `ow_prop_pen_front_${e}`, `ow_prop_pen_${e}`])]
  const house = ['ow_house_adobe_up', 'ow_house_adobe_up_arch', 'ow_house_adobe_gate', 'ow_house_adobe_gate_blue']
  for (const n of [...low, ...house]) {
    assert.ok(names.has(n), `${n} is not in WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
  }
  // the stele, the awnings and the pen are low things: they block the way
  // and not the sight, are never walked behind, and the map shows the ground under them
  for (const n of low) {
    assert.ok(cellOf('ow_sand_0', n, false).losClear, `${n} hides what is behind it`)
    assert.equal(isStructure(n), false, `${n} is walked behind`)
    assert.equal(classOf({ tile: TILE.WALL, skin: 'ow_sand_0', overlay: n }), CLASS.sand, `${n} is on the map`)
  }
  // the inn's own pieces of the house are the house's: walked behind, a building on the map
  for (const n of house) {
    assert.equal(isStructure(n), true, `${n} is not walked behind`)
    assert.equal(classOf({ tile: TILE.WALL, skin: 'ow_sand_0', overlay: n }), CLASS.building, `${n} is not a building on the map`)
  }
})

// ---- the desert's names on its places' cells ---------------------------------------------
// A desert place lays the desert's own name where a green one lays a forest
// prop or grey stone (sites.js DESERT_NAMES): the same cell, blocked or
// walked on as before, seen over or not as before, walked behind or not as
// before, on the map in the same colour; only its name, and so its picture,
// is the desert's. A desert village's sheep fold (the fold tale) is walled in
// mud brick as its date garden is, and a hut out on desert country is a house
// of the desert kit.
const SWAPS = {
  ow_prop_woodpile: 'ow_prop_amphora',
  ow_prop_stump_0: 'ow_prop_pots_0', ow_prop_stump_1: 'ow_prop_pots_1', ow_prop_stump_axe: 'ow_prop_pots_2',
  ow_prop_log: 'ow_prop_rug_roll',
  ow_prop_city_planter_0: 'ow_prop_planter_sand_0', ow_prop_city_planter_1: 'ow_prop_planter_sand_1',
  ow_well_top: 'ow_well_sand_top', ow_well: 'ow_well_sand',
  ow_brick: 'ow_brick_sand',
  ow_castle_parapet_l: 'ow_castle_parapet_sand_l', ow_castle_parapet_m: 'ow_castle_parapet_sand_m', ow_castle_parapet_r: 'ow_castle_parapet_sand_r',
  ow_roof_gray_l: 'ow_roof_gray_sand_l', ow_roof_gray_m: 'ow_roof_gray_sand_m', ow_roof_gray_r: 'ow_roof_gray_sand_r',
  ow_roof_slate_l: 'ow_roof_slate_sand_l', ow_roof_slate_m: 'ow_roof_slate_sand_m', ow_roof_slate_r: 'ow_roof_slate_sand_r',
  ow_house_wall_stone_l: 'ow_house_wall_stone_sand_l', ow_house_wall_stone_r: 'ow_house_wall_stone_sand_r',
  ow_house_arch_stone: 'ow_house_arch_stone_sand',
}
const OLD_OF = Object.fromEntries(Object.entries(SWAPS).map(([o, n]) => [n, o]))
const isOld = n => typeof n === 'string' && (n in SWAPS || n.startsWith('ow_fence_'))

// The sample: the desert villages within DESERT_VILLAGE_REACH pieces of home
// on seeds 7, 42 and 1 (each built for its own tale), the desert camps, ruins
// and watchtowers of places() (seeds 7 and 1) and MORE_42 more of each of
// seed 42, the wayside places of wayside() with the four smaller inns, and of
// each of seeds 7, 42 and 1 the first A_SEED wild or roadside desert pieces
// out from home with a hut on desert country, and the first A_SEED with a
// boss's lair whose middle is desert.
const DESERT_VILLAGE_REACH = 10
const MORE_42 = 5
const A_SEED = 4
const desertHuts = s => s.p.small.filter(q => q.kind === 'hut' && isDesert(s.seed, s.wx * PIECE + q.x, s.wy * PIECE + q.y))
let named = null
function desertNamed() {
  if (named) return named
  const villages = []
  for (const seed of WAYSIDE_SEEDS) for (const v of villagesNear(seed, 0, 0, DESERT_VILLAGE_REACH)) {
    if (v.wx === 0 && v.wy === 0) continue
    const tale = taleOf(seed, v), p = generatePiece(seed, v.wx, v.wy, 0, null, tale)
    if (!isDesert(seed, v.wx * PIECE + p.village.x, v.wy * PIECE + p.village.y)) continue
    villages.push({ seed, wx: v.wx, wy: v.wy, tale, p, at: `seed ${seed} village ${v.wx},${v.wy} (${tale})`, plain: null })
  }
  const more = { camp: [], ruin: [], tower: [] }
  for (let r = 1; r <= REACH && Object.values(more).some(l => l.length < MORE_42); r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || pieceBiome(42, wx, wy) !== 'desert') continue
    const kind = mainKind(42, wx, wy, 0)
    if (!more[kind] || more[kind].length >= MORE_42) continue
    const p = generatePiece(42, wx, wy, 0)
    if (p.main.kind === kind && isDesert(42, wx * PIECE + p.main.x, wy * PIECE + p.main.y)) more[kind].push({ seed: 42, wx, wy, p, at: `seed 42 ${kind} ${wx},${wy}`, plain: null })
  }
  const W = wayside()
  const small = SMALL_INNS.map(([seed, wx, wy, deal]) => ({ seed, wx, wy, deal, p: generatePiece(seed, wx, wy, deal), at: `seed ${seed} small inn ${wx},${wy} deal ${deal}`, plain: null }))
  const hut = [], lair = []
  for (const seed of WAYSIDE_SEEDS) {
    let h = 0, l = 0
    for (let r = 2; r <= REACH && (h < A_SEED || l < A_SEED); r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
      if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || pieceBiome(seed, wx, wy) !== 'desert' || !['wild', 'roadside'].includes(pieceClass(seed, wx, wy))) continue
      const boss = mainKind(seed, wx, wy, 0) === 'boss'
      if (h >= A_SEED && !(boss && l < A_SEED)) continue
      const s = { seed, wx, wy, p: generatePiece(seed, wx, wy, 0), plain: null }
      if (boss && l < A_SEED && s.p.main.kind === 'boss' && isDesert(seed, wx * PIECE + s.p.main.x, wy * PIECE + s.p.main.y)) { lair.push({ ...s, at: `seed ${seed} lair ${wx},${wy}` }); l++ }
      if (h < A_SEED && desertHuts(s).length) { hut.push({ ...s, at: `seed ${seed} hut piece ${wx},${wy}` }); h++ }
    }
  }
  named = {
    village: villages, camp: [...places().camp, ...more.camp], ruin: [...places().ruin, ...more.ruin], tower: [...places().tower, ...more.tower],
    rest: W.rest, inn: [...W.inn, ...small], well: W.well, hut, lair,
  }
  return named
}
// every cell of a piece but those of its huts that stand off the desert's
// country (a green hut on a desert piece is no desert place: its house and its
// woodpile stay green)
function placeCells(s) {
  const huts = s.p.small.filter(q => q.kind === 'hut' && !desertHuts(s).includes(q))
  const out = []
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    if (huts.some(h => Math.max(Math.abs(h.x - x), Math.abs(h.y - y)) <= 6)) continue
    out.push({ x, y, c: s.p.cells[y][x] })
  }
  return out
}
// The cells of a hut's house, its door at (d.x, d.y): along the door's row while
// the wall runs on, and up while it is house art (as the desert village's test finds them).
const isHouseArt = n => typeof n === 'string' && (n.startsWith('ow_house_') || n.startsWith('ow_roof_'))
function houseCells(p, d) {
  let x0 = d.x, x1 = d.x, top = d.y
  while (isHouseArt(p.cells[d.y][x0 - 1]?.overlay)) x0--
  while (isHouseArt(p.cells[d.y][x1 + 1]?.overlay)) x1++
  while (isHouseArt(p.cells[top - 1]?.[d.x]?.overlay)) top--
  const out = []
  for (let y = top; y <= d.y; y++) for (let x = x0; x <= x1; x++) out.push({ x, y })
  return out
}

test('desert places hold no forest props', () => {
  const S = desertNamed()
  for (const [kind, list] of Object.entries(S)) {
    assert.ok(list.length >= 10, `only ${list.length} desert ${kind}s`)
    for (const s of list) for (const { x, y, c } of placeCells(s))
      for (const n of [c.overlay, c.deco]) assert.ok(!isOld(n), `${s.at}: ${n} at ${x},${y}`)
  }
  assert.ok(S.village.some(s => s.tale === 'fold'), 'no desert village built for the fold tale')
  // a desert hut is a house of the desert kit, its door saying so
  for (const s of S.hut) for (const h of desertHuts(s)) {
    const d = s.p.doors.find(o => o.x === h.x && o.y === h.y)
    assert.ok(d && d.tier === 'hut' && d.look.wall === 'adobe', `${s.at}: the hut at ${h.x},${h.y}: ${JSON.stringify(d)}`)
    for (const { x, y } of houseCells(s.p, d)) assert.match(s.p.cells[y][x].overlay ?? '', /^ow_(roof|house)_adobe_/, `${s.at}: the hut at ${h.x},${h.y} at ${x},${y}`)
  }
})

const sameCell = (a, b) => a.tile === b.tile && !!a.over === !!b.over && !!a.losClear === !!b.losClear && !!a.losSoft === !!b.losSoft && !!a.losTall === !!b.losTall && !!a.losBeacon === !!b.losBeacon
const cellText = c => `${c.overlay}/${c.deco ?? ''} tile ${c.tile}${c.over ? ' over' : ''}${c.losClear ? ' clear' : ''}${c.losSoft ? ' soft' : ''}${c.losTall ? ' tall' : ''}${c.losBeacon ? ' beacon' : ''}`
test('a swap changes the name and nothing else', () => {
  const swapped = Object.fromEntries(Object.keys(SWAPS).map(o => [o, 0])), seen = new Set()
  let pen = 0, hutCells = 0
  for (const [kind, list] of Object.entries(desertNamed())) for (const s of list) {
    const plain = plainOf(s)
    for (const { x, y, c } of placeCells(s)) {
      const was = plain.cells[y][x]
      for (const layer of ['overlay', 'deco']) {
        if (was[layer] in SWAPS) seen.add(was[layer])
        const old = OLD_OF[c[layer]]
        if (!old) continue
        assert.equal(was[layer], old, `${s.at}: ${c[layer]} at ${x},${y} was ${was[layer]}`)
        assert.ok(sameCell(c, was), `${s.at}: at ${x},${y} ${cellText(c)} against ${cellText(was)}`)
        swapped[old]++
      }
    }
    // the fold's pen, south-east of the square: mud brick where the fence was, on the same cells
    if (kind === 'village' && s.tale === 'fold') {
      const { x: cx, y: cy } = s.p.village
      for (let y = cy + 8; y <= cy + 11; y++) for (let x = cx + 7; x <= cx + 11; x++) {
        const c = s.p.cells[y][x], was = plain.cells[y][x], mud = (c.overlay ?? '').startsWith('ow_prop_wall_sand')
        assert.equal(mud, (was.overlay ?? '').startsWith('ow_fence_'), `${s.at}: the pen at ${x},${y} is ${c.overlay}, was ${was.overlay}`)
        if (!mud) continue
        assert.ok(sameCell(c, was), `${s.at}: the pen at ${x},${y} ${cellText(c)} against ${cellText(was)}`)
        pen++
      }
    }
    // a desert hut's house: the desert kit where Tiny Town's stood, cell for cell
    for (const h of desertHuts(s)) for (const { x, y } of houseCells(s.p, s.p.doors.find(o => o.x === h.x && o.y === h.y))) {
      const c = s.p.cells[y][x], was = plain.cells[y][x]
      assert.ok(/^ow_(roof|house)_adobe_/.test(c.overlay ?? '') && /^ow_(roof|house)_/.test(was.overlay ?? '') && !/_adobe_/.test(was.overlay), `${s.at}: the hut at ${x},${y} is ${c.overlay}, was ${was.overlay}`)
      assert.ok(sameCell(c, was), `${s.at}: the hut at ${x},${y} ${cellText(c)} against ${cellText(was)}`)
      hutCells++
    }
  }
  for (const old of seen) assert.ok(swapped[old] > 0, `${old} occurs and is never swapped: ${JSON.stringify(swapped)}`)
  // (every row of the table occurs in the sample)
  assert.equal([...seen].sort().join(' '), Object.keys(SWAPS).sort().join(' '), `rows that never occur: ${Object.keys(SWAPS).filter(o => !seen.has(o))}`)
  assert.ok(pen >= 10, `only ${pen} cells of mud-brick pen`)
  assert.ok(hutCells >= 60, `only ${hutCells} cells of desert huts`)
})

// (a house of the desert kit says so in its door's look: a desert village's
// houses, the walled well's keeper's house, a desert hut; every other field is what it was)
test('the records are the same', () => {
  let n = 0, huts = 0
  for (const [kind, list] of Object.entries(desertNamed())) for (const s of list) {
    const on = recordsOf(s.p), off = recordsOf(plainOf(s))
    huts += on.doors.filter(d => d.look?.wall === 'adobe' && isDesertHut(s, d)).length
    wallsAsDrawn(s, on, off, d => (kind === 'village' || kind === 'well') && d.tier === 'safe')
    for (const field of Object.keys(on)) {
      const a = JSON.stringify(on[field]), b = JSON.stringify(off[field])
      assert.ok(a === b, `${s.at}: ${field} differs: ${firstDiff(a, b)}`)
    }
    n++
  }
  assert.ok(n >= 100, `only ${n} pieces compared`)
  assert.ok(huts >= 12, `only ${huts} desert huts compared`)
})

// Inside, a desert hut is the house it was (interior/versions.js houseSpec:
// the same version, size, trade and seed), its walls of plaster as a desert
// village's houses are (a wooden hut's were of wood): the same rooms, the same
// people and things, the same way in.
test('a desert hut is the same house inside', () => {
  let n = 0
  for (const s of desertNamed().hut) for (const h of desertHuts(s)) {
    const i = s.p.doors.findIndex(d => d.x === h.x && d.y === h.y), plain = plainOf(s).doors[i]
    const on = houseSpec(s.p.doors[i], { worldSeed: s.seed }), off = houseSpec(plain, { worldSeed: s.seed })
    assert.equal(on.palette, 'plaster', `${s.at}: the hut at ${h.x},${h.y} inside is of ${on.palette}`)
    assert.equal(off.palette, plain.look.wall === 'wood' ? 'wood' : 'plaster', `${s.at}: the green hut at ${h.x},${h.y}`)
    const a = JSON.stringify({ ...on, palette: null }), b = JSON.stringify({ ...off, palette: null })
    assert.ok(a === b, `${s.at}: the hut at ${h.x},${h.y} is another house: ${firstDiff(a, b)}`)
    const inOn = generateInterior(on), inOff = generateInterior(off)
    const what = g => JSON.stringify({ spawns: g.entitySpawns, at: g.playerSpawn, exit: g.exit, tiles: g.map.map(row => row.map(c => c.tile).join(',')) })
    assert.ok(what(inOn) === what(inOff), `${s.at}: inside the hut at ${h.x},${h.y}: ${firstDiff(what(inOn), what(inOff))}`)
    n++
  }
  assert.ok(n >= 12, `only ${n} desert huts`)
})

test('the desert well cools and gives a drink', () => {
  let n = 0
  for (const s of [...desertNamed().village, ...desertNamed().well]) {
    const at = placeCells(s).find(({ c }) => c.overlay === 'ow_well_sand')
    assert.ok(at, `${s.at}: no desert well`)
    assert.equal(s.p.cells[at.y - 1][at.x].overlay, 'ow_well_sand_top', `${s.at}: the well at ${at.x},${at.y} has no top`)
    // three cells off is in its cool
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3]]) assert.ok(nearCool(s.p.cells, at.x + dx, at.y + dy), `${s.at}: ${at.x + dx},${at.y + dy} is not cooled by the well`)
    // and beside it, a drink
    const beside = [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy })).find(q => s.p.cells[q.y][q.x].tile === TILE.FLOOR)
    assert.ok(beside, `${s.at}: nowhere to stand beside the well`)
    const state = { map: s.p.cells, player: { x: beside.x, y: beside.y, px: beside.x * 32 + 16, py: beside.y * 32 + 16 }, entities: [], sfx: makeSfx(), feedback: makeFeedback() }
    const world = { seed: s.seed, day: 0, playtime: 0 }
    for (let t = 0; t < HEAT.drinkAfter + 0.2; t += 0.1) { world.playtime += 0.1; tickHeat(state, world, { clock: 0.5 * DAY_LENGTH, delta: 0.1, desert: true }) }
    assert.ok(state.sfx.cues.some(c => c.name === 'drink'), `${s.at}: no drink beside the well at ${at.x},${at.y}`)
    n++
  }
  assert.ok(n >= 20, `only ${n} desert wells`)
})

test('desert ruins are walked behind as before', () => {
  let n = 0, tops = 0
  const over = p => p.cells.flatMap((row, y) => row.flatMap((c, x) => c.over ? [`${x},${y}`] : [])).join(' ')
  for (const s of [...desertNamed().ruin, ...desertNamed().tower]) {
    assert.equal(over(s.p), over(plainOf(s)), `${s.at}: walked behind elsewhere`)
    tops += s.p.cells.flat().filter(c => c.over && /^ow_(brick_sand|castle_parapet_sand_|roof_gray_sand_)/.test(c.overlay ?? '')).length
    n++
  }
  assert.ok(n >= 20 && tops >= 3 * n, `${n} ruins and towers, ${tops} sandstone cells walked behind`)
})

test("the desert's names are new tiles that behave as the old", () => {
  const names = new Set(WILDS_SKINS)
  for (const [old, n] of Object.entries(SWAPS)) {
    assert.ok(names.has(n), `${n} is not in WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
    for (const tile of [TILE.WALL, TILE.FLOOR]) {
      const cell = name => ({ tile, skin: 'ow_sand_0', overlay: name })
      assert.equal(classOf(cell(n)), classOf(cell(old)), `${n} is on the map as class ${classOf(cell(n))}, ${old} as ${classOf(cell(old))}`)
    }
    assert.equal(isStructure(n), isStructure(old), `${n} is ${isStructure(n) ? '' : 'not '}walked behind, ${old} is${isStructure(old) ? '' : ' not'}`)
    assert.ok(sameCell(cellOf('ow_sand_0', n, false), cellOf('ow_sand_0', old, false)), `${n} is not seen through as ${old} is`)
  }
})
