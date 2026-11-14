import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, getPiece, recordFor, sweep, exportWorld, GEN, FORGET_PIECES, FORGET_SECONDS } from '../renderer/wilds/world.js'
import { enterWilds, tickWilds, snapshotWilds, wildsRespawn, asleep, ACTIVE_TILES } from '../renderer/wilds/session.js'
import { toWorld } from '../renderer/wilds/window.js'
import { PIECE, villagesNear, isPermanent, villageAt } from '../renderer/wilds/layout.js'
import { TILE } from '../renderer/systems/entities.js'
import { applyFelled, STUMP } from '../renderer/systems/lumber.js'

const SEED = 42
// What game.js's buildEntities does, minus the art: one entity per spawn.
const buildEntities = spawns => spawns.map(s => ({ type: s.kind, x: s.x, y: s.y, px: s.x * 32 + 16, py: s.y * 32 + 16 }))
const hooks = { buildEntities }
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5 }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: { floats: [] }, caveInstances: {},
})
function start(saved = null) {
  const world = makeWorld(saved, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, world.pos ?? { wx: 0, wy: 0 }, hooks)
  return { world, state }
}
const playerWorld = (state, world) => toWorld(world.origin, state.player.x, state.player.y)
// Put the player on a window tile (as walking there would) and run one tick.
function walkTo(state, world, x, y) {
  state.player.x = x; state.player.y = y
  state.player.px = x * 32 + 16; state.player.py = y * 32 + 16
  return tickWilds(state, world, 0.016, hooks)
}
const walkEastOnePiece = (state, world) => walkTo(state, world, 2 * PIECE + 8, state.player.y)
const walkWestOnePiece = (state, world) => walkTo(state, world, PIECE - 9, state.player.y)

test('entering builds a 240x240 window with the player on walkable ground at home', () => {
  const { world, state } = start()
  assert.equal(state.map.length, 240)
  assert.equal(state.map[0].length, 240)
  assert.deepEqual(world.origin, { wx: -1, wy: -1 })
  const { x, y } = state.player
  assert.ok(x >= PIECE && x < 2 * PIECE && y >= PIECE && y < 2 * PIECE, 'player in the middle piece')
  assert.equal(state.map[y][x].tile, TILE.FLOOR)
  assert.deepEqual([state.player.px, state.player.py], [x * 32 + 16, y * 32 + 16])
  assert.ok(state.entities.length > 20)
  assert.ok(state.entities.every(e => typeof e.wildsKey === 'string' && Number.isInteger(e.wildsIx)))
  assert.ok(state.caveEntrances.some(c => c.label === 'cave:0,-1' && c.y < PIECE), 'the first cave is in the piece to the north')
  assert.ok(state.houseDoors.length >= 4)
  assert.equal(state.signs.filter(s => s.title === 'Koivula').length, 1)
  assert.equal(state.mapExit, null)
  assert.deepEqual(state.gates, {})
  assert.equal(state.wilds, true)
  for (const list of [state.caveEntrances, state.houseDoors]) for (const t of list) assert.equal(state.map[t.y][t.x].tile, TILE.FLOOR)
})

test('walking east re-centres once, keeps the world position, and does not ping-pong', () => {
  const { world, state } = start()
  const y = state.player.y
  assert.equal(walkTo(state, world, 2 * PIECE + 7, y).recentred, null, 'seven tiles in: not yet')
  const before = toWorld(world.origin, 2 * PIECE + 8, y)
  const r = walkEastOnePiece(state, world)
  assert.deepEqual(r.recentred, { dx: 1, dy: 0 })
  assert.deepEqual(world.origin, { wx: 0, wy: -1 })
  assert.equal(state.player.x, PIECE + 8)
  assert.equal(state.player.px, (PIECE + 8) * 32 + 16)
  assert.deepEqual(playerWorld(state, world), before)
  assert.equal(tickWilds(state, world, 0.016, hooks).recentred, null)
  // back across the boundary by a few tiles: still no re-centre
  assert.equal(walkTo(state, world, PIECE - 3, y).recentred, null)
  assert.deepEqual(walkTo(state, world, PIECE - 9, y).recentred, { dx: -1, dy: 0 })
  assert.deepEqual(world.origin, { wx: -1, wy: -1 })
})

test('a re-centre keeps the cells of the pieces that stay', () => {
  const { world, state } = start()
  const cell = state.map[PIECE + 10][2 * PIECE + 20]   // piece (1, 0)
  walkEastOnePiece(state, world)
  assert.equal(state.map[PIECE + 10][PIECE + 20], cell)
  assert.equal(state.map.length, 240)
})

test('a monster in a kept piece keeps its world position; one in a leaving piece is removed', () => {
  const { world, state } = start()
  const kept = state.entities.find(e => e.x >= PIECE && e.x < 2 * PIECE)       // middle column stays
  const leaving = state.entities.find(e => e.x < PIECE)                      // west column leaves
  assert.ok(kept && leaving)
  const keptWorld = toWorld(world.origin, kept.x, kept.y)
  walkEastOnePiece(state, world)
  assert.ok(state.entities.includes(kept))
  assert.deepEqual(toWorld(world.origin, kept.x, kept.y), keptWorld)
  assert.deepEqual([kept.px, kept.py], [kept.x * 32 + 16, kept.y * 32 + 16])
  assert.ok(!state.entities.includes(leaving))
  assert.ok(state.entities.every(e => e.x >= 0 && e.x < 240 && e.y >= 0 && e.y < 240))
  // the new east column brought its own
  assert.ok(state.entities.some(e => e.x >= 2 * PIECE))
})

test('dead things stay dead across leave and return; the living come back', () => {
  const { world, state } = start()
  const west = state.entities.filter(e => e.x < PIECE && e.y >= PIECE && e.y < 2 * PIECE)   // piece (-1, 0)
  assert.ok(west.length >= 2)
  const [dead, alive] = west
  state.entities = state.entities.filter(e => e !== dead)
  walkEastOnePiece(state, world)
  walkEastOnePiece(state, world)
  assert.ok(!state.entities.some(e => e.wildsKey === '-1,0'))
  walkWestOnePiece(state, world)
  walkWestOnePiece(state, world)
  const back = state.entities.filter(e => e.wildsKey === '-1,0')
  assert.ok(!back.some(e => e.wildsIx === dead.wildsIx), 'the dead one stayed dead')
  assert.ok(back.some(e => e.wildsIx === alive.wildsIx), 'the living one came back')
  assert.equal(back.length, west.length - 1)
})

test('an opened chest stays opened', () => {
  const { world, state } = start()
  const chest = state.entities.find(e => e.type === 'chest' && e.wildsKey === '-1,0')
    ?? state.entities.find(e => e.wildsKey === '-1,0')
  chest.type = 'chest'; chest.opening = true
  walkEastOnePiece(state, world); walkEastOnePiece(state, world)
  walkWestOnePiece(state, world); walkWestOnePiece(state, world)
  assert.ok(!state.entities.some(e => e.wildsKey === '-1,0' && e.wildsIx === chest.wildsIx))
})

test('a wanderer is not duplicated when its home piece comes back', () => {
  const { world, state } = start()
  const w = state.entities.find(e => e.wildsKey === '-1,0')
  // it wanders into the home piece, which stays in the window
  w.x = PIECE + 5; w.y = PIECE + 5; w.px = w.x * 32 + 16; w.py = w.y * 32 + 16
  walkEastOnePiece(state, world)
  assert.ok(state.entities.includes(w), 'still alive in the kept piece')
  walkWestOnePiece(state, world)
  assert.equal(state.entities.filter(e => e.wildsKey === '-1,0' && e.wildsIx === w.wildsIx).length, 1)
})

test('felled trees survive leaving, eviction and return', () => {
  const { world, state } = start()
  let spot = null
  for (let y = PIECE + 2; y < 2 * PIECE - 2 && !spot; y++) for (let x = 2; x < PIECE - 2; x++)
    if (state.map[y][x].overlay === 'ow_tree_small') { spot = { x, y }; break }
  assert.ok(spot, 'a small tree in piece (-1, 0)')
  applyFelled(state.map, [`${spot.x},${spot.y}`])
  assert.equal(state.map[spot.y][spot.x].overlay, STUMP)
  walkEastOnePiece(state, world); walkEastOnePiece(state, world)
  assert.ok(recordFor(world, '-1,0').felled.has(`${spot.x},${spot.y - PIECE}`))
  world.pieces.delete('-1,0')   // as if the cache had dropped it
  walkWestOnePiece(state, world); walkWestOnePiece(state, world)
  assert.equal(state.map[spot.y][spot.x].overlay, STUMP)
  assert.equal(state.map[spot.y][spot.x].tile, TILE.FLOOR)
})

test('forgetting: far and long ago, never a village or the ring around home', () => {
  const world = makeWorld(null, { seed: SEED })
  world.origin = { wx: -1, wy: -1 }
  world.playtime = 5000
  const plain = (x0, y) => { for (let x = x0; ; x++) if (!villageAt(SEED, x, y)) return [x, y] }
  const far = plain(FORGET_PIECES + 1, 0), near = plain(2, 3)
  assert.ok(Math.max(Math.abs(near[0]), Math.abs(near[1])) <= FORGET_PIECES)
  const village = villagesNear(SEED, 12, 12, 4)[0]
  const set = (wx, wy, age) => { recordFor(world, `${wx},${wy}`).lastSeen = world.playtime - age; getPiece(world, wx, wy) }
  set(far[0], far[1], FORGET_SECONDS + 1)
  set(far[0], far[1] + 9, FORGET_SECONDS - 1)       // far but recent
  set(near[0], near[1], FORGET_SECONDS + 500)       // old but near
  set(village.wx, village.wy, FORGET_SECONDS + 500) // far, old, a village
  set(1, 1, FORGET_SECONDS + 500)
  assert.ok(isPermanent(SEED, village.wx, village.wy))
  recordFor(world, `${far[0]},${far[1]}`).gone.add(3)
  const forgotten = sweep(world, 0, 0)
  assert.deepEqual(forgotten, [`${far[0]},${far[1]}`])
  assert.equal(world.records.has(`${far[0]},${far[1]}`), false)
  assert.equal(world.deals.get(`${far[0]},${far[1]}`), 1)
  assert.equal(world.pieces.has(`${far[0]},${far[1]}`), false)
  assert.equal(getPiece(world, far[0], far[1]).deal, 1, 'it comes back as a new deal')
  for (const k of [`${far[0]},${far[1] + 9}`, `${near[0]},${near[1]}`, `${village.wx},${village.wy}`, '1,1']) assert.ok(world.records.has(k), `${k} kept`)
  // a second forgetting deals again
  recordFor(world, `${far[0]},${far[1]}`).lastSeen = world.playtime - FORGET_SECONDS - 1
  sweep(world, 0, 0)
  assert.equal(world.deals.get(`${far[0]},${far[1]}`), 2)
})

test('a forgotten piece takes its cave and house instances with it', () => {
  const { world, state } = start()
  state.caveInstances = { 'cave:9,9': { cleared: false }, 'cave:0,-1': { cleared: false }, [`house:wilds:${9 * PIECE + 4},${9 * PIECE + 70}`]: {}, 'house:wilds:5,5': {} }
  recordFor(world, '9,9').lastSeen = -FORGET_SECONDS - 1
  assert.equal(villageAt(SEED, 9, 9), null)
  world.playtime = 10
  tickWilds(state, world, 10.5, hooks)   // the sweep runs every ten seconds
  assert.deepEqual(Object.keys(state.caveInstances).sort(), ['cave:0,-1', 'house:wilds:5,5'])
})

test('visiting a village makes it the place you wake', () => {
  const { world, state } = start()
  const seen = []
  tickWilds(state, world, 0.016, { buildEntities, onVillage: v => seen.push(v.name) })
  assert.deepEqual(world.lastVillage, { wx: 0, wy: 0 })
  assert.deepEqual(seen, [], 'home is already known')
  const v = villagesNear(SEED, 0, 0, 6).find(x => x.wx !== 0 || x.wy !== 0)
  enterWilds(state, world, { wx: v.wx, wy: v.wy }, hooks)
  tickWilds(state, world, 0.016, { buildEntities, onVillage: x => seen.push(x.name) })
  assert.deepEqual(world.lastVillage, { wx: v.wx, wy: v.wy })
  assert.deepEqual(seen, [v.name])
  tickWilds(state, world, 0.016, { buildEntities, onVillage: x => seen.push(x.name) })
  assert.deepEqual(seen, [v.name], 'announced once')
  // dying anywhere wakes you there
  enterWilds(state, world, { wx: 0, wy: 0 }, hooks)
  walkEastOnePiece(state, world)
  world.lastVillage = { wx: v.wx, wy: v.wy }
  const woke = wildsRespawn(state, world, hooks)
  assert.equal(woke.name, v.name)
  const at = playerWorld(state, world)
  assert.deepEqual([Math.floor(at.X / PIECE), Math.floor(at.Y / PIECE)], [v.wx, v.wy])
  assert.equal(state.map[state.player.y][state.player.x].tile, TILE.FLOOR)
})

test('save round trip: same place, same dead, same felled', () => {
  const { world, state } = start()
  const dead = state.entities.find(e => e.wildsKey === '0,0')
  state.entities = state.entities.filter(e => e !== dead)
  walkEastOnePiece(state, world)
  world.playtime = 321
  const saved = JSON.parse(JSON.stringify(snapshotWilds(state, world)))
  assert.equal(saved.seed, SEED)
  assert.equal(saved.gen, GEN)
  assert.equal(saved.playtime, 321)
  assert.deepEqual(saved.pos, playerWorld(state, world))
  const again = start(saved)
  assert.deepEqual(playerWorld(again.state, again.world), playerWorld(state, world))
  assert.ok(!again.state.entities.some(e => e.wildsKey === '0,0' && e.wildsIx === dead.wildsIx))
  assert.equal(again.world.playtime, 321)
  assert.deepEqual(again.world.lastVillage, { wx: 0, wy: 0 })
})

test('a snapshot taken inside a cave saves the surface', () => {
  const { world, state } = start()
  const at = playerWorld(state, world)
  const inCave = { ...state, map: [[{ tile: TILE.FLOOR }]], entities: [], player: { ...state.player, x: 0, y: 0, px: 16, py: 16 }, cave: { surface: state, label: 'cave:0,-1' } }
  const saved = snapshotWilds(inCave, world)
  assert.deepEqual(saved.pos, at)
  assert.equal(tickWilds(inCave, world, 1, hooks).recentred, null, 'the window never moves underground')
})

test('a save from an older generator wakes at the last village with a clean slate', () => {
  const { world, state } = start()
  walkEastOnePiece(state, world)
  const v = villagesNear(SEED, 0, 0, 6).find(x => x.wx !== 0 || x.wy !== 0)
  world.lastVillage = { wx: v.wx, wy: v.wy }
  world.deals.set('7,7', 2)
  const saved = { ...JSON.parse(JSON.stringify(snapshotWilds(state, world))), gen: GEN - 1 }
  assert.ok(Object.keys(saved.records).length > 0)
  const again = makeWorld(saved, { seed: 999 })
  assert.equal(again.seed, SEED)
  assert.equal(again.records.size, 0)
  assert.equal(again.pos, null)
  assert.deepEqual(again.lastVillage, { wx: v.wx, wy: v.wy })
  assert.equal(again.deals.get('7,7'), 2)
  const st = freshState()
  enterWilds(st, again, again.pos ?? again.lastVillage, hooks)
  const p = getPiece(again, v.wx, v.wy)
  assert.deepEqual(toWorld(again.origin, st.player.x, st.player.y), { X: v.wx * PIECE + p.spawnPoint.x, Y: v.wy * PIECE + p.spawnPoint.y })
})

test('a junk save gives a fresh world', () => {
  for (const junk of ['nope', 7, [], { seed: 'x' }, { seed: 3.5 }, { records: {} }]) {
    const w = makeWorld(junk, { seed: 5 })
    assert.equal(w.seed, 5)
    assert.equal(w.pos, null)
    assert.deepEqual(w.lastVillage, { wx: 0, wy: 0 })
    assert.equal(w.records.size, 0)
  }
  // a save whose saved tile is now inside a tree still lands on walkable ground
  const { world, state } = start()
  const saved = JSON.parse(JSON.stringify(snapshotWilds(state, world)))
  let wall = null
  for (let y = PIECE + 20; y < PIECE + 60 && !wall; y++) for (let x = PIECE + 20; x < PIECE + 60; x++) if (state.map[y][x].tile === TILE.WALL) { wall = toWorld(world.origin, x, y); break }
  const again = start({ ...saved, pos: wall })
  assert.equal(again.state.map[again.state.player.y][again.state.player.x].tile, TILE.FLOOR)
})

test('the cache stays bounded and never drops the window', () => {
  const { world, state } = start()
  for (let i = 0; i < 12; i++) walkEastOnePiece(state, world)
  for (let i = 0; i < 400; i++) tickWilds(state, world, 0.3, hooks)   // pregen fills the ring
  assert.ok(world.pieces.size <= 49, `cache holds ${world.pieces.size}`)
  const o = world.origin
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) assert.ok(world.pieces.has(`${o.wx + c},${o.wy + r}`))
  // the ring around the window is ready before the player gets there
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.ok(world.pieces.has(`${o.wx + 1 + dx},${o.wy + 1 + dy}`), `ring piece ${dx},${dy} pregenerated`)
})

test('asleep: far things do not think', () => {
  const player = { x: 100, y: 100 }
  assert.equal(asleep({ x: 100 + ACTIVE_TILES, y: 100 }, player), false)
  assert.equal(asleep({ x: 100 + ACTIVE_TILES + 1, y: 100 }, player), true)
  assert.equal(asleep({ x: 100, y: 100 - ACTIVE_TILES - 1 }, player), true)
})

test('exportWorld is plain JSON', () => {
  const { world, state } = start()
  walkEastOnePiece(state, world)
  const out = exportWorld(world)
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out)
  assert.ok(Array.isArray(out.visited) && out.visited.includes('0,0'))
  for (const rec of Object.values(out.records)) { assert.ok(Array.isArray(rec.gone)); assert.ok(Array.isArray(rec.felled)); assert.equal(typeof rec.lastSeen, 'number') }
})
