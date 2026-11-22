// Kalevanlinna's scenes: the small set pieces that make standing on the square
// worth five minutes (spec "Townsfolk: scenes"). Two halves:
//
// The timetable, pure in (seed, day, frac):
//   SCENES                          every scene id
//   scenesForDay(seed, day)         the day's scenes: ALWAYS, and at least three
//                                   rolled from the rest (never the same set two
//                                   days running); `gawk` is never rolled, it runs
//                                   whenever someone sits in the stocks
//   sceneWindows(seed, day)         when each of the day's scenes is on: slots
//                                   { id, k, a, b, place, phase }, a <= frac < b
//   scheduleAt(seed, day, frac)     the slots on at that moment
//   squareScenesAt(seed, day, frac) the ids of those seen on or beside the square
//
// The stage (runtime.js calls tickScenes once a frame after the law, and
// sceneStep from near()): a slot on whose place is within the near radius is
// cast from the people near it, run, and its cast let go when it is over
// (backToDay). Scenes run only round the player; far walkers keep walking.
// A few are someone's own (Seppo at his anvil, the day's busker, the beggar,
// the lamplighter, the carter): called from indoors or further off, they walk
// there by their route like any far walker and play their part once near.
//
//   state.cityRun.scenes: { id, key, slot, at: {x, y} (world tiles), cast: id[], t, ... }[]
//   w.scene        a walker taken out of their day by a scene: { id, key, how,
//                  spot {X, Y} world tile, there, facing, day, ... }; the npc
//                  entity sees the same object as e.city.scene, so it holds
//                  only window tiles as {x, y} (shiftState moves them) and
//                  world tiles as {X, Y}
//     how 'step'   walk straight to `spot` (npc.js follow_city), then stand
//         'route'  a street route to `spot` (the walker's goal, like any other)
//         'ride'   the schedule's own place (the walker is there for its `act`)
//         'free'   the scene's goal moves them (tag)
//         'away'   out of the street altogether (the carter on his cart:
//                  indoors, behind no door)
//     day          true: their own day goes on meanwhile (the crier, whose
//                  scene ends when his day moves him on); else the schedule waits
//   e.city.talk    { lines, me, conv } read by npc.js talk
//   e.city.say     { text, n, t }: the last line they said in a scene, t seconds
//                  ago (the runtime ages it; the renderer draws it over them
//                  while it is fresh, feedback.js ambientSpeakers). What they
//                  say is lines.js's (talk, beggar, drunk) and crier.js's
//   e.city.carry   true while carrying a crate (unload; w.scene.loaded is the truth)
//   run.cryN       the crier's calls so far: his place in the news (nextNews);
//   run.cryDay, run.cryDated   the day, and how many of its dated items he has called
//
// What later tasks draw and sound (Task 17, 18) is kept as plain data on the
// run, in world tiles (scene-things.js moves the things):
//   run.fx.flocks   [{ X, Y, state: 'settled'|'lifting'|'circling', t, from, target, birds, lifts }]
//                   a dog, a child at play or the player within LIFT_R lifts it;
//                   circling flies from `from` to `target` over CIRCLE_TIME
//   run.fx.carts    [{ X, Y, dir: 'north'|'south'|'east'|'west', state: 'rolling'|'stopped'|'unloading', look, by }]
//                   a horse and cart with its carter (`by`, whose look it is) on the box
//   run.fx.smithy   { X, Y (anvil), forge: {X, Y}, state: 'idle'|'hammering'|'quenching', blows, by } | null
//   run.fx.crier    { X, Y, rings, ringing, by } | null (each ring counts up `rings`)
//   run.fx.busker   { X, Y, playing, by } | null
//   run.fx.bell     true while the church bell rings
//   run.fx.washing  [{ X, Y (the line's west post), state: 'in'|'out', by }] (by: who saw to it last, null the clock)
//   run.fx.turnips  [{ fromX, fromY, toX, toY, t }] (t seconds in the air, TURNIP_FLIGHT long)
//   run.lights      { lit: Uint8Array } over city.lamps: 1 = lit
import { hash, hashInt } from '../rand.js'
import { DAY, entryAt } from './schedule.js'
import { PLAN } from './plan.js'
import { route } from './streets.js'
import { setEntry, reachable, CITY_OX as OX, CITY_OY as OY } from './walkers.js'
import { sceneSay, TALK_BEAT } from '../../systems/npc.js'
import { talkFor, BEGGAR_LINES, DRUNK_LINES } from './lines.js'
import { crierNews, datedNews } from './crier.js'
import {
  cheb, toWorld, walkableAt, thingsOf, lampDue, washDue, makeFlock, stepFlocks, moveCart, stepTurnips, ringRound, fleeTile,
} from './scene-things.js'

export { LIFT_R, CIRCLE_TIME, TURNIP_FLIGHT } from './scene-things.js'

const S = 32

// ---- the timetable ----------------------------------------------------------------

export const SCENES = ['talk', 'tag', 'pigeons', 'cart', 'unload', 'smith', 'washing', 'busker', 'beggar', 'crier', 'lamps', 'shift', 'drunk', 'church', 'gawk']
export const ALWAYS = ['talk', 'smith', 'crier', 'lamps', 'shift', 'church', 'pigeons']
const ROLLED = ['tag', 'cart', 'unload', 'washing', 'busker', 'beggar', 'drunk']
// seen on the square or from it (the streets, doors and yards round it); the
// rest happen at the quay, the church door and in the back yards
const ON_SQUARE = new Set(['talk', 'tag', 'pigeons', 'cart', 'smith', 'busker', 'crier', 'lamps', 'shift', 'drunk', 'church'])

// The day's scenes. Two days running always differ: the day's own scene of
// the rolled seven is always in, and the next one in the list never is (it
// is the following day's own).
export function scenesForDay(seed, day) {
  const L = ROLLED.length
  const d = ((day % L) + L) % L
  const sure = ROLLED[d], never = ROLLED[(d + 1) % L]
  const roll = id => hash(seed, day, ROLLED.indexOf(id), 901)
  const rest = ROLLED.filter(id => id !== sure && id !== never).sort((a, b) => roll(a) - roll(b))
  const rolled = [sure, ...rest.filter(id => roll(id) < 0.5)]
  for (const id of rest) if (rolled.length < 3 && !rolled.includes(id)) rolled.push(id)
  return new Set([...ALWAYS, ...rolled])
}

// the bell: the ringing starts, the square empties towards the church and fills again
const BELL = [DAY.bell - 0.025, DAY.bell + 0.07]
const offBell = (a, b) => b <= BELL[0] || a >= BELL[1]
// washing hung out, and taken in
const WASH_OUT = [0.25, 0.31], WASH_IN = [0.70, 0.76]

function buildWindows(seed, day) {
  const set = scenesForDay(seed, day)
  const out = [], n = {}
  const H = (salt, i = 0) => hash(seed, day, i, 910 + salt)
  const add = (id, a, b, { place = null, phase = null } = {}) => {
    if (!set.has(id) || b <= a) return
    n[id] = (n[id] ?? 0) + 1
    out.push({ id, k: `${id}:${n[id]}`, a, b, place, phase })
  }
  // two people stop and talk: six times through the working day, and at the inn door as the evening comes and goes
  for (let i = 0; i < 6; i++) { const a = 0.25 + i * 0.075 + H(1, i) * 0.035; if (offBell(a, a + 0.035)) add('talk', a, a + 0.035, { place: 'square' }) }
  add('talk', 0.78, 0.82, { place: 'inn' }); add('talk', 0.925, 0.97, { place: 'inn' })
  // the smith at his anvil through his working hours, but for lunch and the church
  add('smith', DAY.dawn + 0.02, DAY.noon); add('smith', DAY.afternoon + 0.01, BELL[0] + 0.005); add('smith', BELL[1] - 0.015, DAY.dusk)
  // the crier at his box, as his day has him there
  add('crier', 0.25, 0.32); add('crier', 0.385, DAY.noon); add('crier', 0.525, 0.585); add('crier', 0.655, 0.69)
  add('church', BELL[0], BELL[1])
  add('lamps', DAY.dawn - 0.01, DAY.dawn + 0.05, { phase: 'dawn' }); add('lamps', DAY.dusk - 0.02, DAY.night - 0.02, { phase: 'dusk' })
  add('shift', DAY.dawn - 0.05, DAY.dawn + 0.04, { phase: 'dawn' }); add('shift', DAY.dusk - 0.055, DAY.dusk + 0.04, { phase: 'dusk' })
  // a dog runs at the pigeons, four times a day
  for (let i = 0; i < 4; i++) { const a = 0.27 + i * 0.1 + H(2, i) * 0.05; if (offBell(a, a + 0.035)) add('pigeons', a, a + 0.035) }
  // the children's play times (and the morning, on the days without school)
  if (day % 2) add('tag', 0.275, 0.38)
  add('tag', 0.40, DAY.noon); add('tag', 0.53, BELL[0]); add('tag', 0.67, DAY.dusk)
  { const a = 0.29 + H(3) * 0.04; add('cart', a, a + 0.16) }
  { const a = 0.50 + H(4) * 0.02; add('cart', a, a + 0.15) }
  add('unload', DAY.dawn + 0.01, 0.31); add('unload', 0.34, 0.40)
  add('washing', ...WASH_OUT, { phase: 'out' }); add('washing', ...WASH_IN, { phase: 'in' })
  { const a = 0.29 + H(5) * 0.06; add('busker', a, a + 0.10) }
  if (H(6) < 0.6) add('busker', 0.52, 0.572)
  add('beggar', 0.25, 0.36); add('beggar', 0.645, 0.70)
  { const a = 0.85 + H(7) * 0.04; add('drunk', a, a + 0.06) }
  return out.sort((x, y) => x.a - y.a)
}

const windowCache = new Map()
export function sceneWindows(seed, day) {
  const key = `${seed}|${day}`
  let w = windowCache.get(key)
  if (w) return w
  w = buildWindows(seed, day)
  if (windowCache.size >= 32) windowCache.delete(windowCache.keys().next().value)
  windowCache.set(key, w)
  return w
}

const fracOf = f => { let x = f % 1; if (x < 0) x += 1; return x }
export function scheduleAt(seed, day, frac) {
  const f = fracOf(frac)
  return sceneWindows(seed, day).filter(s => s.a <= f && f < s.b)
}

export function squareScenesAt(seed, day, frac) {
  const out = []
  for (const s of scheduleAt(seed, day, frac)) if (ON_SQUARE.has(s.id) && !out.includes(s.id)) out.push(s.id)
  return out
}

// ---- numbers ----------------------------------------------------------------------

const CHECK = 0.25          // s between two looks at the timetable
const REACH = 0.6           // tiles from a spot that count as standing on it
const SLACK = 4             // tiles beyond the near radius before a scene's place is let go
const TALK_RANGE = 6        // tiles between two people who stop for a word
const TALK_PAIRS = 2        // pairs talking at once in a slot
const TALK_WAIT = 8         // s for a pair to come together, or the word is off
const TALK_COOL = 40        // s before someone who talked stops to talk again
const TAG_REACH = 0.8       // tiles: a touch
const TAG_FREEZE = 1.2      // s the new one who is "it" counts before giving chase
const TAG_KIDS = 4
const DOG_REACH = 32        // tiles from the flock a dog comes running from
const CART_LATE = 0.05      // of the day: a cart that could not set out by then stays home
const HAMMER = 5, BLOW = 0.55, QUENCH = 2.5
const RING_EVERY = 1, RINGS = 3, CRY_QUIET = 17   // a call every 20 s: three rings, the call, quiet
const LIGHT_TIME = 1.2      // s at a lamp
const HANG_TIME = 3         // s at a washing line
const WASH_MAX = 45         // s someone may take to get to a line and see to it
const WASHERS = 3           // lines seen to at once
const ASK_EVERY = 6         // s between two asks of the beggar's
const LISTENERS = 2, LISTEN = 15, LISTEN_COOL = 60
const CARRIERS = 3, CARRY_PAUSE = 1.5
const CARRY_MAX = 45        // s after the slot a crate already picked up may take to reach the market
const DRUNK_SAY = 5
const DRUNK_MAX = 90        // s a drunk may take to get home
const GAWKERS = 8           // townsfolk who come to stand round the stocks
const TURNIP_EVERY = 1.1    // s between two turnips

// ---- the stage --------------------------------------------------------------------

const spotW = (run, id) => { const s = run.cc.city.spots[id]; return s ? { X: s.x + OX, Y: s.y + OY } : null }
const playerOn = (c, X, Y) => c.state.player.x === Math.round(X) - c.ox && c.state.player.y === Math.round(Y) - c.oy
const running = (run, k) => run.scenes.find(s => s.slot === k && !s.done) ?? null
const countRunning = (run, k) => run.scenes.reduce((n, s) => n + (s.slot === k && !s.done ? 1 : 0), 0)
const setNext = (city, x, y) => { if (city.next) { city.next.x = x; city.next.y = y } else city.next = { x, y } }

// What the run carries for the scenes (runtime.js makeRun).
export function makeStage(cc, seed, day, frac) {
  const things = thingsOf(cc)
  const lit = new Uint8Array(cc.city.lamps.length)
  for (let i = 0; i < lit.length; i++) lit[i] = lampDue(things, i, frac)
  const washday = scenesForDay(seed, day).has('washing')
  return {
    scenes: [], sceneT: 0, sceneCheck: 0, sceneN: 0, cryN: 0, cryDay: day, cryDated: 0,
    lights: { lit },
    fx: {
      turnips: [], carts: [], smithy: null, crier: null, busker: null, bell: false,
      flocks: [makeFlock(things, seed, day)],
      washing: things.lines.map((l, j) => ({ X: l.x + OX, Y: l.y + OY, state: washDue(washday, seed, day, j, frac), by: null })),
    },
  }
}




// Once a frame (runtime.js tickCity, after the law and before people turn near or far).
export function tickScenes(state, world, run, delta, ox, oy) {
  run.sceneT += delta
  const p = state.player
  const c = { state, world, run, ox, oy, dt: delta, R: run.nearR, PX: p.px / S - 0.5 + ox, PY: p.py / S - 0.5 + oy }
  for (const sc of run.scenes) {
    if (sc.done) continue
    sc.t += delta
    STAGE[sc.id].step?.(c, sc, delta)
  }
  stepFlocks(c, delta)
  stepTurnips(c, delta)
  if ((run.sceneCheck -= delta) <= 0) { run.sceneCheck = CHECK; direct(c) }
  if (run.scenes.some(s => s.done)) run.scenes = run.scenes.filter(s => !s.done)
}

// The timetable's look: scenes whose slot is over or whose place is out of
// reach end, and every slot on gets its chance to cast.
function direct(c) {
  const { run } = c
  const slots = scheduleAt(run.seed, run.day, run.frac)
  for (const sc of run.scenes) {
    if (sc.done || sc.id === 'gawk') continue
    const def = STAGE[sc.id]
    if (!def.outlives && !slots.some(s => s.k === sc.slot)) { end(run, sc); continue }
    if (!def.anywhere && cheb(sc.at.x, sc.at.y, c.PX, c.PY) > c.R + SLACK + (def.range ?? 0)) end(run, sc)
  }
  for (const slot of slots) STAGE[slot.id].start?.(c, slot)
  STAGE.gawk.start(c, null)
  run.fx.bell = run.frac >= BELL[0] && run.frac < DAY.bell + 0.02
  lampsByClock(c)
  washingByClock(c, slots)
}

// A scene's record.
function open(c, slot, id, at, extra = {}) {
  const sc = { id, key: `${id}#${++c.run.sceneN}`, slot: slot?.k ?? null, at: { x: at.X, y: at.Y }, cast: [], t: 0, ...extra }
  c.run.scenes.push(sc)
  return sc
}

// Free to be cast: in their day (not out, a hunter, in the stocks' crowd or
// another scene), not a moment ago in one (coolT), and if near, on their feet.
// `near`: only one who is near now.
function castable(run, w, { species = 'townsfolk', near = false } = {}) {
  if (w.animal || w.out || w.pending || w.hunt || w.scene || w.leashed || w.species !== species) return false
  if ((w.coolT ?? 0) > run.sceneT) return false
  if (w.mode === 'near') { const e = w.entity; return !!e && e.hp > 0 && !(e.ai.fleeTimer > 0) && !w.shy }
  if (near) return false
  return w.mode === 'far' || !!w.door   // indoors: out through their door
}

// Into a scene. Someone indoors comes out of their door (a far walker at its
// front step, who turns near there if the step is in sight).
function cast(run, sc, w, r) {
  w.scene = { id: sc.id, key: sc.key, how: r.how ?? 'step', spot: r.spot ?? null, there: false, facing: r.facing ?? null, ...r }
  w.shy = null
  if (w.mode === 'indoors') {
    if (w.door) { const f = run.cc.front(w.door); w.X = f.x + OX; w.Y = f.y + OY }
    w.mode = 'far'; w.door = null
  }
  if (w.scene.how === 'route') sendTo(run, w, w.scene.goalKey, w.scene.spot, w.scene.door)
  sc.cast.push(w.id)
  attach(w)
}

// A walker's goal set to a scene's place, walked by the street route like any other.
function sendTo(run, w, key, spot, door = null) {
  const tile = { x: spot.X - OX, y: spot.Y - OY }
  w.goal = door ? { key, kind: 'door', door, tile } : { key, kind: 'spot', tile }
  w.phase = 'wait'; w.path = null; w.loop = false; w.homed = false
  if (w.scene) { w.scene.goalKey = key; w.scene.there = false }
  if (!w.needRoute) { w.needRoute = true; run.queue.push(w) }
}

// what the entity sees of its walker's scene
function attach(w) {
  const c = w.entity?.city
  if (!c) return
  c.scene = w.scene
  c.talk = w.scene?.talk ?? null
  if (!w.scene) c.carry = false
}

// Back to the day the schedule has for them now (from where they stand).
export function backToDay(run, w) {
  w.goal = null
  setEntry(run.cc, w, entryAt(w.sched, run.frac))
  if (w.needRoute) run.queue.push(w)
  if (w.entity) w.entity.city.entry = w.entry
}

function letGo(run, w, cool = 0) {
  w.scene = null
  w.coolT = run.sceneT + cool
  attach(w)
  if (!w.out && w.mode !== 'indoors') backToDay(run, w)
}

// the cast member still in this scene, or null
function member(run, sc, id) {
  const w = run.people.get(id)
  return w?.scene?.key === sc.key ? w : null
}
const onFeet = w => w?.mode === 'near' && w.entity?.hp > 0 && !(w.entity.ai.fleeTimer > 0)

function drop(run, sc, w, cool = 0) {
  letGo(run, w, cool)
  sc.cast = sc.cast.filter(id => id !== w.id)
}
// the members still in the scene (one struck down meanwhile is not), the cast list cut to them
function members(run, sc) {
  const out = []
  for (const id of sc.cast) { const w = member(run, sc, id); if (w) out.push(w) }
  if (out.length !== sc.cast.length) sc.cast = out.map(w => w.id)
  return out
}

function end(run, sc) {
  if (sc.done) return
  sc.done = true
  STAGE[sc.id].end?.(run, sc)
  for (const id of sc.cast) {
    const w = member(run, sc, id)
    if (w) letGo(run, w, sc.cool ?? 0)
  }
}

// End every scene of that id (all of them for null), but those of `keep`.
export function endScenes(run, id = null, keep = null) {
  for (const sc of run.scenes) if (!sc.done && (id === null || sc.id === id) && sc.id !== keep) end(run, sc)
  run.scenes = run.scenes.filter(s => !s.done)
}

// runtime.js near(), for a walker in a scene: true when the scene keeps them
// where they are this frame (the npc goals stand them there), false to walk
// their route on.
export function sceneStep(run, w, e, ox, oy) {
  const r = w.scene, c = e.city
  if (r.how === 'free') { c.next = null; return true }
  if (r.how === 'step') {
    const d = Math.hypot(r.spot.X - w.X, r.spot.Y - w.Y)
    if (d > (r.there ? 1.2 : REACH)) { r.there = false; setNext(c, r.spot.X - ox, r.spot.Y - oy); return true }
    r.there = true; c.next = null; c.passed = false
    return true
  }
  const there = w.phase === 'there' && (r.how === 'route' ? w.goal?.key === r.goalKey : w.entry?.act === r.act)
  if (!there) { r.there = false; return false }
  r.there = true; c.next = null
  return true
}

const faceTo = (fromX, toX) => toX < fromX ? 'west' : 'east'
// a world tile on or beside a door, where standing about would block the way in and out
function byDoor(run, X, Y) {
  const x = X - OX, y = Y - OY, cells = run.cc.doorCells
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cells.has((y + dy) * 160 + x + dx)) return true
  return false
}

// The crier's next call. What is good for one day only (the stocks,
// yesterday) takes his first calls of that day, in a town just come into the
// window too; then the day's news (crier.js) in rotation, carried on from one
// of his turns at the box to the next and from one day to the next (he calls
// a few times a day, so the player's deeds at the end of the list would never
// come round if every morning began at the market again).
function nextNews(c) {
  const { run } = c
  if (run.cryDay !== run.day) { run.cryDay = run.day; run.cryDated = 0 }
  const dated = datedNews(c.world, run.day)
  if (run.cryDated < dated.length) return dated[run.cryDated++]
  const news = crierNews(c.world, run.seed, run.day)
  return news[run.cryN++ % news.length]
}

// ---- the scenes -------------------------------------------------------------------

const STAGE = {
  // Two people stop, face each other and talk. One stays where they stand,
  // the other comes up beside them; npc.js talk takes the turns.
  talk: {
    outlives: true,   // a word once begun is finished
    start(c, slot) {
      const { run } = c
      if (countRunning(run, slot.k) >= TALK_PAIRS) return
      const at = spotW(run, slot.place === 'inn' ? 'inn-door' : 'fountain')
      if (!at || cheb(at.X, at.Y, c.PX, c.PY) > c.R) return
      const reach = slot.place === 'inn' ? 8 : 16
      const cand = []
      for (const w of run.people.values()) {
        // (never the crier: he has the news to call, and a word's cooldown would keep him from his box)
        if (w.person.age !== 'child' && w.person.job !== 'crier' && castable(run, w, { near: true }) && cheb(w.X, w.Y, at.X, at.Y) <= reach) cand.push(w)
      }
      // whoever is free, from a different place in the list each time
      const k0 = cand.length ? hashInt(run.seed, run.day, run.sceneN, 932) % cand.length : 0
      for (let i = 0; i < cand.length; i++) {
        const a = cand[(k0 + i) % cand.length]
        let b = null, bd = TALK_RANGE
        for (const o of cand) {
          if (o === a) continue
          const d = cheb(a.X, a.Y, o.X, o.Y)
          if (d < bd) { b = o; bd = d }
        }
        if (!b) continue
        // a stands; b comes up on whichever side of a is nearer and free (never in a doorway)
        const ax = Math.round(a.X), ay = Math.round(a.Y)
        if (byDoor(run, ax, ay)) continue
        const sides = b.X >= a.X ? [1, -1] : [-1, 1]
        const side = sides.find(s => walkableAt(c, ax + s, ay) && !playerOn(c, ax + s, ay) && !byDoor(run, ax + s, ay))
        if (side === undefined) continue
        const lines = talkFor(a.person, b.person, { night: slot.place === 'inn', k: hashInt(run.seed, run.day, a.n * 1000 + b.n, 931) })
        const conv = { i: 0, t: TALK_BEAT, go: false, done: false, said: -1 }
        const sc = open(c, slot, 'talk', { X: ax, Y: ay }, { cool: TALK_COOL, conv })
        cast(run, sc, a, { spot: { X: ax, Y: ay }, facing: side > 0 ? 'east' : 'west', talk: { lines, me: 0, conv } })
        cast(run, sc, b, { spot: { X: ax + side, Y: ay }, facing: side > 0 ? 'west' : 'east', talk: { lines, me: 1, conv } })
        return
      }
    },
    step(c, sc) {
      const a = member(c.run, sc, sc.cast[0]), b = member(c.run, sc, sc.cast[1])
      if (!onFeet(a) || !onFeet(b)) { end(c.run, sc); return }
      if (a.scene.there && b.scene.there) sc.conv.go = true
      if ((!sc.conv.go && sc.t > TALK_WAIT) || sc.conv.done) end(c.run, sc)
    },
  },

  // Children play tag round the fountain: whoever is "it" chases the nearest,
  // the others run, a touch makes the touched one "it".
  tag: {
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k)) return
      const mid = spotW(run, 'fountain')
      if (!mid || cheb(mid.X, mid.Y, c.PX, c.PY) > c.R) return
      const kids = []
      for (const w of run.people.values()) {
        if (w.person.age === 'child' && castable(run, w, { near: true }) && cheb(w.X, w.Y, mid.X, mid.Y) <= 10) kids.push(w)
      }
      if (kids.length < 2) return
      kids.sort((p, q) => cheb(p.X, p.Y, mid.X, mid.Y) - cheb(q.X, q.Y, mid.X, mid.Y))
      const sc = open(c, slot, 'tag', mid, { it: kids[0].id, retarget: 0, tags: 0, cool: 20 })
      for (const w of kids.slice(0, TAG_KIDS)) cast(run, sc, w, { how: 'free', role: w === kids[0] ? 'it' : 'run', target: null, freeze: w === kids[0] ? TAG_FREEZE : 0 })
    },
    step(c, sc, dt) {
      const { run } = c
      const kids = []
      for (const w of members(run, sc)) if (onFeet(w)) kids.push(w); else drop(run, sc, w)
      if (kids.length < 2) { end(run, sc); return }
      const it = kids.find(w => w.id === sc.it) ?? kids[0]
      sc.it = it.id
      for (const w of kids) w.scene.role = w === it ? 'it' : 'run'
      it.scene.freeze = Math.max(0, it.scene.freeze - dt)
      const e = it.entity
      let near = null, nd = Infinity
      for (const w of kids) {
        if (w === it) continue
        const d = Math.hypot(w.entity.px - e.px, w.entity.py - e.py)
        if (d < nd) { near = w; nd = d }
      }
      if (it.scene.freeze <= 0 && nd < TAG_REACH * S) {
        // tagged: the touched one counts, and everybody scatters
        sc.it = near.id; sc.tags++; sc.retarget = 0
        near.scene.role = 'it'; near.scene.freeze = TAG_FREEZE; near.scene.target = null
        it.scene.role = 'run'
        return
      }
      if ((sc.retarget -= dt) > 0) return
      sc.retarget = 0.3
      it.scene.target = { x: near.entity.x, y: near.entity.y }
      for (const w of kids) if (w !== it) w.scene.target = fleeTile(c, w.entity, e, sc.at)
    },
  },

  // A dog runs at the pigeons (go_to the flock); the flock lifts when it is
  // near, circles and settles elsewhere (stepFlocks). With no dog about,
  // something else startles them halfway through.
  pigeons: {
    range: 10, outlives: true,   // the flock settles before it is over
    start(c, slot) {
      const { run } = c
      const once = `${run.day}:${slot.k}`   // one run at the flock a slot
      if (running(run, slot.k) || run.pigeonsRan === once) return
      const f = run.fx.flocks[0]
      if (!f || f.state !== 'settled' || cheb(f.X, f.Y, c.PX, c.PY) > c.R) return
      run.pigeonsRan = once
      let dog = null, dd = DOG_REACH
      for (const a of run.animals.values()) {
        if (a.species !== 'dog' || a.mode !== 'near' || !(a.entity?.hp > 0) || a.entity.ai.fleeTimer > 0) continue
        const d = cheb(a.X, a.Y, f.X, f.Y)
        if (d < dd) { dog = a; dd = d }
      }
      const sc = open(c, slot, 'pigeons', f, { dog: dog?.id ?? null, lifts: f.lifts, startle: (slot.a + slot.b) / 2 })
      if (dog) sc.cast.push(dog.id)
    },
    step(c, sc) {
      const { run } = c
      const f = run.fx.flocks[0]
      sc.at.x = f.X; sc.at.y = f.Y
      if (f.lifts > sc.lifts) {
        if (f.state === 'settled') end(run, sc)
        return
      }
      const dog = sc.dog ? run.animals.get(sc.dog) : null
      if (dog?.mode === 'near' && dog.entity?.hp > 0) dog.entity.objective = { x: Math.round(f.X) - c.ox, y: Math.round(f.Y) - c.oy }
      else if (run.frac >= sc.startle) f.startle = true
      if (sc.t > 20) end(run, sc)
    },
    end(run, sc) {
      const dog = sc.dog ? run.animals.get(sc.dog) : null
      if (dog?.entity) dog.entity.objective = null
    },
  },

  // A carter's horse and cart come in at the north gate, down market street
  // to a stall on the square, unload, and go back out the way they came.
  // The carter rides it (out of the street while he does: indoors, no door);
  // people in its way step aside (the runtime's give-way, w.shy).
  cart: {
    outlives: true, anywhere: true,
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k) || run.fx.carts.length || run.frac - slot.a > CART_LATE) return
      const gate = spotW(run, 'gate-N-out')
      if (!gate || cheb(gate.X, gate.Y, c.PX, c.PY) <= c.R + 2) return   // it comes in out of sight
      let driver = null
      for (const job of ['carter', 'porter']) {
        for (const w of run.people.values()) if (w.person.job === job && w.mode !== 'near' && castable(run, w)) { driver = w; break }
        if (driver) break
      }
      if (!driver) return
      const stalls = Object.keys(run.cc.city.spots).filter(k => /^stall-\d+$/.test(k) && run.cc.city.spots[k].y < PLAN.places.fountain.y)
      if (!stalls.length) return
      const stall = run.cc.city.spots[stalls[hashInt(run.seed, run.day, slot.a * 1000 | 0, 971) % stalls.length]]
      const path = route(run.cc.G, { x: gate.X - OX, y: gate.Y - OY }, stall)
      if (!path || path.length < 2) return
      const sc = open(c, slot, 'cart', gate, { path, i: 1, back: false, wait: 0, give: 0 })
      // on the box: out of the street (as if indoors, behind no door) until the cart is back out of the gate
      driver.scene = { id: 'cart', key: sc.key, how: 'away', spot: null, there: true, facing: null }
      if (driver.entity) { run.remove.add(driver.entity); driver.entity = null }
      driver.mode = 'indoors'; driver.door = null; driver.path = null; driver.needRoute = false
      sc.cast.push(driver.id)
      sc.cart = { X: gate.X, Y: gate.Y, dir: 'south', state: 'rolling', look: driver.look, by: driver.id }
      run.fx.carts.push(sc.cart)
    },
    step(c, sc, dt) { if (moveCart(c, sc, dt) === 'gone') end(c.run, sc) },
    end(run, sc) {
      run.fx.carts = run.fx.carts.filter(k => k !== sc.cart)
      // the carter gets down at the gate
      const w = member(run, sc, sc.cast[0])
      if (w) { w.mode = 'far'; w.X = sc.cart.X; w.Y = sc.cart.Y }
    },
  },

  // Fishers and porters carry crates from the boats to the fish market. When
  // the slot is over nobody fetches another, but a crate already picked up
  // is carried to the market and set down there (CARRY_MAX at most).
  unload: {
    range: 10, outlives: true,
    start(c, slot) {
      const { run } = c
      const market = spotW(run, 'fish-market')
      if (!market || cheb(market.X, market.Y, c.PX, c.PY) > c.R + 10) return
      let sc = running(run, slot.k)
      if (sc && sc.cast.length >= CARRIERS) return
      const quays = Object.keys(run.cc.city.spots).filter(k => /^quay-\d+$/.test(k))
      if (!quays.length) return
      for (const w of run.people.values()) {
        if (sc && sc.cast.length >= CARRIERS) break
        if (!['fisher', 'porter', 'sailor'].includes(w.person.job) || !castable(run, w, { near: true })) continue
        // those about the harbour: their own boat if their day has them at a quay, else one of the boats
        const spot = w.entry?.where?.spot
        const atQuay = /^quay-/.test(spot ?? '') && (w.entry.act === 'unload' || w.entry.act === 'nets')
        const boat = spotW(run, atQuay ? spot : quays[w.n % quays.length])
        if (cheb(w.X, w.Y, market.X, market.Y) > 14 && cheb(w.X, w.Y, boat.X, boat.Y) > 6) continue
        const fm = run.cc.city.spots['fish-market']
        const m = [[0, 1], [1, 1], [-1, 1], [2, 1], [-2, 1], [0, 2]].map(([dx, dy]) => ({ x: fm.x + dx, y: fm.y + dy })).find(t => reachable(run.cc, t.x, t.y)) ?? fm
        sc ??= open(c, slot, 'unload', market, { cool: 30, ends: slot.b, day: run.day, over: 0, delivered: 0 })
        cast(run, sc, w, { how: 'route', spot: boat, goalKey: `${sc.key}:${w.id}:boat`, boat, market: toWorld(m), loaded: false, pause: 0, trips: 0 })
      }
    },
    step(c, sc, dt) {
      const { run } = c
      const over = run.day !== sc.day || run.frac >= sc.ends
      if (over && (sc.over += dt) > CARRY_MAX) { end(run, sc); return }
      for (const w of members(run, sc)) {
        if (w.mode === 'near' && !onFeet(w)) { drop(run, sc, w, 30); continue }
        const r = w.scene
        if (over && !r.loaded) { drop(run, sc, w, 30); continue }   // nothing more to fetch
        if (w.mode !== 'near' || !r.there) continue
        if ((r.pause += dt) < CARRY_PAUSE) continue
        r.pause = 0
        r.loaded = !r.loaded; r.trips++
        if (w.entity) w.entity.city.carry = r.loaded
        if (!r.loaded) sc.delivered++   // set down at the market
        if (over) { drop(run, sc, w, 30); continue }
        sendTo(run, w, `${sc.key}:${w.id}:${r.loaded ? 'market' : 'boat'}:${r.trips}`, r.loaded ? r.market : r.boat)
        r.spot = r.loaded ? r.market : r.boat
      }
      if (!sc.cast.length) end(run, sc)
    },
  },

  // Seppo (or his apprentice) at the anvil: hammering, then the quench.
  smith: {
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k)) return
      const anvil = spotW(run, 'smithy-anvil')
      if (!anvil || cheb(anvil.X, anvil.Y, c.PX, c.PY) > c.R + 4) return
      let smith = null, sd = Infinity
      for (const w of run.people.values()) {
        if ((w.person.job !== 'smith' && w.person.job !== 'apprentice') || !castable(run, w)) continue
        const d = cheb(w.X, w.Y, anvil.X, anvil.Y) + (w.person.job === 'smith' ? 0 : 20)   // the master first, if he is anywhere near
        if (d < sd) { smith = w; sd = d }
      }
      if (!smith) return
      const sm = PLAN.places.smithy
      const sc = open(c, slot, 'smith', anvil)
      cast(run, sc, smith, { how: 'route', spot: anvil, goalKey: `${sc.key}:anvil`, facing: 'east', state: 'idle', t: 0 })
      run.fx.smithy = { X: anvil.X, Y: anvil.Y, forge: toWorld({ x: sm.x1 - 1, y: sm.y0 + 5 }), state: 'idle', blows: 0, by: smith.id }
    },
    step(c, sc, dt) {
      const { run } = c
      const w = member(run, sc, sc.cast[0]), fx = run.fx.smithy
      if (!w || (w.mode === 'near' && !onFeet(w))) { end(run, sc); return }
      const r = w.scene
      if (w.mode !== 'near' || !r.there) { fx.state = 'idle'; return }
      if (fx.state === 'idle') { fx.state = 'hammering'; r.t = HAMMER; r.blow = 0 }
      r.t -= dt
      if (fx.state === 'hammering') {
        if ((r.blow -= dt) <= 0) {
          r.blow = BLOW; fx.blows++
          w.entity.attack = { weaponId: 'club', phase: 'swing', timer: 0.3, duration: 0.3, angle: 0 }
        }
        if (r.t <= 0) { fx.state = 'quenching'; r.t = QUENCH }
      } else if (r.t <= 0) { fx.state = 'hammering'; r.t = HAMMER; r.blow = 0 }
    },
    end(run) { run.fx.smithy = null },
  },

  // Washing goes out on the lines in the morning and comes in at dusk: in
  // sight, only when someone has walked to the line and stood at it a moment
  // (they finish however long the walk, WASH_MAX at most); out of sight, by
  // the clock (washingByClock).
  washing: {
    outlives: true,
    step(c, sc, dt) {
      const { run } = c
      const w = member(run, sc, sc.cast[0]), line = run.fx.washing[sc.line]
      if (!w || (w.mode === 'near' && !onFeet(w)) || sc.t > WASH_MAX) { end(run, sc); return }
      if (w.mode !== 'near' || !w.scene.there) return
      if ((w.scene.t += dt) >= HANG_TIME) { line.state = sc.to; line.by = w.id; line.byDay = run.day; end(run, sc) }
    },
  },

  // A busker plays on the square some days, and a passer-by or two stops to listen.
  busker: {
    start(c, slot) {
      const { run } = c
      let sc = running(run, slot.k)
      if (!sc) {
        const spots = ['fountain', 'bench-1', 'bench-2', 'bench-3', 'bench-4'].filter(k => run.cc.city.spots[k])
        const pool = [...run.people.values()].filter(w => w.person.job === 'sailor' || (w.person.job === 'beggar' && w.person.work !== 'church-steps'))
        if (!spots.length || !pool.length) return
        const id = spots[hashInt(run.seed, run.day, 1, 952) % spots.length], s = run.cc.city.spots[id]
        const pitch = [[2, 0], [-2, 0], [0, 2], [2, 1], [-2, 1], [1, 2]].map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy })).find(t => reachable(run.cc, t.x, t.y))
        if (!pitch || cheb(pitch.x + OX, pitch.y + OY, c.PX, c.PY) > c.R + 4) return
        const w = pool[hashInt(run.seed, run.day, 0, 951) % pool.length]
        if (!castable(run, w)) return
        const at = toWorld(pitch)
        sc = open(c, slot, 'busker', at, { cool: 0 })
        const facing = hash(run.seed, run.day, 2, 953) < 0.5 ? 'east' : 'west'
        cast(run, sc, w, { how: 'route', spot: at, goalKey: `${sc.key}:pitch`, facing })
        run.fx.busker = { X: at.X, Y: at.Y, playing: false, by: w.id }
        return
      }
      // a listener or two, from those standing about near him
      const fx = run.fx.busker
      if (!fx?.playing || sc.cast.length > LISTENERS) return
      for (const w of run.people.values()) {
        if (w.phase !== 'there' || w.entry?.act === 'stall' || w.entry?.act === 'beg' || !castable(run, w, { near: true })) continue
        if (cheb(w.X, w.Y, sc.at.x, sc.at.y) > 12) continue
        const spot = [[0, 2], [1, 2], [-1, 2], [0, -2], [2, 1], [-2, 1]].map(([dx, dy]) => ({ X: sc.at.x + dx, Y: sc.at.y + dy }))
          .find(t => walkableAt(c, t.X, t.Y) && !sc.cast.some(id => { const o = run.people.get(id); return o?.scene?.spot && o.scene.spot.X === t.X && o.scene.spot.Y === t.Y }))
        if (!spot) return
        cast(run, sc, w, { spot, facing: faceTo(spot.X, sc.at.x), until: run.sceneT + LISTEN })
        return
      }
    },
    step(c, sc) {
      const { run } = c
      const w = member(run, sc, sc.cast[0]), fx = run.fx.busker
      if (!w || (w.mode === 'near' && !onFeet(w))) { end(run, sc); return }
      fx.playing = w.mode === 'near' && w.scene.there
      for (const l of members(run, sc).slice(1)) if (!onFeet(l) || run.sceneT >= l.scene.until || !fx.playing) drop(run, sc, l, LISTEN_COOL)
    },
    end(run) { run.fx.busker = null },
  },

  // A beggar by the church door asks the passers-by.
  beggar: {
    range: 4,
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k)) return
      const door = spotW(run, 'church-door')
      if (!door || cheb(door.X, door.Y, c.PX, c.PY) > c.R + 4) return
      const beggars = [...run.people.values()].filter(w => w.person.job === 'beggar').sort((a, b) => (b.person.work === 'church-steps') - (a.person.work === 'church-steps'))
      const w = beggars.find(b => castable(run, b))
      if (!w) return
      const sc = open(c, slot, 'beggar', door, { ask: ASK_EVERY / 2, asks: 0 })
      cast(run, sc, w, { how: 'route', spot: door, goalKey: `${sc.key}:door`, facing: 'east' })
    },
    step(c, sc, dt) {
      const { run } = c
      const w = member(run, sc, sc.cast[0])
      if (!w || (w.mode === 'near' && !onFeet(w))) { end(run, sc); return }
      if (w.mode !== 'near' || !w.scene.there || (sc.ask -= dt) > 0) return
      for (const o of run.people.values()) {
        if (o === w || o.mode !== 'near' || o.scene || o.species !== 'townsfolk' || cheb(o.X, o.Y, w.X, w.Y) > 3) continue
        sc.ask = ASK_EVERY
        w.entity.facing = faceTo(w.X, o.X)
        sceneSay(c.state, w.entity, BEGGAR_LINES[sc.asks++ % BEGGAR_LINES.length])
        return
      }
    },
  },

  // The crier at his box rings his hand bell and calls the news, a call every
  // 20 s (his day puts him there; the scene stands him still for it).
  crier: {
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k)) return
      const box = spotW(run, 'crier')
      if (!box || cheb(box.X, box.Y, c.PX, c.PY) > c.R + 4) return
      const w = [...run.people.values()].find(p => p.person.job === 'crier')
      if (!w || w.entry?.act !== 'cry' || !castable(run, w, { near: true })) return
      const sc = open(c, slot, 'crier', box)
      cast(run, sc, w, { how: 'ride', act: 'cry', day: true, facing: 'east', ring: 0, rung: 0, quiet: 0 })
      run.fx.crier = { X: box.X, Y: box.Y, rings: 0, ringing: false, by: w.id }
    },
    step(c, sc, dt) {
      const { run } = c
      const w = member(run, sc, sc.cast[0]), fx = run.fx.crier
      if (!w || w.entry?.act !== 'cry' || (w.mode === 'near' && !onFeet(w))) { end(run, sc); return }
      fx.ringing = false
      const r = w.scene
      if (w.mode !== 'near' || !r.there) return
      if (r.quiet > 0) { r.quiet -= dt; return }
      if ((r.ring -= dt) > 0) return
      if (r.rung < RINGS) { r.rung++; r.ring = RING_EVERY; fx.rings++; fx.ringing = true; return }
      sceneSay(c.state, w.entity, nextNews(c))
      r.rung = 0; r.quiet = CRY_QUIET
    },
    end(run) { run.fx.crier = null },
  },

  // The lamplighter's round: the lamps round the square one by one at dusk,
  // out again at dawn. Lamps he is not seen at go by the clock (lampsByClock).
  lamps: {
    range: 10,
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k)) return
      const mid = spotW(run, 'fountain')
      if (!mid || cheb(mid.X, mid.Y, c.PX, c.PY) > c.R + 10) return
      const w = [...run.people.values()].find(p => p.person.job === 'lamplighter')
      if (!w || !castable(run, w)) return
      const sc = open(c, slot, 'lamps', mid, { lamp: -1, lit: 0 })
      cast(run, sc, w, { how: 'route', spot: mid, goalKey: `${sc.key}:start`, t: 0 })
    },
    step(c, sc, dt) {
      const { run } = c
      const w = member(run, sc, sc.cast[0])
      if (!w || (w.mode === 'near' && !onFeet(w))) { end(run, sc); return }
      const r = w.scene
      if (w.mode !== 'near') return
      const things = thingsOf(run.cc), lit = run.lights.lit
      if (sc.lamp >= 0 && lit[sc.lamp] === lampDue(things, sc.lamp, run.frac)) sc.lamp = -1   // the clock got there first
      if (sc.lamp >= 0) {
        if (!r.there) return
        if ((r.t += dt) < LIGHT_TIME) return
        lit[sc.lamp] ^= 1; sc.lit++; sc.lamp = -1
      }
      // the nearest lamp due, of those near the player
      let best = -1, bd = Infinity
      const lamps = run.cc.city.lamps
      for (let i = 0; i < lit.length; i++) {
        if (lit[i] === lampDue(things, i, run.frac) || !lampSeen(c, i)) continue
        const d = cheb(lamps[i].x + OX, lamps[i].y + OY, w.X, w.Y)
        if (d < bd) { best = i; bd = d }
      }
      if (best < 0 || !things.lampStand[best]) return
      sc.lamp = best; r.t = 0
      const at = toWorld(things.lampStand[best])
      sc.at.x = at.X; sc.at.y = at.Y
      sendTo(run, w, `${sc.key}:lamp:${best}`, at)
    },
  },

  // The watch's shift change marching through the streets, and the crowd going
  // to church at the bell and out again: the schedules walk them; the scene is
  // who of them is near (refreshed at every look, gone with nobody).
  shift: { anywhere: true, start: (c, slot) => ride(c, slot, 'shift', w => w.species === 'watchman' && w.phase === 'go' && ['post', 'barracks', 'patrol'].includes(w.entry?.act)) },
  church: { anywhere: true, start: (c, slot) => ride(c, slot, 'church', w => w.entry?.act === 'church' && w.mode !== 'indoors') },

  // A drunk weaves out of the inn and home (npc.js stagger), however long
  // that takes (DRUNK_MAX at most).
  drunk: {
    range: 30, outlives: true,
    start(c, slot) {
      const { run } = c
      if (running(run, slot.k) || run.drunkDay === run.day) return
      const inn = run.cc.city.doors.find(d => d.kind === 'inn')
      const door = spotW(run, 'inn-door')
      if (!inn || !door || cheb(door.X, door.Y, c.PX, c.PY) > c.R + 4) return
      const w = [...run.people.values()].find(p => p.mode === 'indoors' && p.door === inn.label && p.person.home !== inn.label && p.person.job !== 'server' && p.person.home && castable(run, p))
      if (!w) return
      run.drunkDay = run.day   // one a night
      const home = run.cc.doorOf.get(w.person.home)
      const sc = open(c, slot, 'drunk', door, { say: 1 })
      cast(run, sc, w, { how: 'route', spot: toWorld(home), door: w.person.home, goalKey: `d:${w.person.home}` })
    },
    step(c, sc, dt) {
      const { run } = c
      const w = member(run, sc, sc.cast[0])
      if (!w) { end(run, sc); return }
      if (w.mode === 'indoors' || sc.t > DRUNK_MAX) { end(run, sc); return }   // home (or given up on)
      if (w.mode !== 'near') return
      if (!onFeet(w)) { end(run, sc); return }
      sc.at.x = w.X; sc.at.y = w.Y
      if ((sc.say -= dt) <= 0) { sc.say = DRUNK_SAY; sceneSay(c.state, w.entity, DRUNK_LINES[hashInt(run.seed, run.day, sc.t * 10 | 0, 981) % DRUNK_LINES.length]) }
    },
    end(run, sc) {
      // home: in for the night (the schedule's last entry, home, without walking out again)
      const w = member(run, sc, sc.cast[0])
      if (!w || w.mode !== 'indoors') return
      const last = w.sched.length - 1
      if (w.sched[last].act === 'home' && w.sched[last].where.door === w.person.home) { w.scene = null; setEntry(run.cc, w, last) }
    },
  },

  // The townsfolk gather round the stocks while the player sits in them, and
  // every TURNIP_EVERY one of those standing there throws a turnip (harmless;
  // stepTurnips lands them).
  gawk: {
    anywhere: true, outlives: true,
    start(c) {
      const { run, state } = c
      const seated = run.crime?.level === 'stocks' && state.player.stocks?.seated
      let sc = run.scenes.find(s => s.id === 'gawk' && !s.done)
      if (!seated) { if (sc) end(run, sc); return }
      const stocks = spotW(run, 'stocks')
      if (!sc) sc = open(c, null, 'gawk', stocks, { ring: ringRound(c, stocks), turnipT: TURNIP_EVERY, thrown: 0 })
      if (sc.cast.length >= GAWKERS) return
      const taken = new Set(sc.cast.map(id => run.people.get(id)?.scene?.k))
      if (taken.size >= sc.ring.length) return
      const more = []
      for (const w of run.people.values()) if (castable(run, w, { near: true })) more.push({ w, d: cheb(w.X, w.Y, stocks.X, stocks.Y) })
      more.sort((a, b) => a.d - b.d)
      for (const { w } of more) {
        if (sc.cast.length >= GAWKERS) break
        let k = 0
        while (taken.has(k)) k++
        if (k >= sc.ring.length) break
        taken.add(k)
        cast(run, sc, w, { spot: sc.ring[k], k, facing: faceTo(sc.ring[k].X, stocks.X) })
      }
    },
    step(c, sc, dt) {
      const { run } = c
      const crowd = []
      for (const w of members(run, sc)) if (onFeet(w)) crowd.push(w); else drop(run, sc, w)
      if ((sc.turnipT -= dt) > 0) return
      const ready = crowd.filter(w => w.scene.there)
      if (!ready.length) return
      sc.turnipT = TURNIP_EVERY
      const w = ready[++sc.thrown % ready.length]
      run.fx.turnips.push({ fromX: w.X, fromY: w.Y, toX: sc.at.x, toY: sc.at.y, t: 0 })
    },
    end(run) { run.fx.turnips.length = 0 },
  },
}

// A scene that rides on the schedules: the near people the test picks.
function ride(c, slot, id, test) {
  const { run } = c
  let sc = running(run, slot.k)
  const cast = []
  for (const w of run.people.values()) if (w.mode === 'near' && !w.out && !w.hunt && test(w)) cast.push(w.id)
  if (!cast.length) { if (sc) end(run, sc); return }
  if (!sc) {
    const at = id === 'church' ? spotW(run, 'church-steps') : spotW(run, 'barracks-door')
    sc = open(c, slot, id, at)
  }
  sc.cast = cast
  const lead = run.people.get(cast[0])
  sc.at.x = lead.X; sc.at.y = lead.Y
}



function lampSeen(c, i) {
  const l = c.run.cc.city.lamps[i]
  return cheb(l.x + OX, l.y + OY, c.PX, c.PY) <= c.R
}

// Lamps not left to the lamplighter (a round under way near the player, him on
// it) follow the clock.
function lampsByClock(c) {
  const { run } = c
  const things = thingsOf(run.cc), lit = run.lights.lit
  const round = run.scenes.some(s => s.id === 'lamps' && !s.done && run.people.get(s.cast[0])?.mode === 'near')
  for (let i = 0; i < lit.length; i++) {
    const due = lampDue(things, i, run.frac)
    if (lit[i] !== due && !(round && lampSeen(c, i))) lit[i] = due
  }
}

// The washing lines. Out of sight a line follows the clock (out in the
// morning, in at dusk, on a washing day). In sight it changes only by hand:
// in the washing slot someone near walks to each line still to be seen to
// (from the slot's start, so most get there in time) and changes it when
// they have stood there a moment; with nobody about it waits. line.by is who
// did it last (null: the clock).
function washingByClock(c, slots) {
  const { run } = c
  const things = thingsOf(run.cc)
  const washday = scenesForDay(run.seed, run.day).has('washing')
  const slot = slots.find(s => s.id === 'washing')
  let busy = run.scenes.reduce((n, s) => n + (s.id === 'washing' && !s.done ? 1 : 0), 0)
  run.fx.washing.forEach((line, j) => {
    if (run.scenes.some(s => s.id === 'washing' && s.line === j && !s.done)) return
    if (cheb(line.X, line.Y, c.PX, c.PY) > c.R) {
      // (what a hand did today ahead of the clock stands: hung out this morning, taken in this evening)
      const due = washDue(washday, run.seed, run.day, j, run.frac)
      const handPhase = run.frac >= WASH_OUT[0] && run.frac < WASH_IN[0] ? 'out' : 'in'
      if (line.state !== due && !(line.by && line.byDay === run.day && line.state === handPhase)) { line.state = due; line.by = null }
      return
    }
    if (!slot || line.state === slot.phase || busy >= WASHERS) return
    let who = null, wd = 15
    for (const w of run.people.values()) {
      if (w.person.age !== 'adult' || !castable(run, w, { near: true })) continue
      const d = cheb(w.X, w.Y, line.X, line.Y)
      if (d < wd) { who = w; wd = d }
    }
    if (!who) return
    const stand = toWorld(things.lines[j].stand)
    const sc = open(c, slot, 'washing', stand, { line: j, to: slot.phase, cool: 30 })
    cast(run, sc, who, { how: 'route', spot: stand, goalKey: `${sc.key}:line`, facing: 'east', t: 0 })
    busy++
  })
}
