# Tile Generator — Design

**Date:** 2026-06-11
**Status:** Approved design, pending implementation plan

## Goal

A 16×16 pixel-tile editor plus an adjacency-rule system so new wall/floor textures
can be created (from scratch or based on existing Kenney tiles) and placed
sensibly in generated dungeons. Full loop: draw tiles → define rules → restart
game → see them in the dungeon.

This is the first of two asset-generator sub-projects. The second (AI-assisted
procedural monster generator) is out of scope here and gets its own spec.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Rule scope | **Visual layer only.** BSP layout generation untouched; rules pick texture variants per cell after layout. |
| Rule authoring model | **Tag-based** (tiles carry tags; rules written at tag level), with the data model kept compatible with a future "learn rules from a painted example" mode. |
| Game integration | **Included.** Editor + ruleset file + in-game decoration pass ship together. |
| Theme binding | **One ruleset per depth theme** (optional `ruleset` field on `DEPTH_THEMES` entries; absent = today's behavior). |
| Palette | Default palette extracted from the 133 existing Kenney tiles; arbitrary custom colors also allowed. |
| Platform | **Second window in the existing Electron app**, launched via `npm run editor`. Direct file access through a dedicated preload bridge. |

## Architecture

Three components, one-way data flow:
**editor → (`custom_*.png` + `rulesets.json`) → game reads both at startup.**
The editor never touches game code; the game never writes assets.

### 1. Tile editor — `tools/tile-editor/`

Plain HTML/JS/canvas (same style as the game renderer), opened as its own
Electron window by `npm run editor`. A dedicated preload bridge exposes exactly
four operations:

- list existing tiles (`renderer/assets/tiles/`)
- read a tile PNG
- save a new tile PNG (always `custom_<name>.png`; Kenney originals are never overwritten)
- read/write `renderer/data/rulesets.json`

#### Draw tab

- Tools: pencil, eraser, flood fill, eyedropper; undo/redo.
- **Wrap mode (toggle):** drawing past an edge continues on the opposite side,
  for seamless textures (both axes).
- Center: zoomed 16×16 grid editing canvas. Right column: 1:1 preview, **3×3
  tiled preview** (seamless check), palette (extracted Kenney colors + custom
  color picker), tile name and tag entry.
- Bottom: library strip of all existing tiles (Kenney + custom), filterable;
  click loads a tile as an editable base ("save as new" semantics).
- Tiles are RGBA PNGs; transparency supported.

#### Rules tab

- Left: tag list for the active ruleset with member-tile counts/thumbnails.
- Center: rules for the selected tag — "may neighbor" / "never neighbor" tag
  chips, spawn-weight slider (per member tile), optional per-direction
  overrides (N/E/S/W).
- Right: live sample grid that re-rolls whenever rules change, showing what the
  decoration pass would produce; manual re-roll button.

#### Out of scope (v1)

Line/shape tools, mirror/symmetry, animation-frame strips, multi-tile brushes,
example-based rule learning (data model is ready for it; UI is not built).

### 2. Ruleset file — `renderer/data/rulesets.json`

One JSON file holding all rulesets, keyed by ruleset name:

```json
{
  "catacombs": {
    "tiles": {
      "custom_moss_floor_1": { "tags": ["floor.moss"], "weight": 2.0 },
      "custom_moss_floor_2": { "tags": ["floor.moss"], "weight": 1.0 },
      "tile_0048":           { "tags": ["floor.plain"], "weight": 4.0 }
    },
    "tags": {
      "floor.moss": {
        "role": "floor",
        "allow":  ["floor.moss", "floor.cracked"],
        "forbid": ["floor.plain"],
        "directional": { "n": [], "e": [], "s": [], "w": [] }
      },
      "floor.plain": { "role": "floor", "allow": ["*"] }
    }
  }
}
```

Semantics:

- **`role`** (`floor` | `wall`): which logical map tile a tag may skin. The
  decoration pass only swaps visuals within the same role, so walkability can
  never change.
- **`allow` / `forbid`:** symmetric, direction-less adjacency rules (the common
  case). `forbid` beats `allow`. `"*"` = anything.
- **`directional`:** optional per-direction allow-lists for cases like
  wall-top-above-wall-front.
- **Weights live on tiles**, so variants sharing a tag can appear at different
  frequencies.
- Existing Kenney tiles may be ruleset members; nothing forces redrawing.
- **Future-compatible with example learning:** a learner would emit the same
  tags/allow/forbid entries into the same file — no migration.

Theme binding: each `DEPTH_THEMES` entry (in `renderer/data/levels.js`) gains an
optional `ruleset: '<name>'` field. Themes without it behave exactly as today.

### 3. Decoration pass — `renderer/systems/decorate.js`

Runs once per level, after map generation, before first render:

1. **Scan** cells top-left → bottom-right. For each cell whose logical tile is
   `FLOOR` or `WALL` and whose theme has a ruleset, gather candidate tiles
   whose tag `role` matches.
2. **Filter** candidates against already-decorated neighbors (N and W are
   always decided in this scan order; rules are enforced against decided cells
   only — with symmetric rules this still guarantees no forbidden pairing in
   the final map). Apply `allow`, `forbid`, `directional`.
3. **Pick** by weighted random among survivors; store on `cell.skin`.
4. **Fallback:** if no candidate survives, set `cell.skin = null` (theme
   default sprite) and `console.warn` with coordinates — over-constrained
   rulesets degrade visibly but never crash or hole the map.

The pass never reads or writes the logical `tile` field: connectivity,
collision, and AI pathing are untouched.

Performance: 80×50 = 4 000 cells with a handful of checks each — negligible; no
caching needed.

## Rendering integration

- `renderer/render/canvas.js`: at each floor/wall draw site, draw
  `cell.skin` when present, else the current theme sprite (two-line change per
  site).
- `renderer/render/sprites.js` (`loadSprites`): additionally load every tile
  referenced by `rulesets.json` (including `custom_*` files) so skins resolve
  to loaded images.

## Error handling

- **Editor:** saving requires a non-empty tile name; names are sanitized to
  `[a-z0-9_]`; saving over an existing `custom_*` file asks for confirmation;
  Kenney originals cannot be targeted at all.
- **Game — missing/invalid `rulesets.json`:** treated as "no rulesets"; game
  runs exactly as today.
- **Game — ruleset references a missing PNG:** warn at load, drop that tile
  from candidates.
- **Game — over-constrained rules:** per-cell fallback to theme default +
  console warning (see decoration pass step 4).

## Testing

- Unit tests (`node --test test/`) for the rule evaluator: allow/forbid
  filtering, directional overrides, weighted selection, `forbid`-beats-`allow`,
  `"*"` handling, fallback on empty candidate set.
- Decoration-pass tests on small synthetic maps, including a determinism test
  with a seeded RNG.
- Editor UI is exercised manually (it is a dev tool, not shipped game code).
