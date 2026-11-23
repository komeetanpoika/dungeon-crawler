// The town's sound (wilds/city/ambience.js): which cues come from where. The
// decisions are pure (a run in, cues out), so most tests hand tickAmbience a
// small made-up run with the real plan's places; one goes through the real
// runtime. Runs and entities are never compared with assert.equal (a failing
// strict equal diffs the whole city); only numbers, names and booleans are.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tickAmbience, TOLLS, NEAR_TILES } from '../renderer/wilds/city/ambience.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { CITY_OX as OX, CITY_OY as OY } from '../renderer/wilds/city/walkers.js'
import { RECIPES } from '../renderer/render/audio.js'
import { CUE_NAMES } from '../renderer/systems/sfx.js'
import { arriveCity, tickCity } from '../renderer/wilds/city/runtime.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { makeNpc } from '../renderer/systems/npc.js'
import * as feedback from '../renderer/systems/feedback.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const S = 32
const DT = 0.1
const NEW_CUES = ['city-murmur', 'hammer', 'gull', 'bell', 'bark', 'wings', 'tavern', 'crier-bell', 'boots', 'jeer', 'splat']

// a made-up run: the window's origin is the city's, so a city tile (x, y) is window tile (x, y)
function fake({ frac = 0.5, people = [] } = {}) {
  const state = { player: { px: 0, py: 0 }, sfx: { cues: [] } }
  const run = {
    seed: 7, ox: OX, oy: OY, frac, day: 0,
    people: new Map(people.map((p, i) => [i, p])), animals: new Map(),
    fx: { flocks: [], smithy: null, bell: false, crier: null },
    cc: { city: { doors: [{ kind: 'inn', label: 'inn-door' }] } },
  }
  return { state, run }
}
const at = (state, x, y) => { state.player.px = x * S + 16; state.player.py = y * S + 16 }
const walker = (x, y, extra = {}) => ({ X: x + OX, Y: y + OY, mode: 'far', out: false, person: { job: 'x' }, ...extra })
const crowd = (n, x0, y0) => Array.from({ length: n }, (_, i) => walker(x0 + (i % 5), y0 + Math.floor(i / 5)))
function runFor(ctx, seconds, each) {
  const cues = []
  const emit = (name, pos) => cues.push({ name, ...pos })
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    each?.(t)
    tickAmbience(ctx.state, ctx.run, DT, emit)
  }
  return cues
}
const count = (cues, name) => cues.filter(c => c.name === name).length
const SQ = PLAN.places.square, FOUNTAIN = PLAN.places.fountain

test('every new cue of the town has a recipe and a name', () => {
  for (const n of NEW_CUES) {
    assert.ok(RECIPES[n], `recipe ${n}`)
    assert.ok(CUE_NAMES.includes(n), `cue name ${n}`)
  }
})

test('the square murmurs more when crowded', () => {
  const heard = n => {
    const ctx = fake({ people: crowd(n, FOUNTAIN.x - 8, FOUNTAIN.y + 6) })
    at(ctx.state, FOUNTAIN.x, FOUNTAIN.y)
    return count(runFor(ctx, 20), 'city-murmur')
  }
  const empty = heard(0), few = heard(3), many = heard(14)
  assert.equal(empty, 0, 'nothing from an empty square')
  assert.ok(few > 0, `a few people murmur (${few})`)
  assert.ok(many > few, `a crowd murmurs more (${many} > ${few})`)
  assert.ok(many <= 20 * 6, `a few a second at most (${many})`)
})

test('the market street murmurs too, and people indoors do not', () => {
  const ctx = fake({ people: crowd(6, 79, 40) })
  at(ctx.state, 80, 36)
  assert.ok(count(runFor(ctx, 10), 'city-murmur') > 0, 'the market street murmurs')
  const quiet = fake({ people: crowd(6, 79, 40).map(p => ({ ...p, mode: 'indoors' })) })
  at(quiet.state, 80, 36)
  assert.equal(count(runFor(quiet, 10), 'city-murmur'), 0, 'a house full of people is not the street')
})

test('the bell rings once at the hour', () => {
  const ctx = fake({ frac: DAY.bell - 0.1 })
  at(ctx.state, 30, 68)
  let ringing = false, startedAt = null
  const cues = []
  for (let t = 0; t < 30; t += DT) {
    ringing = t >= 5 && t < 20           // the church bell rings from 5 s to 20 s
    ctx.run.fx.bell = ringing
    if (ringing && startedAt === null) startedAt = t
    tickAmbience(ctx.state, ctx.run, DT, (name, pos) => { if (name === 'bell') cues.push({ t, ...pos }) })
  }
  assert.equal(cues.length, TOLLS, 'one peal of tolls')
  assert.ok(cues[0].t - startedAt < 2 * DT, 'the first toll sounds as the ringing starts')
  assert.ok(cues.every(c => c.t >= 5 && c.t < 20), 'none outside the ringing')
  // the next day's ringing sounds again
  ctx.run.fx.bell = false
  runFor(ctx, 1)
  ctx.run.fx.bell = true
  assert.ok(count(runFor(ctx, 1), 'bell') === 1, 'rings again when it starts again')
})

test('nothing sounds from beyond 20 tiles', () => {
  const sources = (ctx, x, y) => {
    // every source of the town set at (x, y) city tiles
    const X = x + OX, Y = y + OY
    ctx.run.fx.smithy = { X, Y, state: 'hammering', blows: 0 }
    ctx.run.fx.crier = { X, Y, rings: 0 }
    ctx.run.fx.flocks = [{ kind: 'pigeon', X, Y, state: 'settled', lifts: 0, birds: 4 }]
    ctx.run.fx.bell = true
    ctx.run.animals.set('dog:0', { species: 'dog', mode: 'near', X, Y })
    return () => { ctx.run.fx.smithy.blows++; ctx.run.fx.crier.rings++; ctx.run.fx.flocks[0].lifts++ }
  }
  const near = fake({ frac: DAY.night + 0.02, people: [] })
  const far = fake({ frac: DAY.night + 0.02, people: [] })
  // the player by the church of the town, the sources in the south-east: > 20 tiles from all
  at(far.state, 125, 40); at(near.state, 30, 50)
  const bumpFar = sources(far, 36, 50)
  const bumpNear = sources(near, 36, 50)
  const hear = (ctx, bump) => runFor(ctx, 30, t => { if (Math.round(t * 10) % 10 === 0) bump() })
  const farCues = hear(far, bumpFar), nearCues = hear(near, bumpNear)
  assert.deepEqual(farCues.map(c => c.name), [], 'silent beyond 20 tiles')
  for (const n of ['hammer', 'crier-bell', 'wings', 'bell']) assert.ok(count(nearCues, n) > 0, `${n} is heard near`)
  assert.ok(NEAR_TILES === 20)
})

test('the tavern is heard at night, with someone in the inn, and the cues sit at the inn door', () => {
  const door = PLAN.places.inn.door
  const make = (frac, n) => {
    const ctx = fake({ frac, people: Array.from({ length: n }, () => walker(0, 0, { mode: 'indoors', door: 'inn-door' })) })
    at(ctx.state, door.x, door.y + 4)
    return ctx
  }
  const night = runFor(make(DAY.night + 0.02, 3), 15)
  assert.ok(count(night, 'tavern') > 0, 'noise at night')
  const c = night.find(x => x.name === 'tavern')
  assert.ok(Math.abs(c.px - (door.x * S + 16)) < S && Math.abs(c.py - (door.y * S + 16)) < S, 'from the door')
  assert.equal(count(runFor(make(0.5, 3), 15), 'tavern'), 0, 'not by day')
  assert.equal(count(runFor(make(DAY.night + 0.02, 0), 15), 'tavern'), 0, 'not from an empty inn')
})

test('a patrol\'s boots and a dog\'s bark are heard near, a lifting flock gives wings', () => {
  const patrol = walker(80, 40, { mode: 'near', entry: { act: 'patrol' }, still: 0, person: { job: 'watch' } })
  const ctx = fake({ people: [patrol] })
  at(ctx.state, 80, 44)
  ctx.run.animals.set('dog:0', { species: 'dog', mode: 'near', X: 84 + OX, Y: 44 + OY })
  ctx.run.fx.flocks = [{ kind: 'pigeon', X: 82 + OX, Y: 46 + OY, state: 'settled', lifts: 0, birds: 4 }]
  const cues = runFor(ctx, 20, t => { if (Math.abs(t - 5) < 1e-6) ctx.run.fx.flocks[0].lifts++ })
  assert.ok(count(cues, 'boots') > 10, 'boots')
  assert.ok(count(cues, 'bark') >= 1, 'a bark')
  assert.ok(count(cues, 'bark') <= 6, `one bark at a time, not a din (${count(cues, 'bark')})`)
  assert.equal(count(cues, 'wings'), 1, 'wings once for one lift')
  // a watchman standing at his post makes no footsteps
  patrol.still = 5
  assert.equal(count(runFor(ctx, 5), 'boots'), 0, 'no boots when he stands')
})

test('gulls cry at the quay by day', () => {
  const ctx = fake()
  at(ctx.state, 79, 100)
  assert.ok(count(runFor(ctx, 30), 'gull') > 0, 'gulls by day')
  const night = fake({ frac: DAY.night + 0.05 })
  at(night.state, 79, 100)
  assert.equal(count(runFor(night, 30), 'gull'), 0, 'not at night')
  const far = fake()
  at(far.state, 30, 30)
  assert.equal(count(runFor(far, 30), 'gull'), 0, 'not from the far end of town')
})

test('no street sound indoors', () => {
  const ctx = fake({ people: crowd(14, SQ.x0 + 2, SQ.y0 + 2) })
  at(ctx.state, FOUNTAIN.x, FOUNTAIN.y)
  ctx.run.fx.bell = true
  ctx.state.cave = { surface: {} }
  assert.equal(runFor(ctx, 10).length, 0, 'silent in a house')
})

test('through the runtime the church bell sounds when it rings', () => {
  const buildEntities = spawns => spawns.flatMap(s => { const n = s.kind === 'npc' ? makeNpc(s) : null; return n ? [n] : [] })
  const world = makeWorld(null, { seed: 7 })
  const state = {
    player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5, facing: 'south' }, entities: [], projectiles: [], zones: [],
    fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: feedback.makeFeedback(),
    caveInstances: {}, sfx: { cues: [] },
  }
  const door = PLAN.places.churchDoor
  enterWilds(state, world, { X: door.x + OX, Y: door.y + OY + 2 }, { buildEntities })
  const T = { clock: (DAY.bell - 0.04) * DAY_LENGTH }
  const heard = []
  const hooks = { spawn: s => buildEntities(s), clock: () => T.clock, day: () => 0, viewHalf: () => ({ w: 16, h: 11 }), sfx: (n, p) => heard.push(n), hurt: () => {} }
  arriveCity(state, world, hooks, { fresh: true })
  for (let t = 0; t < 0.12 * DAY_LENGTH; t += DT) { T.clock += DT; tickCity(state, world, DT, hooks) }
  assert.ok(heard.filter(n => n === 'bell').length >= 1, `the bell sounded (${heard.length} cues)`)
})
