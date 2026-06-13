# Paint-to-Derive Rules — Design

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan
**Supersedes:** the Build-tab direction in `2026-06-13-template-builder-design.md`
(abstract-symbol landmark templates). That direction is dropped; see Cleanup.

## Goal

Let the designer **paint an example dungeon patch using real tile graphics**, then
**derive adjacency rules from that painting** so the in-game decoration pass
reproduces the painted style. The painting is the "preferred outcome" made
visible; the engine learns from it.

This reworks the tile editor's **Build tab** from an abstract-symbol template
painter into a real-tile example painter wired to the existing tag/ruleset/
decoration system.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Rule flow | **Derive rules from the painting** (the "learn from a painted example" mode the original tile-generator design anticipated). |
| Granularity | **Group by tag** — derivation works at the tag level; tiles sharing a tag are interchangeable. Matches the existing engine. |
| Strictness | **Loose: prefer what you showed** — observed adjacencies are favored; unseen ones stay possible but unlikely. |
| Preference type | **Adjacency-aware (spatial)** — which tiles sit next to which must survive into the game, requiring an engine extension. |
| Relationship to prior work | **Replace the Build tab.** Drop the template/landmark pieces; keep the `placeTemplate` → `TEMPLATE_LEGEND` refactor. |

## Architecture

**Pipeline:**
draw/tag tiles (existing Draw tab) → **paint an example map with those real
tiles** (reworked Build tab) → **derive** per-tile weights + per-tag directional
adjacency frequencies → write into the active ruleset in `rulesets.json` → the
**extended `decorateMap`** reproduces that style in-game and in the live preview.

**Components:**
- `tools/tile-editor/map-painter.js` (new; replaces `template-builder.js`) — the
  Build-tab UI: real-tile palette, sprite canvas, derive button, outcome preview.
- `tools/tile-editor/derive-rules.js` (new; pure, unit-tested) — painted grid +
  tile metadata → ruleset fragment.
- `renderer/systems/decorate.js` (modified) — soft, adjacency-weighted selection.
- `renderer/data/rulesets.json` schema — optional `adjacency` block per tag.

One-way data flow is preserved: the editor only writes `rulesets.json`; the game
only reads it.

## 1. Ruleset schema + engine extension

### Schema

Each tag gains an **optional** `adjacency` block: observed neighbor-tag
frequencies per direction. Tiles keep their per-tile `weight` (now derived from
paint frequency).

```json
"floor.moss": {
  "role": "floor",
  "allow": ["*"], "forbid": [], "directional": {},
  "adjacency": {
    "n": { "wall.brick": 5, "floor.moss": 3 },
    "e": { "floor.moss": 6, "floor.plain": 1 },
    "s": { "floor.moss": 4 },
    "w": { "wall.brick": 5, "floor.moss": 2 }
  }
}
```

A tag **without** an `adjacency` block behaves exactly as today.

### Engine — two-layer selection in `decorateMap`

1. **Hard filter (unchanged):** `allow` / `forbid` / `directional` produce the
   `survivors` list via the existing `pairAllowed`. Derived "loose" rulesets keep
   these permissive (`allow: ['*']`), so nothing is hard-forbidden.
2. **Soft selection (new):** replace the plain `pickWeighted(survivors)` with a
   score-weighted pick:

   ```
   score(tile) = tile.weight × Π over decided neighbors d:
                    ( adjacency[tag][d][neighborTag] + ALPHA )
   ```

   summed over the tile's tags / its decided neighbors' tags. `ALPHA` is a small
   Laplace-smoothing constant (named in `decorate.js`, default `0.5`) so unseen
   adjacencies stay possible but unlikely — exactly "loose: prefer what you
   showed." A candidate whose tag has no `adjacency` data contributes a flat
   `ALPHA` per neighbor, so scoring **gracefully reduces to today's base-weight
   behavior** when no adjacency data is present.

Decided neighbors are the already-skinned N and W cells (same scan order as
today). Cells with no decided neighbors fall back to `tile.weight`-only weighting.

**Properties:** backward compatible (no `adjacency` ⇒ unchanged output, existing
`decorate` tests pass); directional for free (per-direction tables capture
relations like wall-top-above-wall-front); O(neighbors × candidates) per cell —
negligible on ~4 000 cells. The hard `forbid`/`directional` machinery is retained
for hand-authored rulesets even though derived rulesets don't use it.

Implementation note: factor the new scoring into a pure helper
(e.g. `adjacencyScore(ruleset, tileName, neighbors)` and a
`pickByAdjacency(ruleset, names, neighbors, rng)`) so it is unit-testable without
a full map.

## 2. Derivation — `derive-rules.js` (pure)

**Input:**
- `grid`: 2D array (`grid[row][col]`) where each cell is either `null` (empty) or
  a **tile name** string.
- `tileMeta`: `Map<tileName, { role: 'floor'|'wall', tags: string[] }>` — the
  role + tags assigned to each tile in the palette.

**Algorithm:**
1. **Per-tile weight:** count occurrences of each tile across the grid → its
   `weight`.
2. **Per-tag directional adjacency:** scan every non-empty cell; for each of its
   4 neighbors holding a tile, for each tag `T` of the center tile and each tag
   `U` of the neighbor in direction `d`, increment `adjacency[T][d][U]`. Empty
   cells and tiles missing from `tileMeta` (untagged) contribute nothing and are
   counted as skips.
3. **Emit fragment:**
   - `tags[T] = { role, allow: ['*'], forbid: [], directional: {}, adjacency }`
     for each painted tag (role taken from any tile carrying `T`).
   - `tiles[name] = { tags, weight }` for each painted, tagged tile.
   Return `{ tiles, tags, skipped }` where `skipped` is the count of placed-but-
   untagged cells.

**Merge wrapper** (thin, in `map-painter.js`): merge the fragment into the active
ruleset — replace `weight`/`adjacency` for tiles/tags present in the painting,
leave untouched any tags not painted — then save via the existing
`window.editorAPI.saveRulesets`. Re-deriving is idempotent for an unchanged
painting.

## 3. Painter UI — reworked Build tab

Three-column layout in the existing editor shell; the header's active-ruleset
selector stays shared across Draw / Rules / Build so derivation targets the
ruleset being edited.

- **Palette (left):** the real tile **library** (Kenney + custom), filterable,
  rendered as sprites. Click a tile = active brush. Each tile needs a **role +
  tag** to be derivable: tiles already in the active ruleset show their tag;
  picking an untagged tile reveals a small inline `role` (floor/wall) + `tag`
  input to assign before painting. Untagged tiles may still be placed but are
  excluded from derivation (surfaced as a skip count).

- **Canvas (center):** a resizable grid (default 16×12) painted with the actual
  tile **sprites** so the composed room is visible. Click-drag paints the active
  tile; eraser clears a cell to empty. Resizable via width/height inputs (crop on
  shrink, empty-pad on grow).

- **Sidebar (right):** width/height + resize; **"⚙ Derive rules → active
  ruleset"** button (runs derivation + merge + save, reports `N tiles, M tags, K
  adjacencies` and any untagged-skip count); and a **live "Preview outcome"**
  canvas that runs the extended `decorateMap` on a fresh bordered room patch with
  a re-roll button — so immediately after deriving you watch the engine reproduce
  your painted style.

The painter reuses existing helpers where possible (the library-building and
tile-image loading already used by the Draw tab and `sample-preview.js`).

## 4. Cleanup (replacing the template/landmark Build tab)

Remove, on this branch:
- `registerCustomTemplates` + `BUILTIN_TEMPLATE_NAMES` from `renderer/data/levels.js`
- the `load-templates` / `save-templates` handlers + `TEMPLATES_FILE` in `main.cjs`
- `loadTemplates` (game bridge) in `preload.cjs`; `loadTemplates` / `saveTemplates`
  (editor bridge) in `tools/tile-editor/editor-preload.cjs`
- the `registerCustomTemplates(...)` startup call + its import in `renderer/game.js`
- `tools/tile-editor/template-grid.js` and its test `test/template-grid.test.js`
- `test/levels.test.js` (covers only `registerCustomTemplates`)
- the template Build-tab markup in `tools/tile-editor/index.html`
  (`#template-*`, the old `#build-*` template controls) — replaced by the new
  painter markup
- `tools/tile-editor/template-builder.js` — replaced by `map-painter.js`

**Keep:** the `placeTemplate` → `TEMPLATE_LEGEND` refactor in
`renderer/systems/map.js` + `renderer/data/levels.js`, and its characterization
tests in `test/map.test.js`. The game still stamps built-in landmark templates;
only the editor-authored-template path is removed.

The Build tab itself stays in the editor shell (3-way tab toggle in `editor.js`
is retained); only its contents change.

## 5. Error handling

- **Untagged painted tiles:** placeable, excluded from derivation, reported as a
  skip count — never a silent failure.
- **Empty painting / no tagged tiles:** Derive is a no-op with a clear message;
  nothing written.
- **Missing tile sprite:** the painter won't list a tile whose image fails to
  load; the game's existing `pruneMissingTiles` still drops unloadable ruleset
  tiles at load.
- **Backward compatibility:** rulesets lacking `adjacency` (all current ones)
  decorate exactly as today.

## 6. Testing

- **`derive-rules.js` (unit):** small painted grid + `tileMeta` → assert exact
  per-tile weights and per-tag directional adjacency counts; untagged cells
  skipped and counted; empty grid → empty fragment; merge replaces painted tags'
  adjacency while preserving unpainted tags.
- **`decorate.js` extended (unit):** with `adjacency` + seeded RNG, selection is
  biased toward observed neighbors (deterministic/statistical assertion);
  **without** `adjacency`, output matches today (all existing `decorate` tests
  pass unchanged); `ALPHA` keeps unseen combos possible (nonzero probability);
  the new scoring helpers tested directly on synthetic neighbors.
- **Cleanup regression:** full suite green after removing the template/landmark
  pieces; `placeTemplate` legend tests remain.
- **Painter UI:** exercised manually via `npm run editor` (dev tool; the headless
  WSL2 environment can't launch the GUI, so visual checks are flagged for the
  user).

## Out of scope (v1)

- Exposing `ALPHA` (smoothing) in the UI.
- Hard `forbid`/`directional` authoring from the painting (loose model only;
  hard rules remain hand-authored via the Rules tab).
- Side-by-side "your painting vs engine output" diffing beyond the re-rollable
  outcome preview.
- Multi-tile brushes, symmetry, or other painter conveniences.
