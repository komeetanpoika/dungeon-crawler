// The coach line (wilds/coach.js): a stop in every village and in
// Kalevanlinna, the towns a ride goes to, when the coachman says no, boarding
// by walking onto the stop, and arriving.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { makeWorld, getPiece } from '../renderer/wilds/world.js'
import { enterWilds, wildsRespawn } from '../renderer/wilds/session.js'
import { toWindow } from '../renderer/wilds/window.js'
import { roadsFrom } from '../renderer/wilds/roads.js'
import { PIECE, FRAME, villagesNear, pieceKey } from '../renderer/wilds/layout.js'
import { CITY_KEYS } from '../renderer/wilds/city/geometry.js'
import { insideWalls } from '../renderer/wilds/city/plan.js'
import { cityFor, coachStopOf, layCityStop } from '../renderer/wilds/city/build.js'
import { APPROACHES } from '../renderer/wilds/city/build-land.js'
import { isVergeSkin } from '../renderer/wilds/road-art.js'
import { TILE } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'
import {
  RIDE_SECONDS, LEAGUE_CLOCK, HOSTILE_REACH, REFUSAL_LINES,
  destinations, refusal, tickCoach, stopTile, arrive, rideAt, passTime,
} from '../renderer/wilds/coach.js'

const SEED = 42
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const CART = /^ow_prop_city_cart/
// a road cell: the road's ground, its planks over water, or the cobbles it wears in a village
const isRoad = c => !!c && ((c.skin ?? '').startsWith('ow_road_') || (c.overlay ?? '').startsWith('ow_pier') || c.skin === 'ow_cobble_green')
// What game.js's buildEntities does, minus the art: one entity per spawn.
const buildEntities = spawns => spawns.map(s => ({ type: s.kind, x: s.x, y: s.y, px: s.x * 32 + 16, py: s.y * 32 + 16 }))
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5 }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: { floats: [] }, caveInstances: {},
})
function start(seed = SEED, save = { clock: DAY_LENGTH / 2 }) {
  const world = makeWorld(null, { seed })
  const state = freshState()
  const hooks = { buildEntities, advanceClock: s => passTime(save, s) }
  enterWilds(state, world, { wx: 0, wy: 0 }, hooks)
  return { world, state, hooks, save }
}
function put(state, at) {
  state.player.x = at.x; state.player.y = at.y
  state.player.px = at.x * 32 + 16; state.player.py = at.y * 32 + 16
}
const stopOf = (state, town) => state.coachStops.find(s => s.town === town)

// Walkable cells of a piece reached from `from`, four ways, never stepping on `avoid`.
function reached(piece, from, avoid = null) {
  const seen = new Uint8Array(PIECE * PIECE)
  const walk = (x, y) => piece.cells[y]?.[x]?.tile === TILE.FLOOR && !(avoid && x === avoid.x && y === avoid.y)
  const stack = [from.y * PIECE + from.x]
  seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop(), x = i % PIECE, y = (i / PIECE) | 0
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen[ny * PIECE + nx] || !walk(nx, ny)) continue
      seen[ny * PIECE + nx] = 1; stack.push(ny * PIECE + nx)
    }
  }
  return seen
}
// The road cells of a piece (its ground, its planks, the cobbles it wears in a
// village) and the cells beside them that wear its verge: where someone
// walking the road, or stepping off it, sets foot.
const roadside = (piece, x, y) => { const c = piece.cells[y]?.[x]; return !!c && (isRoad(c) || isVergeSkin(c.deco)) }
// The stop of a piece: walkable, off the road and its verge with no road cell
// round it, out of the frame, beside a cart; and a cell beside it to arrive on,
// walkable, not the stop and not the coachman's, and reached from the piece's
// spawn point without crossing the stop.
function checkStop(world, piece, town, at) {
  const c = piece.coach
  assert.ok(c, `${at}: no stop`)
  assert.equal(c.town, town, `${at}: the stop names ${c.town}`)
  const cell = piece.cells[c.y][c.x]
  assert.equal(cell.tile, TILE.FLOOR, `${at}: the stop is not walkable`)
  assert.ok(!cell.over, `${at}: the stop is under a roof`)
  assert.ok(!isRoad(cell), `${at}: the stop is on the road`)
  assert.ok(!isVergeSkin(cell.deco), `${at}: the stop wears the road's verge`)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    assert.ok(!isRoad(piece.cells[c.y + dy]?.[c.x + dx]), `${at}: the stop touches the road at ${c.x + dx},${c.y + dy}`)
  assert.ok(Math.min(c.x, c.y, PIECE - 1 - c.x, PIECE - 1 - c.y) >= FRAME, `${at}: the stop is in the frame`)
  assert.ok(!piece.doors.some(d => d.x === c.x && d.y === c.y), `${at}: the stop is a doorstep`)
  const carts = N4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(p => CART.test(piece.cells[p.y]?.[p.x]?.overlay ?? ''))
  assert.ok(carts.length >= 1 && carts.every(p => piece.cells[p.y][p.x].tile === TILE.WALL), `${at}: no cart beside the stop`)
  const there = stopTile(world, town)
  assert.ok(there, `${at}: nowhere to arrive`)
  const lx = there.X - piece.wx * PIECE, ly = there.Y - piece.wy * PIECE
  assert.equal(Math.abs(lx - c.x) + Math.abs(ly - c.y), 1, `${at}: the arrival cell is not beside the stop`)
  assert.equal(piece.cells[ly][lx].tile, TILE.FLOOR, `${at}: the arrival cell is not walkable`)
  assert.ok(!piece.cells[ly][lx].over, `${at}: the arrival cell is under a roof`)
  assert.ok(!piece.spawns.some(s => s.coachman && s.x === lx && s.y === ly), `${at}: the player arrives on the coachman`)
  assert.equal(reached(piece, piece.spawnPoint, c)[ly * PIECE + lx], 1, `${at}: the arrival cell is reached only across the stop`)
  return carts
}

// The villages looked at, generated once for the tests that walk them.
// (seed 12345's 0,-12: its one road comes in through rock, and the stop stands farther in)
let villageSample = null
function villages() {
  if (villageSample) return villageSample
  const extra = { 12345: [{ wx: 0, wy: -12 }] }
  villageSample = []
  for (const seed of [1, 7, 42, 2024, 12345]) {
    const world = makeWorld(null, { seed })
    for (const v of [...villagesNear(seed, 0, 0, 9), ...(extra[seed] ?? [])]) {
      const piece = getPiece(world, v.wx, v.wy)
      villageSample.push({ seed, world, piece, at: `seed ${seed} village ${v.wx},${v.wy} (${piece.biome}${piece.villageTale ? ', ' + piece.villageTale : ''})` })
    }
  }
  return villageSample
}

test('every village and the city has a stop on a walkable cell off the road', () => {
  for (const { world, piece, at } of villages()) {
    {
      const carts = checkStop(world, piece, piece.key, at)
      const c = piece.coach
      // the cart is the city kit's horse and cart, horse west, beside the road
      const horse = carts.map(p => piece.cells[p.y][p.x].overlay === 'ow_prop_city_cart_horse' ? p : { x: p.x - 1, y: p.y })[0]
      assert.equal(piece.cells[horse.y][horse.x].overlay, 'ow_prop_city_cart_horse', `${at}: no horse`)
      assert.equal(piece.cells[horse.y][horse.x + 1].overlay, 'ow_prop_city_cart', `${at}: no cart behind the horse`)
      const roadTouch = p => N4.some(([dx, dy]) => isRoad(piece.cells[p.y + dy]?.[p.x + dx]))
      assert.ok(roadTouch(horse) || roadTouch({ x: horse.x + 1, y: horse.y }), `${at}: the cart is not beside the road`)
      // the coachman stands by the cart, and he and the stop are reached on foot
      const men = piece.spawns.filter(s => s.coachman)
      assert.equal(men.length, 1, `${at}: ${men.length} coachmen`)
      const [man] = men
      assert.deepEqual([man.kind, man.species, man.roam], ['npc', 'villager', 0], `${at}: the coachman`)
      assert.ok(Array.isArray(man.lines) && man.lines.length === 2, `${at}: the coachman's lines`)
      assert.ok([horse, { x: horse.x + 1, y: horse.y }].some(p => Math.max(Math.abs(p.x - man.x), Math.abs(p.y - man.y)) === 1), `${at}: the coachman is not by the cart`)
      const seen = reached(piece, piece.spawnPoint)
      assert.equal(seen[c.y * PIECE + c.x], 1, `${at}: the stop is cut off`)
      assert.equal(seen[man.y * PIECE + man.x], 1, `${at}: the coachman is cut off`)
    }
  }
  assert.ok(villages().length >= 40, `only ${villages().length} villages looked at`)
  // Kalevanlinna: beside the inn's cart, inside the walls, on one of its pieces
  for (const seed of [1, 7, 4242]) {
    const world = makeWorld(null, { seed })
    const held = CITY_KEYS.filter(k => getPiece(world, ...k.split(',').map(Number)).coach)
    assert.deepEqual(held, ['0,2'], `seed ${seed}: the city's stop is on ${held}`)
    const piece = getPiece(world, 0, 2)
    checkStop(world, piece, 'city', `seed ${seed} city`)
    const city = cityFor(seed)
    assert.deepEqual([city.coach.x, city.coach.y], [piece.coach.x, piece.coach.y], `seed ${seed}: the piece's stop is not the city's`)
    assert.ok(insideWalls(city.coach.x, city.coach.y), `seed ${seed}: the stop is outside the walls`)
    const cart = city.inn.cart
    assert.ok([cart, { x: cart.x + 1, y: cart.y }].some(p => Math.abs(p.x - city.coach.x) + Math.abs(p.y - city.coach.y) === 1), `seed ${seed}: the stop is not by the inn's cart`)
  }
})

test('walking along every road cell and every verge cell beside a road never steps onto a stop', () => {
  let walked = 0
  for (const { piece, at } of villages()) {
    const c = piece.coach
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      if (!roadside(piece, x, y)) continue
      walked++
      assert.ok(!(x === c.x && y === c.y), `${at}: the road or its verge runs over the stop at ${x},${y}`)
    }
    // one step off the road, any way, lands next to the stop at the nearest, never on it
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      if (!isRoad(piece.cells[y][x])) continue
      assert.ok(Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) >= 2, `${at}: the road at ${x},${y} is a step from the stop`)
    }
  }
  assert.ok(walked > 1000, `only ${walked} road and verge cells walked`)
})

test('with no room by the inn\'s cart the city\'s stop moves to the north gate, with a cart of its own', () => {
  const city = cityFor(7)
  const cart = city.inn.cart
  assert.ok(coachStopOf(city.cells, cart), 'the inn\'s cart has room beside it')
  // the same cells with every cell round the cart walled up
  const cells = city.cells.map(row => row.map(c => ({ ...c })))
  for (let y = cart.y - 1; y <= cart.y + 1; y++) for (let x = cart.x - 1; x <= cart.x + 2; x++) {
    if (y === cart.y && (x === cart.x || x === cart.x + 1)) continue
    cells[y][x].tile = TILE.WALL
  }
  assert.equal(coachStopOf(cells, cart), null)
  const stop = layCityStop(cells, cart)
  assert.ok(stop && cells[stop.y][stop.x].tile === TILE.FLOOR, 'no walkable stop by the north gate')
  assert.ok(!insideWalls(stop.x, stop.y), 'the fallback stop is inside the walls')
  const [x0, y0, x1, y1] = APPROACHES.N
  assert.ok(stop.x >= x0 - 3 && stop.x <= x1 + 3 && stop.y >= y0 - 3 && stop.y <= y1 + 1, `the fallback stop ${stop.x},${stop.y} is not by the north approach`)
  assert.ok(N4.some(([dx, dy]) => CART.test(cells[stop.y + dy][stop.x + dx].overlay ?? '') && cells[stop.y + dy][stop.x + dx].tile === TILE.WALL), 'no cart laid by the fallback stop')
  assert.ok(N4.some(([dx, dy]) => isRoad(cells[stop.y + dy][stop.x + dx])), 'the fallback stop is not beside the approach road')
})

test('destinations are the towns one road away, and listing them pencils them on the map', () => {
  for (const key of ['0,0', 'city']) {
    const world = makeWorld(null, { seed: SEED })
    assert.equal(world.heard.size, 0)
    const list = destinations(world, key)
    const roads = roadsFrom(SEED, key)
    assert.ok(list.length >= 2, `${key}: ${list.length} towns`)
    assert.deepEqual(list.map(d => [d.town.key, d.side, d.leagues]), roads.map(r => [r.town.key, r.side, r.leagues]))
    assert.equal(new Set(list.map(d => d.town.key)).size, list.length, `${key}: a town listed twice`)
    for (const d of list) {
      assert.ok(world.heard.has(d.town.key), `${key}: ${d.town.key} not heard of`)
      assert.equal(d.route.length, d.leagues + 1)
      assert.ok(Array.isArray(d.route) && d.route.every(p => Number.isInteger(p.wx) && Number.isInteger(p.wy)))
    }
    // the towns listed, and only those
    assert.equal(world.heard.size, list.length)
  }
  assert.equal(RIDE_SECONDS, 4)
  assert.equal(LEAGUE_CLOCK, 1 / 24)
})

test('stepping on the stop boards once; standing there does not board again; stepping off and on does', () => {
  const { state } = start()
  const stop = stopOf(state, '0,0')
  assert.ok(stop, 'Koivula\'s stop is not among the window\'s stops')
  assert.equal(state.map[stop.y][stop.x].tile, TILE.FLOOR)
  const beside = N4.map(([dx, dy]) => ({ x: stop.x + dx, y: stop.y + dy })).find(p => state.map[p.y][p.x].tile === TILE.FLOOR)
  put(state, beside); assert.equal(tickCoach(state), null)
  put(state, stop); assert.deepEqual(tickCoach(state), { town: '0,0' })
  assert.equal(tickCoach(state), null)
  assert.equal(tickCoach(state), null)
  put(state, beside); assert.equal(tickCoach(state), null)
  put(state, stop); assert.deepEqual(tickCoach(state), { town: '0,0' })
})

test('waking on the stop does not board, nor does standing on its cell in a cave or a house', () => {
  const { world, state, hooks } = start()
  const stop = stopOf(state, '0,0')
  const at = { X: stop.x + world.origin.wx * PIECE, Y: stop.y + world.origin.wy * PIECE }
  enterWilds(state, world, at, hooks)
  const here = stopOf(state, '0,0')
  assert.deepEqual([state.player.x, state.player.y], [here.x, here.y], 'the load did not put the player on the stop')
  assert.equal(state.coachHold, true)
  assert.equal(tickCoach(state), null)
  // underground the surface's stops are not under the player's feet
  const cave = { ...state, cave: { surface: state }, coachHold: false }
  assert.equal(tickCoach(cave), null)
})

test('arriving puts the player beside the stop, not on it, and does not board', () => {
  const { world, state, hooks } = start()
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  const town = arrive(state, world, dest, hooks)
  assert.ok(town === dest.town)
  const stop = stopOf(state, dest.town.key)
  assert.ok(stop, 'the destination\'s stop is not in the window')
  assert.equal(Math.abs(state.player.x - stop.x) + Math.abs(state.player.y - stop.y), 1, 'not beside the stop')
  assert.ok(!state.coachStops.some(s => s.x === state.player.x && s.y === state.player.y), 'standing on a stop')
  const want = stopTile(world, dest.town.key)
  assert.deepEqual(toWindow(world.origin, want.X, want.Y), { x: state.player.x, y: state.player.y })
  assert.equal(tickCoach(state), null)
  assert.equal(tickCoach(state), null)
  put(state, stop)
  assert.deepEqual(tickCoach(state), { town: dest.town.key }, 'the stop there does not board')
})

test('after a ride to a village the player wakes there', () => {
  const { world, state, hooks } = start()
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  arrive(state, world, dest, hooks)
  assert.ok(world.visited.includes(dest.town.key))
  assert.deepEqual(world.lastVillage, { wx: dest.town.wx, wy: dest.town.wy })
  const woke = wildsRespawn(state, world, hooks)
  assert.ok(woke === getPiece(world, dest.town.wx, dest.town.wy).village, `woke in ${woke?.name}, not ${dest.town.name}`)
})

test('after a ride to the city the city is visited and is where the player wakes', () => {
  const { world, state, hooks } = start()
  const dest = destinations(world, '0,0').find(d => d.town.key === 'city')
  assert.ok(dest, 'Koivula has no road to the city')
  arrive(state, world, dest, hooks)
  assert.ok(world.visited.includes('city'))
  assert.deepEqual(world.lastVillage, { wx: 0, wy: 2 })
  const stop = stopOf(state, 'city')
  assert.equal(Math.abs(state.player.x - stop.x) + Math.abs(state.player.y - stop.y), 1, 'not beside the city\'s stop')
  const woke = wildsRespawn(state, world, hooks)
  assert.equal(woke.name, 'Kalevanlinna')
})

test('the clock moves on a twenty-fourth of a day per league and playtime does not jump', () => {
  const save = { clock: DAY_LENGTH - 5 }
  const { world, state } = start(SEED, save)
  const hooks = { buildEntities, advanceClock: s => passTime(save, s) }
  world.playtime = 123.5
  world.day = 4
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  arrive(state, world, dest, hooks)
  const passed = dest.leagues * LEAGUE_CLOCK * DAY_LENGTH
  assert.ok(Math.abs(save.clock - (DAY_LENGTH - 5 + passed - DAY_LENGTH)) < 1e-9, `the clock reads ${save.clock}`)
  assert.equal(world.day, 5, 'the midnight on the way was not counted')
  assert.equal(world.playtime, 123.5)
  // a ride that does not reach midnight counts none
  const quiet = { clock: 10 }
  arrive(state, world, dest, { buildEntities, advanceClock: s => passTime(quiet, s) })
  assert.ok(Math.abs(quiet.clock - (10 + passed)) < 1e-9)
  assert.equal(world.day, 5)
  // every midnight passed is counted
  const save2 = { clock: DAY_LENGTH - 1 }
  assert.equal(passTime(save2, 2 * DAY_LENGTH + 2), 3)
  assert.ok(Math.abs(save2.clock - 1) < 1e-9)
  assert.equal(passTime({ clock: 0 }, DAY_LENGTH / 2), 0)
})

test('the coachman refuses a wanted player, a chased one and a bound one', () => {
  const state = { player: { x: 50, y: 50, px: 50 * 32 + 16, py: 50 * 32 + 16, hp: 5, maxHp: 5 }, entities: [] }
  assert.equal(refusal(state), null)
  state.cityRun = { crime: { level: 'warned' } }
  assert.equal(refusal(state), null, 'a warning is not wanted')
  state.cityRun.crime.level = 'wanted'
  assert.equal(refusal(state), 'wanted')
  state.cityRun.crime.level = 'calm'
  const foe = (dx, extra = {}) => ({ type: 'monster', variant: 'weak', x: 50 + dx, y: 50, px: (50 + dx) * 32 + 16, py: 50 * 32 + 16, hp: 3, maxHp: 3, ai: { mode: 'chase' }, ...extra })
  state.entities = [foe(5)]
  assert.equal(refusal(state), 'chased')
  state.entities = [foe(HOSTILE_REACH)]
  assert.equal(refusal(state), 'chased', 'at the edge of the reach')
  state.entities = [foe(HOSTILE_REACH + 1)]
  assert.equal(refusal(state), null, 'too far to count')
  state.entities = [foe(4, { ai: { mode: 'patrol' } })]
  assert.equal(refusal(state), null, 'one that has not noticed the player')
  state.entities = [foe(4, { hp: 0 })]
  assert.equal(refusal(state), null, 'a dead one')
  state.entities = [foe(4, { ai: { mode: 'hunt', lastSeen: { x: 50, y: 50 } } })]
  assert.equal(refusal(state), 'chased', 'one hunting the player')
  state.entities = [{ type: 'npc', species: 'wolf', hostile: true, x: 53, y: 50, hp: 3, ai: { mode: 'chase' } }]
  assert.equal(refusal(state), 'chased', 'a wolf on the player\'s heels')
  state.entities = [{ type: 'npc', species: 'villager', hostile: false, x: 51, y: 50, hp: 3, ai: { mode: 'chase' } }]
  assert.equal(refusal(state), null, 'a villager is no hostile')
  state.entities = []
  for (const bind of [{ ice: { t: 1, dur: 1 } }, { held: { by: {}, presses: 0 } }, { stocks: { t: 9 } }, { trance: 30 }, { tranceFade: 2 }]) {
    const s = { ...state, player: { ...state.player, ...bind } }
    assert.equal(refusal(s), 'bound', JSON.stringify(Object.keys(bind)))
  }
  assert.equal(refusal({ ...state, rite: { t: 0 } }), 'bound', 'in the rite')
  assert.equal(refusal({ ...state, tripPull: { t: 0 } }), 'bound', 'being pulled to the ring')
  // wanted outranks the rest
  assert.equal(refusal({ ...state, cityRun: { crime: { level: 'wanted' } }, entities: [foe(3)], player: { ...state.player, ice: { t: 1 } } }), 'wanted')
  assert.deepEqual(REFUSAL_LINES, { wanted: 'Not with the watch after you.', chased: 'Not with that at your heels.', bound: 'Sit up first.' })
})

// Fix round of Task 8's review: inCombat is set by a blow and never cleared,
// so where a brain keeps watch (ai.mode) its word is the one that counts.
test('a foe whose brain has lost the player does not stop the coach, though it once fought them', () => {
  const state = { player: { x: 50, y: 50, px: 50 * 32 + 16, py: 50 * 32 + 16, hp: 5, maxHp: 5 }, entities: [] }
  const foe = extra => ({ type: 'monster', variant: 'weak', x: 54, y: 50, px: 54 * 32 + 16, py: 50 * 32 + 16, hp: 3, maxHp: 3, inCombat: true, ...extra })
  state.entities = [foe({ ai: { mode: 'patrol', lastSeen: null } })]
  assert.equal(refusal(state), null, 'back on its rounds')
  state.entities = [foe({ ai: { mode: 'hunt', lastSeen: null } })]
  assert.equal(refusal(state), null, 'wandering with no trace of the player')
  state.entities = [foe({ ai: { mode: 'chase' }, inCombat: false })]
  assert.equal(refusal(state), 'chased', 'the brain sees the player')
  // with no brain to ask, a foe in a fight still counts
  state.entities = [foe({ ai: undefined })]
  assert.equal(refusal(state), 'chased', 'a brainless foe in a fight')
  state.entities = [foe({ ai: undefined, inCombat: false })]
  assert.equal(refusal(state), null, 'a brainless foe at peace')
  // an npc's own ai record (npc.js) is no brain until the enemy brain has run on it
  state.entities = [{ type: 'npc', species: 'wolf', hostile: true, x: 53, y: 50, hp: 3, inCombat: true, ai: { current: null, goals: {} } }]
  assert.equal(refusal(state), 'chased', 'a wolf that bit the player, its brain not yet run')
  state.entities = [{ type: 'npc', species: 'wolf', hostile: true, x: 53, y: 50, hp: 3, inCombat: true, ai: { current: null, goals: {}, mode: 'patrol', lastSeen: null } }]
  assert.equal(refusal(state), null, 'a wolf that has given up')
})

test('rideAt starts on the first town, ends on the second and passes every piece of the route', () => {
  const world = makeWorld(null, { seed: SEED })
  const routes = [...destinations(world, '0,0'), ...destinations(world, 'city')].map(d => d.route)
  assert.ok(routes.some(r => r.length >= 4), 'no long route to look at')
  const pieceAt = p => ({ wx: Math.floor(p.X / PIECE), wy: Math.floor(p.Y / PIECE) })
  for (const route of routes) {
    const first = rideAt(route, 0), last = rideAt(route, 1)
    assert.deepEqual(pieceAt(first), { wx: route[0].wx, wy: route[0].wy })
    assert.deepEqual(pieceAt(last), { wx: route.at(-1).wx, wy: route.at(-1).wy })
    assert.deepEqual([first.X, first.Y], [route[0].wx * PIECE + PIECE / 2, route[0].wy * PIECE + PIECE / 2], 'not at the first piece\'s centre')
    const seen = []
    for (let i = 0; i <= 400; i++) {
      const p = pieceAt(rideAt(route, i / 400))
      if (!seen.length || seen.at(-1).wx !== p.wx || seen.at(-1).wy !== p.wy) seen.push(p)
    }
    assert.deepEqual(seen, route.map(p => ({ wx: p.wx, wy: p.wy })))
    assert.deepEqual(rideAt(route, -1), first)
    assert.deepEqual(rideAt(route, 2), last)
  }
})

test('the coachman\'s mark reaches his entity, as lines and hears do', () => {
  const SRC = fs.readFileSync(new URL('../renderer/game.js', import.meta.url), 'utf8')
  assert.match(SRC, /if \(n && s\.coachman\) n\.coachman = true/)
})
