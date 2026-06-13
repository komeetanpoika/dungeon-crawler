# Overlay Assets (Paint-Derived Props) — Design

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-06-13-paint-to-derive-rules-design.md` (the map painter, the
`adjacency` model, and the soft `pickByAdjacency` selection). This extends that
system with a second, overlay layer.

## Goal

Let transparent-background "asset" tiles (props — barrels, graves, fountains…) be
**placed on top of base tiles** in the map painter, with their placement **rules
derived from the painting** just like base tiles. The game's decoration pass then
scatters them in the painted style, replacing today's random per-room prop
scatter for themed levels.

The engine already has a cosmetic prop concept (entity spawns of `kind: 'prop'`,
scattered randomly via `theme.props.room`, drawn over the floor by the renderer).
This feature makes prop placement **authored and learned** instead of random,
through the existing paint → derive → `rulesets.json` → decorate loop.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| End goal | **Derive placement rules** for overlays, like base tiles; the decoration pass auto-places them. |
| Overlay model | **Base tile conditioning + neighbor adjacency** — overlays depend on the base beneath them AND on overlay-to-overlay spatial relationships. |
| Granularity | **Group by tag** (role `overlay`), consistent with base tiles. |
| Layer count | A single overlay layer on top of base. |
| Walkability | **Cosmetic only** — overlays never affect movement (matches existing props). |
| Game integration | Derived overlays **replace the random scatter** for themes whose ruleset defines overlay rules; other themes keep today's random props. |

## 1. Painter: a second layer

The painter cell becomes two slots: `{ base, overlay }` (each a tile name or
`null`). Concretely the grid holds two parallel layers, `grid.base[y][x]` and
`grid.overlay[y][x]`.

- **Layer toggle (Base / Overlay)** in the sidebar selects which slot the brush
  writes and erases.
- **Composited render:** each cell draws its base sprite first, then its overlay
  sprite on top (transparent background reveals the base). Empty slots draw
  nothing for that layer.
- **Authoring intent:** the user paints a representative room — base floors/walls
  on the Base layer, props sprinkled on the Overlay layer, **most overlay cells
  left empty**. That emptiness is the density signal (see §2).

**Tagging** gains a third role, `overlay`, alongside `floor`/`wall`. Overlay tiles
get overlay-role tags (e.g. `overlay.barrel`), grouping interchangeable props.

## 2. Schema & derivation

### Schema additions to `rulesets.json`

Two learned relationships:

- **Overlay-on-base (conditioning + density)** — stored on each **base tag** as an
  `overlays` distribution. The `""` key is "no overlay here":

  ```json
  "floor.plain": {
    "role": "floor", "allow": ["*"], "adjacency": { … },
    "overlays": { "": 40, "overlay.barrel": 3, "overlay.crate": 1 }
  }
  ```

  The empty-to-filled ratio on a base type is its overlay density.

- **Overlay-to-overlay adjacency** — stored on each **overlay tag** using the same
  `adjacency: { n, e, s, w }` neighbor-frequency tables the base tags use:

  ```json
  "overlay.barrel": {
    "role": "overlay", "allow": ["*"],
    "adjacency": { "n": { "overlay.barrel": 2 }, "e": {}, "s": {}, "w": { "overlay.barrel": 2 } }
  }
  ```

Overlay tiles are registered like base tiles: `tiles[name] = { tags, weight }`
with their tag carrying `role: "overlay"`.

### Derivation (`derive-rules.js` extended)

Derivation takes both layers, matching the painter's parallel grids:
`deriveRules(baseGrid, overlayGrid, tileMeta)` (kept pure; each grid is
`grid[row][col]` of tile name or `null`, same dimensions).

1. **Base layer:** derive exactly as today from the `base` slots (per-tile
   weights, base tag adjacency).
2. **Overlay tiles:** count weights; register overlay tags (`role: 'overlay'`,
   permissive defaults, empty `adjacency`); accumulate overlay→overlay directional
   adjacency among **overlay-layer** neighbors (an overlay cell's 4-neighborhood
   in the overlay grid).
3. **Base conditioning:** for every cell, increment
   `baseTag.overlays[overlayTag]`, or `baseTag.overlays[""]` when the overlay slot
   is empty, using the base tile's tag at that cell. Cells whose base is untagged
   contribute no conditioning (and the existing untagged-skip count still applies
   to painted-but-untagged tiles in either layer).

The merge into the active ruleset (in `map-painter.js`) extends to write `role:
'overlay'` tags, overlay-tag `adjacency`, and base-tag `overlays`, overwriting
those derived fields for painted tags while preserving hand-authored
`allow`/`forbid`/`directional`.

## 3. Decoration pass & rendering

### Second pass in `decorateMap`

After the existing base-skin pass completes (so every cell's base tag is known),
run an overlay pass scanning top-left → bottom-right. For each floor/wall cell
whose chosen base skin has tag `B` and whose `B.overlays` exists:

1. **Candidates:** a synthetic `none` plus every overlay *tile* whose tag appears
   in `B.overlays`.
2. **Score** (reusing the soft model):
   - `none`: weight = `B.overlays[""]` (empty count); neutral on adjacency.
   - overlay tile of tag `T`: weight =
     `tile.weight × B.overlays[T] × adjacencyScore(ruleset, tile, overlayNeighbors)`,
     where `overlayNeighbors` are the already-decided N/W **overlay** neighbors
     (`{ dir, skin: cell.overlay }`). `adjacencyScore`/`ADJACENCY_ALPHA` are reused
     unchanged.
3. **Pick** weighted-random (same arithmetic as `pickByAdjacency`). `none` →
   `cell.overlay = null`; otherwise `cell.overlay = tileName`.

Cells with `cell.skin === null`, or a base tag lacking `overlays`, get no overlay.
The pass never reads or writes `tile`, so walkability is untouched. Performance is
the same order as the base pass — negligible.

Factor the overlay scan so the base and overlay passes share the neighbor-gathering
+ scoring helpers rather than duplicating logic.

### Rendering (`canvas.js`)

At the tile draw site, after the base/skin is drawn, draw `cell.overlay` on top
when present. The current skin branch early-returns; restructure so the base
(skin or theme-default sprite) is drawn, then `cell.overlay` layers over it, then
return. `cell.overlay` is a ruleset tile name already loaded via
`rulesetTileNames` → `loadSprites`.

## 4. Game integration

When a level's theme has a ruleset that defines overlay rules (any base tag with a
non-empty `overlays`), the derived overlay pass owns prop placement and the random
`theme.props.room` scatter (`map.js:527`) is **skipped** for that level. Themes
with no ruleset, or a ruleset with no overlay data, keep today's random scatter
unchanged. Overlays are thus opt-in per theme, exactly like base skins.

## 5. Error handling

- **Untagged painted tiles** (either layer) → skipped in derivation, reported in
  the editor's derive count.
- **Base tag with no `overlays`, or `cell.skin === null`** → no overlay; no error.
- **Missing overlay sprite** → `pruneMissingTiles` drops unloadable ruleset tiles
  at game load; the overlay pass simply won't have it as a candidate.
- **Backward compatibility:** rulesets with no overlay data, and themes with no
  ruleset, behave exactly as today (random props); guarded by existing tests.

## 6. Testing

- **`derive-rules.js`:** base-conditional `overlays` counts including the `""`
  empty key; overlay→overlay adjacency from the overlay layer; untagged overlay
  cells skipped; empty grid → empty fragment; base layer still derived correctly
  alongside overlays.
- **`decorateMap` overlay pass:** `none` vs a specific overlay chosen per
  base-conditional weight (seeded RNG, deterministic); overlay adjacency biases
  the choice; a cell with `skin === null` and a base tag without `overlays` get no
  overlay; the base-skin pass output is unchanged (regression).
- **`canvas.js`/rendering:** unit-level where practical (e.g. a draw helper that
  records draw calls), else covered by manual UI checks.
- **Painter UI:** manual via `npm run editor` (headless WSL2 can't launch the GUI;
  flagged for the user) — layer toggle, overlay tagging, composited paint, derive
  report, preview.

## Out of scope (v1)

- Multiple overlay layers (one overlay slot per cell).
- Overlays that affect walkability or gameplay (cosmetic only).
- Overlay-conditioned-on-wall vs floor distinctions beyond the base tag itself
  (the base tag already encodes role).
- Animated or multi-tile overlays.
