// Weather: the day clock, the day's light keyframes, and the fog mask.
// Pure — no canvas, no DOM. render/weather.js paints from the `look` this
// module produces each frame; game.js wires the clock and the arrival build.
import { DAY_LENGTH, DAY_START, weatherFor } from '../data/weather.js'

// Light through the day, at fractions of DAY_LENGTH. `dark` is the multiply
// wash's alpha, `ambient` its colour, `fog` scales the mist. Linear between
// rows; the last row equals the first so the day wraps without a seam.
export const KEYFRAMES = [
  { at: 0.00, dark: 0.85, ambient: [40, 60, 120],   fog: 1.0 },   // night
  { at: 0.20, dark: 0.45, ambient: [230, 140, 110], fog: 1.0 },   // dawn
  { at: 0.30, dark: 0.05, ambient: [255, 240, 220], fog: 0.5 },   // morning
  { at: 0.50, dark: 0.00, ambient: [255, 255, 255], fog: 0.15 },  // noon
  { at: 0.70, dark: 0.10, ambient: [255, 210, 150], fog: 0.3 },   // evening
  { at: 0.80, dark: 0.50, ambient: [220, 110, 80],  fog: 0.8 },   // dusk
  { at: 0.90, dark: 0.85, ambient: [40, 60, 120],   fog: 1.0 },   // night
  { at: 1.00, dark: 0.85, ambient: [40, 60, 120],   fog: 1.0 },
]

export function dayPhase(clock) {
  const frac = (((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH
  let i = 0
  while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].at <= frac) i++
  const a = KEYFRAMES[i], b = KEYFRAMES[i + 1]
  const u = (frac - a.at) / (b.at - a.at)
  const lerp = (p, q) => p + (q - p) * u
  return {
    frac,
    dark: lerp(a.dark, b.dark),
    fog: lerp(a.fog, b.fog),
    ambient: a.ambient.map((v, j) => Math.round(lerp(v, b.ambient[j]))),
  }
}

// Seconds into the day, wrapped. Lives on the adventure-shaped save so each
// timewarp episode carries its own; reaches disk on the usual persistRun.
export function advanceClock(save, delta) {
  const next = (save.clock ?? DAY_START) + delta
  save.clock = ((next % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH
  return save.clock
}
