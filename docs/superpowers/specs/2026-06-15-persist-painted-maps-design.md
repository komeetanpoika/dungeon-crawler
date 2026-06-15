# Persist painted maps (tile editor Build tab)

**Issue:** #2 — *Tile editor: saving the map needs a rethink*
**Date:** 2026-06-15

## Problem

The Build-tab map painter (`tools/tile-editor/map-painter.js`) holds the painted
base + overlay grid only in module memory. Pressing **⚙ Derive rules** writes
adjacency/weight/overlay data into `renderer/data/rulesets.json`, but the painting
itself — the source of truth for those derived rules — is never persisted. Close
and reopen the editor and the example is gone; you cannot iterate on it, revisit
it, or re-derive after a tweak.

## Goals

- Persist the painted base/overlay grid so it survives editor restarts.
- Support **many named maps per ruleset**, switchable from the Build tab.
- **Autosave** on paint and on derive — no "Save map" button to forget.
- Keep the derived rules and the painting they came from in sync.

## Non-goals

- No cross-ruleset map sharing or import/export.
- No migration of existing paintings (none are persisted today).
- No change to the derive algorithm or rule data model.

## Storage

A new file, `renderer/data/painter-maps.json`, kept **separate** from
`rulesets.json` so the game's runtime ruleset data stays free of editor-only
painting blobs.

```json
{
  "<ruleset>": {
    "active": "<mapName>",
    "maps": {
      "<mapName>": {
        "w": 16,
        "h": 12,
        "base":    [[ "tile_name" | null, ... ], ...],
        "overlay": [[ "tile_name" | null, ... ], ...]
      }
    }
  }
}
```

- Keyed by ruleset name, then by map name.
- Each map stores its own dimensions and two grids of tile-name strings (or
  `null` for empty cells).
- `active` records the last-selected map name so reopening restores it.

## Components

### IPC (`main.cjs` + `editor-preload.cjs`)

Two handlers mirroring the existing rulesets pair:

- `load-painter-maps` → `JSON.parse(file)` or `{}` if missing/unreadable.
- `save-painter-maps(data)` → write pretty-printed JSON to
  `renderer/data/painter-maps.json`.

Exposed on `window.editorAPI` as `loadPainterMaps()` and
`savePainterMaps(data)`.

### Pure module `tools/tile-editor/painter-maps.js`

No DOM. Holds all store-shaping logic so it is unit-testable in isolation
(mirrors `derive-rules.js`):

| Function | Behavior |
|---|---|
| `serializeGrid(base, overlay)` | `{ w, h, base, overlay }` with deep-copied rows. `w`/`h` from `base`. |
| `applyMap(store, ruleset, name, serialized)` | Set `store[ruleset].maps[name]` and `store[ruleset].active = name`; create the ruleset bucket if absent. Returns the store. |
| `renameMap(store, ruleset, from, to)` | Move the map under a new key, preserving order where practical; update `active` if it pointed at `from`. No-op if `from` absent or `to` collides. |
| `deleteMap(store, ruleset, name)` | Remove the map; if it was `active`, repoint `active` to the first remaining map (or clear). |
| `listMaps(store, ruleset)` | Array of map names for the ruleset (`[]` if none). |
| `getActive(store, ruleset)` | The active map name, or the first map, or `null`. |
| `getMap(store, ruleset, name)` | The stored map object, or `null`. |

These functions treat the store as plain data and never touch `window`/`document`.

### `map-painter.js` wiring

A map-picker row at the top of `#paint-sidebar`:

```
Map: [ main ▾ ]  [+ new] [✎ rename] [🗑]   saved ✓
```

- **Init:** load the store alongside `tilesReady`. Build the picker for the
  active ruleset.
- **`loadActiveMapFor(ruleset)`:** if the ruleset has maps → load `getActive`'s
  map into `grid.base`/`grid.overlay`, sync the `w`/`h` inputs, `sizeCanvas()`,
  `render()`. If none → create a blank `"main"` map (seeded from the current grid
  if it already has paint, otherwise blank) and persist it.
- **Autosave:** a debounced (~400 ms) `persistCurrent()` called from `paint()`
  and the resize handler. Writes `serializeGrid(...)` via `applyMap` into the
  store, then `savePainterMaps`. Immediate (non-debounced) persist on new /
  rename / delete / switch.
- **Picker actions:**
  - *new* → `textPrompt` for a name (sanitized, lowercased); reject duplicates
    inline; create blank map, switch to it, persist.
  - *rename* → `textPrompt`; `renameMap`; persist.
  - *delete* → `confirm`; `deleteMap`; load whatever becomes active (or blank);
    persist.
  - *select change* → persist current, then load selected, set `active`,
    persist.
- **`ruleset-changed`:** persist the current map (if any), then
  `loadActiveMapFor(newRuleset)` and rebuild the picker.
- **Derive:** call `persistNow()` (flush the debounce) before deriving so the
  saved painting and the rules it produces stay in sync.

### Feedback (overlaps #5)

A small status element beside the picker:

- flips `saving…` → `saved ✓` on each autosave completion;
- shows inline `renamed` / `deleted` / `"name already exists"` acknowledgements.

## Edge cases

- **No active ruleset:** the picker is disabled and autosave is a no-op (a map
  cannot be keyed without a ruleset). Painting still works in memory. On
  **Derive**, the existing `ensureRuleset()` creates a ruleset, after which the
  current grid is persisted as that ruleset's `"main"` map.
- **Duplicate map name on *new*:** rejected with an inline message; no overwrite.
- **Resize:** persisted like any paint edit (new dimensions stored with the map).
- **Corrupt/missing store file:** `load-painter-maps` returns `{}`; the editor
  starts with a fresh `"main"` per ruleset on first paint.

## Data flow

```
paint() / resize() ──debounce──▶ persistCurrent() ─▶ applyMap(store,…) ─▶ savePainterMaps ─▶ painter-maps.json
ruleset-changed   ─▶ persist current ─▶ loadActiveMapFor() ─▶ grid + picker
Derive            ─▶ persistNow() ─▶ deriveRules(grid) ─▶ mergeFragment ─▶ rulesets.json
editor open       ─▶ loadPainterMaps() ─▶ loadActiveMapFor(active ruleset)
```

## Testing

- **Unit (`test/painter-maps.test.js`, `node --test`):**
  - `serializeGrid` round-trips dimensions and cell values; rows are copies, not
    references.
  - `applyMap` creates the ruleset bucket and sets `active`.
  - `renameMap` moves the map, updates `active`, and no-ops on collision/missing.
  - `deleteMap` removes the map and repoints `active`.
  - `listMaps` / `getActive` / `getMap` return expected values, including the
    empty-store case.
- **DOM flow (Playwright probe):** paint → autosave writes the file; create a
  second named map and switch; reopen the editor and confirm the painting and
  active selection persist; Derive after an edit reflects the latest grid.
