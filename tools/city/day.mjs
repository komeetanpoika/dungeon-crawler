#!/usr/bin/env node
// A city day, headless: Kalevanlinna's runtime and its people's goals run in
// a real Wilds window round the square, the player standing by the fountain
// and a screen wide enough that the near radius covers the square (near people
// walk as npc entities with act(), the rest as far walkers).
//
//   node tools/city/day.mjs <seed> [--minutes N] [--hz H] [--from F] [--view W,H] [--at X,Y] [--trace id]
//
// --minutes  game minutes to run (6 = a whole day; default 6)
// --hz       frames a second (default 20)
// --from     fraction of the day to start at (default 0, midnight)
// --view     half the screen in tiles (default 40,24: near radius 46)
// --at       world tile X,Y the player stands on (default: by the fountain)
// --trace    a person's id: their walker every half second
//
// Prints a line per game minute: the hour, how many are near / far / indoors,
// which acts are in force on the square, and the scenes (wilds/city/scenes.js)
// that ran on or beside it in that minute (and how many of each); then how many
// different scenes each five minutes in a row had there. Exits 1 if anyone had
// no route, was stuck (on their way and no headway) for more than 10 s, or
// stood still outdoors for more than 20 s other than at a post, about a spot
// or in a scene.
import { performance } from 'node:perf_hooks'
import { arriveCity, tickCity, cityPeople } from '../../renderer/wilds/city/runtime.js'
import { squareScenesAt } from '../../renderer/wilds/city/scenes.js'
import { cityFor } from '../../renderer/wilds/city/build.js'
import { makeWorld } from '../../renderer/wilds/world.js'
import { enterWilds } from '../../renderer/wilds/session.js'
import { makeNpc, updateNpc } from '../../renderer/systems/npc.js'
import { makeFeedback } from '../../renderer/systems/feedback.js'
import { DAY_LENGTH } from '../../renderer/data/weather.js'

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const seed = Number(args.find(a => /^\d+$/.test(a)) ?? 7)
const minutes = Number(opt('minutes', 6))
const hz = Number(opt('hz', 20))
const from = Number(opt('from', 0))
const [vw, vh] = opt('view', '40,24').split(',').map(Number)
const STUCK = 10, STILL = 20
const traceId = opt('trace', null)   // print one person's walker every half second

const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
  return [{ type: s.kind, x: s.x, y: s.y, px: s.x * 32 + 16, py: s.y * 32 + 16 }]
})
let t0 = performance.now()
cityFor(seed)
const tBuild = performance.now() - t0
const world = makeWorld(null, { seed })
const state = {
  player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10 }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(), caveInstances: {},
  sfx: { cues: [], muted: false },
}
const fountain = cityFor(seed).spots.fountain
const at = opt('at', null)?.split(',').map(Number)   // world tile to stand on (default: by the fountain)
enterWilds(state, world, at ? { X: at[0], Y: at[1] } : { X: fountain.x + 1, Y: fountain.y + 160 + 2 }, { buildEntities })
const T = { clock: from * DAY_LENGTH, day: 0 }
const hooks = {
  spawn: buildEntities, clock: () => T.clock, day: () => T.day, viewHalf: () => ({ w: vw, h: vh }),
  sfx: () => {}, hurt: () => {},
}
t0 = performance.now()
arriveCity(state, world, hooks, { fresh: true })
const tArrive = performance.now() - t0
const run = state.cityRun
console.log(`Kalevanlinna, seed ${seed}: city built in ${tBuild.toFixed(0)} ms, town placed by the clock in ${tArrive.toFixed(1)} ms; ` +
  `${run.people.size} people, ${run.animals.size} animals, near radius ${run.nearR}`)

const hhmm = clock => { const m = Math.floor(((clock % DAY_LENGTH) / DAY_LENGTH) * 24 * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const square = p => Math.abs(p.X - fountain.x) <= 14 && Math.abs(p.Y - (fountain.y + 160)) <= 14
// per person: where they were at the start of their present stillness, and since when
const track = new Map()
const problems = { stuck: new Map(), still: new Map() }
const tick = { sum: 0, max: 0, n: 0 }, npc = { sum: 0, max: 0, n: 0 }
const slow = []   // ticks over 1.5 ms
// scenes on or beside the square: within SCENE_R tiles of the fountain (or
// riding the schedules through it: the shift change and the church crowd)
const SCENE_R = 20
const onSquare = sc => sc.id === 'shift' || sc.id === 'church' || sc.id === 'cart' ||
  (Math.abs(sc.at.x - fountain.x) <= SCENE_R && Math.abs(sc.at.y - (fountain.y + 160)) <= SCENE_R)
let minuteScenes = new Map()   // id -> keys seen this minute
const perMinute = []           // Set of ids per minute
const dt = 1 / hz
const steps = Math.round(minutes * 60 * hz)
let simT = 0
for (let i = 1; i <= steps; i++) {
  const before = T.clock
  T.clock = (T.clock + dt) % DAY_LENGTH
  if (T.clock < before) T.day++
  simT += dt
  let a = performance.now()
  tickCity(state, world, dt, hooks)
  let b = performance.now()
  tick.sum += b - a; tick.max = Math.max(tick.max, b - a); tick.n++
  if (b - a > 1.5) slow.push(`${hhmm(T.clock)} ${(b - a).toFixed(2)} ms (${state.cityRun.queue.length} routes queued)`)
  a = performance.now()
  for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, dt)
  b = performance.now()
  npc.sum += b - a; npc.max = Math.max(npc.max, b - a); npc.n++
  for (const sc of state.cityRun.scenes) if (!sc.done && onSquare(sc) && (sc.cast.length || sc.id === 'pigeons')) {
    if (!minuteScenes.has(sc.id)) minuteScenes.set(sc.id, new Set())
    minuteScenes.get(sc.id).add(sc.key)
  }

  if (traceId && i % Math.max(1, Math.round(hz / 2)) === 0) {
    const w = state.cityRun.people.get(traceId), e = w.entity
    console.log(`  ${hhmm(T.clock)} ${(T.clock / DAY_LENGTH).toFixed(3)} ${w.mode} ${w.phase} (${w.X.toFixed(2)},${w.Y.toFixed(2)}) ei ${w.ei} ${w.goal?.kind} ` +
      `wi ${w.wi}/${w.path?.length ?? '-'} ${w.path ? JSON.stringify(w.path[w.wi]) : ''} still ${w.still.toFixed(1)}` +
      (e ? ` | entity (${e.x},${e.y}) next ${JSON.stringify(e.city.next)} ${e.ai.current} wait ${e.ai.wait ?? 0} side ${JSON.stringify(e.ai.side)} path ${e.ai.path?.length}` : ''))
  }
  if (i % Math.max(1, Math.round(hz / 4)) === 0) {
    for (const p of cityPeople(state)) {
      const k = track.get(p.id)
      // stillness counts from where they were when they last moved, set out for somewhere else, or left a scene
      if (!k || p.mode === 'indoors' || Math.hypot(p.X - k.X, p.Y - k.Y) > 0.5 || p.entry !== k.entry || p.going !== k.going || p.there !== k.there || p.scene !== k.scene) {
        track.set(p.id, { X: p.X, Y: p.Y, since: simT, entry: p.entry, going: p.going, there: p.there, scene: p.scene })
        continue
      }
      const still = simT - k.since
      // on the way and getting nowhere (one held in a scene stands where it wants them)
      if (p.going && !p.scene && still > STUCK) problems.stuck.set(p.id, { ...p, still, at: hhmm(T.clock) })
      // standing about outdoors, other than at a post or about a spot (a patrol always walks), or in a scene
      const exempt = (p.there && (p.goal === 'spot' || p.act === 'post')) || p.scene
      if (!exempt && still > STILL) problems.still.set(p.id, { ...p, still, at: hhmm(T.clock) })
    }
  }
  if (i % Math.round(60 * hz) === 0) {
    const ps = cityPeople(state)
    const n = m => ps.filter(p => p.mode === m).length
    const acts = {}
    for (const p of ps) if (p.mode !== 'indoors' && square(p)) acts[p.act] = (acts[p.act] ?? 0) + 1
    const actStr = Object.entries(acts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-'
    console.log(`${hhmm(T.clock)}  near ${String(n('near')).padStart(3)}  far ${String(n('far')).padStart(3)}  indoors ${String(n('indoors')).padStart(3)}` +
      `  | square: ${actStr}  | tick ${(tick.sum / tick.n).toFixed(3)} ms (max ${tick.max.toFixed(2)}), npcs ${(npc.sum / npc.n).toFixed(2)} ms`)
    const ran = [...minuteScenes].map(([id, keys]) => keys.size > 1 ? `${id} x${keys.size}` : id)
    // the timetable's word for the same minute, sampled every 10 s
    const day = T.day, sched = new Set()
    for (let s = 0; s < 60; s += 10) for (const id of squareScenesAt(seed, day, ((T.clock - 60 + s + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH)) sched.add(id)
    console.log(`       scenes on the square: ${ran.join(', ') || '-'}  | timetable: ${[...sched].join(', ') || '-'}`)
    perMinute.push(new Set(minuteScenes.keys()))
    minuteScenes = new Map()
  }
}

const city = state.cityRun
if (perMinute.length >= 5) {
  const spans = []
  for (let m = 0; m + 5 <= perMinute.length; m++) spans.push(new Set(perMinute.slice(m, m + 5).flatMap(s => [...s])).size)
  console.log(`\nscenes on the square in five minutes running: ${spans.map((n, m) => `minutes ${m + 1}-${m + 5}: ${n}`).join(', ')}`)
}
console.log(`\ntickCity: ${(tick.sum / tick.n).toFixed(3)} ms a tick on average, ${tick.max.toFixed(2)} ms at most, ` +
  `with ${city.people.size} people and ${city.animals.size} animals (near people's goals: ${(npc.sum / npc.n).toFixed(2)} ms a frame)`)
console.log(`re-routed ${city.stats.rerouted} times`)
if (slow.length) console.log(`${slow.length} ticks over 1.5 ms: ${slow.slice(0, 12).join('; ')}`)
const fail = []
if (city.stats.noRoute.length) fail.push(`no route: ${city.stats.noRoute.map(r => `${r.id} (${r.from.x},${r.from.y})->(${r.to.x},${r.to.y})`).join('; ')}`)
const list = m => [...m.values()].map(p => `${p.id} ${p.mode} ${p.act}/${p.goal} at (${p.X.toFixed(1)},${p.Y.toFixed(1)}) ${p.still.toFixed(0)} s by ${p.at}`).join('\n  ')
if (problems.stuck.size) fail.push(`stuck more than ${STUCK} s:\n  ${list(problems.stuck)}`)
if (problems.still.size) fail.push(`standing still outdoors more than ${STILL} s:\n  ${list(problems.still)}`)
if (fail.length) { console.log(`\nFAIL\n${fail.join('\n')}`); process.exit(1) }
console.log('\nOK: everyone had somewhere to be and got there.')
