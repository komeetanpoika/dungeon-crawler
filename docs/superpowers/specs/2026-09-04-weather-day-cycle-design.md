# Weather: day cycle and pier fog — design

Adds a small, opt-in weather system to the open maps and switches it on for
Toivo's Lake (`lake-1-ferry`, depth 8): a six-minute day/night cycle with
deep, moonlit-blue nights lit by campfires, and mist that drifts over the
water around the pier, thickest from dusk through dawn. Builds on
`2026-08-29-leap-episodes-design.md` (the ferry episode) and the renderer
described in `2026-08-26-stamina-and-hud-design.md` (overlay HUD is DOM).

## Goal

The lake should feel like a place with weather. Two effects, both purely
atmospheric:

1. **A day cycle.** Sky light moves dawn → day → dusk → night and back, one
   full day every 6 real minutes on the map. Night is dark; fires glow.
2. **Pier fog.** Mist lies on the water around the pier, over the planks, the
   Näkki and the player, thin at midday and heavy at dawn and night.

Both are built as a generic per-map system so a map opts in with one config
line. The first cut enabled only Toivo's Lake; the day cycle was then switched
on for every open map (see the Non-goals addendum).

## Non-goals

- **No gameplay ties.** Field of view, enemy perception, NPC behaviour, the
  Näkki, episode flags and the runestone rule are untouched. Night darkens
  the frame; it does not hide anything the player could see by day.
- **No ambient sound.** The cue system is one-shot only and nothing here
  needs a looping bed.
- **No rain/snow/wind, no fog outside the lake.** The config table is the
  extension point. (Addendum 2026-09-04: every open map now carries
  `dayCycle: true` — the Adventure chain on its one shared clock, each
  Timewarp episode on its own — so "lake only" applies to the fog, not the
  day cycle.)
- **No save version bump.** The clock is one additive field with a default.
- **No changes to the generated `open-maps.js`.**

## 1. Config

New hand-authored module `renderer/data/weather.js`, keyed by map name like
`EPISODES` in `data/leaps.js` (the open-maps file is generated and would
clobber a flag):

```js
export const DAY_LENGTH = 360              // seconds per in-game day
export const DAY_START = 0.30 * DAY_LENGTH // a fresh save wakes mid-morning
export const WEATHER = {
  'lake-1-ferry': { dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } },
}
export const weatherFor = mapData => WEATHER[mapData?.name] ?? null
```

- `dayCycle: true` — the map advances the clock and draws the night pass.
- `fog: { at, radius }` — `at` is a POI label (the middle pier gap, at the
  centre of the pier row); `radius` is in tiles. Fog covers open-water cells
  within that radius, fading to nothing at the edge. Omit `fog` for a map
  with a day cycle but no mist.

## 2. Clock and persistence

- The clock is `save.clock`, seconds into the day in `[0, DAY_LENGTH)`, a
  top-level field on the adventure-shaped save. `normalizeAdventureSave`
  defaults it to `DAY_START` (additive migration, no version flag). Timewarp
  mini-saves are normalised by the same function, so every episode has its
  own clock, matching "one clock per save".
- `advanceClock(save, delta)` adds `delta` and wraps. `game.js` calls it from
  `update(delta)` on the surface frame only (the same `!state.cave` gate the
  episode tick uses) and only when `state.weather?.dayCycle` is set. Caves,
  house interiors, dungeon-rush depths and maps without config never move it.
- The clock lives on `activeSave` in memory and reaches disk on the existing
  `persistRun()` flushes. No new flush points. Losing a few seconds of
  daylight on a crash is acceptable.
- The rite cutscene early-returns from `update` before the clock advances, so
  time holds its breath with the rest of the world.

## 3. Pure weather module — `renderer/systems/weather.js`

No canvas or DOM imports, testable under `node:test`.

### `makeWeather(mapData)` → `state.weather | null`

Built once in `startNewRun` for open maps with a config entry, stored on the
surface state (cave states have no `weather`, so nothing draws underground).

```js
{ dayCycle: true, t: 0,
  fog: { cx, cy, radius, cells: [{ x, y, w }] } | null }
```

- `t` is the weather animation timer, advanced by `delta` on every surface
  frame the map is active. It is separate from the day clock so the clock's
  wrap at 360 s never jumps the fog drift.
- `fog.cells`: every cell whose palette skin starts with `ow_water_` (the
  same predicate `openmap.js` uses for `losClear`) within `radius` tiles
  (Euclidean, cell centres) of the anchor POI. `w` is a smoothstep weight
  from 1 at the anchor to 0 at the radius. A missing POI yields `fog: null`
  and a console warning, never a throw.

### `dayPhase(clock)` → `{ frac, dark, ambient: [r, g, b], fog }`

Linear interpolation between keyframes at fixed fractions of the day. The
values below are the starting tuning; they are constants at the top of the
module so the live check can adjust them.

| frac | name    | dark | ambient (multiply colour) | fog |
|------|---------|------|---------------------------|-----|
| 0.00 | night   | 0.85 | `[40, 60, 120]` cold blue | 1.0 |
| 0.20 | dawn    | 0.45 | `[230, 140, 110]` pink-orange | 1.0 |
| 0.30 | morning | 0.05 | `[255, 240, 220]` warm white | 0.5 |
| 0.50 | noon    | 0.00 | `[255, 255, 255]` | 0.15 |
| 0.70 | evening | 0.10 | `[255, 210, 150]` gold | 0.3 |
| 0.80 | dusk    | 0.50 | `[220, 110, 80]` orange-red | 0.8 |
| 0.90 | night   | 0.85 | `[40, 60, 120]` | 1.0 |
| 1.00 | (wraps to 0.00) | | | |

- `dark` is the multiply layer's alpha. At 0 the night pass is skipped.
- `fog` scales the fog layer's alpha; the fog pass is skipped below 0.02.
- `DAY_START` (0.30) puts a fresh save at "morning", so the first visit is
  clear daylight and the first dusk arrives after about three minutes.

### `lightSources(state)` → `[{ px, py, r, strength, grey }]`

- Every `campfire` entity: `r = 4.5` tiles, `strength = campfireAlpha(fire)`,
  `grey = isDeadwoodFire(fire)` (the hermit hearth glows grey-blue, a lumber
  fire warm orange). Eternal fires are strength 1.
- Every burning `fireZones` tile: `r = 2` tiles, `strength` = the zone's
  fade (same `(3 - age) / 0.7` clamp the flame draw uses).
- Nothing else emits light. The player carries no lantern.

### `weatherLook(state, save)` → the per-frame object for the renderer

```js
{ dark, ambient, fog, t, lights }   // or null when state.weather is null
```

`game.js` computes it once per frame in `render()` (alongside `riteVisuals`)
and stores it on `state.weather.look`. `Renderer.render` reads only
`state.weather` and never touches the save.

## 4. Rendering — `renderer/render/weather.js`

One offscreen **layer canvas at quarter resolution** (`ceil(viewW/4)` ×
`ceil(viewH/4)`), created by `Renderer` via `document.createElement('canvas')`
and resized in `resize()`. The `Renderer` constructor accepts an optional
`weatherLayer` so tests can inject a stub with a recording context. Both
passes draw into this one layer, clearing it between uses, and blit it back
up with `imageSmoothingEnabled = true` for that draw only (the main context
stays nearest-neighbour for everything else).

### Night pass — `drawNight(ctx, layer, look, cam, view, S)`

Inserted in `Renderer.render` **after the projectiles and rite post-effect and
before the fire-zone flames**, so flames and later effects stay bright.

1. Skip when `look.dark <= 0`.
2. In the layer: fill with `rgb(ambient)`, then for each light in view punch
   a hole with a radial gradient (`destination-out`, alpha 1 × strength at the
   centre → 0 at `r`), so the ground around a fire keeps its daylight colour.
3. Blit the layer over the frame with `globalCompositeOperation = 'multiply'`
   and `globalAlpha = look.dark`. Multiply keeps sprite detail under the
   wash where a flat black fill would crush it.
4. For each light, add a soft glow: radial gradient with `'lighter'`, warm
   `rgba(255, 160, 60, 0.22 × strength)` (grey fires `rgba(170, 190, 220, …)`),
   flickering by `1 ± 0.08 · sin(look.t · 9 + px)` — the same no-wall-clock
   phase trick the flames use.

The existing per-tile fog-of-war black stays as it is. Depth `theme.tint` is
`null` on every open map and is left alone.

### Fog pass — `drawFog(ctx, layer, look, fog, cam, view, S)`

Inserted **after the fire zones, shockwaves and hit effects and before
`_drawFeedback`**, so it lies over the water, planks, Näkki and player but
under floats, bubbles, banners and the DOM HUD.

1. Skip when `fog` is null, `look.fog < 0.02`, or no fog cell is in view.
2. **Blobs.** A fixed set of 16 blobs, generated deterministically from the
   anchor (`cx, cy`) with a small seeded hash, each with a base offset inside
   the radius, a radius of 1.5–3 tiles, and two sine drift terms. Position at
   time `t` is `base + (sin(t·a + φ₁), cos(t·b + φ₂)) · ~0.8 tile`, moving at
   roughly a third of a tile per second. Each is drawn into the layer as a
   white radial gradient (alpha 0.55 → 0) with `'source-over'`.
3. **Mask.** With `destination-in` and `filter = 'blur(2px)'` (cheap at
   quarter res), fill each fog cell's rect with `rgba(0,0,0,w)`. The blur
   feathers the shoreline by a few screen pixels and smooths the weight
   steps between neighbouring cells; the fog never spreads more than that
   onto land.
4. Blit the layer with `globalAlpha = 0.85 × look.fog`, smoothing on.

Fog cells outside the view are skipped by the same `c0..c1 / r0..r1` clip the
tile loop uses, widened by one cell so a just-off-screen cell's blurred edge
still bleeds correctly into view. There are at most a few hundred cells in
the disc.

### Cost

Per frame: two full-layer fills at quarter res, ≤ 16 gradients, ≤ ~300 small
unblurred rects composited additively (`lighter`) into the mask, one blurred
mask blit (`destination-in`, `filter: blur(2px)`), three upscaled blits.
Well under the rite blur's cost, which redraws the full canvas through a
filter.

## 5. Wiring in `game.js`

- `startNewRun`: `state.weather = OPEN_MAPS[depth] ? makeWeather(OPEN_MAPS[depth]) : null`.
- `update(delta)`, surface frame only: `state.weather.t += delta` and
  `if (state.weather.dayCycle) advanceClock(activeSave, delta)`.
- `render()`: `state.weather.look = weatherLook(state, activeSave)` before
  `renderer.render(state, fx)`.
- Arena (depth 0) and rush depths have no `OPEN_MAPS` entry → `weather` null.
- The web build needs nothing: no new assets or file IO; saves pass through
  the same normaliser.

## 6. Testing

`node --test test/`:

- **`test/weather.test.js`**
  - `advanceClock` adds and wraps at `DAY_LENGTH`; a save with no clock gets
    `DAY_START` from `normalizeAdventureSave`.
  - `dayPhase`: `dark` is 0 at noon, 0.85 at midnight, rises monotonically
    from evening to night and falls from dawn to morning; `fog` is 1 at
    night and 0.15 at noon; wrapping `clock = DAY_LENGTH` equals `0`.
  - `makeWeather` on a hand-written 12×12 `mapData` (palette with an
    `ow_water_0` skin, a `pier gap 2` POI, a grass ring): only water cells
    within the radius are included, weights decrease with distance, the
    anchor cell has `w = 1`, a map without config returns `null`, a config
    whose POI is missing returns `fog: null` without throwing.
  - `lightSources`: campfires carry `campfireAlpha`, a deadwood fire is
    `grey`, fire-zone tiles use the zone fade, an empty state yields `[]`.
- **`test/canvas.test.js`** additions with the existing recording context
  (extended with a `globalCompositeOperation` accessor) and an injected stub
  layer: with `state.weather.look.dark > 0` the multiply blit is recorded
  after the entity sprites and before the first flame rect; with fog cells
  in view the fog blit is recorded after the flames and before the feedback
  ops; with `state.weather = null` neither op appears.
- **Live check** (time-boxed, per the standing rule): launch with `--dcdebug`,
  `level8`, force `activeSave.clock` to dusk and to midnight through the
  debug hook, walk onto the pier, one screenshot each. Adjust the keyframe
  constants if night is unreadable or the fog hides the Näkki's silhouette.

## 7. Files

| File | Change |
|---|---|
| `renderer/data/weather.js` | new — `DAY_LENGTH`, `DAY_START`, `WEATHER`, `weatherFor` |
| `renderer/systems/weather.js` | new — `makeWeather`, `advanceClock`, `dayPhase`, `lightSources`, `weatherLook` |
| `renderer/render/weather.js` | new — `drawNight`, `drawFog`, blob generation |
| `renderer/render/canvas.js` | layer canvas in `Renderer`; two insertion points in `render`; resize |
| `renderer/systems/adventure.js` | `base.clock ??= DAY_START` |
| `renderer/game.js` | build on arrival, advance on surface frames, look before render |
| `test/weather.test.js`, `test/canvas.test.js` | as above |
| `CLAUDE.md` | one line under the dungeon-crawler systems list |
