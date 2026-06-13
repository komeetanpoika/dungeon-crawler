# Template Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Build" tab to the tile editor for painting reusable room/landmark templates, saved to `renderer/data/templates.json` and merged into the game's `TEMPLATES` so they can be wired to a depth as a `landmark`.

**Architecture:** A shared, data-driven `TEMPLATE_LEGEND` (in `renderer/data/levels.js`) becomes the single source of truth for the symbol→tile/spawn mapping; `placeTemplate` is refactored to consume it, and the editor palette renders from it. The editor writes only `templates.json` through the preload bridge (mirroring `rulesets.json`); `levels.js` merges custom templates into the exported `TEMPLATES` map at game startup. No game code is edited by the editor.

**Tech Stack:** Vanilla ES modules + Canvas (renderer & editor), Electron IPC (`main.cjs` + preload bridges), `node --test` for unit tests.

---

## File Structure

**Game / shared (under test):**
- Modify `renderer/data/levels.js` — add `TEMPLATE_LEGEND`, `registerCustomTemplates()`; import `TILE`.
- Modify `renderer/systems/map.js` — export `placeTemplate`, refactor it to use `TEMPLATE_LEGEND`.
- Modify `renderer/game.js` — load `templates.json` and call `registerCustomTemplates` at startup.
- Modify `preload.cjs` — expose `loadTemplates` on `saveAPI` (game side).
- Modify `main.cjs` — add `load-templates` / `save-templates` IPC handlers.

**Editor:**
- Create `tools/tile-editor/template-grid.js` — pure grid helpers (no DOM), unit-tested.
- Create `tools/tile-editor/template-builder.js` — Build-tab UI logic (DOM).
- Modify `tools/tile-editor/editor-preload.cjs` — add `loadTemplates` / `saveTemplates`.
- Modify `tools/tile-editor/index.html` — Build tab button, `#build-view`, Save template button.
- Modify `tools/tile-editor/editor.js` — 3-way tab toggle, mount the builder.

**Tests:**
- Modify `test/map.test.js` — characterization + legend tests for `placeTemplate`.
- Create `test/levels.test.js` — `registerCustomTemplates` merge tests.
- Create `test/template-grid.test.js` — pure grid-helper tests.

---

## Task 1: Export and characterize `placeTemplate`

Locks current behavior with tests **before** refactoring. `placeTemplate` is currently a private function in `map.js`; export it unchanged, then capture its behavior.

**Files:**
- Modify: `renderer/systems/map.js:247` (change `function placeTemplate` → `export function placeTemplate`)
- Test: `test/map.test.js`

- [ ] **Step 1: Export the existing function (no logic change)**

In `renderer/systems/map.js`, change the declaration on line 247 from:

```js
function placeTemplate(map, template, ox, oy, roomId) {
```

to:

```js
export function placeTemplate(map, template, ox, oy, roomId) {
```

- [ ] **Step 2: Write characterization tests**

Append to `test/map.test.js`. Add `placeTemplate` to the existing import from `../renderer/systems/map.js` (it already imports `createMap`):

```js
import { generateLevel, isFullyConnected, createMap, carveRoomShaped, carveCorridor, placeTemplate } from '../renderer/systems/map.js'

describe('placeTemplate', () => {
  // One template exercising all 11 symbols. Scan order is row-major.
  const ALL = {
    tiles: ['#.C', 'TSX', 'WPL', 'DB.'],
    width: 3, height: 4,
  }

  it('maps every tile symbol to the right tile id and roomId', () => {
    const map = createMap(3, 4)
    placeTemplate(map, ALL, 0, 0, 7)
    assert.equal(map[0][0].tile, TILE.WALL)
    assert.equal(map[0][0].roomId, null)            // walls keep no roomId
    assert.equal(map[0][1].tile, TILE.FLOOR);    assert.equal(map[0][1].roomId, 7)
    assert.equal(map[0][2].tile, TILE.COLUMN);   assert.equal(map[0][2].roomId, 7)
    assert.equal(map[1][0].tile, TILE.TREASURE); assert.equal(map[1][0].roomId, 7)
    assert.equal(map[1][1].tile, TILE.SHRINE);   assert.equal(map[1][1].roomId, 7)
    assert.equal(map[1][2].tile, TILE.SNARE);    assert.equal(map[1][2].roomId, 7)
    // spawn cells stand on floor
    assert.equal(map[2][0].tile, TILE.FLOOR)     // weapon
    assert.equal(map[3][0].tile, TILE.FLOOR)     // dragon
    assert.equal(map[3][1].tile, TILE.FLOOR)     // boss
  })

  it('produces spawns in scan order with the right shapes', () => {
    const map = createMap(3, 4)
    const spawns = placeTemplate(map, ALL, 0, 0, 7)
    assert.deepEqual(spawns, [
      { kind: 'weapon', x: 0, y: 2 },             // weapon/potion carry no roomId
      { kind: 'potion', x: 1, y: 2 },
      { kind: 'door',   x: 2, y: 2, roomId: 7 },
      { kind: 'dragon', x: 0, y: 3, roomId: 7 },
      { kind: 'dragon_boss', x: 1, y: 3, roomId: 7 },
    ])
  })

  it('places only the first dragon_boss', () => {
    const map = createMap(2, 1)
    const spawns = placeTemplate(map, { tiles: ['BB'], width: 2, height: 1 }, 0, 0, 3)
    const bosses = spawns.filter(s => s.kind === 'dragon_boss')
    assert.equal(bosses.length, 1)
    assert.equal(map[0][0].tile, TILE.FLOOR)      // both cells still become floor
    assert.equal(map[0][1].tile, TILE.FLOOR)
  })

  it('honors the ox/oy offset and ignores out-of-bounds cells', () => {
    const map = createMap(4, 4)
    placeTemplate(map, { tiles: ['##', '##'], width: 2, height: 2 }, 2, 2, 1)
    assert.equal(map[2][2].tile, TILE.WALL)
    assert.equal(map[3][3].tile, TILE.WALL)
    assert.equal(map[0][0].tile, TILE.WALL)       // createMap default, untouched
  })

  it('ignores unknown characters', () => {
    const map = createMap(2, 1)
    const spawns = placeTemplate(map, { tiles: ['?z'], width: 2, height: 1 }, 0, 0, 1)
    assert.deepEqual(spawns, [])
    assert.equal(map[0][0].tile, TILE.WALL)       // unchanged default
  })
})
```

- [ ] **Step 3: Run the tests, expect PASS against the current implementation**

Run: `npm test -- --test-name-pattern=placeTemplate`
Expected: PASS. (If any fail, the characterization is wrong — fix the test to match current behavior before refactoring.)

- [ ] **Step 4: Commit**

```bash
git add renderer/systems/map.js test/map.test.js
git commit -m "test: characterize placeTemplate before legend refactor"
```

---

## Task 2: Shared `TEMPLATE_LEGEND` + refactor `placeTemplate`

Introduce the data-driven legend and make `placeTemplate` consume it. The Task 1 tests must still pass unchanged.

**Files:**
- Modify: `renderer/data/levels.js` (add import + `TEMPLATE_LEGEND`)
- Modify: `renderer/systems/map.js` (import legend, rewrite `placeTemplate` body)
- Test: `test/map.test.js` (reuse Task 1 tests; add a legend-shape test)

- [ ] **Step 1: Add the legend to `levels.js`**

At the very top of `renderer/data/levels.js`, add the import (the file currently has no imports), then add the legend export below the `TEMPLATES` object:

```js
import { TILE } from '../systems/entities.js'
```

Add (anywhere after the `TILE` import; placing it just above `export const TEMPLATES` reads well):

```js
// Single source of truth for template character → meaning. Consumed by
// placeTemplate (game) and the editor's Build-tab palette. Adding a new symbol
// here is all that's needed for both sides to pick it up.
//   kind 'tile'  → sets map cell tile (walls get no roomId; everything else does)
//   kind 'spawn' → cell becomes FLOOR + roomId; pushes a spawn.
//     roomScoped: include roomId on the spawn (monsters/doors yes; items no)
//     single:     place at most one (the dragon boss)
// color/icon drive the editor palette + canvas; the game ignores them.
export const TEMPLATE_LEGEND = {
  '#': { label: 'Wall',     kind: 'tile',  tile: TILE.WALL,     color: '#3a3a44' },
  '.': { label: 'Floor',    kind: 'tile',  tile: TILE.FLOOR,    color: '#23232f' },
  'C': { label: 'Column',   kind: 'tile',  tile: TILE.COLUMN,   color: '#5a5a6a' },
  'T': { label: 'Treasure', kind: 'tile',  tile: TILE.TREASURE, color: '#b89030', icon: '◆' },
  'S': { label: 'Shrine',   kind: 'tile',  tile: TILE.SHRINE,   color: '#3a6a8a', icon: '⛨' },
  'X': { label: 'Snare',    kind: 'tile',  tile: TILE.SNARE,    color: '#7a3a3a', icon: '※' },
  'L': { label: 'Door',     kind: 'spawn', spawn: 'door',        roomScoped: false, color: '#8a6a3a', icon: '⌷' },
  'W': { label: 'Weapon',   kind: 'spawn', spawn: 'weapon',      roomScoped: false, color: '#3a8a6a', icon: '⚔' },
  'P': { label: 'Potion',   kind: 'spawn', spawn: 'potion',      roomScoped: false, color: '#8a3a8a', icon: '⚗' },
  'D': { label: 'Dragon',   kind: 'spawn', spawn: 'dragon',      roomScoped: true,  color: '#a33333', icon: '🐉' },
  'B': { label: 'Boss',     kind: 'spawn', spawn: 'dragon_boss', roomScoped: true, single: true, color: '#cc2222', icon: '🐲' },
}
```

- [ ] **Step 2: Refactor `placeTemplate` to use the legend**

In `renderer/systems/map.js`, the import on line 2 currently is:

```js
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES } from '../data/levels.js'
```

Add `TEMPLATE_LEGEND` to it:

```js
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES, TEMPLATE_LEGEND } from '../data/levels.js'
```

Replace the entire body of `placeTemplate` (the function exported in Task 1, the long `if (ch === '#') … else if (ch === 'C')` chain) with:

```js
export function placeTemplate(map, template, ox, oy, roomId) {
  const spawns = []
  let bossPlaced = false
  template.tiles.forEach((row, dy) => {
    ;[...row].forEach((ch, dx) => {
      const tx = ox + dx, ty = oy + dy
      if (!map[ty]?.[tx]) return
      const entry = TEMPLATE_LEGEND[ch]
      if (!entry) return
      if (entry.kind === 'tile') {
        map[ty][tx].tile = entry.tile
        if (entry.tile !== TILE.WALL) map[ty][tx].roomId = roomId
        return
      }
      // spawn: stands on floor
      map[ty][tx].tile = TILE.FLOOR
      map[ty][tx].roomId = roomId
      if (entry.single) {
        if (bossPlaced) return
        bossPlaced = true
      }
      const spawn = { kind: entry.spawn, x: tx, y: ty }
      if (entry.roomScoped) spawn.roomId = roomId
      spawns.push(spawn)
    })
  })
  return spawns
}
```

`map.js` already imports `TILE` (line 1: `import { TILE, isWalkable } from './entities.js'`), so `TILE.WALL`/`TILE.FLOOR` resolve.

- [ ] **Step 3: Add a legend-shape sanity test**

Append to the `describe('placeTemplate', …)` block in `test/map.test.js`. Import the legend at the top of the file:

```js
import { TEMPLATE_LEGEND } from '../renderer/data/levels.js'
```

Test:

```js
  it('legend covers all 11 template symbols with valid entries', () => {
    assert.deepEqual(
      Object.keys(TEMPLATE_LEGEND).sort(),
      ['#', '.', 'B', 'C', 'D', 'L', 'P', 'S', 'T', 'W', 'X'],
    )
    for (const [ch, e] of Object.entries(TEMPLATE_LEGEND)) {
      assert.ok(e.label, `${ch} has a label`)
      assert.ok(e.kind === 'tile' || e.kind === 'spawn', `${ch} has a valid kind`)
      if (e.kind === 'tile') assert.equal(typeof e.tile, 'number', `${ch} has a tile id`)
      else assert.equal(typeof e.spawn, 'string', `${ch} has a spawn kind`)
    }
  })
```

- [ ] **Step 4: Run the full placeTemplate suite, expect PASS**

Run: `npm test -- --test-name-pattern=placeTemplate`
Expected: PASS — the Task 1 characterization tests pass against the refactored code, plus the new legend test.

- [ ] **Step 5: Run the whole suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass (notably the existing `generateLevel` / connectivity tests, which exercise `placeTemplate` via landmarks).

- [ ] **Step 6: Commit**

```bash
git add renderer/data/levels.js renderer/systems/map.js test/map.test.js
git commit -m "refactor: drive placeTemplate from a shared TEMPLATE_LEGEND"
```

---

## Task 3: Merge custom templates into `TEMPLATES`

Add a pure `registerCustomTemplates(custom)` to `levels.js` that folds editor-authored templates into the exported `TEMPLATES`, protecting built-in names and skipping malformed entries.

**Files:**
- Modify: `renderer/data/levels.js`
- Test: `test/levels.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/levels.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, registerCustomTemplates } from '../renderer/data/levels.js'

describe('registerCustomTemplates', () => {
  it('adds a valid custom template to TEMPLATES and returns its name', () => {
    const added = registerCustomTemplates({
      MOSS_CRYPT: { tiles: ['##', '##'], width: 2, height: 2 },
    })
    assert.deepEqual(added, ['MOSS_CRYPT'])
    assert.deepEqual(TEMPLATES.MOSS_CRYPT, { tiles: ['##', '##'], width: 2, height: 2 })
  })

  it('never overrides a built-in template name', () => {
    const original = TEMPLATES.SHRINE
    const added = registerCustomTemplates({
      SHRINE: { tiles: ['XXX'], width: 3, height: 1 },
    })
    assert.deepEqual(added, [])
    assert.equal(TEMPLATES.SHRINE, original)
  })

  it('skips malformed entries and tolerates non-objects', () => {
    assert.deepEqual(registerCustomTemplates(null), [])
    assert.deepEqual(registerCustomTemplates({ BAD1: { width: 2 } }), [])      // no tiles
    assert.deepEqual(registerCustomTemplates({ BAD2: { tiles: 'nope' } }), []) // tiles not array
    assert.equal(TEMPLATES.BAD1, undefined)
    assert.equal(TEMPLATES.BAD2, undefined)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npm test -- --test-name-pattern=registerCustomTemplates`
Expected: FAIL — `registerCustomTemplates is not a function`.

- [ ] **Step 3: Implement it in `levels.js`**

In `renderer/data/levels.js`, after the `TEMPLATES` object is defined, add:

```js
// Names defined in code; editor-authored templates may never shadow these.
const BUILTIN_TEMPLATE_NAMES = new Set(Object.keys(TEMPLATES))

// Fold editor-authored templates (from renderer/data/templates.json) into the
// exported TEMPLATES map. Built-in names win; malformed entries are skipped.
// Returns the list of names actually registered.
export function registerCustomTemplates(custom) {
  const added = []
  if (!custom || typeof custom !== 'object') return added
  for (const [name, tmpl] of Object.entries(custom)) {
    if (BUILTIN_TEMPLATE_NAMES.has(name)) continue
    if (!tmpl || !Array.isArray(tmpl.tiles) || !tmpl.width || !tmpl.height) continue
    TEMPLATES[name] = { tiles: tmpl.tiles, width: tmpl.width, height: tmpl.height }
    added.push(name)
  }
  return added
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npm test -- --test-name-pattern=registerCustomTemplates`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/levels.js test/levels.test.js
git commit -m "feat: registerCustomTemplates merges templates.json into TEMPLATES"
```

---

## Task 4: IPC plumbing + game startup wiring

Persist and load `renderer/data/templates.json` (editor write + read, game read), and register custom templates at game startup. Mirrors the existing `rulesets.json` wiring.

**Files:**
- Modify: `main.cjs`
- Modify: `preload.cjs` (game bridge)
- Modify: `tools/tile-editor/editor-preload.cjs` (editor bridge)
- Modify: `renderer/game.js`

- [ ] **Step 1: Add the templates file path + IPC handlers in `main.cjs`**

In `main.cjs`, after the `RULESETS_FILE` constant (line 12), add:

```js
const TEMPLATES_FILE = path.join(__dirname, 'renderer', 'data', 'templates.json')
```

After the existing `save-rulesets` handler (line 57), add:

```js
ipcMain.handle('load-templates', () => {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-templates', (_e, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Expected a templates object')
  }
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(data, null, 2))
})
```

- [ ] **Step 2: Expose `loadTemplates` to the game (`preload.cjs`)**

In `preload.cjs`, add a line inside the `saveAPI` object:

```js
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
```

so it reads:

```js
contextBridge.exposeInMainWorld('saveAPI', {
  saveMeta: (data) => ipcRenderer.invoke('save-meta', data),
  loadMeta: () => ipcRenderer.invoke('load-meta'),
  deleteRun: () => ipcRenderer.invoke('delete-run'),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
})
```

- [ ] **Step 3: Expose load/save to the editor (`editor-preload.cjs`)**

In `tools/tile-editor/editor-preload.cjs`, add inside the `editorAPI` object:

```js
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
  saveTemplates: (data) => ipcRenderer.invoke('save-templates', data),
```

- [ ] **Step 4: Register custom templates at game startup (`renderer/game.js`)**

In `renderer/game.js`, add `registerCustomTemplates` to the import from `levels.js`. There is currently no direct import of `levels.js` in `game.js`; add one near the top imports (after line 1's `generateLevel` import is fine):

```js
import { registerCustomTemplates } from './data/levels.js'
```

In `init()` (around line 570), right after the rulesets line:

```js
  rulesets = (await window.saveAPI.loadRulesets()) ?? {}
```

add:

```js
  registerCustomTemplates((await window.saveAPI.loadTemplates()) ?? {})
```

- [ ] **Step 5: Verify the suite still passes (no test covers IPC, but guard against breakage)**

Run: `npm test`
Expected: all tests pass (unchanged — this task is wiring only).

- [ ] **Step 6: Manual smoke test**

Run: `npm start`
Expected: game launches and plays exactly as before (with no `templates.json` present, `load-templates` returns `{}` and nothing changes).

- [ ] **Step 7: Commit**

```bash
git add main.cjs preload.cjs tools/tile-editor/editor-preload.cjs renderer/game.js
git commit -m "feat: load/save templates.json over IPC; register customs at startup"
```

---

## Task 5: Pure builder grid helpers

DOM-free helpers for the Build tab: blank grid, resize (crop/pad with wall), grid→template object, and template-name sanitizing. Unit-tested like `lib.js`.

**Files:**
- Create: `tools/tile-editor/template-grid.js`
- Test: `test/template-grid.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/template-grid.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBlankGrid, resizeGrid, gridToTemplate, gridFromTemplate, sanitizeTemplateName,
} from '../tools/tile-editor/template-grid.js'

describe('createBlankGrid', () => {
  it('makes an h-row, w-col grid filled with wall', () => {
    const g = createBlankGrid(3, 2)
    assert.deepEqual(g, [['#', '#', '#'], ['#', '#', '#']])
  })
})

describe('resizeGrid', () => {
  const base = [['.', '.'], ['.', '.']]  // 2x2 of floor
  it('pads new cells with wall when growing', () => {
    assert.deepEqual(resizeGrid(base, 3, 3), [
      ['.', '.', '#'],
      ['.', '.', '#'],
      ['#', '#', '#'],
    ])
  })
  it('crops when shrinking', () => {
    assert.deepEqual(resizeGrid(base, 1, 1), [['.']])
  })
})

describe('gridToTemplate / gridFromTemplate', () => {
  it('round-trips a grid through the template shape', () => {
    const g = [['#', '.'], ['.', '#']]
    const t = gridToTemplate(g)
    assert.deepEqual(t, { tiles: ['#.', '.#'], width: 2, height: 2 })
    assert.deepEqual(gridFromTemplate(t), g)
  })
})

describe('sanitizeTemplateName', () => {
  it('uppercases and replaces runs of junk with one underscore', () =>
    assert.equal(sanitizeTemplateName('moss crypt!!'), 'MOSS_CRYPT'))
  it('trims leading/trailing underscores', () =>
    assert.equal(sanitizeTemplateName('  spooky room  '), 'SPOOKY_ROOM'))
  it('returns null when nothing usable remains', () => {
    assert.equal(sanitizeTemplateName(''), null)
    assert.equal(sanitizeTemplateName('!!!'), null)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern="createBlankGrid|resizeGrid|gridToTemplate|sanitizeTemplateName"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `template-grid.js`**

Create `tools/tile-editor/template-grid.js`:

```js
// Pure helpers for the template Build tab. No DOM — unit-tested with node --test.
// A grid is a 2D array of single-char symbols (keys of TEMPLATE_LEGEND);
// grid[row][col]. '#' (wall) is the neutral/empty fill.

const WALL = '#'

export function createBlankGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => WALL))
}

// Crop on shrink, pad with wall on grow. Preserves painted content in-bounds.
export function resizeGrid(grid, width, height) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => grid[y]?.[x] ?? WALL))
}

export function gridToTemplate(grid) {
  return {
    tiles: grid.map(row => row.join('')),
    width: grid[0]?.length ?? 0,
    height: grid.length,
  }
}

export function gridFromTemplate(tmpl) {
  return tmpl.tiles.map(row => [...row])
}

// User-typed name → 'UPPER_SNAKE' or null if nothing usable remains.
export function sanitizeTemplateName(raw) {
  const cleaned = String(raw).toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || null
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern="createBlankGrid|resizeGrid|gridToTemplate|sanitizeTemplateName"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/template-grid.js test/template-grid.test.js
git commit -m "feat: pure grid helpers for the template builder"
```

---

## Task 6: Build tab shell + palette + canvas painting

Add the third tab and the painting surface. Manually tested (dev tool).

**Files:**
- Modify: `tools/tile-editor/index.html`
- Modify: `tools/tile-editor/editor.js`
- Create: `tools/tile-editor/template-builder.js`

- [ ] **Step 1: Add Build-tab markup to `index.html`**

In the `<header>` (after the `tab-rules` button, line 55), add:

```html
    <button id="tab-build">▤ Build</button>
```

Add a Save template button alongside the other save buttons (after line 60, `save-rules`):

```html
    <button id="save-template" class="save" style="display:none">💾 Save template</button>
```

After the `<main id="rules-view">…</main>` block (closes at line 106), add the Build view:

```html
  <main id="build-view" style="display:none">
    <div id="build-palette" class="panel" style="width:150px; overflow-y:auto"></div>
    <div id="build-stage" class="panel" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto">
      <canvas id="template-canvas"></canvas>
    </div>
    <div id="build-sidebar" class="panel" style="width:220px; display:flex; flex-direction:column; gap:4px; overflow-y:auto">
      <div class="label">Template name (UPPER_SNAKE)</div>
      <input id="template-name" placeholder="MOSS_CRYPT" style="width:100%">
      <div class="label">Size (width × height)</div>
      <div style="display:flex; gap:4px; align-items:center">
        <input id="template-w" class="small" type="number" min="1" max="60" value="9">
        <span>×</span>
        <input id="template-h" class="small" type="number" min="1" max="40" value="7">
        <button id="template-resize">resize</button>
      </div>
      <div class="label">Templates</div>
      <div id="template-list" style="display:flex; flex-direction:column; gap:2px"></div>
    </div>
  </main>
```

Add palette swatch styling inside the `<style>` block (near the `#palette` rules, ~line 30):

```css
  #build-palette .legend { display:flex; align-items:center; gap:6px; padding:4px 6px;
                           border:1px solid #333; border-radius:3px; cursor:pointer; margin-bottom:3px; }
  #build-palette .legend.active { border-color:#fff; background:#2a2a3a; }
  #build-palette .sw { width:16px; height:16px; border:1px solid #555; flex:0 0 auto; }
  #template-list .trow { padding:3px 6px; border-radius:3px; cursor:pointer; }
  #template-list .trow:hover { background:#2a2a3a; }
  #template-list .trow.builtin { color:#888; }
```

- [ ] **Step 2: Wire a 3-way tab toggle + mount the builder in `editor.js`**

In `tools/tile-editor/editor.js`, add the import near the others (after line 7):

```js
import { initTemplateBuilder } from './template-builder.js'
```

Add element refs after line 14 (`saveRulesBtn`):

```js
const buildView = document.getElementById('build-view')
const tabBuild = document.getElementById('tab-build')
const saveTemplateBtn = document.getElementById('save-template')
```

Replace the existing `showTab` function (lines 16–24) and the tab listeners (lines 25–27) with a 3-way version:

```js
function showTab(tab) {
  drawView.style.display  = tab === 'draw'  ? 'flex' : 'none'
  rulesView.style.display = tab === 'rules' ? 'flex' : 'none'
  buildView.style.display = tab === 'build' ? 'flex' : 'none'
  tabDraw.classList.toggle('active',  tab === 'draw')
  tabRules.classList.toggle('active', tab === 'rules')
  tabBuild.classList.toggle('active', tab === 'build')
  saveTileBtn.style.display     = tab === 'draw'  ? '' : 'none'
  saveRulesBtn.style.display    = tab === 'rules' ? '' : 'none'
  saveTemplateBtn.style.display = tab === 'build' ? '' : 'none'
  // The shared bottom library strip belongs to the Draw tab only.
  document.getElementById('library-bar').style.display = tab === 'build' ? 'none' : ''
}
tabDraw.addEventListener('click', () => showTab('draw'))
tabRules.addEventListener('click', () => showTab('rules'))
tabBuild.addEventListener('click', () => showTab('build'))
showTab('draw')
```

At the end of `editor.js`, mount the builder:

```js
initTemplateBuilder()
```

- [ ] **Step 3: Create `template-builder.js` (palette + canvas paint; save in Task 7)**

Create `tools/tile-editor/template-builder.js`:

```js
import { TEMPLATE_LEGEND } from '../../renderer/data/levels.js'
import { createBlankGrid, resizeGrid } from './template-grid.js'

const CELL = 22  // px per cell on the canvas

export function initTemplateBuilder() {
  const canvas = document.getElementById('template-canvas')
  const ctx = canvas.getContext('2d')
  const paletteEl = document.getElementById('build-palette')
  const wInput = document.getElementById('template-w')
  const hInput = document.getElementById('template-h')

  const state = {
    grid: createBlankGrid(Number(wInput.value), Number(hInput.value)),
    active: '.',          // default paint symbol = floor
    painting: false,
  }
  // Exposed so Task 7 (save/load) can reach the grid + helpers.
  initTemplateBuilder.state = state
  initTemplateBuilder.setGrid = (g) => { state.grid = g; sizeCanvas(); render() }

  function sizeCanvas() {
    canvas.width = state.grid[0].length * CELL
    canvas.height = state.grid.length * CELL
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${CELL - 6}px monospace`
    state.grid.forEach((row, y) => row.forEach((ch, x) => {
      const e = TEMPLATE_LEGEND[ch] ?? TEMPLATE_LEGEND['.']
      ctx.fillStyle = e.color
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
      ctx.strokeStyle = '#0008'
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL)
      if (e.icon) { ctx.fillStyle = '#fff'; ctx.fillText(e.icon, x * CELL + CELL / 2, y * CELL + CELL / 2 + 1) }
    }))
  }

  function renderPalette() {
    paletteEl.innerHTML = ''
    for (const [ch, e] of Object.entries(TEMPLATE_LEGEND)) {
      const row = document.createElement('div')
      row.className = 'legend' + (ch === state.active ? ' active' : '')
      row.dataset.ch = ch
      const sw = document.createElement('div')
      sw.className = 'sw'
      sw.style.background = e.color
      const label = document.createElement('span')
      label.textContent = `${e.icon ?? ch} ${e.label}`
      row.append(sw, label)
      row.addEventListener('click', () => {
        state.active = ch
        paletteEl.querySelectorAll('.legend').forEach(n =>
          n.classList.toggle('active', n.dataset.ch === ch))
      })
      paletteEl.appendChild(row)
    }
  }

  function cellAt(ev) {
    const r = canvas.getBoundingClientRect()
    const x = Math.floor((ev.clientX - r.left) / CELL)
    const y = Math.floor((ev.clientY - r.top) / CELL)
    return { x, y }
  }
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (state.grid[y]?.[x] === undefined) return
    state.grid[y][x] = state.active
    render()
  }
  canvas.addEventListener('mousedown', e => { state.painting = true; paint(e) })
  canvas.addEventListener('mousemove', e => { if (state.painting) paint(e) })
  window.addEventListener('mouseup', () => { state.painting = false })

  document.getElementById('template-resize').addEventListener('click', () => {
    const w = Math.max(1, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(1, Math.min(40, Number(hInput.value) | 0))
    state.grid = resizeGrid(state.grid, w, h)
    sizeCanvas(); render()
  })

  renderPalette()
  sizeCanvas()
  render()
}
```

Note: `template-builder.js` is at `tools/tile-editor/`, so the legend import path is `../../renderer/data/levels.js`. `levels.js` imports `entities.js` (same `renderer/` tree) — both load fine in the editor renderer.

- [ ] **Step 4: Manual test**

Run: `npm run editor`
Expected:
- A third "▤ Build" tab appears; clicking it shows the palette (left), a 9×7 canvas of wall cells (center), and name/size controls (right). The bottom library strip hides.
- Clicking a palette entry selects it (white border); painting on the canvas with click-drag fills cells with that symbol's color; icons (◆, ⛨, 🐉, …) render centered.
- Painting floor `.` then drawing walls/columns works; eyedropper not needed.
- Changing width/height + "resize" grows (pads wall) / shrinks (crops) while keeping painted content.
- Switching back to Draw/Rules tabs still works and shows the library strip again.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/index.html tools/tile-editor/editor.js tools/tile-editor/template-builder.js
git commit -m "feat: Build tab — palette + canvas painting for templates"
```

---

## Task 7: Save flow + template library (load-as-base) + guards

Persist templates to `templates.json`, list existing templates (built-in + custom) for load-as-base, and enforce name/overwrite/built-in rules. Manually tested.

**Files:**
- Modify: `tools/tile-editor/template-builder.js`
- Modify: `tools/tile-editor/editor.js` (wire the Save template button)

- [ ] **Step 1: Load templates + render the library list in `template-builder.js`**

Extend `template-builder.js`. Add these imports to the top:

```js
import { TEMPLATES as BUILTIN_TEMPLATES } from '../../renderer/data/levels.js'
import { gridToTemplate, gridFromTemplate, sanitizeTemplateName } from './template-grid.js'
import { textPrompt } from './text-prompt.js'
```

(Combine with the existing `template-grid` import line rather than duplicating — final import should pull `createBlankGrid, resizeGrid, gridToTemplate, gridFromTemplate, sanitizeTemplateName` from `./template-grid.js`. Note `BUILTIN_TEMPLATES` is the built-in map exported by `levels.js`, used only to mark/label built-in names in the list.)

Inside `initTemplateBuilder`, after `render()` at the bottom but before the closing brace, add a loader + list renderer and expose a save function:

```js
  const listEl = document.getElementById('template-list')
  const nameInput = document.getElementById('template-name')
  let custom = {}   // name -> template, from templates.json

  async function loadTemplates() {
    custom = (await window.editorAPI.loadTemplates()) ?? {}
    renderList()
  }

  function loadIntoEditor(tmpl, name) {
    const g = gridFromTemplate(tmpl)
    state.grid = g
    wInput.value = tmpl.width
    hInput.value = tmpl.height
    nameInput.value = name && !BUILTIN_TEMPLATES[name] ? name : ''  // force new name for built-ins
    sizeCanvas(); render()
  }

  function renderList() {
    listEl.innerHTML = ''
    const builtin = Object.keys(BUILTIN_TEMPLATES).filter(n => !custom[n])
    const entries = [
      ...builtin.map(n => ({ name: n, tmpl: BUILTIN_TEMPLATES[n], builtin: true })),
      ...Object.keys(custom).map(n => ({ name: n, tmpl: custom[n], builtin: false })),
    ]
    for (const { name, tmpl, builtin } of entries) {
      const row = document.createElement('div')
      row.className = 'trow' + (builtin ? ' builtin' : '')
      row.textContent = builtin ? `${name} (built-in)` : name
      row.addEventListener('click', () => loadIntoEditor(tmpl, name))
      listEl.appendChild(row)
    }
  }

  initTemplateBuilder.save = async function save() {
    const name = sanitizeTemplateName(nameInput.value)
    if (!name) { alert('Enter a template name first.'); return }
    if (BUILTIN_TEMPLATES[name]) {
      alert(`'${name}' is a built-in template name and cannot be overwritten. Choose another name.`)
      return
    }
    if (custom[name]) {
      const ok = await textPrompt(`'${name}' already exists. Type the name again to overwrite, or Cancel.`)
      if (ok !== name) return
    }
    custom[name] = gridToTemplate(state.grid)
    try {
      await window.editorAPI.saveTemplates(custom)
      renderList()
      alert(`Saved template '${name}' to renderer/data/templates.json`)
    } catch (err) {
      delete custom[name]
      alert(`Save failed: ${err.message}`)
    }
  }

  loadTemplates()
```

- [ ] **Step 2: Wire the Save template button in `editor.js`**

In `tools/tile-editor/editor.js`, after the `initTemplateBuilder()` call added in Task 6, add:

```js
saveTemplateBtn.addEventListener('click', () => initTemplateBuilder.save?.())
```

- [ ] **Step 3: Manual test — full loop**

Run: `npm run editor`
Expected:
- Build tab lists all built-in templates marked "(built-in)".
- Paint a small room, type a name (e.g. `moss crypt` → sanitizes to `MOSS_CRYPT` on save), click "💾 Save template" → success alert; `MOSS_CRYPT` appears in the list (not greyed).
- Re-saving `MOSS_CRYPT` prompts to confirm by retyping the name; cancelling leaves it unchanged.
- Trying to save under a built-in name (e.g. `SHRINE`) is blocked with a message.
- Clicking a built-in in the list loads it as an editable base with the name field cleared; clicking a custom loads it with its name.
- Confirm `renderer/data/templates.json` now exists and contains `MOSS_CRYPT` with `tiles`/`width`/`height`.

- [ ] **Step 4: Manual test — in-game wiring**

Edit `renderer/data/levels.js`: in `LEVEL_CONFIG`, set depth 1's `landmark` to `'MOSS_CRYPT'`. Run: `npm start`, descend/regenerate depth 1 a few times.
Expected: the hand-built room appears stamped into the level (it may take a couple of regenerations since landmark placement is random). Revert the `LEVEL_CONFIG` edit afterward (it was just a wiring check).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass (this task is editor-only; no game logic changed).

- [ ] **Step 6: Commit**

```bash
git add tools/tile-editor/template-builder.js tools/tile-editor/editor.js
git commit -m "feat: save templates to templates.json + load-as-base library with guards"
```

---

## Self-Review Notes

- **Spec coverage:** Build tab (Tasks 6–7), shared extensible legend + `placeTemplate` refactor (Tasks 1–2), resizable-on-creation grid with crop/pad (Task 5 + Task 6 resize), flat-color + icon rendering (Task 6 `render`), all-11-symbol palette (Task 6 `renderPalette`), `templates.json` storage mirroring rulesets (Task 4), merge into `TEMPLATES` with built-in protection (Task 3), manual wire-to-depth loop (Task 7 Step 4), error handling — empty/invalid name, overwrite confirm, built-in block, missing/invalid JSON tolerated (Tasks 3, 4, 7). Testing: `placeTemplate` regression (Tasks 1–2), merge (Task 3), grid helpers (Task 5), manual UI (Tasks 6–7). All spec sections map to a task.
- **Deviation from spec (minor):** the spec suggested reusing the bottom `#library-bar` for the template list; this plan uses a dedicated `#template-list` in the Build sidebar and hides the shared bottom strip on the Build tab. Same capability, less coupling between tabs.
- **Type/name consistency:** `TEMPLATE_LEGEND` entry fields (`kind`, `tile`, `spawn`, `roomScoped`, `single`, `color`, `icon`, `label`) are used identically in `placeTemplate` (Task 2) and the builder (Tasks 6–7). Grid helpers (`createBlankGrid`, `resizeGrid`, `gridToTemplate`, `gridFromTemplate`, `sanitizeTemplateName`) share one signature set across Task 5 (def) and Tasks 6–7 (use). `registerCustomTemplates` shape matches the `templates.json` entries written in Task 7.
- **No placeholders.**
