# Overlay Assets (Paint-Derived Props) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an overlay layer to the map painter so transparent-background prop tiles can be placed on top of base tiles, with placement rules (base-conditional density + overlay adjacency) derived from the painting and rendered in-game, replacing the random prop scatter for themed levels.

**Architecture:** Extend the pure `deriveRules` to take both a base grid and an overlay grid, learning per-base-tag overlay density (incl. an `""`-empty key) and per-overlay-tag adjacency. A second pass in `decorateMap` places `cell.overlay` using the existing soft `adjacencyScore` model with a synthetic "none" candidate. The renderer draws `cell.overlay` over the base/skin. The painter gains a Base/Overlay layer toggle.

**Tech Stack:** Vanilla ES modules + Canvas (renderer & editor), `node --test`.

---

## File Structure

**Game / shared (under test):**
- Modify `renderer/systems/decorate.js` — `rulesetHasOverlays`; overlay pass in `decorateMap`.
- Modify `renderer/render/canvas.js` — export `drawTile`; draw `cell.overlay` over base.
- Modify `renderer/systems/map.js` — `generateLevel` gains a `{ skipProps }` option guarding the random scatter.
- Modify `renderer/game.js` — compute `skipProps` from the ruleset; pass it; import `rulesetHasOverlays`.

**Editor:**
- Modify `tools/tile-editor/derive-rules.js` — two-layer `deriveRules(baseGrid, overlayGrid, tileMeta)`.
- Modify `tools/tile-editor/map-painter.js` — two-layer grid, Base/Overlay toggle, overlay tagging role, derive both layers, merge overlays, composited render.
- Modify `tools/tile-editor/sample-preview.js` — draw `cell.overlay` in the preview.
- Modify `tools/tile-editor/index.html` — layer-toggle markup.

**Tests:**
- Modify `test/derive-rules.test.js` — new signature + overlay derivation.
- Modify `test/decorate.test.js` — overlay pass + `rulesetHasOverlays`.
- Modify `test/map.test.js` — `generateLevel` skipProps.
- Create `test/canvas.test.js` — `drawTile` overlay draw order.

---

## Task 1: Two-layer `deriveRules`

Generalize the pure derivation to base + overlay layers. **Breaking signature change** — update the existing tests in the same task.

**Files:**
- Modify: `tools/tile-editor/derive-rules.js`
- Test: `test/derive-rules.test.js`

- [ ] **Step 1: Replace the test file**

Overwrite `test/derive-rules.test.js` with (existing base tests adapted to the 3-arg signature via an all-null overlay grid, plus new overlay tests):

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRules } from '../tools/tile-editor/derive-rules.js'

// tileMeta: name -> { role, tags }
const META = new Map([
  ['m1', { role: 'floor',   tags: ['floor.moss'] }],
  ['m2', { role: 'floor',   tags: ['floor.moss'] }],
  ['pl', { role: 'floor',   tags: ['floor.plain'] }],
  ['wl', { role: 'wall',    tags: ['wall.base'] }],
  ['br', { role: 'overlay', tags: ['overlay.barrel'] }],
  ['gr', { role: 'overlay', tags: ['overlay.grave'] }],
])

// all-null overlay grid matching base dims
const empty = (g) => g.map(r => r.map(() => null))

describe('deriveRules — base layer', () => {
  it('counts per-tile weights from occurrences', () => {
    const base = [['m1', 'm1', 'pl']]
    const { tiles } = deriveRules(base, empty(base), META)
    assert.deepEqual(tiles.m1, { tags: ['floor.moss'], weight: 2 })
    assert.deepEqual(tiles.pl, { tags: ['floor.plain'], weight: 1 })
  })

  it('accumulates directional adjacency between base tags', () => {
    const base = [['m1', 'pl']]
    const { tags } = deriveRules(base, empty(base), META)
    assert.equal(tags['floor.moss'].adjacency.e['floor.plain'], 1)
    assert.equal(tags['floor.plain'].adjacency.w['floor.moss'], 1)
    assert.deepEqual(tags['floor.moss'].adjacency.n, {})
  })

  it('emits permissive tag defaults with role from tile meta', () => {
    const base = [['wl']]
    const { tags } = deriveRules(base, empty(base), META)
    assert.equal(tags['wall.base'].role, 'wall')
    assert.deepEqual(tags['wall.base'].allow, ['*'])
    assert.deepEqual(tags['wall.base'].forbid, [])
    assert.deepEqual(tags['wall.base'].directional, {})
  })

  it('skips untagged base cells and counts them', () => {
    const base = [['m1', 'ghost', null]]
    const { tiles, skipped } = deriveRules(base, empty(base), META)
    assert.equal(skipped, 1)
    assert.equal(tiles.ghost, undefined)
  })

  it('returns empty fragment for an empty grid', () => {
    assert.deepEqual(deriveRules([[null, null]], [[null, null]], META), { tiles: {}, tags: {}, skipped: 0 })
  })

  it('treats tiles sharing a tag as one (generalization)', () => {
    const base = [['m1', 'wl'], ['m2', 'wl']]
    const { tags } = deriveRules(base, empty(base), META)
    assert.equal(tags['floor.moss'].adjacency.e['wall.base'], 2)
  })
})

describe('deriveRules — overlay layer', () => {
  it('registers overlay tiles + tags with role overlay and counts weights', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['br', 'br']]
    const { tiles, tags } = deriveRules(base, overlay, META)
    assert.deepEqual(tiles.br, { tags: ['overlay.barrel'], weight: 2 })
    assert.equal(tags['overlay.barrel'].role, 'overlay')
  })

  it('accumulates base-conditional overlay distribution including the empty key', () => {
    const base    = [['pl', 'pl', 'pl']]
    const overlay = [['br', null, null]]
    const { tags } = deriveRules(base, overlay, META)
    assert.deepEqual(tags['floor.plain'].overlays, { 'overlay.barrel': 1, '': 2 })
  })

  it('accumulates overlay-to-overlay adjacency from the overlay layer', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['br', 'br']]
    const { tags } = deriveRules(base, overlay, META)
    assert.equal(tags['overlay.barrel'].adjacency.e['overlay.barrel'], 1)
    assert.equal(tags['overlay.barrel'].adjacency.w['overlay.barrel'], 1)
  })

  it('skips untagged overlay cells and counts them (null is not skipped)', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['ghost', null]]
    const { skipped, tiles } = deriveRules(base, overlay, META)
    assert.equal(skipped, 1)
    assert.equal(tiles.ghost, undefined)
    // base cell under the untagged overlay still records an empty conditioning
    // (untagged overlay is treated as "no recognized overlay")
  })

  it('does not add an overlays distribution to overlay tags', () => {
    const base    = [['pl']]
    const overlay = [['br']]
    const { tags } = deriveRules(base, overlay, META)
    assert.equal(tags['overlay.barrel'].overlays, undefined)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern="deriveRules"`
Expected: FAIL — `deriveRules` currently takes 2 args; the new 3-arg calls and overlay assertions fail.

- [ ] **Step 3: Rewrite `derive-rules.js`**

Overwrite `tools/tile-editor/derive-rules.js`:

```js
// Pure: base + overlay painted grids + tile metadata → a ruleset fragment. No DOM.
// Each grid is grid[row][col] = tile name or null (empty); both share dimensions.
// tileMeta: Map<tileName, { role: 'floor'|'wall'|'overlay', tags: string[] }>.
// Returns { tiles, tags, skipped }:
//   tiles[name] = { tags, weight }
//   tags[tag]   = { role, allow:['*'], forbid:[], directional:{}, adjacency:{n,e,s,w} }
//                 base (floor/wall) tags additionally gain `overlays` (base-conditional
//                 distribution over overlay tags + '' = no overlay) during conditioning.
//   skipped     = count of placed-but-untagged cells across both layers.

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

// Weights + tag registration + same-layer directional adjacency. Mutates tiles/tags.
function accumulateLayer(grid, tileMeta, tiles, tags) {
  let skipped = 0
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
  return skipped
}

export function deriveRules(baseGrid, overlayGrid, tileMeta) {
  const tiles = {}
  const tags = {}
  let skipped = 0

  skipped += accumulateLayer(baseGrid, tileMeta, tiles, tags)
  skipped += accumulateLayer(overlayGrid, tileMeta, tiles, tags)

  // Base-conditional overlay distribution (incl. '' = no overlay) on base tags.
  for (let y = 0; y < baseGrid.length; y++) {
    for (let x = 0; x < baseGrid[y].length; x++) {
      const baseMeta = metaOf(tileMeta, baseGrid[y][x])
      if (!baseMeta) continue
      const ovMeta = metaOf(tileMeta, overlayGrid[y]?.[x])
      for (const B of baseMeta.tags) {
        const dist = (tags[B].overlays ??= {})
        if (ovMeta) for (const O of ovMeta.tags) dist[O] = (dist[O] ?? 0) + 1
        else dist[''] = (dist[''] ?? 0) + 1
      }
    }
  }

  return { tiles, tags, skipped }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern="deriveRules"`
Expected: PASS. Also run `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/derive-rules.js test/derive-rules.test.js
git commit -m "feat: two-layer deriveRules — base-conditional overlay density + overlay adjacency"
```

---

## Task 2: Overlay pass in `decorateMap`

**Files:**
- Modify: `renderer/systems/decorate.js`
- Test: `test/decorate.test.js`

- [ ] **Step 1: Write the failing tests**

Add `rulesetHasOverlays` to the import at the top of `test/decorate.test.js`:

```js
import { roleOf, tagsOf, pairAllowed, candidatesForRole, pickWeighted, decorateMap, pruneMissingTiles, adjacencyScore, pickByAdjacency, ADJACENCY_ALPHA, rulesetHasOverlays } from '../renderer/systems/decorate.js'
```

Append to the end of `test/decorate.test.js`:

```js
describe('rulesetHasOverlays', () => {
  it('true when a base tag has a non-empty overlay option', () => {
    assert.equal(rulesetHasOverlays({ tags: { b: { overlays: { '': 1, 'overlay.x': 2 } } } }), true)
  })
  it('false when only the empty key exists', () => {
    assert.equal(rulesetHasOverlays({ tags: { b: { overlays: { '': 5 } } } }), false)
  })
  it('false with no overlay data / no ruleset', () => {
    assert.equal(rulesetHasOverlays({ tags: { b: { role: 'floor' } } }), false)
    assert.equal(rulesetHasOverlays({}), false)
    assert.equal(rulesetHasOverlays(undefined), false)
  })
})

describe('overlay decoration pass', () => {
  const RS = {
    tiles: {
      fl: { tags: ['floor.plain'],   weight: 1 },
      br: { tags: ['overlay.barrel'], weight: 1 },
    },
    tags: {
      'floor.plain':   { role: 'floor',   allow: ['*'], overlays: { '': 0, 'overlay.barrel': 5 } },
      'overlay.barrel': { role: 'overlay', allow: ['*'], adjacency: { n: {}, e: {}, s: {}, w: {} } },
    },
  }

  it('places an overlay when the base demands it (empty weight 0)', () => {
    const map = makeCells(['.'])
    decorateMap(map, RS, mulberry32(1))
    assert.equal(map[0][0].skin, 'fl')
    assert.equal(map[0][0].overlay, 'br')
  })

  it('places no overlay when the empty key dominates', () => {
    const rs = structuredClone(RS)
    rs.tags['floor.plain'].overlays = { '': 999, 'overlay.barrel': 0 }
    const map = makeCells(['.'])
    decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].overlay, null)
  })

  it('leaves overlay undefined when the ruleset has no overlay data', () => {
    const rs = { tiles: { fl: { tags: ['floor.plain'], weight: 1 } }, tags: { 'floor.plain': { role: 'floor', allow: ['*'] } } }
    const map = makeCells(['.'])
    decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].overlay, undefined)
    assert.equal(map[0][0].skin, 'fl')   // base pass unaffected
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern="overlay decoration pass|rulesetHasOverlays"`
Expected: FAIL — `rulesetHasOverlays` not exported; `cell.overlay` not set.

- [ ] **Step 3: Implement in `decorate.js`**

In `renderer/systems/decorate.js`, add before `decorateMap`:

```js
// True when some base tag offers at least one real overlay (beyond '' = none).
export function rulesetHasOverlays(ruleset) {
  if (!ruleset?.tags) return false
  return Object.values(ruleset.tags).some(t =>
    t.overlays && Object.entries(t.overlays).some(([k, c]) => k !== '' && c > 0))
}

// Second decoration pass: assigns cell.overlay for floor/wall cells whose base
// skin's tag carries an `overlays` distribution. A synthetic "none" candidate
// (weighted by the '' empty count) competes with overlay tiles weighted by
// base-conditional frequency × tile weight × overlay-neighbor adjacency.
function decorateOverlays(map, ruleset, rng) {
  const overlayTilesByTag = {}
  for (const [name, def] of Object.entries(ruleset.tiles ?? {})) {
    for (const t of def.tags ?? []) {
      if (ruleset.tags[t]?.role === 'overlay') (overlayTilesByTag[t] ??= []).push(name)
    }
  }
  for (let row = 0; row < map.length; row++) {
    for (let col = 0; col < map[row].length; col++) {
      const cell = map[row][col]
      cell.overlay = null
      if (!cell.skin) continue
      let dist = null
      for (const bt of tagsOf(ruleset, cell.skin)) {
        if (ruleset.tags[bt]?.overlays) { dist = ruleset.tags[bt].overlays; break }
      }
      if (!dist) continue
      const neighbors = [
        { dir: 'n', skin: map[row - 1]?.[col]?.overlay },
        { dir: 'w', skin: map[row]?.[col - 1]?.overlay },
      ].filter(nb => nb.skin)
      const cands = []   // { name|null, weight }
      const noneW = dist[''] ?? 0
      if (noneW > 0) cands.push({ name: null, weight: noneW })
      for (const [tag, c] of Object.entries(dist)) {
        if (tag === '' || !(c > 0)) continue
        for (const name of overlayTilesByTag[tag] ?? []) {
          const w = (ruleset.tiles[name].weight ?? 1) * c * adjacencyScore(ruleset, name, neighbors)
          cands.push({ name, weight: w })
        }
      }
      const total = cands.reduce((s, c) => s + c.weight, 0)
      if (total <= 0) continue
      let r = rng() * total
      for (const c of cands) { r -= c.weight; if (r <= 0) { cell.overlay = c.name; break } }
    }
  }
}
```

Then in `decorateMap`, just before `return fallbacks`, add:

```js
  if (rulesetHasOverlays(ruleset)) decorateOverlays(map, ruleset, rng)
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern="overlay decoration pass|rulesetHasOverlays"`
Expected: PASS.

- [ ] **Step 5: Full suite — regression**

Run: `npm test`
Expected: all pass; existing `decorateMap` base tests unchanged (overlay pass only runs when `rulesetHasOverlays`).

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/decorate.js test/decorate.test.js
git commit -m "feat: overlay decoration pass + rulesetHasOverlays"
```

---

## Task 3: Render `cell.overlay` over the base

**Files:**
- Modify: `renderer/render/canvas.js`
- Test: `test/canvas.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/canvas.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drawTile } from '../renderer/render/canvas.js'
import { TILE } from '../renderer/systems/entities.js'

// Minimal ctx that records drawImage calls by the sprite passed in.
function recordingCtx() {
  const calls = []
  return {
    calls,
    drawImage: (img) => calls.push(img),
    fillRect: () => {},
    set fillStyle(_v) {},
    get fillStyle() { return '' },
  }
}

const SPR = { floor: 'FLOOR', fl: 'SKIN_FL', br: 'OVERLAY_BR' }

describe('drawTile overlay', () => {
  it('draws the overlay on top of the skin', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { skin: 'fl', overlay: 'br' })
    assert.deepEqual(ctx.calls, ['SKIN_FL', 'OVERLAY_BR'])
  })

  it('draws the overlay on top of the default tile sprite (no skin)', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { overlay: 'br' })
    assert.deepEqual(ctx.calls, ['FLOOR', 'OVERLAY_BR'])
  })

  it('draws no overlay when none is set', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { skin: 'fl' })
    assert.deepEqual(ctx.calls, ['SKIN_FL'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern="drawTile overlay"`
Expected: FAIL — `drawTile` is not exported.

- [ ] **Step 3: Implement in `canvas.js`**

In `renderer/render/canvas.js`:

(a) Change `function drawTile(...)` to `export function drawTile(...)`.

(b) Add this helper just above `drawTile`:

```js
function drawOverlay(ctx, tileObj, px, py, S, sprites) {
  if (tileObj?.overlay && sprites[tileObj.overlay]) {
    ctx.drawImage(sprites[tileObj.overlay], px, py, S, S)
  }
}
```

(c) In the skin branch, draw the overlay before returning. Change:

```js
  // Decoration-pass skin (only ever set on floor/wall cells)
  if (tileObj?.skin && sprites[tileObj.skin]) {
    ctx.drawImage(sprites[tileObj.skin], px, py, S, S)
    return
  }
```

to:

```js
  // Decoration-pass skin (only ever set on floor/wall cells)
  if (tileObj?.skin && sprites[tileObj.skin]) {
    ctx.drawImage(sprites[tileObj.skin], px, py, S, S)
    drawOverlay(ctx, tileObj, px, py, S, sprites)
    return
  }
```

(d) At the very END of `drawTile` (after the `if (tileId === TILE.STAIRS_DOWN && tileObj?.stairDepth > 0) { … }` block, before the closing `}` of the function), add:

```js
  drawOverlay(ctx, tileObj, px, py, S, sprites)
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern="drawTile overlay"`
Expected: PASS. Also `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js
git commit -m "feat: render cell.overlay over the base tile"
```

---

## Task 4: Game integration — skip random scatter for overlay rulesets

**Files:**
- Modify: `renderer/systems/map.js`, `renderer/game.js`
- Test: `test/map.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/map.test.js` (it already imports `generateLevel`):

```js
describe('generateLevel skipProps', () => {
  it('omits random prop spawns when skipProps is set', () => {
    for (let i = 0; i < 10; i++) {
      const { entitySpawns } = generateLevel(1, 80, 50, { skipProps: true })
      assert.equal(entitySpawns.filter(s => s.kind === 'prop').length, 0)
    }
  })

  it('still produces a connected map with skipProps', () => {
    const { map } = generateLevel(1, 80, 50, { skipProps: true })
    assert.equal(isFullyConnected(map), true)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --test-name-pattern="generateLevel skipProps"`
Expected: FAIL — the option is ignored, so props still spawn on some of the 10 runs.

- [ ] **Step 3: Add the `skipProps` option in `map.js`**

In `renderer/systems/map.js`, change the `generateLevel` signature (line 369):

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H) {
```

to:

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false } = {}) {
```

Then guard the scatter block (line 528). Change:

```js
    // Scatter props based on depth theme
    const roomProps = theme?.props?.room ?? []
    if (roomProps.length > 0) {
```

to:

```js
    // Scatter props based on depth theme (skipped when a ruleset places overlays)
    const roomProps = skipProps ? [] : (theme?.props?.room ?? [])
    if (roomProps.length > 0) {
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --test-name-pattern="generateLevel skipProps"`
Expected: PASS.

- [ ] **Step 5: Wire `game.js`**

In `renderer/game.js`:

(a) Change the decorate import (line 8) from:

```js
import { decorateMap, pruneMissingTiles } from './systems/decorate.js'
```

to:

```js
import { decorateMap, pruneMissingTiles, rulesetHasOverlays } from './systems/decorate.js'
```

(b) In `startNewRun` (around line 146), the current sequence is:

```js
  const { map, entitySpawns, playerSpawn } = generateLevel(1)
```
...(player setup)...
```js
  const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]
  decorateMap(map, rulesets[theme.ruleset])
```

Restructure so the theme is known before generation: replace the `const { map, entitySpawns, playerSpawn } = generateLevel(1)` line with:

```js
  const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(1, undefined, undefined, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]) })
```

and DELETE the now-duplicate later line `const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]` (the `decorateMap(map, rulesets[theme.ruleset])` line right after it stays).

(c) In the descend handler (around line 530), the current sequence is:

```js
  const { map, entitySpawns, playerSpawn } = generateLevel(next)
  const theme = DEPTH_THEMES.find(t => t.depths.includes(next)) ?? DEPTH_THEMES[0]
  decorateMap(map, rulesets[theme.ruleset])
```

Replace those three lines with:

```js
  const theme = DEPTH_THEMES.find(t => t.depths.includes(next)) ?? DEPTH_THEMES[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(next, undefined, undefined, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]) })
  decorateMap(map, rulesets[theme.ruleset])
```

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: all pass.

Syntax-check game.js (a runtime DOM error is expected and fine; a SyntaxError is a failure):
```bash
node -e "import('./renderer/game.js').catch(e => { if (/window|document|not defined|Cannot read/.test(e.message)) { console.log('game.js parses OK (DOM runtime error expected)'); process.exit(0) } console.error(e); process.exit(1) })"
```
Expected: "game.js parses OK".

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/map.js renderer/game.js test/map.test.js
git commit -m "feat: skip random prop scatter for themes whose ruleset places overlays"
```

---

## Task 5: Painter — overlay layer end-to-end

Rework the painter for two layers: a Base/Overlay toggle, overlay tagging role, deriving both grids, merging overlay data, and a composited preview. GUI tool — headless WSL2 cannot launch Electron; verify via `npm test` + parse checks + reading.

**Files:**
- Modify: `tools/tile-editor/index.html` (layer toggle)
- Modify: `tools/tile-editor/sample-preview.js` (draw overlay)
- Modify: `tools/tile-editor/map-painter.js` (full rework)

- [ ] **Step 1: Add the layer toggle markup in `index.html`**

In `tools/tile-editor/index.html`, inside `#paint-sidebar`, immediately AFTER the size row's closing `</div>` (the `<div ...><input id="paint-w">…<button id="paint-resize">resize</button></div>`) and BEFORE `<div id="paint-tagging" …>`, insert:

```html
      <div class="label">Layer</div>
      <div id="paint-layers" style="display:flex; gap:4px">
        <button id="layer-base" class="on" style="flex:1">base</button>
        <button id="layer-overlay" style="flex:1">overlay</button>
      </div>
```

- [ ] **Step 2: Draw overlays in the preview (`sample-preview.js`)**

In `tools/tile-editor/sample-preview.js`, the cell-draw loop currently is:

```js
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const { tile, skin } = map[y][x]
    const img = skin && tileImages.get(skin)
    if (img) ctx.drawImage(img, x * s, y * s, s, s)
    else {
      ctx.fillStyle = tile === TILE.WALL ? '#33333d' : '#15151d'
      ctx.fillRect(x * s, y * s, s, s)
    }
  }
```

Replace it with (adds the overlay draw on top):

```js
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const { tile, skin, overlay } = map[y][x]
    const img = skin && tileImages.get(skin)
    if (img) ctx.drawImage(img, x * s, y * s, s, s)
    else {
      ctx.fillStyle = tile === TILE.WALL ? '#33333d' : '#15151d'
      ctx.fillRect(x * s, y * s, s, s)
    }
    const ovImg = overlay && tileImages.get(overlay)
    if (ovImg) ctx.drawImage(ovImg, x * s, y * s, s, s)
  }
```

- [ ] **Step 3: Rewrite `map-painter.js`**

Overwrite `tools/tile-editor/map-painter.js` with:

```js
// Build tab: paint a room with real tile sprites on two layers (base + overlay),
// tag them, then derive base-skin rules AND overlay placement rules from the
// painting into the active ruleset. Deps come from editor.js:
//   state      - { rulesets, active } shared ruleset state
//   imageFor   - async (name) => HTMLImageElement (cached)
//   tilesReady - Promise<string[]> of all library tile names

import { deriveRules } from './derive-rules.js'
import { renderSample } from './sample-preview.js'

// Merge a derived fragment into a ruleset: overwrite tile weights/tags and each
// painted tag's role + adjacency (+ overlays on base tags), but preserve any
// hand-authored allow/forbid/directional on tags that already exist. Unpainted
// tags are left untouched.
function mergeFragment(ruleset, frag) {
  ruleset.tiles = ruleset.tiles ?? {}
  ruleset.tags = ruleset.tags ?? {}
  for (const [name, def] of Object.entries(frag.tiles)) ruleset.tiles[name] = def
  for (const [tag, def] of Object.entries(frag.tags)) {
    const existing = ruleset.tags[tag]
    if (!existing) { ruleset.tags[tag] = def; continue }
    const merged = { ...existing, role: def.role, adjacency: def.adjacency }
    if (def.overlays) merged.overlays = def.overlays
    ruleset.tags[tag] = merged
  }
}

const CELL = 26  // px per cell on the paint canvas

export function initMapPainter({ state, imageFor, tilesReady }) {
  const canvas = document.getElementById('paint-canvas')
  const ctx = canvas.getContext('2d')
  const paletteEl = document.getElementById('paint-palette')
  const wInput = document.getElementById('paint-w')
  const hInput = document.getElementById('paint-h')

  const blank = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => null))
  const grid = {
    base: blank(Number(wInput.value), Number(hInput.value)),
    overlay: blank(Number(wInput.value), Number(hInput.value)),
  }
  let active = null          // active brush tile name; null = eraser
  let layer = 'base'         // 'base' | 'overlay' — which grid the brush writes
  let painting = false
  const images = new Map()   // name -> Image

  function sizeCanvas() {
    canvas.width = grid.base[0].length * CELL
    canvas.height = grid.base.length * CELL
  }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    for (let y = 0; y < grid.base.length; y++) {
      for (let x = 0; x < grid.base[y].length; x++) {
        ctx.fillStyle = '#15151d'
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
        const b = grid.base[y][x], bi = b && images.get(b)
        if (bi) ctx.drawImage(bi, x * CELL, y * CELL, CELL, CELL)
        const o = grid.overlay[y][x], oi = o && images.get(o)
        if (oi) ctx.drawImage(oi, x * CELL, y * CELL, CELL, CELL)
        ctx.strokeStyle = layer === 'overlay' ? '#7fd6' : '#0006'
        ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL)
      }
    }
  }
  function gridUses(name) {
    return grid.base.some(r => r.includes(name)) || grid.overlay.some(r => r.includes(name))
  }
  async function ensureImage(name) {
    if (!name || images.has(name)) return
    images.set(name, await imageFor(name))
    if (gridUses(name)) render()
  }

  function markActive(name) {
    paletteEl.querySelectorAll('img').forEach(i => i.classList.toggle('active', i.dataset.name === name))
  }
  function setActive(name) {
    active = name
    markActive(name)
    if (name) ensureImage(name)
    renderTagging()
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

  function setLayer(which) {
    layer = which
    document.getElementById('layer-base').classList.toggle('on', which === 'base')
    document.getElementById('layer-overlay').classList.toggle('on', which === 'overlay')
    render()
  }
  document.getElementById('layer-base').addEventListener('click', () => setLayer('base'))
  document.getElementById('layer-overlay').addEventListener('click', () => setLayer('overlay'))

  function cellAt(ev) {
    const r = canvas.getBoundingClientRect()
    return { x: Math.floor((ev.clientX - r.left) / CELL), y: Math.floor((ev.clientY - r.top) / CELL) }
  }
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (grid[layer][y]?.[x] === undefined) return
    grid[layer][y][x] = active   // active === null erases the active layer's slot
    render()
  }
  canvas.addEventListener('mousedown', e => { painting = true; paint(e) })
  canvas.addEventListener('mousemove', e => { if (painting) paint(e) })
  window.addEventListener('mouseup', () => { painting = false })

  document.getElementById('paint-resize').addEventListener('click', () => {
    const w = Math.max(2, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(2, Math.min(40, Number(hInput.value) | 0))
    const resize = (g) => Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => g[y]?.[x] ?? null))
    grid.base = resize(grid.base)
    grid.overlay = resize(grid.overlay)
    sizeCanvas(); render()
  })

  const taggingEl = document.getElementById('paint-tagging')
  const reportEl = document.getElementById('derive-report')
  const previewCanvas = document.getElementById('paint-preview')

  function ensureRuleset() {
    if (!state.active) {
      state.active = 'derived'
      document.dispatchEvent(new Event('ruleset-changed'))
    }
    state.rulesets[state.active] = state.rulesets[state.active] ?? { tiles: {}, tags: {} }
    return state.rulesets[state.active]
  }

  // Inline role+tag assignment for the active brush tile (role includes overlay).
  function renderTagging() {
    taggingEl.innerHTML = ''
    if (!active) { taggingEl.textContent = 'Pick a tile to tag…'; return }
    const rs = state.rulesets[state.active]
    const curTag = rs?.tiles?.[active]?.tags?.[0] ?? ''
    const lbl = document.createElement('div')
    lbl.className = 'label'
    lbl.textContent = `Tag ${active}` + (curTag ? ` (now: ${curTag})` : ' (untagged)')
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall', 'overlay']) {
      const o = document.createElement('option'); o.value = o.textContent = r; roleSel.appendChild(o)
    }
    if (curTag && rs?.tags?.[curTag]?.role) roleSel.value = rs.tags[curTag].role
    const tagInput = document.createElement('input')
    tagInput.placeholder = 'overlay.barrel'; tagInput.value = curTag; tagInput.style.width = '100%'
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
    const frag = deriveRules(grid.base, grid.overlay, tileMetaFromRuleset(rs))
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

  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
  sizeCanvas()
  render()
}
```

- [ ] **Step 4: Verify (no GUI)**

Run: `npm test` → expect all pass (no test changes here; editor UI).

Parse-check + wiring:
```bash
node -e "import('./tools/tile-editor/map-painter.js').then(m => console.log('exports:', Object.keys(m)))"
grep -n "grid.base\|grid.overlay\|setLayer\|deriveRules(grid.base, grid.overlay" tools/tile-editor/map-painter.js
grep -c 'id="layer-base"\|id="layer-overlay"' tools/tile-editor/index.html
```
Expected: `exports: [ 'initMapPainter' ]`; the grep shows the two-layer grid usage + the `deriveRules(grid.base, grid.overlay, …)` call; the id count is `2`.

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/map-painter.js tools/tile-editor/sample-preview.js tools/tile-editor/index.html
git commit -m "feat: painter overlay layer — toggle, overlay tagging, two-layer derive + preview"
```

---

## Manual verification (user, with a display)

Headless WSL2 cannot launch Electron; confirm with `npm run editor`:
1. Build tab shows a **base / overlay** layer toggle. On Base, paint floor/wall tiles; the active layer's grid outline tints when Overlay is selected.
2. Switch to Overlay; paint transparent prop tiles on top of base cells; they composite over the base. Leave most overlay cells empty.
3. Tag base tiles (floor/wall) and overlay tiles (role **overlay**, e.g. `overlay.barrel`).
4. "⚙ Derive rules" → report includes the overlay tiles/tags/adjacencies; the active ruleset's `rulesets.json` gains `overlays` on base tags and `adjacency` on overlay tags.
5. "Preview outcome" shows base skins with props sprinkled on top in your painted density/clustering.
6. Bind the ruleset to a depth theme (`ruleset:` on a `DEPTH_THEMES` entry) and `npm start`: props appear via the overlay pass and the old random scatter is gone for that theme.

---

## Self-Review Notes

- **Spec coverage:** painter overlay layer + toggle + composited render + overlay role (Task 5, §1/§3-render); schema `overlays` on base tags + `adjacency` on overlay tags + two-layer derivation (Task 1, §2); overlay decoration pass reusing `adjacencyScore` with synthetic none (Task 2, §3); render `cell.overlay` (Task 3, §3-render); replace random scatter via `skipProps`/`rulesetHasOverlays` (Task 4, §4); error handling — untagged skips (Task 1), no-overlay-data inert + `cell.skin===null` (Task 2), missing sprite via existing `pruneMissingTiles`, backward compat (Tasks 2/3 regression); testing per §6 (Tasks 1–4 unit; Task 5 manual). All spec sections map to a task.
- **Type/name consistency:** `deriveRules(baseGrid, overlayGrid, tileMeta)` defined in Task 1, called identically in Task 5; `overlays` distribution keyed by overlay tag with `''` empty key is written in Task 1, read in Task 2 (`decorateOverlays`) and `rulesetHasOverlays`, and merged in Task 5 (`mergeFragment`); `cell.overlay` is set in Task 2, drawn in Task 3 and Task 5's preview; `rulesetHasOverlays` exported in Task 2, imported in Task 4; `adjacencyScore` reused unchanged from the prior feature; `generateLevel(depth, width, height, { skipProps })` defined in Task 4, called with `{ skipProps }` in Task 4's game.js wiring.
- **No placeholders.**
