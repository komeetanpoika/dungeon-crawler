// Kalevanlinna at play: the runtime that owns every townsperson, watchman and
// town animal while a city piece is in the window. No DOM and no game.js
// import: game.js passes its own hooks.
//
//   hooks = { spawn(spawns) -> entities, clock() -> seconds, day() -> integer,
//             viewHalf() -> { w, h } in tiles, sfx(name, pos), hurt(target, amount, from),
//             now?() -> ms }
//
// `now` (the game passes performance.now) lets the route requests of a frame
// stop once ROUTE_MS is spent. Without it the budget is ROUTES_PER_TICK alone,
// so tests and the headless tools run the same however loaded the machine is.
//
// Everyone is in exactly one of three modes (R1):
//   near     within the near radius (the visible half-width + 6 tiles): an npc
//            entity (cityKey = their id) whose goals walk their day; the
//            runtime moves e.city.next along their route (npc.js follow_city)
//   far      a record walking its route at FAR_SPEED, no collision, no reactions
//   indoors  inside a door, until the schedule's next entry brings them out
// Far turns near where the walker stands, near turns far where the entity
// stood (2 tiles of slack, so the edge does not flicker). Positions are kept
// in world tiles here, never window tiles: shiftState moves the entities on a
// re-centre and nothing in the runtime. An entity that vanished (a re-centre
// dropped its piece) is far again at its last tracked position; a city entity
// the runtime does not own is removed: nobody exists twice.
//
// With no city piece in the window the runtime is dropped whole, and coming
// back puts everyone where the clock says (the schedules are pure in the
// seed and the day). state.cityRun is never saved.
//
// The watch: a near watchman's foe (e.city.foe) is the nearest hostile the
// city keeps out within POST_GUARD tiles of his post, or standing inside the
// walls within WARD_GUARD tiles of him; npc.js defend fights it through
// hooks.hurt (kept on the run for it). The old shift keeps a post until its
// relief stands there.
//
// The law (law.js): the player's violence, the hunters it sets on them and
// the stocks. The scenes (scenes.js): the set pieces cast from the near
// people, the crowd round the stocks among them. What the screen shows of the
// town's light and small life (fx.js): lamps, lit windows, smoke, sparks,
// the tiles that change, the birds. A hunter (w.hunt) or one in
// a scene (w.scene) is out of their day until let go; then the schedule takes
// them back.
//
//   state.cityRun = { people: Map<id, Walker>, animals: Map<id, Animal>, hooks,
//                     crime, scenes, lights, fx, nearR, swingAt, stats, linesKey, ox, oy, ... }
//   e.city = { next: window tile | null, entry, person, passed, foe, lost, lostT, scene, talk, say, carry }
//   w.lines / e.lines   what they say to the player now (lines.js linesFor, kept by keepLines)
import { cityFor } from './build.js'
import { isCityPiece } from './geometry.js'
import { scheduleFor, entryAt, DAY } from './schedule.js'
import { linesFor, moodKey } from './lines.js'
import { WIN, WIN_TILES } from '../window.js'
import { PIECE } from '../layout.js'
import { TILE } from '../../systems/entities.js'
import { speakFrom, BUBBLE_DUR } from '../../systems/feedback.js'
import { isWarded } from '../../systems/ward.js'
import { DAY_LENGTH } from '../../data/weather.js'
import {
  FAR_SPEED, cityCtx, makeWalker, setEntry, routeWalker, placeByClock, stepFar, advance, lastWaypoint,
  cityToWorld, CITY_OX as OX, CITY_OY as OY,
} from './walkers.js'
import { makeAnimals } from './animals.js'
import { makeCrime } from './crime.js'
import { tickLaw, rouseEntity, cityMercy, carryCrime, bringCrime } from './law.js'
import { makeStage, tickScenes, sceneStep, endScenes } from './scenes.js'
import { makeFx, tickCityFx } from './fx.js'
import { tickAmbience } from './ambience.js'

export { FAR_SPEED }
const S = 32
const HYSTERESIS = 2        // tiles beyond the near radius before a near person turns far
const MAX_NEAR = 50         // the window reaches 56 tiles past a player 24 tiles into a city piece
const REACH = 0.6           // tiles from a waypoint that count as reaching it
export const ROUTES_PER_TICK = 8   // route requests served a frame (the bell sends half the town at once)
const ROUTE_MS = 1          // ... and the time they may take, after the first
const PLACE_PER_TICK = 12   // people placed by the clock a frame, when the city comes into the window on a walk
const REROUTE_AFTER = 4     // s a near walker may make no headway before it is routed again
const DRIFT = 10            // tiles from its next waypoint before a near walker is routed again
const SHY_REACH = 3         // tiles from a swing that make a townsperson step back
const SHY_TIME = 1.5        // s spent stepping back
const SHY_SAY_EVERY = 4     // s between two 'Careful with that!'
const SHY_LINE = 'Careful with that!'
const POST_GUARD = 6        // tiles from his post within which a watchman on duty there takes on a hostile, in the walls or out
const WARD_GUARD = 12       // tiles from a watchman within which he takes on a hostile standing inside the walls
const FOE_SLACK = 2         // tiles beyond POST_GUARD before a foe at the gate is let go (so the edge does not flicker)
const HOLD_MAX = 0.25       // of the day: the longest the old shift keeps a post waiting for its relief
const PAIR_GAP = 1.5        // tiles a patrolman may get ahead of his partner along their route before he waits for him
const PAIR_CLOSE = 1        // ... and how near his partner comes before he walks on (a step behind, as they walk)
const PAIR_WAIT_MAX = 8     // s the longest he waits (a partner who is not coming)

export const nearRadius = view => Math.min(MAX_NEAR, Math.ceil(Math.max(view.w, view.h)) + 6)

// What the town says to the player (lines.js): day or night, and wary of a
// warned or wanted player. Every walker's lines (w.lines, and its entity's)
// follow the mood: asked anew whenever what they depend on changes.
const nightAt = frac => frac >= DAY.night || frac < DAY.dawn
export const moodOf = run => ({ night: nightAt(run.frac), crime: run.crime.level })
function keepLines(run) {
  const night = nightAt(run.frac), crime = run.crime.level
  if (night === run.linesNight && crime === run.linesCrime) return   // every frame: nothing new
  run.linesNight = night; run.linesCrime = crime
  const mood = { night, crime }, key = moodKey(mood)
  if (key === run.linesKey) return
  run.linesKey = key
  for (const w of run.people.values()) {
    w.lines = linesFor(w.person, mood)
    if (w.entity) w.entity.lines = w.lines
  }
}

// Is any city piece in the window?
function cityInWindow(world) {
  const o = world.origin
  if (!o) return false
  for (let r = 0; r < WIN; r++) for (let c = 0; c < WIN; c++) if (isCityPiece(o.wx + c, o.wy + r)) return true
  return false
}

const fracOf = clock => (((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH

// `lazy`: the city came into the window on a walk (the player is then a piece
// away, out of reach of the near radius): people are placed by the clock a
// few a frame instead of all in the frame of the re-centre.
function makeRun(state, world, hooks, lazy) {
  const city = cityFor(world.seed)
  const cc = cityCtx(city, world.seed)
  const day = hooks.day(), frac = fracOf(hooks.clock())
  const run = {
    seed: world.seed, cc, people: new Map(), animals: new Map(), hooks,
    crime: makeCrime(), ...makeStage(cc, world.seed, day, frac),
    nearR: nearRadius(hooks.viewHalf()), day, frac, swingAt: null, shyT: 0,
    queue: [], pending: [], tick: 0, remove: new Set(), stats: { noRoute: [], rerouted: 0 },
  }
  // patrol pairs walk side by side: the second of each pair keeps a step to its
  // partner's right, and each knows the other (waitsForPartner)
  const pairs = new Map()
  cc.folk.forEach((p, n) => {
    const w = makeWalker(cc, p, n)
    if (p.patrol) {
      const k = `${p.shift}:${p.patrol}`, first = pairs.get(k)
      w.side = first ? 1 : 0
      if (first) { w.partner = first; first.partner = w } else pairs.set(k, w)
    }
    run.people.set(p.id, w)
    if (lazy) { w.pending = true; run.pending.push(w); return }
    w.sched = scheduleFor(p, city, world.seed, day); w.day = day
    placeByClock(cc, w, frac, run.stats)
  })
  // the day and night man of a post relieve each other
  const byPost = new Map()
  for (const w of run.people.values()) {
    const post = w.person.post
    if (!post) continue
    const o = byPost.get(post)
    if (o && o.person.shift !== w.person.shift) { o.relief = w; w.relief = o } else byPost.set(post, w)
  }
  if (!lazy) holdPosts(run, frac)
  for (const a of makeAnimals(cc)) run.animals.set(a.id, a)
  makeFx(run)
  keepLines(run)
  return run
}

// a post watchman standing at his post
const atPost = w => w.mode !== 'indoors' && !w.out && w.phase === 'there' && w.entry?.act === 'post'

// The schedule sends the old shift home when its relief sets out, but the
// walk from the barracks to a far gate takes longer than that: the old shift
// keeps the post until the relief stands there (or HOLD_MAX has passed, or
// the relief was struck down).
function keepsPost(w, nx, frac) {
  const r = w.relief
  if (!r || w.entry?.act !== 'post' || nx.act === 'post' || r.out || frac - nx.at >= HOLD_MAX) return false
  return r.pending || !atPost(r)
}

// After everyone was placed by the clock: an old shift the schedule has on
// its way home is put back at the post while its relief is not there yet, as
// if it had waited (keepsPost then holds it there).
function holdPosts(run, frac) {
  for (const w of run.people.values()) {
    const r = w.relief
    if (!r || w.out || w.pending || w.hunt || w.mode === 'near' || r.out || atPost(r)) continue
    if (w.entry.act === 'post' || w.sched[w.ei - 1]?.act !== 'post' || frac - w.entry.at >= HOLD_MAX) continue
    placeByClock(run.cc, w, w.entry.at - 1e-6, run.stats)
  }
}

// Make sure every person is an entity, a far walker or indoors, never two.
// Idempotent; call after every enterWilds, re-centre and respawn (`fresh`
// for a window built anew: a load, a wake after death).
export function arriveCity(state, world, hooks, { fresh = false } = {}) {
  if (!cityInWindow(world)) { carryCrime(state, nowOf(hooks)); dropCity(state); return }
  if (fresh || !state.cityRun || state.cityRun.seed !== world.seed) {
    dropCity(state)
    state.cityRun = makeRun(state, world, hooks, !fresh)
    // a warning or the wanted taken along on a walk comes back with the town; a load or a wake drops it
    if (fresh) delete state.cityAway
    else bringCrime(state, state.cityRun, nowOf(hooks))
  }
  // the watch takes a wanted player alive (damagePlayer asks)
  state.mercy = cityMercy
  const run = state.cityRun
  run.hooks = hooks
  reconcile(state, world, run)
  run.nearR = nearRadius(hooks.viewHalf())
  keepLines(run)
  modes(state, world, run, hooks)
  flush(state, run)
  tickCityFx(state, run, 0, world.origin.wx * PIECE, world.origin.wy * PIECE)
}

function dropCity(state) {
  if (state.entities?.some(e => e.cityKey !== undefined)) state.entities = state.entities.filter(e => e.cityKey === undefined)
  delete state.cityRun
  delete state.mercy
}

// seconds since the world's first day began: the clock the time away is counted by
const nowOf = hooks => hooks.day() * DAY_LENGTH + hooks.clock()

// Every city entity in state.entities must be the one its walker holds, and
// every near walker's entity must still be there. Fire and the shockwave hand
// back a copy of a body they hurt ({ ...e, hp }) in its place: a copy whose
// walker's entity is gone is the same person, taken on. A near entity gone
// altogether went with a piece that left the window, if it stood outside the
// window now; one gone from inside the window was struck down and culled.
function reconcile(state, world, run) {
  const seen = ++run.tick
  let loose = null
  for (const e of state.entities) {
    if (e.cityKey === undefined) continue
    const w = run.people.get(e.cityKey) ?? run.animals.get(e.cityKey)
    if (w && w.mode === 'near' && w.entity === e) e._citySeen = seen
    else (loose ??= []).push(e)
  }
  let strays = null
  if (loose) for (const e of loose) {
    const w = run.people.get(e.cityKey) ?? run.animals.get(e.cityKey)
    if (w && w.mode === 'near' && w.entity._citySeen !== seen) { w.entity = e; e._citySeen = seen; continue }
    (strays ??= new Set()).add(e)
  }
  if (strays) state.entities = state.entities.filter(e => !strays.has(e))
  const ox = world.origin.wx * PIECE, oy = world.origin.wy * PIECE
  const inWindow = w => {
    const x = Math.floor(w.X + 0.5) - ox, y = Math.floor(w.Y + 0.5) - oy
    return x >= 0 && y >= 0 && x < WIN_TILES && y < WIN_TILES
  }
  const check = w => {
    if (w.mode !== 'near' || w.entity._citySeen === seen) return
    if (w.entity.hp <= 0 || inWindow(w)) { knockedDown(run, w); return }
    w.entity = null; w.mode = 'far'   // gone with a piece that left: on from where it last stood
  }
  for (const w of run.people.values()) check(w)
  for (const a of run.animals.values()) check(a)
}

// Struck down (and culled by the game): a person is at home until the next
// day, an animal gone until then. What else follows is for the city's rules.
function knockedDown(run, w) {
  if (w.entity?.hp > 0) run.remove.add(w.entity)
  w.entity = null
  w.hunt = false; w.scene = null
  if (w.animal) { w.mode = 'far'; w.gone = true; return }
  // a route on order must not walk them anywhere; no home door (a city with
  // no barracks for the watch) leaves them out of sight all the same
  w.out = true; w.mode = 'indoors'; w.door = w.person.home ?? null; w.path = null; w.shy = null; w.needRoute = false
}

// Once per surface frame, beside the tales.
export function tickCity(state, world, delta, hooks) {
  const run = state.cityRun
  if (!run || !world.origin) return
  const { cc } = run
  run.hooks = hooks
  reconcile(state, world, run)
  const day = hooks.day(), frac = fracOf(hooks.clock())
  run.nearR = nearRadius(hooks.viewHalf())
  // a new day (or a clock that wrapped with no day counted: the same day again)
  if (day !== run.day || frac + 0.5 < run.frac) newDay(run, day, frac)
  run.frac = frac
  const ox = world.origin.wx * PIECE, oy = world.origin.wy * PIECE

  if (run.pending.length) {
    for (let k = 0; k < PLACE_PER_TICK && run.pending.length; k++) {
      const w = run.pending.pop()
      w.sched = scheduleFor(w.person, cc.city, run.seed, run.day); w.day = run.day
      placeByClock(cc, w, frac, run.stats)
      w.pending = false
    }
    if (!run.pending.length) holdPosts(run, frac)
  }
  if (run.swingAt) shy(state, run, ox, oy)
  run.shyT = Math.max(0, run.shyT - delta)
  // routes on order: a few a frame, and (with a timer) no more once a
  // millisecond is spent (a patrol pair crossing the town asks for two long ones at once)
  const now = hooks.now, t0 = now ? now() : 0
  for (let k = 0; k < ROUTES_PER_TICK && run.queue.length && (k === 0 || !now || now() - t0 < ROUTE_MS); k++) {
    const w = run.queue.shift()
    if (!w.needRoute || w.out) continue
    if (routeWalker(cc, w, run.stats) === 'indoors' && w.entity) { run.remove.add(w.entity); w.entity = null }
  }

  for (const w of run.people.values()) {
    if (w.out || w.pending) continue
    // the schedule moved on (a hunter or one held in a scene catches up when let go)
    const nx = w.sched[w.ei + 1]
    if (nx && frac >= nx.at && !w.hunt && !(w.scene && !w.scene.day) && !keepsPost(w, nx, frac)) {
      setEntry(cc, w, entryAt(w.sched, frac))
      if (w.needRoute) run.queue.push(w)
      if (w.entity) w.entity.city.entry = w.entry
    }
    if (w.mode === 'near') {
      const say = w.entity.city.say
      if (say && say.t < (say.dur ?? BUBBLE_DUR)) say.t += delta   // a scene line's bubble over them stays its time
      near(state, run, w, delta, ox, oy)
    } else if (w.mode === 'far' && !waitsForPartner(w, delta)) stepFar(cc, w, delta)
  }
  guard(state, run, delta, ox, oy)
  tickLaw(state, world, run, delta)
  tickScenes(state, world, run, delta, ox, oy)
  keepLines(run)
  modes(state, world, run, hooks)
  flush(state, run)
  tickCityFx(state, run, delta, ox, oy)
  tickAmbience(state, run, delta, hooks.sfx)
}

// The watch at work. A near watchman takes on the nearest hostile the city
// keeps out (ward.js) within POST_GUARD tiles of his post, while he is on
// duty at one, inside the walls or out; or standing on a warded cell within
// WARD_GUARD tiles of him, whoever he is. He keeps it until it dies, stops
// being hostile, or is neither inside the walls nor near his post (a hostile
// inside cannot walk off warded ground, and the way round a block to it can
// be long, so the straight-line WARD_GUARD only decides whom he takes on).
// With none he goes back to his day (follow_city; one a fight drew off his
// post walks back to it, see near). A foe npc.js defend found no way to is
// left alone for its LOST_TIME (e.city.lostT, counted down here), then it
// may be taken on again like any other. Far and indoor watchmen fight
// nothing, and the player is never a foe here.
function guard(state, run, delta, ox, oy) {
  let foes = null
  for (const f of state.entities) if (f.hp > 0 && f.px !== undefined && isWarded(f)) (foes ??= []).push(f)
  for (const w of run.people.values()) {
    if (w.mode !== 'near' || w.species !== 'watchman') continue
    const e = w.entity, c = e.city
    if (w.hunt) { c.foe = null; continue }   // after the player (law.js)
    if (c.lost && (c.lostT -= delta) <= 0) { c.lost = null; c.lostT = 0 }
    const foe = foes ? foeOf(state, run, w, e, foes, ox, oy) : null
    if (foe) w.fought = true
    e.city.foe = foe
  }
}

function foeOf(state, run, w, e, foes, ox, oy) {
  const post = w.entry?.act === 'post' ? run.cc.city.spots[w.entry.where.spot] : null
  const px = post ? post.x + OX - ox : 0, py = post ? post.y + OY - oy : 0
  const fromPost = f => post ? Math.max(Math.abs(f.px / S - 0.5 - px), Math.abs(f.py / S - 0.5 - py)) : Infinity
  const inside = f => !!state.map[f.y]?.[f.x]?.ward
  const cur = e.city.foe
  if (cur && foes.includes(cur) && (inside(cur) || fromPost(cur) <= POST_GUARD + FOE_SLACK)) return cur
  const ex = e.px / S - 0.5, ey = e.py / S - 0.5
  let best = null, bestD = Infinity
  for (const f of foes) {
    if (f === e.city.lost) continue
    const d = Math.max(Math.abs(f.px / S - 0.5 - ex), Math.abs(f.py / S - 0.5 - ey))
    if (d >= bestD) continue
    if (fromPost(f) <= POST_GUARD || (d <= WARD_GUARD && inside(f))) { best = f; bestD = d }
  }
  return best
}

// A new day: everyone's schedule for it. At midnight the place is the same
// (home, or the night watch's post), so nobody moves; the knocked out are back.
function newDay(run, day, frac) {
  const { cc } = run
  run.day = day
  endScenes(run, null, 'gawk')   // a new day's timetable (the stocks' crowd stays while the stocks are taken)
  for (const w of run.people.values()) {
    if (w.pending) continue   // placed by the new day's schedule when its turn comes
    w.sched = scheduleFor(w.person, cc.city, run.seed, day); w.day = day
    if (w.out) {
      if (w.entity) { run.remove.add(w.entity); w.entity = null }
      w.out = false
      placeByClock(cc, w, frac, run.stats)
      continue
    }
    if (w.hunt || w.scene) continue   // the new day's schedule takes them back when let go
    w.ei = 0
    setEntry(cc, w, entryAt(w.sched, frac))
    if (w.needRoute) run.queue.push(w)
    if (w.entity) w.entity.city.entry = w.entry
  }
  for (const a of run.animals.values()) a.gone = false
}

const setNext = (e, x, y) => {
  const c = e.city
  if (c.next) { c.next.x = x; c.next.y = y } else c.next = { x, y }
}

// How far along his patrol route a patrolman stands, in tiles from its first
// waypoint: on the segment he walks towards waypoint wi on, not held to it (a
// waypoint counts as reached up to REACH early, so he may still stand short
// of the segment he is on).
const routeLengths = new WeakMap()
function alongRoute(w) {
  const p = w.path
  let cum = routeLengths.get(p)
  if (!cum) {
    cum = [0]
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y))
    routeLengths.set(p, cum)
  }
  const i = Math.max(0, Math.min(p.length - 2, w.dir === 1 ? w.wi - 1 : w.wi))
  const a = p[i], b = p[i + 1], len = cum[i + 1] - cum[i]
  const x = w.X - OX - a.x, y = w.Y - OY - a.y
  return cum[i] + (len ? (x * (b.x - a.x) + y * (b.y - a.y)) / len : 0)
}

// A patrol pair keeps together. The one who got ahead along the route (a
// passer-by held the other back) waits until his partner draws level, but no
// longer than PAIR_WAIT_MAX at a time. Only while both walk the same way: at
// a turn, one turned and the other not yet, neither waits (each turns up to
// REACH short of the end, so the gap there means little). True while he waits.
function waitsForPartner(w, dt) {
  const q = w.partner
  const walking = v => v.loop && !!v.path && !v.hunt && !v.scene && !v.out && v.mode !== 'indoors'
  if (!q || !walking(w) || !walking(q) || q.path !== w.path || q.dir !== w.dir || w.path.length < 2) {
    w.pairWait = 0; w.pairGaveUp = false; return false
  }
  const gap = (alongRoute(w) - alongRoute(q)) * w.dir
  if (gap <= (w.pairWait > 0 ? PAIR_CLOSE : PAIR_GAP)) { w.pairWait = 0; w.pairGaveUp = false; return false }
  if (w.pairGaveUp) return false
  w.pairWait = (w.pairWait ?? 0) + dt
  if (w.pairWait > PAIR_WAIT_MAX) { w.pairWait = 0; w.pairGaveUp = true; return false }
  return true
}

// A near walker: read where its entity stands, take it through its route.
function near(state, run, w, dt, ox, oy) {
  const e = w.entity
  if (e.hp <= 0) { knockedDown(run, w); return }
  w.X = e.px / S - 0.5 + ox; w.Y = e.py / S - 0.5 + oy
  const c = e.city
  if (w.hunt) return   // the enemy brain drives a hunter (law.js)
  if (w.shy) {
    w.shy.t -= dt
    if (w.shy.t > 0 && Math.hypot(w.shy.X - w.X, w.shy.Y - w.Y) > 0.4) { setNext(e, w.shy.X - ox, w.shy.Y - oy); return }
    w.shy = null
  }
  if (w.scene && sceneStep(run, w, e, ox, oy)) return   // standing in a scene (scenes.js)
  if (c.passed) {
    // gone round the player on the way: on to the next waypoint. A player
    // standing on the very spot they were making for: about here will do.
    c.passed = false
    if (!w.path) w.fought = false   // back from a fight to a post the player stands on
    if (w.path && (!lastWaypoint(w) || w.goal.kind === 'spot') && advance(run.cc, w) === 'there' && !w.loop) { c.next = null; return }
  }
  const walking = w.path && (w.phase === 'go' || w.loop)
  if (!walking) {
    // a watchman a fight drew off his post walks back to it
    if (w.fought && w.phase === 'there' && w.goal?.kind === 'spot') {
      const tx = w.goal.tile.x + OX, ty = w.goal.tile.y + OY
      if (Math.hypot(tx - w.X, ty - w.Y) > REACH) { setNext(e, tx - ox, ty - oy); return }
      w.fought = false
    }
    c.next = null
    if (w.scene) return   // at a scene's place: its goals stand them there
    // about a spot: potter round it (the species' wander, from here)
    if (w.phase === 'there' && !w.homed && w.goal?.kind === 'spot') {
      const t = cityToWorld(w.goal.tile)
      e.home = { x: t.X - ox, y: t.Y - oy }
      if (e.ai.goals) e.ai.goals.wander = {}
      e.ai.wanderPt = null
      w.homed = true
    }
    return
  }
  // ahead of his patrol partner: he stands and waits for him (no headway lost)
  if (waitsForPartner(w, dt)) { c.next = null; return }
  // the window tile the entity walks to: the waypoint, or for a patrol
  // partner a step to the right of the way
  const aim = () => {
    const q = w.path[w.wi]
    let nx = q.x + OX - ox, ny = q.y + OY - oy
    if (w.side) {
      const p = w.path[w.wi - w.dir] ?? q
      const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y)
      if (walkable(state.map, nx - dy, ny + dx)) { nx -= dy; ny += dx }
    }
    return { nx, ny }
  }
  let { nx, ny } = aim()
  // reached: on that tile (act walks no further within it), or near enough its middle
  if ((e.x === nx && e.y === ny) || Math.hypot(nx + ox - w.X, ny + oy - w.Y) < REACH) {
    const r = advance(run.cc, w)
    if (r === 'indoors') { run.remove.add(e); w.entity = null; return }
    if (r === 'there' && !w.loop) { c.next = null; return }
    ;({ nx, ny } = aim())
  }
  const t = { X: nx + ox, Y: ny + oy }
  setNext(e, nx, ny)
  // headway: a walker that makes none for a while, or strays far off its way, is routed again
  // (a watchman at a fight is not lost either)
  const waiting = e.ai.wait > 0 || !!e.ai.side || e.ai.fleeTimer > 0 || !!c.foe
  if (Math.hypot(w.X - w.sx, w.Y - w.sy) > 0.4) { w.sx = w.X; w.sy = w.Y; w.still = 0; w.rerouted = false }
  else if (!waiting) w.still += dt
  const stuck = w.still > REROUTE_AFTER && !w.rerouted
  const drift = !(e.ai.fleeTimer > 0) && !c.foe && Math.hypot(t.X - w.X, t.Y - w.Y) > DRIFT
  // a route that could not be found is not asked for again every frame
  w.retry = Math.max(0, (w.retry ?? 0) - dt)
  if ((stuck || drift) && !w.needRoute && w.retry <= 0) {
    if (stuck) w.rerouted = true
    w.needRoute = true; run.queue.push(w); run.stats.rerouted++
  }
}

// near <-> far by the near radius, for people and animals
function modes(state, world, run, hooks) {
  const ox = world.origin.wx * PIECE, oy = world.origin.wy * PIECE
  const px = state.player.x + ox, py = state.player.y + oy
  const R = run.nearR
  const one = w => {
    if (w.mode === 'indoors' || w.gone || w.pending) return
    const d = Math.max(Math.abs(w.X - px), Math.abs(w.Y - py))
    if (w.mode === 'near') {
      if (d > R + HYSTERESIS) { run.remove.add(w.entity); w.entity = null; w.mode = 'far' }
      else if (w.animal) { w.X = w.entity.px / S - 0.5 + ox; w.Y = w.entity.py / S - 0.5 + oy }
    } else if (d <= R) spawn(state, run, w, hooks, ox, oy)
  }
  for (const w of run.people.values()) one(w)
  for (const a of run.animals.values()) one(a)
}

const walkable = (map, x, y) => map[y]?.[x]?.tile === TILE.FLOOR
function spawn(state, run, w, hooks, ox, oy) {
  let x = Math.round(w.X) - ox, y = Math.round(w.Y) - oy
  let fx = w.X - ox, fy = w.Y - oy
  if (x < 0 || y < 0 || x >= WIN_TILES || y >= WIN_TILES) return   // beyond the window: stays far
  if (!walkable(state.map, x, y)) {
    let found = null
    for (let r = 1; r <= 2 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && walkable(state.map, x + dx, y + dy)) { found = { x: x + dx, y: y + dy }; break }
    }
    if (!found) return   // walled in: stays far this frame
    x = found.x; y = found.y; fx = x; fy = y
  }
  const [e] = hooks.spawn([{ kind: 'npc', species: w.species, id: w.id, x, y, lines: w.lines, hostile: !!w.hunt }])
  if (!e) return
  e.px = (fx + 0.5) * S; e.py = (fy + 0.5) * S
  e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
  e.cityKey = w.id
  e.look = w.look
  if (w.lines) e.lines = w.lines
  if (w.animal) {
    const h = cityToWorld(w.home)
    e.home = { x: h.X - ox, y: h.Y - oy }
  } else {
    e.city = { next: null, entry: w.entry, person: w.person, passed: false, scene: w.scene ?? null, talk: w.scene?.talk ?? null, carry: !!w.scene?.loaded }
    w.homed = false; w.sx = w.X; w.sy = w.Y; w.still = 0
    if (w.hunt) rouseEntity(e, state.player)   // one of the hunters comes near: after the player
  }
  state.entities.push(e)
  w.entity = e; w.mode = 'near'
}

function flush(state, run) {
  if (!run.remove.size) return
  const gone = run.remove
  state.entities = state.entities.filter(e => !gone.has(e))
  gone.clear()
}

// The player swung, shot or cast: game.js says so here (world tiles, so a
// re-centre before the next tick cannot misplace it).
export function noteCitySwing(state, world) {
  const run = state.cityRun
  // inside a house (a cave state carries the surface's fields) nobody outside sees it
  if (!run || state.cave || !world?.origin) return
  run.swingAt = { X: state.player.x + world.origin.wx * PIECE, Y: state.player.y + world.origin.wy * PIECE }
}

// Townsfolk within SHY_REACH tiles of a swing step back two tiles, and the
// nearest of them says so. Not violence: a flinch.
function shy(state, run, ox, oy) {
  const s = run.swingAt
  run.swingAt = null
  let speaker = null, best = Infinity
  for (const w of run.people.values()) {
    if (w.mode !== 'near' || w.species !== 'townsfolk') continue
    const d = Math.max(Math.abs(w.X - s.X), Math.abs(w.Y - s.Y))
    if (d > SHY_REACH) continue
    const to = stepBack(state.map, Math.round(w.X) - ox, Math.round(w.Y) - oy, Math.sign(Math.round(w.X) - s.X), Math.sign(Math.round(w.Y) - s.Y))
    if (to) {
      w.shy = { X: to.x + ox, Y: to.y + oy, t: SHY_TIME }
      setNext(w.entity, to.x, to.y)
    }
    if (d < best) { best = d; speaker = w }
  }
  // never over a line still up in the one bubble: the watch's shout at the
  // blow this swing landed (law.js speaks in the swing's own frame), or
  // anyone else's
  const up = state.feedback?.bubble
  if (speaker && run.shyT <= 0 && (!up || up.text === SHY_LINE)) { speakFrom(state, speaker.entity, SHY_LINE); run.shyT = SHY_SAY_EVERY }
}
// two tiles on, away from the swing (straight, then along either axis, then one tile)
function stepBack(map, x, y, dx, dy) {
  if (!dx && !dy) dy = 1
  const tries = [[dx, dy], [dx, 0], [0, dy]].filter(([a, b]) => a || b)
  for (const n of [2, 1]) for (const [a, b] of tries) {
    let ok = true
    for (let k = 1; k <= n && ok; k++) ok = walkable(map, x + a * k, y + b * k)
    if (ok) return { x: x + a * n, y: y + b * n }
  }
  return null
}

// For tools and tests: everyone, where they are and in which mode.
export function cityPeople(state) {
  const run = state.cityRun ?? state.cave?.surface?.cityRun
  if (!run) return []
  const out = []
  for (const w of run.people.values()) out.push({
    id: w.id, mode: w.mode, X: w.X, Y: w.Y, door: w.mode === 'indoors' ? w.door : null,
    entry: w.ei, act: w.entry?.act ?? null, going: w.mode !== 'indoors' && w.phase === 'go', there: w.phase === 'there',
    goal: w.goal?.kind ?? null, still: w.still, out: w.out, pending: !!w.pending, hunt: !!w.hunt,
    scene: w.scene?.id ?? null, gawk: w.scene?.id === 'gawk',
  })
  return out
}

// Who is inside that door now (the Person records), for the house the player steps into.
export function occupantsOf(state, doorLabel) {
  const run = state.cityRun ?? state.cave?.surface?.cityRun
  if (!run) return []
  const out = []
  for (const w of run.people.values()) if (w.mode === 'indoors' && !w.out && w.door === doorLabel) out.push(w.person)
  return out
}

// Whose house that door is: the people who work behind it, then those who
// live there, in or out (the Person records; wilds/city/indoors.js takes the
// house's trade from their jobs).
export function householdOf(state, doorLabel) {
  const run = state.cityRun ?? state.cave?.surface?.cityRun
  if (!run) return []
  const work = [], home = []
  for (const w of run.people.values()) {
    if (w.person.work === doorLabel) work.push(w.person)
    else if (w.person.home === doorLabel) home.push(w.person)
  }
  return [...work, ...home]
}

// Struck down inside a house (wilds/city/indoors.js, as the player leaves
// it): out until the next day, as one struck down in the street is.
export function struckIndoors(state, id) {
  const run = state.cityRun ?? state.cave?.surface?.cityRun
  const w = run?.people.get(id)
  if (w && !w.out) knockedDown(run, w)
}
