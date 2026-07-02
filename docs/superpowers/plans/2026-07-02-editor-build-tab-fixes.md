# Editor Build-Tab Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three audited Build-tab issues in the tile editor: saved maps rendering blank, no undo/redo, and the sidebar clipping the "properties" button.

**Architecture:** All changes live in `tools/tile-editor/`. A new pure `history.js` module (no DOM) holds the undo/redo core and grid-snapshot helpers, unit-tested with `node:test`. `map-painter.js` wires the history into paint strokes, resize, buttons, and keyboard shortcuts, and gains a 3-line image-preload fix in `loadGrid()`. `index.html` gets a CSS tweak plus two sidebar buttons.

**Tech Stack:** Vanilla JS (ESM), Electron, `node:test`, `playwright-core` (`_electron`) for runtime verification.

**Spec:** `docs/superpowers/specs/2026-07-02-editor-build-tab-fixes-design.md`

## Global Constraints

- Tests are `node:test` files in `test/`, run via `npm test` (`node --test test/`).
- Runtime verification must not leave test edits in `renderer/data/painter-maps.json` — check `git status renderer/data/` afterward and `git checkout` the file if dirty.
- Undo stack cap: 50 steps. Redo bindings: `Ctrl+Shift+Z` and `Ctrl+Y` both work. `Cmd` (metaKey) accepted alongside `Ctrl`.
- Map management (new/rename/delete) stays OUTSIDE undo history.

---

### Task 1: Preload tile images in `loadGrid` (blank-map fix)

**Files:**
- Modify: `tools/tile-editor/map-painter.js:75-82` (`loadGrid`)

**Interfaces:**
- Consumes: existing `ensureImage(name)` (map-painter.js:138) — async, caches image and re-renders if the grid uses it.
- Produces: nothing new; `loadGrid(map)` behavior only.

This is not unit-testable (module needs a DOM); it is verified at runtime in Task 4. Keep the change minimal.

- [ ] **Step 1: Add the preload to `loadGrid`**

In `tools/tile-editor/map-painter.js`, change `loadGrid` from:

```js
  function loadGrid(map) {
    grid.base = map.base.map(r => r.slice())
    grid.overlay = map.overlay.map(r => r.slice())
    grid.props = map.props ? map.props.map(r => r.map(c => (c ? { ...c } : null))) : blank(map.w, map.h)
    wInput.value = map.w
    hInput.value = map.h
    sizeCanvas(); render()
  }
```

to:

```js
  function loadGrid(map) {
    grid.base = map.base.map(r => r.slice())
    grid.overlay = map.overlay.map(r => r.slice())
    grid.props = map.props ? map.props.map(r => r.map(c => (c ? { ...c } : null))) : blank(map.w, map.h)
    wInput.value = map.w
    hInput.value = map.h
    sizeCanvas(); render()
    // Fetch every tile image the map references; ensureImage re-renders as
    // each arrives, so the saved painting appears without user interaction.
    const used = new Set([...grid.base.flat(), ...grid.overlay.flat()].filter(Boolean))
    for (const name of used) ensureImage(name)
  }
```

(`ensureImage` is a hoisted function declaration defined later in the same closure — safe to call here.)

- [ ] **Step 2: Run the existing suite to confirm nothing broke**

Run: `npm test`
Expected: all tests PASS (this file has no unit tests; the suite guards against accidental syntax/regression elsewhere).

- [ ] **Step 3: Commit**

```bash
git add tools/tile-editor/map-painter.js
git commit -m "fix(tile-editor): preload map tile images so saved maps render"
```

---

### Task 2: Pure undo/redo history core (`history.js`)

**Files:**
- Create: `tools/tile-editor/history.js`
- Test: `test/editor-history.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces (used verbatim by Task 3):
  - `createHistory(cap = 50)` → `{ push(snapshot), undo(current), redo(current), clear(), canUndo, canRedo }`
    - `push(snapshot)`: stores a deep-copied-by-caller snapshot; evicts oldest beyond `cap`; clears the redo stack.
    - `undo(current)`: returns the most recent snapshot (or `null` if none); pushes `current` onto the redo stack.
    - `redo(current)`: inverse of `undo`; returns `null` if no redo available.
    - `canUndo` / `canRedo`: boolean getters.
  - `snapshotLayers(grid)` → deep copy `{ base, overlay, props }` of a grid holding `base: (string|null)[][]`, `overlay: (string|null)[][]`, `props: (object|null)[][]`.

- [ ] **Step 1: Write the failing test**

Create `test/editor-history.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, snapshotLayers } from '../tools/tile-editor/history.js'

describe('createHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const h = createHistory()
    assert.equal(h.canUndo, false)
    assert.equal(h.canRedo, false)
    assert.equal(h.undo('cur'), null)
    assert.equal(h.redo('cur'), null)
  })

  it('round-trips push → undo → redo', () => {
    const h = createHistory()
    h.push('s1')                        // state before stroke 1
    assert.equal(h.canUndo, true)
    const back = h.undo('s2')           // current state s2, going back to s1
    assert.equal(back, 's1')
    assert.equal(h.canUndo, false)
    assert.equal(h.canRedo, true)
    const fwd = h.redo('s1')            // current state s1, going forward to s2
    assert.equal(fwd, 's2')
    assert.equal(h.canUndo, true)
    assert.equal(h.canRedo, false)
  })

  it('a new push clears the redo stack', () => {
    const h = createHistory()
    h.push('s1')
    h.undo('s2')
    assert.equal(h.canRedo, true)
    h.push('s3')
    assert.equal(h.canRedo, false)
  })

  it('evicts the oldest snapshot beyond the cap', () => {
    const h = createHistory(2)
    h.push('a'); h.push('b'); h.push('c')   // 'a' evicted
    assert.equal(h.undo('cur'), 'c')
    assert.equal(h.undo('c'), 'b')
    assert.equal(h.undo('b'), null)          // 'a' is gone
  })

  it('clear() empties both stacks', () => {
    const h = createHistory()
    h.push('s1')
    h.undo('s2')
    h.clear()
    assert.equal(h.canUndo, false)
    assert.equal(h.canRedo, false)
  })
})

describe('snapshotLayers', () => {
  const mkGrid = () => ({
    base: [['a', null], [null, 'b']],
    overlay: [[null, 'o'], [null, null]],
    props: [[{ collision: 'wall' }, null], [null, { interaction: { type: 'door' } }]],
  })

  it('copies all three layers', () => {
    const g = mkGrid()
    const s = snapshotLayers(g)
    assert.deepEqual(s, mkGrid())
  })

  it('later mutation of the grid does not leak into the snapshot', () => {
    const g = mkGrid()
    const s = snapshotLayers(g)
    g.base[0][0] = 'CHANGED'
    g.props[0][0].collision = 'walkable'
    assert.equal(s.base[0][0], 'a')
    assert.equal(s.props[0][0].collision, 'wall')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/editor-history.test.js`
Expected: FAIL — `Cannot find module '../tools/tile-editor/history.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/tile-editor/history.js`:

```js
// Pure undo/redo core for the Build tab. Snapshots are opaque to this module;
// callers pass deep copies (snapshotLayers) so restored state can be assigned
// directly without aliasing live grids.

export function createHistory(cap = 50) {
  const undoStack = []
  const redoStack = []
  return {
    push(snapshot) {
      undoStack.push(snapshot)
      if (undoStack.length > cap) undoStack.shift()
      redoStack.length = 0
    },
    undo(current) {
      if (!undoStack.length) return null
      redoStack.push(current)
      return undoStack.pop()
    },
    redo(current) {
      if (!redoStack.length) return null
      undoStack.push(current)
      return redoStack.pop()
    },
    clear() {
      undoStack.length = 0
      redoStack.length = 0
    },
    get canUndo() { return undoStack.length > 0 },
    get canRedo() { return redoStack.length > 0 },
  }
}

// Deep-copy the three paint layers. props cells are single-level objects whose
// values are either strings or small plain objects (interaction), so a
// structuredClone covers them without hand-rolled per-key copying.
export function snapshotLayers(grid) {
  return {
    base: grid.base.map(r => r.slice()),
    overlay: grid.overlay.map(r => r.slice()),
    props: grid.props.map(r => r.map(c => (c ? structuredClone(c) : null))),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/editor-history.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add tools/tile-editor/history.js test/editor-history.test.js
git commit -m "feat(tile-editor): pure undo/redo history core + tests"
```

---

### Task 3: Wire undo/redo into the Build tab + sidebar CSS fix

**Files:**
- Modify: `tools/tile-editor/index.html` (sidebar buttons + layer-button CSS)
- Modify: `tools/tile-editor/map-painter.js` (history wiring)

**Interfaces:**
- Consumes: `createHistory(cap)`, `snapshotLayers(grid)` from `tools/tile-editor/history.js` (Task 2 signatures).
- Produces: DOM ids `#paint-undo`, `#paint-redo` (used by Task 4's runtime check).

- [ ] **Step 1: Add buttons and CSS to `index.html`**

In the `<style>` block, after the `#paint-canvas` rule (line 63), add:

```css
  #paint-layers button { padding: 3px 4px; min-width: 0; }
```

In `#paint-sidebar`, insert a history row between the map-size block and the `LAYER` label — i.e. immediately before `<div class="label">Layer</div>`:

```html
      <div id="paint-history" style="display:flex; gap:4px">
        <button id="paint-undo" style="flex:1" disabled>↶ undo</button>
        <button id="paint-redo" style="flex:1" disabled>↷ redo</button>
      </div>
```

- [ ] **Step 2: Wire history into `map-painter.js`**

Add to the imports at the top of `tools/tile-editor/map-painter.js`:

```js
import { createHistory, snapshotLayers } from './history.js'
```

Inside `initMapPainter`, after the `const images = new Map()` line, add:

```js
  // --- Undo/redo (one stroke or resize = one step) ---
  const history = createHistory(50)
  const undoBtn = document.getElementById('paint-undo')
  const redoBtn = document.getElementById('paint-redo')
  function updateHistoryButtons() {
    undoBtn.disabled = !history.canUndo
    redoBtn.disabled = !history.canRedo
  }
  function resetHistory() { history.clear(); updateHistoryButtons() }
  function restoreSnapshot(snap) {
    grid.base = snap.base
    grid.overlay = snap.overlay
    grid.props = snap.props
    wInput.value = grid.base[0].length
    hInput.value = grid.base.length
    sizeCanvas(); render()
    persistDebounced()
    updateHistoryButtons()
  }
  function doUndo() {
    const snap = history.undo(snapshotLayers(grid))
    if (snap) restoreSnapshot(snap)
  }
  function doRedo() {
    const snap = history.redo(snapshotLayers(grid))
    if (snap) restoreSnapshot(snap)
  }
  undoBtn.addEventListener('click', doUndo)
  redoBtn.addEventListener('click', doRedo)
  window.addEventListener('keydown', (e) => {
    if (document.getElementById('build-view').style.display === 'none') return
    const t = e.target
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo() }
  })
```

(`restoreSnapshot` may assign the popped snapshot's arrays directly: the current state was deep-copied onto the other stack by `snapshotLayers`, and the popped snapshot is no longer referenced by any stack.)

- [ ] **Step 3: Push a snapshot at stroke start and before resize**

Change the mousedown listener (map-painter.js:337) from:

```js
  canvas.addEventListener('mousedown', e => { painting = true; paint(e) })
```

to:

```js
  canvas.addEventListener('mousedown', e => {
    history.push(snapshotLayers(grid))
    updateHistoryButtons()
    painting = true
    paint(e)
  })
```

In the `paint-resize` click handler (map-painter.js:341), add the same two lines as the first statements of the callback:

```js
    history.push(snapshotLayers(grid))
    updateHistoryButtons()
```

- [ ] **Step 4: Clear history when the loaded map changes**

Add `resetHistory()` at the end of `loadGrid` (after the preload loop from Task 1), and in the two places that build a blank grid without going through `loadGrid`:

- in `onNew`, right after `sizeCanvas(); render()` (map-painter.js:265)
- in `onDelete`'s else branch (deleted the last map), right after its `sizeCanvas(); render()` (map-painter.js:293)

- [ ] **Step 5: Run the suite and boot the editor**

Run: `npm test`
Expected: all PASS

Run: `DISPLAY=:0 npm run editor` briefly (or proceed to Task 4's scripted check) to confirm the editor still boots without console errors.

- [ ] **Step 6: Commit**

```bash
git add tools/tile-editor/index.html tools/tile-editor/map-painter.js
git commit -m "feat(tile-editor): Build-tab undo/redo + unclip layer buttons"
```

---

### Task 4: Runtime verification (Playwright, non-destructive)

**Files:**
- Create (scratch, NOT committed): `<scratchpad>/verify-build-fixes.js`

**Interfaces:**
- Consumes: DOM ids `#paint-undo`, `#paint-redo` (Task 3), fixed `loadGrid` (Task 1). Saved map `castle-demo-1781607145194` in ruleset `catacombs` with 192 painted base cells.

- [ ] **Step 1: Write the verification script**

Write to the session scratchpad directory (referenced below as `$SCRATCH`):

```js
// Verify Build-tab fixes: saved map renders, undo restores, sidebar fits.
const { _electron } = require('playwright-core')

const nonBlankRatio = async (win) => win.evaluate(() => {
  const c = document.getElementById('paint-canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let lit = 0, total = d.length / 4
  for (let i = 0; i < d.length; i += 4) {
    // background fill is #15151d; count pixels meaningfully brighter
    if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) lit++
  }
  return lit / total
})

;(async () => {
  const app = await _electron.launch({
    args: ['.', '--editor'],
    cwd: '/home/lappemikb/projects/dungeon-crawler',
    env: { ...process.env, DISPLAY: ':0' },
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1800)
  await win.click('#tab-build')
  await win.waitForTimeout(1500)   // allow preloads to land

  // 1. Saved map renders without interaction
  const ratio = await nonBlankRatio(win)
  console.log('RENDER_RATIO', ratio.toFixed(3), ratio > 0.5 ? 'PASS' : 'FAIL')

  // 2. Stroke + undo restores the canvas and re-persists
  const before = await win.evaluate(() =>
    document.getElementById('paint-canvas').toDataURL())
  const tile = await win.$('#paint-palette img')
  await tile.click()
  const box = await (await win.$('#paint-canvas')).boundingBox()
  await win.mouse.click(box.x + 13, box.y + 13)
  await win.waitForTimeout(600)     // let the debounced save fire
  const undoEnabled = await win.evaluate(() => !document.getElementById('paint-undo').disabled)
  console.log('UNDO_ENABLED_AFTER_STROKE', undoEnabled ? 'PASS' : 'FAIL')
  await win.click('#paint-undo')
  await win.waitForTimeout(600)     // let the undo re-save fire
  const after = await win.evaluate(() =>
    document.getElementById('paint-canvas').toDataURL())
  console.log('UNDO_RESTORES_CANVAS', after === before ? 'PASS' : 'FAIL')

  // 3. Ctrl+Z / Ctrl+Shift+Z keyboard path (redo then undo again)
  await win.keyboard.press('Control+Shift+Z')   // redo the stroke
  await win.waitForTimeout(300)
  const redone = await win.evaluate(() =>
    document.getElementById('paint-canvas').toDataURL())
  console.log('REDO_REAPPLIES', redone !== before ? 'PASS' : 'FAIL')
  await win.keyboard.press('Control+Z')          // undo again
  await win.waitForTimeout(600)
  const undone = await win.evaluate(() =>
    document.getElementById('paint-canvas').toDataURL())
  console.log('CTRL_Z_UNDOES', undone === before ? 'PASS' : 'FAIL')

  // 4. Sidebar no longer overflows
  const fits = await win.evaluate(() => {
    const sb = document.getElementById('paint-sidebar')
    return sb.scrollWidth <= sb.clientWidth
  })
  console.log('SIDEBAR_FITS', fits ? 'PASS' : 'FAIL')

  await app.close()
})().catch((e) => { console.error('VERIFY_FAIL', e); process.exit(1) })
```

- [ ] **Step 2: Run it**

Run: `DISPLAY=:0 NODE_PATH=/home/lappemikb/projects/dungeon-crawler/node_modules node $SCRATCH/verify-build-fixes.js`
Expected: all five lines print `PASS`.

- [ ] **Step 3: Confirm no data damage**

Run: `git status --short renderer/data/`
Expected: clean. The stroke was undone before its state could stick, and undo re-persisted the original grid; if `painter-maps.json` is dirty anyway, inspect with `git diff renderer/data/painter-maps.json` — a whitespace/ordering-only rewrite from re-serialization is acceptable to `git checkout`; real cell changes mean the undo persistence is broken (fix before proceeding).

Run: `git checkout renderer/data/painter-maps.json` (if dirty)

- [ ] **Step 4: Final suite run and verification screenshot**

Run: `npm test`
Expected: all PASS.

No commit in this task (scratch script only).

---

## Self-Review Notes

- Spec coverage: Fix 1 → Task 1; Fix 2 (core, UI, shortcuts, persistence, clearing) → Tasks 2–3; Fix 3 → Task 3 Step 1; spec's testing section → Task 2 tests + Task 4 runtime checks including the painter-maps.json guard.
- `snapshotLayers` in the spec said "deep copy … pure helpers"; implemented with `structuredClone` for props cells — matches intent.
- Type consistency: `createHistory`/`snapshotLayers`/`#paint-undo`/`#paint-redo` names identical across Tasks 2, 3, 4.
