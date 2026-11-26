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
import { makeTerrain, WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { setOpenTops } from '../renderer/wilds/over.js'
import { classOf, CLASS } from '../renderer/wilds/map.js'
import { generateInterior } from '../renderer/interior/index.js'
import { readPng } from '../tools/png-read.mjs'
import { INN_PLANS } from '../renderer/wilds/inn.js'
import { placeFeatures, mainKind } from '../renderer/wilds/features.js'
import { roadsFrom, pieceClass, roadSides, townsAlong, townOf, roadLine, SIDE_WORDS } from '../renderer/wilds/roads.js'
import { PIECE, FRAME, pieceKey, tierAt, pieceBiome, lootDepthFor, villagesNear, fixedMain, BIOME_NAMES } from '../renderer/wilds/layout.js'
import { signNearby } from '../renderer/systems/signs.js'
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
// a piece as it comes with no top opened (wilds/over.js)
const without = fn => { setOpenTops(false); try { return fn() } finally { setOpenTops(true) } }

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
const ROADSIDE_PAD = { rest: 5, shrine: 5, inn: 10, tower: 8, cave: 5, camp: 6, ruin: 8, landmark: 7 }   // as features.js opens them
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
    const mid = piece.road.mid
    assert.ok(mid.x === j.x + 1 && mid.y === j.y + 1, `${at}: the junction's middle ${mid.x},${mid.y} is not the middle of its square at ${j.x},${j.y}`)
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
      // (what the inn is like: the crossroads inn's tests below)
      const inn = piece.doors.find(d => d.kind === 'inn' && near(d))
      assert.ok(inn, `${at}: no inn`)
      assert.equal(inn.lived, true, `${at}: the inn is not marked lived in`)
      assert.equal(houseSpec(inn, { worldSeed: seed }).version, 'home', `${at}: the inn is not a home`)
      assert.ok(props.has('ow_prop_city_cart_horse') && props.has('ow_prop_city_cart'), `${at}: no cart in the yard`)
      assert.ok(people.some(s => Array.isArray(s.lines) && s.lines.length >= 2), `${at}: no stable hand`)
    } else {
      assert.ok(piece.doors.some(d => d.tier === 'ruin' && near(d)), `${at}: no tower`)
      assert.ok(piece.spawns.some(s => s.kind === 'chest' && near(s)), `${at}: no chest`)
    }
  }
  for (const k of [...WAYSIDE, 'camp', 'cave']) assert.ok(seen[k] >= 6, `only ${seen[k] ?? 0} ${k} in the sample`)
})

// ---- the crossroads inn -------------------------------------------------------------
// Where the roads leave it room, the inn is a house in Kalevanlinna's style
// (city/stamps.js house): nine wide and two storeys, plaster with flower
// boxes, the inn's sign by its door in the south face, with a stable beside
// it: horses standing in its stalls under a roof, a trough, hay and the cart
// in the yard, and the stable hand by it. Where they do not, it is the
// smaller house of before, five wide, with its fenced yard and the cart.
// Either way the innkeeper is inside (test/interior-versions.test.js), and
// the stable hand the one outside.
const HORSE = /^ow_prop_horse_[ew]$/, STALL = /^ow_house_stable_[lmr]$/, ROOF = /^ow_(city_)?roof_/
const STABLE_TILES = ['ow_prop_horse_w', 'ow_prop_horse_e', 'ow_prop_trough', 'ow_house_stable_l', 'ow_house_stable_m', 'ow_house_stable_r']
// The first two deals of each roadside piece round home that deal an inn, six
// pieces a seed; built once.
let innSample = null
const innBuilt = () => innSample ??= [1, 3, 7, 2024].flatMap(seed => {
  const out = []
  for (const { wx, wy } of roadsides(seed, 200)) {
    const deals = []
    for (let deal = 0; deal < 30 && deals.length < 2; deal++) if (mainKind(seed, wx, wy, deal) === 'inn') deals.push(deal)
    if (deals.length < 2) continue
    out.push(...deals.map(deal => built(seed, wx, wy, deal)))
    if (out.length >= 12) break
  }
  return out
})
// The inn's house read back off the cells, from its door: its ground floor's
// run of city house front either side of the door, three rows over it.
function innHouse(t, door) {
  const prop = (x, y) => t.propAt(x, y) ?? ''
  let x0 = door.x, x1 = door.x
  while (prop(x0 - 1, door.y).startsWith('ow_city_house_')) x0--
  while (prop(x1 + 1, door.y).startsWith('ow_city_house_')) x1++
  return { x0, x1, top: door.y - 3, w: x1 - x0 + 1 }
}
const isBig = ({ piece }) => piece.doors.some(d => d.kind === 'inn' && d.look.w === 9)

test('a crossroads inn is a city house nine wide with a stable beside it, where the roads leave it room', () => {
  let big = 0
  const ways = new Set(), small = []
  for (const { t, piece, walk, at } of innBuilt()) {
    const m = piece.main, mid = piece.road.mid, pad = ROADSIDE_PAD.inn
    const prop = (x, y) => t.propAt(x, y) ?? '', deco = (x, y) => t.decoAt(x, y) ?? ''
    const doors = piece.doors.filter(d => d.kind === 'inn')
    assert.equal(doors.length, 1, `${at}: ${doors.length} inn doors`)
    const door = doors[0]
    assert.ok(door.lived === true && door.tier === 'safe', `${at}: the inn is not a house always lived in`)
    // by the junction, its doorstep reached from the road, nothing of it on a road or a trail
    assert.ok(dist(m.hub, mid) <= 3, `${at}: the inn's ground is ${dist(m.hub, mid).toFixed(1)} from the junction's middle`)
    assert.ok(walk(mid.x, mid.y) && flood(mid, walk)[(door.y + 1) * PIECE + door.x] === 1, `${at}: the inn's door is not reached from the road`)
    for (let dy = -pad - 7; dy <= pad + 7; dy++) for (let dx = -pad - 7; dx <= pad + 7; dx++) {
      const x = m.x + dx, y = m.y + dy
      if (piece.small.some(s => Math.hypot(x - s.x, y - s.y) <= 6)) continue   // (the small things keep their own ground)
      if (t.onPath(x, y)) assert.ok(walk(x, y), `${at}: ${prop(x, y)} stands on the ${t.onRoad(x, y) ? 'road' : 'trail'} at ${x},${y}`)
    }
    // the stable hand is outside with lines of his own; the innkeeper is not
    const outside = piece.spawns.filter(s => s.kind === 'npc' && dist(s, m) <= pad + 5)
    assert.ok(!outside.some(s => s.lines?.join('|') === door.inn.keeper.join('|')), `${at}: the innkeeper stands outside`)
    const hands = outside.filter(s => s.species === 'villager' && Array.isArray(s.lines) && s.lines.length === 2 && !s.hears)
    assert.equal(hands.length, 1, `${at}: ${hands.length} stable hands`)
    assert.ok(prop(door.x, door.y + 1) === '' || walk(door.x, door.y + 1), `${at}: the doorstep is blocked`)
    if (door.look.w !== 9) {
      // the smaller house of before, and its yard
      small.push(at)
      // no stalls there: its hand talks of the yard, not of stalls
      assert.ok(hands.every(h => h.lines.every(l => !/stall|stable|horse/i.test(l))), `${at}: the hand speaks of stalls the small inn does not have`)
      assert.ok(door.look.w === 5 && door.look.storeys === 2, `${at}: an inn ${door.look.w} wide`)
      continue
    }
    big++
    assert.deepEqual(door.look, { w: 9, storeys: 2, wall: 'plaster' }, `${at}: the inn's look`)
    // the house, row by row: roof, eaves, the upper storey, the ground floor with the door; nothing of it below
    const h = innHouse(t, door)
    assert.equal(h.w, 9, `${at}: the inn is ${h.w} wide`)
    assert.match(prop(door.x, door.y), /^ow_city_house_(white|ochre|rose|green)_door$/, `${at}: the door`)
    let boxes = 0
    for (let x = h.x0; x <= h.x1; x++) {
      assert.match(prop(x, h.top), ROOF, `${at}: the roof at ${x}`)
      assert.match(prop(x, h.top + 1), ROOF, `${at}: the eaves at ${x}`)
      const upper = prop(x, h.top + 2) === 'ow_city_sign_inn' ? deco(x, h.top + 2) : prop(x, h.top + 2)
      assert.match(upper, /^ow_city_house_/, `${at}: the upper storey at ${x}`)
      assert.match(prop(x, door.y), /^ow_city_house_/, `${at}: the ground floor at ${x}`)
      for (const y of [h.top + 2, door.y]) if (/_win2$/.test(prop(x, y)) || /_win2$/.test(deco(x, y))) boxes++
      assert.ok(!/^ow_(city_house|city_roof|roof)_/.test(prop(x, door.y + 1)), `${at}: something of the house below its door at ${x}`)
    }
    assert.ok([door.x - 1, door.x + 1].some(x => prop(x, door.y - 1) === 'ow_city_sign_inn'), `${at}: no inn sign over the door's side`)
    assert.ok(boxes >= 4, `${at}: ${boxes} flower boxes`)
    // the stable: horses standing in its stalls under its roof, a trough, hay and the cart in the yard
    const near = []
    for (let dy = -pad - 3; dy <= pad + 3; dy++) for (let dx = -pad - 3; dx <= pad + 3; dx++) near.push({ x: m.x + dx, y: m.y + dy })
    const horses = near.filter(c => HORSE.test(prop(c.x, c.y)))
    assert.ok(horses.length >= 2 && horses.length <= 3, `${at}: ${horses.length} horses`)
    for (const c of horses) {
      assert.match(deco(c.x, c.y), STALL, `${at}: the horse at ${c.x},${c.y} is not in a stall`)
      assert.match(prop(c.x, c.y - 1), ROOF, `${at}: the horse at ${c.x},${c.y} has no roof over it`)
      assert.ok(!walk(c.x, c.y), `${at}: the horse at ${c.x},${c.y} can be walked through`)
    }
    const stalls = near.filter(c => STALL.test(deco(c.x, c.y)) || STALL.test(prop(c.x, c.y)))
    assert.ok(stalls.length >= 3 && stalls.every(c => c.y === horses[0].y), `${at}: ${stalls.length} stalls`)
    assert.ok(near.some(c => prop(c.x, c.y) === 'ow_prop_trough'), `${at}: no trough`)
    assert.ok(near.some(c => /^ow_prop_hay_/.test(prop(c.x, c.y))), `${at}: no hay`)
    assert.ok(near.some(c => prop(c.x, c.y) === 'ow_prop_city_cart_horse' && prop(c.x + 1, c.y) === 'ow_prop_city_cart'), `${at}: no cart`)
    // the stable hand by the stable
    assert.ok(stalls.some(c => dist(c, hands[0]) <= 4), `${at}: the stable hand is not by the stable`)
    ways.add(horses[0].y < door.y ? 'the yard north of the house' : 'the house north of the yard')
  }
  const n = innBuilt().length
  assert.ok(n >= 40, `only ${n} inns in the sample`)
  // the smaller inn only where the roads leave no room for the big one
  assert.ok(big >= n * 0.75, `${big} of ${n} inns are the big one; the small: ${small.join('; ')}`)
  assert.equal(ways.size, 2, `the inns all stand one way: ${[...ways]}`)
})

test("the inn's top row is walked under, and only that; the map shows it as a building", () => {
  let n = 0
  for (const { seed, piece } of innBuilt().filter(isBig).slice(0, 8)) {
    const a = generatePiece(seed, piece.wx, piece.wy, piece.deal), b = without(() => generatePiece(seed, piece.wx, piece.wy, piece.deal))
    const door = a.doors.find(d => d.kind === 'inn'), at = `seed ${seed} piece ${piece.key} deal ${piece.deal}`
    const top = door.y - 3
    for (let x = door.x - 4; x <= door.x + 4; x++) {
      assert.ok(a.cells[top][x].over === true && a.cells[top][x].tile === TILE.FLOOR, `${at}: the inn's roof at ${x},${top} is not walked under`)
      assert.ok(!b.cells[top][x].over && b.cells[top][x].tile === TILE.WALL, `${at}: the roof at ${x},${top} is open with the tops shut`)
      for (let y = top + 1; y <= door.y; y++) if (y !== door.y || x !== door.x) assert.ok(!a.cells[y][x].over && a.cells[y][x].tile === TILE.WALL, `${at}: the inn at ${x},${y}`)
      // (the sign is drawn over a wall: a block of the map holds wall beside it)
      for (let y = top; y <= door.y; y++) if (a.cells[y][x].overlay !== 'ow_city_sign_inn') assert.equal(classOf(a.cells[y][x]), CLASS.building, `${at}: the map shows the inn at ${x},${y} as ${classOf(a.cells[y][x])}`)
    }
    n++
  }
  assert.ok(n >= 6, `only ${n} big inns`)
})

test('inside, the guests name towns down the roads, and the player hears of them', () => {
  let told = 0
  for (const { seed, piece, at } of innBuilt()) {
    const door = piece.doors.find(d => d.kind === 'inn')
    const spec = houseSpec(door, { worldSeed: seed })
    assert.ok(spec.trade === 'innkeeper' && spec.version === 'home' && ['large', 'grand'].includes(spec.size), `${at}: ${spec.trade} ${spec.version} ${spec.size}`)
    const g = generateInterior(spec)
    const towns = SIDES.filter(s => piece.road.sides[s]).flatMap(s => townsAlong(seed, piece.wx, piece.wy, s).slice(0, 1).map(a => a.town))
    const npcs = g.entitySpawns.filter(s => s.kind === 'npc')
    assert.ok(npcs.some(s => s.id.endsWith(':keeper') && s.lines.join('|') === door.inn.keeper.join('|')), `${at}: no innkeeper inside`)
    for (const s of npcs.filter(s => s.hears)) {
      const town = towns.find(c => c.key === s.hears[0])
      assert.ok(town, `${at}: a guest names ${s.hears}, the next town along none of the roads`)
      assert.ok(s.lines[0].includes(town.name), `${at}: "${s.lines[0]}" does not name ${town.name}`)
      told++
    }
  }
  assert.ok(told >= innBuilt().length, `${told} guests name a town in ${innBuilt().length} inns`)
})

// The big inn stands as one of its plans draws it, or not at all: the stable
// where the plan puts it beside the house (as drawn or mirrored), the yard's
// things all there, the whole roof walked under; and it stays by the
// junction, its nearest building within NEAR_JUNCTION of the junction's
// middle (17 the most measured over these seeds). Over six seeds, the first
// two inn deals of twelve roadside pieces each, and seed 42's piece 3,2 at
// deal 4, where the stable was once moved onto the inn's roof.
const NEAR_JUNCTION = 18
// where each plan, as drawn and mirrored, puts the stable's first stall from the inn's door
const STABLE_FROM_DOOR = INN_PLANS.flatMap(plan => {
  const inn = plan.find(i => i[0] === 'inn'), stable = plan.find(i => i[0] === 'stable')
  const [, sx, sy, w] = stable, [, dx, dy] = inn
  return [`${sx - dx},${sy - dy}`, `${dx - (sx + w - 1)},${sy - dy}`]
})
let wideInns = null
const wideInnSample = () => wideInns ??= [...[1, 3, 7, 2024, 42, 9].flatMap(seed => {
  const out = []
  for (const { wx, wy } of roadsides(seed, 200)) {
    const deals = []
    for (let deal = 0; deal < 30 && deals.length < 2; deal++) if (mainKind(seed, wx, wy, deal) === 'inn') deals.push(deal)
    if (deals.length < 2) continue
    out.push(...deals.map(deal => ({ seed, wx, wy, deal })))
    if (out.length >= 24) break
  }
  return out
}), { seed: 42, wx: 3, wy: 2, deal: 4 }]

test('a big inn stands as its plan draws it: the stable in its place, the yard whole, the roof walked under, by the junction', () => {
  let big = 0, farthest = 0, pinned = false
  for (const { seed, wx, wy, deal } of wideInnSample()) {
    const p = generatePiece(seed, wx, wy, deal), at = `seed ${seed} piece ${wx},${wy} deal ${deal}`
    const door = p.doors.find(d => d.kind === 'inn')
    assert.ok(door, `${at}: no inn`)
    if (seed === 42 && wx === 3 && wy === 2 && deal === 4) { pinned = true; assert.equal(door.look.w, 9, `${at}: not the big inn`) }
    if (door.look.w !== 9) continue
    big++
    const cell = (x, y) => p.cells[y]?.[x] ?? {}
    const near = []
    for (let y = door.y - 14; y <= door.y + 14; y++) for (let x = door.x - 14; x <= door.x + 14; x++) if (p.cells[y]?.[x]) near.push({ x, y })
    // the stable: four stalls in one row, its first stall where a plan puts it from the door
    const stalls = near.filter(c => STALL.test(cell(c.x, c.y).deco ?? '') || STALL.test(cell(c.x, c.y).overlay ?? ''))
    assert.ok(stalls.length === 4 && stalls.every(c => c.y === stalls[0].y), `${at}: ${stalls.length} stalls`)
    const x0 = Math.min(...stalls.map(c => c.x)), row = stalls[0].y
    assert.ok(STABLE_FROM_DOOR.includes(`${x0 - door.x},${row - door.y}`), `${at}: the stable at ${x0 - door.x},${row - door.y} from the door, none of ${STABLE_FROM_DOOR.join(' ')}`)
    // the yard's things
    const has = test => near.some(c => test(cell(c.x, c.y).overlay ?? '', c))
    assert.ok(has((o, c) => o === 'ow_prop_city_cart_horse' && cell(c.x + 1, c.y).overlay === 'ow_prop_city_cart'), `${at}: no cart`)
    assert.ok(has(o => o === 'ow_prop_trough'), `${at}: no trough`)
    assert.ok(has(o => /^ow_prop_hay_/.test(o)), `${at}: no hay`)
    // the whole roof walked under
    for (let x = door.x - 4; x <= door.x + 4; x++) assert.ok(cell(x, door.y - 3).over === true, `${at}: the roof at ${x},${door.y - 3} is not walked under`)
    // by the junction: the nearest cell of the house or the stable
    const buildingCells = [...stalls.flatMap(c => [0, 1, 2].map(j => ({ x: c.x, y: c.y - j }))),
      ...Array.from({ length: 36 }, (_, i) => ({ x: door.x - 4 + (i % 9), y: door.y - 3 + Math.floor(i / 9) }))]
    const nearest = Math.min(...buildingCells.map(c => dist(c, p.road.mid)))
    farthest = Math.max(farthest, nearest)
    assert.ok(nearest <= NEAR_JUNCTION, `${at}: the inn's nearest building is ${nearest.toFixed(1)} from the junction's middle`)
  }
  assert.ok(pinned, 'seed 42 piece 3,2 deal 4 is not in the sample')
  assert.ok(big >= 130, `only ${big} big inns in ${wideInnSample().length}`)
})

test("the stable's tiles: what stands alone keeps off its edges, the stalls join without a seam", () => {
  const skins = new Set(WILDS_SKINS)
  const png = n => readPng(new URL(`../renderer/assets/tiles/${n}.png`, import.meta.url).pathname)
  for (const n of STABLE_TILES) {
    assert.ok(skins.has(n), `${n} is not loaded with the Wilds`)
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
    const p = png(n)
    assert.ok(p.width === 16 && p.height === 16, `${n} is ${p.width}x${p.height}`)
  }
  const alpha = (p, x, y) => p.pixels[(y * 16 + x) * 4 + 3]
  for (const n of ['ow_prop_horse_w', 'ow_prop_horse_e', 'ow_prop_trough']) {
    const p = png(n)
    for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) assert.equal(alpha(p, x, y), 0, `${n}: a pixel on its edge at ${x},${y}`)
  }
  // the horse facing east is the one facing west, mirrored
  const w = png('ow_prop_horse_w'), e = png('ow_prop_horse_e')
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
    assert.equal(e.pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4).join(), w.pixels.slice((y * 16 + 15 - x) * 4, (y * 16 + 15 - x) * 4 + 4).join(), `the horses differ at ${x},${y}`)
  // the stalls are the front of a building, solid all over, and any two side by side join pixel for pixel
  const col = (n, x) => { const p = png(n); return Array.from({ length: 16 }, (_, y) => p.pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4).join()).join(';') }
  for (const n of ['ow_house_stable_l', 'ow_house_stable_m', 'ow_house_stable_r']) {
    const p = png(n)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.equal(alpha(p, x, y), 255, `${n}: see-through at ${x},${y}`)
  }
  const joint = col('ow_house_stable_l', 15)
  for (const [n, x] of [['ow_house_stable_m', 0], ['ow_house_stable_m', 15], ['ow_house_stable_r', 0]]) assert.equal(col(n, x), joint, `${n} column ${x} does not join`)
})

// ---- signposts -------------------------------------------------------------------
// A road piece names the next towns along each of its roads on a signpost by
// its junction; a village names the towns its roads go to, then the country
// on its sides without a road. One league is one piece.
const LINE = /^(North|East|South|West): [^,]+, (1 league|([2-9]|\d\d+) leagues)\.$/

test('a road line names the side, the town and how many leagues', () => {
  assert.equal(roadLine('East', { name: 'Haukiniemi' }, 3), 'East: Haukiniemi, 3 leagues.')
  assert.equal(roadLine('North', { name: 'Koivula' }, 1), 'North: Koivula, 1 league.')
  assert.deepEqual(SIDE_WORDS, { N: 'North', E: 'East', S: 'South', W: 'West' })
})

test('a road piece has a signpost by its junction whose lines match townsAlong', () => {
  // the roadside and farmland samples, and the home trio's pieces that lie on a road
  const trio = SEEDS.flatMap(seed => [[1, 0], [0, -1]].filter(([wx, wy]) => roadCount(seed, wx, wy) > 0).map(([wx, wy]) => built(seed, wx, wy)))
  let n = 0, twoOnASide = 0, inMouths = 0
  for (const { seed, t, piece, at } of [...roadsideBuilt(), ...farmSample(), ...trio]) {
    const posts = piece.signs.filter(s => s.title === 'Signpost')
    if (!posts.length && outOnTheWater(t, piece)) continue
    assert.equal(posts.length, 1, `${at}: ${posts.length} signposts`)
    assert.equal(piece.signs.length, 1, `${at}: other signs`)
    const sign = posts[0], mid = piece.road.mid, where = `${at}: the signpost at ${sign.x},${sign.y}`
    assert.equal(t.propAt(sign.x, sign.y), 'ow_sign', `${where} is not drawn`)
    assert.ok(!t.walkable(sign.x, sign.y) && t.kind(sign.x, sign.y) === 'land', `${where} is not a post on land`)
    assert.ok(Math.min(sign.x, sign.y, PIECE - 1 - sign.x, PIECE - 1 - sign.y) >= FRAME, `${where} is in the frame`)
    assert.ok(dist(sign, mid) <= 5, `${where} is ${dist(sign, mid).toFixed(1)} from the junction's middle ${mid.x},${mid.y}`)
    // off every road and trail (out of a trail's mouth where it can be), and read from the road beside it
    assert.ok(!t.onPath(sign.x, sign.y), `${where} stands on a ${t.onRoad(sign.x, sign.y) ? 'road' : 'trail'}`)
    let mouth = false
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (t.onPath(sign.x + dx, sign.y + dy) && !t.onRoad(sign.x + dx, sign.y + dy)) mouth = true
    if (mouth) inMouths++
    const from = N4.map(([dx, dy]) => ({ x: sign.x + dx, y: sign.y + dy })).filter(c => t.onRoad(c.x, c.y) && t.walkable(c.x, c.y))
    assert.ok(from.length && from.every(c => signNearby(piece.signs, c.x, c.y) === sign), `${where} cannot be read from the road`)
    assert.ok(!piece.spawns.some(s => s.x === sign.x && s.y === sign.y), `${where} has something dealt onto it`)
    // a line for each town along each road side, nearest first, by N, E, S, W
    const along = SIDES.filter(s => piece.road.sides[s]).flatMap(s => townsAlong(seed, piece.wx, piece.wy, s).map(a => ({ s, ...a })))
    assert.ok(SIDES.filter(s => piece.road.sides[s]).every(s => along.some(a => a.s === s)), `${at}: a road side leads to no town`)
    assert.deepEqual(sign.lines, along.map(a => roadLine(SIDE_WORDS[a.s], a.town, a.leagues)), at)
    assert.deepEqual(sign.hears, along.map(a => a.town.key), at)
    for (const l of sign.lines) assert.match(l, LINE, at)
    if (along.length > new Set(along.map(a => a.s)).size) twoOnASide++
    n++
  }
  assert.ok(n >= 60, `only ${n} road pieces`)
  assert.ok(twoOnASide >= 1, 'no signpost names two towns along one road')
  assert.ok(inMouths / n <= 0.2, `${inMouths} of ${n} signposts stand in a trail's mouth`)
})

// Where the roads meet out on the water, every cell beside the road near the junction is water or a way.
const SIGN_REACH = 5
function outOnTheWater(t, piece) {
  const m = piece.road.mid
  for (let dy = -SIGN_REACH; dy <= SIGN_REACH; dy++) for (let dx = -SIGN_REACH; dx <= SIGN_REACH; dx++) {
    const x = m.x + dx, y = m.y + dy
    if (dx * dx + dy * dy > SIGN_REACH * SIGN_REACH || t.onRoad(x, y) || !N4.some(([a, b]) => t.onRoad(x + a, y + b))) continue
    if (!t.onPath(x, y) && t.kind(x, y) !== 'water') return false
  }
  return true
}

test('nearly every road piece that is not a village has its signpost; the rest meet on the water', () => {
  let n = 0, none = 0
  for (const seed of [5, 11]) for (let wy = -6; wy <= 6; wy++) for (let wx = -6; wx <= 6; wx++) {
    const cls = pieceClass(seed, wx, wy)
    if (cls === 'village' || cls === 'city' || cls === 'wild' || roadCount(seed, wx, wy) === 0) continue
    const p = generatePiece(seed, wx, wy, 0)
    n++
    const posts = p.signs.filter(s => s.title === 'Signpost')
    assert.ok(posts.length <= 1, `seed ${seed} piece ${wx},${wy}: ${posts.length} signposts`)
    if (posts.length) { assert.equal(p.cells[posts[0].y][posts[0].x].overlay, 'ow_sign'); continue }
    none++
    assert.equal(p.biome, 'sea', `seed ${seed} piece ${wx},${wy} (${p.biome} ${cls}) has no signpost`)
  }
  assert.ok(n >= 100, `only ${n} road pieces`)
  assert.ok(none / n <= 0.04, `${none} of ${n} road pieces have no signpost`)
})

test("a village's sign lists its roads first, then the country on the roadless sides", () => {
  const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
  let n = 0, shared = 0, country = 0
  for (const seed of [...SEEDS, 7]) for (const v of villagesNear(seed, 0, 0, 9)) {
    const p = generatePiece(seed, v.wx, v.wy, 0)
    const at = `seed ${seed} village ${v.wx},${v.wy}`
    assert.equal(p.signs.length, 1, at)
    const sign = p.signs[0], roads = roadsFrom(seed, pieceKey(v.wx, v.wy))
    assert.equal(sign.title, p.village.name, at)
    assert.equal(p.cells[sign.y][sign.x].overlay, 'ow_sign', `${at}: the sign is not drawn`)
    const bare = SIDES.filter(s => !roads.some(r => r.side === s))
    const want = [
      ...roads.map(r => roadLine(SIDE_WORDS[r.side], r.town, r.leagues)),
      ...bare.map(s => `${SIDE_WORDS[s]}: ${BIOME_NAMES[pieceBiome(seed, v.wx + STEP[s][0] * 3, v.wy + STEP[s][1] * 3)]}.`),
    ]
    assert.deepEqual(sign.lines, want, at)
    assert.deepEqual(sign.hears, roads.map(r => r.town.key), at)
    if (roads.length > new Set(roads.map(r => r.side)).size) shared++
    country += bare.length
    n++
  }
  assert.ok(n >= 20, `only ${n} villages`)
  assert.ok(shared >= 1, 'no village with two roads leaving by one side')
  assert.ok(country >= 1, 'no village with a side without a road')
})

test("Koivula's sign names Kalevanlinna with its distance", () => {
  for (const seed of [...SEEDS, 7]) {
    const sign = generatePiece(seed, 0, 0, 0).signs[0]
    const city = townOf(seed, 'city')
    assert.ok(sign.lines.includes(roadLine('South', city, 2)), `seed ${seed}: ${JSON.stringify(sign.lines)}`)
    assert.equal(roadLine('South', city, 2), 'South: Kalevanlinna, 2 leagues.')
    assert.ok(!sign.lines.some(l => l.includes('by the sea')), `seed ${seed}: the old line is still there`)
    assert.ok(sign.hears.includes('city'), `seed ${seed}: the sign does not tell of the city`)
  }
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
