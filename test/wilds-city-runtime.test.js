// Kalevanlinna's town at play: the runtime that owns every person and animal,
// runs the near ones as npc entities and walks the far ones along their routes
// (wilds/city/runtime.js). The window is built by session.js as in the game;
// only buildEntities is a stand-in, making npcs the way game.js does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arriveCity, tickCity, cityPeople, occupantsOf, noteCitySwing, nearRadius, FAR_SPEED, ROUTES_PER_TICK, fracOf } from '../renderer/wilds/city/runtime.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { fromCity } from '../renderer/wilds/city/geometry.js'
import { rollTownsfolk } from '../renderer/wilds/city/folk.js'
import { scheduleFor } from '../renderer/wilds/city/schedule.js'
import { makeWorld, exportWorld, getPiece } from '../renderer/wilds/world.js'
import { shiftState } from '../renderer/wilds/shift.js'
import { assemble } from '../renderer/wilds/window.js'
import { enterWilds, tickWilds } from '../renderer/wilds/session.js'
import { toWorld, toWindow } from '../renderer/wilds/window.js'
import { PIECE } from '../renderer/wilds/layout.js'
import { makeNpc, updateNpc, onNpcHit, FLEE_TIME } from '../renderer/systems/npc.js'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'
import { applyBurst, updateFireZones, makeFireZone, FIRE_TICK_DAMAGE } from '../renderer/systems/fire.js'
import { applyShockwave } from '../renderer/systems/shockwave.js'
import { cityCtx, makeWalker, placeByClock, setEntry, routeWalker, stepFar } from '../renderer/wilds/city/walkers.js'
import { buildCaveState, restoreSurface, adventureRespawn } from '../renderer/systems/cave.js'
import { snapshotWilds } from '../renderer/wilds/session.js'
import { buildBuilding } from '../renderer/interior/buildings/index.js'
import { makeBuilding, stairAt, travel as travelFloor } from '../renderer/interior/floors.js'
import { entryAt } from '../renderer/wilds/city/schedule.js'

const SEED = 7
const S = 32
const DT = 0.05
// What game.js's buildEntities does with an npc spawn, minus the art.
const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
  return [{ type: s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
})
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5 }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(), caveInstances: {},
  sfx: { cues: [], muted: false },
})
const FOUNTAIN = { X: 79, Y: 236 }   // a step south of the fountain (city 79,74)
const NORTH_GATE = { X: 80, Y: 185 }   // inside the north gate, far from the square

function setup({ at = FOUNTAIN, clock = 0.5 * DAY_LENGTH, day = 0, view = { w: 20, h: 12 }, world = null } = {}) {
  world ??= makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, at, { buildEntities })
  const T = { clock, day, view }
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: () => {}, hurt: () => {},
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T }
}
// the frame loop's share: the runtime, then every near person's goals
function run(ctx, seconds, { npcs = true } = {}) {
  const { state, world, hooks, T } = ctx
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    T.clock = (T.clock + DT) % DAY_LENGTH
    tickCity(state, world, DT, hooks)
    if (npcs) for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, DT)
  }
}
const cityEntities = state => state.entities.filter(e => e.cityKey !== undefined)
const entityWorld = (world, e) => ({ X: e.px / S - 0.5 + world.origin.wx * PIECE, Y: e.py / S - 0.5 + world.origin.wy * PIECE })
const cheb = (a, b) => Math.max(Math.abs(a.X - b.X), Math.abs(a.Y - b.Y))
const playerWorld = (state, world) => toWorld(world.origin, state.player.x, state.player.y)
function placePlayer(state, world, X, Y) {
  const { x, y } = toWindow(world.origin, X, Y)
  state.player.x = x; state.player.y = y; state.player.px = x * S + 16; state.player.py = y * S + 16
}
// What session.js recentre does to the state, minus recording pieces: drop
// whatever stands in a piece that leaves, shift every position, lay the new window.
function fakeRecentre(state, world, dx, dy) {
  const old = world.origin, next = { wx: old.wx + dx, wy: old.wy + dy }
  const stays = (wx, wy) => wx >= next.wx && wx <= next.wx + 2 && wy >= next.wy && wy <= next.wy + 2
  state.entities = state.entities.filter(e => { const { X, Y } = toWorld(old, e.x, e.y); return stays(Math.floor(X / PIECE), Math.floor(Y / PIECE)) })
  shiftState(state, -dx * PIECE, -dy * PIECE)
  world.origin = next
  state.map = assemble(Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => getPiece(world, next.wx + c, next.wy + r))))
}
function assertOnce(state) {
  const keys = cityEntities(state).map(e => e.cityKey)
  assert.equal(new Set(keys).size, keys.length, 'no city entity twice')
  const people = cityPeople(state)
  assert.equal(people.length, 140)
  assert.equal(new Set(people.map(p => p.id)).size, 140)
  for (const p of people) assert.equal(keys.filter(k => k === p.id).length, p.mode === 'near' ? 1 : 0, `${p.id} ${p.mode}`)
  return people
}

test('arriving twice builds each person once', () => {
  const ctx = setup()
  const { state, world, hooks } = ctx
  arriveCity(state, world, hooks); arriveCity(state, world, hooks)
  const people = assertOnce(state)
  const near = people.filter(p => p.mode === 'near')
  assert.ok(near.length >= 10, `people about the square at noon (${near.length})`)
  assert.ok(people.some(p => p.mode === 'indoors') && people.some(p => p.mode === 'far'))
  // a spawned person carries who they are
  const tf = cityEntities(state).find(e => e.cityKey.startsWith('tf:'))
  assert.equal(tf.type, 'npc'); assert.equal(tf.species, 'townsfolk'); assert.equal(tf.id, tf.cityKey)
  assert.ok(typeof tf.look === 'string' && tf.lines.length >= 1 && tf.city.person.id === tf.cityKey)
  // arriving afresh on the same state (a load, a wake) rebuilds once, too
  arriveCity(state, world, hooks, { fresh: true })
  arriveCity(state, world, hooks, { fresh: true })
  assertOnce(state)
  run(ctx, 2)
  assertOnce(state)
})

test('a re-centre that drops people keeps them all', () => {
  // the widest screen (radius 50): people near the player stand in the piece column east of the square
  const ctx = setup({ view: { w: 60, h: 40 } })
  const { state, world, hooks } = ctx
  run(ctx, 1)
  const before = new Map(cityPeople(state).map(p => [p.id, p]))
  const east = cityEntities(state).filter(e => e.city && entityWorld(world, e).X >= 80)
  assert.ok(east.length >= 3, `someone stands east of the seam (${east.length})`)
  const lastAt = new Map(east.map(e => [e.cityKey, entityWorld(world, e)]))
  // the window steps west: recentre's own filter drops that column with everyone in it
  fakeRecentre(state, world, -1, 0)
  assert.equal(cityEntities(state).some(e => lastAt.has(e.cityKey)), false, 'they went with the column')
  arriveCity(state, world, hooks)
  let people = assertOnce(state)
  for (const [id, at] of lastAt) {
    const p = people.find(q => q.id === id)
    assert.equal(p.mode, 'far', `${id} walks on out of the window`)
    assert.ok(cheb(p, at) <= 1, `${id} kept where it stood`)
    assert.equal(p.out, false, 'not taken for struck down')
  }
  assert.equal(people.length, before.size)
  run(ctx, 1, { npcs: false })
  // and back east: they come near again where they walked to, once each
  fakeRecentre(state, world, 1, 0)
  arriveCity(state, world, hooks)
  people = assertOnce(state)
  for (const id of lastAt.keys()) assert.notEqual(people.find(q => q.id === id).out, true)

  // and a real re-centre: walk 25 tiles into the piece east of the square
  placePlayer(state, world, 104, 236)
  const { recentred } = tickWilds(state, world, DT, { buildEntities })
  assert.deepEqual(recentred, { dx: 1, dy: 0 })
  arriveCity(state, world, hooks)
  const after = assertOnce(state)
  // shiftState moved the entities; the runtime keeps world tiles: they agree
  for (const e of cityEntities(state).filter(q => q.city)) {
    const p = after.find(q => q.id === e.cityKey)
    assert.ok(cheb(entityWorld(world, e), p) < 0.5, `${e.cityKey} agrees after the shift`)
  }
  run(ctx, 1)
  assertOnce(state)
})

test('far people move along their routes; nobody teleports when they come near', () => {
  // 07:30 of a city day: the town is setting out to work
  const ctx = setup({ clock: 0.23 * DAY_LENGTH, view: { w: 4, h: 4 } })
  const { state, world } = ctx
  assert.equal(nearRadius({ w: 4, h: 4 }), 10)
  const going = () => cityPeople(state).filter(p => p.mode === 'far' && p.going)
  const was = new Map(going().map(p => [p.id, p]))
  assert.ok(was.size >= 10, `people on their way (${was.size})`)
  run(ctx, 1, { npcs: false })
  const moved = []
  for (const p of cityPeople(state)) {
    const q = was.get(p.id)
    if (!q || p.mode !== 'far') continue
    const d = Math.hypot(p.X - q.X, p.Y - q.Y)
    assert.ok(d <= FAR_SPEED + 0.05, `${p.id} walks, it does not jump (${d.toFixed(2)})`)
    moved.push(d)
  }
  moved.sort((a, b) => a - b)
  assert.ok(moved[moved.length >> 1] >= 1.2, `they walk at about ${FAR_SPEED} tiles/s (median ${moved[moved.length >> 1]})`)

  // stand 13 tiles from one walker, then widen the screen: it is built where it was
  const target = going().find(p => cheb(p, playerWorld(state, world)) > 20)
  placePlayer(state, world, Math.round(target.X) + 13, Math.round(target.Y))
  run(ctx, DT, { npcs: false })
  const far = cityPeople(state).find(p => p.id === target.id)
  assert.equal(far.mode, 'far')
  ctx.T.view = { w: 12, h: 12 }   // radius 18
  run(ctx, DT, { npcs: false })
  const e = cityEntities(state).find(q => q.cityKey === target.id)
  assert.ok(e, 'it came near')
  assert.ok(cheb(entityWorld(world, e), far) <= 1, 'built at its far position')
  // and back: narrowing the screen leaves it far at the entity's position
  for (let i = 0; i < 5; i++) run(ctx, DT)
  const at = entityWorld(world, cityEntities(state).find(q => q.cityKey === target.id))
  ctx.T.view = { w: 4, h: 4 }
  run(ctx, DT, { npcs: false })
  const back = cityPeople(state).find(p => p.id === target.id)
  assert.equal(back.mode, 'far')
  assert.ok(cheb(back, at) <= 0.2)
  assert.equal(cityEntities(state).some(q => q.cityKey === target.id), false)
})

test('people go indoors and come out by their schedule', () => {
  const city = cityFor(SEED)
  const folk = rollTownsfolk(SEED, city)
  const doorOf = Object.fromEntries(city.doors.map(d => [d.label, d]))
  // someone who walks into a building and comes out to a spot later
  let who = null
  for (const p of folk) {
    const s = scheduleFor(p, city, SEED, 0)
    const i = s.findIndex((e, k) => k > 0 && e.where.door && s[k - 1].where.spot && s[k + 1]?.where.spot && s[k + 1].at - e.at > 0.08)
    if (i > 0) { who = { p, s, i }; break }
  }
  assert.ok(who, 'such a person')
  const { p, s, i } = who
  const label = s[i].where.door
  for (const near of [false, true]) {
    const door = doorOf[label]
    const dw = fromCity(door.x, door.y)
    const ctx = setup({ clock: s[i].at * DAY_LENGTH + 0.2, view: near ? { w: 40, h: 24 } : { w: 2, h: 2 },
      at: near ? { X: dw.X, Y: dw.Y + 1 } : NORTH_GATE })
    const { state } = ctx
    const me = () => cityPeople(state).find(q => q.id === p.id)
    let inside = me().mode === 'indoors'
    for (let t = 0; t < (s[i + 1].at - s[i].at) * DAY_LENGTH - 2 && !inside; t += 0.5) {
      run(ctx, 0.5, { npcs: near })
      inside = me().mode === 'indoors'
    }
    assert.ok(inside, `${p.id} went in (${near ? 'near' : 'far'})`)
    assert.equal(me().door, label)
    assert.ok(occupantsOf(state, label).some(q => q.id === p.id))
    assert.equal(cityEntities(state).some(e => e.cityKey === p.id), false)
    ctx.T.clock = s[i + 1].at * DAY_LENGTH + 0.01
    run(ctx, DT, { npcs: near })
    const out = me()
    assert.notEqual(out.mode, 'indoors', 'out again when the next entry starts')
    assert.ok(cheb(out, dw) <= 2, 'out of that door')
    assert.equal(occupantsOf(state, label).some(q => q.id === p.id), false)
    if (near) assert.ok(cityEntities(state).some(e => e.cityKey === p.id), 'seen coming out')
  }
})

// The service (schedule.js SERVICE): those going into the church set out as
// the bell starts ringing, arrive from across the town over the next minute
// and stay until just before the door shuts at dusk.
test('the bell fills the church: the pews full late in the service, empty after dusk', t => {
  for (const seed of [7, 1, 4242]) {
    const ctx = setup({ clock: 0.55 * DAY_LENGTH, world: makeWorld(null, { seed }) })
    const church = cityFor(seed).doors.find(d => d.kind === 'church').label
    const inside = () => occupantsOf(ctx.state, church).length
    run(ctx, (0.69 - 0.55) * DAY_LENGTH)
    const service = inside()
    assert.ok(service >= 15, `seed ${seed}: ${service} in the church at 0.69`)
    run(ctx, (0.76 - 0.69) * DAY_LENGTH)
    const after = inside()
    t.diagnostic(`seed ${seed}: ${service} in the church at 0.69, ${after} at 0.76`)
    assert.ok(after < 5, `seed ${seed}: ${after} still in at 0.76`)
  }
})

test('save inside a house, load: the doorstep, the town rebuilt once', () => {
  const city = cityFor(SEED)
  const door = city.doors.find(d => d.kind === 'home' && Math.abs(d.x - 79) < 30 && Math.abs(d.y - 74) < 30)
  const saved = makeWorld(null, { seed: SEED })
  saved.pos = fromCity(door.x, door.y)   // snapshotWilds keeps the surface: the doorstep
  const world = makeWorld(JSON.parse(JSON.stringify(exportWorld(saved))), { seed: 1 })
  const ctx = setup({ world, at: world.pos })
  const { state, hooks } = ctx
  assert.equal(state.entranceHold, true, 'waking on the doorstep does not walk you back in')
  assert.deepEqual(playerWorld(state, world), saved.pos)
  arriveCity(state, world, hooks)
  assertOnce(state)
  run(ctx, 1)
  assertOnce(state)
})

test('save inside a building, on another floor: the record is the doorstep, a wake has no cave', () => {
  const ctx = setup()
  const { state, world } = ctx
  const doorstep = toWorld(world.origin, state.player.x, state.player.y)
  const built = buildBuilding('church', { seed: SEED, people: [] })
  const floors = built.floors.map(f => ({
    id: f.id, map: f.map, entities: buildEntities(f.entitySpawns),
    stairs: f.stairs, shut: f.shut, spawn: f.playerSpawn, exit: f.exit,
  }))
  const building = makeBuilding(floors, built.ground)
  const ground = building.floors.get(built.ground)
  let inside = buildCaveState(state, { x: state.player.x, y: state.player.y, caveDepth: 19, label: 'house:test' }, {
    map: ground.map, entities: ground.entities, playerSpawn: ground.spawn, exit: ground.exit, theme: built.theme,
  })
  inside.cave.building = building
  inside = travelFloor(inside, ground.stairs.find(s => s.to.floor === 'tower'))
  assert.equal(inside.cave.building.at, 'tower', 'the player stands on another floor')
  assert.notDeepEqual([inside.player.x, inside.player.y], [state.player.x, state.player.y])
  // the save reads the surface, not the floor
  assert.deepEqual(snapshotWilds(inside, world).pos, doorstep)
  // leaving, and a wake or respawn, give a surface state with no cave
  const out = restoreSurface(inside)
  assert.equal(out.cave, undefined)
  assert.deepEqual([out.player.x, out.player.y], [state.player.x, state.player.y])
  const woken = adventureRespawn(inside, { x: state.player.x, y: state.player.y })
  assert.equal(woken.cave, undefined)
  assert.equal(woken.map, state.map, 'the surface map, not a floor')
})

test('the near radius follows the screen', () => {
  assert.equal(nearRadius({ w: 40, h: 20 }), 46)
  assert.equal(nearRadius({ w: 12, h: 20 }), 26)
  const ctx = setup({ view: { w: 40, h: 20 } })
  const { state, world } = ctx
  run(ctx, 0.5)
  assert.equal(state.cityRun.nearR, 46)
  const me = playerWorld(state, world)
  const wide = cityPeople(state)
  for (const p of wide) {
    if (p.mode === 'near') assert.ok(cheb(p, me) <= 46 + 2 + 0.5, p.id)
    if (p.mode === 'far') assert.ok(cheb(p, me) > 46, p.id)
  }
  ctx.T.view = { w: 8, h: 5 }
  run(ctx, 0.5)
  assert.equal(state.cityRun.nearR, 14)
  const narrow = cityPeople(state)
  for (const p of narrow) if (p.mode === 'near') assert.ok(cheb(p, me) <= 16.5, p.id)
  assert.ok(narrow.filter(p => p.mode === 'near').length < wide.filter(p => p.mode === 'near').length)
})

// an open 20x12 floor for one townsperson and the player
function street() {
  const map = createMap(20, 12)
  for (let y = 1; y < 11; y++) for (let x = 1; x < 19; x++) map[y][x].tile = TILE.FLOOR
  return map
}

test('townsfolk give way to a player standing in their path, and step back from a swing', () => {
  const map = street()
  const e = makeNpc({ species: 'townsfolk', id: 'tf:0', x: 4, y: 5 })
  e.cityKey = 'tf:0'
  e.city = { next: { x: 9, y: 5 }, entry: null, person: null }
  const player = { type: 'player', x: 9, y: 5, px: 9 * S + 16, py: 5 * S + 16, hp: 5, maxHp: 5 }
  const state = { map, player, entities: [e], feedback: makeFeedback(), sfx: { cues: [], muted: false } }
  const step = sec => { for (let t = 0; t < sec - 1e-9; t += DT) updateNpc(e, state, DT) }
  step(2)   // five tiles at 70 px/s, less the last 1.6: there in about 1.55 s
  assert.equal(e.ai.current, 'follow_city')
  const waitAt = { px: e.px, py: e.py }
  assert.ok(Math.hypot(e.px - player.px, e.py - player.py) <= 1.6 * S, 'comes up to the player')
  assert.ok(Math.abs(e.py - 5.5 * S) < 4, 'on the straight line')
  step(0.3)
  assert.ok(Math.hypot(e.px - waitAt.px, e.py - waitAt.py) < 2, 'and waits')
  let t = 0
  while (!e.city.passed && t < 3) { step(DT); t += DT }
  assert.equal(e.city.passed, true, 'then goes round, and tells the runtime')
  assert.ok(t > 0.1 && t < 2.5, `after about a second (${t.toFixed(2)})`)
  assert.ok(Math.abs(e.py - 5.5 * S) >= S * 0.7, `a step aside (${(e.py / S).toFixed(2)})`)

  // a swing in the town: the townsperson within 3 tiles steps back two and says so
  const ctx = setup({ view: { w: 20, h: 12 } })
  const { state: st, world, hooks } = ctx
  run(ctx, 0.5)
  const tf = cityEntities(st).find(q => q.species === 'townsfolk' && !q.ai.fleeTimer)
  const at = entityWorld(world, tf)
  // the player two tiles west of them, on whatever floor is there
  const px = Math.round(at.X) - 2, py = Math.round(at.Y)
  placePlayer(st, world, px, py)
  noteCitySwing(st, world)
  tickCity(st, world, DT, hooks)
  assert.equal(st.feedback.bubble?.text, 'Careful with that!')
  assert.ok(tf.city.next, 'it has somewhere to step to')
  const nextW = toWorld(world.origin, tf.city.next.x, tf.city.next.y)
  assert.ok(cheb(nextW, { X: px, Y: py }) >= cheb(at, { X: px, Y: py }), 'away from the swing')
  const watch = cityEntities(st).find(q => q.species === 'watchman')
  if (watch) assert.notEqual(st.feedback.bubble.anchorId, watch.id, 'the watch does not flinch')
  // a swing inside a house (whose state carries the surface's fields) is not seen in the street
  noteCitySwing({ ...st, cave: { surface: st } }, world)
  assert.equal(st.cityRun.swingAt, null)
})

test('dogs, cats and yard animals are there and owned by the city', () => {
  const ctx = setup({ view: { w: 60, h: 40 } })
  const { state, world, hooks } = ctx
  const animals = [...state.cityRun.animals.values()]
  const count = sp => animals.filter(a => a.species === sp).length
  assert.equal(count('dog'), 6); assert.equal(count('cat'), 6)
  assert.ok(count('city_chicken') >= 3 && count('city_goat') >= 1, 'chickens and goats in the yards')
  for (const sp of ['dog', 'cat', 'city_chicken', 'city_goat']) {
    assert.equal(NPC_SPECIES[sp].faction, 'city'); assert.equal(NPC_SPECIES[sp].onHit, 'flee')
  }
  assert.equal(NPC_SPECIES.dog.roam, 6); assert.equal(NPC_SPECIES.cat.roam, 6)
  const pets = cityEntities(state).filter(e => e.species === 'dog' || e.species === 'cat')
  assert.ok(pets.length >= 3, 'some are near the square')
  for (const e of pets) assert.match(e.look, /^(dog|cat)_\d$/)
  // a kick at a dog: it runs, and nobody else in town turns
  const dog = pets.find(e => e.species === 'dog') ?? pets[0]
  dog.hp -= 1
  const r = onNpcHit(dog, state)
  assert.equal(r.wrath, false); assert.ok(dog.ai.fleeTimer >= FLEE_TIME - 1e-9)
  assert.equal(state.npcWrath, undefined)
  assert.equal(cityEntities(state).some(e => e.hostile), false)
  // they live through a re-centre's drop like the people
  const keysBefore = animals.map(a => a.id).sort()
  const gone = state.entities.filter(e => /^(dog|cat|hen|goat):/.test(e.cityKey ?? ''))
  assert.ok(gone.length >= 3)
  state.entities = state.entities.filter(e => !gone.includes(e))
  arriveCity(state, world, hooks)
  assert.deepEqual([...state.cityRun.animals.keys()].sort(), keysBefore)
  const keys = cityEntities(state).map(e => e.cityKey)
  assert.equal(new Set(keys).size, keys.length)
  run(ctx, 1)
  assert.equal(new Set(cityEntities(state).map(e => e.cityKey)).size, cityEntities(state).length)
})

test('a watchman stands his ground when struck; the city shares no wrath', () => {
  // telling the player a part of the Sampo's story (wilds/city/sampo-run.js) comes before a scene, and a scene's
  // goals (wilds/city/scenes.js) before their day: talk, tag, the stocks' crowd, carrying, a drunk's walk
  assert.deepEqual(NPC_SPECIES.townsfolk.priorities, ['flee_hurt', 'tell', 'play_tag', 'talk', 'gawk', 'carry', 'stagger', 'follow_city', 'at_scene', 'wander'])
  assert.deepEqual(NPC_SPECIES.watchman.priorities, ['attack_hostile', 'defend', 'follow_city', 'stay'])
  const map = street()
  const w = makeNpc({ species: 'watchman', id: 'watch:0', x: 5, y: 5 })
  const t = makeNpc({ species: 'townsfolk', id: 'tf:1', x: 7, y: 5 })
  const v = makeNpc({ species: 'villager', id: 'npc:v', x: 9, y: 5 })
  const state = { map, player: { x: 1, y: 1, px: 48, py: 48 }, entities: [w, t, v] }
  w.hp -= 5
  const r = onNpcHit(w, state)
  assert.equal(w.hostile, false); assert.equal(w.ai.fleeTimer, 0); assert.equal(r.wrath, false)
  t.hp -= 1
  assert.equal(onNpcHit(t, state).wrath, false)
  assert.equal(v.hostile, false); assert.equal(state.npcWrath, undefined)
  assert.ok(t.ai.fleeTimer > 0, 'a townsperson runs')
})

test('leaving the city behind drops its people; coming back puts them where the clock says', () => {
  const ctx = setup()
  const { state, world, hooks } = ctx
  assert.ok(cityEntities(state).length > 0)
  // a window with no city piece in it (Koivula's)
  enterWilds(state, world, { wx: 0, wy: 0 }, { buildEntities })
  state.entities.push(...cityEntities({ entities: [{ cityKey: 'tf:1', type: 'npc' }] }))   // a straggler
  arriveCity(state, world, hooks)
  assert.equal(state.cityRun, undefined)
  assert.equal(cityEntities(state).length, 0)
  tickCity(state, world, DT, hooks)   // and nothing runs
  // walking back: the city comes into the window a piece away (here: the
  // window round the piece north of it), and its people are placed a few a frame
  enterWilds(state, world, { wx: 0, wy: 1 }, { buildEntities })
  arriveCity(state, world, hooks)
  assert.equal(cityPeople(state).filter(p => p.pending).length, 140, 'nobody placed in the frame of the re-centre')
  run(ctx, 0.2, { npcs: false })
  assert.ok(cityPeople(state).filter(p => p.pending).length > 0, 'a few a frame')
  run(ctx, 1, { npcs: false })
  const people = assertOnce(state)
  assert.equal(people.filter(p => p.pending).length, 0)
  const me = playerWorld(state, world)
  assert.ok(people.every(p => p.mode !== 'near' && cheb(p, me) > state.cityRun.nearR), 'all out of reach while they were placed')
  // and placed where the clock says: the same as a fresh arrival would
  const lazy = new Map(people.map(p => [p.id, p]))
  arriveCity(state, world, hooks, { fresh: true })
  let same = 0
  for (const p of cityPeople(state)) if (p.mode === lazy.get(p.id).mode && cheb(p, lazy.get(p.id)) <= 2.5) same++
  assert.ok(same >= 130, `placed alike (${same})`)
  enterWilds(state, world, FOUNTAIN, { buildEntities })
  arriveCity(state, world, hooks, { fresh: true })
  assertOnce(state)
})

test('someone struck down is at home until the next day, never raised where they fell', () => {
  const ctx = setup()
  const { state, world, hooks, T } = ctx
  const e = cityEntities(state).find(q => q.species === 'townsfolk')
  const dog = cityEntities(state).find(q => q.species === 'dog' || q.species === 'cat')
  e.hp = 0
  if (dog) dog.hp = 0
  state.entities = state.entities.filter(q => q.hp > 0)   // the game culls the dead
  run(ctx, 1)
  const p = cityPeople(state).find(q => q.id === e.cityKey)
  assert.equal(p.mode, 'indoors'); assert.equal(p.door, e.city.person.home); assert.equal(p.out, true)
  assert.equal(cityEntities(state).some(q => q.cityKey === e.cityKey), false)
  if (dog) assert.equal(cityEntities(state).some(q => q.cityKey === dog.cityKey), false)
  assertOnce(state)
  // the next day they are about again (where the clock says)
  T.day = 1
  run(ctx, DT)
  assert.equal(cityPeople(state).find(q => q.id === e.cityKey).out, false)
  assert.equal(state.cityRun.animals.get(dog?.cityKey)?.gone ?? false, false)
})

// Fire and the Maunonmiekka's shockwave hand back a copy of whatever they hurt
// ({ ...e, hp }) and cull the dead copies: the same person either way.
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b): a failing strict equal makes Node diff both sides
// inspected at depth 1000, and a city npc's ai.goals reaches the whole city
// (115k lines), so the diff grows without end and took WSL down twice.
test('fire and the shockwave hurt townsfolk like a blow: the hurt keep their hurt, the killed go home', () => {
  const ctx = setup()
  const { state } = ctx
  const tileOf = e => [{ x: Math.floor(e.px / S), y: Math.floor(e.py / S) }]
  const spread = cityEntities(state).filter(e => e.species === 'townsfolk')
    .filter((e, i, all) => all.findIndex(o => Math.abs(o.x - e.x) <= 3 && Math.abs(o.y - e.y) <= 3) === i)
  assert.ok(spread.length >= 3, 'three townsfolk apart from each other')
  const [a, b, c] = spread
  const home = c.city.person.home

  // a fire tick: a copy one hp down stands in its place, and runs
  const fz = updateFireZones([{ ...makeFireZone(tileOf(a)), tickTimer: 0 }], state.entities, state.player, 0.01)
  state.entities = fz.entities
  const copy = state.entities.find(e => e.cityKey === a.cityKey)
  assert.ok(copy !== a, 'the fire hands back a copy'); assert.equal(copy.hp, a.maxHp - FIRE_TICK_DAMAGE)
  onNpcHit(copy, state)   // what game.js does for every npc a splash struck
  run(ctx, DT)
  let now = cityEntities(state).filter(e => e.cityKey === a.cityKey)
  assert.equal(now.length, 1); assert.ok(now[0] === copy, 'the copy is the person now')
  assert.equal(now[0].hp, a.maxHp - FIRE_TICK_DAMAGE); assert.ok(now[0].ai.fleeTimer > 0, 'and still running')
  run(ctx, 0.5)
  now = cityEntities(state).filter(e => e.cityKey === a.cityKey)
  assert.equal(now.length, 1); assert.equal(now[0].hp, a.maxHp - FIRE_TICK_DAMAGE)

  // a fireball burst that kills, and a shockwave that kills: home until the next day
  state.entities = applyBurst(state.entities, state.player, tileOf(b)).entities
  state.entities = applyShockwave(state.entities, c.px, c.py).entities
  run(ctx, DT)
  for (const dead of [b, c]) {
    const p = cityPeople(state).find(q => q.id === dead.cityKey)
    assert.equal(p.mode, 'indoors', `${dead.cityKey} is not raised where they fell`); assert.equal(p.out, true)
    assert.equal(cityEntities(state).some(e => e.cityKey === dead.cityKey), false)
  }
  run(ctx, 1)
  for (const dead of [b, c]) assert.equal(cityEntities(state).some(e => e.cityKey === dead.cityKey), false, 'nor a second later')
  assertOnce(state)
  // nobody finds the struck down at home
  assert.equal(occupantsOf(state, home).some(q => q.id === c.cityKey), false)

  // a dog in the fire: the same, the copy kept
  const dog = cityEntities(state).find(e => e.species === 'dog' || e.species === 'cat')
  if (dog) {
    state.entities = updateFireZones([{ ...makeFireZone(tileOf(dog)), tickTimer: 0 }], state.entities, state.player, 0.01).entities
    const hurtDog = state.entities.find(e => e.cityKey === dog.cityKey)
    run(ctx, DT)
    assert.ok(cityEntities(state).find(e => e.cityKey === dog.cityKey) === hurtDog, 'the hurt copy is the animal now')
    assert.equal(hurtDog.hp, dog.maxHp - FIRE_TICK_DAMAGE)
  }
})

test('a route that cannot be found is asked for again only every two seconds', () => {
  const ctx = setup()
  const { state, world } = ctx
  const run0 = state.cityRun
  const e = cityEntities(state).find(q => q.species === 'townsfolk')
  const w = run0.people.get(e.cityKey)
  // a cell no street reaches, well away from them
  const G = run0.cc.G
  let nowhere = null
  for (let i = 0; i < 160 * 160 && !nowhere; i++) {
    const x = i % 160, y = (i / 160) | 0
    if (G.snapDist[i] < 0 && Math.hypot(x - (w.X - 0), y + 160 - w.Y) > 20 && x > 30 && x < 130 && y > 30 && y < 120) nowhere = { x, y }
  }
  w.goal = { key: 's:nowhere', kind: 'spot', tile: nowhere }
  w.needRoute = true; run0.queue.push(w)
  const n0 = run0.stats.noRoute.length
  run(ctx, 1.5)
  assert.equal(run0.stats.noRoute.length - n0, 1, 'one try in a second and a half')
  run(ctx, 3)
  assert.ok(run0.stats.noRoute.length - n0 <= 3, `then one every two seconds (${run0.stats.noRoute.length - n0})`)
  assert.ok(world.origin)
})

test('a watchman whose city has no barracks door is out of sight off duty, at his post on it', () => {
  const city = cityFor(SEED)
  const cc = cityCtx(city, SEED)
  const person = { ...cc.folk.find(p => p.job === 'watch' && p.shift === 'day' && p.post), home: null }
  const w = makeWalker(cc, person, 500)
  w.sched = scheduleFor(person, city, SEED, 0)
  for (let f = 0; f < 1; f += 0.05) assert.doesNotThrow(() => placeByClock(cc, w, f), `at ${f}`)
  placeByClock(cc, w, 0.05)
  assert.equal(w.mode, 'indoors'); assert.equal(w.door, null)
  placeByClock(cc, w, 0.45)
  const post = city.spots[person.post]
  assert.deepEqual([w.X, w.Y], [post.x, post.y + 160])
  // and the day walked through, entry by entry
  placeByClock(cc, w, 0.01)
  for (let f = 0.01; f < 0.99; f += 0.005) {
    const ei = entryAt(w.sched, f)
    if (ei !== w.ei) setEntry(cc, w, ei)
    if (w.needRoute) routeWalker(cc, w)
    if (w.mode === 'far') stepFar(cc, w, 0.005 * DAY_LENGTH)
  }
  assert.equal(w.mode, 'indoors'); assert.equal(w.door, null)
})

// The route requests a frame serves are counted (ROUTES_PER_TICK); only a
// game that hands the runtime a timer (hooks.now) also stops them once a
// millisecond is spent, so a test or a headless tool runs alike however
// loaded the machine is.
test('route requests a frame: by count without a timer, and a timer stops them after a millisecond', () => {
  const served = now => {
    const ctx = setup({ at: NORTH_GATE })
    const run0 = ctx.state.cityRun
    run0.queue.length = 0
    const asked = [...run0.people.values()].filter(w => w.mode === 'far' && !w.out && !w.pending && w.goal).slice(0, 20)
    assert.equal(asked.length, 20)
    for (const w of asked) { w.needRoute = true; run0.queue.push(w) }
    tickCity(ctx.state, ctx.world, DT, now ? { ...ctx.hooks, now } : ctx.hooks)
    return asked.filter(w => !w.needRoute).length
  }
  assert.equal(served(null), ROUTES_PER_TICK, 'no timer: the count alone')
  let t = 0
  assert.equal(served(() => (t += 5)), 1, 'a slow frame: the first route, then the millisecond is spent')
  assert.equal(served(() => 0), ROUTES_PER_TICK, 'a quick one: the count')
})

test('fracOf: how far through the day a clock is, past a day or set back', () => {
  assert.equal(fracOf(0), 0)
  assert.equal(fracOf(DAY_LENGTH / 4), 0.25)
  assert.equal(fracOf(DAY_LENGTH * 3 + DAY_LENGTH / 2), 0.5)
  assert.equal(fracOf(-DAY_LENGTH / 4), 0.75)
  assert.equal(fracOf(DAY_LENGTH), 0)
})
