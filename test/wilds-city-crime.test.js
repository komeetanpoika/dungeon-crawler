// Kalevanlinna's law: a blow on one of the city's people inside the walls is
// a warning, a second within the minute (or a killing blow) makes the player
// wanted, at most six of the watch hunt them and never further than ten tiles
// beyond the wall, and the watch's last blow puts them in the stocks instead
// of killing them (wilds/city/crime.js holds the rules, wilds/city/law.js acts
// on them in the town). The window is built by session.js as in the game;
// buildEntities, the hooks and npcStruck below are stand-ins for game.js's.
//
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b): a failing strict equal makes Node diff both sides, and a
// city npc's ai.goals reaches the whole city.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CRIME, CRIME_LINES, WARN_GRACE, makeCrime, onViolence, tickCrime, spares } from '../renderer/wilds/city/crime.js'
import { cityViolence, arrest, seat, toStocks, clearCrime, stocksWorld } from '../renderer/wilds/city/law.js'
import { arriveCity, tickCity, cityPeople } from '../renderer/wilds/city/runtime.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { fromCity } from '../renderer/wilds/city/geometry.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds, tickWilds, wildsRespawn } from '../renderer/wilds/session.js'
import { toWorld, toWindow, WIN_TILES } from '../renderer/wilds/window.js'
import { PIECE } from '../renderer/wilds/layout.js'
import { makeNpc, updateNpc, onNpcHit } from '../renderer/systems/npc.js'
import { stepEnemyAttack } from '../renderer/systems/enemy-attack.js'
import { damagePlayer } from '../renderer/systems/player-damage.js'
import { playerBound } from '../renderer/systems/player-bind.js'
import { adventureRespawn } from '../renderer/systems/cave.js'
import { updateFireZones, makeFireZone, applyBurst, BURST_DAMAGE } from '../renderer/systems/fire.js'
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
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5, facing: 'south' }, entities: [], projectiles: [], zones: [],
  fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(),
  caveInstances: {}, sfx: { cues: [], muted: false },
})
const FOUNTAIN = { X: 79, Y: 236 }     // a step south of the fountain, the stocks 9 tiles off
const NORTH_GATE = { X: 80, Y: 183 }   // three tiles inside the north gate's arch, the barracks door 11 tiles east
const NORTH_WALL_Y = 180               // the north gate's arch: the outermost warded row

function setup({ at = FOUNTAIN, clock = 0.5 * DAY_LENGTH, view = { w: 20, h: 12 } } = {}) {
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, at, { buildEntities })
  const T = { clock, day: 0, view }
  const cues = new Map()
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: name => cues.set(name, (cues.get(name) ?? 0) + 1),
    hurt: (target, amount) => { target.hp -= amount; target.inCombat = true },
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T, cues }
}
// The frame loop's share, in game.js's order: the town, the dying, every npc's
// goals, the enemy blows, the cull of the dead. `each` runs after every frame
// and stops the run by returning false.
function run(ctx, seconds, { npcs = true, each = null } = {}) {
  const { state, world, hooks, T } = ctx
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    T.clock = (T.clock + DT) % DAY_LENGTH
    tickCity(state, world, DT, hooks)
    state.entities = tickDying(state.entities, DT)
    if (npcs) {
      for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, DT)
      for (const e of state.entities) stepEnemyAttack(e, state, DT)
    }
    state.entities = cullDead(state.entities, e => !!getMonsterDef(e.type))
    for (const c of state.sfx.cues) ctx.cues.set(c.name, (ctx.cues.get(c.name) ?? 0) + 1)
    state.sfx.cues = []
    if (each && each(t) === false) return
  }
}

// game.js npcStruck's share for a struck npc: its own reaction, then the
// city's law (the watch's blows pass source 'watch')
function npcStruck(ctx, e, alive = e.hp > 0, source = 'player') {
  const r = onNpcHit(e, ctx.state)
  cityViolence(ctx.state, ctx.world, e, { killed: !alive, source })
  return r
}
// ... and its splash path: the struck are found by diffing a snapshot taken before
const npcSnapshot = state => state.entities.filter(e => e.type === 'npc').map(e => ({ e, hp: e.hp }))
function npcsStruckSince(ctx, snap) {
  const live = new Map(ctx.state.entities.filter(e => e.type === 'npc').map(e => [e.id, e]))
  for (const { e, hp } of snap) {
    const now = live.get(e.id)
    if (!now) npcStruck(ctx, e, false)
    else if (now.hp < hp) npcStruck(ctx, now)
  }
}
// a blow from the player
function strike(ctx, e, n = 1) { e.hp -= n; return npcStruck(ctx, e) }

const cityEntities = state => state.entities.filter(e => e.cityKey !== undefined)
const hostileWatch = state => cityEntities(state).filter(e => e.species === 'watchman' && e.hostile)
const hunters = state => [...state.cityRun.people.values()].filter(w => w.hunt)
const entityWorld = (world, e) => ({ X: e.px / S - 0.5 + world.origin.wx * PIECE, Y: e.py / S - 0.5 + world.origin.wy * PIECE })
const playerWorld = (state, world) => toWorld(world.origin, state.player.x, state.player.y)
const cheb = (a, b) => Math.max(Math.abs(a.X - b.X), Math.abs(a.Y - b.Y))
const inside = (state, e) => !!state.map[e.y]?.[e.x]?.ward
const said = state => state.feedback.bubble?.text ?? null
function placePlayer(state, world, X, Y) {
  const { x, y } = toWindow(world.origin, X, Y)
  state.player.x = x; state.player.y = y; state.player.px = x * S + 16; state.player.py = y * S + 16
}
// the open, unwarded floor tile nearest (X, Y) on the road north of the gate
function roadAt(state, world, X, Y) {
  for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const { x, y } = toWindow(world.origin, X + dx, Y + dy)
    const c = state.map[y]?.[x]
    if (c?.tile === TILE.FLOOR && !c.ward) return { X: X + dx, Y: Y + dy }
  }
  assert.fail(`no open road by ${X},${Y}`)
}
// how many tiles a window tile stands beyond the wall: 0 inside, else the
// Chebyshev distance to the nearest warded cell (scanned out to 15)
function beyondWall(state, x, y) {
  if (state.map[y]?.[x]?.ward) return 0
  for (let r = 1; r <= 15; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && state.map[y + dy]?.[x + dx]?.ward) return r
  }
  return 16
}
// two townsfolk inside the walls, apart from each other, near the player
function twoTownsfolk(state) {
  const tf = cityEntities(state).filter(e => e.species === 'townsfolk' && inside(state, e))
  const a = tf[0], b = tf.find(e => Math.max(Math.abs(e.x - a.x), Math.abs(e.y - a.y)) > 6)
  assert.ok(a && b, 'two townsfolk about')
  return [a, b]
}
// wanted: the player struck a watchman, and again once the warning's grace was past
function makeWanted(ctx) {
  const g = cityEntities(ctx.state).find(e => e.species === 'watchman' && inside(ctx.state, e))
  assert.ok(g, 'a watchman about')
  strike(ctx, g)
  run(ctx, WARN_GRACE + 0.1, { npcs: false })
  const again = ctx.state.entities.find(e => e.cityKey === g.cityKey)
  assert.ok(again, 'still about')
  strike(ctx, again)
  assert.equal(ctx.state.cityRun.crime.level, 'wanted')
  return again
}

test('one blow is a warning; another within a minute makes you wanted', () => {
  assert.deepEqual(CRIME, { warnSeconds: 60, maxHostile: 6, leashTiles: 10, clearAwaySeconds: 120, stocksSeconds: 60 })
  const c = makeCrime()
  assert.deepEqual(c, { level: 'calm', t: 0, away: 0 })
  assert.equal(onViolence(c, { killed: false }), 'warn')
  assert.equal(c.level, 'warned'); assert.equal(c.t, 60)
  assert.equal(tickCrime(c, 59, { inside: true }), null)
  assert.equal(c.level, 'warned', 'the warning stands a minute')
  assert.equal(onViolence(c, { killed: false }), 'wanted')
  assert.equal(c.level, 'wanted')
  assert.equal(onViolence(c, { killed: false }), null, 'wanted is wanted')
  const d = makeCrime()
  onViolence(d, {})
  assert.equal(tickCrime(d, 30, { inside: false }), null)
  assert.equal(tickCrime(d, 30, { inside: true }), 'cleared')
  assert.equal(d.level, 'calm')
  assert.equal(onViolence(d, {}), 'warn', 'a minute on, a blow is a warning again')

  // in the town, on the square
  const ctx = setup()
  const { state, world } = ctx
  const [a, b] = twoTownsfolk(state)
  strike(ctx, a)
  assert.equal(state.cityRun.crime.level, 'warned')
  assert.equal(said(state), CRIME_LINES.warn)
  assert.equal(CRIME_LINES.warn, 'Put that away!')
  run(ctx, 1)
  assert.ok(!cityEntities(state).some(e => e.hostile), 'a warning only: nobody turns on you')
  // the watch's own blow is never the player's violence, nor is a blow on
  // someone standing outside the walls
  assert.equal(cityViolence(state, world, b, { killed: true, source: 'watch' }), null)
  const out = roadAt(state, world, 80, 170), o = toWindow(world.origin, out.X, out.Y)
  assert.equal(cityViolence(state, world, { ...b, x: o.x, y: o.y }, { killed: true }), null)
  assert.equal(state.cityRun.crime.level, 'warned')
  // a second blow a second on, still within the warning's grace: the same offence
  strike(ctx, b)
  assert.equal(state.cityRun.crime.level, 'warned')
  assert.equal(said(state), CRIME_LINES.warn)
  // and one after it
  run(ctx, WARN_GRACE - 1 + 0.1)
  strike(ctx, b)
  assert.equal(state.cityRun.crime.level, 'wanted')
  assert.equal(said(state), 'Seize them!')
  run(ctx, 0.5)
  assert.ok(hunters(state).length >= 1, 'the watch is after you')
  assert.ok(cityEntities(state).every(e => e.species === 'watchman' || !e.hostile), 'the townsfolk are not')
})

test('a killing blow makes you wanted at once', () => {
  const c = makeCrime()
  assert.equal(onViolence(c, { killed: true }), 'wanted')
  assert.equal(c.level, 'wanted')

  const ctx = setup({ at: NORTH_GATE })
  const { state } = ctx
  const [a] = twoTownsfolk(state)
  a.hp = 0
  npcStruck(ctx, a, false)
  assert.equal(state.cityRun.crime.level, 'wanted', 'no warning first')
  assert.equal(said(state), CRIME_LINES.wanted)
  state.entities = state.entities.filter(e => e.hp > 0)   // the game culls the dead
  run(ctx, 1)
  // nobody dies for good: at home until the next day
  const p = cityPeople(state).find(q => q.id === a.cityKey)
  assert.equal(p.mode, 'indoors'); assert.equal(p.out, true)
  assert.ok(hostileWatch(state).length >= 1, 'the watch at the gate turns on you')
})

test('fire you laid that hurts a townsperson is violence too', () => {
  const ctx = setup()
  const { state } = ctx
  const [a] = twoTownsfolk(state)
  // a fireball's flames under a townsperson: the tick hands back a hurt copy
  const snap = npcSnapshot(state)
  const fz = updateFireZones([{ ...makeFireZone([{ x: Math.floor(a.px / S), y: Math.floor(a.py / S) }]), tickTimer: 0 }],
    state.entities, state.player, 0.01)
  state.entities = fz.entities
  const copy = state.entities.find(e => e.cityKey === a.cityKey)
  assert.ok(copy !== a && copy.hp < a.hp, 'burned')
  npcsStruckSince(ctx, snap)
  assert.equal(state.cityRun.crime.level, 'warned')
  assert.equal(said(state), CRIME_LINES.warn)
  assert.ok(copy.ai.fleeTimer > 0, 'the burned one runs')
  // the flames tick again on them before they are out of it: the same offence
  const burn = e => {
    const snap = npcSnapshot(state)
    state.entities = updateFireZones([{ ...makeFireZone([{ x: Math.floor(e.px / S), y: Math.floor(e.py / S) }]), tickTimer: 0 }],
      state.entities, state.player, 0.01).entities
    npcsStruckSince(ctx, snap)
  }
  burn(copy)
  assert.ok(state.entities.find(e => e.cityKey === a.cityKey).hp === a.hp - 2, 'burned twice')
  assert.equal(state.cityRun.crime.level, 'warned', 'one fire, one warning')
  assert.equal(said(state), CRIME_LINES.warn)
  // fire that burns someone after the grace, the warning standing, is the wanted
  run(ctx, WARN_GRACE + 0.1)
  const [, b] = twoTownsfolk(state)
  burn(b)
  assert.equal(state.cityRun.crime.level, 'wanted')
})

test('one action is one offence: within 1.5 s of the warning more counts for nothing, after it a second blow makes you wanted', () => {
  assert.equal(WARN_GRACE, 1.5)
  const c = makeCrime()
  assert.equal(onViolence(c, {}), 'warn')
  assert.equal(onViolence(c, {}), null, 'the same moment')
  assert.equal(tickCrime(c, 1.4, { inside: true }), null)
  assert.equal(onViolence(c, {}), null, 'still the same offence')
  assert.equal(c.level, 'warned')
  assert.equal(tickCrime(c, 0.2, { inside: true }), null)
  assert.equal(onViolence(c, {}), 'wanted', 'a second blow after the grace')
  const k = makeCrime()
  onViolence(k, {})
  assert.equal(onViolence(k, { killed: true }), 'wanted', 'a killing blow is never covered by the grace')

  // in the town: a blow and the wall slam it knocks them into, in one frame
  const ctx = setup()
  const { state } = ctx
  const [a, b] = twoTownsfolk(state)
  strike(ctx, a); strike(ctx, a)
  assert.equal(state.cityRun.crime.level, 'warned')
  assert.equal(said(state), CRIME_LINES.warn, 'the warning is what you hear')
  run(ctx, WARN_GRACE + 0.1)
  assert.ok(!cityEntities(state).some(e => e.hostile))
  strike(ctx, b)
  assert.equal(state.cityRun.crime.level, 'wanted')
  assert.equal(said(state), CRIME_LINES.wanted)
})

test('a fireball you set off among the townsfolk is violence: one burst, one warning', () => {
  const ctx = setup()
  const { state } = ctx
  const tileOf = e => ({ x: Math.floor(e.px / S), y: Math.floor(e.py / S) })
  // two townsfolk caught in one burst, as game.js detonateFireball finds them:
  // a snapshot before, npcsStruckSince after. A burst does 4, more than a
  // townsperson's 3 hp, so these two are made sturdier to be hurt, not killed
  const [a, b] = twoTownsfolk(state)
  for (const e of [a, b]) e.hp = e.maxHp = BURST_DAMAGE + 2
  const snap = npcSnapshot(state)
  state.entities = applyBurst(state.entities, state.player, [tileOf(a), tileOf(b)]).entities
  const hurt = [a, b].map(o => state.entities.find(e => e.cityKey === o.cityKey))
  assert.ok(hurt.every(e => e && e.hp === 2), 'both burned, both alive')
  npcsStruckSince(ctx, snap)
  assert.equal(state.cityRun.crime.level, 'warned', 'two hurt by one burst: one warning')
  assert.equal(said(state), CRIME_LINES.warn)
  assert.ok(hurt.every(e => e.ai.fleeTimer > 0), 'and they run')
  run(ctx, 1)
  assert.ok(!cityEntities(state).some(e => e.hostile), 'nobody turns on you')
  assert.equal(state.cityRun.crime.level, 'warned')

  // at the game's own numbers a burst kills a townsperson: a killing blow, wanted at once
  const ctx2 = setup()
  const [c] = twoTownsfolk(ctx2.state)
  const snap2 = npcSnapshot(ctx2.state)
  ctx2.state.entities = applyBurst(ctx2.state.entities, ctx2.state.player, [tileOf(c)]).entities
  assert.ok(!ctx2.state.entities.some(e => e.cityKey === c.cityKey), 'killed and culled')
  npcsStruckSince(ctx2, snap2)
  assert.equal(ctx2.state.cityRun.crime.level, 'wanted')
})

test('the watch never kills you: the last blow puts you in the stocks', () => {
  const ctx = setup({ at: NORTH_GATE })
  const { state, world } = ctx
  assert.equal(spares({ level: 'wanted' }, { species: 'watchman' }), true)
  assert.equal(spares({ level: 'warned' }, { species: 'watchman' }), false)
  assert.equal(spares({ level: 'wanted' }, { species: 'wolf' }), false)
  makeWanted(ctx)
  state.player.hp = 1
  run(ctx, 20, { each: () => !state.arrest })
  assert.ok(state.arrest, 'a watchman landed the last blow')
  assert.equal(state.player.hp, 1, 'and it did not kill')
  // what game.js does: the screen fades, and at its darkest the stocks
  assert.equal(arrest(state), true)
  assert.equal(state.arrest, false)
  assert.equal(state.cityRun.crime.level, 'stocks')
  assert.equal(state.player.stocks.t, 60)
  assert.ok(playerBound(state.player), 'bound')
  assert.equal(hostileWatch(state).length, 0, 'the watch is peaceful')
  assert.equal(hunters(state).length, 0)
  assert.equal(seat(state, world), true)
  const st = stocksWorld(world), spot = cityFor(SEED).spots.stocks
  assert.deepEqual(st, fromCity(spot.x, spot.y))
  assert.deepEqual(playerWorld(state, world), st, 'in the stocks on the square')
  // the townsfolk gather round and throw turnips, harmlessly
  let turnips = 0
  run(ctx, 20, { each: () => {
    turnips = Math.max(turnips, state.cityRun.fx.turnips.length)
    assert.ok(state.cityRun.fx.turnips.every(t => cheb({ X: t.toX, Y: t.toY }, st) < 1), 'at the stocks')
  } })
  assert.ok(turnips >= 1, 'turnips fly')
  assert.ok((ctx.cues.get('splat') ?? 0) >= 5, `and land (${ctx.cues.get('splat') ?? 0})`)
  assert.equal(state.player.hp, 1, 'harmless')
  const round = cityEntities(state).filter(e => e.species === 'townsfolk' && cheb(entityWorld(world, e), st) <= 3.5)
  assert.ok(round.length >= 4, `a crowd round the stocks (${round.length})`)
  assert.ok(hostileWatch(state).length === 0, 'and the watch stays peaceful')
  assert.ok(Math.abs(state.player.stocks.t - 40) < 0.2, `40 s left (${state.player.stocks.t})`)
  assert.ok(playerBound(state.player))
  // a minute in all, and they are let go: full hp, the record clean
  run(ctx, 40.5)
  assert.ok(state.player.stocks === null, 'out of the stocks')
  assert.ok(!playerBound(state.player))
  assert.equal(state.player.hp, state.player.maxHp)
  assert.equal(state.cityRun.crime.level, 'calm')
  assert.equal(said(state), 'Off you go. Mind your manners.')
  assert.equal(state.cityRun.fx.turnips.length, 0)
  run(ctx, 1)
  assert.equal(cityPeople(state).filter(p => p.gawk).length, 0, 'the crowd goes back about its day')
})

// Taken just outside the west gate by a player come from the west: the window
// is still the one round the land west of the city (it re-centres only 24
// tiles into a city piece), so the square is not in it and the window is built
// anew round the stocks (game.js toStocks: enterWilds, the tales, the town).
test('taken outside the west gate, the square beyond the window: the window is built round the stocks', () => {
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  const WEST_GATE = { X: 20, Y: 228 }   // the west gate's arch (city 20,68), its posts at 22,66 and 22,70
  enterWilds(state, world, { X: -4, Y: WEST_GATE.Y }, { buildEntities })   // walking in from the west
  assert.deepEqual(world.origin, { wx: -2, wy: 1 })
  const T = { clock: 0.5 * DAY_LENGTH, day: 0, view: { w: 20, h: 12 } }
  const cues = new Map()
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: name => cues.set(name, (cues.get(name) ?? 0) + 1), hurt: (target, amount) => { target.hp -= amount },
  }
  const ctx = { world, state, hooks, T, cues }
  // eight tiles beyond the wall, inside the watch's leash, the window not yet re-centred
  const out = roadAt(state, world, WEST_GATE.X - 8, WEST_GATE.Y)
  placePlayer(state, world, out.X, out.Y)
  arriveCity(state, world, hooks, { fresh: true })
  run(ctx, 0.5)
  const st = stocksWorld(world), spot = cityFor(SEED).spots.stocks
  assert.deepEqual(st, fromCity(spot.x, spot.y))
  const sq = toWindow(world.origin, st.X, st.Y)
  assert.ok(sq.x < 0 || sq.y < 0 || sq.x >= WIN_TILES || sq.y >= WIN_TILES, 'the square is beyond this window')
  makeWanted(ctx)
  state.player.hp = 1
  run(ctx, 20, { each: () => !state.arrest })
  assert.ok(state.arrest, 'the watch at the west gate landed the last blow')
  assert.equal(state.player.hp, 1)
  assert.equal(arrest(state), true)
  const player = state.player
  // at the fade's darkest: no seat in this window, so it is built round the stocks
  assert.equal(seat(state, world), false)
  let rebuilt = 0
  const ok = toStocks(state, world, at => {
    rebuilt++
    enterWilds(state, world, at, { buildEntities })
    arriveCity(state, world, hooks, { fresh: true })
  })
  assert.equal(ok, true)
  assert.equal(rebuilt, 1)
  assert.ok(state.player === player, 'the same player')
  assert.deepEqual(playerWorld(state, world), st, 'in the stocks on the square')
  const now = toWindow(world.origin, st.X, st.Y)
  assert.ok(now.x >= 80 && now.y >= 80 && now.x < 160 && now.y < 160, 'the window built round it')
  assert.ok(playerBound(state.player), 'bound')
  assert.ok(state.player.stocks.seated)
  assert.equal(state.cityRun.crime.level, 'stocks', 'the record went along')
  assert.ok(state.cityRun.crime.t > 50 && Math.abs(state.player.stocks.t - state.cityRun.crime.t) < 1e-9)
  // everyone once
  const once = () => {
    const keys = cityEntities(state).map(e => e.cityKey)
    assert.equal(new Set(keys).size, keys.length, 'no city entity twice')
    const people = cityPeople(state)
    assert.equal(new Set(people.map(p => p.id)).size, people.length)
    assert.equal(people.length, 140)
    for (const p of people) assert.equal(keys.filter(k => k === p.id).length, p.mode === 'near' ? 1 : 0, `${p.id} ${p.mode}`)
    assert.ok(people.filter(p => p.mode === 'near').length >= 10, 'the square is busy')
  }
  once()
  assert.equal(hostileWatch(state).length, 0, 'the watch is calm')
  assert.equal(hunters(state).length, 0)
  assert.ok(!state.entities.some(e => e.cityKey !== undefined && e.hostile))
  run(ctx, 10, { each: () => assert.equal(hostileWatch(state).length, 0) })
  once()
  assert.deepEqual(playerWorld(state, world), st, 'still in the stocks')
  assert.ok(cityPeople(state).filter(p => p.gawk).length >= 4, 'the crowd gathers')
  run(ctx, 50.5)
  assert.ok(state.player.stocks === null, 'out of the stocks')
  assert.equal(state.player.hp, state.player.maxHp)
  assert.equal(state.cityRun.crime.level, 'calm')
  once()
})

test('two minutes outside the walls and you are no longer wanted', () => {
  const c = makeCrime()
  onViolence(c, { killed: true })
  assert.equal(tickCrime(c, 100, { inside: false }), null)
  assert.equal(tickCrime(c, 10, { inside: true }), null, 'back inside: the count starts again')
  assert.equal(c.away, 0)
  assert.equal(tickCrime(c, 119, { inside: false }), null)
  assert.equal(c.level, 'wanted')
  assert.equal(tickCrime(c, 1, { inside: false }), 'cleared')
  assert.equal(c.level, 'calm')

  const ctx = setup({ at: NORTH_GATE })
  const { state, world, hooks, T } = ctx
  makeWanted(ctx)
  // out of the gate and up the road, out of the watch's reach
  const far = roadAt(state, world, 80, NORTH_WALL_Y - 18)
  placePlayer(state, world, far.X, far.Y)
  assert.ok(beyondWall(state, state.player.x, state.player.y) > CRIME.leashTiles)
  run(ctx, 119, { npcs: false })
  assert.equal(state.cityRun.crime.level, 'wanted', 'not yet')
  assert.equal(hunters(state).length, 0, 'nobody hunts you out here')
  run(ctx, 1.2, { npcs: false })
  assert.equal(state.cityRun.crime.level, 'calm', 'two minutes: no longer wanted')

  // walking off until the town leaves the window does not end it sooner: the
  // time away counts on while it is out of the window
  makeWanted(ctx)
  enterWilds(state, world, { wx: 0, wy: 0 }, { buildEntities })   // Koivula's window: no city piece in it
  arriveCity(state, world, hooks)
  assert.ok(state.cityRun === undefined, 'no city in the window')
  T.clock += 60
  enterWilds(state, world, far, { buildEntities })
  arriveCity(state, world, hooks)
  assert.equal(state.cityRun.crime.level, 'wanted', 'a minute away is not two')
  enterWilds(state, world, { wx: 0, wy: 0 }, { buildEntities })
  arriveCity(state, world, hooks)
  T.clock += 61
  enterWilds(state, world, NORTH_GATE, { buildEntities })
  arriveCity(state, world, hooks)
  assert.equal(state.cityRun.crime.level, 'calm', 'two minutes away all told')

  // and a load clears it: the town is built anew
  run(ctx, 1, { npcs: false })   // the town come into the window is placed a few a frame
  makeWanted(ctx)
  arriveCity(state, world, hooks, { fresh: true })
  assert.equal(state.cityRun.crime.level, 'calm')
})

test('wanted, then killed by a wolf outside: a normal death, and you wake on the inn doorstep with crime cleared', () => {
  const ctx = setup({ at: NORTH_GATE })
  const { world, hooks } = ctx
  let { state } = ctx
  tickWilds(state, world, DT, { buildEntities })
  assert.deepEqual(world.lastVillage, { wx: 0, wy: 2 }, 'inside the walls: the city is where you wake')
  makeWanted(ctx)
  run(ctx, 0.5)
  assert.ok(hostileWatch(state).length >= 1)
  // out on the road, beyond the watch's reach, a wolf
  const out = roadAt(state, world, 80, NORTH_WALL_Y - 14)
  placePlayer(state, world, out.X, out.Y)
  const wolf = makeNpc({ species: 'wolf', id: 'wolf:test', x: state.player.x, y: state.player.y - 1 })
  state.entities.push(wolf)
  state.player.hp = 1
  state.player.invulnTimer = 0   // the watch's blows a moment ago (game.js counts it down)
  damagePlayer(state, 3, 'hit', wolf)
  assert.ok(state.player.hp <= 0, 'the wolf kills')
  assert.ok(!state.arrest, 'no stocks for that')
  // what game.js does on a death in the Wilds: wake in the last village, the window built anew round it
  state = adventureRespawn(state, { x: state.player.x, y: state.player.y })
  wildsRespawn(state, world, { buildEntities })
  arriveCity(state, world, hooks, { fresh: true })
  clearCrime(state)
  const inn = cityFor(SEED).inn.doorstep
  assert.deepEqual(playerWorld(state, world), fromCity(inn.x, inn.y), 'on the inn doorstep')
  assert.equal(state.player.hp, state.player.maxHp)
  assert.equal(state.cityRun.crime.level, 'calm', 'crime cleared')
  assert.ok((state.player.stocks ?? null) === null, 'not in the stocks')
  assert.ok(!state.arrest)
  assert.equal(hostileWatch(state).length, 0)
  assert.equal(hunters(state).length, 0)
})

test('a struck townsperson flees; nobody else turns on you', () => {
  const ctx = setup()
  const { state } = ctx
  const tf = cityEntities(state).filter(e => e.species === 'townsfolk' && inside(state, e))
  const a = tf.find(e => tf.some(o => o !== e && Math.max(Math.abs(o.x - e.x), Math.abs(o.y - e.y)) <= 4))
  assert.ok(a, 'a townsperson with others about')
  const nearby = tf.filter(o => o !== a && Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y)) <= 4)
  // a village's own villager in the window: the shared wrath would set him on you
  const v = makeNpc({ species: 'villager', id: 'npc:v', x: state.player.x, y: state.player.y })
  state.entities.push(v)
  const r = strike(ctx, a)
  assert.equal(r.wrath, false, 'the city shares no wrath')
  assert.ok(a.ai.fleeTimer > 0, 'the struck one runs')
  assert.ok(nearby.every(o => o.ai.fleeTimer > 0), `and those about them (${nearby.length})`)
  run(ctx, 3)
  assert.ok(!cityEntities(state).some(e => e.hostile), 'nobody turns on you')
  assert.ok(!state.npcWrath)
  assert.equal(v.hostile, false)
  assert.equal(state.cityRun.crime.level, 'warned', 'the watch has warned you')
})

test('at most six watchmen hunt you at once, and they stop ten tiles beyond the wall', () => {
  const ctx = setup({ at: NORTH_GATE })
  const { state, world } = ctx
  state.player.hp = state.player.maxHp = 1e6   // the watch's blows land, the stocks never come
  makeWanted(ctx)
  let most = 0
  const fewEnough = () => {
    const h = hostileWatch(state).length
    most = Math.max(most, h)
    assert.ok(h <= CRIME.maxHostile, `${h} hostile`)
    assert.ok(hunters(state).length <= CRIME.maxHostile, `${hunters(state).length} hunting`)
  }
  run(ctx, 10, { each: fewEnough })
  assert.equal(most, 6, 'six hunt you')
  assert.ok(hunters(state).some(w => w.person.shift === 'night'), 'men off duty came out of the barracks door')
  assert.ok(hostileWatch(state).some(e => cheb(entityWorld(world, e), playerWorld(state, world)) <= 2), 'they come at you')
  assert.ok(cityEntities(state).every(e => e.species === 'watchman' || !e.hostile), 'only the watch')

  // out of the gate, eight tiles beyond the wall: they follow
  const leash = (e, slack = 1) => assert.ok(beyondWall(state, e.x, e.y) <= CRIME.leashTiles + slack,
    `${e.cityKey} ${beyondWall(state, e.x, e.y)} tiles beyond the wall`)
  const near8 = roadAt(state, world, 80, NORTH_WALL_Y - 8)
  placePlayer(state, world, near8.X, near8.Y)
  run(ctx, 8, { each: () => { fewEnough(); for (const e of hostileWatch(state)) leash(e) } })
  assert.ok(hostileWatch(state).some(e => cheb(entityWorld(world, e), playerWorld(state, world)) <= 2), 'out of the gate after you')
  // one carried past the leash (knocked, chasing round): he turns back, and
  // hunts again only once he is inside the walls
  const g = hostileWatch(state)[0], past = roadAt(state, world, 80, NORTH_WALL_Y - 13)
  const pt = toWindow(world.origin, past.X, past.Y)
  g.px = pt.x * S + 16; g.py = pt.y * S + 16; g.x = pt.x; g.y = pt.y
  assert.ok(beyondWall(state, g.x, g.y) > CRIME.leashTiles)
  run(ctx, DT)
  const back = state.entities.find(e => e.cityKey === g.cityKey)
  assert.ok(back && !back.hostile, 'turned back'); assert.ok(!hunters(state).some(w => w.id === g.cityKey))
  let wasInside = false
  run(ctx, 6, { each: () => {
    fewEnough()
    const e = state.entities.find(q => q.cityKey === g.cityKey)
    if (e && beyondWall(state, e.x, e.y) === 0) wasInside = true
    if (e && !wasInside) assert.ok(!e.hostile, 'not hunting until back inside')
  } })

  // eighteen beyond: out of reach. They stop and walk back
  const far = roadAt(state, world, 80, NORTH_WALL_Y - 18)
  placePlayer(state, world, far.X, far.Y)
  run(ctx, 20, { each: () => { for (const e of hostileWatch(state)) leash(e) } })
  assert.equal(hostileWatch(state).length, 0, 'calm again')
  assert.equal(hunters(state).length, 0)
  for (const e of cityEntities(state).filter(q => q.species === 'watchman')) leash(e, -CRIME.leashTiles + 1)
  assert.equal(state.cityRun.crime.level, 'wanted', 'still wanted')
})
