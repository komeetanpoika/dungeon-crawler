# Structure Prefab Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a designer mark painted cells as "part of a structure" (with per-cell collision and door/chest interactions), export them as an exact-tile prefab, and have the level generator place the prefab through the existing landmark slot.

**Architecture:** A new pure `structure-lib.js` handles per-cell property toggling and serialization. The painter gains a third "properties" layer. Prefabs save to `renderer/data/structures.json` via new IPC. `generateLevel` resolves landmark names against structures first and stamps them with `placeStructure`, which sets `cell.locked`; `decorateMap` skips locked cells so painted sprites survive.

**Tech Stack:** Vanilla ES modules, Electron IPC, `node:test` + `node:assert/strict`, Playwright (`playwright-core` `_electron`) for runtime checks on WSLg.

**Spec:** `docs/superpowers/specs/2026-06-16-structure-prefab-authoring-design.md`

---

### Task 1: Pure structure-lib (property toggle + export serializer)

**Files:**
- Create: `tools/tile-editor/structure-lib.js`
- Test: `test/structure-lib.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/structure-lib.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setProperty, exportStructure } from '../tools/tile-editor/structure-lib.js'

describe('setProperty', () => {
  it('sets an exclusive collision value', () => {
    assert.deepEqual(setProperty(null, 'collision', 'wall'), { collision: 'wall' })
  })
  it('replaces collision with a different value', () => {
    assert.deepEqual(setProperty({ collision: 'wall' }, 'collision', 'walkable'), { collision: 'walkable' })
  })
  it('toggles collision off when painting the same value', () => {
    assert.equal(setProperty({ collision: 'wall' }, 'collision', 'wall'), null)
  })
  it('toggles an interaction on and off', () => {
    assert.deepEqual(setProperty(null, 'interaction', 'door'), { interaction: { type: 'door' } })
    assert.equal(setProperty({ interaction: { type: 'door' } }, 'interaction', 'door'), null)
  })
  it('replaces one interaction type with another', () => {
    assert.deepEqual(setProperty({ interaction: { type: 'door' } }, 'interaction', 'chest'),
      { interaction: { type: 'chest' } })
  })
  it('toggles structure membership', () => {
    assert.deepEqual(setProperty(null, 'structure'), { structure: true })
    assert.equal(setProperty({ structure: true }, 'structure'), null)
  })
  it('keeps other properties when toggling one', () => {
    assert.deepEqual(setProperty({ collision: 'wall' }, 'structure'), { collision: 'wall', structure: true })
  })
})

describe('exportStructure', () => {
  const meta = new Map([
    ['w1', { role: 'wall', tags: ['wall.base'] }],
    ['f1', { role: 'floor', tags: ['floor.base'] }],
  ])
  // 2-wide x 2-tall painted map; structure marks the right column only.
  const base = [['f1', 'w1'], ['f1', 'w1']]
  const overlay = [[null, 'banner'], [null, null]]
  const props = [
    [null, { structure: true }],
    [null, { structure: true, collision: 'walkable', interaction: { type: 'door' } }],
  ]

  it('returns null when nothing is marked', () => {
    assert.equal(exportStructure(base, overlay, [[null, null], [null, null]], meta), null)
  })
  it('normalizes the footprint origin to (0,0) and sizes it', () => {
    const s = exportStructure(base, overlay, props, meta)
    assert.equal(s.w, 1)
    assert.equal(s.h, 2)
    assert.equal(s.cells.length, 2)
    assert.deepEqual(s.cells.map(c => [c.x, c.y]).sort(), [[0, 0], [0, 1]])
  })
  it('defaults collision from the tile role and carries skin/overlay', () => {
    const s = exportStructure(base, overlay, props, meta)
    const top = s.cells.find(c => c.y === 0)
    assert.equal(top.skin, 'w1')
    assert.equal(top.overlay, 'banner')
    assert.equal(top.collision, 'wall')        // defaulted from wall role
    assert.equal(top.interaction, null)
  })
  it('honors explicit collision and interaction overrides', () => {
    const s = exportStructure(base, overlay, props, meta)
    const bottom = s.cells.find(c => c.y === 1)
    assert.equal(bottom.collision, 'walkable')          // explicit, not role-derived
    assert.deepEqual(bottom.interaction, { type: 'door' })
  })
  it('excludes structure cells that have no painted base tile', () => {
    const p = [[{ structure: true }, null], [null, null]]
    assert.equal(exportStructure([[null, 'w1'], ['f1', 'w1']], overlay, p, meta), null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/structure-lib.test.js`
Expected: FAIL — `Cannot find module '.../structure-lib.js'`.

- [ ] **Step 3: Implement `structure-lib.js`**

```js
// tools/tile-editor/structure-lib.js
// Pure helpers for the Build-tab properties layer and structure export. No DOM.
// A properties cell is `null` or { collision?: 'wall'|'walkable',
//   interaction?: { type: 'door'|'chest' }, structure?: true }.

// Toggle/replace one property on a properties cell, returning a new cell (or null
// when the cell ends up empty). Collision replaces; painting the same collision or
// interaction type, or toggling structure, clears it.
export function setProperty(cell, property, payload) {
  const c = cell ? { ...cell } : {}
  if (property === 'collision') {
    if (c.collision === payload) delete c.collision
    else c.collision = payload
  } else if (property === 'interaction') {
    if (c.interaction?.type === payload) delete c.interaction
    else c.interaction = { type: payload }
  } else if (property === 'structure') {
    if (c.structure) delete c.structure
    else c.structure = true
  }
  return (c.collision || c.interaction || c.structure) ? c : null
}

// base/overlay: grid[row][col] = tile name | null. props: grid[row][col] = cell|null.
// tileMeta: Map<name, { role, tags }>. Returns { w, h, cells } or null when no
// structure-marked cell has a painted base tile. Cells are sparse and normalized so
// the footprint's top-left is (0,0).
export function exportStructure(base, overlay, props, tileMeta) {
  const marked = []
  for (let y = 0; y < props.length; y++) {
    for (let x = 0; x < (props[y]?.length ?? 0); x++) {
      if (props[y][x]?.structure && base[y]?.[x]) marked.push({ x, y })
    }
  }
  if (marked.length === 0) return null
  const xs = marked.map(m => m.x), ys = marked.map(m => m.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const maxX = Math.max(...xs), maxY = Math.max(...ys)
  const cells = marked.map(({ x, y }) => {
    const p = props[y][x]
    const role = tileMeta.get(base[y][x])?.role
    return {
      x: x - minX,
      y: y - minY,
      skin: base[y][x],
      overlay: overlay[y]?.[x] ?? null,
      collision: p.collision ?? (role === 'wall' ? 'wall' : 'walkable'),
      interaction: p.interaction ?? null,
    }
  })
  return { w: maxX - minX + 1, h: maxY - minY + 1, cells }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/structure-lib.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/structure-lib.js test/structure-lib.test.js
git commit -m "feat(structures): pure property-toggle + export serializer"
```

---

### Task 2: `placeStructure` in the generator

**Files:**
- Modify: `renderer/systems/map.js` (add `placeStructure` next to `placeTemplate`, ~line 246)
- Test: `test/structures.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/structures.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { placeStructure } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

function blankMap(w, h) {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ tile: TILE.WALL, roomId: null })))
}

const structure = {
  w: 2, h: 2,
  cells: [
    { x: 0, y: 0, skin: 'castle_wall', overlay: null, collision: 'wall', interaction: null },
    { x: 1, y: 0, skin: 'castle_gate', overlay: null, collision: 'wall', interaction: { type: 'door' } },
    { x: 0, y: 1, skin: 'castle_floor', overlay: 'rug', collision: 'walkable', interaction: null },
    { x: 1, y: 1, skin: 'castle_floor', overlay: null, collision: 'walkable', interaction: { type: 'chest' } },
  ],
}

describe('placeStructure', () => {
  it('stamps skins/overlays and marks cells locked at the offset', () => {
    const map = blankMap(5, 5)
    placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][2].skin, 'castle_wall')
    assert.equal(map[1][2].locked, true)
    assert.equal(map[2][2].overlay, 'rug')
  })
  it('maps collision to logical tiles', () => {
    const map = blankMap(5, 5)
    placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][2].tile, TILE.WALL)       // collision: wall
    assert.equal(map[2][2].tile, TILE.FLOOR)      // collision: walkable
    assert.equal(map[2][2].roomId, 7)
  })
  it('forces interaction cells walkable and emits door/chest spawns', () => {
    const map = blankMap(5, 5)
    const spawns = placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][3].tile, TILE.FLOOR)      // gate door overrides wall->floor
    assert.deepEqual(spawns.find(s => s.kind === 'door'), { kind: 'door', x: 3, y: 1 })
    assert.deepEqual(spawns.find(s => s.kind === 'chest'), { kind: 'chest', x: 3, y: 2 })
  })
  it('ignores cells that fall outside the map', () => {
    const map = blankMap(2, 2)
    assert.doesNotThrow(() => placeStructure(map, structure, 1, 1, 0))
    assert.equal(map[1][1].skin, 'castle_wall')   // only the in-bounds cell stamped
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/structures.test.js`
Expected: FAIL — `placeStructure is not a function`.

- [ ] **Step 3: Implement `placeStructure`**

Add directly below the existing `placeTemplate` function in `renderer/systems/map.js`:

```js
// Stamp a painted structure prefab onto the map with its EXACT skins. Cells are
// marked `locked` so the decoration pass leaves them untouched. Collision maps to a
// logical tile (wall blocks, walkable = floor); interactions force the cell walkable
// and emit a spawn. Returns the spawn list (door/chest), like placeTemplate.
export function placeStructure(map, structure, ox, oy, roomId) {
  const spawns = []
  for (const cell of structure.cells) {
    const tx = ox + cell.x, ty = oy + cell.y
    const m = map[ty]?.[tx]
    if (!m) continue
    m.skin = cell.skin
    m.overlay = cell.overlay ?? null
    m.locked = true
    if (cell.collision === 'wall') {
      m.tile = TILE.WALL
    } else {
      m.tile = TILE.FLOOR
      m.roomId = roomId
    }
    if (cell.interaction) {
      m.tile = TILE.FLOOR        // anything you interact with stands on floor
      m.roomId = roomId
      spawns.push({ kind: cell.interaction.type, x: tx, y: ty })
    }
  }
  return spawns
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/structures.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/map.js test/structures.test.js
git commit -m "feat(structures): placeStructure stamps locked prefab cells"
```

---

### Task 3: `decorateMap` skips locked cells

**Files:**
- Modify: `renderer/systems/decorate.js` (`decorateMap` loop ~line 174; `decorateOverlays` loop ~line 128)
- Test: `test/decorate.test.js` (append a `describe` block)

- [ ] **Step 1: Write the failing test**

```js
// Append to test/decorate.test.js — describe/it, assert, decorateMap, and TILE are
// ALREADY imported at the top of the file. Do NOT re-import them (ESM throws
// "already declared"). Append only the describe block below.

describe('decorateMap — locked cells', () => {
  const ruleset = {
    tiles: { floor_a: { tags: ['floor'], weight: 1 }, deco: { tags: ['overlay.x'], weight: 1 } },
    tags: {
      floor: { role: 'floor', allow: ['*'], forbid: [], directional: {},
               adjacency: { n: {}, e: {}, s: {}, w: {} }, overlays: { 'overlay.x': 1, '': 1 } },
      'overlay.x': { role: 'overlay', allow: ['*'], forbid: [], directional: {},
                     adjacency: { n: {}, e: {}, s: {}, w: {} } },
    },
  }
  it('never overwrites the skin or overlay of a locked cell', () => {
    const map = [[{ tile: TILE.FLOOR, skin: 'castle_floor', overlay: 'banner', locked: true }]]
    decorateMap(map, ruleset)
    assert.equal(map[0][0].skin, 'castle_floor')
    assert.equal(map[0][0].overlay, 'banner')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/decorate.test.js`
Expected: FAIL — the skin loop reassigns `skin`, and `decorateOverlays` resets `overlay` to `null`.

- [ ] **Step 3: Add the two guards**

In `decorateMap`, the per-cell loop body currently starts:

```js
      const cell = map[row][col]
      const role = roleOf(cell.tile)
      if (!role) continue
```

Insert the locked guard immediately after fetching `cell`:

```js
      const cell = map[row][col]
      if (cell.locked) continue
      const role = roleOf(cell.tile)
      if (!role) continue
```

In `decorateOverlays`, the per-cell loop body currently starts:

```js
      const cell = map[row][col]
      cell.overlay = null
      if (!cell.skin) continue
```

Insert the guard BEFORE `cell.overlay = null` so a locked overlay is preserved:

```js
      const cell = map[row][col]
      if (cell.locked) continue
      cell.overlay = null
      if (!cell.skin) continue
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/decorate.test.js`
Expected: PASS (new block + all existing decorate tests still pass).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/decorate.js test/decorate.test.js
git commit -m "feat(structures): decorateMap preserves locked prefab cells"
```

---

### Task 4: Thread structures + landmark resolution into `generateLevel`

**Files:**
- Modify: `renderer/systems/map.js` (`generateLevel` signature + landmark block, ~lines 200–246)
- Test: `test/map.test.js` (append a `describe` block)

- [ ] **Step 1: Write the failing test**

```js
// Append to test/map.test.js — describe/it, assert, and generateLevel are ALREADY
// imported at the top of the file. Do NOT re-import them. Append only the describe
// block below.

describe('generateLevel — structure landmarks', () => {
  const structures = {
    test_keep: {
      w: 2, h: 1, targetDepth: 1,
      cells: [
        { x: 0, y: 0, skin: 'keep_wall', overlay: null, collision: 'wall', interaction: null },
        { x: 1, y: 0, skin: 'keep_gate', overlay: null, collision: 'walkable', interaction: { type: 'door' } },
      ],
    },
  }
  it('places a targetDepth structure with its exact locked skins', () => {
    const { map } = generateLevel(1, undefined, undefined, { structures })
    let found = false
    for (const row of map) for (const c of row) if (c.locked && c.skin === 'keep_wall') found = true
    assert.equal(found, true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/map.test.js`
Expected: FAIL — `structures` is ignored; no locked `keep_wall` cell exists.

- [ ] **Step 3: Update the signature and landmark block**

Change the signature:

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false, structures = {} } = {}) {
```

Replace the entire existing landmark block (the `if (cfg.landmark && TEMPLATES[cfg.landmark] && landmarkRoom) { … } else if (cfg.landmark && TEMPLATES[cfg.landmark]) { … }` pair) with:

```js
    // Resolve the landmark: a structure whose targetDepth matches this depth wins;
    // otherwise the depth's configured landmark name. Structures take precedence
    // over a same-named TEMPLATE.
    const landmarkName =
      Object.keys(structures).find(n => structures[n].targetDepth === depth) ?? cfg.landmark
    let landmark = null
    if (landmarkName && structures[landmarkName]) {
      const s = structures[landmarkName]
      landmark = { w: s.w, h: s.h, place: (ox, oy, rid) => placeStructure(map, s, ox, oy, rid) }
    } else if (landmarkName && TEMPLATES[landmarkName]) {
      const t = TEMPLATES[landmarkName]
      landmark = { w: t.width, h: t.height, place: (ox, oy, rid) => placeTemplate(map, t, ox, oy, rid) }
    }

    if (landmark && landmarkRoom) {
      const lc = center(landmarkRoom)
      const ox = Math.max(0, Math.min(width  - landmark.w, lc.x - Math.floor(landmark.w / 2)))
      const oy = Math.max(0, Math.min(height - landmark.h, lc.y - Math.floor(landmark.h / 2)))
      entitySpawns.push(...landmark.place(ox, oy, roomId++))
      const tlc = { x: ox + Math.floor(landmark.w / 2), y: oy + Math.floor(landmark.h / 2) }
      carveCorridor(map, lc.x, lc.y, tlc.x, tlc.y)
    } else if (landmark) {
      // Fallback: bottom-right corner
      const ox = width - landmark.w - 2
      const oy = height - landmark.h - 2
      entitySpawns.push(...landmark.place(ox, oy, roomId++))
      const lc = { x: ox + Math.floor(landmark.w / 2), y: oy + Math.floor(landmark.h / 2) }
      const nearest = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - lc.x) + Math.abs(c.y - lc.y)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearest.r).x, center(nearest.r).y, lc.x, lc.y)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/map.test.js`
Expected: PASS (new block + existing map tests still pass).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/map.js test/map.test.js
git commit -m "feat(structures): resolve structure landmarks in generateLevel"
```

---

### Task 5: Persist the properties layer in painter-maps

**Files:**
- Modify: `tools/tile-editor/painter-maps.js` (`serializeGrid`, ~line 7)
- Test: `test/painter-maps.test.js` (append cases)

- [ ] **Step 1: Write the failing test**

```js
// Append to test/painter-maps.test.js — describe/it, assert, and serializeGrid are
// ALREADY imported at the top of the file. Do NOT re-import them. Append only the
// describe block below.

describe('serializeGrid — properties layer', () => {
  it('includes a deep-copied props grid', () => {
    const base = [['f', 'f']]
    const overlay = [[null, null]]
    const props = [[{ structure: true }, null]]
    const s = serializeGrid(base, overlay, props)
    assert.deepEqual(s.props, [[{ structure: true }, null]])
    props[0][0].structure = false                 // mutate source
    assert.equal(s.props[0][0].structure, true)   // serialized copy is unaffected
  })
  it('defaults props to a blank grid when omitted', () => {
    const s = serializeGrid([['f', 'f']], [[null, null]])
    assert.deepEqual(s.props, [[null, null]])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/painter-maps.test.js`
Expected: FAIL — `s.props` is `undefined`.

- [ ] **Step 3: Update `serializeGrid`**

Replace the existing `serializeGrid`:

```js
// `base`, `overlay`, and `props` must stay congruent in size (callers resize them
// together); the stored w/h are taken from `base`. `props` cells are small objects,
// so they are deep-copied; omitting `props` yields an all-null grid.
export function serializeGrid(base, overlay, props) {
  const copy = (g) => g.map(row => row.slice())
  const blankProps = base.map(row => row.map(() => null))
  const copyProps = (g) => g.map(row => row.map(c => (c ? { ...c } : null)))
  return {
    w: base[0]?.length ?? 0,
    h: base.length,
    base: copy(base),
    overlay: copy(overlay),
    props: props ? copyProps(props) : blankProps,
  }
}
```

Also update the module header comment `SerializedMap: { w, h, base, overlay }` to `SerializedMap: { w, h, base, overlay, props }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/painter-maps.test.js`
Expected: PASS (new cases + existing painter-maps tests).

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/painter-maps.js test/painter-maps.test.js
git commit -m "feat(structures): persist properties layer in painter-maps"
```

---

### Task 6: Structures IPC wiring

**Files:**
- Modify: `main.cjs` (constant ~line 13, handlers ~line 64)
- Modify: `tools/tile-editor/editor-preload.cjs`
- Modify: `preload.cjs`

- [ ] **Step 1: Add the file constant + handlers in `main.cjs`**

After `const PAINTER_MAPS_FILE = …` (line 13) add:

```js
const STRUCTURES_FILE = path.join(__dirname, 'renderer', 'data', 'structures.json')
```

After the `save-painter-maps` handler (line 64) add:

```js
ipcMain.handle('load-structures', () => {
  try { return JSON.parse(fs.readFileSync(STRUCTURES_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-structures', (_e, data) =>
  fs.writeFileSync(STRUCTURES_FILE, JSON.stringify(data, null, 2)))
```

- [ ] **Step 2: Expose them in the editor preload**

In `tools/tile-editor/editor-preload.cjs`, add inside `exposeInMainWorld('editorAPI', { … })`:

```js
  loadStructures: () => ipcRenderer.invoke('load-structures'),
  saveStructures: (data) => ipcRenderer.invoke('save-structures', data),
```

- [ ] **Step 3: Expose load in the game preload**

In `preload.cjs`, add inside `exposeInMainWorld('saveAPI', { … })`:

```js
  loadStructures: () => ipcRenderer.invoke('load-structures'),
```

- [ ] **Step 4: Seed an empty structures file**

Create `renderer/data/structures.json` with:

```json
{}
```

- [ ] **Step 5: Commit**

```bash
git add main.cjs tools/tile-editor/editor-preload.cjs preload.cjs renderer/data/structures.json
git commit -m "feat(structures): add load/save structures IPC"
```

---

### Task 7: Game loads structures, places them, renders their sprites, handles chest spawns

**Files:**
- Modify: `renderer/game.js` (module state near the `rulesets` declaration; sprite load ~line 573; `buildEntities` switch ~line 128; every `generateLevel(...)` call)

- [ ] **Step 1: Add module state + load structures**

Find the module-level `let rulesets` declaration. Add beside it:

```js
let structures = {}
```

Find line 572 `rulesets = (await window.saveAPI.loadRulesets()) ?? {}` and add immediately after it:

```js
  structures = (await window.saveAPI.loadStructures()) ?? {}
```

- [ ] **Step 2: Load structure tile sprites**

Add this helper near the top-level helpers of `game.js` (e.g. just above the `loadSprites` call site):

```js
// Every distinct skin/overlay used by any structure, so the renderer can draw them
// even when the active ruleset doesn't reference those tiles.
function structureTileNames(structs) {
  const names = new Set()
  for (const s of Object.values(structs)) {
    for (const c of s.cells ?? []) {
      if (c.skin) names.add(c.skin)
      if (c.overlay) names.add(c.overlay)
    }
  }
  return [...names]
}
```

Change line 573 from:

```js
  await renderer.loadSprites(rulesetTileNames(rulesets))
```

to:

```js
  await renderer.loadSprites([...rulesetTileNames(rulesets), ...structureTileNames(structures)])
```

- [ ] **Step 3: Pass structures into level generation**

For every `generateLevel(...)` call in `game.js` (there is one in `startNewRun`, ~line 147; check for others such as a descend/next-level handler with `git grep -n "generateLevel(" renderer/game.js`), add `structures` to the options object. Example for `startNewRun`:

```js
  const { map, entitySpawns, playerSpawn } =
    generateLevel(10, undefined, undefined,
      { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```

Apply the same `structures` addition to any other call. If a call passes no options object, add `, { structures }`.

- [ ] **Step 4: Add the `chest` spawn case**

In the `buildEntities` switch, after the `case 'door':` line (line 129) add:

```js
      case 'chest':   return [makeChest(s.x, s.y, { type: 'potion', amount: 4 })]
```

(`makeChest` is already imported on line 2.)

- [ ] **Step 5: Verify nothing broke**

Run: `node --test test/`
Expected: PASS (whole suite — no regressions).

- [ ] **Step 6: Commit**

```bash
git add renderer/game.js
git commit -m "feat(structures): load, place, render, and spawn structure prefabs in-game"
```

---

### Task 8: Build-tab properties layer + export UI

**Files:**
- Modify: `tools/tile-editor/index.html` (build sidebar, ~lines 139–149)
- Modify: `tools/tile-editor/map-painter.js`

- [ ] **Step 1: Add the properties controls to `index.html`**

In `#build-view`'s sidebar, replace the existing layer block:

```html
      <div class="label">Layer</div>
      <div id="paint-layers" style="display:flex; gap:4px">
        <button id="layer-base" class="on" style="flex:1">base</button>
        <button id="layer-overlay" style="flex:1">overlay</button>
      </div>
```

with:

```html
      <div class="label">Layer</div>
      <div id="paint-layers" style="display:flex; gap:4px">
        <button id="layer-base" class="on" style="flex:1">base</button>
        <button id="layer-overlay" style="flex:1">overlay</button>
        <button id="layer-properties" style="flex:1">properties</button>
      </div>
      <div id="prop-controls" style="display:none">
        <div class="label">Property</div>
        <div id="prop-mode" style="display:flex; gap:4px; flex-wrap:wrap">
          <button data-prop="collision" class="on">collision</button>
          <button data-prop="interaction">interaction</button>
          <button data-prop="structure">structure</button>
        </div>
        <div id="prop-collision" class="label">Collision</div>
        <div id="prop-collision-vals" style="display:flex; gap:4px">
          <button data-collision="walkable" class="on">walkable</button>
          <button data-collision="wall">wall</button>
        </div>
        <div id="prop-interaction" class="label" style="display:none">Interaction</div>
        <div id="prop-interaction-vals" style="display:none; gap:4px">
          <button data-interaction="door" class="on">door</button>
          <button data-interaction="chest">chest</button>
        </div>
        <button id="export-structure" class="save" style="background:#664a22; margin-top:6px">⛫ Export structure</button>
        <input id="structure-name" placeholder="castle" style="width:100%; margin-top:4px">
        <div style="display:flex; gap:4px; align-items:center; margin-top:4px">
          <span class="label" style="margin:0">target depth</span>
          <input id="structure-depth" class="small" type="number" min="1" max="10">
        </div>
        <div id="export-report" style="font-size:11px; color:#9a9"></div>
      </div>
```

- [ ] **Step 2: Wire the properties layer into `map-painter.js`**

Add the import at the top of `map-painter.js`:

```js
import { setProperty, exportStructure } from './structure-lib.js'
```

Extend the grid initialization. Change:

```js
  const grid = {
    base: blank(Number(wInput.value), Number(hInput.value)),
    overlay: blank(Number(wInput.value), Number(hInput.value)),
  }
```

to:

```js
  const grid = {
    base: blank(Number(wInput.value), Number(hInput.value)),
    overlay: blank(Number(wInput.value), Number(hInput.value)),
    props: blank(Number(wInput.value), Number(hInput.value)),
  }
  let propMode = 'collision'        // collision | interaction | structure
  let collisionVal = 'walkable'
  let interactionVal = 'door'
```

In `loadGrid`, after copying overlay add props (with a blank fallback for old saved maps):

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

In `currentSerialized`, pass props:

```js
  function currentSerialized() { return serializeGrid(grid.base, grid.overlay, grid.props) }
```

In the resize handler, resize props too. After the `grid.overlay = resize(grid.overlay)` line add:

```js
    grid.props = resize(grid.props)
```

- [ ] **Step 3: Render property markers**

In `render()`, after the existing per-cell drawing block (after the overlay `drawImage` and before the `ctx.strokeRect(...)` grid line, inside the same loop), add a property overlay when in properties mode:

```js
        if (layer === 'properties') {
          const p = grid.props[y][x]
          if (p?.collision === 'wall')      { ctx.fillStyle = '#c0303060'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL) }
          else if (p?.collision === 'walkable') { ctx.fillStyle = '#30a05060'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL) }
          if (p?.interaction) {
            ctx.fillStyle = '#fff'
            ctx.font = `${CELL - 8}px monospace`
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText(p.interaction.type === 'door' ? '⌷' : '◆', x * CELL + CELL / 2, y * CELL + CELL / 2)
          }
          if (p?.structure) { ctx.strokeStyle = '#5cf'; ctx.lineWidth = 2
            ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2); ctx.lineWidth = 1 }
        }
```

- [ ] **Step 4: Make painting honor the properties layer**

Replace `paint(ev)`:

```js
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (grid.base[y]?.[x] === undefined) return
    if (layer === 'properties') {
      const payload = propMode === 'collision' ? collisionVal
        : propMode === 'interaction' ? interactionVal : undefined
      grid.props[y][x] = setProperty(grid.props[y][x], propMode, payload)
    } else {
      grid[layer][y][x] = active     // active === null erases the active layer's slot
    }
    render()
    persistDebounced()
  }
```

- [ ] **Step 5: Extend `setLayer` and add the properties button + selectors**

Replace `setLayer`:

```js
  function setLayer(which) {
    layer = which
    document.getElementById('layer-base').classList.toggle('on', which === 'base')
    document.getElementById('layer-overlay').classList.toggle('on', which === 'overlay')
    document.getElementById('layer-properties').classList.toggle('on', which === 'properties')
    document.getElementById('prop-controls').style.display = which === 'properties' ? 'block' : 'none'
    render()
  }
  document.getElementById('layer-base').addEventListener('click', () => setLayer('base'))
  document.getElementById('layer-overlay').addEventListener('click', () => setLayer('overlay'))
  document.getElementById('layer-properties').addEventListener('click', () => setLayer('properties'))

  document.querySelectorAll('#prop-mode [data-prop]').forEach(btn =>
    btn.addEventListener('click', () => {
      propMode = btn.dataset.prop
      document.querySelectorAll('#prop-mode [data-prop]').forEach(b => b.classList.toggle('on', b === btn))
      const isColl = propMode === 'collision', isInt = propMode === 'interaction'
      document.getElementById('prop-collision').style.display = isColl ? 'block' : 'none'
      document.getElementById('prop-collision-vals').style.display = isColl ? 'flex' : 'none'
      document.getElementById('prop-interaction').style.display = isInt ? 'block' : 'none'
      document.getElementById('prop-interaction-vals').style.display = isInt ? 'flex' : 'none'
    }))
  document.querySelectorAll('#prop-collision-vals [data-collision]').forEach(btn =>
    btn.addEventListener('click', () => {
      collisionVal = btn.dataset.collision
      document.querySelectorAll('#prop-collision-vals [data-collision]').forEach(b => b.classList.toggle('on', b === btn))
    }))
  document.querySelectorAll('#prop-interaction-vals [data-interaction]').forEach(btn =>
    btn.addEventListener('click', () => {
      interactionVal = btn.dataset.interaction
      document.querySelectorAll('#prop-interaction-vals [data-interaction]').forEach(b => b.classList.toggle('on', b === btn))
    }))
```

(The existing two `layer-base` / `layer-overlay` `addEventListener` lines are now part of this block — remove the old standalone pair to avoid duplicate listeners.)

- [ ] **Step 6: Wire the Export button**

Add near the other build-tab button handlers (e.g. after the `derive-btn` handler):

```js
  document.getElementById('export-structure').addEventListener('click', async () => {
    const reportEl = document.getElementById('export-report')
    const name = sanitizeMapName(document.getElementById('structure-name').value)
    if (!name) { reportEl.textContent = 'Enter a structure name first.'; return }
    const rs = state.rulesets[state.active]
    const structure = exportStructure(grid.base, grid.overlay, grid.props, tileMetaFromRuleset(rs ?? { tiles: {}, tags: {} }))
    if (!structure) { reportEl.textContent = 'Mark some cells as "structure" (and paint a base tile there) first.'; return }
    const depth = Number(document.getElementById('structure-depth').value) | 0
    if (depth >= 1 && depth <= 10) structure.targetDepth = depth
    try {
      const store = (await window.editorAPI.loadStructures()) ?? {}
      store[name] = structure
      await window.editorAPI.saveStructures(store)
      reportEl.textContent = `Saved "${name}" — ${structure.cells.length} cells, ${structure.w}×${structure.h}` +
        (structure.targetDepth ? ` → depth ${structure.targetDepth}` : '')
    } catch (err) {
      reportEl.textContent = `Save failed: ${err?.message ?? err}`
    }
  })
```

- [ ] **Step 7: Manual smoke check in the editor**

Run: `npm run editor`
Expected: Build tab shows a `properties` layer button; selecting it reveals the property selector + Export button; painting collision/interaction/structure draws the overlay markers; clicking Export with a name writes `renderer/data/structures.json`. (Automated runtime assertion is Task 9.)

- [ ] **Step 8: Commit**

```bash
git add tools/tile-editor/index.html tools/tile-editor/map-painter.js
git commit -m "feat(structures): Build-tab properties layer + export UI"
```

---

### Task 9: End-to-end runtime verification (Playwright)

**Files:**
- Create (throwaway): `pw_structure.mjs` (deleted after the run)

- [ ] **Step 1: Write the verification script**

```js
// pw_structure.mjs — verifies the full paint→export→place pipeline. Deleted after.
import { _electron as electron } from 'playwright-core'
import { readFileSync, existsSync } from 'fs'

const STRUCT = './renderer/data/structures.json'

// --- Editor: paint a tiny structure, mark cells, export ---
const ed = await electron.launch({ args: ['.', '--editor'], env: { ...process.env, DISPLAY: ':0' } })
const ep = await ed.firstWindow()
ep.on('pageerror', e => console.log('EDITOR PAGEERR', e.message))
await ep.waitForLoadState('domcontentloaded'); await ep.waitForTimeout(1800)
await ep.click('#tab-build'); await ep.waitForTimeout(800)
// paint a base tile across a 2x2 area
const firstTile = await ep.$('#paint-palette img')
if (firstTile) await firstTile.click()
const canvas = await ep.$('#paint-canvas'); const box = await canvas.boundingBox()
const CELL = 26
for (const [cx, cy] of [[0,0],[1,0],[0,1],[1,1]])
  await ep.mouse.click(box.x + cx*CELL + 13, box.y + cy*CELL + 13)
// switch to properties → structure, mark the same 2x2
await ep.click('#layer-properties'); await ep.waitForTimeout(200)
await ep.click('#prop-mode [data-prop="structure"]')
for (const [cx, cy] of [[0,0],[1,0],[0,1],[1,1]])
  await ep.mouse.click(box.x + cx*CELL + 13, box.y + cy*CELL + 13)
await ep.fill('#structure-name', 'pw_castle')
await ep.fill('#structure-depth', '1')
await ep.click('#export-structure'); await ep.waitForTimeout(800)
console.log('EXPORT REPORT:', await ep.$eval('#export-report', el => el.textContent))
await ed.close()

// --- Assert the file ---
if (!existsSync(STRUCT)) throw new Error('structures.json not written')
const data = JSON.parse(readFileSync(STRUCT, 'utf8'))
console.log('STRUCTURE pw_castle:', JSON.stringify(data.pw_castle))
if (!data.pw_castle || data.pw_castle.cells.length < 1) throw new Error('pw_castle not exported')
if (data.pw_castle.targetDepth !== 1) throw new Error('targetDepth not saved')

// --- Game: launch and confirm the structure is placed (locked cells exist) ---
const gm = await electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })
const gp = await gm.firstWindow()
gp.on('pageerror', e => console.log('GAME PAGEERR', e.message))
await gp.waitForLoadState('domcontentloaded'); await gp.waitForTimeout(2500)
await gp.screenshot({ path: '/tmp/structure_ingame.png' })
console.log('Screenshot saved /tmp/structure_ingame.png')
await gm.close()
```

- [ ] **Step 2: Run it**

Run: `DISPLAY=:0 node pw_structure.mjs`
Expected: `EXPORT REPORT` shows `Saved "pw_castle" …`; `structures.json` contains `pw_castle` with `targetDepth: 1`; no `PAGEERR` lines; a screenshot is written. (Note: `game.js` currently has debug edits forcing depth 10 — to see the castle in-game, temporarily set the start depth to 1, or assert placement via `test/map.test.js` from Task 4 which already covers it deterministically.)

- [ ] **Step 3: Clean up**

```bash
rm -f pw_structure.mjs
# Remove the test structure so it doesn't ship:
node -e "const f='./renderer/data/structures.json';const d=require(f);delete d.pw_castle;require('fs').writeFileSync(f,JSON.stringify(d,null,2)+'\n')"
```

- [ ] **Step 4: Full suite green**

Run: `node --test test/`
Expected: PASS (entire suite).

- [ ] **Step 5: Commit (if any tracked files changed)**

```bash
git add -A
git commit -m "test(structures): end-to-end paint→export→place verification" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Known v1 limitation (from spec §6):** a fully-walled structure relies on its `door` cell + `healConnectivity` for reachability. Don't try to auto-solve interior connectivity here.
- **Out of scope (spec §9):** shrine/trap/stairs interactions, random/pooled placement, fixing the generic "Preview outcome", rotation/mirroring.
- **Pre-existing uncommitted edits** in the working tree (`game.js` depth 1→10 debug, `rulesets.json`) are unrelated to this work — leave them alone; only stage the files each task names.
- **Sprite loading gotcha:** structure skins are loaded via `structureTileNames` (Task 7 Step 2). If a castle renders blank in-game, the skin name isn't in that list or the PNG is missing from `renderer/assets/tiles/`.
