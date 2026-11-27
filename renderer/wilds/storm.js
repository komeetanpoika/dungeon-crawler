// Sandstorms in the desert: when one blows, where, and what it takes. Pure
// and DOM-free; game.js asks once a frame (tickStorm) and draws from what
// it leaves on the state (render/weather.js the haze, render/minimap.js and
// ui/map-panel.js the lost map).
//
// The schedule is a pure function of the seed, the day count (world.day)
// and the clock: on about half the days one storm, `minLen` to `maxLen`
// seconds at full strength, building up over `ramp` seconds before and
// dying down over `ramp` after, somewhere in the day (all of it inside the
// day, so a storm never runs over midnight). It blows where the hero is, and
// only in desert country out of the gentle ring round home (wilds/desert.js)
// and off Kalevanlinna's ground (desert-art.js nearCity, the city's pieces
// and the margin round them that dunes keep out of); never indoors (the clock
// stops there, so coming out finds it where it was), never on top of the
// coach, and never in the `grace` seconds after waking or stepping off the
// coach (world.calmUntil, not saved). A storm that is blowing comes and goes
// with the hero over the desert's edge (and the city's) at the ramp's pace,
// so the haze fades rather than stops.
//
// A storm has one wind for its whole length, the same wherever the hero
// stands (stormWind): the world's prevailing wind turned a little by the day.
// The haze blows along it, so it drifts on without a jump however far he
// walks under the dunes' own turning winds.
//
// What it takes: the hero's sight, down to SIGHT.storm at full strength
// (SIGHT.stormVillage in a village), and the landmarks seen from afar with
// it; how far monsters see (systems/brain.js, state.sightCap); and from
// TAKES_MAP on, the map: the minimap is haze and the full map has no mark
// for the hero. A gust of wind is heard every `windEvery` seconds while it
// is stronger than WIND_HEARD. It hurts no one and stops nothing.
import { DAY_LENGTH } from '../data/weather.js'
import { hash } from './rand.js'
import { heroSight, BEACON_RANGE } from './desert.js'
import { prevailingWind, WIND } from './desert-art.js'
import { sfx } from '../systems/sfx.js'

export const STORM = { odds: 0.5, minLen: 40, maxLen: 70, ramp: 5, grace: 120, windEvery: 2.5 }
// The strength from which the storm takes the map, and from which its wind is heard.
export const TAKES_MAP = 0.5
export const WIND_HEARD = 0.3

const SALT = 5150

// The storm of `day`, in seconds of the clock: it starts building at
// `start`, blows at full strength for `len` from `start + ramp`, and is
// over at `end`. Null on a calm day.
export function stormOfDay(seed, day) {
  if (hash(seed, day, 0, SALT) >= STORM.odds) return null
  const len = STORM.minLen + (STORM.maxLen - STORM.minLen) * hash(seed, day, 1, SALT)
  const total = len + 2 * STORM.ramp
  const start = (DAY_LENGTH - total) * hash(seed, day, 2, SALT)
  return { start, len, end: start + total }
}

// How hard the day's storm blows at `clock`, 0..1, the ramps included.
export function stormStrength(seed, day, clock) {
  const s = stormOfDay(seed, day)
  if (!s) return 0
  const t = clock - s.start, total = s.end - s.start
  if (t <= 0 || t >= total) return 0
  return Math.min(1, t / STORM.ramp, (total - t) / STORM.ramp)
}

// The storm where the hero is: none out of the desert, in the gentle ring,
// on Kalevanlinna's ground (`city`), indoors, on the coach, or within the
// calm; else the schedule's strength.
export function stormHere({ strength, desert, ring, city = false, indoors, riding, calm }) {
  if (!desert || ring || city || indoors || riding || calm) return 0
  return strength
}

// The wind of the day's storm, in radians the way it blows (x east, y
// south): the world's prevailing wind (desert-art.js), turned up to
// WIND.spread either way by the day. Pure in (seed, day); the same
// wherever the hero stands.
export const stormWind = (seed, day) => prevailingWind(seed) + WIND.spread * (2 * hash(seed, day, 3, SALT) - 1)

// No storm for the next `grace` seconds of play: on waking (session.js
// enterWilds) and on stepping off the coach (game.js).
export function calmStorm(world) {
  world.calmUntil = world.playtime + STORM.grace
}

// Once a frame in the Wilds, out of doors or in: the storm on the hero.
// Sets state.storm (0..1), state.sightCap (the hero's sight while it blows,
// else null), state.stormWind (the storm's wind, for the haze), and sounds
// the wind. `desert`, `ring`, `city` and `village` are where the hero stands
// (session.js landOf); `clock` is the day clock.
export function tickStorm(state, world, { clock, delta = 0, desert = false, ring = false, city = false, village = false }) {
  const indoors = !!state.cave, riding = !!state.player?.riding
  const calm = world.playtime < (world.calmUntil ?? -Infinity)
  const strength = stormStrength(world.seed, world.day ?? 0, clock)
  const target = stormHere({ strength, desert, ring, city, indoors, riding, calm })
  const was = state.storm ?? 0, step = delta / STORM.ramp
  state.storm = indoors || riding || calm ? 0 : target > was ? Math.min(target, was + step) : Math.max(target, was - step)
  state.sightCap = state.storm > 0 ? heroSight({ desert, storm: state.storm, village }) : null
  state.stormWind = stormWind(world.seed, world.day ?? 0)
  if (state.storm > WIND_HEARD) {
    // the first gust as soon as it is heard, then one every windEvery seconds
    state.stormGust = (state.stormGust ?? STORM.windEvery) + delta
    if (state.stormGust >= STORM.windEvery) { state.stormGust = 0; sfx(state, 'storm-wind') }
  } else state.stormGust = null
  return state.storm
}

// The hero's sight out of doors in the Wilds: the radius (the storm's while
// it blows, else the open country's or the desert's) and how far landmarks
// are seen, which closes in with the storm down to the radius itself.
export function sightNow(state, desert) {
  const storm = state.storm ?? 0
  const radius = state.sightCap ?? heroSight({ desert })
  const far = storm > 0 ? Math.round(BEACON_RANGE + (radius - BEACON_RANGE) * storm) : BEACON_RANGE
  return { radius, far }
}

// Whether the storm has taken the map, and the hero the map may show: none
// while it has.
export const mapHazed = state => (state?.storm ?? 0) >= TAKES_MAP
export const mapHero = (state, hero) => (mapHazed(state) ? null : hero)
