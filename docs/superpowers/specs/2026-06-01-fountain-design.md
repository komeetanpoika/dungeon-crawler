# Fountain, Gargoyle & Pipe — Placement and Animation Design

**Date:** 2026-06-01

## Summary

Three changes:
1. **Two-tile paired placement** — wall-mounted props (gargoyle, pipe) are placed as pairs with their floor counterpart (basin, drain) directly below, on an inner wall edge of the room.
2. **Floor-adaptive basin rendering** — only the bowl portion (top 11 rows) of the basin sprite is drawn; the floor tile underneath shows through the bottom, matching stone or sand automatically.
3. **Fountain activation animation** — player presses `F` on a basin tile to toggle flow on/off; gargoyle stream pixels cycle downward and basin pixels ripple outward from the stream entry point.

---

## Section 1 — Two-tile paired placement

### Prop types

Single-tile props (table, chair, anvil, barrel, gravestone, grave) are placed exactly as today — one random floor tile per prop.

Paired props require a wall tile on the inner edge of a room and a free floor tile directly below it:

| Wall sprite | Floor sprite | Active variant |
|---|---|---|
| `prop_gargoyle_dry` | `prop_basin_empty` | `prop_gargoyle_flow` / `prop_basin_full` |
| `prop_pipe_dry` | `prop_drain_empty` | `prop_pipe_flow` / `prop_drain_liquid` |

### Pair placement algorithm (in `generateLevel`)

For each room, attempt to place 0–1 paired props (separate from single-tile props):

1. Collect **inner wall candidates**: wall tiles at `room.y` (top inner wall) or `room.y + room.h - 1` (bottom inner wall) where the tile directly below (or above) is a floor tile and not occupied.
2. Shuffle candidates. Pick the first where both the wall tile and the adjacent floor tile are unoccupied.
3. Push two spawns: `{ kind: 'prop', propType: 'prop_gargoyle_dry', x: wx, y: wy, paired: true, pairFloor: 'prop_basin_empty', pairX: wx, pairY: wy+1 }` and `{ kind: 'prop', propType: 'prop_basin_empty', x: wx, y: wy+1, isBasin: true }`.
4. Mark both positions in `occupiedKeys`.

Only place paired props in rooms with `floorTile === 'floor'` (stone, levels 1–3 and 7–9). Sand ruins (4–6) use only single-tile props since the ruins feel abandoned.

### Prop entity fields

```js
// Wall-mounted half
{ type: 'prop', propType: 'prop_gargoyle_dry', x, y,
  paired: true, pairX: x, pairY: y+1, flowing: false }

// Basin half
{ type: 'prop', propType: 'prop_basin_empty', x, y,
  isBasin: true, pairX: x, pairY: y-1, flowing: false }
```

Both entities share `flowing` state — toggled together when the player activates the fountain.

---

## Section 2 — Floor-adaptive basin rendering

### Problem

The basin sprite (`tile_0031` / `tile_0032`) has its bottom 5 rows (y=11–15 of the 16×16 sprite) hardcoded to sand colour `rgba(234,165,108)`. On stone floors this clashes.

### Solution

In `drawEntity` for `type === 'prop'` and `propType` starting with `prop_basin` or `prop_drain`:

1. Draw the floor tile (stone or sand) at the full tile position first.
2. Draw only the **top 11 rows** of the basin/drain sprite using `drawImage`'s source-rect overload:
   ```js
   ctx.drawImage(sprite, 0, 0, 16, 11, px, py, S, Math.round(S * 11/16))
   ```
3. The bottom 5/16 of the tile area shows the underlying floor tile, automatically matching stone or sand.

No colour remapping needed.

---

## Section 3 — Fountain activation animation

### Trigger

Player stands on the basin's floor tile (same x,y) and presses `F`. The game loop checks this in `update()`. Toggling is instant — no cooldown.

### State change on activation

Both the wall-mounted and basin entities have `flowing` toggled:
```js
// In update(), when player at basin tile presses 'F':
basin.flowing = !basin.flowing
wallProp.flowing = !wallProp.flowing
```

Sprite displayed:
- `flowing: false` → `prop_gargoyle_dry` / `prop_basin_empty`
- `flowing: true`  → `prop_gargoyle_flow` / `prop_basin_full`

### Animation data on entities

Each prop entity gets a `fountainTime` field (seconds, advances each frame):
```js
{ type: 'prop', ..., flowing: false, fountainTime: 0 }
```

`fountainTime` increments by `delta` every frame only while `flowing === true`.

### Gargoyle stream animation (12 pixels)

The 12 differing pixels between `tile_0019` (dry) and `tile_0020` (flow) form a 2-wide vertical stream at sprite coords x=7–8, y=10–15.

On each frame when `flowing`, `drawEntity` overpaints those 12 pixels on top of the `garg_flow` sprite. Phase per pixel:

```js
const phase = fountainTime * 4 - py * 0.7  // negative y → moves downward
const s = (Math.sin(phase) + 1) / 2
// Cycle DARK→MID→LIGHT→DARK using s
```

Water palette (from sprite):
- `W_DARK  = [37, 149, 106]`
- `W_MID   = [67, 225, 179]`
- `W_LIGHT = [105, 255, 212]`

Pixels drawn at scale `SC = S / 16` (2px per sprite pixel at 32px tile size).

### Basin ripple animation (44 pixels)

The 44 differing pixels between empty and full basin span x=4–11, y=0–6 of the 16×16 sprite.

Ripple origin: `(7.5, 0.0)` in sprite coords — top centre, where the stream enters the water.

Per pixel phase:
```js
const dx = px + 0.5 - 7.5, dy = py + 0.5 - 0.0
const dist = Math.sqrt(dx*dx + dy*dy)
const phase = fountainTime * 2.5 - dist * 1.8
const s = (Math.sin(phase) + 1) / 2
const amp = Math.max(0, 1 - dist / 9)   // fade with distance
const blend = s * amp + 0.5 * (1 - amp) // blend to midpoint at edges
```

Same three-way colour lerp as gargoyle, same pixel scale. Drawn on top of the `basin_full` sprite.

---

## Sprite additions (`sprites.js`)

New entries needed:

| Key | Tile | Purpose |
|---|---|---|
| `prop_gargoyle_dry` | tile_0019 | dry wall-mount (already `prop_gargoyle_dry`) |
| `prop_gargoyle_flow` | tile_0020 | flowing wall-mount (already `prop_gargoyle_flow`) |
| `prop_basin_empty` | tile_0031 | empty basin (already `prop_fountain_empty`) |
| `prop_basin_full` | tile_0032 | full basin (already `prop_fountain_full`) |
| `prop_drain_empty` | tile_0043 | empty sewage drain |
| `prop_drain_liquid` | tile_0044 | drain with liquid |
| `prop_pipe_dry` | tile_0007 | (already `prop_pipe_dry`) |
| `prop_pipe_flow` | tile_0008 | (already `prop_pipe_flow`) |

Tiles 0043 and 0044 are the only new additions — the rest already exist under different keys.

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/map.js` | Replace gargoyle/pipe/fountain single-prop spawning with paired-prop algorithm; add `prop_drain_*` to sand-level props? No — pairs only on stone levels |
| `renderer/data/levels.js` | Remove `prop_pipe_flow`, `prop_gargoyle_flow`, `prop_fountain_full`, `prop_pipe_dry`, `prop_gargoyle_dry`, `prop_fountain_empty` from `DEPTH_THEMES` room prop palettes — these are now placed as explicit pairs by the map generator, not randomly scattered |
| `renderer/render/sprites.js` | Add `prop_drain_empty` (tile_0043) and `prop_drain_liquid` (tile_0044) |
| `renderer/render/canvas.js` | Basin/drain: draw floor first then top-11-row sprite; Gargoyle/pipe flow: animate stream pixels; Basin/drain full: animate ripple pixels |
| `renderer/game.js` | Add `F` key handler in `update()` to toggle fountain pairs; add `fountainTime` increment for flowing props |
