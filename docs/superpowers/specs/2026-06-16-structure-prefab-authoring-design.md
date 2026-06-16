# Structure prefab authoring — design

**Date:** 2026-06-16
**Status:** Approved (pending written-spec review)

## 1. Problem

The Build tab teaches the engine *local texture-adjacency style* (via `derive-rules.js`)
and previews it on a hardcoded bordered room (`sample-preview.js`). A designer who
paints "an outdoor field with a castle in the middle" therefore sees only walls on
the very edges of the preview and never gets their castle into the game: the derive
system has no notion of *layout* or *structure*, and the preview ignores the painted
map entirely (it always renders walls on the perimeter, floor in the centre).

The game *does* already place authored structures — `TEMPLATES` in `levels.js` are
ASCII layouts stamped into a "landmark room" by `placeTemplate`, selected per depth
via `cfg.landmark`. What is missing is a path from a **painted** map to a placeable
structure, and a way to mark *which* painted cells form that structure plus their
gameplay properties.

## 2. Goal

Let a designer paint a map, mark cells as "part of a structure" (plus per-cell
gameplay properties), export that selection as a **prefab** with the *exact painted
sprites*, and have the level generator place it through the existing landmark slot.
In-game the structure looks exactly as painted, while the surrounding terrain
generates and decorates normally.

## 3. Architecture

```
Build tab (paint base + overlay + NEW properties layer)
   └─ Export structure ─→ renderer/data/structures.json
                              (per cell: skin + overlay + collision + interaction)
                              │
game startup: saveAPI.loadStructures()  ── mirrors loadRulesets()
                              │
generateLevel(depth, …, { structures })
   └─ landmark slot resolves name against structures first, then TEMPLATES
        └─ placeStructure(map, structure, ox, oy, roomId)
             stamps exact skins, sets cell.locked, sets collision tile,
             emits door/chest spawns
                              │
decorateMap(map, ruleset)  ── skips cells where cell.locked is true
                              │
renderer  ── already draws cell.skin / cell.overlay (no change)
```

**Reuses:** landmark room selection + corridor carving + `healConnectivity`; the
`placeTemplate` spawn-emitting pattern; the `rulesets.json` / `painter-maps.json`
data-file + IPC pattern; the renderer's existing `cell.skin` / `cell.overlay` draw.

**New:** the Properties layer UI; `structures.json` + `load-structures` /
`save-structures` IPC; `placeStructure`; a one-line `cell.locked` skip in
`decorateMap`; landmark-name resolution against structures.

## 4. Properties layer (editor UI)

A third layer mode in the Build tab alongside `base | overlay`: **`properties`**.
In properties mode the painted sprites are dimmed and translucent colored markers
are overlaid on the canvas.

A **property selector** chooses what the brush edits:

- **Collision** — one *exclusive* value per cell: `walkable` or `wall`. Painting
  replaces the cell's value. Unmarked cells default to the painted tile's ruleset
  role (`wall` role → wall, `floor` role → walkable).
- **Interaction** — a flag with a sub-type. **v1 sub-types: `door`, `chest`.**
  (shrine / trap / stairs are intentionally deferred; the legend already supports
  them so they are cheap to add later.)
- **Structure** — boolean membership. The set of structure-marked cells is the
  export footprint.

Collision is replace-on-paint; interaction and structure toggle on/off. The three
properties are independent of one another (a cell can be e.g. `wall` + structure,
or `walkable` + `door` + structure).

The properties layer is persisted inside `painter-maps.json` alongside `base` and
`overlay`, so a structure stays editable after a reload.

## 5. Prefab data format & storage

`renderer/data/structures.json`, written by the editor via a new `save-structures`
IPC (twin of `save-rulesets`) and read via `load-structures`. Cells are **sparse**
so non-rectangular structures work; coordinates are normalized so the footprint's
top-left is `(0,0)`:

```json
{
  "castle": {
    "w": 21,
    "h": 14,
    "targetDepth": 2,
    "cells": [
      { "x": 3, "y": 2, "skin": "castle_wall_1", "overlay": null,
        "collision": "wall", "interaction": null },
      { "x": 4, "y": 5, "skin": "castle_floor_2", "overlay": "banner",
        "collision": "walkable", "interaction": { "type": "door" } }
    ]
  }
}
```

- Only structure-marked cells are exported.
- `collision` is `"wall"` or `"walkable"`.
- `interaction` is `null` or `{ "type": "door" | "chest" }`.
- `targetDepth` (optional) is written by the export dialog for one-click assignment
  (see §7).
- Structure skins must exist as tile PNGs in `renderer/assets/tiles/` — they always
  do, because they were painted from the library. Missing skins are handled by the
  existing `pruneMissingTiles`.

## 6. Generator placement & decorate change

**Loading.** Add `STRUCTURES_FILE` in `main.cjs` plus `load-structures` /
`save-structures` IPC handlers and `loadStructures` / `saveStructures` in the
preloads. The game loads `structures.json` at startup next to rulesets and passes it
into `generateLevel` as `{ structures }`.

**`placeStructure(map, structure, ox, oy, roomId)`** — sibling of `placeTemplate`.
For each sparse cell at `tx = ox + cell.x`, `ty = oy + cell.y`:

- `map[ty][tx].skin = cell.skin`; `map[ty][tx].overlay = cell.overlay`;
  `map[ty][tx].locked = true`.
- collision → logical tile: `"wall"` → `TILE.WALL`; `"walkable"` → `TILE.FLOOR`
  (with `roomId` set).
- interaction → reuse the legend pattern: `door` sets `TILE.FLOOR` and emits a
  `{ kind: 'door', x, y }` spawn; `chest` sets `TILE.FLOOR` and emits a
  `{ kind: 'chest', x, y }` spawn.
  - `buildEntities` (`game.js`) already handles `door` (→ `makeDoor`). It has **no
    bare `chest` kind** today — generic chests are only created indirectly via
    `weapon` / `potion` spawns. So add a `case 'chest'` that calls `makeChest` with
    default contents (v1: a potion), keeping `placeStructure` decoupled from chest
    contents.
- Returns the accumulated spawn list (merged into `entitySpawns`, exactly as
  `placeTemplate`'s return is used today).

Cells outside the sparse set are untouched, so surrounding terrain generates and
decorates normally.

**`decorateMap` change.** A single guard `if (cell.locked) continue` in both the
skin-assignment loop and `decorateOverlays`, so painted structure sprites are never
overwritten. No renderer change — `cell.skin` / `cell.overlay` already draw.

**Placement reuse.** The structure is dropped into the chosen landmark room: offset
clamped to map bounds, corridor carved from the nearest room, then
`healConnectivity` and the existing "keep room centres walkable" pass run.

**Known v1 limitation.** A fully-walled structure relies on its `door` cell plus
connectivity healing for reachability; complex interior connectivity is the
designer's responsibility. Documented, not solved, in v1.

## 7. Assignment

Reuse the existing **landmark-by-name** slot: when `generateLevel` resolves
`cfg.landmark`, it checks the loaded `structures` first, then `TEMPLATES`. Setting a
depth's `landmark: 'castle'` therefore places the painted structure.

The export dialog optionally writes `targetDepth` into the structure entry; on load
the game applies it by setting that depth's landmark to the structure name (a
one-click alternative to hand-editing `LEVEL_CONFIG`). Random/pooled placement is
out of scope for v1.

## 8. Testing

- **Pure unit tests** (no DOM, mirroring `derive-rules` tests):
  - export serializer: painted base/overlay/props → `structures.json` shape —
    collision mapping, door/chest interaction mapping, sparse footprint, origin
    normalization.
  - `placeStructure`: stamps skins + overlays, sets `locked`, sets correct collision
    tiles, emits `door` / `chest` spawns, leaves non-footprint cells untouched.
- **`decorateMap` test:** locked cells retain their painted skin and overlay through
  both passes.
- **Editor-lib test:** property-layer toggling — collision is exclusive (painting
  `wall` then `walkable` leaves one value), structure/interaction toggle
  independently.
- **Runtime verification (Playwright `_electron` on WSLg, per project recipe):**
  paint a small structure → mark cells → export → assert `structures.json`; then
  launch the game at the target depth and screenshot the placed structure rendered
  with its exact sprites.

## 9. Out of scope (v1)

- Shrine / trap / stairs interaction sub-types (legend already supports them; add
  later).
- Random / pooled structure placement.
- Fixing the existing "Preview outcome" to render the painted map (separate concern;
  the structure workflow does not depend on it).
- Multi-structure-per-level, rotation/mirroring, or interior-connectivity
  auto-solving.

## 10. Touched files

- `tools/tile-editor/map-painter.js` — properties layer mode, property selector,
  Export structure action.
- `tools/tile-editor/painter-maps.js` — persist the properties layer.
- `tools/tile-editor/` — new pure module for the export serializer (unit-tested).
- `renderer/systems/map.js` — `placeStructure`, landmark-name resolution against
  structures, thread `structures` through `generateLevel`.
- `renderer/systems/decorate.js` — `cell.locked` skip in both passes.
- `renderer/data/structures.json` — new data file.
- `main.cjs`, `tools/tile-editor/editor-preload.cjs`, `preload.cjs` — structures IPC.
- `renderer/game.js` — load structures at startup, pass to `generateLevel`; add a
  `case 'chest'` to `buildEntities`.
- `test/` — new unit tests per §8.
