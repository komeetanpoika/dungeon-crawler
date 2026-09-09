// Secret unlock ceremonies. A rite is a named condition + a short screen
// ceremony; the trigger tiles come from data/rites.js via openmap.js.
// Pure: no DOM, no canvas — riteVisuals returns numbers for the renderer.
import { hasTalent } from './talents.js'

export const TRANCE_DURATION = 60   // s from the first bite until the rite calls
export const TRANCE_FADE = 5        // s the peak takes to drain once the call has landed
export const RITE_DURATION = 9      // s of ceremony lock

// The call carries the player to the ring: the screen washes out, the player
// arrives at PULL_TELEPORT_AT through the wash, and it drains back to reveal
// them standing in the circle.
export const PULL_DURATION = 2.5
export const PULL_TELEPORT_AT = 0.5

// How far the trip goes at its peak. Tuned by eye in tools/trance-lab.
const SWAY_MIN = 1.5       // px of camera sway at the first bite
const SWAY_MAX = 8         // px at the peak — a stagger, not a jitter
const SWAY_SLOW = 0.47     // the sway's frequency falls to this fraction as it widens
const TINT_MAX = 0.18      // alpha of the green wash at the peak
const COLOUR_EASE = 2      // colour rides a steeper curve than the sway: the world
                           // moves long before it changes colour

// Seven-wizard ceremony timeline: wizards fade in until RITE_APPEAR_END,
// chant while their beams ignite one at a time, and once every beam is on
// (RITE_ASCEND_START) the player rises up to RITE_LIFT_MAX px.
export const WIZARD_COUNT = 7
export const RITE_APPEAR_END = 1.5
export const RITE_ASCEND_START = 6
export const RITE_LIFT_MAX = 20
const RING_RADIUS = 80              // px, 2.5 tiles
const BEAM_RAMP = 0.3               // s for a lit beam to reach full strength
const GLYPH_LIFE = 1.2              // s a chant glyph drifts before recycling
const GLYPH_RISE = 26               // px a glyph rises over its life
const GLYPHS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᛃ', 'ᛇ', 'ᛉ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ']

export function startTrance(player) {
  player.trance = TRANCE_DURATION
  player.tranceFade = 0          // a second mushroom restarts the climb, fade and all
  player.tranceHue = 0           // and puts the world back in its own colours
  player.tranceT = player.tranceT ?? 0
}

// Advances the trip by dt and returns 'call' on the single tick the minute
// runs out — the moment the rite reaches for the player. The peak is handed
// to tranceFade so the visuals hold and then drain, whether the call is
// answered by a pull or goes unanswered.
export function tickTrance(player, dt) {
  if (player.tranceFade > 0) {
    player.tranceFade = Math.max(0, player.tranceFade - dt)
    advanceClocks(player, dt)
    return null
  }
  if (!(player.trance > 0)) return null
  player.trance = Math.max(0, player.trance - dt)
  advanceClocks(player, dt)
  if (player.trance > 0) return null
  player.tranceFade = TRANCE_FADE
  return 'call'
}

// tranceT is the sway's phase — it runs at wall speed so the stagger never
// stutters. tranceHue is the colour clock, advancing at the colour ramp's pace
// so the world holds its own colours through most of the minute and then races
// round the wheel at the end.
function advanceClocks(player, dt) {
  player.tranceT = (player.tranceT ?? 0) + dt
  player.tranceHue = (player.tranceHue ?? 0) + dt * tranceColour(player)
}

// How far gone the player is, 0..1. Squared, so the first half-minute is a
// shimmer you could mistake for the weather and the last ten seconds are a
// full trip; then it drains over TRANCE_FADE.
//
// Colour is held back further still. The sway is what creeps in first — the
// ground should be swimming well before it starts changing colour — so the
// wash, the rainbow and the hue clock all run off tranceColour instead.
export function tranceColour(player) {
  return tranceLevel(player) ** COLOUR_EASE
}

export function tranceLevel(player) {
  if (player.trance > 0) {
    const p = 1 - player.trance / TRANCE_DURATION
    return p * p
  }
  return (player.tranceFade ?? 0) / TRANCE_FADE
}

// Every object shines at its own rate: an FNV hash of the seed picks how fast
// it runs around the wheel. Everything starts on its own colours and drifts
// apart from there — read against player.tranceHue, the clock that itself runs
// at the trip's pace, so the drift creeps at first and races at the peak.
function hashSeed(seed) {
  const s = String(seed)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function spriteHue(seed, t) {
  return ((18 + (hashSeed(seed) % 120)) * t) % 360
}

// The rainbow is painted as a handful of soft colour blobs drifting across the
// view in normalised (0..1) screen space, each on its own path, size beat and
// hue rate — so two things a few tiles apart never wear the same colour.
const BLOB_COUNT = 4
const TAU = Math.PI * 2
function rainbowBlobs(t) {
  const blobs = []
  for (let i = 0; i < BLOB_COUNT; i++) {
    blobs.push({
      x: 0.5 + 0.4 * Math.sin(t * (0.09 + i * 0.031) * TAU + i),
      y: 0.5 + 0.4 * Math.cos(t * (0.11 + i * 0.023) * TAU + i * 1.7),
      r: 0.32 + 0.08 * Math.sin(t * 0.17 + i),
      hue: (i * 90 + t * (13 + i * 11)) % 360,
    })
  }
  return blobs
}

// The ring the call reaches for: any rite anchor on this map that still has
// something to give. None in a cave, and none once the talent is learned —
// both fizzle. A talent-less anchor (the marsh ring) always answers.
export function pullTarget(state) {
  return (state.entities ?? []).find(e => e.type === 'talent_trigger'
    && (!e.talent || !hasTalent(state.player, e.talent))) ?? null
}

// The whiteout that carries the player across: up to full at the hand-over,
// then back down to reveal them standing in the circle.
export function pullWash(t, dur) {
  const at = dur * PULL_TELEPORT_AT
  if (t <= 0 || t >= dur) return 0
  return t < at ? t / at : 1 - (t - at) / (dur - at)
}

const CONDITIONS = {
  mushroom_circle: state => (state.player.trance ?? 0) > 0,
}

export function riteConditionMet(riteId, state) {
  return CONDITIONS[riteId]?.(state) ?? false
}

// One number bundle for the renderer: subtle sine wobble while entranced;
// during the ceremony a sin(pi*t) envelope ramps wobble, blur and the sickly
// green up and back down.
export function riteVisuals(state) {
  const out = { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0, tintAlpha: 0, wash: 0,
    level: 0, colour: 0, rainbow: { alpha: 0, blobs: [] }, lift: 0, wizards: [], glyphs: [] }
  const p = state.player
  const level = tranceLevel(p)
  const colour = tranceColour(p)
  if (level > 0) {
    out.level = level
    out.colour = colour
    // The sway widens and slows together — a stagger, not a faster jitter.
    const t = p.tranceT ?? 0
    const amp = SWAY_MIN + (SWAY_MAX - SWAY_MIN) * level
    const slow = 1 - (1 - SWAY_SLOW) * level
    out.wobbleX = Math.sin(t * 1.7 * slow) * amp
    out.wobbleY = Math.cos(t * 1.3 * slow) * amp
    out.tintAlpha = TINT_MAX * colour
    out.rainbow = { alpha: colour, blobs: rainbowBlobs(t) }
  }
  if (state.tripPull) out.wash = pullWash(state.tripPull.t, state.tripPull.dur)
  if (state.rite) {
    const t = state.rite.t
    const k = Math.sin(Math.PI * Math.min(1, t / state.rite.dur))
    out.wobbleX = Math.sin(t * 9) * 6 * k
    out.wobbleY = Math.cos(t * 7) * 6 * k
    out.blur = 3 * k
    out.greenAlpha = 0.35 * k

    const cx = state.rite.cx ?? p.px ?? 0
    const cy = state.rite.cy ?? p.py ?? 0
    const alpha = Math.min(1, t / RITE_APPEAR_END)
    // Beam i ignites step seconds after the previous; the last reaches full
    // strength exactly at RITE_ASCEND_START.
    const step = (RITE_ASCEND_START - BEAM_RAMP - RITE_APPEAR_END) / (WIZARD_COUNT - 1)
    for (let i = 0; i < WIZARD_COUNT; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / WIZARD_COUNT
      const beam = Math.max(0, Math.min(1, (t - (RITE_APPEAR_END + i * step)) / BEAM_RAMP))
      out.wizards.push({ px: cx + Math.cos(a) * RING_RADIUS, py: cy + Math.sin(a) * RING_RADIUS, alpha, beam })
    }

    // Chant glyphs: two per wizard, cycling on fixed phase offsets so the
    // whole thing is a pure function of t.
    if (t >= RITE_APPEAR_END && t < RITE_ASCEND_START) {
      for (let i = 0; i < WIZARD_COUNT; i++) {
        const w = out.wizards[i]
        for (let g = 0; g < 2; g++) {
          const phase = ((i * 0.37 + g * 0.53) % 1) * GLYPH_LIFE
          const cycles = (t - RITE_APPEAR_END + phase) / GLYPH_LIFE
          const frac = cycles % 1
          const n = Math.floor(cycles)
          out.glyphs.push({
            px: w.px + Math.sin((i * 3 + g * 5 + n) * 2.4) * 6 + (g === 0 ? -6 : 6),
            py: w.py - 10 - frac * GLYPH_RISE,
            alpha: Math.max(0.08, Math.sin(Math.PI * frac)),
            char: GLYPHS[(i * 5 + g * 3 + n) % GLYPHS.length],
          })
        }
      }
    }

    if (t >= RITE_ASCEND_START) {
      const s = Math.min(1, (t - RITE_ASCEND_START) / 1.5)
      out.lift = RITE_LIFT_MAX * s * s * (3 - 2 * s)   // smoothstep rise, then hover
    }
  }
  return out
}
