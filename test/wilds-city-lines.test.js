// What Kalevanlinna says: every townsperson's lines by job and temperament
// (wilds/city/lines.js), the named characters' own, the wary lines a warned or
// wanted player hears, the crier's news (wilds/city/crier.js) called in his
// scene, and the city people's own speech bubbles (systems/feedback.js
// ambientSpeakers). The window is built by session.js as in the game;
// buildEntities and the hooks stand in for game.js's.
//
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b): a failing strict equal makes Node diff both sides, and a
// city npc's ai.goals reaches the whole city. deepEqual is for lists of strings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linesFor, talkFor, TALKS, NIGHT_TALKS } from '../renderer/wilds/city/lines.js'
import { crierNews, datedNews, STOCKS_NEWS } from '../renderer/wilds/city/crier.js'
import { NAMED, JOBS } from '../renderer/wilds/city/folk.js'
import * as runtime from '../renderer/wilds/city/runtime.js'
import { arriveCity, tickCity } from '../renderer/wilds/city/runtime.js'
import { cityViolence, arrest, seat, clearCrime } from '../renderer/wilds/city/law.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { cityCtx } from '../renderer/wilds/city/walkers.js'
import { sceneWindows } from '../renderer/wilds/city/scenes.js'
import { makeWorld, exportWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { makeNpc, updateNpc, sceneSay, interactNpc, TALK_BEAT } from '../renderer/systems/npc.js'
import { stepEnemyAttack } from '../renderer/systems/enemy-attack.js'
import { makeFeedback, think, ambientSpeakers, AMBIENT_MAX, BUBBLE_DUR, SAY_MAX, sayDuration } from '../renderer/systems/feedback.js'
import { TALES } from '../renderer/data/tales.js'
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
// The town as it speaks of itself: a world without the Sampo's record tells
// none of its story (city/sampo.js; test/wilds-city-sampo.test.js has the story).
const plainWorld = () => { const w = makeWorld(null, { seed: SEED }); delete w.sampo; return w }
const FOUNTAIN = { X: 79, Y: 236 }   // a step south of the fountain, the crier's box in sight

// `world`: a world from before (a town freshly in the window of it)
function setup({ at = FOUNTAIN, frac = 0.5, day = 0, view = { w: 20, h: 12 }, world = plainWorld() } = {}) {
  world.day = day
  const state = freshState()
  enterWilds(state, world, at, { buildEntities })
  const T = { clock: frac * DAY_LENGTH, day, view }
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: () => {}, hurt: () => {},
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T }
}
// `frozen`: the clock stands still (everyone's day with it), the town runs on
function run(ctx, seconds, { each = null, frozen = false } = {}) {
  const { state, world, hooks, T } = ctx
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    if (!frozen) T.clock = (T.clock + DT) % DAY_LENGTH
    tickCity(state, world, DT, hooks)
    for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, DT)
    for (const e of state.entities) stepEnemyAttack(e, state, DT)
    state.sfx.cues = []
    if (each && each(t) === false) return true
  }
  return false
}
const nearWalkers = state => [...state.cityRun.people.values()].filter(w => w.mode === 'near' && w.entity)

const TEMPERS = ['cheerful', 'gruff', 'shy', 'chatty']
const MOODS = [false, true].flatMap(night => ['calm', 'warned', 'wanted', 'stocks'].map(crime => ({ night, crime })))
const isLine = l => typeof l === 'string' && l.length > 0 && /[.!?]$/.test(l) && !/[{}]/.test(l)
const AGE = { child: 'child', elder: 'elder' }

test('every job has lines', () => {
  // the stand-ins are gone
  assert.equal(runtime.jobLines, undefined, 'runtime.js no longer keeps the stand-in table')
  for (const job of [...JOBS, 'watch']) {
    const tempers = job === 'watch' ? ['chatty', 'gruff'] : TEMPERS
    for (const temperament of tempers) for (const mood of MOODS) {
      const p = { id: 'tf:0', name: 'Aino', age: AGE[job] ?? 'adult', job, temperament }
      const lines = linesFor(p, mood)
      assert.ok(Array.isArray(lines) && lines.length >= 1, `${job} ${temperament} ${JSON.stringify(mood)} says something`)
      for (const l of lines) assert.ok(isLine(l), `${job}: a plain line (${JSON.stringify(l)})`)
    }
  }
  // by job: two trades of one temper say different things by day; by temperament: one trade, two tempers
  const day = { night: false, crime: 'calm' }
  const tf = (job, temperament) => ({ id: 'tf:1', age: 'adult', job, temperament })
  assert.notDeepEqual(linesFor(tf('baker', 'gruff'), day), linesFor(tf('fisher', 'gruff'), day))
  assert.notDeepEqual(linesFor(tf('baker', 'gruff'), day), linesFor(tf('baker', 'cheerful'), day))
  assert.ok(linesFor(tf('baker', 'gruff'), day).some(l => !linesFor(tf('baker', 'cheerful'), day).includes(l)), 'the temperament colours them')
  // the night is not the day
  assert.notDeepEqual(linesFor(tf('baker', 'shy'), { night: true, crime: 'calm' }), linesFor(tf('baker', 'shy'), day))
  // the same person asked again says the same
  assert.deepEqual(linesFor(tf('weaver', 'chatty'), day), linesFor(tf('weaver', 'chatty'), day))
  // everyone the town rolls, in every mood (but the Count, who is not spoken to)
  const folk = cityCtx(cityFor(SEED), SEED).folk
  for (const p of folk) for (const mood of MOODS) {
    const lines = linesFor(p, mood)
    if (p.job === 'count') { assert.equal(lines.length, 0); continue }
    assert.ok(lines.length >= 1 && lines.every(isLine), `${p.id} (${p.job}) in ${JSON.stringify(mood)}`)
  }
  // street talk is plain too, and by job or temperament
  for (const ex of [...TALKS, ...NIGHT_TALKS]) {
    assert.ok(ex.length >= 2 && ex.every(isLine), JSON.stringify(ex))
  }
  const a = { id: 'tf:2', age: 'adult', job: 'baker', temperament: 'chatty' }, b = { id: 'tf:3', age: 'adult', job: 'fisher', temperament: 'gruff' }
  const heard = new Set()
  for (let k = 0; k < 60; k++) {
    const ex = talkFor(a, b, { night: false, k })
    assert.ok(TALKS.includes(ex), 'a day exchange')
    heard.add(ex)
    assert.ok(NIGHT_TALKS.includes(talkFor(a, b, { night: true, k })), 'at the inn door of an evening')
  }
  assert.ok(heard.size >= 4, `more than one thing to talk about (${heard.size})`)
  const fisherTalk = new Set(Array.from({ length: 60 }, (_, k) => talkFor(b, a, { night: false, k })))
  assert.ok([...heard].some(ex => !fisherTalk.has(ex)), 'who talks to whom changes what they say')
})

test('named characters say their own', () => {
  const OWN = {
    seppo: ['Mind the sparks. And no, I don\'t make jewellery.', 'Hammer, iron, fire. Nothing else is worth the bother.'],
    vaino: ['The organ is fine. It is the singing I worry about.'],
    pohjanen: ['Herring, dear? Salted this morning. Well. This week.', 'You have a kind face. Kind faces get the good herring.'],
    vicar: ['The bell rings at the same hour every day. People still come late.'],
    innkeeper: ['Beds upstairs, beer down here. Trouble outside.'],
    captain: ['Keep the peace and the peace keeps you.'],
  }
  const folk = cityCtx(cityFor(SEED), SEED).folk
  for (const n of NAMED) {
    const p = folk.find(q => q.id === `named:${n.id}`)
    assert.ok(p, n.id)
    for (const night of [false, true]) {
      const lines = linesFor(p, { night, crime: 'calm' })
      if (OWN[n.id]) assert.deepEqual(lines, OWN[n.id], `${n.name} says their own`)
      else if (n.id === 'count') assert.deepEqual(lines, [], 'the Count is not spoken to')
      else {
        // the crier has his own, not a trade's
        assert.ok(lines.length >= 1 && lines.every(isLine))
        assert.notDeepEqual(lines, linesFor({ ...p, id: 'tf:0' }, { night, crime: 'calm' }))
      }
    }
  }
  // in the town: whoever is near says it
  const ctx = setup({ frac: 0.5 })
  for (const w of ctx.state.cityRun.people.values()) {
    const id = w.person.id.slice(6)
    if (!OWN[id]) continue
    assert.deepEqual(w.lines, OWN[id], `${id} in the town`)
    if (w.entity) assert.deepEqual(w.entity.lines, OWN[id])
  }
  // the Count, met in the street, answers nothing
  const state = freshState()
  const count = makeNpc({ species: 'townsfolk', id: 'named:count', x: 0, y: 0 })
  count.px = 16; count.py = 16
  count.lines = linesFor(folk.find(q => q.id === 'named:count'), { night: false, crime: 'calm' })
  assert.equal(interactNpc(state, count, () => 0), null)
  assert.equal(state.feedback.bubble, null)
})

test('the crier reports a finished tale', () => {
  const world = plainWorld()
  const base = crierNews(world, SEED, 2)
  assert.equal(base.length, 3, 'the market, the weather and a townsperson')
  assert.ok(base.every(isLine) && base.every(l => l.startsWith('Hear ye! ')), JSON.stringify(base))
  assert.ok(/market/i.test(base[0]), `the market first (${base[0]})`)
  const folk = cityCtx(cityFor(SEED), SEED).folk.filter(p => p.id.startsWith('tf:'))
  assert.ok(folk.some(p => base[2].includes(p.name)), `someone of the town (${base[2]})`)
  // pure in the world, the seed and the day; the next day has other news
  assert.deepEqual(crierNews(world, SEED, 2), base)
  assert.ok([1, 3, 4].some(d => crierNews(world, SEED, d).join() !== base.join()))

  // a tale half done is no news; a finished one is
  world.tales.set('3,-2', { id: 'elk', flags: {}, place: '4,-2', n: 1, nSide: 0, done: false })
  assert.deepEqual(crierNews(world, SEED, 2), base)
  world.tales.get('3,-2').done = true
  const elk = 'Hear ye! The deep wood is safe again, they say, thanks to a stranger.'
  assert.equal(TALES.elk.landWord, 'the deep wood')
  assert.deepEqual(crierNews(world, SEED, 2), [...base, elk])
  // two villages' tales of one kind make one item; each kind its own words
  world.tales.set('-5,4', { id: 'elk', flags: {}, place: null, n: 0, nSide: 0, done: true })
  world.tales.set('6,6', { id: 'tar', flags: {}, place: null, n: 0, nSide: 0, done: true })
  const news = crierNews(world, SEED, 2)
  assert.deepEqual(news.slice(0, 3), base, 'the rotation: market, weather, townsperson, then what the player did')
  assert.deepEqual(news.slice(3), [elk, 'Hear ye! The deck to the fish racks is safe again, they say, thanks to a stranger.'], 'the tar pit\'s own word for the news')
  // a tale with no word for its place makes no item (and breaks nothing)
  const lw = TALES.lalli.landWord
  world.tales.set('9,9', { id: 'lalli', flags: {}, place: null, n: 0, nSide: 0, done: true })
  try {
    delete TALES.lalli.landWord
    assert.equal(crierNews(world, SEED, 2).length, 5)
  } finally { TALES.lalli.landWord = lw }
  assert.equal(crierNews(world, SEED, 2)[5], 'Hear ye! The wood is safe again, they say, thanks to a stranger.')
  world.tales.delete('9,9')
  // Päivölä solved
  world.solved.add('7,2:door3')
  const sun = crierNews(world, SEED, 2)
  assert.equal(sun.length, 6)
  assert.ok(/Päivölä/.test(sun[5]) && isLine(sun[5]), sun[5])
  // each call stays up long enough to read at an easy pace (2 s and a second a 15 letters), well inside his 20 s
  assert.ok(SAY_MAX <= 10)
  for (let d = 0; d < 12; d++) for (const l of crierNews(world, SEED, d)) {
    const dur = sayDuration(l)
    assert.ok(dur >= Math.min(SAY_MAX, 2 + l.length / 15) && dur > BUBBLE_DUR && dur <= SAY_MAX, `${dur.toFixed(1)} s for ${l.length} letters`)
  }
})

test('the crier remembers the stocks the next day', () => {
  const RUFFIAN = 'A ruffian sat in the stocks yesterday! Mind your manners in Kalevanlinna.'
  const ctx = setup({ day: 3 })
  const { state, world } = ctx
  assert.equal(world.stocksDay ?? null, null, 'nobody in the stocks yet')
  assert.ok(!crierNews(world, SEED, 4).includes(RUFFIAN))
  assert.equal(arrest(state), true)
  assert.equal(seat(state, world), true)
  assert.equal(world.stocksDay, 3, 'the world remembers the day')
  assert.ok(!crierNews(world, SEED, 3).includes(RUFFIAN), 'not news the same day')
  assert.ok(crierNews(world, SEED, 4).includes(RUFFIAN), 'news the next')
  assert.ok(!crierNews(world, SEED, 5).includes(RUFFIAN), 'and old news after that')
  assert.equal(RUFFIAN, STOCKS_NEWS)
  assert.deepEqual(datedNews(world, 4), [RUFFIAN], 'good for that day only')
  assert.deepEqual(datedNews(world, 3), []); assert.deepEqual(datedNews(world, 5), [])
  // the memory is saved with the Wilds; a save from before has none
  const saved = exportWorld(world)
  assert.equal(saved.stocksDay, 3)
  const back = makeWorld(JSON.parse(JSON.stringify(saved)))
  assert.equal(back.stocksDay, 3)
  assert.ok(crierNews(back, SEED, 4).includes(RUFFIAN))
  const old = { ...saved }; delete old.stocksDay
  assert.equal(makeWorld(old).stocksDay, null)
  assert.equal(makeWorld({ ...saved, stocksDay: 'yes' }).stocksDay, null)
  assert.equal(makeWorld({ ...saved, stocksDay: -1 }).stocksDay, null)
})

// The stocks are news for one day only, and the crier calls a few times a day
// only while the player is near: the ruffian takes his first call of that day,
// in a town freshly in the window, whatever else there is to tell.
test('the day after the stocks, the crier\'s first call is the ruffian', () => {
  const ctx3 = setup({ day: 3 })
  assert.equal(arrest(ctx3.state), true)
  assert.equal(seat(ctx3.state, ctx3.world), true)
  clearCrime(ctx3.state)
  const world = ctx3.world
  world.tales.set('3,-2', { id: 'elk', flags: {}, place: null, n: 0, nSide: 0, done: true })
  world.solved.add('7,2:door3')
  const day = 4
  const slots = sceneWindows(SEED, day).filter(s => s.id === 'crier')
  const ctx = setup({ world, day, frac: slots[0].a })
  const { state } = ctx
  const news = crierNews(world, SEED, day)
  assert.equal(news.indexOf(STOCKS_NEWS), news.length - 1, 'last in the round')
  const calls = []
  let last = null
  run(ctx, (slots[2].b - slots[0].a) * DAY_LENGTH, { each: () => {
    const say = state.cityRun.people.get('named:crier').entity?.city?.say
    if (say && say !== last) { last = say; calls.push(say.text) }
  } })
  assert.ok(calls.length >= 1, 'he called')
  assert.equal(calls[0], STOCKS_NEWS, 'the ruffian first')
  // then the round, from the market
  calls.slice(1).forEach((t, i) => assert.equal(t, news[i % news.length], `call ${i + 1}`))
  assert.equal(state.cityRun.cryN, calls.length - 1)
})

test('a warned or wanted player hears wary lines, and the town forgets after', () => {
  const ctx = setup({ frac: 0.5 })
  const { state, world } = ctx
  const mood = (crime, night = false) => ({ night, crime })
  const check = (m, msg) => {
    let n = 0
    for (const w of state.cityRun.people.values()) {
      assert.deepEqual(w.lines, linesFor(w.person, m), `${msg}: ${w.id}`)
      if (w.mode === 'near' && w.entity) { assert.ok(w.entity.lines === w.lines, `${msg}: ${w.id}'s entity`); n++ }
    }
    assert.ok(n >= 10, `${msg}: people near (${n})`)
  }
  check(mood('calm'), 'calm')
  const tf = nearWalkers(state).find(w => w.species === 'townsfolk' && w.person.id.startsWith('tf:') && state.map[w.entity.y]?.[w.entity.x]?.ward)
  assert.ok(tf, 'a townsperson inside the walls')
  const calm = tf.entity.lines
  assert.equal(cityViolence(state, world, tf.entity), 'warn')
  run(ctx, DT)
  check(mood('warned'), 'warned')
  assert.notDeepEqual(tf.lines, calm, 'wary of a warned player')
  const warned = tf.lines
  run(ctx, 2)
  assert.equal(cityViolence(state, world, tf.entity ?? nearWalkers(state).find(w => w.species === 'townsfolk').entity), 'wanted')
  run(ctx, DT)
  check(mood('wanted'), 'wanted')
  assert.notDeepEqual(tf.lines, calm)
  assert.ok(tf.lines.length > warned.length || tf.lines.join() !== warned.join(), 'the wanted hear of it')
  // a load or a wake: calm again, and the town says so
  clearCrime(state)
  run(ctx, DT)
  check(mood('calm'), 'calm again')
  // the night has its own
  ctx.T.clock = 0.9 * DAY_LENGTH
  run(ctx, DT)
  for (const w of state.cityRun.people.values()) assert.deepEqual(w.lines, linesFor(w.person, mood('calm', true)), `night: ${w.id}`)
})

// How many times he gets to call depends on how soon he reaches his box, and
// the runtime routes on a time budget (a busy machine routes a little later),
// so the round is taken from its third item: the deed comes up at the second.
test('the crier\'s call in his scene carries the news, in rotation, every 20 s', () => {
  const day = 1
  const slots = sceneWindows(SEED, day).filter(s => s.id === 'crier')
  assert.ok(slots.length >= 3)
  const ctx = setup({ frac: slots[0].a, day })
  const { state, world } = ctx
  // a tale finished: the fourth item
  world.tales.set('3,-2', { id: 'elk', flags: {}, place: null, n: 0, nSide: 0, done: true })
  const news = crierNews(world, SEED, day)
  assert.equal(news.length, 4)
  assert.equal(state.cityRun.cryN, 0, 'a town come into the window starts the round at the market')
  state.cityRun.cryN = 2
  const view = () => ({ x0: state.player.px - 20 * S, y0: state.player.py - 12 * S, x1: state.player.px + 20 * S, y1: state.player.py + 12 * S })
  const listen = (calls, flags) => () => {
    const w = state.cityRun.people.get('named:crier')
    const e = w?.mode === 'near' ? w.entity : null
    const say = e?.city?.say
    if (say && say !== flags.last) {
      flags.last = say
      calls.push({ text: say.text, at: flags.t, slot: slots.findIndex(s => s.a <= ctx.T.clock / DAY_LENGTH && ctx.T.clock / DAY_LENGTH < s.b) })
      assert.equal(w.scene?.id, 'crier', 'he speaks at his box only (no street talk keeps him from it)')
      assert.equal(say.t, 0, 'a fresh line')
      assert.equal(say.dur, sayDuration(say.text), 'up long enough to read')
      assert.ok(say.dur > BUBBLE_DUR && say.dur < 20 - 3, `inside his quiet (${say.dur.toFixed(1)} s)`)
      const v = view()
      if (ambientSpeakers(state.entities, v, state.player).includes(e)) flags.drawn = true
      else assert.ok(e.px < v.x0 || e.px > v.x1 || e.py < v.y0 || e.py > v.y1, 'on screen, the crier draws his bubble')
    }
    if (say && say === flags.last && say.t > BUBBLE_DUR + 0.5 && say.t < say.dur - 0.1) {
      const v = view()
      if (ambientSpeakers(state.entities, v, state.player).includes(e)) flags.long = true
      else assert.ok(e.px < v.x0 || e.px > v.x1 || e.py < v.y0 || e.py > v.y1, 'a long call is still up after the usual bubble time')
    }
    if (say && say === flags.last && say.t >= say.dur) {
      flags.aged = true
      assert.ok(!ambientSpeakers(state.entities, view(), state.player).includes(e), 'an old line no longer draws')
    }
    flags.t += DT
  }
  // his turns at the box through the morning and after lunch
  const calls = [], flags = { last: null, t: 0, drawn: false, aged: false, long: false }
  run(ctx, (slots[2].b - slots[0].a) * DAY_LENGTH, { each: listen(calls, flags) })
  assert.ok(calls.length >= 2, `called at least twice (${calls.length}: ${calls.map(c => c.text).join(' | ')})`)
  calls.forEach((c, i) => assert.equal(c.text, news[(2 + i) % news.length], `call ${i}`))
  assert.equal(calls[1].text, 'Hear ye! The deep wood is safe again, they say, thanks to a stranger.', 'the stranger\'s deed is called')
  assert.ok(new Set(calls.map(c => c.slot)).size >= 2, 'the round goes on from one turn at the box to the next')
  assert.equal(state.cityRun.cryN, 2 + calls.length)
  assert.ok(flags.aged, 'the runtime ages a line said')
  assert.ok(flags.long, 'a long call stays up past the usual bubble time')
  assert.ok(flags.drawn, 'the call draws over the crier')

  // at his box with the day held still: a call every 20 s
  const ctx2 = setup({ frac: slots[1].a, day })
  const at = () => ctx2.state.cityRun.people.get('named:crier')?.scene
  assert.ok(run(ctx2, (slots[1].b - slots[1].a) * DAY_LENGTH - 1, { each: () => !at()?.there }), 'he got to his box')
  const held = [], hf = { last: null, t: 0 }
  run(ctx2, 45, { frozen: true, each: () => {
    const w = ctx2.state.cityRun.people.get('named:crier'), say = w.entity?.city?.say
    if (say && say !== hf.last) { hf.last = say; held.push(hf.t) }
    hf.t += DT
  } })
  assert.equal(held.length, 3, `three calls in 45 s (${held.map(t => t.toFixed(2))})`)
  for (let i = 1; i < held.length; i++) assert.ok(Math.abs(held[i] - held[i - 1] - 20) < 0.11, `20 s between calls (${(held[i] - held[i - 1]).toFixed(2)})`)
})

test('a scene line stays on its speaker, never in the player\'s bubble', () => {
  const state = freshState()
  state.player.px = 16; state.player.py = 16
  const e = { id: 'tf:1', px: 48, py: 16, city: {} }
  think(state, 'Hm.')
  sceneSay(state, e, 'Morning.')
  assert.equal(state.feedback.bubble.text, 'Hm.', 'the player\'s own thought stays')
  assert.deepEqual(e.city.say, { text: 'Morning.', n: 1, t: 0, dur: sayDuration('Morning.') })
  state.feedback.bubble = null
  sceneSay(state, e, 'Cold one.')
  assert.equal(state.feedback.bubble, null, 'the single bubble is the player\'s and the tales\'')
  assert.deepEqual(e.city.say, { text: 'Cold one.', n: 2, t: 0, dur: sayDuration('Cold one.') })
  sceneSay(state, e, 'True enough.', 1.5)
  assert.equal(e.city.say.dur, 1.5, 'or as long as the scene says')
  assert.ok(sayDuration('') >= BUBBLE_DUR && Math.abs(sayDuration('Hm.') - 2.2) < 1e-9, 'never shorter than a bubble')
  assert.equal(sayDuration('x'.repeat(300)), SAY_MAX, 'nor longer than SAY_MAX')
  assert.ok(Math.abs(sayDuration('x'.repeat(60)) - 6) < 1e-9, '2 s and a second for every 15 letters')
})

test('which city people draw their own bubble: fresh, on screen, the nearest few', () => {
  const focus = { px: 1000, py: 1000 }
  const view = { x0: 400, y0: 600, x1: 1600, y1: 1400 }
  const at = (id, px, py, t = 0.5, extra = {}) => ({ id, px, py, hp: 3, city: { say: { text: id + '.', n: 1, t } }, ...extra })
  const near1 = at('a', 1010, 1000), near2 = at('b', 1100, 1000), near3 = at('c', 900, 1150), near4 = at('d', 1200, 900)
  const far5 = at('e', 1500, 1300)
  const stale = at('f', 1001, 1000, BUBBLE_DUR), noT = { id: 'g', px: 1000, py: 1001, city: { say: { text: 'x.', n: 1 } } }
  const off = at('h', 300, 1000), quiet = { id: 'i', px: 1000, py: 1000, city: {} }, plain = { id: 'j', px: 1000, py: 1000 }
  const dead = at('k', 1002, 1000, 0.1, { hp: 0 })
  const all = [far5, stale, near3, off, near1, quiet, noT, near4, plain, dead, near2]
  const got = ambientSpeakers(all, view, focus)
  assert.equal(AMBIENT_MAX, 4)
  assert.equal(got.length, 4)
  const want = [near1, near2, near3, near4]
  want.forEach((e, i) => assert.ok(got[i] === e, `nearest first: ${i} is ${e.id} (got ${got[i]?.id})`))
  // fewer than the cap: all of them; a smaller cap; the one the player's bubble is over is skipped
  const two = ambientSpeakers([far5, near2], view, focus)
  assert.ok(two.length === 2 && two[0] === near2 && two[1] === far5)
  const one = ambientSpeakers(all, view, focus, { max: 1 })
  assert.ok(one.length === 1 && one[0] === near1)
  const skip = ambientSpeakers(all, view, focus, { skip: 'a' })
  assert.ok(skip.length === 4 && !skip.includes(near1) && skip[3] === far5)
  assert.equal(ambientSpeakers([], view, focus).length, 0)
  // a line's own time: up while t < dur, BUBBLE_DUR when it has none
  const longLine = at('l', 1000, 1000, 3), longDur = at('m', 1000, 1000, 3)
  longDur.city.say.dur = 6
  const late = ambientSpeakers([longLine, longDur], view, focus)
  assert.ok(late.length === 1 && late[0] === longDur)
  longDur.city.say.t = 6
  assert.equal(ambientSpeakers([longDur], view, focus).length, 0)
})
