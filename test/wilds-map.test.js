import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, getPiece, exportWorld, sweep, recordFor, hear, GEN, FORGET_SECONDS } from '../renderer/wilds/world.js'
import { mapStamp } from '../renderer/render/map-draw.js'
import { fold, noteSeen, classOf, encodePic, decodePic, landmarks, forgetMap, CLASS, MAP_N, MAP_COLOURS, CLASSES, SEE_RADIUS } from '../renderer/wilds/map.js'
import { PIECE, villagesNear } from '../renderer/wilds/layout.js'
import { TILE } from '../renderer/systems/entities.js'

const world = () => makeWorld(null, { seed: 7 })
const explore = (piece, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) piece.cells[y][x].explored = true }
const seenCount = pic => pic.reduce((n, c) => n + (c ? 1 : 0), 0)

test('nothing explored, nothing on the map', () => {
  const w = world(), p = getPiece(w, 3, 0)
  assert.equal(fold(w, p), false)
  assert.equal(w.map.has(p.key), false)
})

test('land only guessed at behind a dune is not on the map', () => {
  const w = world(), p = getPiece(w, 3, 0)
  for (let y = 10; y <= 29; y++) for (let x = 10; x <= 29; x++) p.cells[y][x].guessed = true
  assert.equal(fold(w, p), false)
  assert.equal(noteSeen(w, 3 * PIECE + 20, 20), false)
  assert.equal(w.map.has(p.key), false)
  assert.equal(w.mapVer.has(p.key), false)
})

test('what the hero has explored is drawn, block by block, and only that', () => {
  const w = world(), p = getPiece(w, 3, 0)
  explore(p, 10, 10, 19, 13)
  assert.equal(fold(w, p), true)
  const pic = w.map.get(p.key)
  assert.equal(pic.length, MAP_N * MAP_N)
  assert.equal(seenCount(pic), 5 * 2)
  assert.ok(pic[5 * MAP_N + 5] > 0 && pic[6 * MAP_N + 9] > 0)
  assert.equal(pic[7 * MAP_N + 5], 0)
  assert.equal(fold(w, p), false, 'a second look changes nothing')
  assert.equal(w.mapVer.get(p.key), 1)
})

test('a block seen once stays seen, and follows the land when it changes', () => {
  const w = world(), p = getPiece(w, 3, 0)
  const cell = p.cells[20][20]
  for (const c of [p.cells[20][20], p.cells[20][21], p.cells[21][20], p.cells[21][21]]) { c.explored = true; c.skin = 'ow_grass_0'; c.overlay = null; c.tile = TILE.FLOOR }
  cell.overlay = 'ow_tree_pine_tl'
  fold(w, p)
  assert.equal(w.map.get(p.key)[10 * MAP_N + 10], CLASS.pine)
  cell.overlay = null            // felled
  assert.equal(fold(w, p), true)
  assert.equal(w.map.get(p.key)[10 * MAP_N + 10], CLASS.grass)
  assert.equal(w.mapVer.get(p.key), 2)
})

test('classes by tile name: what stands on a cell beats what it is made of', () => {
  const c = (skin, overlay = null, tile = TILE.FLOOR) => classOf({ skin, overlay, tile })
  assert.equal(c('ow_grass_3'), CLASS.grass)
  assert.equal(c('ow_water_0', null, TILE.WALL), CLASS.water)
  assert.equal(c('ow_water_0', 'ow_pier_deck_m'), CLASS.deck)
  assert.equal(c('ow_dirt_1'), CLASS.path)
  assert.equal(c('ow_city_pave_2'), CLASS.pave)
  assert.equal(c('ow_sand_4'), CLASS.sand)
  assert.equal(c('ow_mtn_ground_1'), CLASS.mtnground)
  assert.equal(c('ow_mtn_ground_1', 'ow_mtn_lat_3_2', TILE.WALL), CLASS.rock)
  assert.equal(c('ow_mud_0'), CLASS.marsh)
  assert.equal(c('ow_grass_0', 'ow_tree_autumn_top', TILE.WALL), CLASS.autumn)
  assert.equal(c('ow_grass_0', 'ow_tree_small_1', TILE.WALL), CLASS.wood)
  assert.equal(c('ow_grass_0', 'ow_roof_red_l', TILE.WALL), CLASS.building)
  assert.equal(c('ow_city_pave_0', 'ow_city_wall_h', TILE.WALL), CLASS.wall)
  assert.equal(c('ow_grass_0', 'ow_bush_round_0', TILE.WALL), CLASS.grass)
  assert.equal(c('ow_bank_sand_3', null, TILE.WALL), CLASS.water)
  assert.equal(c('ow_bank_sand_3', null, TILE.FLOOR), CLASS.sand)
  assert.equal(c('something_new'), CLASS.grass)
  assert.equal(MAP_COLOURS.length, CLASSES.length)
  assert.ok(CLASSES.length <= 26, 'a class is one letter in a save')
})

test('road ground has a colour class of its own', () => {
  for (const ground of ['grass', 'sand', 'mtn', 'marsh']) assert.equal(classOf({ tile: TILE.FLOOR, skin: `ow_road_${ground}_1` }), CLASS.road)
  assert.notEqual(CLASS.road, CLASS.path)
  assert.notEqual(MAP_COLOURS[CLASS.road], MAP_COLOURS[CLASS.path])
  // a new class comes after the old ones, so the letters of older saves keep
  // their meaning (and the desert's landmark class after the road)
  assert.equal(CLASS.road, 16)
  assert.ok(CLASSES.length > CLASS.road)
  assert.deepEqual(['path', 'pave', 'deck', 'building', 'wall'].map(n => CLASS[n]), [11, 12, 13, 14, 15])
  // and a road beside a path shows as road in their block
  const w = world(), p = getPiece(w, 3, 0)
  for (const [x, y] of [[30, 30], [31, 30], [30, 31], [31, 31]]) Object.assign(p.cells[y][x], { explored: true, skin: 'ow_dirt_0', overlay: null, tile: TILE.FLOOR })
  p.cells[30][31].skin = 'ow_road_grass_2'
  fold(w, p)
  assert.equal(w.map.get(p.key)[15 * MAP_N + 15], CLASS.road)
})

test('a path one tile wide still shows in its block', () => {
  const w = world(), p = getPiece(w, 3, 0)
  for (const [x, y] of [[30, 30], [31, 30], [30, 31], [31, 31]]) Object.assign(p.cells[y][x], { explored: true, skin: 'ow_grass_0', overlay: null, tile: TILE.FLOOR })
  p.cells[31][30].skin = 'ow_dirt_2'
  fold(w, p)
  assert.equal(w.map.get(p.key)[15 * MAP_N + 15], CLASS.path)
})

test('noteSeen reads round the hero, across piece edges, and never generates a piece', () => {
  const w = world(), a = getPiece(w, 3, 0), b = getPiece(w, 4, 0)
  explore(a, 60, 0, 79, 79); explore(b, 0, 0, 20, 79)
  const before = w.pieces.size
  assert.equal(noteSeen(w, 3 * PIECE + 78, 40), true)
  assert.equal(w.pieces.size, before)
  assert.ok(seenCount(w.map.get(a.key)) > 0 && seenCount(w.map.get(b.key)) > 0)
  // only what lies within the radius is read
  assert.equal(w.map.get(a.key)[20 * MAP_N + 30], 0)   // tile x=60: more than SEE_RADIUS west of 78
  assert.ok(w.map.get(a.key)[20 * MAP_N + Math.floor((78 - SEE_RADIUS) / 2) + 1] > 0)
  assert.equal(noteSeen(w, 3 * PIECE + 78, 40), false)
  assert.equal(noteSeen(w, -5000, -5000), false)       // nothing there in memory
})

test('a picture goes to text and back, and bad text is refused', () => {
  const w = world(), p = getPiece(w, 3, 0)
  assert.equal(encodePic(new Uint8Array(MAP_N * MAP_N)), 'a1600')
  explore(p, 0, 0, 79, 40)
  fold(w, p)
  const pic = w.map.get(p.key), text = encodePic(pic)
  assert.deepEqual(decodePic(text), pic)
  assert.ok(text.length < 1600, `runs keep it short (${text.length})`)
  for (const bad of ['', 'a1599', 'a1601', 'z1600', 'a0b1600', 12, null, 'a1600b', 'b'.repeat(4000)]) assert.equal(decodePic(bad), null)
})

test('the map is saved with the world and read back', () => {
  const w = world(), p = getPiece(w, 3, 0)
  explore(p, 10, 10, 30, 30)
  fold(w, p)
  const saved = JSON.parse(JSON.stringify(exportWorld(w)))
  const back = makeWorld(saved)
  assert.deepEqual(back.map.get(p.key), w.map.get(p.key))
  assert.equal(back.mapVer.get(p.key), 1)
  // junk in the save is passed over
  const junk = makeWorld({ ...saved, map: { 'not a key': 'a1600', '3,0': 'nonsense', '4,0': 'a1600' } })
  assert.deepEqual([...junk.map.keys()], ['4,0'])
})

test('a generator change clears the pictures', () => {
  const w = world(), p = getPiece(w, 3, 0)
  explore(p, 10, 10, 30, 30)
  fold(w, p)
  const old = makeWorld({ ...JSON.parse(JSON.stringify(exportWorld(w))), gen: GEN - 1 })
  assert.equal(old.map.size, 0)
})

test('when the world forgets a piece, its picture goes too', () => {
  const w = world(), p = getPiece(w, 9, 9)
  explore(p, 0, 0, 79, 79)
  fold(w, p)
  recordFor(w, p.key).lastSeen = 0
  w.playtime = FORGET_SECONDS + 1
  w.origin = { wx: -1, wy: -1 }
  assert.deepEqual(sweep(w, 0, 0), [p.key])
  assert.equal(w.map.has(p.key), false)
  assert.equal(w.mapVer.has(p.key), false)
})

test('landmarks: the villages reached, the city, and a tale place once stood in', () => {
  const w = world()
  assert.deepEqual(landmarks(w).map(l => [l.kind, l.name]), [['village', 'Koivula']])
  w.visited.push('city')
  w.places.set('0,5', { id: 'sampo_sea', village: 'sampo', done: false })
  w.places.set('-3,1', { id: 'elk', village: '0,0', done: false })
  assert.equal(landmarks(w).length, 2, 'a place not yet found is not shown')
  getPiece(w, 0, 5)
  noteSeen(w, 3, 5 * PIECE + 3)                 // in the piece, far from its middle
  assert.equal(w.found.has('0,5'), false)
  assert.equal(noteSeen(w, 40, 5 * PIECE + 44), true)
  assert.deepEqual(landmarks(w).map(l => l.name), ['Koivula', 'Kalevanlinna', "Turso's bay"])
  const city = landmarks(w)[1]
  assert.deepEqual([city.X, city.Y], [80, 240])
  // found places are saved, and outlive a generator change with their place
  const saved = JSON.parse(JSON.stringify(exportWorld(w)))
  assert.deepEqual([...makeWorld({ ...saved, gen: GEN - 1 }).found], ['0,5'])
  assert.deepEqual([...makeWorld({ ...saved, found: ['0,5', '7,7', 3] }).found], ['0,5'])
  forgetMap(w, '0,5')
  assert.equal(w.found.size, 0)
})

test('a heard town is a landmark of kind heard until it is visited', () => {
  const w = world()
  const v = villagesNear(w.seed, 0, 0, 8).find(t => t.wx || t.wy)
  const key = `${v.wx},${v.wy}`
  const before = mapStamp(w)
  hear(w, [key, 'city', '0,0'])
  assert.notEqual(mapStamp(w), before, 'the map does not know it changed')
  const heard = landmarks(w).filter(l => l.kind === 'heard')
  // Koivula is visited already: drawn as visited, though heard of
  assert.deepEqual(heard.map(l => l.key), [key, 'city'])
  assert.deepEqual(heard.map(l => l.name), [v.name, 'Kalevanlinna'])
  assert.deepEqual([heard[0].X, heard[0].Y], [v.wx * PIECE + PIECE / 2, v.wy * PIECE + PIECE / 2], 'the middle of its piece')
  assert.deepEqual([heard[1].X, heard[1].Y], [80, 240], 'the middle of the city')
  assert.equal(landmarks(w).filter(l => l.key === '0,0').length, 1)
  w.visited.push(key)
  assert.deepEqual(landmarks(w).filter(l => l.kind === 'heard').map(l => l.key), ['city'])
  assert.ok(landmarks(w).some(l => l.kind === 'village' && l.key === key))
  assert.ok(w.heard.has(key), 'a visited town stays heard of')
})
