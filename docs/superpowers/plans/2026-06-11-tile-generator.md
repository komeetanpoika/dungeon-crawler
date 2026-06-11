# Tile Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 16×16 pixel-tile editor (separate Electron window) plus a tag-based adjacency-rule system, so new wall/floor textures can be drawn and placed in generated dungeons by a decoration pass.

**Architecture:** Three components with one-way data flow: editor → (`custom_*.png` + `rulesets.json`) → game. A pure ES-module decoration engine (`renderer/systems/decorate.js`) assigns a `skin` per floor/wall cell after map generation; `canvas.js` draws `cell.skin` when present. The editor is plain HTML/JS/canvas in `tools/tile-editor/`, launched via `npm run editor`, with file access through a dedicated preload bridge.

**Tech Stack:** Electron 30 (already a dependency), vanilla JS ES modules, `node --test` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-11-tile-generator-design.md`

> ⚠️ **Working-tree note:** `renderer/game.js` currently carries an uncommitted playtest change (runs start at depth 10: `generateLevel(10)`). The edits below are anchored on surrounding code, not on the depth number. Do not "fix" the depth as part of this plan.

---

## File structure

| File | Responsibility |
|---|---|
| `renderer/systems/decorate.js` *(create)* | Pure rule engine: role mapping, pair compatibility, weighted pick, `decorateMap` |
| `test/decorate.test.js` *(create)* | Unit tests for the rule engine |
| `renderer/data/rulesets.json` *(create)* | All rulesets (starts as `{}`) |
| `main.cjs` *(modify)* | `--editor` window branch; IPC: load/save rulesets, list/read/save tiles |
| `preload.cjs` *(modify)* | Expose `loadRulesets` to the game renderer |
| `package.json` *(modify)* | `"editor": "electron . --editor"` script |
| `renderer/render/sprites.js` *(modify)* | `loadSprites(extraNames)` — also load ruleset-referenced tiles |
| `renderer/render/canvas.js` *(modify)* | `drawTile` draws `tileObj.skin` when present |
| `renderer/game.js` *(modify)* | Load rulesets at init, call `decorateMap` after each `generateLevel` |
| `tools/tile-editor/index.html` *(create)* | Editor shell: tabs, layout, CSS |
| `tools/tile-editor/editor-preload.cjs` *(create)* | `editorAPI` bridge (6 IPC calls) |
| `tools/tile-editor/lib.js` *(create)* | Pure helpers: name sanitizing, wrap math, flood fill, hex⇄rgba |
| `test/editor-lib.test.js` *(create)* | Unit tests for `lib.js` |
| `tools/tile-editor/pixel-editor.js` *(create)* | Drawing canvas: tools, wrap mode, undo/redo |
| `tools/tile-editor/palette.js` *(create)* | Palette extraction from existing tiles |
| `tools/tile-editor/library.js` *(create)* | Bottom strip: browse/filter/load tiles as base |
| `tools/tile-editor/rules-ui.js` *(create)* | Rules tab: tags, allow/forbid/directional, weights |
| `tools/tile-editor/sample-preview.js` *(create)* | Live sample grid (reuses `decorate.js`) |
| `tools/tile-editor/editor.js` *(create)* | App glue: state, tab switching, save-tile flow |

Run all tests with: `npm test` (runs `node --test test/`).

---

### Task 1: Decoration engine — rule predicates

**Files:**
- Create: `renderer/systems/decorate.js`
- Create: `test/decorate.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/decorate.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, tagsOf, pairAllowed } from '../renderer/systems/decorate.js'
import { TILE } from '../renderer/systems/entities.js'

// Shared fixture: moss only tolerates moss; plain tolerates anything except moss.
const RS = {
  tiles: {
    moss1: { tags: ['floor.moss'],  weight: 1 },
    moss2: { tags: ['floor.moss'],  weight: 3 },
    plain: { tags: ['floor.plain'], weight: 1 },
    wallA: { tags: ['wall.base'],   weight: 1 },
    top:   { tags: ['wall.top'],    weight: 1 },
  },
  tags: {
    'floor.moss':  { role: 'floor', allow: ['floor.moss'] },
    'floor.plain': { role: 'floor', allow: ['*'], forbid: ['floor.moss'] },
    'wall.base':   { role: 'wall',  allow: ['*'] },
    // wall.top demands wall.base directly south of it; anything elsewhere
    'wall.top':    { role: 'wall',  allow: ['*'], directional: { s: ['wall.base'] } },
  },
}

describe('roleOf', () => {
  it('FLOOR and SAND are floor-role', () => {
    assert.equal(roleOf(TILE.FLOOR), 'floor')
    assert.equal(roleOf(TILE.SAND), 'floor')
  })
  it('WALL is wall-role', () => assert.equal(roleOf(TILE.WALL), 'wall'))
  it('other tiles have no role', () => {
    assert.equal(roleOf(TILE.DOOR), null)
    assert.equal(roleOf(TILE.STAIR), null)
    assert.equal(roleOf(TILE.TREASURE), null)
  })
})

describe('tagsOf', () => {
  it('returns tags for a known tile', () => assert.deepEqual(tagsOf(RS, 'moss1'), ['floor.moss']))
  it('returns [] for unknown tiles', () => assert.deepEqual(tagsOf(RS, 'nope'), []))
})

describe('pairAllowed', () => {
  it('moss next to moss is allowed', () => {
    assert.equal(pairAllowed(RS, 'moss1', 'moss2', 'e'), true)
  })
  it('moss next to plain is blocked (moss only allows moss)', () => {
    assert.equal(pairAllowed(RS, 'moss1', 'plain', 'e'), false)
  })
  it('is symmetric: plain next to moss is blocked too (mutual check)', () => {
    assert.equal(pairAllowed(RS, 'plain', 'moss1', 'e'), false)
  })
  it('forbid beats allow: plain allows * but forbids moss', () => {
    // even with moss allowing plain, plain's forbid wins
    const rs = structuredClone(RS)
    rs.tags['floor.moss'].allow = ['*']
    assert.equal(pairAllowed(rs, 'plain', 'moss1', 'n'), false)
  })
  it('"*" allows any neighbor', () => {
    assert.equal(pairAllowed(RS, 'wallA', 'wallA', 'n'), true)
  })
  it('directional override: top accepts base to its south', () => {
    assert.equal(pairAllowed(RS, 'top', 'wallA', 's'), true)
  })
  it('directional override: top rejects top to its south', () => {
    assert.equal(pairAllowed(RS, 'top', 'top', 's'), false)
  })
  it('directional override only constrains that direction', () => {
    assert.equal(pairAllowed(RS, 'top', 'top', 'e'), true)
  })
  it('opposite direction is checked from the neighbor side: base under top is fine', () => {
    // a=wallA, b=top, b is north of a → from top's view, wallA is to its south
    assert.equal(pairAllowed(RS, 'wallA', 'top', 'n'), true)
  })
  it('tiles with unknown tags impose no constraints', () => {
    const rs = { tiles: { x: { tags: ['ghost.tag'] }, y: { tags: ['ghost.tag'] } }, tags: {} }
    assert.equal(pairAllowed(rs, 'x', 'y', 'e'), true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/decorate.test.js`
Expected: FAIL — `Cannot find module '.../renderer/systems/decorate.js'`

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/decorate.js`:

```js
import { TILE } from './entities.js'

const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' }

// Which logical map tiles a rule role may skin. The decoration pass only ever
// swaps visuals within the same role, so walkability cannot change.
export function roleOf(tileId) {
  if (tileId === TILE.FLOOR || tileId === TILE.SAND) return 'floor'
  if (tileId === TILE.WALL) return 'wall'
  return null
}

export function tagsOf(ruleset, tileName) {
  return ruleset.tiles[tileName]?.tags ?? []
}

// One-directional check: may a tile with `fromTags` sit with a `toTags` tile
// in direction `dir`? forbid beats allow; a non-empty directional list
// replaces `allow` for that direction; '*' matches anything.
function allowedOneWay(ruleset, fromTags, toTags, dir) {
  for (const tag of fromTags) {
    const rule = ruleset.tags[tag]
    if (!rule) continue
    if (rule.forbid?.some(t => toTags.includes(t))) return false
    const dirList = rule.directional?.[dir]
    const effective = (dirList && dirList.length > 0) ? dirList : (rule.allow ?? ['*'])
    if (effective.includes('*')) continue
    if (!toTags.some(t => effective.includes(t))) return false
  }
  return true
}

// Mutual compatibility: checked from both tiles' perspectives so no forbidden
// pairing can appear regardless of decoration scan order.
export function pairAllowed(ruleset, aName, bName, dirAtoB) {
  const aTags = tagsOf(ruleset, aName)
  const bTags = tagsOf(ruleset, bName)
  return allowedOneWay(ruleset, aTags, bTags, dirAtoB)
      && allowedOneWay(ruleset, bTags, aTags, OPPOSITE[dirAtoB])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/decorate.test.js`
Expected: PASS (all `roleOf`, `tagsOf`, `pairAllowed` tests)

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/decorate.js test/decorate.test.js
git commit -m "feat: decoration rule predicates (roleOf, tagsOf, pairAllowed)"
```

---

### Task 2: Decoration engine — weighted pick and decorateMap

**Files:**
- Modify: `renderer/systems/decorate.js`
- Modify: `test/decorate.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/decorate.test.js` (add `candidatesForRole, pickWeighted, decorateMap` to the existing import from `decorate.js`, and add this seeded RNG helper at top level):

```js
// Deterministic RNG for reproducible decoration tests
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function makeCells(rows) {
  // rows: array of strings, '.' = FLOOR, '#' = WALL, ',' = SAND, 'D' = DOOR
  const ids = { '.': TILE.FLOOR, '#': TILE.WALL, ',': TILE.SAND, 'D': TILE.DOOR }
  return rows.map(r => [...r].map(ch => ({ tile: ids[ch], skin: null })))
}

describe('candidatesForRole', () => {
  it('floor role yields floor-tagged tiles only', () => {
    assert.deepEqual(candidatesForRole(RS, 'floor').sort(), ['moss1', 'moss2', 'plain'])
  })
  it('wall role yields wall-tagged tiles only', () => {
    assert.deepEqual(candidatesForRole(RS, 'wall').sort(), ['top', 'wallA'])
  })
})

describe('pickWeighted', () => {
  it('rng=0 picks the first candidate', () => {
    assert.equal(pickWeighted(RS, ['moss1', 'moss2'], () => 0), 'moss1')
  })
  it('respects weights: moss2 (weight 3) wins at rng=0.5 of total 4', () => {
    // total = 1 + 3 = 4; r = 2.0 lands inside moss2's [1,4) band
    assert.equal(pickWeighted(RS, ['moss1', 'moss2'], () => 0.5), 'moss2')
  })
  it('missing weight defaults to 1', () => {
    const rs = { tiles: { a: { tags: [] }, b: { tags: [] } }, tags: {} }
    assert.equal(pickWeighted(rs, ['a', 'b'], () => 0.9), 'b')
  })
})

describe('decorateMap', () => {
  it('skins floor and sand cells with floor-role tiles, walls with wall-role tiles', () => {
    const map = makeCells(['##', '.,'])
    decorateMap(map, RS, mulberry32(1))
    assert.ok(['wallA', 'top'].includes(map[0][0].skin))
    assert.ok(['moss1', 'moss2', 'plain'].includes(map[1][0].skin))
    assert.ok(['moss1', 'moss2', 'plain'].includes(map[1][1].skin))
  })
  it('leaves non-role cells unskinned', () => {
    const map = makeCells(['D'])
    decorateMap(map, RS, mulberry32(1))
    assert.equal(map[0][0].skin, null)
  })
  it('never places forbidden pairs adjacently', () => {
    const map = makeCells(['....', '....', '....'])
    decorateMap(map, RS, mulberry32(42))
    const isMoss  = n => n === 'moss1' || n === 'moss2'
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
      const here = map[y][x].skin
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        const there = map[ny]?.[nx]?.skin
        if (!here || !there) continue
        assert.ok(!(isMoss(here) && there === 'plain'), `moss|plain at ${x},${y}`)
        assert.ok(!(here === 'plain' && isMoss(there)), `plain|moss at ${x},${y}`)
      }
    }
  })
  it('is deterministic for a given rng seed', () => {
    const a = makeCells(['....', '....'])
    const b = makeCells(['....', '....'])
    decorateMap(a, RS, mulberry32(7))
    decorateMap(b, RS, mulberry32(7))
    assert.deepEqual(a.map(r => r.map(c => c.skin)), b.map(r => r.map(c => c.skin)))
  })
  it('falls back to null skin and counts when rules dead-end', () => {
    // single tag that forbids itself: second floor cell can never be skinned
    const rs = {
      tiles: { solo: { tags: ['floor.x'], weight: 1 } },
      tags:  { 'floor.x': { role: 'floor', allow: ['*'], forbid: ['floor.x'] } },
    }
    const map = makeCells(['..'])
    const fallbacks = decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].skin, 'solo')
    assert.equal(map[0][1].skin, null)
    assert.equal(fallbacks, 1)
  })
  it('does not count fallbacks for roles the ruleset simply does not cover', () => {
    const rs = {
      tiles: { f: { tags: ['floor.a'], weight: 1 } },
      tags:  { 'floor.a': { role: 'floor', allow: ['*'] } },
    }
    const map = makeCells(['#.'])
    const fallbacks = decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].skin, null)   // no wall tiles in ruleset — fine
    assert.equal(map[0][1].skin, 'f')
    assert.equal(fallbacks, 0)
  })
  it('no-ops without a ruleset', () => {
    const map = makeCells(['..'])
    assert.equal(decorateMap(map, undefined), 0)
    assert.equal(map[0][0].skin, null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/decorate.test.js`
Expected: FAIL — `candidatesForRole is not a function` (or named export missing)

- [ ] **Step 3: Write the implementation**

Append to `renderer/systems/decorate.js`:

```js
export function candidatesForRole(ruleset, role) {
  return Object.entries(ruleset.tiles)
    .filter(([, def]) => (def.tags ?? []).some(t => ruleset.tags[t]?.role === role))
    .map(([name]) => name)
}

export function pickWeighted(ruleset, names, rng) {
  const total = names.reduce((s, n) => s + (ruleset.tiles[n].weight ?? 1), 0)
  let r = rng() * total
  for (const n of names) {
    r -= ruleset.tiles[n].weight ?? 1
    if (r <= 0) return n
  }
  return names[names.length - 1]
}

// Assigns cell.skin for every floor/wall cell, scanning top-left to
// bottom-right. Only the already-decided N and W neighbors constrain a cell;
// pairAllowed's mutual check guarantees no forbidden pairing survives.
// Returns the number of dead-end fallbacks (cells a covered role failed on).
export function decorateMap(map, ruleset, rng = Math.random) {
  if (!ruleset) return 0
  let fallbacks = 0
  const byRole = {
    floor: candidatesForRole(ruleset, 'floor'),
    wall:  candidatesForRole(ruleset, 'wall'),
  }
  for (let row = 0; row < map.length; row++) {
    for (let col = 0; col < map[row].length; col++) {
      const cell = map[row][col]
      const role = roleOf(cell.tile)
      if (!role) continue
      const neighbors = [
        { dir: 'n', skin: map[row - 1]?.[col]?.skin },
        { dir: 'w', skin: map[row]?.[col - 1]?.skin },
      ].filter(nb => nb.skin)
      const survivors = byRole[role].filter(name =>
        neighbors.every(nb => pairAllowed(ruleset, name, nb.skin, nb.dir)))
      if (survivors.length === 0) {
        cell.skin = null
        if (byRole[role].length > 0) {
          fallbacks++
          console.warn(`decorate: no valid tile at (${col},${row}) — using theme default`)
        }
        continue
      }
      cell.skin = pickWeighted(ruleset, survivors, rng)
    }
  }
  return fallbacks
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/decorate.test.js`
Expected: PASS — all tests

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS — all existing tests still green

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/decorate.js test/decorate.test.js
git commit -m "feat: decorateMap — weighted, rule-constrained tile skinning"
```

---

### Task 3: Rulesets file and IPC plumbing

**Files:**
- Create: `renderer/data/rulesets.json`
- Modify: `main.cjs`
- Modify: `preload.cjs`

- [ ] **Step 1: Create the empty rulesets file**

Create `renderer/data/rulesets.json`:

```json
{}
```

- [ ] **Step 2: Add load/save IPC handlers to `main.cjs`**

In `main.cjs`, after the existing `META_FILE` constant (line 7), add:

```js
const RULESETS_FILE = path.join(__dirname, 'renderer', 'data', 'rulesets.json')
```

After the existing `ipcMain.handle('delete-run', ...)` line (end of file), add:

```js
ipcMain.handle('load-rulesets', () => {
  try { return JSON.parse(fs.readFileSync(RULESETS_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-rulesets', (_e, data) =>
  fs.writeFileSync(RULESETS_FILE, JSON.stringify(data, null, 2)))
```

- [ ] **Step 3: Expose `loadRulesets` in `preload.cjs`**

In `preload.cjs`, add to the `saveAPI` object:

```js
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
```

- [ ] **Step 4: Verify the game still boots**

Run: `npm start`
Expected: game window opens and plays exactly as before (rulesets.json is empty, nothing consumes it yet). Close the window.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/rulesets.json main.cjs preload.cjs
git commit -m "feat: rulesets.json + load/save IPC handlers"
```

---

### Task 4: Skin rendering and game wiring

**Files:**
- Modify: `renderer/render/sprites.js`
- Modify: `renderer/render/canvas.js`
- Modify: `renderer/game.js`

- [ ] **Step 1: Let `loadSprites` accept extra tile names**

In `renderer/render/sprites.js`, replace the `loadSprites` function with:

```js
export async function loadSprites(extraNames = []) {
  // Ruleset-referenced tiles are loaded under their own file name so
  // cell.skin (a file name) resolves directly in the sprites map.
  const entries = { ...SPRITES }
  for (const name of extraNames) if (!(name in entries)) entries[name] = name
  const loaded = {}
  await Promise.all(
    Object.entries(entries).map(([key, name]) => new Promise(resolve => {
      const img = new Image()
      img.onload = () => { loaded[key] = img; resolve() }
      img.onerror = () => { console.warn(`Missing sprite: ${name}`); resolve() }
      img.src = `./assets/tiles/${name}.png`
    }))
  )
  return loaded
}
```

- [ ] **Step 2: Pass extras through the `Renderer` class**

In `renderer/render/canvas.js`, replace the `loadSprites` method of `Renderer` (currently lines 487-489):

```js
  async loadSprites(extraNames = []) {
    this.sprites = await loadSprites(extraNames)
  }
```

- [ ] **Step 3: Draw `cell.skin` in `drawTile`**

In `renderer/render/canvas.js`, inside `drawTile`, insert immediately after the `TILE.SNARE` block (after line 31's closing `}`) and before `const s = (() => {`:

```js
  // Decoration-pass skin (only ever set on floor/wall cells)
  if (tileObj?.skin && sprites[tileObj.skin]) {
    ctx.drawImage(sprites[tileObj.skin], px, py, S, S)
    return
  }
```

- [ ] **Step 4: Wire rulesets + decoration into `renderer/game.js`**

Add the import (top of file, next to the other system imports):

```js
import { decorateMap } from './systems/decorate.js'
```

Add module state and a helper near the other top-level declarations:

```js
let rulesets = {}

function rulesetTileNames(rs) {
  const names = new Set()
  for (const set of Object.values(rs))
    for (const name of Object.keys(set.tiles ?? {})) names.add(name)
  return [...names]
}
```

In `startNewRun()`, directly after the `const theme = DEPTH_THEMES.find(...)` line, add:

```js
  decorateMap(map, rulesets[theme.ruleset])
```

In `descendLevel()`, directly after its `const theme = DEPTH_THEMES.find(...)` line, add:

```js
  decorateMap(map, rulesets[theme.ruleset])
```

In `init()`, replace `await renderer.loadSprites()` with:

```js
  rulesets = (await window.saveAPI.loadRulesets()) ?? {}
  await renderer.loadSprites(rulesetTileNames(rulesets))
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — `sprites.test.js` (SPRITES map unchanged) and all others green

- [ ] **Step 6: Manual smoke test**

Run: `npm start`
Expected: game looks identical to before (no theme has a `ruleset` field yet; `decorateMap` no-ops on `undefined`). Close the window.

- [ ] **Step 7: Commit**

```bash
git add renderer/render/sprites.js renderer/render/canvas.js renderer/game.js
git commit -m "feat: cell.skin rendering + ruleset loading + decoration pass wiring"
```

---

### Task 5: Editor scaffold — window, preload, shell

**Files:**
- Modify: `package.json`
- Modify: `main.cjs`
- Create: `tools/tile-editor/editor-preload.cjs`
- Create: `tools/tile-editor/index.html`
- Create: `tools/tile-editor/editor.js` (minimal shell; filled out in later tasks)

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, add:

```json
    "editor": "electron . --editor",
```

- [ ] **Step 2: Add the editor window and tile IPC to `main.cjs`**

After the `RULESETS_FILE` constant, add:

```js
const TILES_DIR = path.join(__dirname, 'renderer', 'assets', 'tiles')
```

After the `createWindow` function, add:

```js
function createEditorWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'tools', 'tile-editor', 'editor-preload.cjs'),
      contextIsolation: true,
    },
  })
  win.loadFile('tools/tile-editor/index.html')
}
```

In `app.whenReady().then(...)`, replace `createWindow()` with:

```js
  if (process.argv.includes('--editor')) createEditorWindow()
  else createWindow()
```

After the rulesets IPC handlers, add the tile file handlers:

```js
ipcMain.handle('editor-list-tiles', () =>
  fs.readdirSync(TILES_DIR).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort())
ipcMain.handle('editor-read-tile', (_e, name) =>
  // data: URL so the editor canvas stays untainted (file:// images taint it)
  'data:image/png;base64,' +
  fs.readFileSync(path.join(TILES_DIR, `${path.basename(name)}.png`)).toString('base64'))
ipcMain.handle('editor-tile-exists', (_e, name) =>
  fs.existsSync(path.join(TILES_DIR, `${path.basename(name)}.png`)))
ipcMain.handle('editor-save-tile', (_e, name, dataURL) => {
  // Kenney originals are never writable: custom_ prefix is enforced here,
  // not just in the UI.
  if (!/^custom_[a-z0-9_]+$/.test(name)) throw new Error(`Invalid tile name: ${name}`)
  const b64 = String(dataURL).replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(path.join(TILES_DIR, `${name}.png`), Buffer.from(b64, 'base64'))
})
```

- [ ] **Step 3: Create `tools/tile-editor/editor-preload.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('editorAPI', {
  listTiles:    () => ipcRenderer.invoke('editor-list-tiles'),
  readTile:     (name) => ipcRenderer.invoke('editor-read-tile', name),
  tileExists:   (name) => ipcRenderer.invoke('editor-tile-exists', name),
  saveTile:     (name, dataURL) => ipcRenderer.invoke('editor-save-tile', name, dataURL),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  saveRulesets: (data) => ipcRenderer.invoke('save-rulesets', data),
})
```

- [ ] **Step 4: Create `tools/tile-editor/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Tile Editor</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #16161e; color: #ccc; font: 13px/1.4 monospace; height: 100vh;
         display: flex; flex-direction: column; padding: 10px; gap: 8px; }
  header { display: flex; gap: 8px; align-items: center; background: #0d0d14;
           padding: 6px 10px; border-radius: 4px; }
  button, select, input { font: inherit; color: #ccc; background: #1a1a24;
           border: 1px solid #333; border-radius: 3px; padding: 3px 10px; cursor: pointer; }
  button.active { background: #3a3a55; color: #fff; }
  button.save { background: #226633; color: #fff; margin-left: auto; }
  button.on { background: #254438; color: #7fd; }
  main { flex: 1; display: flex; gap: 10px; min-height: 0; }
  .panel { background: #0d0d14; border-radius: 4px; padding: 8px; }
  .label { color: #888; font-size: 11px; text-transform: uppercase; margin: 6px 0 3px; }
  #toolbar { width: 96px; display: flex; flex-direction: column; gap: 6px; }
  #toolbar button { width: 100%; }
  #stage { flex: 1; display: flex; align-items: center; justify-content: center; }
  #pixel-canvas { image-rendering: pixelated; border: 1px solid #444;
                  background:
                    repeating-conic-gradient(#1c1c26 0 25%, #14141c 0 50%) 0 0 / 16px 16px; }
  #sidebar { width: 200px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
  #sidebar canvas { image-rendering: pixelated; border: 1px solid #444; display: block; }
  #palette { display: grid; grid-template-columns: repeat(8, 20px); gap: 2px; }
  #palette .swatch { width: 20px; height: 20px; border: 1px solid #333; cursor: pointer; }
  #palette .swatch.active { border: 1px solid #fff; }
  #library-bar { height: 96px; display: flex; flex-direction: column; gap: 4px; }
  #library { display: flex; gap: 4px; overflow-x: auto; flex: 1; align-items: center; }
  #library img { width: 48px; height: 48px; image-rendering: pixelated;
                 border: 1px solid #333; cursor: pointer; flex: 0 0 auto; }
  #library img:hover { border-color: #7fd; }
  #rules-view { flex: 1; display: none; gap: 10px; }
  #tag-list { width: 200px; overflow-y: auto; }
  #tag-list .tag-row { padding: 4px 6px; border-radius: 3px; cursor: pointer; }
  #tag-list .tag-row.active { background: #3a3a55; color: #fff; }
  #rule-panel { flex: 1; overflow-y: auto; }
  #sample-panel { width: 260px; }
  .chip { display: inline-block; background: #254438; padding: 1px 7px; border-radius: 3px;
          margin: 2px; cursor: pointer; }
  .chip.forbid { background: #552222; }
  .chip:hover { text-decoration: line-through; }
  .add-chip { color: #666; cursor: pointer; margin: 2px; display: inline-block; }
  table td { padding: 3px 6px; vertical-align: top; }
  input.small { width: 60px; }
  input.dir { width: 130px; }
</style>
</head>
<body>
  <header>
    <button id="tab-draw" class="active">▣ Draw</button>
    <button id="tab-rules">▦ Rules</button>
    <span class="label" style="margin: 0 0 0 12px">ruleset</span>
    <select id="ruleset-select"></select>
    <button id="new-ruleset">+ new</button>
    <button id="save-tile" class="save">💾 Save tile</button>
    <button id="save-rules" class="save" style="display:none">💾 Save rules</button>
  </header>

  <main id="draw-view">
    <div id="toolbar" class="panel">
      <button data-tool="pencil" class="active">✏ pencil</button>
      <button data-tool="eraser">▭ eraser</button>
      <button data-tool="fill">▨ fill</button>
      <button data-tool="picker">⊙ picker</button>
      <hr style="border-color:#333;width:100%">
      <button id="undo">↶ undo</button>
      <button id="redo">↷ redo</button>
      <hr style="border-color:#333;width:100%">
      <button id="wrap-toggle" class="on">⟳ wrap ON</button>
    </div>
    <div id="stage" class="panel">
      <canvas id="pixel-canvas" width="512" height="512"></canvas>
    </div>
    <div id="sidebar" class="panel">
      <div class="label">Preview 1:1</div>
      <canvas id="preview-1x" width="16" height="16"></canvas>
      <div class="label">Tiled 3×3 (seamless check)</div>
      <canvas id="preview-3x" width="96" height="96"></canvas>
      <div class="label">Palette</div>
      <div id="palette"></div>
      <div class="label">Custom color</div>
      <input type="color" id="custom-color" value="#5a5a72">
      <div class="label">Tile name (saved as custom_&lt;name&gt;)</div>
      <input id="tile-name" placeholder="moss_floor_1" style="width:100%">
      <div class="label">Tags (comma-separated)</div>
      <input id="tile-tags" placeholder="floor.moss" style="width:100%">
    </div>
  </main>

  <main id="rules-view">
    <div id="tag-list" class="panel">
      <div class="label">Tags in ruleset</div>
      <div id="tag-rows"></div>
      <div class="add-chip" id="add-tag">+ new tag</div>
    </div>
    <div id="rule-panel" class="panel"></div>
    <div id="sample-panel" class="panel">
      <div class="label">Live sample</div>
      <canvas id="sample-canvas" width="240" height="160"></canvas>
      <button id="reroll" style="margin-top:6px">⟳ re-roll</button>
    </div>
  </main>

  <div id="library-bar" class="panel">
    <div style="display:flex;gap:8px;align-items:center">
      <span class="label" style="margin:0">Library (click = load as base)</span>
      <input id="library-filter" placeholder="filter…" style="width:140px">
    </div>
    <div id="library"></div>
  </div>

  <script type="module" src="./editor.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create a minimal `tools/tile-editor/editor.js` shell** (tab switching only; the rest lands in Tasks 7-12)

```js
const drawView = document.getElementById('draw-view')
const rulesView = document.getElementById('rules-view')
const tabDraw = document.getElementById('tab-draw')
const tabRules = document.getElementById('tab-rules')
const saveTileBtn = document.getElementById('save-tile')
const saveRulesBtn = document.getElementById('save-rules')

function showTab(tab) {
  const draw = tab === 'draw'
  drawView.style.display = draw ? 'flex' : 'none'
  rulesView.style.display = draw ? 'none' : 'flex'
  tabDraw.classList.toggle('active', draw)
  tabRules.classList.toggle('active', !draw)
  saveTileBtn.style.display = draw ? '' : 'none'
  saveRulesBtn.style.display = draw ? 'none' : ''
}
tabDraw.addEventListener('click', () => showTab('draw'))
tabRules.addEventListener('click', () => showTab('rules'))
showTab('draw')
```

- [ ] **Step 6: Manual verify**

Run: `npm run editor`
Expected: editor window opens with the dark two-tab layout; tab buttons switch between the Draw view and the (empty) Rules view. `npm start` still opens the game.

- [ ] **Step 7: Commit**

```bash
git add package.json main.cjs tools/tile-editor/
git commit -m "feat: tile-editor scaffold — npm run editor, window, preload, shell"
```

---

### Task 6: Editor pure helpers (lib.js)

**Files:**
- Create: `tools/tile-editor/lib.js`
- Create: `test/editor-lib.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/editor-lib.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SIZE, idx, wrapIndex, sanitizeTileName, floodFill, rgbaToHex, hexToRgba }
  from '../tools/tile-editor/lib.js'

describe('wrapIndex', () => {
  it('wraps negatives', () => assert.equal(wrapIndex(-1), 15))
  it('wraps overflow', () => assert.equal(wrapIndex(16), 0))
  it('passes through in-range values', () => assert.equal(wrapIndex(7), 7))
})

describe('sanitizeTileName', () => {
  it('prefixes custom_ and lowercases', () =>
    assert.equal(sanitizeTileName('Moss Floor!'), 'custom_moss_floor'))
  it('does not double the prefix', () =>
    assert.equal(sanitizeTileName('custom_moss'), 'custom_moss'))
  it('returns null for empty/invalid input', () => {
    assert.equal(sanitizeTileName(''), null)
    assert.equal(sanitizeTileName('!!!'), null)
  })
})

describe('floodFill', () => {
  function grid(fillWith = null) { return new Array(SIZE * SIZE).fill(fillWith) }

  it('fills a contiguous region only', () => {
    const g = grid('#ffffffff')
    g[idx(0, 0)] = null  // isolated transparent pixel
    const out = floodFill(g, 0, 0, '#ff0000ff', false)
    assert.equal(out[idx(0, 0)], '#ff0000ff')
    assert.equal(out[idx(1, 0)], '#ffffffff')
  })
  it('does not cross the edge without wrap', () => {
    const g = grid()
    for (let y = 0; y < SIZE; y++) { g[idx(0, y)] = 'a'; g[idx(15, y)] = 'a' }
    const out = floodFill(g, 0, 0, 'b', false)
    assert.equal(out[idx(0, 8)], 'b')    // same column filled
    assert.equal(out[idx(15, 8)], 'a')   // opposite column untouched
  })
  it('crosses the edge with wrap', () => {
    const g = grid()
    for (let y = 0; y < SIZE; y++) { g[idx(0, y)] = 'a'; g[idx(15, y)] = 'a' }
    const out = floodFill(g, 0, 0, 'b', true)
    assert.equal(out[idx(15, 8)], 'b')   // reached via x: 0 → -1 ≡ 15
  })
  it('no-ops when target equals fill color', () => {
    const g = grid('x')
    assert.deepEqual(floodFill(g, 3, 3, 'x', false), g)
  })
})

describe('hex/rgba conversion', () => {
  it('round-trips', () => {
    assert.equal(rgbaToHex(90, 90, 114, 255), '#5a5a72ff')
    assert.deepEqual(hexToRgba('#5a5a72ff'), [90, 90, 114, 255])
  })
  it('hexToRgba defaults alpha to 255 for 6-digit hex', () =>
    assert.deepEqual(hexToRgba('#5a5a72'), [90, 90, 114, 255]))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/editor-lib.test.js`
Expected: FAIL — `Cannot find module '.../tools/tile-editor/lib.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/tile-editor/lib.js`:

```js
// Pure helpers for the tile editor. No DOM — unit-tested with node --test.

export const SIZE = 16

export function idx(x, y) { return y * SIZE + x }

export function wrapIndex(i, n = SIZE) { return ((i % n) + n) % n }

// User-typed name → 'custom_<slug>' or null if nothing usable remains.
export function sanitizeTileName(raw) {
  const cleaned = String(raw).toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return null
  return `custom_${cleaned.replace(/^custom_/, '')}`
}

// grid: Array(SIZE*SIZE) of '#rrggbbaa' strings (null = transparent).
// Returns a new grid; with wrap, neighbor lookup goes around the edges so
// fills behave seamlessly like the final tiled texture.
export function floodFill(grid, x, y, color, wrap = false) {
  const target = grid[idx(x, y)]
  if (target === color) return grid
  const out = grid.slice()
  const stack = [[x, y]]
  const seen = new Set()
  while (stack.length) {
    const [cx, cy] = stack.pop()
    const key = cx + ',' + cy
    if (seen.has(key)) continue
    seen.add(key)
    if (out[idx(cx, cy)] !== target) continue
    out[idx(cx, cy)] = color
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = cx + dx, ny = cy + dy
      if (wrap) { nx = wrapIndex(nx); ny = wrapIndex(ny) }
      else if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
      stack.push([nx, ny])
    }
  }
  return out
}

export function rgbaToHex(r, g, b, a = 255) {
  return '#' + [r, g, b, a].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function hexToRgba(hex) {
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255
  return [r, g, b, a]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/editor-lib.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/lib.js test/editor-lib.test.js
git commit -m "feat: editor pure helpers — wrap math, flood fill, name sanitizing"
```

---

### Task 7: Pixel editor canvas

**Files:**
- Create: `tools/tile-editor/pixel-editor.js`
- Modify: `tools/tile-editor/editor.js`

- [ ] **Step 1: Create `tools/tile-editor/pixel-editor.js`**

```js
import { SIZE, idx, wrapIndex, floodFill, rgbaToHex, hexToRgba } from './lib.js'

const MAX_UNDO = 50

export class PixelEditor {
  constructor(canvas, { onChange, onPickColor }) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.grid = new Array(SIZE * SIZE).fill(null)
    this.undoStack = []
    this.redoStack = []
    this.tool = 'pencil'
    this.color = '#5a5a72ff'
    this.wrap = true
    this.onChange = onChange
    this.onPickColor = onPickColor
    this.drawing = false
    canvas.addEventListener('pointerdown', e => this.#down(e))
    canvas.addEventListener('pointermove', e => this.#move(e))
    window.addEventListener('pointerup', () => { this.drawing = false })
    this.render()
  }

  #cellAt(e) {
    const r = this.canvas.getBoundingClientRect()
    let x = Math.floor((e.clientX - r.left) / r.width * SIZE)
    let y = Math.floor((e.clientY - r.top) / r.height * SIZE)
    if (this.wrap) { x = wrapIndex(x); y = wrapIndex(y) }
    else {
      x = Math.max(0, Math.min(SIZE - 1, x))
      y = Math.max(0, Math.min(SIZE - 1, y))
    }
    return { x, y }
  }

  #down(e) {
    // Pointer capture keeps move events coming outside the canvas, which is
    // what makes wrap-drawing past an edge work.
    this.canvas.setPointerCapture(e.pointerId)
    const { x, y } = this.#cellAt(e)
    if (this.tool === 'picker') {
      const c = this.grid[idx(x, y)]
      if (c && this.onPickColor) this.onPickColor(c)
      return
    }
    this.#snapshot()
    if (this.tool === 'fill') {
      this.grid = floodFill(this.grid, x, y, this.color, this.wrap)
      this.#changed()
      return
    }
    this.drawing = true
    this.#paint(x, y)
  }

  #move(e) {
    if (!this.drawing) return
    const { x, y } = this.#cellAt(e)
    this.#paint(x, y)
  }

  #paint(x, y) {
    const value = this.tool === 'eraser' ? null : this.color
    if (this.grid[idx(x, y)] === value) return
    this.grid[idx(x, y)] = value
    this.#changed()
  }

  #snapshot() {
    this.undoStack.push(this.grid.slice())
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.redoStack = []
  }

  undo() {
    if (!this.undoStack.length) return
    this.redoStack.push(this.grid)
    this.grid = this.undoStack.pop()
    this.#changed()
  }

  redo() {
    if (!this.redoStack.length) return
    this.undoStack.push(this.grid)
    this.grid = this.redoStack.pop()
    this.#changed()
  }

  setGrid(grid) {
    this.#snapshot()
    this.grid = grid.slice()
    this.#changed()
  }

  #changed() {
    this.render()
    if (this.onChange) this.onChange()
  }

  render() {
    const { ctx, canvas } = this
    const z = canvas.width / SIZE
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const c = this.grid[idx(x, y)]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(x * z, y * z, z, z)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    for (let i = 1; i < SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * z, 0); ctx.lineTo(i * z, canvas.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * z); ctx.lineTo(canvas.width, i * z); ctx.stroke()
    }
  }

  // 16×16 canvas of the current grid — used for save and previews.
  toCanvas() {
    const c = document.createElement('canvas')
    c.width = SIZE; c.height = SIZE
    const imgData = c.getContext('2d').createImageData(SIZE, SIZE)
    this.grid.forEach((hex, i) => {
      if (!hex) return
      const [r, g, b, a] = hexToRgba(hex)
      imgData.data.set([r, g, b, a], i * 4)
    })
    c.getContext('2d').putImageData(imgData, 0, 0)
    return c
  }

  loadImageData(imgData) {
    const grid = new Array(SIZE * SIZE).fill(null)
    for (let i = 0; i < SIZE * SIZE; i++) {
      const [r, g, b, a] = imgData.data.slice(i * 4, i * 4 + 4)
      if (a > 0) grid[i] = rgbaToHex(r, g, b, a)
    }
    this.setGrid(grid)
  }
}
```

- [ ] **Step 2: Wire it up in `tools/tile-editor/editor.js`**

Append to `editor.js`:

```js
import { PixelEditor } from './pixel-editor.js'

const preview1x = document.getElementById('preview-1x')
const preview3x = document.getElementById('preview-3x')

function renderPreviews() {
  const tile = pixelEditor.toCanvas()
  const c1 = preview1x.getContext('2d')
  c1.clearRect(0, 0, 16, 16)
  c1.drawImage(tile, 0, 0)
  const c3 = preview3x.getContext('2d')
  c3.imageSmoothingEnabled = false
  c3.clearRect(0, 0, 96, 96)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++)
    c3.drawImage(tile, x * 32, y * 32, 32, 32)
}

const pixelEditor = new PixelEditor(document.getElementById('pixel-canvas'), {
  onChange: renderPreviews,
  onPickColor: (hex) => setActiveColor(hex),
})

let activeColor = '#5a5a72ff'
function setActiveColor(hex) {
  activeColor = hex.length === 7 ? hex + 'ff' : hex
  pixelEditor.color = activeColor
  document.querySelectorAll('#palette .swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color === activeColor))
}

// Toolbar
document.querySelectorAll('#toolbar [data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    pixelEditor.tool = btn.dataset.tool
    document.querySelectorAll('#toolbar [data-tool]').forEach(b =>
      b.classList.toggle('active', b === btn))
  })
})
document.getElementById('undo').addEventListener('click', () => pixelEditor.undo())
document.getElementById('redo').addEventListener('click', () => pixelEditor.redo())
const wrapBtn = document.getElementById('wrap-toggle')
wrapBtn.addEventListener('click', () => {
  pixelEditor.wrap = !pixelEditor.wrap
  wrapBtn.textContent = pixelEditor.wrap ? '⟳ wrap ON' : '⟳ wrap OFF'
  wrapBtn.classList.toggle('on', pixelEditor.wrap)
})
document.getElementById('custom-color').addEventListener('input', e =>
  setActiveColor(e.target.value))

renderPreviews()
```

- [ ] **Step 3: Manual verify**

Run: `npm run editor`
Expected: drawing with the pencil works on the big grid; both previews update live; eraser/fill/picker behave; undo/redo steps back/forward; with wrap ON, dragging a stroke past the right edge continues painting from the left edge; fill spreads across edges when wrap is ON and stops at edges when OFF.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/pixel-editor.js tools/tile-editor/editor.js
git commit -m "feat: pixel editor — tools, wrap mode, undo/redo, live previews"
```

---

### Task 8: Palette extraction

**Files:**
- Create: `tools/tile-editor/palette.js`
- Modify: `tools/tile-editor/editor.js`

- [ ] **Step 1: Create `tools/tile-editor/palette.js`**

```js
import { SIZE, rgbaToHex } from './lib.js'

// Decode a data-URL PNG into 16×16 ImageData.
export function dataURLToImageData(dataURL) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = SIZE; c.height = SIZE
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, SIZE, SIZE)
      resolve(ctx.getImageData(0, 0, SIZE, SIZE))
    }
    img.onerror = () => resolve(null)
    img.src = dataURL
  })
}

// Unique opaque colors across the given ImageDatas, most-used first.
export function extractPalette(imageDatas, max = 64) {
  const freq = new Map()
  for (const d of imageDatas) {
    if (!d) continue
    for (let i = 0; i < d.data.length; i += 4) {
      if (d.data[i + 3] === 0) continue
      const hex = rgbaToHex(d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3])
      freq.set(hex, (freq.get(hex) ?? 0) + 1)
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c)
}
```

- [ ] **Step 2: Build the palette at startup in `editor.js`**

Append to `editor.js`:

```js
import { dataURLToImageData, extractPalette } from './palette.js'

// Cache of name → ImageData for every tile on disk; reused by the library
// strip and load-as-base in later tasks.
const tileImageData = new Map()

async function loadAllTiles() {
  const names = await window.editorAPI.listTiles()
  await Promise.all(names.map(async name => {
    const dataURL = await window.editorAPI.readTile(name)
    tileImageData.set(name, await dataURLToImageData(dataURL))
  }))
  return names
}

function renderPalette(colors) {
  const el = document.getElementById('palette')
  el.innerHTML = ''
  for (const color of colors) {
    const sw = document.createElement('div')
    sw.className = 'swatch'
    sw.dataset.color = color
    sw.style.background = color
    sw.addEventListener('click', () => setActiveColor(color))
    el.appendChild(sw)
  }
}

async function initTiles() {
  const names = await loadAllTiles()
  renderPalette(extractPalette([...tileImageData.values()]))
  return names
}

const tilesReady = initTiles()
```

- [ ] **Step 3: Manual verify**

Run: `npm run editor`
Expected: after a brief load, the palette grid fills with the colors actually used by the Kenney tiles (most-used first); clicking a swatch selects that color for drawing; the custom color input still works.

- [ ] **Step 4: Commit**

```bash
git add tools/tile-editor/palette.js tools/tile-editor/editor.js
git commit -m "feat: palette extracted from existing tiles + custom color"
```

---

### Task 9: Library strip — browse and load-as-base

**Files:**
- Create: `tools/tile-editor/library.js`
- Modify: `tools/tile-editor/editor.js`

- [ ] **Step 1: Create `tools/tile-editor/library.js`**

```js
// Bottom strip: thumbnails of every tile; click loads it into the editor.
export async function buildLibrary(names, { onPick }) {
  const container = document.getElementById('library')
  const filter = document.getElementById('library-filter')
  const items = []
  for (const name of names) {
    const img = document.createElement('img')
    img.src = await window.editorAPI.readTile(name)
    img.title = name
    img.addEventListener('click', () => onPick(name))
    container.appendChild(img)
    items.push({ name, img })
  }
  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase()
    for (const { name, img } of items)
      img.style.display = name.includes(q) ? '' : 'none'
  })
  return {
    add(name, dataURL) {
      const img = document.createElement('img')
      img.src = dataURL
      img.title = name
      img.addEventListener('click', () => onPick(name))
      container.appendChild(img)
      items.push({ name, img })
    },
  }
}
```

- [ ] **Step 2: Wire it in `editor.js`**

Append to `editor.js`:

```js
import { buildLibrary } from './library.js'

let library
tilesReady.then(async names => {
  library = await buildLibrary(names, {
    onPick: (name) => {
      const data = tileImageData.get(name)
      if (data) pixelEditor.loadImageData(data)
      // Force a conscious new name — originals are never overwritten.
      document.getElementById('tile-name').value = ''
    },
  })
})
```

- [ ] **Step 3: Manual verify**

Run: `npm run editor`
Expected: bottom strip shows all 133+ tiles; the filter input narrows them by name; clicking one loads its pixels into the editing grid (undo returns to the previous drawing); the name field clears.

- [ ] **Step 4: Commit**

```bash
git add tools/tile-editor/library.js tools/tile-editor/editor.js
git commit -m "feat: tile library strip with filter and load-as-base"
```

---

### Task 10: Ruleset state and save-tile flow

**Files:**
- Modify: `tools/tile-editor/editor.js`

- [ ] **Step 1: Add ruleset state, selector, and the save-tile flow**

Append to `editor.js`:

```js
import { sanitizeTileName } from './lib.js'
import { dataURLToImageData as decodePNG } from './palette.js'

const state = { rulesets: {}, active: null }
const rulesetSelect = document.getElementById('ruleset-select')

function renderRulesetSelect() {
  rulesetSelect.innerHTML = ''
  for (const name of Object.keys(state.rulesets)) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    opt.selected = name === state.active
    rulesetSelect.appendChild(opt)
  }
}

rulesetSelect.addEventListener('change', () => {
  state.active = rulesetSelect.value
  document.dispatchEvent(new Event('ruleset-changed'))
})

document.getElementById('new-ruleset').addEventListener('click', () => {
  const name = (prompt('Ruleset name (e.g. catacombs):') ?? '').trim().toLowerCase()
  if (!name) return
  if (!state.rulesets[name]) state.rulesets[name] = { tiles: {}, tags: {} }
  state.active = name
  renderRulesetSelect()
  document.dispatchEvent(new Event('ruleset-changed'))
})

async function initRulesets() {
  state.rulesets = (await window.editorAPI.loadRulesets()) ?? {}
  state.active = Object.keys(state.rulesets)[0] ?? null
  renderRulesetSelect()
  document.dispatchEvent(new Event('ruleset-changed'))
}
initRulesets()

document.getElementById('save-tile').addEventListener('click', async () => {
  const name = sanitizeTileName(document.getElementById('tile-name').value)
  if (!name) { alert('Enter a tile name first.'); return }
  if (await window.editorAPI.tileExists(name) &&
      !confirm(`${name}.png already exists. Overwrite it?`)) return
  const dataURL = pixelEditor.toCanvas().toDataURL('image/png')
  await window.editorAPI.saveTile(name, dataURL)
  tileImageData.set(name, await decodePNG(dataURL))
  if (library) library.add(name, dataURL)

  // Register the tile (with its tags) in the active ruleset.
  const tags = document.getElementById('tile-tags').value
    .split(',').map(s => s.trim()).filter(Boolean)
  const rs = state.rulesets[state.active]
  if (rs && tags.length) {
    rs.tiles[name] = { tags, weight: rs.tiles[name]?.weight ?? 1 }
    for (const tag of tags) {
      if (!rs.tags[tag]) {
        const role = tag.startsWith('wall') ? 'wall' : 'floor'
        rs.tags[tag] = { role, allow: ['*'], forbid: [], directional: {} }
      }
    }
    await window.editorAPI.saveRulesets(state.rulesets)
    document.dispatchEvent(new Event('ruleset-changed'))
  }
  alert(`Saved ${name}.png${rs && tags.length ? ` and registered in '${state.active}'` : ''}`)
})
```

- [ ] **Step 2: Manual verify**

Run: `npm run editor`
Expected: "+ new" creates a ruleset (e.g. `catacombs`) shown in the dropdown. Draw something, set name `moss_floor_1` and tags `floor.moss`, hit Save tile → alert confirms; `renderer/assets/tiles/custom_moss_floor_1.png` exists on disk; `renderer/data/rulesets.json` now contains the tile entry and an auto-created `floor.moss` tag. Saving again with the same name asks before overwriting. A name like `tile_0001` is rejected by the main process (sanitizer makes it `custom_tile_0001`, so originals can't be hit).

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tools/tile-editor/editor.js renderer/data/rulesets.json
git commit -m "feat: save-tile flow — PNG to assets, tile+tags into active ruleset"
```

*(Note: only commit `rulesets.json` if your manual testing left intentional content; otherwise `git checkout renderer/data/rulesets.json` first to keep it `{}`.)*

---

### Task 11: Rules tab

**Files:**
- Create: `tools/tile-editor/rules-ui.js`
- Modify: `tools/tile-editor/editor.js`

- [ ] **Step 1: Create `tools/tile-editor/rules-ui.js`**

```js
// Rules tab: edit tags (role, allow, forbid, directional) and per-tile weights
// of the active ruleset. Mutates the shared state object; emits 'rules-edited'
// on every change so the sample preview can re-render.
export function initRulesUI(state) {
  const tagRows = document.getElementById('tag-rows')
  const rulePanel = document.getElementById('rule-panel')
  let selectedTag = null

  function edited() { document.dispatchEvent(new Event('rules-edited')) }

  function activeRs() { return state.rulesets[state.active] }

  function memberTiles(tag) {
    const rs = activeRs()
    return Object.entries(rs?.tiles ?? {}).filter(([, def]) => def.tags.includes(tag))
  }

  function renderTagList() {
    const rs = activeRs()
    tagRows.innerHTML = ''
    if (!rs) return
    for (const tag of Object.keys(rs.tags)) {
      const row = document.createElement('div')
      row.className = 'tag-row' + (tag === selectedTag ? ' active' : '')
      row.textContent = `${tag} (${memberTiles(tag).length})`
      row.addEventListener('click', () => { selectedTag = tag; render() })
      tagRows.appendChild(row)
    }
  }

  function chipList(parent, label, list, cls) {
    const wrap = document.createElement('div')
    const lab = document.createElement('span')
    lab.className = 'label'
    lab.textContent = label + ' '
    wrap.appendChild(lab)
    list.forEach((tag, i) => {
      const chip = document.createElement('span')
      chip.className = 'chip' + (cls ? ' ' + cls : '')
      chip.textContent = tag
      chip.title = 'click to remove'
      chip.addEventListener('click', () => { list.splice(i, 1); render(); edited() })
      wrap.appendChild(chip)
    })
    const add = document.createElement('span')
    add.className = 'add-chip'
    add.textContent = '+ add'
    add.addEventListener('click', () => {
      const t = (prompt('Tag name ("*" = any):') ?? '').trim()
      if (t) { list.push(t); render(); edited() }
    })
    wrap.appendChild(add)
    parent.appendChild(wrap)
  }

  function render() {
    renderTagList()
    rulePanel.innerHTML = ''
    const rs = activeRs()
    if (!rs || !selectedTag || !rs.tags[selectedTag]) {
      rulePanel.innerHTML = '<div class="label">Select a tag (or create one via + new tag)</div>'
      return
    }
    const rule = rs.tags[selectedTag]
    rule.allow ??= ['*']
    rule.forbid ??= []
    rule.directional ??= {}

    const title = document.createElement('div')
    title.className = 'label'
    title.textContent = `rules for ${selectedTag}`
    rulePanel.appendChild(title)

    const roleWrap = document.createElement('div')
    roleWrap.innerHTML = '<span class="label">role </span>'
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall']) {
      const o = document.createElement('option')
      o.value = r; o.textContent = r; o.selected = rule.role === r
      roleSel.appendChild(o)
    }
    roleSel.addEventListener('change', () => { rule.role = roleSel.value; edited() })
    roleWrap.appendChild(roleSel)
    rulePanel.appendChild(roleWrap)

    chipList(rulePanel, 'may neighbor', rule.allow)
    chipList(rulePanel, 'never neighbor', rule.forbid, 'forbid')

    const dirWrap = document.createElement('div')
    dirWrap.innerHTML = '<div class="label">directional override (comma-separated tags; empty = use "may neighbor")</div>'
    for (const dir of ['n', 'e', 's', 'w']) {
      const row = document.createElement('div')
      row.textContent = dir.toUpperCase() + ' '
      const inp = document.createElement('input')
      inp.className = 'dir'
      inp.value = (rule.directional[dir] ?? []).join(', ')
      inp.addEventListener('change', () => {
        const list = inp.value.split(',').map(s => s.trim()).filter(Boolean)
        if (list.length) rule.directional[dir] = list
        else delete rule.directional[dir]
        edited()
      })
      row.appendChild(inp)
      dirWrap.appendChild(row)
    }
    rulePanel.appendChild(dirWrap)

    const wWrap = document.createElement('div')
    wWrap.innerHTML = '<div class="label">member tile weights</div>'
    for (const [name, def] of memberTiles(selectedTag)) {
      const row = document.createElement('div')
      row.textContent = name + ' '
      const inp = document.createElement('input')
      inp.className = 'small'
      inp.type = 'number'
      inp.min = '0.1'
      inp.step = '0.1'
      inp.value = def.weight ?? 1
      inp.addEventListener('change', () => { def.weight = Number(inp.value) || 1; edited() })
      row.appendChild(inp)
      wWrap.appendChild(row)
    }
    rulePanel.appendChild(wWrap)

    const del = document.createElement('button')
    del.textContent = '🗑 delete tag'
    del.style.marginTop = '10px'
    del.addEventListener('click', () => {
      if (!confirm(`Delete tag ${selectedTag}? Tiles keep the tag string but it loses all rules.`)) return
      delete rs.tags[selectedTag]
      selectedTag = null
      render(); edited()
    })
    rulePanel.appendChild(del)
  }

  document.getElementById('add-tag').addEventListener('click', () => {
    const rs = activeRs()
    if (!rs) { alert('Create a ruleset first (+ new in the header).'); return }
    const tag = (prompt('New tag (e.g. floor.moss):') ?? '').trim()
    if (!tag) return
    rs.tags[tag] ??= {
      role: tag.startsWith('wall') ? 'wall' : 'floor',
      allow: ['*'], forbid: [], directional: {},
    }
    selectedTag = tag
    render(); edited()
  })

  document.addEventListener('ruleset-changed', () => { selectedTag = null; render() })
  render()
}
```

- [ ] **Step 2: Wire it up and make Save rules persist**

Append to `editor.js`:

```js
import { initRulesUI } from './rules-ui.js'

initRulesUI(state)

saveRulesBtn.addEventListener('click', async () => {
  await window.editorAPI.saveRulesets(state.rulesets)
  alert('Rules saved to renderer/data/rulesets.json')
})
```

- [ ] **Step 3: Manual verify**

Run: `npm run editor`
Expected: on the Rules tab, tags created during save-tile appear with member counts; selecting one shows role, allow/forbid chips (click chip removes, "+ add" prompts), directional inputs, and per-tile weight fields; "+ new tag" creates a tag; 💾 Save rules writes `rulesets.json` (check the file).

- [ ] **Step 4: Commit**

```bash
git add tools/tile-editor/rules-ui.js tools/tile-editor/editor.js
git commit -m "feat: rules tab — tags, allow/forbid/directional, weights"
```

---

### Task 12: Live sample preview

**Files:**
- Create: `tools/tile-editor/sample-preview.js`
- Modify: `tools/tile-editor/editor.js`

- [ ] **Step 1: Create `tools/tile-editor/sample-preview.js`**

```js
// Renders a small fake dungeon patch using the *real* decoration engine, so
// what you see here is exactly what the game's pass will produce.
import { decorateMap } from '../../renderer/systems/decorate.js'
import { TILE } from '../../renderer/systems/entities.js'

const COLS = 12
const ROWS = 8

export function renderSample(canvas, ruleset, tileImages) {
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (!ruleset) return

  // Border of walls around floor, like a room.
  const map = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => ({
      tile: (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) ? TILE.WALL : TILE.FLOOR,
      skin: null,
    })))
  decorateMap(map, ruleset)

  const s = canvas.width / COLS
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const { tile, skin } = map[y][x]
    const img = skin && tileImages.get(skin)
    if (img) ctx.drawImage(img, x * s, y * s, s, s)
    else {
      ctx.fillStyle = tile === TILE.WALL ? '#33333d' : '#15151d'
      ctx.fillRect(x * s, y * s, s, s)
    }
  }
}
```

- [ ] **Step 2: Wire it up in `editor.js`**

The sample needs `Image` elements (not ImageData) for `drawImage`. Append to `editor.js`:

```js
import { renderSample } from './sample-preview.js'

// name → Image for the sample preview
const tileImages = new Map()
async function imageFor(name) {
  if (!tileImages.has(name)) {
    const img = new Image()
    img.src = await window.editorAPI.readTile(name)
    await new Promise(res => { img.onload = res; img.onerror = res })
    tileImages.set(name, img)
  }
  return tileImages.get(name)
}

const sampleCanvas = document.getElementById('sample-canvas')
async function refreshSample() {
  const rs = state.rulesets[state.active]
  if (rs) await Promise.all(Object.keys(rs.tiles).map(imageFor))
  renderSample(sampleCanvas, rs, tileImages)
}

document.addEventListener('rules-edited', refreshSample)
document.addEventListener('ruleset-changed', refreshSample)
document.getElementById('reroll').addEventListener('click', refreshSample)
```

- [ ] **Step 3: Manual verify**

Run: `npm run editor`
Expected: with a ruleset containing a couple of tagged floor tiles, the Rules tab's sample grid shows them scattered per the rules; editing a rule (e.g. forbidding a pairing) immediately changes the layout; ⟳ re-roll produces a new arrangement; tiles excluded by rules stop appearing next to each other.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/sample-preview.js tools/tile-editor/editor.js
git commit -m "feat: live sample preview driven by the real decoration engine"
```

---

### Task 13: End-to-end validation

**Files:**
- Modify: `renderer/data/levels.js` (assign a ruleset to a theme)
- Modify: `renderer/data/rulesets.json` (authored content via the editor)
- New: `renderer/assets/tiles/custom_*.png` (authored via the editor)

- [ ] **Step 1: Author a demo ruleset in the editor**

Run: `npm run editor`
1. Create ruleset `catacombs` (+ new).
2. Load `tile_0000` (the current floor) from the library as a base, recolor a few pixels mossy green, name `moss_floor_1`, tags `floor.moss`, Save tile.
3. Make a second variant `moss_floor_2`, tags `floor.moss`, Save tile.
4. On the Rules tab give `floor.moss` allow `*`, adjust weights, Save rules.

- [ ] **Step 2: Bind the ruleset to a depth theme**

In `renderer/data/levels.js`, add to the first `DEPTH_THEMES` entry (depths 1-3):

```js
    ruleset: 'catacombs',
```

- [ ] **Step 3: See it in the game**

Run: `npm start`
Expected: on a depth the theme covers, floors show a mix of the authored moss variants instead of a single repeated tile. (Note the uncommitted playtest change may start runs at depth 10 — bind the ruleset to the depth-10 theme instead, or temporarily start at depth 1, whichever is quicker.)

- [ ] **Step 4: Verify the fallback path**

In the editor, set `floor.moss` to forbid `floor.moss` (self-forbid), Save rules, restart the game with DevTools (`Ctrl+Shift+I`).
Expected: dungeon still renders (theme default tiles fill in); console shows `decorate: no valid tile at (x,y)` warnings. Revert the forbid afterwards and Save rules again.

- [ ] **Step 5: Full test suite**

Run: `npm test`
Expected: PASS — everything green

- [ ] **Step 6: Commit the authored content**

```bash
git add renderer/data/levels.js renderer/data/rulesets.json renderer/assets/tiles/custom_*.png
git commit -m "feat: demo catacombs ruleset bound to depths 1-3"
```

---

## Self-review notes

- **Spec coverage:** editor (Tasks 5-12), ruleset format (Tasks 1-3, 10-11), decoration pass (Tasks 1-2), theme binding + rendering integration (Tasks 4, 13), error handling (name sanitizing Task 6/10, custom_ enforcement Task 5, missing-file warn in `loadSprites` Task 4, dead-end fallback Task 2/13), testing (Tasks 1, 2, 6 + manual steps).
- **Sequencing:** engine first (pure, tested), then game wiring (inert until a theme opts in), then editor outside-in, demo content last.
- **The `weight (spawn freq)` slider from the mockup** is realized as per-member-tile numeric inputs on the Rules tab (matches the spec: weights live on tiles).
