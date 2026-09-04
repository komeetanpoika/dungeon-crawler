# Weather: Day Cycle and Pier Fog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A six-minute day/night cycle with campfire glow, and drifting mist over the water around the pier, on Toivo's Lake — built as an opt-in per-map weather system.

**Architecture:** A hand-authored config table (`data/weather.js`) keyed by map name; a pure systems module (`systems/weather.js`) that owns the clock on the save, the day keyframes, the fog-cell mask and the per-frame "look"; a render module (`render/weather.js`) that paints a night pass (multiply wash with light holes, before flames) and a fog pass (drifting blobs masked to water cells, after flames) through one quarter-resolution offscreen layer owned by `Renderer`.

**Tech Stack:** Vanilla ESM JavaScript, Canvas 2D, `node:test` + `node:assert/strict`. No bundler, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md`

## Global Constraints

- Purely atmospheric: no change to FOV, enemy perception, NPCs, the Näkki, episode flags or the runestone rule.
- `DAY_LENGTH = 360` seconds; `DAY_START = 0.30 * DAY_LENGTH`. Clock is `save.clock` (additive default, no save version bump).
- No wall-clock (`Date.now`/`performance.now`) anywhere in the new code; animation uses `state.weather.t`.
- Only `lake-1-ferry` gets a config entry: `{ dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } }`.
- `renderer/data/open-maps.js` is generated — never edit it.
- Systems modules import nothing from `render/` or the DOM.
- Every commit ends with the trailer lines below (blank line before them):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JKD5tUBvx2cfSrUn4mBquj
  ```
- Work on branch `weather-day-cycle` (already exists, holds the spec commit). Run `npm test` (= `node --test test/`) from the repo root before every commit; it must stay green.

---

## File map

| File | Responsibility |
|---|---|
| `renderer/data/weather.js` (new) | Constants + the per-map config table + `weatherFor` |
| `renderer/systems/weather.js` (new) | `dayPhase`, `advanceClock`, `makeWeather`, `lightSources`, `weatherLook` — pure |
| `renderer/systems/adventure.js` (edit) | default `clock` in `normalizeAdventureSave` |
| `renderer/render/weather.js` (new) | `makeWeatherLayer`, `fogBlobs`, `drawNight`, `drawFog` |
| `renderer/render/canvas.js` (edit) | `Renderer` owns the layer; two insertion points in `render()`; `resize()` |
| `renderer/game.js` (edit) | build weather on arrival, advance on surface frames, compute look before render, debug hook exposes the save |
| `test/weather.test.js` (new) | systems tests |
| `test/render-weather.test.js` (new) | render-module tests |
| `test/canvas.test.js` (edit) | `Renderer.render` layer-order tests |
| `/home/lappemikb/CLAUDE.md` (edit) | one line |

---

### Task 1: Config, clock and day keyframes

**Files:**
- Create: `renderer/data/weather.js`
- Create: `renderer/systems/weather.js`
- Modify: `renderer/systems/adventure.js:5-6` (imports) and `:52-56` (defaults in `normalizeAdventureSave`)
- Test: `test/weather.test.js`

**Interfaces:**
- Produces: `DAY_LENGTH: number`, `DAY_START: number`, `WEATHER: object`, `weatherFor(mapData) → config | null` from `data/weather.js`.
- Produces: `KEYFRAMES`, `dayPhase(clock) → { frac, dark, ambient: [r,g,b], fog }`, `advanceClock(save, delta) → number` from `systems/weather.js`.
- Produces: `normalizeAdventureSave(raw).clock` defaults to `DAY_START`.

- [ ] **Step 1: Write the failing tests**

Create `test/weather.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DAY_LENGTH, DAY_START, WEATHER, weatherFor } from '../renderer/data/weather.js'
import { dayPhase, advanceClock } from '../renderer/systems/weather.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'

describe('weather config', () => {
  it('a day is six minutes and a fresh save wakes mid-morning', () => {
    assert.equal(DAY_LENGTH, 360)
    assert.equal(DAY_START, 0.30 * DAY_LENGTH)
  })

  it("Toivo's Lake has a day cycle and pier fog; other maps have nothing", () => {
    assert.deepEqual(WEATHER['lake-1-ferry'], { dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } })
    assert.deepEqual(weatherFor({ name: 'lake-1-ferry' }), WEATHER['lake-1-ferry'])
    assert.equal(weatherFor({ name: 'forest-1-aspengrove' }), null)
    assert.equal(weatherFor(null), null)
  })
})

describe('advanceClock', () => {
  it('adds delta and wraps at DAY_LENGTH', () => {
    const save = { clock: 10 }
    assert.equal(advanceClock(save, 5), 15)
    assert.equal(save.clock, 15)
    save.clock = DAY_LENGTH - 1
    advanceClock(save, 2)
    assert.equal(save.clock, 1)
  })

  it('starts a clock-less save from DAY_START', () => {
    const save = {}
    advanceClock(save, 1)
    assert.equal(save.clock, DAY_START + 1)
  })
})

describe('normalizeAdventureSave clock', () => {
  it('defaults a missing clock to DAY_START and keeps an existing one', () => {
    assert.equal(normalizeAdventureSave(null).clock, DAY_START)
    const raw = normalizeAdventureSave(null)
    raw.clock = 42
    assert.equal(normalizeAdventureSave(raw).clock, 42)
  })
})

describe('dayPhase', () => {
  const at = frac => dayPhase(frac * DAY_LENGTH)

  it('is bright at noon and deep night at midnight', () => {
    assert.equal(at(0.5).dark, 0)
    assert.deepEqual(at(0.5).ambient, [255, 255, 255])
    assert.equal(at(0.5).fog, 0.15)
    assert.equal(at(0).dark, 0.85)
    assert.deepEqual(at(0).ambient, [40, 60, 120])
    assert.equal(at(0).fog, 1)
  })

  it('wraps: a full day later is the same phase', () => {
    assert.deepEqual(dayPhase(DAY_LENGTH), dayPhase(0))
    assert.deepEqual(dayPhase(DAY_LENGTH + 30), dayPhase(30))
  })

  it('darkens monotonically from evening to night and brightens from dawn to morning', () => {
    let prev = at(0.70).dark
    for (let f = 0.71; f <= 0.90; f += 0.01) { assert.ok(at(f).dark >= prev, `dark fell at ${f}`); prev = at(f).dark }
    prev = at(0.20).dark
    for (let f = 0.21; f <= 0.30; f += 0.01) { assert.ok(at(f).dark <= prev, `dark rose at ${f}`); prev = at(f).dark }
  })

  it('interpolates between keyframes', () => {
    // halfway from noon (dark 0) to evening (dark 0.10)
    assert.ok(Math.abs(at(0.6).dark - 0.05) < 1e-9)
    // fog halfway from dusk (0.8) to night (1.0)
    assert.ok(Math.abs(at(0.85).fog - 0.9) < 1e-9)
    // ambient is rounded to integers
    for (const v of at(0.6).ambient) assert.equal(v, Math.round(v))
  })

  it('reports the day fraction', () => {
    assert.equal(at(0.25).frac, 0.25)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/weather.test.js`
Expected: FAIL — `Cannot find module '.../renderer/data/weather.js'`

- [ ] **Step 3: Create the config module**

Create `renderer/data/weather.js`:

```js
// Per-map weather (docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md).
// Keyed by map name like EPISODES — open-maps.js is generated and would drop
// a flag. `dayCycle` advances the clock and draws the night pass; `fog` lays
// mist on the open-water cells within `radius` tiles of the POI `at`.
export const DAY_LENGTH = 360               // seconds per in-game day
export const DAY_START = 0.30 * DAY_LENGTH  // a fresh save wakes mid-morning

export const WEATHER = {
  'lake-1-ferry': { dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } },
}

export const weatherFor = mapData => (mapData && WEATHER[mapData.name]) || null
```

- [ ] **Step 4: Create the systems module with the clock and keyframes**

Create `renderer/systems/weather.js`:

```js
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
```

- [ ] **Step 5: Default the clock in the save normaliser**

In `renderer/systems/adventure.js`, add the import after line 6 (`import { ADVENTURE_DEPTH } ...`):

```js
import { DAY_START } from '../data/weather.js'
```

and in `normalizeAdventureSave`, after `base.leaps ??= {}`:

```js
  base.clock ??= DAY_START   // seconds into the in-game day (systems/weather.js)
```

Also extend the shape comment above the function (after the v7 sentence):

```
// The weather clock (`clock`, seconds into the day) is additive with a default.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/weather.test.js`
Expected: PASS, all tests.

Run: `npm test`
Expected: PASS (existing suite untouched).

- [ ] **Step 7: Commit**

```bash
git add renderer/data/weather.js renderer/systems/weather.js renderer/systems/adventure.js test/weather.test.js
git commit -m "feat(weather): per-map config, six-minute day clock on the save, day keyframes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JKD5tUBvx2cfSrUn4mBquj"
```

---

### Task 2: Fog mask, light sources and the per-frame look

**Files:**
- Modify: `renderer/systems/weather.js`
- Test: `test/weather.test.js`

**Interfaces:**
- Consumes: `weatherFor`, `DAY_START` (Task 1); `campfireAlpha(fire)`, `isDeadwoodFire(e)` from `systems/campfire.js`; `FIRE_DURATION` from `systems/fire.js`.
- Produces:
  - `makeWeather(mapData) → null | { dayCycle: boolean, t: number, fog: null | { cx, cy, radius, cells: [{ x, y, w }] } }`
  - `lightSources(state) → [{ px, py, r, strength, grey }]` (`r` in tiles)
  - `weatherLook(state, save) → null | { dark, ambient, fog, t, lights }`

- [ ] **Step 1: Write the failing tests**

Append to `test/weather.test.js` (extend the systems import line to `import { dayPhase, advanceClock, makeWeather, lightSources, weatherLook } from '../renderer/systems/weather.js'` and add `import { makeCampfire, CAMPFIRE_DURATION } from '../renderer/systems/campfire.js'`):

```js
// A 12×12 lake: water inside a radius-5 disc around (6,6), grass elsewhere.
// `pier gap 2` sits at the disc centre, as on the real map's pier row.
function lakeMapData({ withPoi = true } = {}) {
  const N = 12, palette = ['ow_grass_0', 'ow_water_0']
  const ground = []
  for (let y = 0; y < N; y++) {
    ground.push([])
    for (let x = 0; x < N; x++) ground[y].push(Math.hypot(x - 6, y - 6) <= 5 ? 1 : 0)
  }
  return { name: 'lake-1-ferry', w: N, h: N, palette, ground,
    pois: withPoi ? [{ kind: 'landmark', x: 6, y: 6, label: 'pier gap 2' }] : [] }
}

describe('makeWeather', () => {
  it('is null for a map with no config', () => {
    assert.equal(makeWeather({ name: 'forest-1-aspengrove', pois: [] }), null)
  })

  it('builds a day cycle, a zero animation timer and the fog cells', () => {
    const w = makeWeather(lakeMapData())
    assert.equal(w.dayCycle, true)
    assert.equal(w.t, 0)
    assert.equal(w.fog.cx, 6)
    assert.equal(w.fog.cy, 6)
    assert.equal(w.fog.radius, 9)
    assert.ok(w.fog.cells.length > 0)
  })

  it('takes only water cells inside the radius, weighted 1 at the anchor and falling with distance', () => {
    const { fog } = makeWeather(lakeMapData())
    const at = (x, y) => fog.cells.find(c => c.x === x && c.y === y)
    assert.equal(at(6, 6).w, 1)
    assert.ok(at(8, 6).w < at(7, 6).w && at(7, 6).w < 1)
    assert.ok(at(11, 6).w > 0)                       // water, inside radius 9
    assert.equal(at(0, 0), undefined)                 // grass
    assert.equal(fog.cells.some(c => Math.hypot(c.x - 6, c.y - 6) > 5), false)   // no grass sneaks in
    for (const c of fog.cells) assert.ok(c.w > 0 && c.w <= 1)
  })

  it('uses the whole disc when the radius exceeds the map, never indexing off the edge', () => {
    const data = lakeMapData()
    data.pois[0] = { kind: 'landmark', x: 11, y: 11, label: 'pier gap 2' }
    assert.doesNotThrow(() => makeWeather(data))
  })

  it('yields fog null (no throw) when the anchor POI is missing', () => {
    const warned = []
    const orig = console.warn
    console.warn = (...a) => warned.push(a.join(' '))
    try {
      const w = makeWeather(lakeMapData({ withPoi: false }))
      assert.equal(w.fog, null)
      assert.equal(w.dayCycle, true)
      assert.ok(warned.some(m => m.includes('pier gap 2')))
    } finally { console.warn = orig }
  })
})

describe('lightSources', () => {
  it('is empty with nothing burning', () => {
    assert.deepEqual(lightSources({ entities: [], fireZones: [] }), [])
    assert.deepEqual(lightSources({}), [])
  })

  it('lists campfires at their pixel centre with campfireAlpha as strength', () => {
    const fire = makeCampfire(3, 4)
    fire.t = CAMPFIRE_DURATION - 5   // in the fade
    const [l] = lightSources({ entities: [{ type: 'villager', px: 0, py: 0 }, fire] })
    assert.equal(l.px, 3 * 32 + 16)
    assert.equal(l.py, 4 * 32 + 16)
    assert.equal(l.r, 4.5)
    assert.ok(l.strength > 0.3 && l.strength < 1)
    assert.equal(l.grey, false)
  })

  it('marks a deadwood fire grey and an eternal fire full strength', () => {
    const grey = makeCampfire(1, 1, { eternal: true, fuel: 'deadwood' })
    grey.t = 9999
    const [l] = lightSources({ entities: [grey] })
    assert.equal(l.grey, true)
    assert.equal(l.strength, 1)
  })

  it('lists every burning fire-zone tile with a 2-tile radius and the zone fade', () => {
    const zone = { tiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }], age: 2.65 }   // 0.35 s of the 0.7 s fade left
    const ls = lightSources({ entities: [], fireZones: [zone] })
    assert.equal(ls.length, 2)
    assert.equal(ls[0].r, 2)
    assert.ok(Math.abs(ls[0].strength - 0.5) < 1e-9)
    assert.equal(ls[1].px, 32 + 16)
  })
})

describe('weatherLook', () => {
  it('is null when the map has no weather', () => {
    assert.equal(weatherLook({ weather: null }, { clock: 0 }), null)
  })

  it('carries the phase, the animation timer and the lights', () => {
    const state = { weather: makeWeather(lakeMapData()), entities: [makeCampfire(1, 1)], fireZones: [] }
    state.weather.t = 7.5
    const look = weatherLook(state, { clock: 0 })   // midnight
    assert.equal(look.dark, 0.85)
    assert.deepEqual(look.ambient, [40, 60, 120])
    assert.equal(look.fog, 1)
    assert.equal(look.t, 7.5)
    assert.equal(look.lights.length, 1)
  })

  it('skips the light scan by day', () => {
    const state = { weather: makeWeather(lakeMapData()), entities: [makeCampfire(1, 1)], fireZones: [] }
    const look = weatherLook(state, { clock: 0.5 * DAY_LENGTH })   // noon
    assert.equal(look.dark, 0)
    assert.deepEqual(look.lights, [])
  })

  it('a fog-only map is always bright with full fog', () => {
    const w = makeWeather(lakeMapData())
    w.dayCycle = false
    const look = weatherLook({ weather: w, entities: [], fireZones: [] }, { clock: 0 })
    assert.equal(look.dark, 0)
    assert.equal(look.fog, 1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/weather.test.js`
Expected: FAIL — `makeWeather` is not exported (SyntaxError on the import).

- [ ] **Step 3: Implement**

Append to `renderer/systems/weather.js` (add the imports at the top of the file, below the data import):

```js
import { campfireAlpha, isDeadwoodFire } from './campfire.js'
import { FIRE_DURATION } from './fire.js'

const TILE_SIZE = 32
const CAMPFIRE_LIGHT_TILES = 4.5
const FIRE_ZONE_LIGHT_TILES = 2
const FIRE_ZONE_FADE = 0.7   // last seconds of a zone, same clamp the flame draw uses
```

and, after `advanceClock`:

```js
// The same predicate openmap.js uses for losClear: open water by palette skin.
const isWater = (data, x, y) => String(data.palette[data.ground[y]?.[x]] ?? '').startsWith('ow_water_')

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
      if (!isWater(data, x, y)) continue
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/weather.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/weather.js test/weather.test.js
git commit -m "feat(weather): fog cell mask around a POI, light sources, per-frame look

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JKD5tUBvx2cfSrUn4mBquj"
```

---

### Task 3: Render module — layer, blobs, night pass, fog pass

**Files:**
- Create: `renderer/render/weather.js`
- Test: `test/render-weather.test.js`

**Interfaces:**
- Consumes: the `look` shape from Task 2 (`{ dark, ambient, fog, t, lights }`) and the `fog` shape (`{ cx, cy, radius, cells }`).
- Produces:
  - `makeWeatherLayer(createCanvas) → { canvas, ctx, mask, maskCtx, w, h, k, resize(viewW, viewH) }` — `k = 0.25` layer px per screen px; `w/h` are the layer's pixel size.
  - `fogBlobs(fog) → [{ x, y, r, a, b, p1, p2 }]` (tile units, memoised per `fog` object).
  - `drawNight(ctx, layer, look, cam, view, S)` and `drawFog(ctx, layer, look, fog, cam, view, S)` where `cam = { camX, camY }`, `view = { W, H }`.

The night pass paints the ambient colour into the layer, punches `destination-out` holes at each light, blits the layer with `multiply` at alpha `look.dark`, then adds a `lighter` glow per light. The fog pass paints blobs into the layer, paints the blurred cell mask into `layer.mask`, applies the mask with one `destination-in` `drawImage`, and blits at alpha `0.85 × look.fog`. Both blits set `imageSmoothingEnabled = true` inside `save()/restore()`.

- [ ] **Step 1: Write the failing tests**

Create `test/render-weather.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeWeatherLayer, fogBlobs, drawNight, drawFog } from '../renderer/render/weather.js'

// Records every draw with the composite op / alpha / smoothing in force at
// the time. Unknown methods are recorded generically via the Proxy.
function recordingCtx() {
  const ops = []
  let alpha = 1, gco = 'source-over', filter = 'none', fillStyle = '', smooth = false
  const base = {
    ops,
    drawImage: (img, ...a) => ops.push({ name: 'drawImage', img, a, gco, alpha, smooth }),
    fillRect: (...a) => ops.push({ name: 'fillRect', a, gco, alpha, filter, fillStyle }),
    clearRect: (...a) => ops.push({ name: 'clearRect', a }),
    createRadialGradient: () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }),
    get imageSmoothingEnabled() { return smooth }, set imageSmoothingEnabled(v) { smooth = v },
    get globalAlpha() { return alpha }, set globalAlpha(v) { alpha = v },
    get globalCompositeOperation() { return gco }, set globalCompositeOperation(v) { gco = v },
    get filter() { return filter }, set filter(v) { filter = v },
    get fillStyle() { return fillStyle }, set fillStyle(v) { fillStyle = v },
  }
  return new Proxy(base, {
    get(t, p, r) { if (p in t) return Reflect.get(t, p, r); return (...args) => { ops.push({ name: p, args }) } },
  })
}

function fakeCanvas() {
  const ctx = recordingCtx()
  return { width: 0, height: 0, ctx, getContext: () => ctx }
}

function layerWith(viewW = 400, viewH = 300) {
  const layer = makeWeatherLayer(fakeCanvas)
  layer.resize(viewW, viewH)
  return layer
}

const cam = { camX: 0, camY: 0 }
const view = { W: 400, H: 300 }
const S = 32

describe('makeWeatherLayer', () => {
  it('holds two quarter-resolution canvases sized on resize', () => {
    const layer = layerWith(401, 301)
    assert.equal(layer.k, 0.25)
    assert.equal(layer.w, 101)
    assert.equal(layer.h, 76)
    assert.equal(layer.canvas.width, 101)
    assert.equal(layer.mask.width, 101)
    assert.equal(layer.mask.height, 76)
  })
})

describe('fogBlobs', () => {
  const fog = { cx: 57, cy: 40, radius: 9, cells: [] }

  it('makes 16 deterministic blobs inside the radius and memoises them', () => {
    const blobs = fogBlobs(fog)
    assert.equal(blobs.length, 16)
    for (const b of blobs) {
      assert.ok(Math.hypot(b.x - 57.5, b.y - 40.5) <= 9)
      assert.ok(b.r >= 1.5 && b.r <= 3)
    }
    assert.equal(fogBlobs(fog), blobs)
    assert.deepEqual(fogBlobs({ ...fog, cells: [] }), blobs)   // same anchor → same blobs
  })
})

describe('drawNight', () => {
  const look = (over = {}) => ({ dark: 0.85, ambient: [40, 60, 120], fog: 1, t: 0, lights: [], ...over })

  it('draws nothing when dark is 0', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawNight(ctx, layer, look({ dark: 0 }), cam, view, S)
    assert.deepEqual(ctx.ops, [])
    assert.deepEqual(layer.ctx.ops, [])
  })

  it('fills the layer with the ambient colour and blits it with multiply at the dark alpha, smoothed', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawNight(ctx, layer, look(), cam, view, S)
    const fill = layer.ctx.ops.find(o => o.name === 'fillRect')
    assert.equal(fill.fillStyle, 'rgb(40,60,120)')
    assert.deepEqual(fill.a, [0, 0, 100, 75])
    const blit = ctx.ops.find(o => o.name === 'drawImage')
    assert.equal(blit.img, layer.canvas)
    assert.equal(blit.gco, 'multiply')
    assert.equal(blit.alpha, 0.85)
    assert.equal(blit.smooth, true)
    assert.deepEqual(blit.a, [0, 0, 100, 75, 0, 0, 400, 300])
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing restored')
  })

  it('punches a destination-out hole per light in the layer and adds a lighter glow on the frame', () => {
    const ctx = recordingCtx(), layer = layerWith()
    const light = { px: 100, py: 100, r: 4.5, strength: 1, grey: false }
    drawNight(ctx, layer, look({ lights: [light] }), cam, view, S)
    const hole = layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'destination-out')
    assert.equal(hole.length, 1)
    const r = 4.5 * 32 * 0.25
    assert.deepEqual(hole[0].a, [25 - r, 25 - r, 2 * r, 2 * r])
    const glow = ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'lighter')
    assert.equal(glow.length, 1)
    const blitIdx = ctx.ops.findIndex(o => o.name === 'drawImage')
    assert.ok(ctx.ops.indexOf(glow[0]) > blitIdx, 'glow lands after the wash')
  })

  it('skips lights that are off the layer', () => {
    const ctx = recordingCtx(), layer = layerWith()
    const far = { px: 5000, py: 5000, r: 2, strength: 1, grey: false }
    drawNight(ctx, layer, look({ lights: [far] }), cam, view, S)
    assert.equal(layer.ctx.ops.filter(o => o.gco === 'destination-out').length, 0)
    assert.equal(ctx.ops.filter(o => o.gco === 'lighter').length, 0)
  })
})

describe('drawFog', () => {
  const look = (over = {}) => ({ dark: 0, ambient: [255, 255, 255], fog: 1, t: 3, lights: [], ...over })
  const fog = { cx: 5, cy: 4, radius: 3, cells: [{ x: 5, y: 4, w: 1 }, { x: 6, y: 4, w: 0.5 }] }

  it('draws nothing without fog, below the fog floor, or with no cell in view', () => {
    let ctx = recordingCtx(), layer = layerWith()
    drawFog(ctx, layer, look(), null, cam, view, S)
    assert.deepEqual(ctx.ops, [])
    drawFog(ctx, layer, look({ fog: 0.01 }), fog, cam, view, S)
    assert.deepEqual(ctx.ops, [])
    drawFog(ctx, layer, look(), fog, { camX: 10000, camY: 10000 }, view, S)
    assert.deepEqual(ctx.ops, [])
  })

  it('paints blobs, masks them through a blurred cell mask, and blits at 0.85 × fog level', () => {
    const ctx = recordingCtx(), layer = layerWith()
    drawFog(ctx, layer, look({ fog: 0.5 }), fog, cam, view, S)
    // blobs: source-over gradient fills in the layer
    assert.ok(layer.ctx.ops.some(o => o.name === 'fillRect' && o.gco === 'source-over'))
    // mask: one blurred rect per visible cell, alpha from the cell weight
    const maskRects = layer.maskCtx.ops.filter(o => o.name === 'fillRect')
    assert.equal(maskRects.length, 2)
    assert.equal(maskRects[0].filter, 'blur(2px)')
    assert.equal(maskRects[0].fillStyle, 'rgba(0,0,0,1)')
    assert.deepEqual(maskRects[0].a, [5 * 32 * 0.25, 4 * 32 * 0.25, 8, 8])
    assert.equal(maskRects[1].fillStyle, 'rgba(0,0,0,0.5)')
    // mask applied with one destination-in drawImage of the mask canvas
    const applied = layer.ctx.ops.filter(o => o.name === 'drawImage')
    assert.equal(applied.length, 1)
    assert.equal(applied[0].img, layer.mask)
    assert.equal(applied[0].gco, 'destination-in')
    // final blit
    const blit = ctx.ops.find(o => o.name === 'drawImage')
    assert.equal(blit.img, layer.canvas)
    assert.equal(blit.gco, 'source-over')
    assert.ok(Math.abs(blit.alpha - 0.425) < 1e-9)
    assert.equal(blit.smooth, true)
    assert.equal(ctx.imageSmoothingEnabled, false, 'smoothing restored')
  })

  it('moves the blobs with the animation timer', () => {
    const a = recordingCtx(), b = recordingCtx(), layer = layerWith()
    drawFog(a, layer, look({ t: 0 }), fog, cam, view, S)
    const first = layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'source-over').map(o => o.a)
    layer.ctx.ops.length = 0
    drawFog(b, layer, look({ t: 5 }), fog, cam, view, S)
    const second = layer.ctx.ops.filter(o => o.name === 'fillRect' && o.gco === 'source-over').map(o => o.a)
    assert.notDeepEqual(first, second)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/render-weather.test.js`
Expected: FAIL — `Cannot find module '.../renderer/render/weather.js'`

- [ ] **Step 3: Implement the render module**

Create `renderer/render/weather.js`:

```js
// Weather painting (docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md).
// Two passes through one quarter-resolution layer: the night wash (multiply,
// with holes punched around fires, drawn before flames so they stay bright)
// and the pier fog (drifting blobs masked to the water cells, drawn after
// flames and over everything on the water). Phases come from look.t — the
// surface animation timer — never the wall clock.

const LAYER_SCALE = 0.25
const BLOB_COUNT = 16
const BLOB_ALPHA = 0.55
const DRIFT_TILES = 0.8      // sine drift amplitude
const FOG_ALPHA = 0.85       // × look.fog
const GLOW_ALPHA = 0.22
const GLOW_RADIUS = 0.6      // × the light's hole radius
const FOG_FLOOR = 0.02

// Two offscreen canvases: `canvas` receives the paint, `mask` the blurred
// cell weights that clip the fog. `createCanvas` is injected so the renderer
// can pass document.createElement and tests a stub.
export function makeWeatherLayer(createCanvas) {
  const canvas = createCanvas(), mask = createCanvas()
  const layer = {
    canvas, ctx: canvas.getContext('2d'), mask, maskCtx: mask.getContext('2d'),
    w: 0, h: 0, k: LAYER_SCALE,
    resize(viewW, viewH) {
      layer.w = Math.ceil(viewW * LAYER_SCALE)
      layer.h = Math.ceil(viewH * LAYER_SCALE)
      canvas.width = mask.width = layer.w
      canvas.height = mask.height = layer.h
    },
  }
  return layer
}

// Reset a layer context to a known state before a pass.
function prep(L, w, h) {
  L.setTransform(1, 0, 0, 1, 0, 0)
  L.globalCompositeOperation = 'source-over'
  L.globalAlpha = 1
  L.filter = 'none'
  L.clearRect(0, 0, w, h)
}

function radial(L, x, y, r, inner, outer) {
  const g = L.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  return g
}

const onLayer = (x, y, r, layer) => x + r >= 0 && y + r >= 0 && x - r <= layer.w && y - r <= layer.h

// Blit the layer over the frame with smoothing on, restoring the nearest-
// neighbour state the rest of the renderer relies on.
function blit(ctx, layer, gco, alpha, W, H) {
  ctx.save()
  ctx.globalCompositeOperation = gco
  ctx.globalAlpha = alpha
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(layer.canvas, 0, 0, layer.w, layer.h, 0, 0, W, H)
  ctx.imageSmoothingEnabled = false   // explicit, not just via restore: the rest of the frame is nearest-neighbour
  ctx.restore()
}

export function drawNight(ctx, layer, look, { camX, camY }, { W, H }, S) {
  if (!(look.dark > 0)) return
  const L = layer.ctx, k = layer.k
  prep(L, layer.w, layer.h)
  const [r, g, b] = look.ambient
  L.fillStyle = `rgb(${r},${g},${b})`
  L.fillRect(0, 0, layer.w, layer.h)
  L.globalCompositeOperation = 'destination-out'
  const visible = []
  for (const l of look.lights) {
    const x = (l.px - camX) * k, y = (l.py - camY) * k, rad = l.r * S * k
    if (!onLayer(x, y, rad, layer)) continue
    visible.push(l)
    L.fillStyle = radial(L, x, y, rad, `rgba(0,0,0,${l.strength})`, 'rgba(0,0,0,0)')
    L.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }
  L.globalCompositeOperation = 'source-over'
  blit(ctx, layer, 'multiply', look.dark, W, H)

  if (!visible.length) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const l of visible) {
    const x = l.px - camX, y = l.py - camY, rad = l.r * S * GLOW_RADIUS
    const flick = 1 + 0.08 * Math.sin(look.t * 9 + l.px)
    const a = GLOW_ALPHA * l.strength * look.dark * flick
    const c = l.grey ? '170,190,220' : '255,160,60'
    ctx.fillStyle = radial(ctx, x, y, rad, `rgba(${c},${a})`, `rgba(${c},0)`)
    ctx.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }
  ctx.restore()
}

// Deterministic 0..1 from an integer — enough to scatter blobs repeatably.
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const blobCache = new WeakMap()

// Sixteen blobs scattered inside the fog radius (tile units, cell centres),
// each with its own size and two slow sine drift terms. Memoised per fog.
export function fogBlobs(fog) {
  let blobs = blobCache.get(fog)
  if (blobs) return blobs
  blobs = []
  for (let i = 0; i < BLOB_COUNT; i++) {
    const ang = hash(i * 7 + 1) * Math.PI * 2
    const dist = Math.sqrt(hash(i * 7 + 2)) * fog.radius * 0.85
    blobs.push({
      x: fog.cx + 0.5 + Math.cos(ang) * dist,
      y: fog.cy + 0.5 + Math.sin(ang) * dist,
      r: 1.5 + hash(i * 7 + 3) * 1.5,
      a: 0.25 + hash(i * 7 + 4) * 0.2,
      b: 0.2 + hash(i * 7 + 5) * 0.2,
      p1: hash(i * 7 + 6) * Math.PI * 2,
      p2: hash(i * 7 + 7) * Math.PI * 2,
    })
  }
  blobCache.set(fog, blobs)
  return blobs
}

export function drawFog(ctx, layer, look, fog, { camX, camY }, { W, H }, S) {
  if (!fog || !(look.fog >= FOG_FLOOR)) return
  const c0 = Math.floor(camX / S), c1 = Math.ceil((camX + W) / S)
  const r0 = Math.floor(camY / S), r1 = Math.ceil((camY + H) / S)
  const cells = fog.cells.filter(c => c.x >= c0 && c.x < c1 && c.y >= r0 && c.y < r1)
  if (!cells.length) return
  const L = layer.ctx, M = layer.maskCtx, k = layer.k

  prep(L, layer.w, layer.h)
  for (const b of fogBlobs(fog)) {
    const wx = (b.x + Math.sin(look.t * b.a + b.p1) * DRIFT_TILES) * S
    const wy = (b.y + Math.cos(look.t * b.b + b.p2) * DRIFT_TILES) * S
    const x = (wx - camX) * k, y = (wy - camY) * k, rad = b.r * S * k
    if (!onLayer(x, y, rad, layer)) continue
    L.fillStyle = radial(L, x, y, rad, `rgba(255,255,255,${BLOB_ALPHA})`, 'rgba(255,255,255,0)')
    L.fillRect(x - rad, y - rad, 2 * rad, 2 * rad)
  }

  prep(M, layer.w, layer.h)
  M.filter = 'blur(2px)'
  for (const c of cells) {
    M.fillStyle = `rgba(0,0,0,${c.w})`
    M.fillRect((c.x * S - camX) * k, (c.y * S - camY) * k, S * k, S * k)
  }
  M.filter = 'none'

  L.globalCompositeOperation = 'destination-in'
  L.drawImage(layer.mask, 0, 0)
  L.globalCompositeOperation = 'source-over'

  blit(ctx, layer, 'source-over', FOG_ALPHA * look.fog, W, H)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/render-weather.test.js`
Expected: PASS.

If the `fogBlobs` "same anchor → same blobs" assertion fails because `deepEqual` compares a fresh array against the memoised one: they are built from the same hash inputs, so the values must match exactly — a failure there is a real determinism bug, not a test bug.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/weather.js test/render-weather.test.js
git commit -m "feat(weather): render module — quarter-res layer, night wash with fire holes, masked drifting fog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JKD5tUBvx2cfSrUn4mBquj"
```

---

### Task 4: Renderer integration — layer ownership and the two insertion points

**Files:**
- Modify: `renderer/render/canvas.js:1-18` (imports), `:864-874` (constructor), `:902-911` (`resize`), `:1025-1084` (insertion points in `render`)
- Test: `test/canvas.test.js`

**Interfaces:**
- Consumes: `makeWeatherLayer`, `drawNight`, `drawFog` (Task 3); `state.weather.look` and `state.weather.fog` (Task 2 shapes, `look` set by Task 5).
- Produces: `new Renderer(canvas, { weatherLayer })` — the option overrides the document-backed layer; `Renderer.render` calls `drawNight` after the rite post-effect and before fire zones, and `drawFog` after hit effects and before `_drawFeedback`; `resize()` resizes the layer.

- [ ] **Step 1: Write the failing tests**

Append to `test/canvas.test.js` (add `import { createMap } from '../renderer/systems/map.js'` at the top; `Renderer` and `TILE` are already imported):

```js
describe('Renderer.render weather layers', () => {
  // Records draws with the composite op in force so the two weather blits
  // (multiply wash, fog) can be told apart from everything else.
  function orderCtx() {
    const ops = []
    let gco = 'source-over', alpha = 1, fs = ''
    const base = {
      ops, imageSmoothingEnabled: false,
      drawImage: (img) => ops.push({ name: 'drawImage', img, gco }),
      fillRect: (...a) => ops.push({ name: 'fillRect', a, gco, fs }),
      clearRect: () => {},
      createRadialGradient: () => ({ addColorStop() {} }),
      setTransform() {},
      get fillStyle() { return fs }, set fillStyle(v) { fs = v },
      get globalAlpha() { return alpha }, set globalAlpha(v) { alpha = v },
      get globalCompositeOperation() { return gco }, set globalCompositeOperation(v) { gco = v },
      get filter() { return 'none' }, set filter(_v) {},
    }
    return new Proxy(base, {
      get(t, p, r) { if (p in t) return Reflect.get(t, p, r); return (...args) => { ops.push({ name: p, args }) } },
    })
  }

  function stubLayer() {
    const canvas = { id: 'LAYER', width: 0, height: 0 }, mask = { id: 'MASK', width: 0, height: 0 }
    const layer = { canvas, ctx: orderCtx(), mask, maskCtx: orderCtx(), w: 32, h: 24, k: 0.25, resized: [],
      resize(w, h) { layer.resized.push([w, h]) } }
    return layer
  }

  function scene(weather) {
    const map = createMap(4, 3)
    for (const row of map) for (const c of row) { c.tile = TILE.FLOOR; c.explored = true; c.visible = true }
    const player = { x: 1, y: 1, px: 48, py: 48, facing: 'south', invulnTimer: 0, hp: 5, maxHp: 5, inventory: [] }
    return { map, player, entities: [], projectiles: [], shockwaves: [], hitEffects: [],
      fireZones: [{ tiles: [{ x: 0, y: 0 }], age: 0 }],
      feedback: { floats: [], bubble: null, banner: null, toasts: [] },
      weather }
  }

  function renderScene(weather) {
    const ctx = orderCtx()
    const canvas = { width: 128, height: 96, offsetWidth: 128, offsetHeight: 96, getContext: () => ctx }
    const layer = stubLayer()
    const r = new Renderer(canvas, { weatherLayer: layer })
    r.viewW = 128; r.viewH = 96
    const state = scene(weather)
    r.updateCamera(state.player, 0)
    r.render(state, null)
    return { ops: ctx.ops, layer }
  }

  // The first flame rect is the fire-zone loop's red '#ef4444' fill.
  const flameIdx = ops => ops.findIndex(o => o.name === 'fillRect' && o.fs === '#ef4444')
  const feedbackIdx = ops => ops.findIndex(o => o.name === 'fillText' || o.name === 'strokeText' || o.name === 'font')

  it('draws no weather when the map has none', () => {
    const { ops } = renderScene(null)
    assert.equal(ops.some(o => o.name === 'drawImage' && o.img.id === 'LAYER'), false)
  })

  it('blits the multiply wash after the entities and before the flames', () => {
    const fog = { cx: 1, cy: 1, radius: 2, cells: [] }
    const look = { dark: 0.85, ambient: [40, 60, 120], fog: 0, t: 0, lights: [] }
    const { ops } = renderScene({ dayCycle: true, t: 0, fog, look })
    const wash = ops.findIndex(o => o.name === 'drawImage' && o.img.id === 'LAYER' && o.gco === 'multiply')
    assert.ok(wash >= 0, 'wash drawn')
    assert.ok(wash < flameIdx(ops), 'wash before flames')
    assert.ok(wash > ops.findIndex(o => o.name === 'fillRect'), 'wash after the first tile')
  })

  it('blits the fog after the flames and before the feedback layer', () => {
    const fog = { cx: 1, cy: 1, radius: 2, cells: [{ x: 1, y: 1, w: 1 }] }
    const look = { dark: 0, ambient: [255, 255, 255], fog: 1, t: 0, lights: [] }
    const { ops } = renderScene({ dayCycle: true, t: 0, fog, look })
    const fogBlit = ops.findIndex(o => o.name === 'drawImage' && o.img.id === 'LAYER' && o.gco === 'source-over')
    assert.ok(fogBlit >= 0, 'fog drawn')
    assert.ok(fogBlit > flameIdx(ops), 'fog after flames')
    const fb = feedbackIdx(ops)
    assert.ok(fb === -1 || fogBlit < fb, 'fog before feedback')
    assert.equal(ops.some(o => o.name === 'drawImage' && o.gco === 'multiply'), false, 'no wash by day')
  })

  it('skips weather when look is null (underground)', () => {
    const fog = { cx: 1, cy: 1, radius: 2, cells: [{ x: 1, y: 1, w: 1 }] }
    const { ops } = renderScene({ dayCycle: true, t: 0, fog, look: null })
    assert.equal(ops.some(o => o.name === 'drawImage' && o.img.id === 'LAYER'), false)
  })

  it('resizes the layer with the view', () => {
    const ctx = orderCtx()
    const canvas = { width: 0, height: 0, offsetWidth: 200, offsetHeight: 100, getContext: () => ctx }
    const layer = stubLayer()
    const r = new Renderer(canvas, { weatherLayer: layer })
    r.resize()
    assert.deepEqual(layer.resized.at(-1), [200, 100])
  })

  it('has no layer when there is no document and no injection', () => {
    const ctx = orderCtx()
    const canvas = { width: 0, height: 0, offsetWidth: 200, offsetHeight: 100, getContext: () => ctx }
    const r = new Renderer(canvas)
    assert.equal(r.weatherLayer, null)
    assert.doesNotThrow(() => r.resize())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/canvas.test.js`
Expected: FAIL — "blits the multiply wash…" fails on `wash drawn` (no `LAYER` drawImage), "resizes the layer" fails (`resized` empty), "has no layer" fails (`weatherLayer` undefined).

- [ ] **Step 3: Wire the layer into `Renderer`**

In `renderer/render/canvas.js`, add to the imports (after the `monsters.js` import):

```js
import { makeWeatherLayer, drawNight, drawFog } from './weather.js'
```

Replace the constructor:

```js
  // `weatherLayer` is injectable for tests; in the app it is the pair of
  // quarter-resolution offscreen canvases the weather passes paint through.
  constructor(canvas, { weatherLayer } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.ctx.imageSmoothingEnabled = false
    this.S = TILE_SIZE
    this.viewW = canvas.width
    this.viewH = canvas.height
    this.camX = 0
    this.camY = 0
    this.debug = false
    this.sprites = {}
    this.weatherLayer = weatherLayer
      ?? (typeof document !== 'undefined' ? makeWeatherLayer(() => document.createElement('canvas')) : null)
  }
```

In `resize()`, after `this.ctx.imageSmoothingEnabled = false`:

```js
    this.weatherLayer?.resize(this.viewW, this.viewH)
```

In `render()`, immediately after the rite post-effect block (the `if (fx && (fx.blur > 0 || fx.greenAlpha > 0)) { … }` closing brace) and before the `// Fireball zones` comment, insert:

```js
    // Weather, pass one: the night wash with holes punched around fires —
    // before the flames so they stay bright. look is null underground.
    const look = state.weather?.look
    const weatherCam = { camX, camY }, weatherView = { W, H }
    if (look && this.weatherLayer) drawNight(ctx, this.weatherLayer, look, weatherCam, weatherView, S)
```

and immediately before `this._drawFeedback(state)` insert:

```js
    // Weather, pass two: mist over the water, planks, creatures and player —
    // under floats, bubbles and banners.
    if (look && this.weatherLayer) drawFog(ctx, this.weatherLayer, look, state.weather.fog, weatherCam, weatherView, S)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/canvas.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(weather): Renderer owns the weather layer; night wash before flames, fog before feedback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JKD5tUBvx2cfSrUn4mBquj"
```

---

### Task 5: Game wiring, docs, and the live check

**Files:**
- Modify: `renderer/game.js:59` (imports), `:173` (debug hook), `:536-570` (`startNewRun` state), `:867-880` (surface tick), `:1560-1567` (`render`)
- Modify: `/home/lappemikb/CLAUDE.md:279`
- Test: `npm test`, then a time-boxed live check

**Interfaces:**
- Consumes: `makeWeather`, `advanceClock`, `weatherLook` (Tasks 1–2); `Renderer` reads `state.weather.look` (Task 4).
- Produces: `state.weather` on every open-map surface state; `window.__dc.save` under `--dcdebug`.

- [ ] **Step 1: Import and build on arrival**

In `renderer/game.js`, add after line 59 (the `stamina.js` import):

```js
import { makeWeather, advanceClock, weatherLook } from './systems/weather.js'
```

In `startNewRun`, in the `state = { … }` literal, add after `npcWrath: !!npcRecord?.hostile,`:

```js
    // Weather (day clock + pier fog) for maps with a config entry; null
    // elsewhere. Cave/interior states spread this along — look is nulled
    // underground and the clock only moves on surface frames.
    weather: OPEN_MAPS[depth] ? makeWeather(OPEN_MAPS[depth]) : null,
```

- [ ] **Step 2: Advance on surface frames**

In `update(delta)`, directly after the leap-episode block (`if (state.epCtx && !state.cave) { … }` closing brace), add:

```js
  // Weather runs on the surface only: the animation timer always, the day
  // clock when the map has a cycle. Underground both hold.
  if (state.weather && !state.cave) {
    state.weather.t += delta
    if (state.weather.dayCycle) advanceClock(activeSave, delta)
  }
```

- [ ] **Step 3: Compute the look before rendering**

In `render()`, replace the body's `const fx = riteVisuals(state)` line with:

```js
  const fx = riteVisuals(state)
  if (state.weather) state.weather.look = state.cave ? null : weatherLook(state, activeSave)
```

- [ ] **Step 4: Expose the save to the debug hook**

Replace line 173:

```js
  window.__dc = { get state() { return state }, get save() { return activeSave } }
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Live check (time-box: 15 minutes, stop when the two screenshots exist)**

Copy the driver so it launches with the debug flag (do not edit the shared one):

```bash
SCRATCH=/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/3d440a9f-15f3-44a3-8d32-ba4dc7e47891/scratchpad
sed "s/args: \['--no-sandbox', APP_DIR\]/args: ['--no-sandbox', '--dcdebug', APP_DIR]/" .claude/skills/run-game/driver.mjs > $SCRATCH/driver-dbg.mjs
sed -i "s#path.resolve(__dirname, '../../..')#'$(pwd)'#" $SCRATCH/driver-dbg.mjs
mkfifo $SCRATCH/cmd 2>/dev/null
DISPLAY=:0 SCREENSHOT_DIR=$SCRATCH/shots node $SCRATCH/driver-dbg.mjs < $SCRATCH/cmd > $SCRATCH/driver.log 2>&1 &
exec 3> $SCRATCH/cmd
echo launch >&3; sleep 8
```

Then, one command at a time with a `sleep 1` between each (the driver does not serialise lines):

```bash
echo "press l" >&3; echo "press e" >&3; echo "press v" >&3; echo "press e" >&3; echo "press l" >&3; echo "press 8" >&3; sleep 4
echo "ss lake-day" >&3; sleep 2
echo "eval (window.__dc.save.clock = 0.80 * 360, 'dusk')" >&3; sleep 1
echo "ss lake-dusk" >&3; sleep 2
echo "eval (window.__dc.save.clock = 0, 'midnight')" >&3; sleep 1
echo "ss lake-midnight" >&3; sleep 2
```

Walk the player east along row 40 to the pier (spawn is (12,41); the pier logs start at x=50) with a held key:

```bash
echo "eval (window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'})), 'go')" >&3; sleep 9
echo "eval (window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'})), 'stop')" >&3; sleep 1
echo "eval JSON.stringify({x: window.__dc.state.player.x, y: window.__dc.state.player.y, clock: window.__dc.save.clock})" >&3; sleep 1
echo "ss pier-night" >&3; sleep 2
echo "eval (window.__dc.save.clock = 0.20 * 360, 'dawn')" >&3; sleep 1
echo "ss pier-dawn" >&3; sleep 2
echo quit >&3
```

Read the screenshots with the Read tool. Accept when: `lake-midnight` is clearly darker and bluer than `lake-day`; `pier-night`/`pier-dawn` show soft mist over the water around the pier that stops at the shore; `lake-dusk` is warm. If night crushes the pier or player to unreadable, lower `KEYFRAMES[0].dark`/`[6].dark`/`[7].dark` in `renderer/systems/weather.js` (0.85 → 0.75) and update the two `0.85` assertions in `test/weather.test.js`; if the fog hides the planks entirely, lower `FOG_ALPHA` in `renderer/render/weather.js` (0.85 → 0.7) and the `0.425` assertion in `test/render-weather.test.js`. Re-run `npm test` after any tuning.

Clean up: `rm -f $SCRATCH/driver-dbg.mjs $SCRATCH/cmd` and confirm `git status --porcelain renderer/data/` shows nothing (no autosave drift).

- [ ] **Step 7: Document**

In `/home/lappemikb/CLAUDE.md`, line 279, extend the `renderer/render/` bullet by appending before its closing newline:

```
, `weather` (day-cycle night wash with campfire glow and pier fog, painted through a quarter-res layer from `systems/weather.js`'s per-frame look; per-map opt-in in `data/weather.js`, the six-minute clock lives on the save as `clock`)
```

so the line ends `…M mutes), `weather` (…)`.

- [ ] **Step 8: Commit**

`/home/lappemikb/CLAUDE.md` is outside the repo and not under any git repo (verified) — edit it in place, commit only the game file:

```bash
git add renderer/game.js
git commit -m "feat(weather): wire the clock, fog and night pass into the game; day cycle and pier fog on Toivo's Lake

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JKD5tUBvx2cfSrUn4mBquj"
```

---

## Self-review

- **Spec coverage:** §1 config → Task 1; §2 clock/persistence → Tasks 1 and 5 (surface-only advance, rite early-return untouched); §3 pure module → Tasks 1–2 (`makeWeather`, `dayPhase`, `lightSources`, `weatherLook`); §4 rendering → Tasks 3–4 (layer, night pass placement, fog pass placement, smoothing restore, blur mask, cost); §5 wiring → Task 5; §6 testing → every task plus the live check; §7 files → the file map.
- **Placeholders:** none; every code step is complete.
- **Type consistency:** `look = { dark, ambient, fog, t, lights }` and `fog = { cx, cy, radius, cells: [{x,y,w}] }` are identical in Tasks 2, 3 and 4; `lights` entries are `{ px, py, r, strength, grey }` throughout; `layer = { canvas, ctx, mask, maskCtx, w, h, k, resize }` matches between Task 3's factory and Task 4's stub; `Renderer(canvas, { weatherLayer })` is used identically in Task 4's tests and Task 5's runtime (default path).
