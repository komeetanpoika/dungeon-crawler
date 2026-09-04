// Weather: the day clock, the day's light keyframes, and the fog mask.
// Pure — no canvas, no DOM. render/weather.js paints from the `look` this
// module produces each frame; game.js wires the clock and the arrival build.
import { DAY_LENGTH, DAY_START, weatherFor } from '../data/weather.js'
import { campfireAlpha, isDeadwoodFire } from './campfire.js'
import { FIRE_DURATION } from './fire.js'
import { LOS_CLEAR_PREFIXES } from './openmap.js'

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

const TILE_SIZE = 32
const CAMPFIRE_LIGHT_TILES = 4.5
const FIRE_ZONE_LIGHT_TILES = 2
const FIRE_ZONE_FADE = 0.7   // last seconds of a zone, same clamp the flame draw uses

// The same predicate openmap.js uses for losClear: open water by palette skin.
const isOpenWater = (data, x, y) => LOS_CLEAR_PREFIXES.some(p => String(data.palette[data.ground[y]?.[x]] ?? '').startsWith(p))

// Open-water cells within `radius` tiles of the anchor POI, weighted by a
// smoothstep from 1 at the anchor to 0 at the rim. Null (with a warning)
// when the POI is not on the map — a bad label must not take the map down.
function fogCells(data, { at, radius }) {
  const poi = data.pois.find(p => p.label === at)
  if (!poi) { console.warn(`weather: fog anchor "${at}" is not a POI on ${data.name}`); return null }
  const cells = []
  const y0 = Math.max(0, poi.y - radius), y1 = Math.min(data.h - 1, poi.y + radius)
  const x0 = Math.max(0, poi.x - radius), x1 = Math.min(data.w - 1, poi.x + radius)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isOpenWater(data, x, y)) continue
      const d = Math.hypot(x - poi.x, y - poi.y) / radius
      if (d >= 1) continue
      const s = 1 - d
      cells.push({ x, y, w: s * s * (3 - 2 * s) })
    }
  }
  return { cx: poi.x, cy: poi.y, radius, cells }
}

// Built once on arrival for maps with a config entry; stored on the surface
// state. `t` is the animation timer — separate from the day clock so the
// clock's wrap never jumps the fog drift.
export function makeWeather(mapData) {
  const cfg = weatherFor(mapData)
  if (!cfg) return null
  return { dayCycle: !!cfg.dayCycle, t: 0, fog: cfg.fog ? fogCells(mapData, cfg.fog) : null }
}

// Everything that punches a hole in the night: campfires (the hermit's
// deadwood hearth glows grey) and burning fire-zone tiles. `r` is in tiles.
export function lightSources(state) {
  const out = []
  for (const e of state.entities ?? []) {
    if (e.type !== 'campfire') continue
    out.push({ px: e.px, py: e.py, r: CAMPFIRE_LIGHT_TILES, strength: campfireAlpha(e), grey: isDeadwoodFire(e) })
  }
  for (const z of state.fireZones ?? []) {
    const strength = Math.max(0, Math.min(1, (FIRE_DURATION - z.age) / FIRE_ZONE_FADE))
    for (const t of z.tiles) {
      out.push({ px: t.x * TILE_SIZE + TILE_SIZE / 2, py: t.y * TILE_SIZE + TILE_SIZE / 2,
                 r: FIRE_ZONE_LIGHT_TILES, strength, grey: false })
    }
  }
  return out
}

const DAYLIGHT = { dark: 0, ambient: [255, 255, 255], fog: 1 }

// The per-frame object the renderer paints from. Null off weather maps.
export function weatherLook(state, save) {
  const w = state.weather
  if (!w) return null
  const ph = w.dayCycle ? dayPhase(save.clock ?? DAY_START) : DAYLIGHT
  return { dark: ph.dark, ambient: ph.ambient, fog: ph.fog, t: w.t, lights: ph.dark > 0 ? lightSources(state) : [] }
}
