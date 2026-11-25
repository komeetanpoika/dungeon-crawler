// What the land holds along the roads (features.js, sites.js): the first road
// piece out of a town is farmland, and holds a farm of its country with its
// people, gentle packs well away from the farm and the road, and nothing
// guarded. Every other road piece is roadside: a wayside place by its
// junction more often than a camp or a cave, never a boss, and milestones
// along its road. Wild land never puts a camp beside a camp or a cave beside a
// cave.
//
// Pieces and spawns are compared by identity or by plain numbers and strings,
// never deep-equal on big graphs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePiece } from '../renderer/wilds/piece.js'
import { makeTerrain } from '../renderer/wilds/terrain.js'
import { placeFeatures, mainKind } from '../renderer/wilds/features.js'
import { roadsFrom, pieceClass, roadSides, townsAlong } from '../renderer/wilds/roads.js'
import { PIECE, FRAME, pieceKey, tierAt, pieceBiome, lootDepthFor, villagesNear, fixedMain } from '../renderer/wilds/layout.js'
import { TILE } from '../renderer/systems/entities.js'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { houseSpec } from '../renderer/interior/versions.js'

const SEEDS = [1, 3, 2024]
// the farms of each country, as features.js deals them
const FARMS = {
  forest: ['farmstead', 'orchard', 'mill'], autumn: ['farmstead', 'orchard', 'mill'], marsh: ['farmstead', 'peat'],
  sea: ['fisher'], mountain: ['fold', 'quarry'], desert: ['well'],
}
const PAD = { farmstead: 10, orchard: 8, mill: 7, peat: 7, fisher: 8, fold: 7, quarry: 7, well: 6, field: 6 }
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// The farmland pieces nearest home, n of them.
function farmlands(seed, n) {
  const out = []
  for (let r = 1; r <= 24 && out.length < n; r++) for (let wy = -r; wy <= r && out.length < n; wy++) for (let wx = -r; wx <= r && out.length < n; wx++)
    if (Math.max(Math.abs(wx), Math.abs(wy)) === r && pieceClass(seed, wx, wy) === 'farmland') out.push({ wx, wy })
  return out
}
// A piece as piece.js makes it, with its terrain kept so a test can ask what is road.
function built(seed, wx, wy, deal = 0) {
  const t = makeTerrain(seed, wx, wy, deal)
  const tier = tierAt(wx, wy)
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy), cls: pieceClass(seed, wx, wy), road: null,
    main: null, small: [], packs: [], tale: null, points: [], villageTale: null, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  t.finish()
  const opened = new Set([...piece.doors, ...piece.caves].map(d => d.y * PIECE + d.x))
  const walk = (x, y) => x >= 0 && y >= 0 && x < PIECE && y < PIECE && (t.walkable(x, y) || opened.has(y * PIECE + x))
  return { seed, t, piece, walk, at: `seed ${seed} piece ${wx},${wy} deal ${deal} (${piece.biome} ${piece.cls} ${piece.main.kind})` }
}
function flood(from, ok) {
  const seen = new Uint8Array(PIECE * PIECE)
  if (!ok(from.x, from.y)) return seen
  const stack = [from.y * PIECE + from.x]
  seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop(), x = i % PIECE, y = (i / PIECE) | 0
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen[ny * PIECE + nx] || !ok(nx, ny)) continue
      seen[ny * PIECE + nx] = 1; stack.push(ny * PIECE + nx)
    }
  }
  return seen
}
// Four farmland pieces a seed, each dealt twice; built once, shared below.
let sample = null
const farmSample = () => sample ??= SEEDS.flatMap(seed => farmlands(seed, 4).flatMap(({ wx, wy }) => [0, 1].map(deal => built(seed, wx, wy, deal))))

test('the first road piece out of a village is farmland and holds a farm of its country', () => {
  let roads = 0
  const dealt = new Set(), builtKinds = new Set()
  for (const seed of SEEDS) for (const v of villagesNear(seed, 0, 0, 10)) {
    for (const r of roadsFrom(seed, pieceKey(v.wx, v.wy))) {
      if (r.route.length <= 2) continue   // the next town is next door: no land between
      const { wx, wy } = r.route[1]
      if (fixedMain(wx, wy)) continue   // the home trio stays what it is
      if (pieceClass(seed, wx, wy) !== 'farmland') assert.fail(`seed ${seed}: ${wx},${wy}, the first piece out of ${v.wx},${v.wy} towards ${r.side}, is ${pieceClass(seed, wx, wy)}`)
      roads++
      const farms = FARMS[pieceBiome(seed, wx, wy)]
      for (let deal = 0; deal <= 4; deal++) {
        const kind = mainKind(seed, wx, wy, deal)
        assert.ok(farms.includes(kind), `seed ${seed} piece ${wx},${wy} deal ${deal}: a ${kind} on ${pieceBiome(seed, wx, wy)} farmland`)
        dealt.add(kind)
      }
    }
  }
  for (const { piece, at } of farmSample()) {
    // a farm that finds no room beside the roads gives way to the next of its country, last to a field and a hut
    assert.ok([...FARMS[piece.biome], 'field'].includes(piece.main.kind), `${at}: not a farm of its country`)
    builtKinds.add(piece.main.kind)
  }
  assert.ok(roads >= 40, `${roads} roads out of villages`)
  // every farm is dealt somewhere
  for (let wy = -24; wy <= 24; wy++) for (let wx = -24; wx <= 24; wx++) if (pieceClass(1, wx, wy) === 'farmland') dealt.add(mainKind(1, wx, wy, 0))
  for (const kind of Object.values(FARMS).flat()) assert.ok(dealt.has(kind), `no ${kind} dealt`)
  assert.ok(builtKinds.size >= 3, `only ${[...builtKinds]} built in the sample`)
})

test('farmland has friendly people, a door, no nest or stones, and only spider packs kept off the road and the farm', () => {
  let packs = 0, people = 0
  for (const { t, piece, at } of farmSample()) {
    const m = piece.main, pad = PAD[m.kind]
    const folk = piece.spawns.filter(s => s.kind === 'npc' && (s.species === 'villager' || s.species === 'elder') && dist(s, m) <= pad + 3)
    assert.ok(folk.length >= 1 && folk.length <= 3, `${at}: ${folk.length} people on the farm`)
    for (const s of folk) assert.ok(Array.isArray(s.lines) && s.lines.length >= 1 && s.lines.every(l => typeof l === 'string' && l.length > 0), `${at}: a ${s.species} with nothing to say`)
    people += folk.length
    const doors = piece.doors.filter(d => dist(d, m) <= pad + 3)   // (a house moved off a path may stand a little out)
    assert.ok(doors.length >= 1, `${at}: the farm has no door`)
    for (const d of doors) {
      assert.equal(d.tier, 'safe', `${at}: the farm's door is ${d.tier}`)
      assert.ok(d.look && [3, 4, 5].includes(d.look.w), `${at}: the farm's house has no look`)
    }
    for (const s of piece.small) assert.ok(['chest', 'animals', 'mushrooms', 'rocks', 'hut'].includes(s.kind), `${at}: a ${s.kind} on farmland`)
    // every foe is a spider of a pack, 24 tiles from the farm and 10 from the road
    const road = []
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (t.onRoad(x, y)) road.push({ x, y })
    const gap = s => Math.min(...road.map(c => dist(c, s)))
    for (const s of piece.spawns) {
      const hostile = s.kind !== 'npc' ? !['chest', 'wild_mushroom', 'campfire', 'weapon', 'floating_pickup'].includes(s.kind) : !!NPC_SPECIES[s.species].hostile && s.hostile !== false
      if (!hostile) continue
      assert.equal(s.kind, 'monster', `${at}: a ${s.species ?? s.kind} on farmland`)
      assert.ok(dist(s, m) >= 24, `${at}: a spider ${dist(s, m).toFixed(1)} tiles from the farm`)
      assert.ok(gap(s) >= 10, `${at}: a spider ${gap(s).toFixed(1)} tiles from the road`)
    }
    assert.ok(piece.packs.length <= 2, `${at}: ${piece.packs.length} packs`)
    for (const k of piece.packs) { assert.ok(!k.road, `${at}: a pack posted on the road`); packs++ }
  }
  assert.ok(people >= 24, `${people} people on ${farmSample().length} farms`)
  assert.ok(packs >= 4, `${packs} packs in the sample`)
})

test('a farm blocks neither the road nor a trail', () => {
  const pieces = [...farmSample()]
  for (const seed of [7, 42]) for (const { wx, wy } of farmlands(seed, 6)) for (const deal of [0, 1, 2, 3]) pieces.push(built(seed, wx, wy, deal))
  const kinds = new Set()
  for (const { seed, t, piece, walk, at } of pieces) {
    kinds.add(piece.main.kind)
    // from the farm's yard every gate is reached on foot
    const seen = flood(piece.spawnPoint, walk)
    for (const [side, g] of Object.entries(piece.gates)) assert.equal(seen[g.y * PIECE + g.x], 1, `${at}: gate ${side} cut off from the farm`)
    for (const d of piece.doors) assert.equal(seen[d.y * PIECE + d.x], 1, `${at}: the door at ${d.x},${d.y} cannot be reached`)
    // the road is walked end to end, nothing stands on it, and the farm keeps off it
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      if (t.onRoad(x, y)) assert.ok(walk(x, y), `${at}: the road at ${x},${y} is blocked (${t.propAt(x, y)})`)
      // and a trail off the farm's own ground is never built on
      else if (t.onPath(x, y) && !t.onSite(x, y)) assert.ok(walk(x, y), `${at}: the trail at ${x},${y} is built over (${t.propAt(x, y)})`)
    }
    const m = piece.main, pad = PAD[m.kind]
    for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++)
      if (dx * dx + dy * dy <= pad * pad) assert.ok(!t.onRoad(m.x + dx, m.y + dy), `${at}: the road runs through the farm at ${m.x + dx},${m.y + dy}`)
    // nor does anything of the farm stand on a trail on its own ground: a trail may end at a door
    // or a wall's side, never under one (out to pad + 3, as far as a house may move off a path)
    for (let dy = -pad - 3; dy <= pad + 3; dy++) for (let dx = -pad - 3; dx <= pad + 3; dx++) {
      const x = m.x + dx, y = m.y + dy
      if (Math.hypot(dx, dy) < pad + 3 && t.onPath(x, y)) assert.ok(walk(x, y), `${at}: ${t.propAt(x, y)} stands on the trail at ${x},${y}`)
    }
    // the game's cells agree, and a fisher's jetty never touches another bridge only at a corner
    const p = generatePiece(seed, piece.wx, piece.wy, piece.deal)
    const floor = (x, y) => p.cells[y]?.[x]?.tile === TILE.FLOOR
    const cells = flood(p.spawnPoint, floor)
    for (const [side, g] of Object.entries(p.gates)) assert.equal(cells[g.y * PIECE + g.x], 1, `${at}: gate ${side} cut off in the game's cells`)
    const pier = (x, y) => floor(x, y) && (p.cells[y]?.[x]?.overlay ?? '').startsWith('ow_pier')
    for (let y = 0; y < PIECE - 1; y++) for (let x = 0; x < PIECE; x++) for (const dx of [1, -1])
      if (pier(x, y) && pier(x + dx, y + 1) && !floor(x + dx, y) && !floor(x, y + 1)) assert.fail(`${at}: bridges joined only at a corner at ${x},${y}`)
  }
  assert.ok(kinds.size >= 5, `only ${[...kinds]} in the sample`)
})

// The farm's room beside the roads is measured to every road cell; here the
// terrain reports a grid of road lines `every` cells apart besides its own
// (each, like any road, a path too). `built`: every cell the features laid
// something on, which the trees and rocks already growing there are not.
function crowded(seed, wx, wy, deal, every) {
  const t = makeTerrain(seed, wx, wy, deal)
  const onRoad = t.onRoad, onPath = t.onPath
  const line = (x, y) => t.inside(x, y) && (x % every === 0 || y % every === 0)
  t.onRoad = (x, y) => onRoad(x, y) || line(x, y)
  t.onPath = (x, y) => onPath(x, y) || line(x, y)
  const built = new Set()
  for (const lay of ['setProp', 'setWater', 'setMass']) {
    const was = t[lay]
    t[lay] = (x, y, ...rest) => { built.add(y * PIECE + x); return was(x, y, ...rest) }
  }
  const tier = tierAt(wx, wy)
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy), cls: pieceClass(seed, wx, wy), road: null,
    main: null, small: [], packs: [], tale: null, points: [], villageTale: null, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  return { t, piece, built }
}
test('a farm with no room beside the roads gives way to the next of its country, and last to a field with a hut', () => {
  let n = 0
  for (const seed of SEEDS) for (const { wx, wy } of farmlands(seed, 30)) {
    if (!['forest', 'autumn'].includes(pieceBiome(seed, wx, wy))) continue
    const deal = [0, 1, 2, 3, 4, 5].find(d => mainKind(seed, wx, wy, d) === 'farmstead')
    if (deal === undefined) continue
    // lines 16 apart leave 8 tiles of room at most: no farmstead (10), no orchard (8), a mill (7)
    const mill = crowded(seed, wx, wy, deal, 16)
    assert.equal(mill.piece.main.kind, 'mill', `seed ${seed} piece ${wx},${wy} deal ${deal}`)
    // 14 apart leave 7: only the field with its hut (6), and every one of its places is beside a road
    const field = crowded(seed, wx, wy, deal, 14)
    assert.equal(field.piece.main.kind, 'field', `seed ${seed} piece ${wx},${wy} deal ${deal}`)
    // 8 apart: no plan of any farm keeps off them, and the field's hut finds a gap between
    const hemmed = crowded(seed, wx, wy, deal, 8)
    assert.equal(hemmed.piece.main.kind, 'field', `seed ${seed} piece ${wx},${wy} deal ${deal}`)
    for (const { t, piece: p, built } of [mill, field, hemmed]) {
      const at = `seed ${seed} piece ${wx},${wy} (${p.main.kind})`
      assert.ok(p.doors.some(d => d.tier === 'safe' && dist(d, p.main) <= PAD[p.main.kind] + 3), `${at}: no house`)
      assert.ok(p.spawns.some(s => s.kind === 'npc' && s.lines), `${at}: nobody lives there`)
      // nothing the features built stands on a road, however close the roads come
      for (const i of built) {
        const x = i % PIECE, y = (i / PIECE) | 0
        if (t.onRoad(x, y)) assert.ok(t.walkable(x, y), `${at}: ${t.propAt(x, y)} stands on the road at ${x},${y}`)
      }
    }
    n++
  }
  assert.ok(n >= 3, `only ${n} forest farmsteads tried`)
})

// A house read back off the game's cells, as test/wilds-piece.test.js reads one:
// its door in a wall row, two rows of roof above, the top one walked under.
const over = (p, x, y) => p.cells[y]?.[x]?.overlay ?? ''
const isHouse = s => s.startsWith('ow_house_')
function wholeHouse(p, d, at) {
  assert.match(over(p, d.x, d.y), /^ow_house_(door|dbl)/, `${at}: the door is ${over(p, d.x, d.y)}`)
  let x0 = d.x, x1 = d.x, top = d.y
  while (isHouse(over(p, x0 - 1, d.y))) x0--
  while (isHouse(over(p, x1 + 1, d.y))) x1++
  while (isHouse(over(p, d.x, top - 1)) || over(p, d.x, top - 1).startsWith('ow_roof_')) top--
  assert.ok(x1 - x0 >= 2 && x1 - x0 <= 4 && d.y - top >= 2 && d.y - top <= 3, `${at}: a house ${x1 - x0 + 1} wide, ${d.y - top + 1} tall`)
  for (let x = x0; x <= x1; x++) for (let y = top; y <= d.y; y++) {
    assert.ok(y < top + 2 ? over(p, x, y).startsWith('ow_roof_') : isHouse(over(p, x, y)), `${at}: ${over(p, x, y) || 'nothing'} in the house at ${x},${y}`)
    if (y === top) assert.ok(p.cells[y][x].over === true, `${at}: the top of the roof at ${x},${y} is not walked under`)
  }
  assert.equal(p.cells[d.y + 1][d.x].tile, TILE.FLOOR, `${at}: the doorstep is blocked`)
}
test('every farmland piece has a farm with a house, among many', () => {
  let n = 0, mills = 0
  const kinds = new Set()
  for (const seed of [5, 11]) for (const { wx, wy } of farmlands(seed, 40)) {
    const p = generatePiece(seed, wx, wy, 0)
    const at = `seed ${seed} piece ${wx},${wy} (${p.biome} ${p.main.kind})`
    assert.ok([...FARMS[p.biome], 'field'].includes(p.main.kind), `${at}: no farm of its country`)
    const homes = p.doors.filter(d => d.tier === 'safe' && dist(d, p.main) <= PAD[p.main.kind] + 3)
    assert.ok(homes.length >= 1, `${at}: the farm has no house`)
    for (const d of homes) {
      wholeHouse(p, d, at)
      // somebody always lives there: never an abandoned house inside
      assert.equal(d.lived, true, `${at}: the house at ${d.x},${d.y} is not marked lived in`)
      assert.equal(houseSpec(d, { worldSeed: seed }).version, 'home', `${at}: the house at ${d.x},${d.y} is not a home`)
    }
    if (p.main.kind === 'mill') { mills++; assert.equal(over(p, homes[0].x, homes[0].y), 'ow_house_door_mill', `${at}: the mill's door`) }
    kinds.add(p.main.kind)
    n++
  }
  assert.equal(n, 80)
  assert.ok(kinds.size >= 6 && mills >= 1, `only ${[...kinds]} among ${n} farms (${mills} mills)`)
})

// ---- the roadside, and the wild checkerboard ----------------------------------------
// Every road piece that is not farmland (nor a village, the city or the home
// trio) is roadside. Its main thing is dealt from the roadside table: a
// wayside place (rest, shrine, inn, watchtower) standing by the junction, or
// a cave, camp, ruin or landmark set back on its trail; never a boss.
const WAYSIDE = ['rest', 'shrine', 'inn', 'tower']
const ROADSIDE_PAD = { rest: 5, shrine: 5, inn: 9, tower: 8, cave: 5, camp: 6, ruin: 8, landmark: 7 }   // as features.js opens them
const SIDES = ['N', 'E', 'S', 'W']
const roadCount = (seed, wx, wy) => { const s = roadSides(seed, wx, wy); return SIDES.filter(k => s[k]).length }
const isFoe = s => s.kind !== 'npc' ? !['chest', 'wild_mushroom', 'campfire', 'weapon', 'floating_pickup'].includes(s.kind) : !!NPC_SPECIES[s.species].hostile && s.hostile !== false
// The roadside pieces round home that `keep` takes, nearest first, n of them, out to R pieces.
function roadsides(seed, n, keep = () => true, R = 16) {
  const out = []
  for (let r = 1; r <= R && out.length < n; r++) for (let wy = -r; wy <= r && out.length < n; wy++) for (let wx = -r; wx <= r && out.length < n; wx++)
    if (Math.max(Math.abs(wx), Math.abs(wy)) === r && pieceClass(seed, wx, wy) === 'roadside' && keep(wx, wy)) out.push({ wx, wy })
  return out
}
// Three roadside pieces a seed of each wayside kind, of camp and of cave,
// each the first deal of its piece that deals one still wanted; built once.
let roadsideSample = null
const roadsideBuilt = () => roadsideSample ??= SEEDS.flatMap(seed => {
  const want = Object.fromEntries([...WAYSIDE, 'camp', 'cave'].map(k => [k, 3])), out = []
  for (const { wx, wy } of roadsides(seed, 80)) for (let deal = 0; deal < 12; deal++) {
    const k = mainKind(seed, wx, wy, deal)
    if (!want[k]) continue
    want[k]--
    out.push(built(seed, wx, wy, deal))
    break
  }
  return out
})

test('no boss on a road piece', () => {
  let n = 0, wild = 0, bosses = 0
  for (const seed of SEEDS) for (let wy = -14; wy <= 14; wy++) for (let wx = -14; wx <= 14; wx++) {
    const cls = pieceClass(seed, wx, wy)
    if (cls === 'city') continue
    for (let deal = 0; deal < 6; deal++) {
      const kind = mainKind(seed, wx, wy, deal)
      if (cls === 'wild') { wild++; if (kind === 'boss') bosses++; continue }
      n++
      assert.notEqual(kind, 'boss', `seed ${seed} piece ${wx},${wy} (${cls}) deal ${deal}`)
    }
  }
  assert.ok(n >= 3000, `only ${n} road pieces and deals`)
  // (wild land far out keeps its bosses)
  assert.ok(bosses / wild >= 0.05, `${bosses} bosses in ${wild} wild pieces and deals`)
})

test('roadside pieces hold wayside places more often than a camp or a cave', () => {
  const count = {}
  let n = 0
  for (const seed of SEEDS) for (const { wx, wy } of roadsides(seed, 140)) { const k = mainKind(seed, wx, wy, 0); count[k] = (count[k] ?? 0) + 1; n++ }
  assert.ok(n >= 400, `only ${n} roadside pieces`)
  const of = kinds => kinds.reduce((sum, k) => sum + (count[k] ?? 0), 0)
  assert.ok(of(WAYSIDE) > of(['camp', 'cave']), `${of(WAYSIDE)} wayside places, ${of(['camp', 'cave'])} camps and caves in ${n} roadside pieces`)
  for (const k of Object.keys(ROADSIDE_PAD)) assert.ok(count[k] > 0, `no ${k} dealt on the roadside`)
  assert.deepEqual(Object.keys(count).filter(k => !(k in ROADSIDE_PAD)), [], 'a main thing from outside the roadside table')
})

test('a piece where three roads meet is an inn about three times as often', () => {
  const odds = many => {
    let inns = 0, n = 0, pieces = 0
    for (const seed of [...SEEDS, 7, 42]) for (const { wx, wy } of roadsides(seed, 8, (wx, wy) => (roadCount(seed, wx, wy) >= 3) === many)) {
      pieces++
      for (let deal = 0; deal < 40; deal++) { n++; if (mainKind(seed, wx, wy, deal) === 'inn') inns++ }
    }
    assert.ok(pieces >= 25, `only ${pieces} roadside pieces with ${many ? 'three or more' : 'fewer than three'} roads`)
    return { odds: inns / (n - inns), share: inns / n }
  }
  const many = odds(true), few = odds(false)
  // weights 30 of 120 against 10 of 100
  assert.ok(few.share >= 0.07 && few.share <= 0.13, `an inn in ${(few.share * 100).toFixed(1)} % of pieces with two roads`)
  assert.ok(many.share >= 0.2 && many.share <= 0.3, `an inn in ${(many.share * 100).toFixed(1)} % of pieces where three roads meet`)
  const ratio = many.odds / few.odds
  assert.ok(ratio >= 2.2 && ratio <= 4, `the odds of an inn are ${ratio.toFixed(2)} times as high where three roads meet`)
})

test('a wayside place stands by the junction, a camp or cave at least PAD + 4 from it', () => {
  const seen = {}
  for (const { seed, t, piece, walk, at } of roadsideBuilt()) {
    const m = piece.main, j = piece.road.junction, pad = ROADSIDE_PAD[m.kind]
    seen[m.kind] = (seen[m.kind] ?? 0) + 1
    if (!WAYSIDE.includes(m.kind)) {
      assert.ok(dist(m, j) >= pad + 4, `${at}: the ${m.kind} is ${dist(m, j).toFixed(1)} from the junction ${j.x},${j.y}`)
      continue
    }
    // its hub, where the trail from the junction ends, is within 3 tiles of it (of the middle of the
    // road's square there: a road three wide is laid from its point down and right), on the place's
    // own ground and off the road
    assert.ok(m.hub, `${at}: no hub`)
    const mid = { x: j.x + 1, y: j.y + 1 }
    assert.ok(dist(m.hub, mid) <= 3, `${at}: the hub ${m.hub.x},${m.hub.y} is ${dist(m.hub, mid).toFixed(1)} from the junction's middle ${mid.x},${mid.y}`)
    assert.ok(dist(m.hub, m) <= pad, `${at}: the hub is off the place's ground`)
    assert.ok(!t.onRoad(m.hub.x, m.hub.y) && walk(m.hub.x, m.hub.y), `${at}: the hub is on the road or blocked`)
    // no part of it stands on a road or a trail (out to where a building of it may move: the small things keep their own ground)
    for (let dy = -pad - 7; dy <= pad + 7; dy++) for (let dx = -pad - 7; dx <= pad + 7; dx++) {
      const x = m.x + dx, y = m.y + dy
      if (piece.small.some(s => Math.hypot(x - s.x, y - s.y) <= 6)) continue
      if (t.onPath(x, y)) assert.ok(walk(x, y), `${at}: ${t.propAt(x, y)} stands on the ${t.onRoad(x, y) ? 'road' : 'trail'} at ${x},${y}`)
    }
    // and it holds what it is
    const near = (s, r = pad + 5) => dist(s, m) <= r
    const props = new Set()
    for (let dy = -pad - 7; dy <= pad + 7; dy++) for (let dx = -pad - 7; dx <= pad + 7; dx++) { const p = t.propAt(m.x + dx, m.y + dy); if (p) props.add(p) }
    const people = piece.spawns.filter(s => s.kind === 'npc' && s.species === 'villager' && near(s))
    if (m.kind === 'rest') {
      assert.ok(piece.spawns.some(s => s.kind === 'campfire' && near(s, pad)), `${at}: no fire`)
      assert.ok([...props].some(p => p.startsWith('ow_tent_')), `${at}: no tent`)
      const traveller = people.find(s => s.hears)
      assert.ok(traveller, `${at}: no traveller`)
      assert.ok(Array.isArray(traveller.lines) && traveller.lines.length >= 2 && traveller.lines.every(l => typeof l === 'string' && l.length > 0), `${at}: the traveller has nothing to say`)
      assert.equal(traveller.hears.length, 1, `${at}: the traveller names ${traveller.hears.length} towns`)
      const towns = SIDES.filter(s => piece.road.sides[s]).flatMap(s => townsAlong(seed, piece.wx, piece.wy, s).slice(0, 1).map(a => a.town))
      const town = towns.find(c => c.key === traveller.hears[0])
      assert.ok(town, `${at}: the traveller names ${traveller.hears[0]}, the next town along none of the roads`)
      assert.ok(traveller.lines[0].includes(town.name), `${at}: "${traveller.lines[0]}" does not name ${town.name}`)
    } else if (m.kind === 'shrine') {
      assert.ok(props.has('ow_statue') && props.has('ow_statue_top'), `${at}: no statue`)
      assert.ok(piece.spawns.some(s => s.kind === 'chest' && near(s)), `${at}: no chest`)
      assert.ok([...props].some(p => p.startsWith('ow_deco_flower_')), `${at}: no flowers`)
    } else if (m.kind === 'inn') {
      const inn = piece.doors.find(d => d.tier === 'safe' && d.look?.w === 5 && d.look?.storeys === 2 && near(d))
      assert.ok(inn, `${at}: no inn of five by two storeys`)
      assert.equal(inn.lived, true, `${at}: the inn is not marked lived in`)
      assert.equal(houseSpec(inn, { worldSeed: seed }).version, 'home', `${at}: the inn is not a home`)
      assert.ok(props.has('ow_prop_city_cart_horse') && props.has('ow_prop_city_cart'), `${at}: no cart in the yard`)
      assert.ok(people.some(s => Array.isArray(s.lines) && s.lines.length >= 2), `${at}: no innkeeper`)
    } else {
      assert.ok(piece.doors.some(d => d.tier === 'ruin' && near(d)), `${at}: no tower`)
      assert.ok(piece.spawns.some(s => s.kind === 'chest' && near(s)), `${at}: no chest`)
    }
  }
  for (const k of [...WAYSIDE, 'camp', 'cave']) assert.ok(seen[k] >= 6, `only ${seen[k] ?? 0} ${k} in the sample`)
})

// (fixed pieces, villages, the city and tale or Sampo places keep their own
// main things; farmland deals neither a camp nor a cave)
test('a camp never borders a camp and a cave never a cave, whatever the deals', () => {
  const dealt = cls => cls === 'wild' || cls === 'roadside'
  const pairs = {}, held = { wild: { camp: 0, cave: 0 }, roadside: { camp: 0, cave: 0 } }
  for (const seed of [...SEEDS, 7, 42]) for (let wy = -12; wy <= 12; wy++) for (let wx = -12; wx <= 12; wx++) {
    const cls = pieceClass(seed, wx, wy)
    if (!dealt(cls)) continue
    for (let deal = 0; deal < 4; deal++) { const k = mainKind(seed, wx, wy, deal); if (k in held[cls]) held[cls][k]++ }
    for (const [nx, ny] of [[wx + 1, wy], [wx, wy + 1]]) {
      const other = pieceClass(seed, nx, ny)
      if (!dealt(other)) continue
      const pair = [cls, other].sort().join('-')
      pairs[pair] = (pairs[pair] ?? 0) + 1
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const ka = mainKind(seed, wx, wy, a), kb = mainKind(seed, nx, ny, b)
        if (ka === kb && (ka === 'camp' || ka === 'cave')) assert.fail(`seed ${seed}: a ${ka} at ${wx},${wy} (${cls}, deal ${a}) beside a ${kb} at ${nx},${ny} (${other}, deal ${b})`)
      }
    }
  }
  const at = `${JSON.stringify(pairs)} neighbours, ${JSON.stringify(held)} dealt`
  assert.ok(pairs['wild-wild'] >= 1000 && pairs['roadside-wild'] >= 300 && pairs['roadside-roadside'] >= 200, at)
  for (const cls of ['wild', 'roadside']) for (const k of ['camp', 'cave']) assert.ok(held[cls][k] >= 100, at)
})

test('a watchtower is empty at toughness 1 and held from 2', () => {
  const towers = { 1: 0, 2: 0 }
  for (const seed of SEEDS) for (const tough of [1, 2]) {
    let n = 0
    for (const { wx, wy } of roadsides(seed, 30, (wx, wy) => (tierAt(wx, wy) === 1) === (tough === 1), 8)) {
      if (n >= 2) break
      const deal = [...Array(24).keys()].find(d => mainKind(seed, wx, wy, d) === 'tower')
      if (deal === undefined) continue
      n++
      const { piece, at } = built(seed, wx, wy, deal)
      const door = piece.doors.find(d => d.tier === 'ruin')
      assert.ok(door && dist(door, piece.main) <= ROADSIDE_PAD.tower + 5, `${at}: no tower`)
      assert.ok(piece.spawns.some(s => s.kind === 'chest' && dist(s, door) <= 6), `${at}: no chest by the tower`)
      const foes = piece.spawns.filter(s => isFoe(s) && dist(s, door) <= 9)
      if (tough === 1) assert.equal(foes.length, 0, `${at}: ${foes.map(s => s.species ?? s.kind)} at a tower at toughness 1`)
      else assert.ok(foes.length >= 3, `${at}: ${foes.length} foes hold the tower at toughness ${piece.tier}`)
      towers[tough]++
    }
  }
  assert.ok(towers[1] >= 4 && towers[2] >= 4, `${towers[1]} towers at toughness 1, ${towers[2]} beyond`)
})

test('milestones stand off the road and out of the frame', () => {
  let stones = 0, roadCells = 0, pieces = 0, bare = 0
  for (const { t, at } of [...roadsideBuilt(), ...farmSample()]) {
    let here = 0
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      if (t.onRoad(x, y)) roadCells++
      if (t.propAt(x, y) !== 'ow_prop_milestone') continue
      here++
      const where = `${at}: the milestone at ${x},${y}`
      assert.ok(Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y) >= FRAME, `${where} is in the frame`)
      assert.ok(!t.onPath(x, y), `${where} stands on a ${t.onRoad(x, y) ? 'road' : 'trail'}`)
      assert.ok(t.kind(x, y) === 'land' && !t.walkable(x, y), `${where} is not a stone on land`)
      assert.ok(N4.some(([dx, dy]) => t.onRoad(x + dx, y + dy)), `${where} is not beside the road`)
      // nor in the mouth of a trail
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        assert.ok(!t.onPath(x + dx, y + dy) || t.onRoad(x + dx, y + dy), `${where} stands in the mouth of the trail at ${x + dx},${y + dy}`)
    }
    stones += here; pieces++
    if (!here) bare++
  }
  // about one every 20 tiles of road (a road is three cells wide)
  const every = roadCells / 3 / stones
  assert.ok(every >= 14 && every <= 30, `a milestone every ${every.toFixed(1)} tiles of road (${stones} in ${pieces} pieces)`)
  assert.ok(bare / pieces <= 0.15, `${bare} of ${pieces} road pieces have no milestone`)
})
