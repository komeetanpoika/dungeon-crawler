# Level Generation Improvements Design

**Date:** 2026-06-01

## Summary

Five interconnected improvements to `map.js`, `levels.js`, `entities.js`, `sprites.js`, and `canvas.js`:

1. **Shape-aware room carving** — BSP leaves pick from four room shapes (rectangle, L, cross, sunken centre) based on size and depth
2. **Mixed corridor widths** — corridors randomly assigned 1, 2, or 3 tile widths per MST edge
3. **Randomised landmark + stair placement** — spawn, stairs-down, and landmark placed far apart each run
4. **Entrance alcove spawn** — dedicated 5×3 alcove carved adjacent to the spawn room; stairs up on its back wall
5. **Depth themes** — per-depth floor tile, canvas background, tint overlay, and prop palette giving a civilisation-descent arc

---

## Section 1 — Shape-aware room carving

### How it works

`bspSplit` is unchanged. `buildRooms` adds a `shape` field to each room. `carveRoom` dispatches to a shape-specific carver.

### Shapes and eligibility

| Shape | Min leaf w | Min leaf h | Base weight |
|---|---|---|---|
| `rect` | any | any | 50% |
| `lshape` | 10 | 8 (or 8×10) | 25% |
| `cross` | 9 | 9 | 15% |
| `sunken` | 9 | 9 | 10% |

If a leaf is too small for the rolled shape, it falls back to `rect`.

### Shape definitions

**Rectangle** — unchanged: carve interior leaving 1-tile wall border.

**L-shaped** — two overlapping rectangles within the leaf. Randomly chooses one of four L orientations (top-left + bottom-right quadrant, etc.). The `center` is the inner corner tile (always floor).

**Cross** — a horizontal bar + vertical bar through the leaf center. Width of each bar = `Math.max(3, Math.floor(dim / 3))`. The `center` is the geometric center (always floor).

**Sunken centre** — outer floor ring (1 tile wide) + 1-tile wall border forming an inner raised area. The inner area uses wall tiles; players walk the outer ring. The `center` is the geometric center of the outer ring (always floor).

### Depth weight adjustment

| Depth | rect | lshape | cross | sunken |
|---|---|---|---|---|
| 1–3 | 65% | 25% | 8% | 2% |
| 4–6 | 50% | 25% | 15% | 10% |
| 7–9 | 35% | 25% | 22% | 18% |

### Center guarantee

Each shape carver returns the room with a `center: { x, y }` that is guaranteed walkable, used by `connectRoomsMST` for corridor routing:

- `rect`: `{ x: room.x + Math.floor(room.w/2), y: room.y + Math.floor(room.h/2) }`
- `lshape`: inner corner of the L
- `cross`: geometric center
- `sunken`: a floor tile on the outer ring — `{ x: room.center.x, y: room.y + 1 }` (top of outer ring, always floor)

### Column placement

`placeColumns` (optional 50% per room) only runs on `rect` rooms of sufficient size. L/cross/sunken rooms do not get columns (their shape already provides visual structure).

---

## Section 2 — Mixed corridor widths

### Width assignment

Each MST edge rolls a corridor width independently:

| Width | Probability |
|---|---|
| 1 tile | 60% |
| 2 tiles | 25% |
| 3 tiles | 15% |

### `carveCorridor(map, x1, y1, x2, y2, width = 1)`

- **Width 1:** current L-bend behavior (horizontal then vertical)
- **Width 2:** carve main path + one extra tile on the right-hand side of travel direction at each step
- **Width 3:** carve main path + one extra tile on each side

The extra tiles are clamped to map bounds. The L-bend corner fans out to fill the width × width square so the bend doesn't narrow.

---

## Section 3 — Randomised landmark + stair placement

### Placement order

1. **Spawn room** — BSP room with center closest to map top-left `(0, 0)`.
2. **Stairs down** — room with center farthest (Manhattan distance) from spawn room center. Excluded on final depth.
3. **Landmark template** — random room that is neither spawn room nor stairs-down room. Template is placed centered on that room's center (clamped to map bounds). Removed rooms are excluded.

### Landmark orientation

Templates are always placed with their top-left at `(roomCenter.x - Math.floor(tmpl.width/2), roomCenter.y - Math.floor(tmpl.height/2))`, clamped so they don't exceed map bounds. A corridor is carved from the chosen room's center to the template's center.

### Fallback

If fewer than 3 rooms exist, landmark falls back to bottom-right corner (existing behavior).

---

## Section 4 — Entrance alcove spawn

### Structure

After the spawn room is identified, carve a 5×3 alcove directly above it:

- Position: `x = spawnRoom.center.x - 2`, `y = spawnRoom.y - 3`
- All 15 tiles set to `TILE.FLOOR`
- `TILE.STAIRS_UP` placed at `(spawnRoom.center.x, spawnRoom.y - 3)` (top wall of alcove)
- A 1-tile opening carved into the spawn room's top wall at `(spawnRoom.center.x, spawnRoom.y)`
- Player spawns at `(spawnRoom.center.x, spawnRoom.y - 2)` (center of alcove)

If the alcove position would go out of bounds (spawn room too close to map top), fall back to spawning at the spawn room center (existing behavior).

---

## Section 5 — Depth themes

### New constants and data

**`entities.js`:** add `TILE.SAND = 10`. `isWalkable` returns true for sand. The `TILE` object currently has values 0–9.

**`levels.js`:** add `DEPTH_THEMES` export:

```js
export const DEPTH_THEMES = [
  {
    depths: [1, 2, 3],
    floorTile: 'floor',      // TILE.FLOOR
    bgColor:   '#12121e',
    tint:      null,
    fogAlpha:  0.65,
    props: {
      wall:   ['prop_banner', 'prop_prison_bars'],
      room:   ['prop_table', 'prop_chair', 'prop_anvil', 'prop_barrel',
               'prop_pipe_flow', 'prop_gargoyle_flow', 'prop_fountain_full'],
    },
  },
  {
    depths: [4, 5, 6],
    floorTile: 'sand',       // TILE.SAND
    bgColor:   '#1a1206',
    tint:      'rgba(40,20,0,0.2)',
    fogAlpha:  0.65,
    props: {
      room:   ['prop_pipe_dry', 'prop_gargoyle_dry', 'prop_fountain_empty',
               'prop_gravestone', 'prop_anvil'],
    },
  },
  {
    depths: [7, 8, 9],
    floorTile: 'floor',      // TILE.FLOOR
    bgColor:   '#07070f',
    tint:      'rgba(0,0,20,0.35)',
    fogAlpha:  0.80,
    props: {
      room:   ['prop_gravestone', 'prop_grave'],
    },
  },
]
```

### New sprite entries (`sprites.js`)

| Key | Tile |
|---|---|
| `sand` | tile_0048 |
| `prop_table` | tile_0072 |
| `prop_chair` | tile_0073 |
| `prop_anvil` | tile_0074 |
| `prop_barrel` | tile_0082 |
| `prop_banner` | tile_0029 |
| `prop_prison_bars` | tile_0028 |
| `prop_pipe_dry` | tile_0007 |
| `prop_pipe_flow` | tile_0008 |
| `prop_gargoyle_dry` | tile_0019 |
| `prop_gargoyle_flow` | tile_0020 |
| `prop_fountain_empty` | tile_0031 |
| `prop_fountain_full` | tile_0032 |
| `prop_gravestone` | tile_0065 |
| `prop_grave` | tile_0066 |

### Prop entity

`buildEntities` adds a new case:

```js
case 'prop': return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y }]
```

Props are drawn by `drawEntity` in canvas.js:

```js
if (entity.type === 'prop') {
  const s = sprites[entity.propType]
  if (s) ctx.drawImage(s, px, py, S, S)
  return
}
```

Props are not enemies, do not block movement, and have no AI.

### Prop scattering in `generateLevel`

After enemy/item placement, for each BSP room:
- Roll 0–3 props from the depth theme's `room` palette
- Pick random floor tiles in the room that are not already occupied
- Push `{ kind: 'prop', propType: chosen, x, y }` to `entitySpawns`

For `wall` props (banner, prison bars): pick a random wall tile adjacent to floor inside each room and place the prop there (it renders on top of the wall tile).

### Canvas theme application

`Renderer.render(state)` reads `state.theme` (set once in `startNewRun` / `descendLevel` from `DEPTH_THEMES`):

```js
// Background
ctx.fillStyle = theme.bgColor
ctx.fillRect(0, 0, W, H)

// Tint overlay (after tile draw, before entities)
if (theme.tint) {
  ctx.fillStyle = theme.tint
  ctx.fillRect(0, 0, W, H)
}

// FOV fog uses theme.fogAlpha instead of hardcoded 0.65
ctx.fillStyle = `rgba(0,0,0,${theme.fogAlpha})`
```

`drawTile` adds a case for `TILE.SAND` → `sprites.sand`.

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Add `TILE.SAND = 10`; `isWalkable` includes sand |
| `renderer/systems/map.js` | Shape-aware `buildRooms` + `carveRoomShaped`; `carveCorridor` width param; new spawn/stair/landmark placement logic; entrance alcove; prop scattering |
| `renderer/data/levels.js` | Add `DEPTH_THEMES` export |
| `renderer/render/sprites.js` | Add sand + 15 prop sprite entries |
| `renderer/render/canvas.js` | `drawTile` sand case; `drawEntity` prop case; theme background/tint/fog in `Renderer.render` |
| `renderer/game.js` | Pass `theme` into state in `startNewRun` + `descendLevel` |
| `test/map.test.js` | New: shape carvers produce walkable centers; alcove spawn within bounds; corridor widths |
