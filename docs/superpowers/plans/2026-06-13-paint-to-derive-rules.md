# Paint-to-Derive Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the tile editor's Build tab into a real-tile example painter that derives adjacency-aware decoration rules from the painting, reproducing the painted style in-game.

**Architecture:** Extend `decorateMap` with a soft, adjacency-weighted selection layer (hard `allow`/`forbid` filter unchanged, then bias by observed neighbor frequencies). A pure `derive-rules.js` turns a painted grid + tile metadata into a ruleset fragment (per-tile weights + per-tag directional `adjacency`). The reworked Build tab paints real tile sprites, lets you tag tiles, derives into the active ruleset (`rulesets.json`), and previews the engine output. The abstract-symbol template/landmark pieces are removed; the `placeTemplate` legend refactor is kept.

**Tech Stack:** Vanilla ES modules + Canvas (renderer & editor), Electron IPC, `node --test`.

---

## File Structure

**Game / shared (under test):**
- Modify `renderer/systems/decorate.js` — add `ADJACENCY_ALPHA`, `adjacencyScore`, `pickByAdjacency`; `decorateMap` uses `pickByAdjacency`.

**Editor:**
- Create `tools/tile-editor/derive-rules.js` — pure derivation (grid + tileMeta → fragment). Unit-tested.
- Create `tools/tile-editor/map-painter.js` — the reworked Build-tab UI (palette, sprite canvas, tagging, derive, preview).
- Modify `tools/tile-editor/index.html` — replace Build-tab markup; drop the Save-template header button.
- Modify `tools/tile-editor/editor.js` — mount `map-painter`; drop template-builder wiring.
- Modify `tools/tile-editor/editor-preload.cjs` — remove `loadTemplates`/`saveTemplates`.

**Cleanup (template/landmark direction removed):**
- Modify `renderer/data/levels.js` — remove `BUILTIN_TEMPLATE_NAMES` + `registerCustomTemplates` (keep `TEMPLATE_LEGEND`).
- Modify `main.cjs` — remove `TEMPLATES_FILE` + `load-templates`/`save-templates` handlers.
- Modify `preload.cjs` — remove `loadTemplates`.
- Modify `renderer/game.js` — remove the `registerCustomTemplates` import + startup call.
- Delete `tools/tile-editor/template-builder.js`, `tools/tile-editor/template-grid.js`, `test/template-grid.test.js`, `test/levels.test.js`.

**Tests:**
- Modify `test/decorate.test.js` — adjacency scoring + selection + regression.
- Create `test/derive-rules.test.js` — derivation.

---

## Task 1: Adjacency-aware selection in `decorateMap`

**Files:**
- Modify: `renderer/systems/decorate.js`
- Test: `test/decorate.test.js`

- [ ] **Step 1: Write the failing tests**

Add `adjacencyScore` and `pickByAdjacency` to the import at the top of `test/decorate.test.js` (line 3):

```js
import { roleOf, tagsOf, pairAllowed, candidatesForRole, pickWeighted, decorateMap, pruneMissingTiles, adjacencyScore, pickByAdjacency, ADJACENCY_ALPHA } from '../renderer/systems/decorate.js'
```

Append this describe block to the end of `test/decorate.test.js` (after the final top-level block):

```js
describe('adjacency-aware selection', () => {
  const RS = {
    tiles: {
      moss:  { tags: ['floor.moss'],  weight: 1 },
      plain: { tags: ['floor.plain'], weight: 1 },
      wallA: { tags: ['wall.base'],   weight: 1 },
    },
    tags: {
      'floor.moss':  { role: 'floor', allow: ['*'], adjacency: { n:{}, e:{}, s:{}, w:{ 'wall.base': 4 } } },
      'floor.plain': { role: 'floor', allow: ['*'] },
      'wall.base':   { role: 'wall',  allow: ['*'] },
    },
  }

  it('ADJACENCY_ALPHA is the documented smoothing default', () => {
    assert.equal(ADJACENCY_ALPHA, 0.5)
  })

  it('adjacencyScore adds observed counts + ALPHA per neighbor', () => {
    // moss saw wall.base to its west 4 times → 4 + 0.5
    assert.equal(adjacencyScore(RS, 'moss',  [{ dir: 'w', skin: 'wallA' }]), 4.5)
    // plain has no adjacency data → flat ALPHA
    assert.equal(adjacencyScore(RS, 'plain', [{ dir: 'w', skin: 'wallA' }]), 0.5)
  })

  it('adjacencyScore is neutral (1) with no neighbors', () => {
    assert.equal(adjacencyScore(RS, 'moss', []), 1)
  })

  it('pickByAdjacency biases toward observed neighbors', () => {
    const nb = [{ dir: 'w', skin: 'wallA' }]   // weights: moss 4.5, plain 0.5, total 5
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0),    'moss')   // r=0
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0.95), 'plain')  // r=4.75 → past moss band
  })

  it('pickByAdjacency with no neighbors reduces to weighted-by-weight', () => {
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], [], () => 0), 'moss')
  })

  it('decorateMap honors adjacency preference', () => {
    // moss strongly prefers a wall to its west; plain does not.
    const rs = {
      tiles: { moss: { tags: ['floor.moss'], weight: 1 }, plain: { tags: ['floor.plain'], weight: 1 }, wallA: { tags: ['wall.base'], weight: 1 } },
      tags: {
        'floor.moss':  { role: 'floor', allow: ['*'], adjacency: { n:{}, e:{}, s:{}, w:{ 'wall.base': 999 } } },
        'floor.plain': { role: 'floor', allow: ['*'] },
        'wall.base':   { role: 'wall',  allow: ['*'] },
      },
    }
    const map = makeCells(['#.'])   // (0,0) wall, (0,1) floor with wall to its west
    decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].skin, 'wallA')
    assert.equal(map[0][1].skin, 'moss')   // 999.5 vs 0.5 → moss for any seed
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern="adjacency-aware selection"`
Expected: FAIL — `adjacencyScore`/`pickByAdjacency`/`ADJACENCY_ALPHA` are not exported.

- [ ] **Step 3: Implement in `decorate.js`**

In `renderer/systems/decorate.js`, add after the `pickWeighted` function (around line 56):

```js
// Smoothing so unseen adjacencies stay possible but unlikely (the "loose" model).
export const ADJACENCY_ALPHA = 0.5

// Multiplicative adjacency score for placing `tileName` given decided neighbors.
// neighbors: [{ dir, skin }] where skin is the neighbor's tile name. Each tag of
// `tileName` contributes its observed count toward the neighbor's tags in `dir`;
// a tag with no adjacency data contributes a flat ALPHA, so this returns 1
// (neutral) when no adjacency info exists and reduces selection to weight-only.
export function adjacencyScore(ruleset, tileName, neighbors) {
  const tags = tagsOf(ruleset, tileName)
  let score = 1
  for (const nb of neighbors) {
    const nbTags = tagsOf(ruleset, nb.skin)
    let count = 0
    for (const t of tags) {
      const dirMap = ruleset.tags[t]?.adjacency?.[nb.dir]
      if (!dirMap) continue
      for (const u of nbTags) count += dirMap[u] ?? 0
    }
    score *= count + ADJACENCY_ALPHA
  }
  return score
}

// Weighted pick combining each tile's base weight with its adjacency score.
export function pickByAdjacency(ruleset, names, neighbors, rng) {
  const weights = names.map(n =>
    (ruleset.tiles[n].weight ?? 1) * adjacencyScore(ruleset, n, neighbors))
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return names[names.length - 1]
  let r = rng() * total
  for (let i = 0; i < names.length; i++) {
    r -= weights[i]
    if (r <= 0) return names[i]
  }
  return names[names.length - 1]
}
```

Then in `decorateMap`, change the final selection line (currently `cell.skin = pickWeighted(ruleset, survivors, rng)`, around line 101) to:

```js
      cell.skin = pickByAdjacency(ruleset, survivors, neighbors, rng)
```

(`neighbors` is the already-computed `[{ dir, skin }]` list of decided N/W neighbors. Keep `pickWeighted` — it stays exported and tested.)

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern="adjacency-aware selection"`
Expected: PASS.

- [ ] **Step 5: Run the full suite — backward-compat regression**

Run: `npm test`
Expected: all pass, including every existing `decorateMap` test (no `adjacency` data ⇒ unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/decorate.js test/decorate.test.js
git commit -m "feat: adjacency-aware soft weighting in decorateMap"
```

---

## Task 2: Derivation module `derive-rules.js`

**Files:**
- Create: `tools/tile-editor/derive-rules.js`
- Test: `test/derive-rules.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/derive-rules.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRules } from '../tools/tile-editor/derive-rules.js'

// tileMeta: name -> { role, tags }
const META = new Map([
  ['m1', { role: 'floor', tags: ['floor.moss'] }],
  ['m2', { role: 'floor', tags: ['floor.moss'] }],
  ['pl', { role: 'floor', tags: ['floor.plain'] }],
  ['wl', { role: 'wall',  tags: ['wall.base'] }],
])

describe('deriveRules', () => {
  it('counts per-tile weights from occurrences', () => {
    const grid = [['m1', 'm1', 'pl']]
    const { tiles } = deriveRules(grid, META)
    assert.deepEqual(tiles.m1, { tags: ['floor.moss'], weight: 2 })
    assert.deepEqual(tiles.pl, { tags: ['floor.plain'], weight: 1 })
  })

  it('accumulates directional adjacency between tags', () => {
    const grid = [['m1', 'pl']]   // m1 east-of nothing; pl is east of m1
    const { tags } = deriveRules(grid, META)
    assert.equal(tags['floor.moss'].adjacency.e['floor.plain'], 1)
    assert.equal(tags['floor.plain'].adjacency.w['floor.moss'], 1)
    // unrelated directions stay empty
    assert.deepEqual(tags['floor.moss'].adjacency.n, {})
  })

  it('emits permissive tag defaults with role from tile meta', () => {
    const { tags } = deriveRules([['wl']], META)
    assert.equal(tags['wall.base'].role, 'wall')
    assert.deepEqual(tags['wall.base'].allow, ['*'])
    assert.deepEqual(tags['wall.base'].forbid, [])
    assert.deepEqual(tags['wall.base'].directional, {})
  })

  it('skips untagged cells and counts them', () => {
    const grid = [['m1', 'ghost', null]]   // ghost not in META, null empty
    const { tiles, skipped } = deriveRules(grid, META)
    assert.equal(skipped, 1)               // only 'ghost' (null is not "placed")
    assert.equal(tiles.ghost, undefined)
  })

  it('returns empty fragment for an empty grid', () => {
    assert.deepEqual(deriveRules([[null, null]], META), { tiles: {}, tags: {}, skipped: 0 })
  })

  it('treats moss tiles as the same tag for adjacency (generalization)', () => {
    const grid = [['m1', 'wl'], ['m2', 'wl']]   // both moss tiles sit west of wall
    const { tags } = deriveRules(grid, META)
    assert.equal(tags['floor.moss'].adjacency.e['wall.base'], 2)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern=deriveRules`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `derive-rules.js`**

Create `tools/tile-editor/derive-rules.js`:

```js
// Pure: a painted grid + tile metadata → a ruleset fragment. No DOM.
// grid[row][col] is a tile name or null (empty).
// tileMeta: Map<tileName, { role: 'floor'|'wall', tags: string[] }>.
// Returns { tiles, tags, skipped } where skipped counts placed-but-untagged cells.

const DIRS = [
  { dx: 0, dy: -1, d: 'n' },
  { dx: 1, dy: 0,  d: 'e' },
  { dx: 0, dy: 1,  d: 's' },
  { dx: -1, dy: 0, d: 'w' },
]

function metaOf(tileMeta, name) {
  if (name == null) return null
  const m = tileMeta.get(name)
  return m && Array.isArray(m.tags) && m.tags.length ? m : null
}

export function deriveRules(grid, tileMeta) {
  const tiles = {}
  const tags = {}
  let skipped = 0

  // Per-tile weights + tag registration.
  for (const row of grid) {
    for (const name of row) {
      if (name == null) continue
      const meta = metaOf(tileMeta, name)
      if (!meta) { skipped++; continue }
      tiles[name] = tiles[name] ?? { tags: meta.tags.slice(), weight: 0 }
      tiles[name].weight++
      for (const t of meta.tags) {
        if (!tags[t]) {
          tags[t] = { role: meta.role, allow: ['*'], forbid: [], directional: {}, adjacency: { n: {}, e: {}, s: {}, w: {} } }
        }
      }
    }
  }

  // Per-tag directional adjacency counts.
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const meta = metaOf(tileMeta, grid[y][x])
      if (!meta) continue
      for (const { dx, dy, d } of DIRS) {
        const nbMeta = metaOf(tileMeta, grid[y + dy]?.[x + dx])
        if (!nbMeta) continue
        for (const t of meta.tags) {
          for (const u of nbMeta.tags) {
            tags[t].adjacency[d][u] = (tags[t].adjacency[d][u] ?? 0) + 1
          }
        }
      }
    }
  }

  return { tiles, tags, skipped }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern=deriveRules`
Expected: PASS. Also run `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/derive-rules.js test/derive-rules.test.js
git commit -m "feat: pure deriveRules — painted grid to ruleset fragment"
```

---

## Task 3: Remove the template/landmark direction (game side)

Removes the editor-authored-template pieces while keeping the `placeTemplate` → `TEMPLATE_LEGEND` refactor. Editor-side template files are removed in Task 4.

**Files:**
- Modify: `renderer/data/levels.js`, `main.cjs`, `preload.cjs`, `renderer/game.js`
- Delete: `test/levels.test.js`

- [ ] **Step 1: Remove `registerCustomTemplates` from `levels.js`**

In `renderer/data/levels.js`, delete this block (it sits between the `TEMPLATES` object's closing `}` and `export const LEVEL_CONFIG`):

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

Leave `TEMPLATE_LEGEND`, `TEMPLATES`, `LEVEL_CONFIG`, `DEPTH_THEMES`, `FINAL_DEPTH` intact.

- [ ] **Step 2: Remove the templates IPC from `main.cjs`**

In `main.cjs`, delete the `TEMPLATES_FILE` constant line:

```js
const TEMPLATES_FILE = path.join(__dirname, 'renderer', 'data', 'templates.json')
```

and delete both handlers:

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

- [ ] **Step 3: Remove `loadTemplates` from the game preload (`preload.cjs`)**

In `preload.cjs`, delete the line:

```js
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
```

- [ ] **Step 4: Remove the startup call from `game.js`**

In `renderer/game.js`, change the import on line 12 from:

```js
import { FINAL_DEPTH, DEPTH_THEMES, registerCustomTemplates } from './data/levels.js'
```

to:

```js
import { FINAL_DEPTH, DEPTH_THEMES } from './data/levels.js'
```

and delete the call line in `init()`:

```js
  registerCustomTemplates((await window.saveAPI.loadTemplates()) ?? {})
```

- [ ] **Step 5: Delete the obsolete test**

```bash
git rm test/levels.test.js
```

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: all pass (the `placeTemplate`/`TEMPLATE_LEGEND` tests remain green; `levels.test.js` is gone).

Syntax-check the CommonJS + game module:
```bash
node --check main.cjs && node --check preload.cjs && echo "cjs OK"
node -e "import('./renderer/data/levels.js').then(m => console.log('levels exports:', Object.keys(m)))"
```
Expected: `cjs OK`; `levels exports:` includes `TEMPLATES`, `TEMPLATE_LEGEND`, `LEVEL_CONFIG`, `DEPTH_THEMES`, `FINAL_DEPTH` and NOT `registerCustomTemplates`.

- [ ] **Step 7: Commit**

```bash
git add renderer/data/levels.js main.cjs preload.cjs renderer/game.js
git commit -m "chore: remove editor-authored template pipeline (keep placeTemplate legend)"
```

---

## Task 4: Build tab → real-tile painter (cleanup + palette + canvas)

Replaces the template Build tab with a real-tile sprite painter. Derivation/tagging/preview come in Task 5. GUI tool — headless WSL2 cannot launch Electron; verify via parse checks + reading. `npm test` must stay green.

**Files:**
- Delete: `tools/tile-editor/template-builder.js`, `tools/tile-editor/template-grid.js`, `test/template-grid.test.js`
- Modify: `tools/tile-editor/editor-preload.cjs`, `tools/tile-editor/index.html`, `tools/tile-editor/editor.js`
- Create: `tools/tile-editor/map-painter.js`

- [ ] **Step 1: Delete the template editor files**

```bash
git rm tools/tile-editor/template-builder.js tools/tile-editor/template-grid.js test/template-grid.test.js
```

- [ ] **Step 2: Remove the templates bridge from `editor-preload.cjs`**

In `tools/tile-editor/editor-preload.cjs`, delete these two lines:

```js
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
  saveTemplates: (data) => ipcRenderer.invoke('save-templates', data),
```

Keep `loadRulesets`/`saveRulesets` and the tile methods.

- [ ] **Step 3: Replace the Build-tab markup + CSS in `index.html`**

In `tools/tile-editor/index.html`, delete the Save-template header button:

```html
    <button id="save-template" class="save" style="display:none">💾 Save template</button>
```

Replace the entire `<main id="build-view" ...> … </main>` block with:

```html
  <main id="build-view" style="display:none">
    <div id="paint-palette" class="panel" style="width:170px; overflow-y:auto"></div>
    <div id="paint-stage" class="panel" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto">
      <canvas id="paint-canvas"></canvas>
    </div>
    <div id="paint-sidebar" class="panel" style="width:240px; display:flex; flex-direction:column; gap:6px; overflow-y:auto">
      <div class="label">Size (width × height)</div>
      <div style="display:flex; gap:4px; align-items:center">
        <input id="paint-w" class="small" type="number" min="2" max="60" value="16">
        <span>×</span>
        <input id="paint-h" class="small" type="number" min="2" max="40" value="12">
        <button id="paint-resize">resize</button>
      </div>
      <div id="paint-tagging" class="label">Pick a tile to tag…</div>
      <button id="derive-btn" class="save" style="background:#2a4a66">⚙ Derive rules → active ruleset</button>
      <div id="derive-report" style="font-size:11px; color:#9a9"></div>
      <div class="label">Preview outcome</div>
      <canvas id="paint-preview" width="240" height="160"></canvas>
      <button id="paint-reroll">⟳ re-roll</button>
    </div>
  </main>
```

Replace the old Build-tab CSS rules (the `#build-palette .legend`, `#build-palette .sw`, `#template-list …` rules) with:

```css
  #paint-palette img { width:40px; height:40px; image-rendering:pixelated; border:1px solid #333;
                       cursor:pointer; margin:2px; }
  #paint-palette img.active { border-color:#7fd; }
  #paint-palette .erase { display:block; width:100%; margin-bottom:4px; }
  #paint-canvas { image-rendering:pixelated; border:1px solid #444; }
```

- [ ] **Step 4: Rewire `editor.js`**

In `tools/tile-editor/editor.js`:

(a) Replace the import line `import { initTemplateBuilder } from './template-builder.js'` with:

```js
import { initMapPainter } from './map-painter.js'
```

(b) Remove the `saveTemplateBtn` ref line:

```js
const saveTemplateBtn = document.getElementById('save-template')
```

(keep `const buildView = …` and `const tabBuild = …`).

(c) In `showTab`, delete the line referencing the removed button:

```js
  saveTemplateBtn.style.display = tab === 'build' ? '' : 'none'
```

(d) Replace the two bottom wiring lines:

```js
initTemplateBuilder()
saveTemplateBtn.addEventListener('click', () => initTemplateBuilder.save?.())
```

with:

```js
initMapPainter({ state, imageFor, tilesReady })
```

`state`, `imageFor`, and `tilesReady` are all already defined above in `editor.js` (the ruleset state object, the async tile-image getter, and the promise resolving to all tile names).

- [ ] **Step 5: Create `map-painter.js` (paint only)**

Create `tools/tile-editor/map-painter.js`:

```js
// Build tab: paint a room with real tile sprites, then derive adjacency rules
// from it (derive/tagging/preview added in a later step). Deps come from
// editor.js: { state, imageFor, tilesReady }.
//   state      - { rulesets, active } shared ruleset state
//   imageFor   - async (name) => HTMLImageElement (cached)
//   tilesReady - Promise<string[]> of all library tile names

const CELL = 26  // px per cell on the paint canvas

export function initMapPainter({ state, imageFor, tilesReady }) {
  const canvas = document.getElementById('paint-canvas')
  const ctx = canvas.getContext('2d')
  const paletteEl = document.getElementById('paint-palette')
  const wInput = document.getElementById('paint-w')
  const hInput = document.getElementById('paint-h')

  const blank = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => null))
  const grid = { cells: blank(Number(wInput.value), Number(hInput.value)) }
  let active = null          // active brush tile name; null = eraser
  let painting = false
  const images = new Map()   // name -> Image

  function sizeCanvas() {
    canvas.width = grid.cells[0].length * CELL
    canvas.height = grid.cells.length * CELL
  }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    grid.cells.forEach((row, y) => row.forEach((name, x) => {
      ctx.fillStyle = '#15151d'
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
      const img = name && images.get(name)
      if (img) ctx.drawImage(img, x * CELL, y * CELL, CELL, CELL)
      ctx.strokeStyle = '#0006'
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL)
    }))
  }
  async function ensureImage(name) {
    if (!name || images.has(name)) return
    images.set(name, await imageFor(name))
    render()
  }

  function markActive(name) {
    paletteEl.querySelectorAll('img').forEach(i => i.classList.toggle('active', i.dataset.name === name))
  }
  function setActive(name) {
    active = name
    markActive(name)
    if (name) ensureImage(name)
  }

  async function buildPalette(names) {
    paletteEl.innerHTML = ''
    const erase = document.createElement('button')
    erase.className = 'erase'
    erase.textContent = '✖ erase'
    erase.addEventListener('click', () => setActive(null))
    paletteEl.appendChild(erase)
    for (const name of names) {
      const img = document.createElement('img')
      img.src = await window.editorAPI.readTile(name)
      img.title = name
      img.dataset.name = name
      img.addEventListener('click', () => setActive(name))
      paletteEl.appendChild(img)
    }
  }

  function cellAt(ev) {
    const r = canvas.getBoundingClientRect()
    return { x: Math.floor((ev.clientX - r.left) / CELL), y: Math.floor((ev.clientY - r.top) / CELL) }
  }
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (grid.cells[y]?.[x] === undefined) return
    grid.cells[y][x] = active   // active === null erases
    render()
  }
  canvas.addEventListener('mousedown', e => { painting = true; paint(e) })
  canvas.addEventListener('mousemove', e => { if (painting) paint(e) })
  window.addEventListener('mouseup', () => { painting = false })

  document.getElementById('paint-resize').addEventListener('click', () => {
    const w = Math.max(2, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(2, Math.min(40, Number(hInput.value) | 0))
    grid.cells = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => grid.cells[y]?.[x] ?? null))
    sizeCanvas(); render()
  })

  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
  sizeCanvas()
  render()
}
```

- [ ] **Step 6: Verify (no GUI)**

Run: `npm test` → expect all pass.

Parse-check the new module + confirm no dangling references:
```bash
node -e "import('./tools/tile-editor/map-painter.js').then(m => console.log('exports:', Object.keys(m)))"
grep -rn "template-builder\|template-grid\|initTemplateBuilder\|save-template\|saveTemplateBtn\|loadTemplates\|saveTemplates" tools/tile-editor/ ; echo "grep done (expect no matches)"
grep -c 'id="tab-build"\|id="paint-canvas"\|id="derive-btn"\|id="paint-palette"' tools/tile-editor/index.html
```
Expected: `exports: [ 'initMapPainter' ]`; the dangling-reference grep prints only "grep done" with no file matches; the id grep prints `4`.

- [ ] **Step 7: Commit**

```bash
git add -A tools/tile-editor/ test/
git commit -m "feat: Build tab reworked into a real-tile sprite painter"
```

---

## Task 5: Tagging, derive, and outcome preview

Extends `map-painter.js`: inline tile tagging, the Derive button (uses `deriveRules` + merge + save), and the live outcome preview (the extended `decorateMap` via `renderSample`). GUI tool — verify via parse checks + reading.

**Files:**
- Modify: `tools/tile-editor/map-painter.js`

- [ ] **Step 1: Add imports + merge helper at the top of `map-painter.js`**

Add below the existing header comment / above `const CELL`:

```js
import { deriveRules } from './derive-rules.js'
import { renderSample } from './sample-preview.js'

// Merge a derived fragment into a ruleset: overwrite tile weights/tags and each
// painted tag's role + adjacency, but preserve any hand-authored allow/forbid/
// directional on tags that already exist. Unpainted tags are left untouched.
function mergeFragment(ruleset, frag) {
  ruleset.tiles = ruleset.tiles ?? {}
  ruleset.tags = ruleset.tags ?? {}
  for (const [name, def] of Object.entries(frag.tiles)) ruleset.tiles[name] = def
  for (const [tag, def] of Object.entries(frag.tags)) {
    const existing = ruleset.tags[tag]
    ruleset.tags[tag] = existing
      ? { ...existing, role: def.role, adjacency: def.adjacency }
      : def
  }
}
```

- [ ] **Step 2: Make `setActive` refresh the tagging panel**

In `map-painter.js`, change `setActive` to also call `renderTagging` (a function declaration added in Step 3, so hoisting makes this safe):

```js
  function setActive(name) {
    active = name
    markActive(name)
    if (name) ensureImage(name)
    renderTagging()
  }
```

- [ ] **Step 3: Add tagging, derive, and preview inside `initMapPainter`**

In `map-painter.js`, insert the following just before the final `sizeCanvas()` / `render()` lines at the end of `initMapPainter` (so all the in-scope vars — `grid`, `state`, `images`, `ensureImage`, `active` — are available):

```js
  const taggingEl = document.getElementById('paint-tagging')
  const reportEl = document.getElementById('derive-report')
  const previewCanvas = document.getElementById('paint-preview')

  // Ensure there's an active ruleset to write into.
  function ensureRuleset() {
    if (!state.active) {
      state.active = 'derived'
      document.dispatchEvent(new Event('ruleset-changed'))
    }
    state.rulesets[state.active] = state.rulesets[state.active] ?? { tiles: {}, tags: {} }
    return state.rulesets[state.active]
  }

  // Inline role+tag assignment for the active brush tile.
  function renderTagging() {
    taggingEl.innerHTML = ''
    if (!active) { taggingEl.textContent = 'Pick a tile to tag…'; return }
    const rs = state.rulesets[state.active]
    const curTag = rs?.tiles?.[active]?.tags?.[0] ?? ''
    const lbl = document.createElement('div')
    lbl.className = 'label'
    lbl.textContent = `Tag ${active}` + (curTag ? ` (now: ${curTag})` : ' (untagged)')
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall']) {
      const o = document.createElement('option'); o.value = o.textContent = r; roleSel.appendChild(o)
    }
    if (curTag && rs?.tags?.[curTag]?.role) roleSel.value = rs.tags[curTag].role
    const tagInput = document.createElement('input')
    tagInput.placeholder = 'floor.moss'; tagInput.value = curTag; tagInput.style.width = '100%'
    const apply = document.createElement('button')
    apply.textContent = 'apply tag'
    apply.addEventListener('click', () => {
      const tag = tagInput.value.trim()
      if (!tag) return
      const r = ensureRuleset()
      r.tiles[active] = { tags: [tag], weight: r.tiles[active]?.weight ?? 1 }
      if (!r.tags[tag]) {
        r.tags[tag] = { role: roleSel.value, allow: ['*'], forbid: [], directional: {}, adjacency: { n: {}, e: {}, s: {}, w: {} } }
      } else {
        r.tags[tag].role = roleSel.value
      }
      renderTagging()
    })
    taggingEl.append(lbl, roleSel, tagInput, apply)
  }

  // Build tileMeta for derivation from the active ruleset's tagged tiles.
  function tileMetaFromRuleset(rs) {
    const meta = new Map()
    for (const [name, def] of Object.entries(rs.tiles ?? {})) {
      const tag0 = def.tags?.[0]
      const role = tag0 && rs.tags?.[tag0]?.role
      if (def.tags?.length && role) meta.set(name, { role, tags: def.tags })
    }
    return meta
  }

  async function refreshPreview() {
    const rs = state.rulesets[state.active]
    if (!rs) return
    await Promise.all(Object.keys(rs.tiles ?? {}).map(ensureImage))
    renderSample(previewCanvas, rs, images)
  }

  document.getElementById('derive-btn').addEventListener('click', async () => {
    const rs = state.rulesets[state.active]
    if (!rs) { reportEl.textContent = 'Select or create a ruleset first (top bar).'; return }
    const frag = deriveRules(grid.cells, tileMetaFromRuleset(rs))
    if (Object.keys(frag.tiles).length === 0) {
      reportEl.textContent = 'Nothing derived — paint some tagged tiles first.' +
        (frag.skipped ? ` (${frag.skipped} untagged cells skipped)` : '')
      return
    }
    mergeFragment(rs, frag)
    try {
      await window.editorAPI.saveRulesets(state.rulesets)
      document.dispatchEvent(new Event('ruleset-changed'))
      const adj = Object.values(frag.tags).reduce((s, t) =>
        s + ['n', 'e', 's', 'w'].reduce((a, d) => a + Object.keys(t.adjacency[d]).length, 0), 0)
      reportEl.textContent =
        `Derived ${Object.keys(frag.tiles).length} tiles, ${Object.keys(frag.tags).length} tags, ${adj} adjacencies` +
        (frag.skipped ? ` — ${frag.skipped} untagged cells skipped` : '')
      refreshPreview()
    } catch (err) {
      reportEl.textContent = `Save failed: ${err.message}`
    }
  })
  document.getElementById('paint-reroll').addEventListener('click', refreshPreview)
```

- [ ] **Step 4: Verify (no GUI)**

Run: `npm test` → expect all pass (no test changes; this is editor UI).

Parse-check + confirm wiring:
```bash
node -e "import('./tools/tile-editor/map-painter.js').then(m => console.log('exports:', Object.keys(m)))"
grep -n "deriveRules\|renderSample\|mergeFragment\|renderTagging\|refreshPreview" tools/tile-editor/map-painter.js
```
Expected: `exports: [ 'initMapPainter' ]`; the grep shows the import + definitions + call sites present.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/map-painter.js
git commit -m "feat: tile tagging, rule derivation, and outcome preview in the painter"
```

---

## Manual verification (user, with a display)

The headless WSL2 environment cannot launch Electron, so confirm the loop with `npm run editor`:
1. Build tab shows the tile library (left), an empty 16×12 grid (center), and size/derive/preview controls (right).
2. Select a tile → it becomes the brush; click-drag paints sprites; "✖ erase" clears cells; resize grows/shrinks the grid.
3. Pick a tile → assign role + tag (e.g. `floor.moss`) → "apply tag".
4. Paint a representative room mixing tagged floor + wall tiles, then "⚙ Derive rules" → report shows tiles/tags/adjacencies; any untagged tiles are reported as skipped.
5. "Preview outcome" re-rolls a patch that reflects the painted style; switching to the Rules tab shows the same ruleset updated.
6. `npm start` and confirm a depth using that ruleset decorates without errors.

---

## Self-Review Notes

- **Spec coverage:** adjacency schema + two-layer engine (Task 1); derivation count/adjacency/skip/empty + tag-generalization (Task 2); cleanup keeping the legend refactor (Tasks 3–4); real-tile palette + sprite canvas + resize (Task 4); inline tagging, derive→merge→save, outcome preview, active-ruleset targeting (Task 5); error handling — untagged skips, empty no-op, save-failure report, backward compat (Tasks 1, 2, 5); testing — derive-rules unit, decorate adjacency + regression, manual UI (Tasks 1, 2, manual section). All spec sections map to a task.
- **Type/name consistency:** `deriveRules(grid, tileMeta) → { tiles, tags, skipped }` defined in Task 2 and consumed in Task 5; `tileMeta` is `Map<name,{role,tags}>` in both; `adjacency` shape `{ n,e,s,w }` of `{tag:count}` is identical across `deriveRules`, `adjacencyScore`, and `mergeFragment`; `pickByAdjacency(ruleset, names, neighbors, rng)` neighbor shape `{ dir, skin }` matches `decorateMap`'s `neighbors` list; `initMapPainter({ state, imageFor, tilesReady })` matches the call added in `editor.js` (Task 4).
- **No placeholders.**
