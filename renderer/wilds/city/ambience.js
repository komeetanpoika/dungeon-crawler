// The sound of Kalevanlinna: which cues the town makes, and from where. Pure
// in its decisions: tickAmbience(state, run, delta, sfx) reads the run (the
// sources the runtime already keeps: run.people, run.animals, run.fx) and the
// player's place, and calls sfx(name, { px, py }) in window pixels, as the
// game's other positioned cues. The audio engine fades each cue with its
// distance (render/audio.js falloffGain), so the beds below (murmur, gulls,
// tavern) swell as the player nears their source without a second audio graph.
//
// Once per surface frame, after tickCityFx (runtime.js tickCity). Only
// sources within NEAR_TILES of the player sound at all, and each rate-limits
// itself:
//   city-murmur  a train of short low puffs from the square and from the
//                market street, nearest point of each to the player; every
//                1.6/sqrt(n) s for n people out in it (at most one in 0.35 s),
//                none from an empty one; people indoors are not counted
//   hammer       at the anvil on each new blow of the smith (fx.smithy.blows);
//                sizzle at the forge as he starts to quench
//   gull         at the harbour by day, one cry every 2 to 7 s
//   bell         the church bell: a peal of TOLLS tolls, TOLL_EVERY s apart,
//                from the belltower, starting when fx.bell turns on
//   crier-bell   at the crier on each ring of his hand bell (fx.crier.rings)
//   wings        at a flock when it lifts (the flock's `lifts` counts up)
//   bark         from the nearest dog out in the street, every 4 to 11 s, every
//                1.5 to 3.5 s while a flock near it is up
//   tavern       at the inn door at night while someone is in the inn,
//                every 1.5/sqrt(n) s (at least 0.5 s)
//   boots        every 0.5 s from the nearest watchman walking a patrol
// Nothing sounds indoors (state.cave): the street is not heard and the clock
// stops there anyway.
//
// The run carries a little for it, run.amb (timers, the counts of the last
// look at the people, what it has already heard of the fx). The people are
// looked over every LOOK_EVERY s, not every frame.
import { hash } from '../rand.js'
import { PLAN } from './plan.js'
import { DAY } from './schedule.js'
import { CITY_OX as OX, CITY_OY as OY } from './walkers.js'

const S = 32
export const NEAR_TILES = 20          // sources further off than this are silent
export const TOLLS = 3                // tolls in a peal of the church bell
export const TOLL_EVERY = 2.5         // s between tolls
const LOOK_EVERY = 0.25               // s between looks at the people
const BOOTS_EVERY = 0.5
const MURMUR_MIN = 0.35, MURMUR_K = 1.6, CROWD_CAP = 20
const CHASE_R = 5                     // tiles: a flock up this close to a dog sets it barking more

const P = PLAN.places
// the areas that murmur (city tiles, inclusive) and the harbour the gulls keep to
const MURMURS = [
  { id: 0, rect: P.square },
  { id: 1, rect: { x0: 76, y0: 24, x1: 84, y1: 58 } },   // the market street and its stalls
]
const HARBOUR = { x0: 56, y0: 97, x1: 104, y1: 130 }
const BELL_AT = { X: (P.belltower.x0 + P.belltower.x1) / 2 + OX, Y: (P.belltower.y0 + P.belltower.y1) / 2 + OY }
const INN_AT = { X: P.inn.door.x + OX, Y: P.inn.door.y + OY }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1

function makeAmb() {
  return {
    k: 0, look: 0, counts: [0, 0], inn: 0, boots: null,
    murmurT: [0, 0], gullT: 2, tavernT: 0, bootsT: 0, barkT: 3, dog: null, chase: false,
    tolls: 0, tollT: 0, bellOn: false,
    sm: null, blows: 0, smState: null, crier: null, rings: 0, lifts: [],
  }
}

export function tickAmbience(state, run, delta, sfx) {
  if (state.cave) return
  const a = (run.amb ??= makeAmb())
  const PX = state.player.px / S - 0.5 + run.ox, PY = state.player.py / S - 0.5 + run.oy
  const near = (X, Y) => Math.hypot(X - PX, Y - PY) <= NEAR_TILES
  const say = (name, X, Y) => sfx(name, { px: (X - run.ox + 0.5) * S, py: (Y - run.oy + 0.5) * S })
  const jit = (salt) => hash(run.seed, a.k++, salt, 18)    // 0..1, the same replay for a seed
  const frac = run.frac, fx = run.fx

  if ((a.look -= delta) <= 0) { a.look = LOOK_EVERY; lookOver(run, a, PX, PY, near) }

  // the crowd's murmur
  for (const m of MURMURS) {
    const n = a.counts[m.id]
    if (n <= 0) { a.murmurT[m.id] = 0; continue }
    a.murmurT[m.id] -= delta
    if (a.murmurT[m.id] > 0) continue
    const X = clamp(PX, m.rect.x0 + OX, m.rect.x1 + OX), Y = clamp(PY, m.rect.y0 + OY, m.rect.y1 + OY)
    a.murmurT[m.id] = Math.max(MURMUR_MIN, MURMUR_K / Math.sqrt(Math.min(n, CROWD_CAP))) * (0.7 + 0.6 * jit(1))
    if (near(X, Y)) say('city-murmur', X, Y)
  }

  // the smith
  const sm = fx.smithy
  if (sm !== a.sm) { a.sm = sm; a.blows = sm?.blows ?? 0; a.smState = sm?.state ?? null }
  if (sm) {
    if (sm.blows !== a.blows) { a.blows = sm.blows; if (near(sm.X, sm.Y)) say('hammer', sm.X, sm.Y) }
    if (sm.state !== a.smState) {
      if (sm.state === 'quenching' && near(sm.X, sm.Y)) say('sizzle', sm.X, sm.Y)
      a.smState = sm.state
    }
  }

  // gulls at the harbour, by day
  if (frac >= DAY.dawn && frac < DAY.dusk) {
    if ((a.gullT -= delta) <= 0) {
      a.gullT = 2 + 5 * jit(2)
      const X = clamp(PX, HARBOUR.x0 + OX, HARBOUR.x1 + OX), Y = clamp(PY, HARBOUR.y0 + OY, HARBOUR.y1 + OY)
      if (near(X, Y)) say('gull', X, Y)
    }
  }

  // the church bell: a peal of tolls from the moment it begins
  if (fx.bell && !a.bellOn) { a.tolls = TOLLS; a.tollT = 0 }
  a.bellOn = !!fx.bell
  if (a.bellOn && a.tolls > 0 && (a.tollT -= delta) <= 0) {
    a.tolls--; a.tollT = TOLL_EVERY
    if (near(BELL_AT.X, BELL_AT.Y)) say('bell', BELL_AT.X, BELL_AT.Y)
  }
  if (!a.bellOn) a.tolls = 0

  // the crier's hand bell
  const cr = fx.crier
  if (cr !== a.crier) { a.crier = cr; a.rings = cr?.rings ?? 0 }
  if (cr && cr.rings !== a.rings) { a.rings = cr.rings; if (near(cr.X, cr.Y)) say('crier-bell', cr.X, cr.Y) }

  // pigeons and gulls lifting
  const flocks = fx.flocks
  for (let i = 0; i < flocks.length; i++) {
    const f = flocks[i]
    if (a.lifts[i] === undefined) a.lifts[i] = f.lifts
    if (f.lifts !== a.lifts[i]) { a.lifts[i] = f.lifts; if (near(f.X, f.Y)) say('wings', f.X, f.Y) }
  }

  // a dog barks now and then, more when it has birds to run at
  if (a.dog) {
    if ((a.barkT -= delta) <= 0) {
      a.barkT = a.chase ? 1.5 + 2 * jit(3) : 4 + 7 * jit(3)
      say('bark', a.dog.X, a.dog.Y)
    }
  }

  // the inn at night
  const night = frac >= DAY.night || frac < DAY.dawn
  if (night && a.inn > 0) {
    if ((a.tavernT -= delta) <= 0) {
      a.tavernT = Math.max(0.5, 1.5 / Math.sqrt(a.inn)) * (0.7 + 0.6 * jit(4))
      if (near(INN_AT.X, INN_AT.Y)) say('tavern', INN_AT.X, INN_AT.Y)
    }
  }

  // a patrol's boots
  if (a.boots) {
    if ((a.bootsT -= delta) <= 0) { a.bootsT = BOOTS_EVERY; say('boots', a.boots.X, a.boots.Y) }
  }
}

// The slow look: how many are out in each murmuring area, who is in the inn,
// the nearest patrol walking and the nearest dog out in the street.
function lookOver(run, a, PX, PY, near) {
  const counts = a.counts
  counts[0] = counts[1] = 0
  a.inn = 0
  let boots = null, bd = Infinity
  const innLabel = run.cc.city.doors.find(d => d.kind === 'inn')?.label
  for (const w of run.people.values()) {
    if (w.out || w.pending) continue
    if (w.mode === 'indoors') { if (innLabel && w.door === innLabel) a.inn++; continue }
    const cx = Math.floor(w.X + 0.5) - OX, cy = Math.floor(w.Y + 0.5) - OY
    for (const m of MURMURS) if (inRect(m.rect, cx, cy)) counts[m.id]++
    if (w.entry?.act === 'patrol' && w.person?.job === 'watch' && !(w.still > 1)) {
      const d = Math.hypot(w.X - PX, w.Y - PY)
      if (d <= NEAR_TILES && d < bd) { bd = d; boots = w }
    }
  }
  a.boots = boots
  let dog = null, dd = Infinity
  for (const an of run.animals.values()) {
    if (an.species !== 'dog' || an.mode !== 'near') continue
    const d = Math.hypot(an.X - PX, an.Y - PY)
    if (d <= NEAR_TILES && d < dd) { dd = d; dog = an }
  }
  a.dog = dog
  a.chase = false
  if (dog) for (const f of run.fx.flocks) if (f.state !== 'settled' && Math.hypot(f.X - dog.X, f.Y - dog.Y) <= CHASE_R) { a.chase = true; break }
}
