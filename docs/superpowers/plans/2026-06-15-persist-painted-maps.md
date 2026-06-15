# Persist Painted Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Build-tab paintings to disk as many named maps per ruleset, autosaved on paint and derive, loadable from a map-picker UI.

**Architecture:** A pure, DOM-free `painter-maps.js` module owns all store-shaping logic (testable with `node --test`). Two new IPC handlers read/write `renderer/data/painter-maps.json`. `map-painter.js` adds a picker row, debounced autosave, and per-ruleset map loading; the store is kept separate from `rulesets.json` so the game's runtime data stays clean.

**Tech Stack:** Vanilla ES modules, Electron IPC (`contextBridge`/`ipcRenderer`), `node --test` + `node:assert/strict`, Playwright (`playwright-core` `_electron`) for the DOM-flow check.

**Spec:** `docs/superpowers/specs/2026-06-15-persist-painted-maps-design.md`

---

## File Structure

- **Create** `tools/tile-editor/painter-maps.js` — pure store helpers (serialize/apply/rename/delete/list/getActive/getMap).
- **Create** `test/painter-maps.test.js` — unit tests for the pure module.
- **Modify** `main.cjs` — add `load-painter-maps` / `save-painter-maps` IPC handlers + file path const.
- **Modify** `tools/tile-editor/editor-preload.cjs` — expose `loadPainterMaps` / `savePainterMaps`.
- **Modify** `tools/tile-editor/index.html` — add a `#paint-map-picker` container at the top of `#paint-sidebar`.
- **Modify** `tools/tile-editor/map-painter.js` — picker UI, autosave, per-ruleset load, derive flush.

---

## Task 1: Pure `painter-maps.js` store module

**Files:**
- Create: `tools/tile-editor/painter-maps.js`
- Test: `test/painter-maps.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/painter-maps.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  serializeGrid, applyMap, renameMap, deleteMap,
  listMaps, getActive, getMap,
} from '../tools/tile-editor/painter-maps.js'

const grid = (rows) => rows.map(r => r.slice())

describe('serializeGrid', () => {
  it('captures dimensions and cell values', () => {
    const base = grid([['a', null], [null, 'b']])
    const overlay = grid([[null, 'o'], [null, null]])
    const s = serializeGrid(base, overlay)
    assert.equal(s.w, 2)
    assert.equal(s.h, 2)
    assert.deepEqual(s.base, [['a', null], [null, 'b']])
    assert.deepEqual(s.overlay, [[null, 'o'], [null, null]])
  })

  it('deep-copies rows so later mutation does not leak in', () => {
    const base = grid([['a']])
    const overlay = grid([[null]])
    const s = serializeGrid(base, overlay)
    base[0][0] = 'CHANGED'
    assert.equal(s.base[0][0], 'a')
  })

  it('reports w=0 for an empty grid', () => {
    const s = serializeGrid([], [])
    assert.equal(s.w, 0)
    assert.equal(s.h, 0)
  })
})

describe('applyMap', () => {
  it('creates the ruleset bucket, stores the map, and sets active', () => {
    const store = {}
    applyMap(store, 'catacombs', 'main', serializeGrid([['a']], [[null]]))
    assert.deepEqual(Object.keys(store), ['catacombs'])
    assert.equal(store.catacombs.active, 'main')
    assert.deepEqual(store.catacombs.maps.main.base, [['a']])
  })

  it('switches active to the most recently applied map', () => {
    const store = {}
    applyMap(store, 'c', 'one', serializeGrid([['a']], [[null]]))
    applyMap(store, 'c', 'two', serializeGrid([['b']], [[null]]))
    assert.equal(store.c.active, 'two')
    assert.deepEqual(listMaps(store, 'c'), ['one', 'two'])
  })
})

describe('renameMap', () => {
  it('moves the map under the new name and updates active', () => {
    const store = {}
    applyMap(store, 'c', 'old', serializeGrid([['a']], [[null]]))
    renameMap(store, 'c', 'old', 'new')
    assert.deepEqual(listMaps(store, 'c'), ['new'])
    assert.equal(store.c.active, 'new')
  })

  it('no-ops when the source is missing or the target name collides', () => {
    const store = {}
    applyMap(store, 'c', 'a', serializeGrid([['x']], [[null]]))
    applyMap(store, 'c', 'b', serializeGrid([['y']], [[null]]))
    renameMap(store, 'c', 'a', 'b')        // collision
    renameMap(store, 'c', 'missing', 'z')  // missing source
    assert.deepEqual(listMaps(store, 'c'), ['a', 'b'])
  })
})

describe('deleteMap', () => {
  it('removes the map and repoints active to the first remaining', () => {
    const store = {}
    applyMap(store, 'c', 'a', serializeGrid([['x']], [[null]]))
    applyMap(store, 'c', 'b', serializeGrid([['y']], [[null]]))
    deleteMap(store, 'c', 'b')              // 'b' was active
    assert.deepEqual(listMaps(store, 'c'), ['a'])
    assert.equal(store.c.active, 'a')
  })

  it('clears active when the last map is deleted', () => {
    const store = {}
    applyMap(store, 'c', 'a', serializeGrid([['x']], [[null]]))
    deleteMap(store, 'c', 'a')
    assert.deepEqual(listMaps(store, 'c'), [])
    assert.equal(store.c.active, null)
  })
})

describe('listMaps / getActive / getMap', () => {
  it('return empties for an unknown ruleset', () => {
    assert.deepEqual(listMaps({}, 'nope'), [])
    assert.equal(getActive({}, 'nope'), null)
    assert.equal(getMap({}, 'nope', 'x'), null)
  })

  it('getActive falls back to the first map when active is stale', () => {
    const store = { c: { active: 'gone', maps: { real: serializeGrid([['a']], [[null]]) } } }
    assert.equal(getActive(store, 'c'), 'real')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/painter-maps.test.js`
Expected: FAIL — `Cannot find module '.../painter-maps.js'`.

- [ ] **Step 3: Write the implementation**

Create `tools/tile-editor/painter-maps.js`:

```js
// Pure store helpers for Build-tab painted maps. No DOM.
// Store shape: { [ruleset]: { active: string|null, maps: { [name]: SerializedMap } } }
// SerializedMap: { w, h, base, overlay }; grids are grid[row][col] = tileName | null.

export function serializeGrid(base, overlay) {
  const copy = (g) => g.map(row => row.slice())
  return { w: base[0]?.length ?? 0, h: base.length, base: copy(base), overlay: copy(overlay) }
}

function bucket(store, ruleset) {
  store[ruleset] = store[ruleset] ?? { active: null, maps: {} }
  return store[ruleset]
}

export function applyMap(store, ruleset, name, serialized) {
  const b = bucket(store, ruleset)
  b.maps[name] = serialized
  b.active = name
  return store
}

export function renameMap(store, ruleset, from, to) {
  const b = store[ruleset]
  if (!b || !b.maps[from] || from === to || b.maps[to]) return store
  // Rebuild to preserve insertion order with the key swapped in place.
  const rebuilt = {}
  for (const [k, v] of Object.entries(b.maps)) rebuilt[k === from ? to : k] = v
  b.maps = rebuilt
  if (b.active === from) b.active = to
  return store
}

export function deleteMap(store, ruleset, name) {
  const b = store[ruleset]
  if (!b || !b.maps[name]) return store
  delete b.maps[name]
  if (b.active === name) b.active = Object.keys(b.maps)[0] ?? null
  return store
}

export function listMaps(store, ruleset) {
  return Object.keys(store[ruleset]?.maps ?? {})
}

export function getActive(store, ruleset) {
  const b = store[ruleset]
  if (!b) return null
  if (b.active && b.maps[b.active]) return b.active
  return Object.keys(b.maps ?? {})[0] ?? null
}

export function getMap(store, ruleset, name) {
  return store[ruleset]?.maps?.[name] ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/painter-maps.test.js`
Expected: PASS — all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/painter-maps.js test/painter-maps.test.js
git commit -m "feat(tile-editor): pure painter-maps store module (#2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: IPC handlers + preload bridge

**Files:**
- Modify: `main.cjs` (path const near line 12; handlers near line 57)
- Modify: `tools/tile-editor/editor-preload.cjs`

- [ ] **Step 1: Add the file-path constant in `main.cjs`**

After the existing `RULESETS_FILE` line (`main.cjs:12`):

```js
const RULESETS_FILE = path.join(__dirname, 'renderer', 'data', 'rulesets.json')
const PAINTER_MAPS_FILE = path.join(__dirname, 'renderer', 'data', 'painter-maps.json')
```

- [ ] **Step 2: Add the IPC handlers in `main.cjs`**

Immediately after the existing `save-rulesets` handler (`main.cjs:57`):

```js
ipcMain.handle('save-rulesets', (_e, data) =>
  fs.writeFileSync(RULESETS_FILE, JSON.stringify(data, null, 2)))

ipcMain.handle('load-painter-maps', () => {
  try { return JSON.parse(fs.readFileSync(PAINTER_MAPS_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-painter-maps', (_e, data) =>
  fs.writeFileSync(PAINTER_MAPS_FILE, JSON.stringify(data, null, 2)))
```

- [ ] **Step 3: Expose the bridge methods in `editor-preload.cjs`**

Add two lines inside the `exposeInMainWorld('editorAPI', { ... })` object, after `saveRulesets`:

```js
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  saveRulesets: (data) => ipcRenderer.invoke('save-rulesets', data),
  loadPainterMaps: () => ipcRenderer.invoke('load-painter-maps'),
  savePainterMaps: (data) => ipcRenderer.invoke('save-painter-maps', data),
```

- [ ] **Step 4: Verify the editor still boots (no syntax/wiring errors)**

Run: `timeout 25 npm run editor` then close the window (or Ctrl-C).
Expected: the editor window opens with no errors in the terminal. (Full persistence is verified in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add main.cjs tools/tile-editor/editor-preload.cjs
git commit -m "feat(tile-editor): IPC load/save for painter-maps.json (#2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Map-picker container in `index.html`

**Files:**
- Modify: `tools/tile-editor/index.html` (`#paint-sidebar`, near line 119)

- [ ] **Step 1: Add the picker container**

In `#paint-sidebar`, insert the picker block as the first children, before the `Size (width × height)` label (`index.html:120`):

```html
    <div id="paint-sidebar" class="panel" style="width:240px; display:flex; flex-direction:column; gap:6px; overflow-y:auto">
      <div class="label">Map</div>
      <div id="paint-map-picker" style="display:flex; gap:4px; align-items:center; flex-wrap:wrap"></div>
      <div class="label">Size (width × height)</div>
```

- [ ] **Step 2: Verify the element exists at runtime**

Run: `timeout 25 npm run editor`, open the Build tab, confirm an empty "Map" label/row appears at the top of the right sidebar. Close the window.
Expected: the `Map` label is visible; the row is empty for now (populated in Task 4).

- [ ] **Step 3: Commit**

```bash
git add tools/tile-editor/index.html
git commit -m "feat(tile-editor): map-picker container in Build sidebar (#2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire picker, autosave, and per-ruleset loading in `map-painter.js`

**Files:**
- Modify: `tools/tile-editor/map-painter.js`

This task wires the pure module + IPC into the painter. Apply the edits in order.

- [ ] **Step 1: Import the store helpers and `textPrompt`**

At the top of `map-painter.js`, after the existing imports (`map-painter.js:9`):

```js
import { deriveRules } from './derive-rules.js'
import { renderSample } from './sample-preview.js'
import {
  serializeGrid, applyMap, renameMap, deleteMap,
  listMaps, getActive, getMap,
} from './painter-maps.js'
import { textPrompt } from './text-prompt.js'
```

- [ ] **Step 2: Add persistence state + helpers inside `initMapPainter`**

Immediately after the `images` map declaration (`map-painter.js:45`, the `const images = new Map()` line), add:

```js
  const images = new Map()   // name -> Image

  // --- Painted-map persistence (issue #2) ---
  const pickerEl = document.getElementById('paint-map-picker')
  let store = {}             // { ruleset: { active, maps } } loaded from disk
  let loadedRuleset = null   // the ruleset whose map is currently in the grid
  let activeMap = null       // the map name currently in the grid
  let statusEl = null        // status text inside the picker
  let saveTimer = null

  const sanitizeMapName = (raw) =>
    (raw ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t }

  function currentSerialized() { return serializeGrid(grid.base, grid.overlay) }

  function loadGrid(map) {
    grid.base = map.base.map(r => r.slice())
    grid.overlay = map.overlay.map(r => r.slice())
    wInput.value = map.w
    hInput.value = map.h
    sizeCanvas(); render()
  }

  function persistNow() {
    clearTimeout(saveTimer)
    if (!loadedRuleset || !activeMap) return
    applyMap(store, loadedRuleset, activeMap, currentSerialized())
    setStatus('saving…')
    window.editorAPI.savePainterMaps(store)
      .then(() => setStatus('saved ✓'))
      .catch(() => setStatus('save failed'))
  }
  function persistDebounced() {
    if (!loadedRuleset || !activeMap) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persistNow, 400)
  }
```

- [ ] **Step 3: Add the picker render + actions**

Add these functions inside `initMapPainter`, just before the existing `function cellAt(ev)` (`map-painter.js:118`):

```js
  function mkBtn(label, onClick) {
    const b = document.createElement('button')
    b.textContent = label
    b.disabled = !loadedRuleset
    b.addEventListener('click', onClick)
    return b
  }

  function renderPicker() {
    pickerEl.innerHTML = ''
    const sel = document.createElement('select')
    sel.style.flex = '1'
    for (const n of (loadedRuleset ? listMaps(store, loadedRuleset) : [])) {
      const o = document.createElement('option')
      o.value = o.textContent = n
      o.selected = n === activeMap
      sel.appendChild(o)
    }
    sel.disabled = !loadedRuleset
    sel.addEventListener('change', () => switchMap(sel.value))

    statusEl = document.createElement('span')
    statusEl.style.cssText = 'color:#7a7; font-size:11px; width:100%'

    pickerEl.append(sel, mkBtn('+ new', onNew), mkBtn('✎', onRename), mkBtn('🗑', onDelete), statusEl)
  }

  function switchMap(name) {
    persistNow()
    activeMap = name
    const map = getMap(store, loadedRuleset, name)
    if (map) loadGrid(map)
    store[loadedRuleset].active = name
    window.editorAPI.savePainterMaps(store)
    renderPicker()
  }

  async function onNew() {
    if (!loadedRuleset) return
    const name = sanitizeMapName(await textPrompt('New map name (e.g. corner-variant):'))
    if (!name) return
    if (listMaps(store, loadedRuleset).includes(name)) { setStatus(`"${name}" already exists`); return }
    persistNow()
    const w = (Number(wInput.value) | 0) || 16
    const h = (Number(hInput.value) | 0) || 12
    grid.base = blank(w, h)
    grid.overlay = blank(w, h)
    activeMap = name
    sizeCanvas(); render()
    persistNow()
    renderPicker()
  }

  async function onRename() {
    if (!loadedRuleset || !activeMap) return
    const name = sanitizeMapName(await textPrompt(`Rename "${activeMap}" to:`))
    if (!name || name === activeMap) return
    if (listMaps(store, loadedRuleset).includes(name)) { setStatus(`"${name}" already exists`); return }
    renameMap(store, loadedRuleset, activeMap, name)
    activeMap = name
    window.editorAPI.savePainterMaps(store)
    setStatus('renamed')
    renderPicker()
  }

  function onDelete() {
    if (!loadedRuleset || !activeMap) return
    if (!confirm(`Delete map "${activeMap}"?`)) return
    deleteMap(store, loadedRuleset, activeMap)
    activeMap = getActive(store, loadedRuleset)
    const map = activeMap && getMap(store, loadedRuleset, activeMap)
    if (map) loadGrid(map)
    else {
      // Deleted the last map — start a fresh blank "main".
      activeMap = 'main'
      grid.base = blank(16, 12); grid.overlay = blank(16, 12)
      sizeCanvas(); render()
      applyMap(store, loadedRuleset, 'main', currentSerialized())
    }
    window.editorAPI.savePainterMaps(store)
    setStatus('deleted')
    renderPicker()
  }

  function loadActiveMapFor(ruleset) {
    loadedRuleset = ruleset
    if (!ruleset) { activeMap = null; renderPicker(); return }
    let name = getActive(store, ruleset)
    if (!name) {
      // Seed "main" from the current grid (preserves any in-memory painting).
      name = 'main'
      applyMap(store, ruleset, name, currentSerialized())
      window.editorAPI.savePainterMaps(store)
    }
    activeMap = name
    const map = getMap(store, ruleset, name)
    if (map) loadGrid(map)
    renderPicker()
  }
```

- [ ] **Step 4: Trigger autosave from paint + resize**

In `paint(ev)` (`map-painter.js:122`), add `persistDebounced()` after `render()`:

```js
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (grid[layer][y]?.[x] === undefined) return
    grid[layer][y][x] = active   // active === null erases the active layer's slot
    render()
    persistDebounced()
  }
```

In the `paint-resize` click handler (`map-painter.js:132`), add `persistDebounced()` after `sizeCanvas(); render()`:

```js
  document.getElementById('paint-resize').addEventListener('click', () => {
    const w = Math.max(2, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(2, Math.min(40, Number(hInput.value) | 0))
    const resize = (g) => Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => g[y]?.[x] ?? null))
    grid.base = resize(grid.base)
    grid.overlay = resize(grid.overlay)
    sizeCanvas(); render()
    persistDebounced()
  })
```

- [ ] **Step 5: Flush before derive**

At the very start of the `derive-btn` click handler (`map-painter.js:205`), add `persistNow()`:

```js
  document.getElementById('derive-btn').addEventListener('click', async () => {
    persistNow()
    const rs = state.rulesets[state.active]
    if (!rs) { reportEl.textContent = 'Select or create a ruleset first (top bar).'; return }
```

- [ ] **Step 6: Load the store on init and react to ruleset changes**

Replace the final three lines of `initMapPainter` (`map-painter.js:230-232`):

```js
  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
  sizeCanvas()
  render()
```

with:

```js
  document.addEventListener('ruleset-changed', () => {
    persistNow()                 // flush the outgoing ruleset's map first
    loadActiveMapFor(state.active)
  })

  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
  sizeCanvas()
  render()
  renderPicker()                 // disabled placeholder until the store loads
  ;(async () => {
    try {
      store = (await window.editorAPI.loadPainterMaps()) ?? {}
    } catch (err) {
      console.error('[map-painter] painter-maps load failed:', err)
      store = {}
    }
    loadActiveMapFor(state.active)
  })()
```

- [ ] **Step 7: Run the unit suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — existing tests plus `painter-maps.test.js` all green.

- [ ] **Step 8: Commit**

```bash
git add tools/tile-editor/map-painter.js
git commit -m "feat(tile-editor): map picker + autosave + per-ruleset load (#2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: DOM-flow verification (Playwright)

**Files:**
- Create (throwaway, not committed): `verify-maps.mjs`

- [ ] **Step 1: Write the verification script**

Create `verify-maps.mjs` at the repo root:

```js
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'

const MAPS = 'renderer/data/painter-maps.json'
const had = fs.existsSync(MAPS)
const backup = had ? fs.readFileSync(MAPS) : null

async function open() {
  const app = await electron.launch({ args: ['.', '--editor'] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)
  return { app, page }
}

const results = {}
let { app, page } = await open()
const $ = (s) => page.locator(s)

// Build tab; ensure a ruleset is active (seeds "main").
await $('#tab-build').click()
await page.waitForTimeout(300)
results.pickerOptions_initial = await $('#paint-map-picker select option').count()

// Paint one cell, wait for debounced autosave to flush.
const box = await $('#paint-canvas').boundingBox()
await page.mouse.click(box.x + 13, box.y + 13)
await page.waitForTimeout(700)
results.fileWrittenAfterPaint = fs.existsSync(MAPS)

// Create a second named map.
page.on('dialog', () => {})
await page.evaluate(() => { window.__np = true })
// "+ new" uses textPrompt overlay, not a native dialog:
await $('#paint-map-picker button', { hasText: '+ new' }).first().click()
await page.waitForTimeout(200)
const promptInput = page.locator('body > div input').last()
await promptInput.fill('variant-b')
await promptInput.press('Enter')
await page.waitForTimeout(700)
results.optionsAfterNew = await $('#paint-map-picker select option').count()

await app.close()

// Reopen and confirm persistence.
;({ app, page } = await open())
const $$ = (s) => page.locator(s)
await page.locator('#tab-build').click()
await page.waitForTimeout(300)
results.optionsAfterReopen = await page.locator('#paint-map-picker select option').count()
results.persistedFile = JSON.parse(fs.readFileSync(MAPS, 'utf8'))
await app.close()

// Restore the developer's prior file state.
if (had) fs.writeFileSync(MAPS, backup)
else fs.rmSync(MAPS, { force: true })

console.log(JSON.stringify(results, (k, v) =>
  k === 'persistedFile' ? Object.keys(v) : v, 2))
```

- [ ] **Step 2: Run the verification**

Run: `timeout 120 node verify-maps.mjs`
Expected output shows:
- `pickerOptions_initial` ≥ 1 (a `main` map was seeded),
- `fileWrittenAfterPaint`: `true`,
- `optionsAfterNew`: 2,
- `optionsAfterReopen`: 2 (persisted across restart),
- `persistedFile`: a non-empty list of ruleset keys.

- [ ] **Step 3: Clean up the throwaway script**

Run: `rm verify-maps.mjs`
Expected: working tree clean apart from the committed source changes.

- [ ] **Step 4: Final commit (only if Step 1 left intended changes)**

No code commit here — Task 5 is verification only. If `renderer/data/painter-maps.json` was created and you want a starter committed, that is optional and out of scope; leave it untracked/ignored otherwise.

---

## Self-Review

**Spec coverage:**
- Storage file + shape → Task 2 (IPC path), Task 1 (shape via `applyMap`/`serializeGrid`). ✅
- IPC handlers + bridge → Task 2. ✅
- Pure module (serialize/apply/rename/delete/list/getActive/getMap) → Task 1. ✅
- Picker UI (select + new/rename/delete + status) → Task 3 (container), Task 4 (render + actions). ✅
- Autosave on paint + resize, immediate on new/rename/delete/switch → Task 4 Steps 2–4. ✅
- `ruleset-changed` flush + load, init load → Task 4 Step 6. ✅
- Derive flush (`persistNow`) → Task 4 Step 5. ✅
- Feedback status line → Task 4 Steps 2–3 (`setStatus`). ✅
- No-active-ruleset edge (seed on ruleset creation) → Task 4 `loadActiveMapFor` seeding + `ruleset-changed`. ✅
- Duplicate-name reject → Task 4 `onNew`/`onRename`. ✅
- Corrupt/missing file → `{}` → Task 2 handler + Task 4 init try/catch. ✅
- Testing (unit + DOM flow) → Task 1, Task 5. ✅

**Type consistency:** `store` shape `{ active, maps }` is identical across `painter-maps.js`, `persistNow`, `switchMap`, and `loadActiveMapFor`. `serializeGrid` is the single source of `{ w, h, base, overlay }`, consumed by `loadGrid`. `loadedRuleset` (not `state.active`) is used for every persist/store op so a ruleset switch flushes the *outgoing* map. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅
