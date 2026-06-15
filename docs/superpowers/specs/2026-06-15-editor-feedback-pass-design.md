# Tile editor feedback pass — toasts + core gaps

**Issue:** #5 — *Tile editor: text fields & buttons give no feedback (and may not work)*
**Date:** 2026-06-15

## Problem

The tile editor was built and tested headlessly. On a real display, several
actions either give no visible acknowledgement or surface failures only to the
DevTools console. A prior triage (issue #4) confirmed the controls *work*; the
remaining issue is that feedback is inconsistent, sometimes modal, and sometimes
absent.

## Goals

- A single, consistent, non-modal feedback mechanism (toast) for confirmations
  and surfaced errors.
- Failures that currently log only to the console appear in the UI.
- The `tile-name` input shows what it will save as and what's invalid; Save tile
  is disabled when the name is unusable.
- Active-state styling is consistent (the Build-tab erase brush highlights like a
  selected tile).

## Non-goals

- No exhaustive conversion of every `alert()` in the editor.
- No validation hints on inputs other than `tile-name` (tags, tag-name,
  map-name, size fields are out of scope).
- Destructive confirmations (overwrite a tile, delete a tag/map) stay modal.
- No change to editor behavior beyond feedback.

## Components

### `tools/tile-editor/toast.js` (new)

One responsibility: transient on-screen messages. No external deps.

```
toast(message, type = 'ok')   // type ∈ 'ok' | 'error' | 'info'
```

- Lazily creates a single fixed-position container (top-center, high z-index,
  `pointer-events:none` so it never blocks clicks) and a one-time `<style>` block.
- Appends a color-coded message element (ok = green, error = red, info = grey).
- Auto-dismisses after ~2.6 s (`ok`/`info`); `error` lingers ~5 s. A click on a
  message dismisses it immediately (`pointer-events:auto` on the message itself).
- Fades out via a CSS opacity transition, then removes the node.
- No DOM in the test environment (no jsdom), so this module is verified via the
  Playwright DOM-flow check, not unit tests.

### `tools/tile-editor/lib.js` (modify — add one pure helper)

```
tileNameHint(raw) -> { valid: boolean, text: string }
```

- Uses the existing `sanitizeTileName(raw)`.
- `null` result → `{ valid: false, text: '⚠ enter a tile name' }`.
- otherwise → `{ valid: true, text: 'saves as: <name>.png' }`.
- Pure, unit-tested.

### `tools/tile-editor/editor.js` (modify)

- Import `toast` and `tileNameHint`.
- **Surface errors:** `tilesReady.catch` and a new `try/catch` around
  `initRulesets()` call `toast(..., 'error')` in addition to `console.error`.
- **Save tile:** replace the success `alert(where...)` with `toast(where, 'ok')`
  and the registered-in-ruleset success with `toast(..., 'ok')`; replace
  `alert('Save failed: ...')` with `toast('Save failed: ' + err.message,
  'error')`. Keep the overwrite `confirm()`. The empty-name `alert` path is
  removed (Save is disabled instead — see below).
- **Save rules:** success and failure `alert`s become `toast` (`ok` / `error`).
- **`tile-name` feedback:** a hint element directly under the input, updated on
  every `input` event from `tileNameHint(value)`. The Save-tile button's
  `disabled` is bound to `!valid`; it is initialized disabled and recomputed on
  input and whenever a library tile load clears the name.

### `tools/tile-editor/index.html` (modify)

- Add a `#tile-name-hint` element under the `tile-name` input (small, muted text;
  red when invalid).

### `tools/tile-editor/map-painter.js` (modify)

- Import `toast`.
- **Surface errors:** the painter-maps load `catch` and the palette-load `catch`
  call `toast(..., 'error')` in addition to `console.error`.
- **Erase active state:** `markActive(name)` also toggles the `active` class on
  the erase button (`active` when `name == null`). Build the erase button with a
  stable reference so `markActive` can find it.
- The derive guard (`reportEl.textContent = 'Select or create a ruleset first…'`)
  and the new-map duplicate-name status are already inline feedback and are left
  unchanged.

### `tools/tile-editor/rules-ui.js` (modify)

- Import `toast`. The `add-tag` guard `alert('Create a ruleset first ...')`
  becomes `toast('Create a ruleset first (+ new in the header).', 'error')`.
  Keep the delete-tag `confirm()`.

## Feedback inventory (what changes)

| Action | Before | After |
|---|---|---|
| Palette load fails | `console.error` | `console.error` + error toast |
| Rulesets load fails | (uncaught) | try/catch → error toast |
| painter-maps load fails | `console.error` | `console.error` + error toast |
| Save tile success | `alert` | ok toast |
| Save tile failure | `alert` | error toast |
| Save tile, empty name | `alert` | Save disabled + hint (no click needed) |
| Overwrite existing tile | `confirm` | `confirm` (unchanged) |
| Save rules success/failure | `alert` | ok / error toast |
| Add tag without ruleset | `alert` | error toast |
| Delete tag / delete map | `confirm` | `confirm` (unchanged) |
| tile-name typing | nothing | live `saves as:`/`⚠` hint |
| Build erase selected | no active style | `.active` highlight |

## Testing

- **Unit (`test/editor-lib.test.js` or a new `test/tile-name-hint.test.js`,
  `node --test`):** `tileNameHint` — empty/whitespace → invalid with the warn
  text; `Moss Floor` → valid, `saves as: custom_moss_floor.png`; an already
  `custom_`-prefixed name is not double-prefixed.
- **DOM flow (Playwright, throwaway script):**
  - Save tile (valid name) shows an ok toast; the toast auto-dismisses.
  - A forced load failure (e.g. point the IPC at a missing dir, or trigger the
    catch) shows an error toast — at minimum assert the toast container exists and
    a save toast appears.
  - Typing an empty vs. valid `tile-name` toggles the Save button's `disabled`
    and updates `#tile-name-hint`.
  - Selecting the Build-tab erase brush adds the `active` class to the erase
    button.

## Data flow

```
input #tile-name ─▶ tileNameHint() ─▶ #tile-name-hint text + Save.disabled
action (save/error) ─▶ toast(msg, type) ─▶ container (auto-dismiss)
async init .catch ─▶ console.error + toast(msg,'error')
```
