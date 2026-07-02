# Editor Build-tab fixes: blank saved maps, undo/redo, sidebar overflow

**Date:** 2026-07-02
**Status:** approved design

## Background

A runtime audit of the tile editor (Playwright, WSLg) found three issues, all in
or around the Build tab (`tools/tile-editor/map-painter.js`):

1. **Saved maps render blank.** `render()` only draws a cell when its tile
   image is already in the `images` cache (map-painter.js `render()`), but
   `loadGrid()` never requests images for the tile names in the loaded map.
   Confirmed live: the saved `castle-demo` map (192 painted base cells) showed
   as an empty grid; picking one of its tiles as a brush made that tile's
   cells appear.
2. **No undo + instant autosave.** Every paint action autosaves to
   `renderer/data/painter-maps.json` after a 400 ms debounce. A stray click
   permanently overwrites a saved map; the Build tab has no undo (the Draw
   tab does).
3. **Sidebar overflow.** The layer-picker row (`base | overlay | properties`)
   is ~238 px in a 224 px slot, clipping the "properties" button and adding a
   horizontal scrollbar to the 240 px sidebar.

## Fix 1 — preload images for loaded maps

After `loadGrid()` applies a map to the grid, collect the distinct non-null
tile names from `base` and `overlay` and call the existing `ensureImage(name)`
for each (fire-and-forget). `ensureImage` already re-renders when a fetched
image is used by the grid, so tiles appear as they load. No new machinery.

This covers all entry points — startup load, map switch, ruleset switch, and
delete-fallback — because they all funnel through `loadGrid()`.

## Fix 2 — Build-tab undo/redo

**Granularity:** one stroke = one undo step. On `mousedown` (before the first
`paint()`), push a deep snapshot of all three layers (`base`, `overlay`,
`props`) onto the undo stack. A drag paints many cells but is one step.
`resize` also pushes a snapshot before applying.

**Stacks:** in-memory, per session. Cap: 50 steps (oldest dropped). Any new
stroke clears the redo stack. Switching map or ruleset clears both stacks
(the outgoing map is already persisted at that point).

**History core is pure:** a small `history.js` module in
`tools/tile-editor/` exporting `createHistory(cap)` with
`push(snapshot)`, `undo(current)`, `redo(current)`, `clear()`, and
`canUndo`/`canRedo` — no DOM, unit-tested with `node:test` in
`test/editor-history.test.js`. Snapshot/restore of the grid (deep copy of the
three layers) lives beside it as pure helpers.

**UI:**
- `↶ undo` / `↷ redo` buttons in the Build sidebar (above the layer picker),
  disabled when their stack is empty — parity with the Draw tab toolbar.
- `Ctrl+Z` undo, `Ctrl+Shift+Z` or `Ctrl+Y` redo, active only while the Build
  view is visible (guard on `#build-view` display), and ignored when focus is
  in a text input so they don't fight native input editing.

**Persistence:** undo/redo restores the snapshot into `grid`, re-renders, and
calls the existing `persistDebounced()`. The on-disk map follows the undone
state, so a stray click is recoverable even after autosave has fired.

**Out of scope:** map management (new/rename/delete) stays outside the undo
history; delete already has a confirm dialog.

## Fix 3 — sidebar overflow CSS

In `index.html` styles: give `#paint-layers button` reduced horizontal padding
(`3px 4px`) and `min-width: 0` so the three flex buttons fit the 224 px row.
Acceptance: no horizontal scrollbar on `#paint-sidebar` at the default window
size (`scrollWidth <= clientWidth`), "properties" label fully visible.

## Testing

- `test/editor-history.test.js` — unit tests for the pure history core:
  push/undo/redo round-trip, cap eviction, redo cleared on push, clear().
- Runtime verification via Playwright (`playwright-core` `_electron`,
  DISPLAY=:0): saved map renders its tiles on load; a paint stroke then
  Ctrl+Z restores the prior state and the autosaved file matches; sidebar has
  no horizontal overflow. (Manual/scripted check, not committed as a test —
  consistent with existing editor verification practice.)
- Guard: runtime checks must not leave test edits in
  `renderer/data/painter-maps.json` (restore via git if touched).
