// Sandstorms in the Wilds' desert (wilds/storm.js): the day's schedule, where
// the storm blows and where it does not, what it takes from the hero (sight,
// the map) and from the monsters (how far they see), and its wind.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STORM, stormOfDay, stormStrength, stormHere, stormWind, tickStorm, calmStorm, mapHazed, mapHero, sightNow, litRadius, LIT_PAD, TAKES_MAP, WIND_HEARD,
} from '../renderer/wilds/storm.js'
import { SIGHT, BEACON_RANGE, isDesert } from '../renderer/wilds/desert.js'
import { windAt, prevailingWind, nearCity, WIND } from '../renderer/wilds/desert-art.js'
import { fromCity } from '../renderer/wilds/city/geometry.js'
import { insideWalls } from '../renderer/wilds/city/plan.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds, landOf } from '../renderer/wilds/session.js'
import { buildCaveState, restoreSurface } from '../renderer/systems/cave.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { updateBrain } from '../renderer/systems/brain.js'
import { makeNpc, updateNpc, buildCtx } from '../renderer/systems/npc.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const SEED = 7
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// The first stormy day of `seed`, its storm, and the clock at its peak.
function stormyDay(seed = SEED, from = 0) {
  for (let day = from; ; day++) {
    const s = stormOfDay(seed, day)
    if (s) return { day, ...s, peak: s.start + STORM.ramp + s.len / 2 }
  }
}
const freshState = () => ({ player: { x: 0, y: 0, px: 16, py: 16 }, entities: [], sfx: makeSfx() })
const plainWorld = day => ({ seed: SEED, day, playtime: 10_000 })
const DESERT = { desert: true, ring: false, village: false }
// `secs` of frames at `dt`, the clock held or running from `clock`.
function frames(state, world, secs, { clock, dt = 0.1, run = false, ...land } = {}) {
  let c = clock
  for (let t = 0; t < secs - 1e-9; t += dt) {
    world.playtime += dt
    if (run) c += dt
    tickStorm(state, world, { clock: c, delta: dt, ...DESERT, ...land })
  }
  return c
}

test('about half the days have a storm, each 40-70 s at full strength plus its ramps', () => {
  const DT = 0.05
  let stormy = 0
  for (let day = 0; day < 400; day++) {
    let full = 0, any = 0
    for (let clock = 0; clock < DAY_LENGTH; clock += DT) {
      const s = stormStrength(SEED, day, clock)
      assert.ok(s >= 0 && s <= 1, `strength ${s} out of 0..1`)
      if (s >= 1) full += DT
      if (s > 0) any += DT
    }
    if (!any) continue
    stormy++
    assert.ok(full >= STORM.minLen - 2 * DT && full <= STORM.maxLen + 2 * DT, `day ${day}: ${full.toFixed(2)} s at full strength`)
    assert.ok(Math.abs(any - full - 2 * STORM.ramp) <= 4 * DT, `day ${day}: ramps of ${(any - full).toFixed(2)} s in all`)
  }
  assert.ok(stormy >= 160 && stormy <= 240, `${stormy} stormy days of 400`)
})

test('the schedule is pure in (seed, day, clock)', () => {
  const { day, start } = stormyDay()
  for (const clock of [0, start + 1, start + 30, 200.5, 359.9]) {
    assert.equal(stormStrength(SEED, day, clock), stormStrength(SEED, day, clock))
  }
  // another seed has another schedule
  let differs = false
  for (let d = 0; d < 20 && !differs; d++) differs = JSON.stringify(stormOfDay(SEED, d)) !== JSON.stringify(stormOfDay(SEED + 1, d))
  assert.ok(differs)
})

test('it ramps: from 0 to 1 over 5 s and back to 0 over 5 s', () => {
  const { day, start, end } = stormyDay()
  const at = t => stormStrength(SEED, day, t)
  assert.equal(at(start - 0.01), 0)
  assert.ok(near(at(start + STORM.ramp / 2), 0.5))
  assert.ok(near(at(start + STORM.ramp), 1, 1e-9))
  assert.ok(near(at(end - STORM.ramp), 1, 1e-9))
  assert.ok(near(at(end - STORM.ramp / 2), 0.5))
  assert.equal(at(end + 0.01), 0)
  for (let t = start; t < start + STORM.ramp; t += 0.25) assert.ok(at(t + 0.25) > at(t), `not rising at ${t}`)
  for (let t = end - STORM.ramp; t < end; t += 0.25) assert.ok(at(t + 0.25) < at(t), `not falling at ${t}`)
  assert.ok(end <= DAY_LENGTH, 'the storm is over before the day ends')
})

test('no storm in the gentle ring, on Kalevanlinna\'s ground, indoors, riding, or within the calm', () => {
  const blowing = { strength: 0.8, desert: true, ring: false, city: false, indoors: false, riding: false, calm: false }
  assert.equal(stormHere(blowing), 0.8)
  assert.equal(stormHere({ ...blowing, desert: false }), 0)
  assert.equal(stormHere({ ...blowing, ring: true }), 0)
  assert.equal(stormHere({ ...blowing, city: true }), 0)
  assert.equal(stormHere({ ...blowing, indoors: true }), 0)
  assert.equal(stormHere({ ...blowing, riding: true }), 0)
  assert.equal(stormHere({ ...blowing, calm: true }), 0)
})

test('no storm within two minutes of waking, then it follows the schedule', () => {
  const sd = stormyDay()
  const world = makeWorld(null, { seed: SEED })
  world.day = sd.day
  world.playtime = 500
  const state = freshState()
  state.storm = 1   // left over from before: a wake starts clear
  enterWilds(state, world, { X: 263, Y: 10 }, { buildEntities: () => [] })
  assert.equal(world.calmUntil, 500 + STORM.grace)
  assert.equal(state.storm, 0)
  assert.equal(state.sightCap, null)
  // the clock held at the storm's peak: a test of the calm alone (a storm is
  // shorter than the calm, so a running clock would see it out)
  for (let t = 0; t < STORM.grace - 0.15; t += 0.1) {
    world.playtime += 0.1
    tickStorm(state, world, { clock: sd.peak, delta: 0.1, ...DESERT })
    assert.equal(state.storm, 0, `a storm ${t.toFixed(1)} s after waking`)
  }
  frames(state, world, 0.2, { clock: sd.peak })
  assert.ok(state.storm > 0, 'the calm is over')
  frames(state, world, STORM.ramp, { clock: sd.peak })
  assert.equal(state.storm, stormStrength(SEED, sd.day, sd.peak))
  // the coach's arrival calms it the same way
  calmStorm(world)
  frames(state, world, 0.1, { clock: sd.peak })
  assert.equal(state.storm, 0)
})

test('a house door does not end the storm', () => {
  const sd = stormyDay()
  const world = plainWorld(sd.day), state = freshState()
  frames(state, world, STORM.ramp + 1, { clock: sd.peak })
  assert.equal(state.storm, 1)
  const map = createMap(6, 6)
  const house = buildCaveState(state, { x: 0, y: 0, caveDepth: 19, label: 'house:wilds:1,1' },
    { map, entities: [], playerSpawn: { x: 2, y: 2 }, theme: null, exit: { x: 2, y: 3 } })
  tickStorm(house, world, { clock: sd.peak, delta: 0.1, ...DESERT })
  assert.equal(house.storm, 0)
  assert.equal(house.sightCap, null)
  assert.equal(mapHero(house, { X: 1, Y: 1 }).X, 1, 'the map knows the door')
  // (the clock stands still indoors) out again before the storm is over: it is back
  const out = restoreSurface(house)
  tickStorm(out, world, { clock: sd.peak, delta: 0.1, ...DESERT })
  assert.equal(out.storm, 1)
  assert.equal(out.sightCap, SIGHT.storm)
})

test('the coach rides clear', () => {
  const sd = stormyDay()
  const world = plainWorld(sd.day), state = freshState()
  frames(state, world, STORM.ramp + 1, { clock: sd.peak })
  assert.equal(state.storm, 1)
  state.player.riding = true
  tickStorm(state, world, { clock: sd.peak, delta: 0.1, ...DESERT })
  assert.equal(state.storm, 0)
  assert.equal(state.sightCap, null)
  const hero = { X: 900, Y: -70 }
  assert.ok(mapHero(state, hero) === hero, 'the map keeps its hero')
  assert.equal(mapHazed(state), false)
})

test('walking out of the desert ends it, walking back finds it', () => {
  const sd = stormyDay()
  const world = plainWorld(sd.day), state = freshState()
  const hero = { X: 900, Y: -70 }
  let clock = frames(state, world, STORM.ramp + 1, { clock: sd.start, run: true })
  assert.equal(state.storm, 1)
  assert.equal(sightNow(state, true).radius, SIGHT.storm + LIT_PAD)
  assert.equal(mapHero(state, hero), null)
  // onto forest: the storm dies down over the ramp
  clock = frames(state, world, 1, { clock, run: true, desert: false })
  assert.ok(state.storm > 0 && state.storm < 1, 'it fades, not cut')
  clock = frames(state, world, STORM.ramp, { clock, run: true, desert: false })
  assert.equal(state.storm, 0)
  assert.equal(state.sightCap, null)
  assert.equal(sightNow(state, false).radius, SIGHT.base)
  assert.equal(sightNow(state, false).far, BEACON_RANGE)
  assert.ok(mapHero(state, hero) === hero, 'the map hero is back')
  // back onto desert before its time is up: it blows again
  assert.ok(clock < sd.end - STORM.ramp - 10)
  frames(state, world, STORM.ramp + 0.5, { clock, run: true })
  assert.equal(state.storm, 1)
  assert.equal(mapHero(state, hero), null)
})

test('a village thins it: sight 8 there', () => {
  const sd = stormyDay()
  const world = plainWorld(sd.day), state = freshState()
  frames(state, world, STORM.ramp + 1, { clock: sd.peak, village: true })
  assert.equal(state.storm, 1)
  assert.equal(state.sightCap, SIGHT.stormVillage)
})

test('the storm takes the map at half strength, and gives it back', () => {
  const hero = { X: 900, Y: -70 }
  for (const [storm, taken] of [[0, false], [0.3, false], [TAKES_MAP - 0.01, false], [TAKES_MAP, true], [1, true]]) {
    const state = { storm }
    assert.equal(mapHazed(state), taken, `storm ${storm}`)
    assert.equal(mapHero(state, hero), taken ? null : hero, `storm ${storm}`)
  }
  assert.equal(mapHazed({}), false)
})

test('the storm takes the minimap: haze only, no land and no hero', async () => {
  const ops = []
  const gradients = []
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k]
      : k === 'createRadialGradient' ? () => { const g = { stops: [], addColorStop(o, c) { this.stops.push(c) } }; gradients.push(g); return g }
      : (...a) => ops.push([k, ...a])),
    set: (t, k, v) => { if (k === 'fillStyle') ops.push(['fillStyle', v]); t[k] = v; return true },
  })
  const el = { hidden: true, width: 0, height: 0, getContext: () => ctx }
  const classes = new Set()
  globalThis.document = {
    getElementById: id => (id === 'minimap' ? el : null),
    body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
    createElement: () => { throw new Error('a piece picture was made') },
  }
  try {
    const { updateMinimap, MINIMAP_PX } = await import('../renderer/render/minimap.js')
    const world = makeWorld(null, { seed: SEED })
    world.map.set('11,-1', new Uint8Array(1600).fill(2))   // land seen round the hero
    world.mapVer.set('11,-1', 1)
    updateMinimap(world, { X: 900, Y: -70 }, true, { haze: true })
    assert.equal(el.hidden, false, 'the minimap stays up')
    assert.ok(classes.has('has-minimap'))
    assert.ok(ops.some(o => o[0] === 'fillRect' && o[3] === MINIMAP_PX && o[4] === MINIMAP_PX), 'no haze over the whole minimap')
    assert.ok(!ops.some(o => o[0] === 'drawImage'), 'land drawn under the haze')
    // the hero's mark is a white square
    assert.ok(!ops.some(o => o[0] === 'fillStyle' && o[1] === '#fff'), 'the hero marked')
    // a few soft wisps of sand, none near white
    assert.ok(gradients.length >= 3 && gradients.length <= 16, `${gradients.length} wisps`)
    const colours = [...ops.filter(o => o[0] === 'fillStyle' && typeof o[1] === 'string').map(o => o[1]), ...gradients.flatMap(g => g.stops)]
    for (const c of colours) {
      const [r, g, b] = c.match(/\d+/g).map(Number)
      assert.ok(Math.min(r, g, b) < 200, `near white: ${c}`)
    }
  } finally {
    delete globalThis.document
  }
})

test('monsters see less: capped at the storm sight plus one tile', () => {
  const map = createMap(30, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 29; x++) map[y][x].tile = TILE.FLOOR
  const S = 32
  const foe = () => ({ type: 'wizard', maxHp: 4, hp: 4, x: 4, y: 4, px: 4 * S + S / 2, py: 4 * S + S / 2 })
  const player = { type: 'player', x: 12, y: 4, px: 12 * S + S / 2, py: 4 * S + S / 2, hp: 10, maxHp: 10 }
  // a wizard sees 300 px: the hero 8 tiles off in clear sight is seen
  const clear = foe()
  updateBrain(clear, { map, player, entities: [clear] }, 1 / 60)
  assert.equal(clear.ai.mode, 'chase')
  const blind = foe()
  updateBrain(blind, { map, player, entities: [blind], sightCap: SIGHT.storm }, 1 / 60)
  assert.notEqual(blind.ai.mode, 'chase')
  // within the storm sight plus one he is seen
  const close = foe()
  const by = { ...player, x: 9, px: 9 * S + S / 2 }
  updateBrain(close, { map, player: by, entities: [close], sightCap: SIGHT.storm }, 1 / 60)
  assert.equal(close.ai.mode, 'chase')
})

test('a wolf (an NPC-run foe) sees less too: capped at the storm sight plus one tile', () => {
  const map = createMap(30, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 29; x++) map[y][x].tile = TILE.FLOOR
  const S = 32
  const hero = x => ({ type: 'player', x, y: 4, px: x * S + S / 2, py: 4 * S + S / 2, hp: 10, maxHp: 10 })
  // a wolf sees 200 px: the hero 6 tiles off in clear sight is noticed
  const look = (x, sightCap) => {
    const wolf = makeNpc({ species: 'wolf', id: 'w', x: 4, y: 4 })
    const state = { map, player: hero(x), entities: [wolf], sightCap }
    updateNpc(wolf, state, 1 / 60)
    return { mode: wolf.ai.mode, sees: buildCtx(wolf, state, 1 / 60).canSeePlayer }
  }
  assert.deepEqual(look(10, null), { mode: 'chase', sees: true })
  // the same 6 tiles in a full storm: the cap is SIGHT.storm + 1 = 5 tiles
  assert.deepEqual(look(10, SIGHT.storm), { mode: 'patrol', sees: false })
  // within the cap he is noticed again
  assert.deepEqual(look(4 + SIGHT.storm + 1, SIGHT.storm), { mode: 'chase', sees: true })
})

test('the wind is heard every 2.5 s while the storm is over 0.3', () => {
  const sd = stormyDay()
  const world = plainWorld(sd.day), state = freshState()
  const gusts = () => state.sfx.cues.filter(c => c.name === 'storm-wind').length
  // rising through the ramp from its start: nothing until it passes 0.3
  let clock = sd.start
  for (let t = 0; t < STORM.ramp + 0.01; t += 0.05) {
    world.playtime += 0.05; clock += 0.05
    tickStorm(state, world, { clock, delta: 0.05, ...DESERT })
    if (state.storm <= WIND_HEARD) assert.equal(gusts(), 0, `heard at ${state.storm.toFixed(2)}`)
  }
  assert.ok(gusts() >= 1)
  state.sfx.cues.length = 0
  frames(state, world, 10, { clock, run: true, dt: 0.05 })
  assert.ok(gusts() >= 4 && gusts() <= 5, `${gusts()} gusts in 10 s`)
  assert.ok(state.sfx.cues.every(c => c.px === undefined), 'the wind has no place')
  // indoors (or out of the storm) none
  state.sfx.cues.length = 0
  const house = { ...state, cave: { surface: state }, sfx: state.sfx }
  for (let t = 0; t < 10; t += 0.1) tickStorm(house, world, { clock, delta: 0.1, ...DESERT })
  assert.equal(gusts(), 0)
})

test('sight in a storm: the radius closes to 4 and the lit cells a tile past it, and landmarks are not seen past them', () => {
  assert.deepEqual(sightNow({}, true), { radius: SIGHT.desert, far: BEACON_RANGE })
  assert.deepEqual(sightNow({ storm: 0 }, false), { radius: SIGHT.base, far: BEACON_RANGE })
  const full = { storm: 1, sightCap: SIGHT.storm }
  assert.deepEqual(sightNow(full, true), { radius: SIGHT.storm + LIT_PAD, far: SIGHT.storm + LIT_PAD })
  assert.deepEqual(sightNow({ storm: 1, sightCap: SIGHT.stormVillage }, true, true), { radius: SIGHT.stormVillage + LIT_PAD, far: SIGHT.stormVillage + LIT_PAD })
  const half = { storm: 0.5, sightCap: 12 }
  const s = sightNow(half, true)
  assert.equal(s.radius, litRadius({ desert: true, storm: 0.5 }))
  assert.ok(s.radius >= 12 && s.radius <= 12 + LIT_PAD)
  assert.ok(s.far > s.radius && s.far < BEACON_RANGE)
})

test('in a storm the cells lit for the hero reach a tile past the storm sight; nothing else does', () => {
  const sd = stormyDay()
  assert.equal(LIT_PAD, 1)
  // at full strength: the storm sight (the haze's patch, the monsters' cap) is 4, 8 in a village; the lit cells reach a tile further
  for (const [village, sight] of [[false, SIGHT.storm], [true, SIGHT.stormVillage]]) {
    const world = plainWorld(sd.day), state = freshState()
    frames(state, world, STORM.ramp + 1, { clock: sd.peak, village })
    assert.equal(state.storm, 1)
    assert.equal(state.sightCap, sight)
    assert.equal(sightNow(state, true, village).radius, sight + LIT_PAD)
  }
  // no storm, no pad
  const calm = freshState(), calmWorld = plainWorld(sd.day)
  tickStorm(calm, calmWorld, { clock: sd.start - 1, delta: 0.1, ...DESERT })
  assert.equal(calm.storm, 0)
  assert.equal(calm.sightCap, null)
  assert.equal(sightNow(calm, true).radius, SIGHT.desert)
  assert.equal(sightNow(calm, false).radius, SIGHT.base)
  // the pad eases in and out with the storm: through the whole storm the lit
  // radius moves a tile at a time, closing as the storm builds and opening as
  // it dies, never below the storm sight nor more than the pad past it
  const state = freshState(), world = plainWorld(sd.day)
  let last = sightNow(state, true).radius, was = 0
  for (let clock = sd.start - 1; clock < sd.end + 1; clock += 0.05) {
    world.playtime += 0.05
    tickStorm(state, world, { clock, delta: 0.05, ...DESERT })
    const r = sightNow(state, true).radius, cap = state.sightCap ?? SIGHT.desert, now = state.storm
    assert.ok(now > was ? r <= last : now < was ? r >= last : r === last, `the lit radius went ${last} -> ${r} as the storm went ${was.toFixed(3)} -> ${now.toFixed(3)}`)
    assert.ok(Math.abs(r - last) <= 1, `the lit radius jumped ${last} -> ${r}`)
    assert.ok(r >= cap && r <= cap + LIT_PAD, `lit radius ${r} against the storm sight ${cap}`)
    last = r; was = now
  }
  assert.equal(state.storm, 0)
  assert.equal(last, SIGHT.desert)
})

test('the monsters\' cap stays the storm sight plus one, not the lit radius', () => {
  const sd = stormyDay()
  const world = plainWorld(sd.day), state = freshState()
  frames(state, world, STORM.ramp + 1, { clock: sd.peak })
  assert.equal(state.storm, 1)
  const map = createMap(30, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 29; x++) map[y][x].tile = TILE.FLOOR
  const S = 32
  // a wizard sees 300 px: in the storm, the hero LIT_PAD + 1.5 tiles past the storm sight is not seen, though inside his own lit cells' reach + 1
  const foe = () => ({ type: 'wizard', maxHp: 4, hp: 4, x: 4, y: 4, px: 4 * S + S / 2, py: 4 * S + S / 2 })
  const at = d => ({ type: 'player', x: 4 + d, y: 4, px: (4 + d) * S + S / 2, py: 4 * S + S / 2, hp: 10, maxHp: 10 })
  const far = foe()
  updateBrain(far, { map, player: at(state.sightCap + LIT_PAD + 1), entities: [far], sightCap: state.sightCap }, 1 / 60)
  assert.notEqual(far.ai.mode, 'chase')
  const close = foe()
  updateBrain(close, { map, player: at(state.sightCap + 1), entities: [close], sightCap: state.sightCap }, 1 / 60)
  assert.equal(close.ai.mode, 'chase')
})

test('a storm has one wind, the same wherever the hero stands, another on another day', () => {
  const sd = stormyDay(), other = stormyDay(SEED, sd.day + 1)
  const world = makeWorld(null, { seed: SEED })
  world.day = sd.day
  world.playtime = 10_000
  // two desert tiles far apart, where the dunes' own winds differ
  const A = { X: 700, Y: -78 }, B = { X: 900, Y: -78 }
  assert.ok(isDesert(SEED, A.X, A.Y) && isDesert(SEED, B.X, B.Y))
  assert.ok(Math.abs(windAt(SEED, A.X, A.Y) - windAt(SEED, B.X, B.Y)) > 5 * Math.PI / 180, 'the walk does not cross the dunes\' turning winds')
  const winds = [A, B].map(at => {
    const state = freshState()
    tickStorm(state, world, { clock: sd.peak, delta: 0.1, ...landOf(world, at.X, at.Y) })
    return state.stormWind
  })
  assert.equal(winds[0], winds[1])
  assert.equal(winds[0], stormWind(SEED, sd.day))
  assert.notEqual(stormWind(SEED, other.day), stormWind(SEED, sd.day))
  // near the world's own prevailing wind, and pure
  for (let d = 0; d < 50; d++) assert.ok(Math.abs(stormWind(SEED, d) - prevailingWind(SEED)) <= WIND.spread + 1e-12)
  assert.equal(stormWind(SEED, 3), stormWind(SEED, 3))
})

test('no storm on Kalevanlinna\'s ground, though desert lies inside its walls; it fades out at the edge', () => {
  const seed = 6
  // desert country inside the walls (on seed 6, about 45 % of them)
  let inside = null
  for (let cy = 0; cy < 160 && !inside; cy += 2) for (let cx = 0; cx < 160; cx += 2) {
    if (!insideWalls(cx, cy)) continue
    const at = fromCity(cx, cy)
    if (isDesert(seed, at.X, at.Y)) { inside = at; break }
  }
  assert.ok(inside, 'no desert inside the walls on seed 6')
  // a desert tile well outside the city's ground, out of the gentle ring
  let outside = null
  for (let X = 400; X < 2000 && !outside; X += 7) {
    const at = { X, Y: 220 }
    const land = landOf(makeWorld(null, { seed }), at.X, at.Y)
    if (land.desert && !land.ring && !land.city) outside = at
  }
  assert.ok(outside, 'no desert outside the city')
  let sd = null
  for (let d = 0; !sd; d++) { const s = stormOfDay(seed, d); if (s) sd = { day: d, peak: s.start + STORM.ramp + s.len / 2 } }
  const world = makeWorld(null, { seed })
  world.day = sd.day
  world.playtime = 10_000
  const blow = (state, at, secs) => {
    const land = landOf(world, at.X, at.Y)
    for (let t = 0; t < secs - 1e-9; t += 0.1) { world.playtime += 0.1; tickStorm(state, world, { clock: sd.peak, delta: 0.1, ...land }) }
    return land
  }
  const inTown = freshState()
  const land = blow(inTown, inside, STORM.ramp + 1)
  assert.ok(land.desert && land.city, 'the city tile is not desert on the city\'s ground')
  assert.ok(nearCity(inside.X, inside.Y))
  assert.equal(inTown.storm, 0)
  assert.equal(inTown.sightCap, null)
  const out = freshState()
  blow(out, outside, STORM.ramp + 1)
  assert.equal(out.storm, 1)
  // walking in from the storm: it fades out over the ramp, it is not cut
  blow(out, inside, 1)
  assert.ok(out.storm > 0 && out.storm < 1, `cut at the city's edge: ${out.storm}`)
  blow(out, inside, STORM.ramp)
  assert.equal(out.storm, 0)
})
