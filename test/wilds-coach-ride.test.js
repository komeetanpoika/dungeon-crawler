// The coach's ride in the world: its way along the roads (wilds/coach-path.js)
// and the ride itself (wilds/coach-ride.js): the hero on top, the window
// following, safe and unseen, stepping down beside the far stop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, getPiece } from '../renderer/wilds/world.js'
import { enterWilds, tickWilds, snapshotWilds } from '../renderer/wilds/session.js'
import { toWindow, toWorld } from '../renderer/wilds/window.js'
import { roadsFrom } from '../renderer/wilds/roads.js'
import { PIECE, villagesNear, pieceKey } from '../renderer/wilds/layout.js'
import { isCityPiece, fromCity, toCity, CITY_KEYS } from '../renderer/wilds/city/geometry.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { destinations, tickCoach, stopTile, boardingTile } from '../renderer/wilds/coach.js'
import { coachPath, cartOf, crossing, onRoad, CART } from '../renderer/wilds/coach-path.js'
import { startRide, tickCoachRide, COACH_SPEED } from '../renderer/wilds/coach-ride.js'
import { damagePlayer } from '../renderer/systems/player-damage.js'
import { updateBrain } from '../renderer/systems/brain.js'
import { playerBound } from '../renderer/systems/player-bind.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'
import { makeNpc, buildCtx, GOALS } from '../renderer/systems/npc.js'

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const same = (a, b) => !!a && !!b && a.X === b.X && a.Y === b.Y
const at = p => `${p?.X},${p?.Y}`
const pieceOfTile = p => ({ wx: Math.floor(p.X / PIECE), wy: Math.floor(p.Y / PIECE) })
const cellAt = (world, p) => { const { wx, wy } = pieceOfTile(p); return getPiece(world, wx, wy).cells[p.Y - wy * PIECE][p.X - wx * PIECE] }

// What game.js's buildEntities does, minus the art: one entity per spawn, the
// marks game.js copies on (the coachman's).
const buildEntities = spawns => spawns.map(s => ({
  type: s.kind, species: s.species, x: s.x, y: s.y, px: s.x * 32 + 16, py: s.y * 32 + 16, hp: 3, maxHp: 3,
  ...(s.coachman && { coachman: true }),
}))
const hooks = { buildEntities }
const freshState = () => ({
  player: { type: 'player', x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5, facing: 'south' }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: { floats: [] }, caveInstances: {}, sfx: { cues: [], muted: false },
})
// A fresh world with the player standing on `town`'s stop, as when its menu opens.
function onStop(seed, town = '0,0') {
  const world = makeWorld(null, { seed })
  const state = freshState()
  const b = boardingTile(world, town)
  enterWilds(state, world, b, hooks)
  const w = toWindow(world.origin, b.X, b.Y)
  assert.deepEqual([state.player.x, state.player.y], [w.x, w.y], 'the player is not on the stop')
  state.coachHold = true
  return { world, state }
}
const playerAt = (state, world) => toWorld(world.origin, state.player.x, state.player.y)
// The game's order: the Wilds tick (re-centring), then the ride.
function frame(state, world, dt) {
  tickWilds(state, world, dt, hooks)
  return tickCoachRide(state, world, dt)
}
function rideToEnd(state, world, dt = 1 / 30, max = 20000) {
  for (let i = 0; i < max; i++) if (frame(state, world, dt) === 'arrived') return i + 1
  throw new Error('the coach never arrived')
}

// ---- the way --------------------------------------------------------------------

// The towns ridden from: Kalevanlinna and the six villages nearest home.
const TOWNS = seed => ['city', ...villagesNear(seed, 0, 0, 8).slice(0, 6).map(v => pieceKey(v.wx, v.wy))]

for (const seed of [7, 42]) {
  test(`seed ${seed}: the coach's way runs cart to cart along the road's middle, through every piece of the road, and through the city's gate`, () => {
    const world = makeWorld(null, { seed })
    const city = cityFor(seed), G = city.streets
    const doors = new Set(city.doors.flatMap(d => Array.from({ length: d.span ?? 1 }, (_, i) => `${d.x + i},${d.y}`)))
    const castle = PLAN.places.castle
    const towns = TOWNS(seed)
    assert.ok(towns.length >= 6, `seed ${seed}: ${towns.length} towns`)
    // every piece of these roads kept in the cache, as a ride keeps its own (world.held)
    world.held = new Set([...CITY_KEYS, ...towns.flatMap(t => roadsFrom(seed, t).flatMap(r => r.route.map(p => pieceKey(p.wx, p.wy))))])
    let pairs = 0, cityPairs = 0
    for (const from of towns) {
      for (const road of roadsFrom(seed, from)) {
        const to = road.town.key, name = `seed ${seed} ${from} -> ${to}`
        const path = coachPath(world, from, to)
        assert.ok(Array.isArray(path) && path.length > 1, `${name}: no way`)
        pairs++
        const a = cartOf(world, from), b = cartOf(world, to)
        assert.ok(a && b, `${name}: a town without a cart`)
        assert.ok(same(path[0], a.C), `${name}: starts at ${at(path[0])}, not on the cart at ${at(a.C)}`)
        assert.ok(same(path.at(-1), b.C), `${name}: ends at ${at(path.at(-1))}, not on the cart at ${at(b.C)}`)
        const carts = [a.H, a.C, b.H, b.C]
        for (let i = 1; i < path.length; i++)
          assert.equal(Math.abs(path[i].X - path[i - 1].X) + Math.abs(path[i].Y - path[i - 1].Y), 1, `${name}: a jump from ${at(path[i - 1])} to ${at(path[i])}`)
        // every cell walkable but the carts'; never a village's stop, nor where its coachman stands
        for (const p of path) if (!carts.some(c => same(c, p))) assert.equal(cellAt(world, p).tile, TILE.FLOOR, `${name}: ${at(p)} is not walkable`)
        for (const key of [from, to]) {
          if (key === 'city') continue
          const stop = boardingTile(world, key)
          assert.ok(!path.some(p => same(p, stop)), `${name}: over ${key}'s stop`)
          const piece = getPiece(world, ...key.split(',').map(Number))
          const man = piece.spawns.find(s => s.coachman)
          assert.ok(!path.some(p => p.X === piece.wx * PIECE + man.x && p.Y === piece.wy * PIECE + man.y), `${name}: over ${key}'s coachman`)
        }
        // on the road all the way, but for a few cells at a village's cart and the city's own leg
        const inCity = p => isCityPiece(pieceOfTile(p).wx, pieceOfTile(p).wy)
        const offRoad = path.map((p, i) => ({ p, i })).filter(({ p }) => !inCity(p) && !onRoad(cellAt(world, p)))
        const head = offRoad.filter(({ i }) => i < path.length / 2), tail = offRoad.filter(({ i }) => i >= path.length / 2)
        assert.ok(head.length <= 4 && head.every(({ i }, k) => i === k), `${name}: off the road at ${head.map(o => at(o.p)).join(' ')}`)
        assert.ok(tail.length <= 4 && tail.every(({ i }, k) => i === path.length - tail.length + k), `${name}: off the road at ${tail.map(o => at(o.p)).join(' ')}`)
        // the city's leg: the street graph's cells (or the inn's cart), no door, nowhere in the castle's plot
        for (const p of path.filter(inCity)) {
          if (carts.some(c => same(c, p))) continue
          const { cx, cy } = toCity(p.X, p.Y), i = cy * city.cells.length + cx
          assert.ok(G.walk[i] === 1 && G.snapDist[i] >= 0, `${name}: ${at(p)} is off the streets`)
          assert.ok(!doors.has(`${cx},${cy}`), `${name}: through a door at ${at(p)}`)
          assert.ok(!(cx >= castle.x0 && cx <= castle.x1 && cy >= castle.y0 && cy <= castle.y1), `${name}: in the castle at ${at(p)}`)
        }
        // every piece of the road in order, crossed on its middle lane
        const route = road.route
        let k = 0
        for (let r = 0; r + 1 < route.length; r++) {
          const c = crossing(seed, route[r], route[r + 1])
          while (k + 1 < path.length && !(same(path[k], c.out) && same(path[k + 1], c.in))) k++
          assert.ok(k + 1 < path.length, `${name}: does not cross from ${route[r].wx},${route[r].wy} to ${route[r + 1].wx},${route[r + 1].wy} on the middle lane (${at(c.out)})`)
        }
        const pieces = []
        for (const p of path) {
          const { wx, wy } = pieceOfTile(p), key = isCityPiece(wx, wy) ? 'city' : pieceKey(wx, wy)
          if (pieces.at(-1) !== key) pieces.push(key)
        }
        const want = route.map(p => (isCityPiece(p.wx, p.wy) ? 'city' : pieceKey(p.wx, p.wy)))
        assert.deepEqual(pieces, want, `${name}: the pieces passed`)
        // into Kalevanlinna by the gate its road comes to
        if (from === 'city' || to === 'city') {
          cityPairs++
          const door = from === 'city' ? route[0] : route.at(-1), next = from === 'city' ? route[1] : route.at(-2)
          const side = next.wx < door.wx ? 'W' : next.wx > door.wx ? 'E' : 'N'
          const g = PLAN.gates[side], arch = fromCity(g.x, g.y)
          assert.ok(path.some(p => same(p, arch)), `${name}: not through the ${side} gate`)
        }
      }
    }
    assert.ok(pairs >= 20 && cityPairs >= 4, `seed ${seed}: ${pairs} rides, ${cityPairs} to or from the city`)
  })
}

// ---- the ride -------------------------------------------------------------------

test('the coach rolls about 22 tiles a second along its way, the hero on top, and he steps down beside the far stop', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  const ride = startRide(state, world, '0,0', dest)
  assert.ok(state.coachRide === ride)
  assert.equal(state.player.riding, true)
  assert.ok(playerBound(state.player), 'the riding hero is not bound')
  // the land is made before it sets off, then the way
  let n = 0
  while (!ride.path && n++ < 200) assert.equal(frame(state, world, 1 / 30), null)
  assert.ok(ride.path, 'the coach never set off')
  assert.ok(same(playerAt(state, world), ride.path[0]), 'the hero is not on the coach at the cart')
  // a second of rolling: about COACH_SPEED tiles along the way
  assert.equal(COACH_SPEED, 22)
  for (let i = 0; i < 30; i++) frame(state, world, 1 / 30)
  const i = ride.path.findIndex(p => same(p, playerAt(state, world)))
  assert.ok(Math.abs(i - 22) <= 1, `after a second the hero is ${i} tiles along the way`)
  // and on: the window follows (re-centring as on foot), the hero always on the way
  const before = world.playtime
  let ticks = 0, off = 0, cur = i
  for (; ticks < 20000; ticks++) {
    const r = frame(state, world, 1 / 30)
    if (r === 'arrived') break
    const here = playerAt(state, world)
    const j = ride.path.findIndex((p, k) => k >= cur && same(p, here))
    if (j < 0) off++; else cur = j
  }
  assert.equal(off, 0, 'the hero left the way')
  assert.ok(Math.abs(world.playtime - before - (ticks + 1) / 30) < 1e-6, 'the ride\'s time is not play time')
  const secs = (ride.path.length - 1 - i) / COACH_SPEED
  assert.ok(Math.abs((ticks + 1) / 30 - secs) < 0.1, `${(ticks + 1) / 30} s for ${secs} s of way`)
  // arrived: beside the stop, held, the town visited and where the hero wakes
  assert.equal(state.coachRide, null)
  assert.equal(state.player.riding, false)
  const stop = stopTile(world, dest.town.key)
  assert.ok(same(playerAt(state, world), stop), `the hero stepped down at ${at(playerAt(state, world))}, not ${at(stop)}`)
  assert.equal(state.coachHold, true)
  assert.equal(tickCoach(state), null)
  assert.ok(world.visited.includes(dest.town.key))
  assert.deepEqual(world.lastVillage, { wx: dest.town.wx, wy: dest.town.wy })
  assert.equal(world.held, null, 'the ride\'s pieces are still held')
})

test('a ride into Kalevanlinna ends at the inn\'s cart, the city visited; and back out', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0').find(d => d.town.key === 'city')
  startRide(state, world, '0,0', dest)
  rideToEnd(state, world)
  assert.ok(same(playerAt(state, world), stopTile(world, 'city')))
  assert.ok(world.visited.includes('city'))
  assert.deepEqual(world.lastVillage, { wx: 0, wy: 2 })
  assert.equal(tickCoach(state), null)
  // back to Koivula from the inn's yard
  const home = destinations(world, 'city').find(d => d.town.key === '0,0')
  startRide(state, world, 'city', home)
  rideToEnd(state, world)
  assert.ok(same(playerAt(state, world), stopTile(world, '0,0')))
  assert.deepEqual(world.lastVillage, { wx: 0, wy: 0 })
})

test('nothing hurts the rider and no foe takes him for seen', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0')[0]
  startRide(state, world, '0,0', dest)
  for (let i = 0; i < 400 && !state.coachRide.path; i++) frame(state, world, 1 / 30)
  for (let i = 0; i < 20; i++) frame(state, world, 1 / 30)
  const p = state.player
  assert.equal(damagePlayer(state, 3, 'hit', { px: p.px + 20, py: p.py }), false)
  assert.equal(damagePlayer(state, 2, 'dot'), false)
  assert.equal(p.hp, 5)
  // a guard two tiles off the coach, in plain sight
  const spot = N4.map(([dx, dy]) => ({ x: p.x + 2 * dx, y: p.y + 2 * dy })).find(c => state.map[c.y]?.[c.x]?.tile === TILE.FLOOR)
  const guard = { type: 'guard', maxHp: 4, hp: 4, x: spot.x, y: spot.y, px: spot.x * 32 + 16, py: spot.y * 32 + 16 }
  state.entities.push(guard)
  updateBrain(guard, state, 1 / 30)
  assert.notEqual(guard.ai.mode, 'chase')
  assert.equal(guard.ai.lastSeen, null)
  // on foot again, the same guard sees him
  rideToEnd(state, world)
  const q = state.player, g2 = N4.map(([dx, dy]) => ({ x: q.x + 2 * dx, y: q.y + 2 * dy })).find(c => state.map[c.y]?.[c.x]?.tile === TILE.FLOOR)
  const guard2 = { type: 'guard', maxHp: 4, hp: 4, x: g2.x, y: g2.y, px: g2.x * 32 + 16, py: g2.y * 32 + 16 }
  updateBrain(guard2, state, 1 / 30)
  assert.equal(guard2.ai.mode, 'chase')
})

test('a save made mid-ride wakes at the far stop, the town visited, and the coachman at home', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  const man = state.entities.find(e => e.coachman)
  assert.ok(man, 'Koivula\'s coachman is not in the window')
  startRide(state, world, '0,0', dest)
  assert.ok(!state.entities.includes(man), 'the coachman is still at his post: he drives')
  for (let i = 0; i < 400 && !state.coachRide.path; i++) frame(state, world, 1 / 30)
  for (let i = 0; i < 45; i++) frame(state, world, 1 / 30)
  assert.ok(state.coachRide?.path, 'the ride is not under way')
  const rec = snapshotWilds(state, world)
  const stop = stopTile(world, dest.town.key)
  assert.deepEqual(rec.pos, { X: stop.X, Y: stop.Y })
  assert.ok(rec.visited.includes(dest.town.key))
  assert.deepEqual(rec.lastVillage, { wx: dest.town.wx, wy: dest.town.wy })
  // the live world is still on the road
  assert.ok(!world.visited.includes(dest.town.key), 'the live world arrived early')
  // loading it: at the stop, and Koivula's coachman back at his post
  const woke = makeWorld(rec)
  const s2 = freshState()
  enterWilds(s2, woke, woke.pos, hooks)
  assert.ok(same(toWorld(woke.origin, s2.player.x, s2.player.y), stop))
  assert.ok(!(woke.records.get('0,0')?.gone.size), 'a gone spawn in Koivula')
  const back = makeWorld(rec)
  const s3 = freshState()
  enterWilds(s3, back, { wx: 0, wy: 0 }, hooks)
  assert.equal(s3.entities.filter(e => e.coachman && e.wildsKey === '0,0').length, 1)
})

test('the coachman is back at his post when his village is next built', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  startRide(state, world, '0,0', dest)
  rideToEnd(state, world)
  assert.ok(!(world.records.get('0,0')?.gone.size), 'Koivula\'s coachman went for good')
  enterWilds(state, world, { wx: 0, wy: 0 }, hooks)
  assert.equal(state.entities.filter(e => e.coachman && e.wildsKey === '0,0').length, 1)
})

test('no doubled carts: the stop left shows no cart while the coach is away, the far one none until it parks', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0').find(d => d.town.key !== 'city')
  const home = cartOf(world, '0,0'), far = cartOf(world, dest.town.key)
  const art = p => cellAt(world, p).overlay ?? null
  assert.deepEqual([art(home.H), art(home.C)], CART)
  assert.deepEqual([art(far.H), art(far.C)], CART)
  startRide(state, world, '0,0', dest)
  for (let i = 0; i < 400 && !state.coachRide.path; i++) frame(state, world, 1 / 30)
  for (let i = 0; i < 30; i++) frame(state, world, 1 / 30)
  assert.deepEqual([art(home.H), art(home.C)], [null, null], 'the cart left behind is still drawn')
  assert.deepEqual([art(far.H), art(far.C)], [null, null], 'the far cart is drawn before the coach parks')
  // the cells are still the cart's: walked round as before
  assert.equal(cellAt(world, home.C).tile, TILE.WALL)
  rideToEnd(state, world)
  assert.deepEqual([art(far.H), art(far.C)], CART, 'the coach parked: its cart is drawn again')
  assert.deepEqual([art(home.H), art(home.C)], CART, 'the cart at home is drawn again')
})

test('the ride\'s pieces are made before it sets off, and held while it runs', () => {
  const { world, state } = onStop(7)
  const dest = destinations(world, '0,0').reduce((a, b) => (b.leagues > a.leagues ? b : a))
  const ride = startRide(state, world, '0,0', dest)
  for (let i = 0; i < 400 && !ride.path; i++) frame(state, world, 1 / 30)
  for (const key of ride.pieces) assert.ok(world.pieces.has(key), `${key} was not made before setting off`)
  const kept = new Map(ride.pieces.map(k => [k, world.pieces.get(k)]))
  rideToEnd(state, world, 1 / 15)
  for (const [key, piece] of kept) assert.ok(world.pieces.get(key) === piece, `${key} was made again during the ride`)
})

test('townsfolk take no notice of the rider: none startles at him or waits for him to step aside', () => {
  const map = createMap(12, 8)
  for (let y = 1; y < 7; y++) for (let x = 1; x < 11; x++) map[y][x].tile = TILE.FLOOR
  const walker = makeNpc({ species: 'villager', id: 'w', x: 4, y: 3 })
  walker.city = { next: { x: 5, y: 3 } }
  const player = { type: 'player', x: 5, y: 3, px: 5 * 32 + 16, py: 3 * 32 + 16, riding: true }
  const state = { map, player, entities: [walker] }
  const ctx = buildCtx(walker, state, 0.1)
  assert.equal(ctx.playerDist, Infinity)
  assert.equal(ctx.canSeePlayer, false)
  GOALS.follow_city.enter(walker, ctx)
  assert.equal(GOALS.follow_city.run(walker, ctx, 0.1).mode, 'patrol', 'a townsman waits for the coach to step off his way')
  // the same man waits for the hero on foot
  player.riding = false
  const foot = buildCtx(walker, state, 0.1)
  assert.ok(foot.playerDist < 64 && foot.canSeePlayer)
  GOALS.follow_city.enter(walker, foot)
  assert.equal(GOALS.follow_city.run(walker, foot, 0.1).mode, 'hold')
})
