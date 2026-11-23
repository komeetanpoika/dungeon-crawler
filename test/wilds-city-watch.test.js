// Kalevanlinna's watch: gate guards fight what comes at their gate, any
// watchman fights a hostile standing inside the walls, the shifts change at
// dawn and dusk through the barracks, and patrols walk in pairs
// (wilds/city/runtime.js picks a watchman's foe, npc.js defend fights it).
// The window is built by session.js as in the game; buildEntities and the
// hurt hook are stand-ins for game.js's.
//
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b): a failing strict equal makes Node diff both sides, and a
// city npc's ai.goals reaches the whole city.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arriveCity, tickCity, cityPeople } from '../renderer/wilds/city/runtime.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { fromCity } from '../renderer/wilds/city/geometry.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { cityCtx, patrolPath } from '../renderer/wilds/city/walkers.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { toWorld, toWindow } from '../renderer/wilds/window.js'
import { PIECE } from '../renderer/wilds/layout.js'
import * as npc from '../renderer/systems/npc.js'
const { makeNpc, updateNpc, onNpcHit } = npc
import { makeFeedback } from '../renderer/systems/feedback.js'
import { TILE } from '../renderer/systems/entities.js'
import { getMonsterDef } from '../renderer/systems/monsters.js'
import { cullDead, tickDying } from '../renderer/systems/dying.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const SEED = 7
const S = 32
const DT = 0.05
const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
  return [{ type: s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
})
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5 }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(), caveInstances: {},
  sfx: { cues: [], muted: false },
})
const city = cityFor(SEED)
const NORTH_GATE = { X: 80, Y: 183 }   // three tiles inside the north gate's arch (city 80,20)

function setup({ at = NORTH_GATE, clock = 0.5 * DAY_LENGTH, view = { w: 20, h: 12 } } = {}) {
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, at, { buildEntities })
  const T = { clock, day: 0, view }
  const blows = []
  // game.js: hurtEntity, the enemy damage path; here its plain-enemy branch
  const hurt = (target, amount, from) => {
    blows.push({ target, amount, from })
    target.hp -= amount
    target.inCombat = true
    if (target.type === 'npc') onNpcHit(target, state)
  }
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: () => {}, hurt,
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T, blows, cues: new Map() }
}
// The frame loop's share, in game.js's order: the town, the dying, every
// npc's goals, the cull of the dead. `each` runs after every frame.
function run(ctx, seconds, { npcs = true, each = null } = {}) {
  const { state, world, hooks, T } = ctx
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    T.clock = (T.clock + DT) % DAY_LENGTH
    tickCity(state, world, DT, hooks)
    state.entities = tickDying(state.entities, DT)
    if (npcs) for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, DT)
    state.entities = cullDead(state.entities, e => !!getMonsterDef(e.type))
    for (const c of state.sfx.cues) ctx.cues.set(c.name, (ctx.cues.get(c.name) ?? 0) + 1)
    state.sfx.cues = []
    if (each && each(t) === false) return
  }
}
const cityEntities = state => state.entities.filter(e => e.cityKey !== undefined)
const entityWorld = (world, e) => ({ X: e.px / S - 0.5 + world.origin.wx * PIECE, Y: e.py / S - 0.5 + world.origin.wy * PIECE })
const cheb = (a, b) => Math.max(Math.abs(a.X - b.X), Math.abs(a.Y - b.Y))
const postAt = id => { const p = PLAN.posts.find(q => q.id === id); return fromCity(p.x, p.y) }
// a beast of the wild at world tile (X, Y)
function beast(ctx, species, X, Y) {
  const { x, y } = toWindow(ctx.world.origin, X, Y)
  const e = makeNpc({ species, id: `${species}:test`, x, y })
  ctx.state.entities.push(e)
  return e
}
const walkable = (state, world, X, Y) => {
  const { x, y } = toWindow(world.origin, X, Y)
  return state.map[y]?.[x]?.tile === TILE.FLOOR
}
const cellAt = (state, world, X, Y) => { const { x, y } = toWindow(world.origin, X, Y); return state.map[y]?.[x] }

test('gate guards kill a wolf that followed the player to the gate, then go back to their post', () => {
  const ctx = setup()
  const { state, world, blows } = ctx
  const guards = cityEntities(state).filter(e => /^gate-N-/.test(e.city?.person?.post ?? '') && e.city.person.shift === 'day')
  assert.equal(guards.length, 2, 'both north gate guards are near at noon')
  run(ctx, 1)
  for (const g of guards) assert.ok(cheb(entityWorld(world, g), postAt(g.city.person.post)) < 0.7, `${g.cityKey} at his post`)

  // two tiles out of the arch, on the road, the player in its sight
  const out = { X: 80, Y: 178 }
  assert.ok(walkable(state, world, out.X, out.Y) && !cellAt(state, world, out.X, out.Y).ward, 'the road outside is open, unwarded')
  assert.ok(cellAt(state, world, 80, 180).ward, 'the arch is warded')
  // a calm wolf (Tapio's peace) is no foe of the city's
  const wolf = beast(ctx, 'wolf', out.X, out.Y)
  wolf.hostile = false
  run(ctx, 1)
  assert.ok(guards.every(g => !g.city.foe && g.ai.current !== 'defend'), 'a calm wolf is left alone')
  assert.equal(blows.length, 0)

  // a hostile one, after the player: the gate guards go out to it
  wolf.hostile = true
  wolf.hp = wolf.maxHp
  let fought = null
  run(ctx, 6, { each: () => {
    for (const g of guards) if (g.city.foe === wolf && g.ai.current === 'defend') fought ??= g
    return state.entities.includes(wolf)
  } })
  assert.ok(fought, 'a gate guard took the wolf for his foe')
  assert.ok(!state.entities.includes(wolf), 'the wolf is dead and culled')
  assert.ok(blows.length >= 1 && blows.every(b => b.target === wolf && b.amount === 3), 'struck for 3 a blow')
  assert.ok(blows.every(b => guards.includes(b.from)), 'by the gate guards')
  assert.ok(wolf.hp <= 0)
  assert.ok((ctx.cues.get('melee-hit') ?? 0) >= 1, 'a blow is heard')
  assert.ok(state.hitEffects.length >= 1, 'and seen')
  // the wolf was where the ward stopped it: never inside
  const fell = toWorld(world.origin, wolf.x, wolf.y)
  assert.ok(!cellAt(state, world, fell.X, fell.Y).ward, 'it never got in')

  // and back to their posts
  run(ctx, 8)
  for (const g of guards) {
    assert.ok(state.entities.includes(g), `${g.cityKey} is still about`)
    assert.ok(!g.city.foe, 'no foe left'); assert.notEqual(g.ai.current, 'defend')
    assert.ok(cheb(entityWorld(world, g), postAt(g.city.person.post)) < 0.7, `${g.cityKey} back at his post`)
  }
  assert.ok(guards.every(g => !g.hostile), 'the watch never turned hostile')
})

// Noon on the castle street, the castle gate's two guards at their posts, and
// a warded floor cell deep in the town (no open ground within 7 tiles, so a
// monster there cannot get out), 8 to 11 tiles from a watchman and beyond 7
// of every post.
function castleStreet() {
  const ctx = setup({ at: { X: 106, Y: 230 } })
  const { state, world } = ctx
  run(ctx, 0.5)
  const near = cityEntities(state).filter(e => e.species === 'watchman')
  assert.ok(near.length >= 1, 'the watch is about')
  const deep = (X, Y) => {
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      if (walkable(state, world, X + dx, Y + dy) && !cellAt(state, world, X + dx, Y + dy).ward) return false
    }
    return true
  }
  let spot = null
  for (const g of near) {
    const at = entityWorld(world, g)
    for (let dy = -11; dy <= 11 && !spot; dy++) for (let dx = -11; dx <= 11 && !spot; dx++) {
      const X = Math.round(at.X) + dx, Y = Math.round(at.Y) + dy
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8 || !walkable(state, world, X, Y) || !cellAt(state, world, X, Y).ward) continue
      if (PLAN.posts.some(p => cheb(fromCity(p.x, p.y), { X, Y }) <= 7)) continue
      if (cheb({ X, Y }, toWorld(world.origin, state.player.x, state.player.y)) < 4 || !deep(X, Y)) continue
      spot = { X, Y }
    }
  }
  assert.ok(spot, 'such a cell')
  return { ctx, near, spot }
}

test('a monster knocked onto a warded cell is fought and dies; nothing stays stuck', () => {
  const { ctx, near, spot } = castleStreet()
  const { state, world, blows } = ctx
  const bear = beast(ctx, 'bear', spot.X, spot.Y)
  assert.ok(bear.hp > 3, 'more than one blow')
  run(ctx, 0.5)
  assert.ok(near.some(g => g.city.foe === bear && cheb(entityWorld(world, g), entityWorld(world, bear)) <= 12.5), 'the watch takes it on')
  let dead = false
  run(ctx, 15, { each: () => { dead = !state.entities.includes(bear); return !dead } })
  assert.ok(dead, 'the bear is fought and dies')
  assert.ok(blows.length >= 2 && blows.every(b => b.target === bear && near.includes(b.from)), 'by the watch')
  // nothing stays stuck: the watch drops it and goes back to its posts
  run(ctx, 10)
  for (const g of near) {
    assert.ok(state.entities.includes(g), `${g.cityKey} is still about`)
    assert.ok(!g.city.foe, `${g.cityKey} has no foe`); assert.notEqual(g.ai.current, 'defend')
    const post = g.city.person.post
    if (post && g.city.entry.act === 'post') assert.ok(cheb(entityWorld(world, g), postAt(post)) < 0.7, `${g.cityKey} back at ${post}`)
  }
})

test('a foe a watchman found no way to is left alone 5 s, then fought again', () => {
  const { ctx, near, spot } = castleStreet()
  const { state, world, blows } = ctx
  const bear = beast(ctx, 'bear', spot.X, spot.Y)
  // walled in where it stands: nobody can get to it
  const ring = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue
    const cell = cellAt(state, world, spot.X + dx, spot.Y + dy)
    ring.push([cell, cell.tile]); cell.tile = TILE.WALL
  }
  const relay = () => { delete state.map._nav; delete state.map._navWard }   // the nav grids are cached on the map
  relay()
  let quit = null
  run(ctx, 8, { each: () => { quit = near.find(g => g.city.lost === bear) ?? null; return !quit } })
  assert.ok(quit, 'a watchman gave up on it')
  assert.ok(quit.city.foe === null, 'and let it go')
  assert.ok(state.entities.includes(bear), 'it lives')
  // the way opens at once, but he leaves it alone for the 5 s
  for (const [cell, tile] of ring) cell.tile = tile
  relay()
  run(ctx, 4.8, { each: () => assert.ok(quit.city.foe !== bear, `${quit.cityKey} leaves it alone for now`) })
  let retaken = false, dead = false
  run(ctx, 20, { each: () => {
    if (quit.city.foe === bear) retaken = true
    dead = !state.entities.includes(bear)
    return !dead
  } })
  assert.ok(retaken, `${quit.cityKey} takes it on again`)
  assert.ok(dead, 'and it dies')
  assert.ok(blows.some(b => b.target === bear && b.from === quit), `${quit.cityKey} struck it`)
  assert.ok(quit.city.lost === null, 'nothing is left given up')
})

test('the defend goal closes to sword reach and strikes every 0.8 s', () => {
  const { STRIKE_REACH, STRIKE_INTERVAL } = npc
  assert.equal(STRIKE_REACH, 36); assert.equal(STRIKE_INTERVAL, 0.8)
  const map = Array.from({ length: 12 }, (_, y) => Array.from({ length: 20 }, (_, x) =>
    ({ tile: x > 0 && y > 0 && x < 19 && y < 11 ? TILE.FLOOR : TILE.WALL })))
  const g = makeNpc({ species: 'watchman', id: 'watch:0', x: 3, y: 5 })
  const foe = { type: 'monster', x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16, hp: 100, maxHp: 100 }
  g.cityKey = 'watch:0'
  g.city = { next: null, entry: null, person: null, passed: false, foe }
  const blows = []
  const state = {
    map, player: { x: 1, y: 1, px: 48, py: 48 }, entities: [g, foe], hitEffects: [], sfx: { cues: [] },
    cityRun: { hooks: { hurt: (t, n, from) => { blows.push({ t, n, from }); t.hp -= n } } },
  }
  let t = 0
  while (Math.hypot(foe.px - g.px, foe.py - g.py) > STRIKE_REACH && t < 5) { updateNpc(g, state, DT); t += DT }
  assert.equal(g.ai.current, 'defend')
  assert.ok(Math.hypot(foe.px - g.px, foe.py - g.py) <= STRIKE_REACH + 3, 'in reach')
  for (let k = 0; k < 2.5 / DT; k++) updateNpc(g, state, DT)
  assert.ok(blows.length === 3 || blows.length === 4, `a blow every 0.8 s (${blows.length} in 2.5 s)`)
  assert.ok(blows.every(b => b.t === foe && b.n === 3 && b.from === g))
  assert.equal(foe.hp, 100 - 3 * blows.length)
  assert.ok(state.sfx.cues.filter(c => c.name === 'melee-hit').length === blows.length)
  assert.ok(state.hitEffects.length === blows.length && state.hitEffects.every(h => h.x === foe.x && h.y === foe.y))
  assert.equal(g.attack?.weaponId, 'sword', 'the sword swings')
  assert.equal(g.hostile, false)
  // the foe gone: back to his own goals
  g.city.foe = null
  updateNpc(g, state, DT)
  assert.notEqual(g.ai.current, 'defend')
})

// the watch's walkers by post and shift
function watchOf(state) {
  const run = state.cityRun
  return [...run.people.values()].filter(w => w.person.job === 'watch')
}

const LAND = PLAN.posts.filter(p => /^gate-[NWE]-/.test(p.id)).map(p => p.id)
const CORNER = { X: 152, Y: 165 }   // outside the walls by the north-east corner, where nobody walks
// the land gate posts with nobody of the watch standing at them
const unmanned = watch => LAND.filter(id => !watch.some(w => w.mode !== 'indoors' && cheb(w, postAt(id)) <= 1.5))

test('the watch changes shift at dawn and dusk through the barracks', () => {
  const barracks = city.doors.find(d => d.kind === 'barracks')
  const front = cityCtx(city, SEED).front(barracks.label)
  const frontW = fromCity(front.x, front.y)
  const inside = `in:${barracks.label}`
  // long enough for the old shift of the farthest gate to walk home after its relief came;
  // a narrow screen by the corner: the whole watch walks far
  for (const [from, to] of [[DAY.dawn - 0.08, DAY.dawn + 0.42], [DAY.dusk - 0.08, DAY.dusk + 0.4]]) {
    const ctx = setup({ at: CORNER, clock: from * DAY_LENGTH, view: { w: 2, h: 2 } })
    const { state } = ctx
    const watch = watchOf(state)
    const at = from < 0.5 ? 'dawn' : 'dusk'
    const onDuty = at === 'dawn' ? 'night' : 'day', relief = at === 'dawn' ? 'day' : 'night'
    const seen = new Map(watch.map(w => [w.id, []]))
    const empty = new Map()
    let near = 0
    run(ctx, (to - from) * DAY_LENGTH, { npcs: false, each: () => {
      for (const w of watch) {
        const log = seen.get(w.id), m = w.mode === 'indoors' ? `in:${w.door}` : 'out'
        if (log[log.length - 1]?.m !== m) log.push({ m, X: w.X, Y: w.Y })
        if (w.mode === 'near') near++
      }
      // every land gate post keeps a man at it through the change
      for (const id of unmanned(watch)) empty.set(id, (empty.get(id) ?? 0) + DT)
    } })
    assert.equal(near, 0, 'nobody of the watch came near the corner')
    for (const id of LAND) assert.ok(!empty.has(id), `${id} is never left empty (empty ${empty.get(id)?.toFixed(1)} s at ${at})`)
    for (const w of watch) {
      const log = seen.get(w.id)
      const comesOut = w.person.shift === relief && (w.person.post ? LAND.includes(w.person.post) || at === 'dawn' : true)
      const goesIn = w.person.shift === onDuty || (at === 'dusk' && w.person.post && !LAND.includes(w.person.post))
      if (comesOut) {
        // out of the barracks door, to the post or onto the round
        assert.equal(log[0].m, inside, `${w.id} starts in the barracks at ${at}`)
        assert.equal(log[1]?.m, 'out', `${w.id} sets out`)
        assert.ok(cheb(log[1], frontW) <= 1, `${w.id} comes out of the barracks door`)
        if (w.person.post) assert.ok(cheb(w, postAt(w.person.post)) <= 0.5, `${w.id} at his post at the end`)
      } else if (goesIn) {
        // from the post or the round, in at the barracks door
        assert.equal(log[0].m, 'out', `${w.id} starts out at ${at}`)
        if (w.person.post) assert.ok(cheb(log[0], postAt(w.person.post)) <= 0.5, `${w.id} starts at his post`)
        assert.equal(log[log.length - 1].m, inside, `${w.id} ends in the barracks at ${at}`)
      } else assert.fail(`${w.id} (${w.person.shift}) has a part in the change at ${at}`)
    }
  }
})

test('a town come upon in the middle of a shift change has its gates manned', () => {
  // the relief of the far gates is still on its way at dawn + 0.08, the old shift's time is up
  const clock = (DAY.dawn + 0.08) * DAY_LENGTH
  const ctx = setup({ at: CORNER, clock, view: { w: 2, h: 2 } })
  const watch = watchOf(ctx.state)
  assert.deepEqual(unmanned(watch), [], 'built afresh: the old shift still stands at the posts')
  const held = watch.filter(w => w.person.shift === 'night' && w.entry.act === 'post' && w.sched[w.ei + 1].at < clock / DAY_LENGTH)
  assert.ok(held.length >= 2, `some waited for their relief (${held.length})`)
  run(ctx, 20, { npcs: false, each: () => assert.deepEqual(unmanned(watch), []) })
  // and walking in from the piece north of the city: placed a few a frame, the same
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, { X: 152, Y: 120 }, { buildEntities })
  ctx.T.clock = clock
  const lazy = { ...ctx, world, state }
  arriveCity(state, world, ctx.hooks)
  assert.ok(cityPeople(state).every(p => p.pending), 'nobody placed yet')
  run(lazy, 2, { npcs: false })
  assert.ok(cityPeople(state).every(p => !p.pending))
  assert.deepEqual(unmanned(watchOf(state)), [])
})

test('the shift change looks the same near: the north gate is never left empty', () => {
  const ctx = setup({ clock: (DAY.dawn - 0.06) * DAY_LENGTH })
  const { state, world } = ctx
  const empty = { a: 0, b: 0 }
  const posts = { a: postAt('gate-N-a'), b: postAt('gate-N-b') }
  run(ctx, 0.14 * DAY_LENGTH, { each: () => {
    for (const k of ['a', 'b']) {
      const manned = cityEntities(state).some(e => e.species === 'watchman' && cheb(entityWorld(world, e), posts[k]) <= 1.5)
      if (!manned) empty[k] += DT
    }
  } })
  assert.ok(empty.a < 1 && empty.b < 1, `the north gate posts were manned (empty ${empty.a.toFixed(1)} / ${empty.b.toFixed(1)} s)`)
  const at = id => cityEntities(state).find(e => e.city?.person?.post === id && e.city.person.shift === 'day')
  for (const id of ['gate-N-a', 'gate-N-b']) assert.ok(at(id) && cheb(entityWorld(world, at(id)), postAt(id)) < 0.7, `the day man at ${id}`)
  const night = watchOf(state).filter(w => /^gate-N-/.test(w.person.post ?? '') && w.person.shift === 'night')
  const label = city.doors.find(d => d.kind === 'barracks').label
  assert.ok(night.every(w => w.mode === 'indoors' && w.door === label), 'the night men went in at the barracks')
})

// Early evening: the night pair is out on its first route, the market street,
// with the player beside the street halfway along it (out of their way, the
// whole route near). `ents()` gives the pair's two npcs.
function patrolPair() {
  const clock = 0.72 * DAY_LENGTH
  const probe = setup({ clock, view: { w: 2, h: 2 } })
  const pair = watchOf(probe.state).filter(w => w.person.patrol && w.person.shift === 'night')
  assert.equal(pair.length, 2)
  const id = pair[0].entry.where.patrol
  assert.ok(id && pair[1].entry.where.patrol === id, 'the same route')
  assert.ok(pair.every(w => w.loop && w.phase === 'there'), 'walking it, not on the way to it')
  assert.ok(cheb(pair[0], pair[1]) < 1, 'far, they walk together')
  const path = patrolPath(cityCtx(city, SEED), id).map(t => fromCity(t.x, t.y))
  const mid = path[path.length >> 1]
  const ctx = setup({ clock, at: { X: mid.X - 3, Y: mid.Y } })
  const ents = () => pair.map(w => cityEntities(ctx.state).find(e => e.cityKey === w.id))
  assert.ok(ents().every(Boolean), 'both near')
  return { ctx, pair, id, path, ents }
}
// Math.random (the townsfolk's wander) seeded for one test, put back after
function withRandom(seed, fn) {
  const real = Math.random
  let s = seed
  Math.random = () => {
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  try { return fn() } finally { Math.random = real }
}
// An npc kept where it stands now, as a passer-by in its way would: the
// returned function undoes the frame's moves (run it after every frame).
function pinned(e) {
  const px = e.px, py = e.py
  return () => { e.px = px; e.py = py; e.x = Math.floor(px / S); e.y = Math.floor(py / S) }
}

test('patrols walk their routes in pairs', () => {
  const { ctx, pair, id, path, ents } = patrolPair()
  const { world } = ctx
  // how far a point stands from the route's line (its waypoints are a few tiles apart)
  const offRoute = p => Math.min(...path.slice(1).map((b, i) => {
    const a = path[i], dx = b.X - a.X, dy = b.Y - a.Y, L2 = dx * dx + dy * dy
    const k = L2 ? Math.max(0, Math.min(1, ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / L2)) : 0
    return Math.hypot(p.X - a.X - k * dx, p.Y - a.Y - k * dy)
  }))
  let apart = 0, sameTile = 0, frames = 0, walked = 0, off = 0
  let last = entityWorld(world, ents()[0])
  run(ctx, 20, { each: () => {
    const [a, b] = ents()
    assert.ok(a && b, 'both stay near')
    const pa = entityWorld(world, a), pb = entityWorld(world, b)
    frames++
    if (cheb(pa, pb) > 2.5) apart++
    if (a.x === b.x && a.y === b.y) sameTile++
    if (offRoute(pa) > 2 || offRoute(pb) > 2) off++
    walked += cheb(pa, last)
    last = pa
  } })
  assert.ok(apart / frames < 0.1, `side by side (apart ${apart} of ${frames} frames)`)
  assert.ok(sameTile / frames < 0.5, `a step apart, not one heap (${sameTile} of ${frames})`)
  assert.equal(off, 0, 'on their route')
  assert.ok(walked >= 30, `walking it (${walked.toFixed(1)} tiles in 20 s)`)
  assert.ok(pair.every(w => w.entry.where.patrol === id && w.loop))
})

// A passer-by holds one of the pair back: the other waits for him instead of
// walking the rest of the route a few tiles ahead, and they go on together.
test('a patrolman held back is waited for, and the pair walks on side by side', () => withRandom(1, () => {
  const { ctx, ents } = patrolPair()
  const { world } = ctx
  const gap = () => { const [a, b] = ents(); return cheb(entityWorld(world, a), entityWorld(world, b)) }
  run(ctx, 3, { each: pinned(ents()[1]) })
  assert.ok(gap() < 2.5, `his partner waited for him (${gap().toFixed(1)} tiles apart)`)
  let apart = 0, frames = 0, walked = 0, last = entityWorld(world, ents()[0])
  run(ctx, 6, { each: () => {
    frames++
    if (gap() > 2.5) apart++
    const pa = entityWorld(world, ents()[0])
    walked += cheb(pa, last)
    last = pa
  } })
  assert.ok(apart / frames < 0.1, `side by side again (apart ${apart} of ${frames} frames)`)
  assert.ok(walked >= 8, `and on along the route (${walked.toFixed(1)} tiles in 6 s)`)
}))

// ... but one who does not come is not waited for for ever.
test('a patrolman whose partner does not come walks on alone', () => withRandom(1, () => {
  const { ctx, ents } = patrolPair()
  const { world } = ctx
  const pin = pinned(ents()[1])
  run(ctx, 4, { each: pin })
  let walked = 0, last = entityWorld(world, ents()[0])
  run(ctx, 10, { each: () => {
    pin()
    const pa = entityWorld(world, ents()[0])
    walked += cheb(pa, last)
    last = pa
  } })
  assert.ok(walked >= 6, `he went on (${walked.toFixed(1)} tiles in the last 10 s)`)
}))
