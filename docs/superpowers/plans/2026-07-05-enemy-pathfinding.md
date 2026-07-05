# Enemy Pathfinding & Movement AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace beeline enemy movement with a flow-field + A\* navigation layer so enemies route around obstacles, hunt last-known positions, patrol, kite, and flee.

**Architecture:** Three new modules: `nav.js` (pure grid nav: walkability + clearance, Dijkstra flow field from the player, clearance-aware A\*), `brain.js` (perception → intent: chase/hunt/patrol/flee decisions per enemy), `act.js` (executes parameterized movement intents with separation steering and collision). A per-enemy config table (`renderer/data/enemy-ai.js`) supplies speeds, sight, kite bands, flee thresholds, and taxon. Basic enemies in `game.js` switch to brain+act wholesale; crab/wizard/cyclops/dragon-boss keep their state machines but move through `act()`.

**Tech Stack:** Vanilla JS ES modules (no bundler, no new dependencies), `node:test` + `assert/strict` for tests, Electron renderer.

**Spec:** `docs/superpowers/specs/2026-07-05-enemy-pathfinding-design.md`

## Global Constraints

- Vanilla ES modules only; **no new npm dependencies**.
- `renderer/systems/*` stays pure: no DOM, no Electron APIs (matches existing files like `knockback.js`).
- Tile size is **32 px**; maps are indexed `map[y][x]`; each cell is an object `{ tile, roomId, visible, explored, dirty, ... }`.
- `isWalkable(tileId, tileObj)` from `renderer/systems/entities.js` blocks `TILE.WALL`, `TILE.COLUMN`, and any tile with `tileObj.voidZone` — nav must use it, never re-derive walkability.
- Entities carry pixel positions `px, py` AND tile coords `x, y` (`x = Math.floor(px / 32)`); every movement helper must keep both in sync.
- Tests run with `npm test` (`node --test test/`), one test file per system, `describe`/`it` + `assert/strict` style (see `test/knockback.test.js`).
- Commit after every task; commit messages follow the repo's conventional style (`feat(...)`, `test(...)`, `refactor(...)`).
- **Nav caches:** the nav grid caches on `map._nav`; flow fields cache on `state._flowFields`. Tiles never change at runtime today; if that changes later, setting `map._nav = null` invalidates.

## File Structure

- Create: `renderer/systems/nav.js` — pure navigation core (grid, clearance, flow field, A\*, pixel collision helper). No imports except `entities.js`.
- Create: `renderer/systems/brain.js` — perception + intent (chase/hunt/patrol/flee state per enemy, patrol generation). Imports `nav.js`, `entities.js`, config.
- Create: `renderer/systems/act.js` — movement executor (`act(e, state, delta, intent)`, separation, path/field following, escape). Imports `nav.js`, `entities.js`.
- Create: `renderer/data/enemy-ai.js` — per-enemy-type tuning table + `getAIConfig(e)`.
- Create: `test/nav.test.js`, `test/brain.test.js`, `test/act.test.js`, `test/enemy-ai.test.js`.
- Modify: `renderer/game.js` (shared enemy loop, lines ~459–487; spawn init `wander()` line ~136; dead constants lines 23–26), `renderer/systems/wizard.js`, `renderer/systems/crab.js`, `renderer/systems/cyclops.js`, `renderer/systems/dragonboss.js` (`startStomp`), and their existing test files as needed.

---

### Task 1: nav.js — grid, clearance, pixel collision

**Files:**
- Create: `renderer/systems/nav.js`
- Test: `test/nav.test.js`

**Interfaces:**
- Consumes: `isWalkable`, `TILE` from `renderer/systems/entities.js`; `createMap` from `renderer/systems/map.js` (tests only).
- Produces (used by every later task):
  - `buildNavGrid(map) -> { w, h, walk: Uint8Array, clear: Int16Array }` (cached on `map._nav`)
  - `passable(nav, x, y, clearance = 1) -> boolean`
  - `clearanceFor(half) -> 1 | 2 | ...` (pixel half-size → clearance class)
  - `nearestPassable(nav, x, y, clearance = 1, maxR = 6) -> {x, y} | null`
  - `canMoveTo(map, px, py, half) -> boolean` (pixel-space AABB corner check)

- [ ] **Step 1: Write the failing tests**

Create `test/nav.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { buildNavGrid, passable, clearanceFor, nearestPassable, canMoveTo } from '../renderer/systems/nav.js'

// 12x9 map: solid wall border, floor interior, one column at (x=6, y=4)
function columnMap() {
  const map = createMap(12, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 11; x++) map[y][x].tile = TILE.FLOOR
  map[4][6].tile = TILE.COLUMN
  return map
}

describe('clearanceFor', () => {
  it('small entities need clearance 1, wide ones 2', () => {
    assert.equal(clearanceFor(4), 1)    // rats, guards
    assert.equal(clearanceFor(16), 1)   // exactly one tile
    assert.equal(clearanceFor(28), 2)   // cyclops (56px wide)
  })
})

describe('buildNavGrid', () => {
  it('computes walkability and clearance distances', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    assert.equal(nav.w, 12)
    assert.equal(nav.h, 9)
    assert.equal(nav.clear[0 * 12 + 0], 0)          // wall tile: 0
    assert.equal(nav.clear[4 * 12 + 6], 0)          // column tile: 0
    assert.equal(nav.clear[4 * 12 + 5], 1)          // next to column: 1
    assert.ok(nav.clear[2 * 12 + 3] >= 2, 'open interior tile has clearance >= 2')
  })

  it('caches on map._nav', () => {
    const map = columnMap()
    assert.equal(buildNavGrid(map), buildNavGrid(map))
  })
})

describe('passable', () => {
  it('clearance 2 rejects tiles hugging a wall', () => {
    const nav = buildNavGrid(columnMap())
    assert.equal(passable(nav, 1, 1, 1), true)   // corner floor ok for small
    assert.equal(passable(nav, 1, 1, 2), false)  // too tight for wide entities
    assert.equal(passable(nav, 3, 2, 2), true)   // open interior ok
    assert.equal(passable(nav, -1, 0, 1), false) // out of bounds
  })
})

describe('nearestPassable', () => {
  it('finds an adjacent floor tile from inside a wall', () => {
    const nav = buildNavGrid(columnMap())
    const t = nearestPassable(nav, 0, 0, 1)
    assert.ok(t && passable(nav, t.x, t.y, 1))
  })
  it('returns null when nothing is close', () => {
    const map = createMap(30, 30) // all wall
    const nav = buildNavGrid(map)
    assert.equal(nearestPassable(nav, 15, 15, 1), null)
  })
})

describe('canMoveTo', () => {
  it('allows a small body on open floor, blocks overlap with the column', () => {
    const map = columnMap()
    assert.equal(canMoveTo(map, 3 * 32 + 16, 2 * 32 + 16, 4), true)
    // column tile spans x 192..224, y 128..160; body centre 2px left of it overlaps
    assert.equal(canMoveTo(map, 6 * 32 - 2, 4 * 32 + 16, 4), false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/nav.test.js`
Expected: FAIL — `Cannot find module '.../renderer/systems/nav.js'`

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/nav.js`:

```js
// Grid navigation for enemy AI: walkability + clearance, and (in later
// sections of this file) Dijkstra flow fields and clearance-aware A*.
// Pure — no DOM, no game state. The nav grid caches on map._nav; tiles do
// not change at runtime today (set map._nav = null if that ever changes).
import { isWalkable } from './entities.js'

const S = 32
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

// Pixel-space AABB corner check — the same rule game.js/crab.js/cyclops.js
// have each been duplicating locally.
export function canMoveTo(map, px, py, half) {
  const corners = [
    [px - half, py - half], [px + half, py - half],
    [px - half, py + half], [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const t = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return t && isWalkable(t.tile, t)
  })
}

// Clearance class an entity of pixel half-size `half` needs on a tile:
// 1 = fits within a single tile, 2 = also needs the 8 surrounding tiles free.
export function clearanceFor(half) {
  return 1 + Math.max(0, Math.ceil((half - S / 2) / S))
}

// clear[i] = chebyshev distance (tiles) to the nearest blocked tile or map
// edge; blocked tiles are 0. Multi-source BFS over 8 neighbours.
export function buildNavGrid(map) {
  if (map._nav) return map._nav
  const h = map.length, w = map[0].length
  const walk = new Uint8Array(w * h)
  const clear = new Int16Array(w * h).fill(-1)
  const qx = [], qy = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    walk[i] = isWalkable(map[y][x].tile, map[y][x]) ? 1 : 0
    if (!walk[i]) { clear[i] = 0; qx.push(x); qy.push(y) }
  }
  // out-of-bounds counts as blocked: walkable border tiles start at distance 1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      const i = y * w + x
      if (walk[i] && clear[i] === -1) { clear[i] = 1; qx.push(x); qy.push(y) }
    }
  }
  for (let head = 0; head < qx.length; head++) {
    const x = qx[head], y = qy[head], d = clear[y * w + x]
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (clear[ni] === -1) { clear[ni] = d + 1; qx.push(nx); qy.push(ny) }
    }
  }
  map._nav = { w, h, walk, clear }
  return map._nav
}

export function passable(nav, x, y, clearance = 1) {
  return x >= 0 && y >= 0 && x < nav.w && y < nav.h && nav.clear[y * nav.w + x] >= clearance
}

// Nearest tile passable at `clearance`, scanning outward in chebyshev rings.
export function nearestPassable(nav, x, y, clearance = 1, maxR = 6) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (passable(nav, x + dx, y + dy, clearance)) return { x: x + dx, y: y + dy }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/nav.test.js`
Expected: PASS (all describes green)

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/nav.js test/nav.test.js
git commit -m "feat(nav): navigation grid with clearance classes and pixel collision helper"
```

---

### Task 2: nav.js — clearance-aware A\*

**Files:**
- Modify: `renderer/systems/nav.js` (append)
- Test: `test/nav.test.js` (append)

**Interfaces:**
- Consumes: `buildNavGrid`, `passable`, `nearestPassable` from Task 1.
- Produces: `findPath(nav, sx, sy, tx, ty, clearance = 1) -> [{x, y}, ...] | null` — tile waypoints from first step to target, **start excluded**, `[]` if already there, `null` if unreachable. Diagonals never cut corners. An impassable start/target is replaced by its `nearestPassable` neighbour before searching.

- [ ] **Step 1: Write the failing tests**

Append to `test/nav.test.js`:

```js
import { findPath } from '../renderer/systems/nav.js'

// Wall off every neighbour of (9,6) so it becomes a sealed 1-tile pocket.
// (Do this BEFORE buildNavGrid — the nav grid caches on map._nav.)
function sealPocket(map) {
  for (const [x, y] of [[8, 5], [9, 5], [10, 5], [8, 6], [10, 6], [8, 7], [9, 7], [10, 7]]) {
    map[y][x].tile = TILE.WALL
  }
}

describe('findPath', () => {
  it('routes around the column instead of through it', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    const path = findPath(nav, 4, 4, 8, 4, 1)   // column at (6,4) sits on the straight line
    assert.ok(path && path.length >= 4)
    assert.ok(!path.some(p => p.x === 6 && p.y === 4), 'path avoids the column tile')
    assert.deepEqual(path[path.length - 1], { x: 8, y: 4 })
    // contiguous king-moves from the start tile
    let prev = { x: 4, y: 4 }
    for (const p of path) {
      assert.ok(Math.abs(p.x - prev.x) <= 1 && Math.abs(p.y - prev.y) <= 1)
      prev = p
    }
  })

  it('returns [] when start equals target and null when sealed off', () => {
    const map = columnMap()
    sealPocket(map) // walls around (9,6), see helper below
    const nav = buildNavGrid(map)
    assert.deepEqual(findPath(nav, 2, 2, 2, 2, 1), [])
    assert.equal(findPath(nav, 2, 2, 9, 6, 1), null)
  })

  it('wide entities get wide routes', () => {
    // 16x11 map, two rooms joined by a 1-tile-wide door at x=8
    const map = createMap(16, 11)
    for (let y = 1; y < 10; y++) for (let x = 1; x < 15; x++) map[y][x].tile = TILE.FLOOR
    for (let y = 1; y < 10; y++) if (y !== 5) map[y][8].tile = TILE.WALL
    const nav = buildNavGrid(map)
    assert.ok(findPath(nav, 3, 5, 13, 5, 1), 'small entity fits through the door')
    assert.equal(findPath(nav, 3, 5, 13, 5, 2), null, 'wide entity cannot')
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/nav.test.js`
Expected: FAIL — `findPath` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `renderer/systems/nav.js`:

```js
const SQRT2 = Math.SQRT2

// Small binary min-heap keyed on cost; shared by Dijkstra and A*.
class MinHeap {
  constructor() { this.k = []; this.v = [] }
  get size() { return this.k.length }
  push(key, val) {
    const k = this.k, v = this.v
    let i = k.length; k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]; ;[v[p], v[i]] = [v[i], v[p]]; i = p
    }
  }
  pop() {
    const k = this.k, v = this.v
    const top = v[0], last = k.length - 1
    k[0] = k[last]; v[0] = v[last]; k.pop(); v.pop()
    let i = 0
    for (;;) {
      const l = 2 * i + 1, r = l + 1
      let m = i
      if (l < k.length && k[l] < k[m]) m = l
      if (r < k.length && k[r] < k[m]) m = r
      if (m === i) break
      ;[k[m], k[i]] = [k[i], k[m]]; ;[v[m], v[i]] = [v[i], v[m]]; i = m
    }
    return top
  }
}

// A diagonal move is legal only when both orthogonal neighbours are passable
// (no corner cutting — a body would clip the corner tile).
function diagOk(nav, x, y, dx, dy, clearance) {
  return !(dx && dy) || (passable(nav, x + dx, y, clearance) && passable(nav, x, y + dy, clearance))
}

// A* over tiles passable at `clearance`, octile heuristic. Returns waypoints
// from the first step to the target (start excluded), [] if already there,
// or null when unreachable.
export function findPath(nav, sx, sy, tx, ty, clearance = 1) {
  const { w, h } = nav
  if (!passable(nav, sx, sy, clearance)) {
    const alt = nearestPassable(nav, sx, sy, clearance)
    if (!alt) return null
    sx = alt.x; sy = alt.y
  }
  if (!passable(nav, tx, ty, clearance)) {
    const alt = nearestPassable(nav, tx, ty, clearance)
    if (!alt) return null
    tx = alt.x; ty = alt.y
  }
  if (sx === tx && sy === ty) return []
  const g = new Float64Array(w * h).fill(Infinity)
  const came = new Int32Array(w * h).fill(-1)
  const hcost = (x, y) => {
    const ax = Math.abs(x - tx), ay = Math.abs(y - ty)
    return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay)
  }
  const heap = new MinHeap()
  const start = sy * w + sx, goal = ty * w + tx
  g[start] = 0
  heap.push(hcost(sx, sy), start)
  while (heap.size) {
    const i = heap.pop()
    if (i === goal) break
    const x = i % w, y = (i / w) | 0
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (!passable(nav, nx, ny, clearance) || !diagOk(nav, x, y, dx, dy, clearance)) continue
      const ni = ny * w + nx
      const ng = g[i] + (dx && dy ? SQRT2 : 1)
      if (ng < g[ni] - 1e-9) { g[ni] = ng; came[ni] = i; heap.push(ng + hcost(nx, ny), ni) }
    }
  }
  if (came[goal] === -1) return null
  const path = []
  for (let i = goal; i !== start; i = came[i]) path.push({ x: i % w, y: (i / w) | 0 })
  return path.reverse()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/nav.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/nav.js test/nav.test.js
git commit -m "feat(nav): clearance-aware A* with octile heuristic and no corner cutting"
```

---

### Task 3: nav.js — Dijkstra flow field

**Files:**
- Modify: `renderer/systems/nav.js` (append)
- Test: `test/nav.test.js` (append)

**Interfaces:**
- Consumes: Task 1–2 exports (`passable`, `nearestPassable`, `MinHeap`, `diagOk`, `DIRS`).
- Produces:
  - `buildFlowField(nav, tx, ty, clearance = 1) -> { dist: Float64Array, w, h, x, y, clearance }` — Dijkstra distances (tile units) from `(tx, ty)`; unreachable tiles are `Infinity`.
  - `fieldStep(field, nav, x, y, clearance = 1, dir = 'down') -> {x, y} | null` — best neighbouring tile strictly downhill (toward target) or uphill (away); `null` when nothing improves (at the target, or cornered when fleeing).

- [ ] **Step 1: Write the failing tests**

Append to `test/nav.test.js`:

```js
import { buildFlowField, fieldStep } from '../renderer/systems/nav.js'

describe('buildFlowField', () => {
  it('distance is 0 at the target and grows outward around obstacles', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    const f = buildFlowField(nav, 8, 4, 1)
    assert.equal(f.dist[4 * 12 + 8], 0)
    assert.ok(f.dist[4 * 12 + 4] > 3, 'tile behind the column costs more than the crow flies')
    assert.equal(f.dist[0], Infinity)   // wall tile unreachable
  })

  it('clearance-2 field treats a 1-tile door as a wall', () => {
    const map = createMap(16, 11)
    for (let y = 1; y < 10; y++) for (let x = 1; x < 15; x++) map[y][x].tile = TILE.FLOOR
    for (let y = 1; y < 10; y++) if (y !== 5) map[y][8].tile = TILE.WALL
    const nav = buildNavGrid(map)
    const wide = buildFlowField(nav, 3, 5, 2)
    assert.equal(wide.dist[5 * 16 + 13], Infinity, 'far room unreachable for wide entities')
    const small = buildFlowField(nav, 3, 5, 1)
    assert.ok(isFinite(small.dist[5 * 16 + 13]))
  })
})

describe('fieldStep', () => {
  it('descending steps reach the target even around the column', () => {
    const map = columnMap()
    const nav = buildNavGrid(map)
    const f = buildFlowField(nav, 8, 4, 1)
    let pos = { x: 4, y: 4 }
    for (let i = 0; i < 40; i++) {
      const next = fieldStep(f, nav, pos.x, pos.y, 1, 'down')
      if (!next) break
      pos = next
    }
    assert.deepEqual(pos, { x: 8, y: 4 })
  })

  it('ascending increases distance, and returns null when cornered', () => {
    // dead-end corridor: floor only at y=4, x=1..5; player flood from (5,4)
    const map = createMap(8, 8)
    for (let x = 1; x <= 5; x++) map[4][x].tile = TILE.FLOOR
    const nav = buildNavGrid(map)
    const f = buildFlowField(nav, 5, 4, 1)
    const up = fieldStep(f, nav, 3, 4, 1, 'up')
    assert.deepEqual(up, { x: 2, y: 4 })       // away from the player
    assert.equal(fieldStep(f, nav, 1, 4, 1, 'up'), null)  // closed end: cornered
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/nav.test.js`
Expected: FAIL — `buildFlowField` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `renderer/systems/nav.js`:

```js
// Dijkstra distances from (tx,ty) over tiles passable at `clearance`.
// Chasers walk downhill on this field; fleeing enemies walk uphill.
export function buildFlowField(nav, tx, ty, clearance = 1) {
  const { w, h } = nav
  const dist = new Float64Array(w * h).fill(Infinity)
  if (!passable(nav, tx, ty, clearance)) {
    const alt = nearestPassable(nav, tx, ty, clearance)
    if (!alt) return { dist, w, h, x: tx, y: ty, clearance }
    tx = alt.x; ty = alt.y
  }
  const heap = new MinHeap()
  dist[ty * w + tx] = 0
  heap.push(0, ty * w + tx)
  while (heap.size) {
    const i = heap.pop()
    const x = i % w, y = (i / w) | 0
    const d = dist[i]
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (!passable(nav, nx, ny, clearance) || !diagOk(nav, x, y, dx, dy, clearance)) continue
      const nd = d + (dx && dy ? SQRT2 : 1)
      const ni = ny * w + nx
      if (nd < dist[ni] - 1e-9) { dist[ni] = nd; heap.push(nd, ni) }
    }
  }
  return { dist, w, h, x: tx, y: ty, clearance }
}

// Best neighbouring tile strictly downhill/uphill on the field, or null when
// no neighbour improves (down: standing on the target; up: cornered).
export function fieldStep(field, nav, x, y, clearance = 1, dir = 'down') {
  if (x < 0 || y < 0 || x >= nav.w || y >= nav.h) return null
  const cur = field.dist[y * nav.w + x]
  let best = null, bestD = cur
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy
    if (!passable(nav, nx, ny, clearance) || !diagOk(nav, x, y, dx, dy, clearance)) continue
    const d = field.dist[ny * nav.w + nx]
    if (!isFinite(d)) continue
    if (dir === 'down' ? d < bestD - 1e-9 : d > bestD + 1e-9) { bestD = d; best = { x: nx, y: ny } }
  }
  return best
}
```

Note: when an enemy stands on a tile whose field distance is `Infinity` (e.g. wedged in a wall), any finite neighbour beats `Infinity` for `'down'`, so it recovers; for `'up'` it returns null and the enemy stands its ground.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/nav.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/nav.js test/nav.test.js
git commit -m "feat(nav): player flow field (Dijkstra) with uphill flee steps"
```

---

### Task 4: enemy-ai.js — per-enemy config table

**Files:**
- Create: `renderer/data/enemy-ai.js`
- Test: `test/enemy-ai.test.js`

**Interfaces:**
- Consumes: nothing (pure data).
- Produces: `getAIConfig(e) -> { taxon, speed, wanderSpeed, half, sightRange, stopRange, kiteBand?, combat?, inward?, fleeHp }` — looked up by `e.type`, with `e.variant` overrides for monsters. `fleeHp` defaults to **0.3 for taxon `humanoid`/`mammal`, 0 otherwise**; an explicit `fleeHp` in the table always wins.

- [ ] **Step 1: Write the failing tests**

Create `test/enemy-ai.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getAIConfig } from '../renderer/data/enemy-ai.js'

describe('getAIConfig', () => {
  it('humanoids and mammals flee at low HP by default; beasts do not', () => {
    assert.equal(getAIConfig({ type: 'guard' }).fleeHp, 0.3)                       // humanoid
    assert.equal(getAIConfig({ type: 'monster', variant: 'weak' }).fleeHp, 0.3)    // rat: mammal
    assert.equal(getAIConfig({ type: 'monster', variant: 'strong' }).fleeHp, 0)    // beast
    assert.equal(getAIConfig({ type: 'crab' }).fleeHp, 0)                          // beast
  })

  it('explicit fleeHp overrides the taxon default', () => {
    assert.equal(getAIConfig({ type: 'wizard' }).fleeHp, 0)    // humanoid but never routs
    assert.equal(getAIConfig({ type: 'cyclops' }).fleeHp, 0)   // boss never routs
  })

  it('the shooting spider kites, the crab strafes, the cyclops is wide', () => {
    assert.deepEqual(getAIConfig({ type: 'monster', variant: 'medium' }).kiteBand, [70, 120])
    assert.equal(getAIConfig({ type: 'crab' }).combat, 'strafe')
    assert.equal(getAIConfig({ type: 'cyclops' }).half, 28)
  })

  it('unknown types fall back to the base monster row', () => {
    assert.equal(getAIConfig({ type: 'mystery' }).speed, 80)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/enemy-ai.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `renderer/data/enemy-ai.js`:

```js
// Per-enemy-type movement-AI tuning (data, not code).
// `taxon` drives the default low-HP flee rule: humanoids and mammals run when
// badly hurt; beasts and bosses fight to the death. Explicit fleeHp overrides.
// `half` is the pixel half-size used for collision AND clearance class
// (<= 16 fits one tile; the 56px-wide cyclops needs 2-tile clearance).
const fleeDefault = taxon => (taxon === 'humanoid' || taxon === 'mammal') ? 0.3 : 0

const BASE = {
  guard:       { taxon: 'humanoid', speed: 80, wanderSpeed: 30, half: 4,  sightRange: 180, stopRange: 20 },
  monster:     { taxon: 'beast',    speed: 80, wanderSpeed: 30, half: 4,  sightRange: 180, stopRange: 20 },
  dragon:      { taxon: 'beast',    speed: 60, wanderSpeed: 30, half: 4,  sightRange: 200, stopRange: 20 },
  crab:        { taxon: 'beast',    speed: 65, wanderSpeed: 25, half: 4,  sightRange: 240, stopRange: 0, combat: 'strafe', inward: 0.3 },
  wizard:      { taxon: 'humanoid', speed: 70, wanderSpeed: 30, half: 4,  sightRange: 300, stopRange: 0, kiteBand: [120, 240], fleeHp: 0 },
  cyclops:     { taxon: 'humanoid', speed: 40, wanderSpeed: 20, half: 28, sightRange: 320, stopRange: 40, fleeHp: 0 },
  dragon_boss: { taxon: 'beast',    speed: 0,  wanderSpeed: 0,  half: 28, sightRange: 448, stopRange: 0 },
}

// Monster variants override the base monster row.
const VARIANTS = {
  weak:   { taxon: 'mammal' },                      // rats: rout when badly hurt
  medium: { taxon: 'beast', kiteBand: [70, 120] },  // shooting spider: kite inside its 130px range
  strong: { taxon: 'beast' },
  boss:   { taxon: 'beast' },
}

export function getAIConfig(e) {
  const base = BASE[e.type] ?? BASE.monster
  const merged = e.type === 'monster' ? { ...base, ...(VARIANTS[e.variant] ?? {}) } : { ...base }
  if (merged.fleeHp === undefined) merged.fleeHp = fleeDefault(merged.taxon)
  return merged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enemy-ai.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/data/enemy-ai.js test/enemy-ai.test.js
git commit -m "feat(ai): per-enemy movement config table with taxon-driven flee defaults"
```

---

### Task 5: act.js — movement executor core (approach, patrol, hold)

**Files:**
- Create: `renderer/systems/act.js`
- Test: `test/act.test.js`

**Interfaces:**
- Consumes: everything exported by `nav.js`; `hasLineOfSight` from `entities.js`.
- Produces (brain and all enemy files rely on these exact signatures):
  - `act(e, state, delta, intent) -> boolean` (true if the entity moved). Intent shapes handled in this task: `{ mode: 'hold' }`, `{ mode: 'approach', speed, stopRange?, target? }` (`target` = `{x, y}` **tile** coords → A\* follow; no `target` → player flow field), `{ mode: 'patrol', target, speed }`.
  - `getPlayerField(state, clearance) -> field` — player flow field, cached on `state._flowFields[clearance]`, rebuilt only when the player's tile or the nav grid changes.
  - Entities carry `e.aiHalf` (pixel half-size, default 4) and a scratch object `e.ai` (`path`, `pathTarget`, `repath`, `strafeDir`, …). `e.ai.path === null` after a follow attempt means "target unreachable" — brain reads this for its give-up timer.

- [ ] **Step 1: Write the failing tests**

Create `test/act.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { act, getPlayerField } from '../renderer/systems/act.js'

const S = 32
function columnMap() {
  const map = createMap(12, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 11; x++) map[y][x].tile = TILE.FLOOR
  map[4][6].tile = TILE.COLUMN
  return map
}
function makeState(map, playerTile, enemies = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities: enemies }
}
function enemyAt(x, y) {
  return { type: 'monster', variant: 'weak', maxHp: 2, hp: 2, x, y,
    px: x * S + S / 2, py: y * S + S / 2, ai: {}, aiHalf: 4 }
}

describe('act approach (flow field)', () => {
  it('walks an enemy around the column to the player', () => {
    const map = columnMap()
    const e = enemyAt(4, 4)
    const state = makeState(map, { x: 8, y: 4 }, [e])
    for (let i = 0; i < 600; i++) {
      act(e, state, 1 / 60, { mode: 'approach', speed: 80, stopRange: 20 })
      if (Math.hypot(e.px - state.player.px, e.py - state.player.py) <= 24) break
    }
    assert.ok(Math.hypot(e.px - state.player.px, e.py - state.player.py) <= 24,
      `enemy should reach the player, ended at (${e.px},${e.py})`)
  })

  it('stops inside stopRange', () => {
    const map = columnMap()
    const e = enemyAt(7, 2)
    const state = makeState(map, { x: 8, y: 2 }, [e])
    const moved = act(e, state, 1 / 60, { mode: 'approach', speed: 80, stopRange: 40 })
    assert.equal(moved, false)
  })
})

describe('act approach (A* target)', () => {
  it('follows a path to a fixed tile and flags unreachable targets', () => {
    const map = columnMap()
    const e = enemyAt(2, 2)
    const state = makeState(map, { x: 9, y: 7 }, [e])
    act(e, state, 1 / 60, { mode: 'approach', speed: 80, target: { x: 9, y: 2 } })
    assert.ok(Array.isArray(e.ai.path), 'path cached on e.ai')
  })

  it('sets e.ai.path = null when the target is sealed off (brain reads this to give up)', () => {
    const map = columnMap()
    // seal a 1-tile pocket at (9,6): wall off ALL 8 neighbours (before nav caches)
    for (const [x, y] of [[8, 5], [9, 5], [10, 5], [8, 6], [10, 6], [8, 7], [9, 7], [10, 7]]) {
      map[y][x].tile = TILE.WALL
    }
    const e = enemyAt(2, 2)
    const state = makeState(map, { x: 9, y: 7 }, [e])
    act(e, state, 1 / 60, { mode: 'approach', speed: 80, target: { x: 9, y: 6 } })
    assert.equal(e.ai.path, null)
  })
})

describe('act separation', () => {
  it('two stacked enemies drift apart while approaching', () => {
    const map = columnMap()
    const a = enemyAt(3, 4), b = enemyAt(3, 4)
    b.px += 1 // tiny offset so the push direction is defined
    const state = makeState(map, { x: 9, y: 4 }, [a, b])
    for (let i = 0; i < 120; i++) {
      act(a, state, 1 / 60, { mode: 'approach', speed: 60 })
      act(b, state, 1 / 60, { mode: 'approach', speed: 60 })
    }
    assert.ok(Math.hypot(a.px - b.px, a.py - b.py) > 8, 'separation pushes them apart')
  })
})

describe('act escape', () => {
  it('an enemy wedged in a wall walks back out', () => {
    const map = columnMap()
    const e = enemyAt(6, 4) // on the column tile
    const state = makeState(map, { x: 9, y: 4 }, [e])
    for (let i = 0; i < 120; i++) act(e, state, 1 / 60, { mode: 'approach', speed: 60 })
    const tile = map[e.y][e.x].tile
    assert.notEqual(tile, TILE.COLUMN, 'escaped the column tile')
  })
})

describe('getPlayerField cache', () => {
  it('reuses the field until the player changes tile', () => {
    const map = columnMap()
    const state = makeState(map, { x: 8, y: 4 })
    const f1 = getPlayerField(state, 1)
    assert.equal(getPlayerField(state, 1), f1)
    state.player.x = 7
    assert.notEqual(getPlayerField(state, 1), f1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/act.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/act.js`:

```js
// The movement brain: executes parameterized movement intents from brain.js
// (or directly from enemy state machines). Owns the HOW of moving — path and
// field following, enemy separation, wall sliding, escape from geometry —
// while brain.js owns the WHAT (chase, hunt, patrol, flee).
import { buildNavGrid, buildFlowField, findPath, fieldStep, canMoveTo, clearanceFor, nearestPassable } from './nav.js'
import { hasLineOfSight } from './entities.js'

const S = 32
const SEP_RADIUS = 20        // px within which enemies push each other apart
const SEP_WEIGHT = 0.6
const REPATH_INTERVAL = 0.5  // s between A* recomputes for a moving target
const WAYPOINT_REACHED = 10  // px

// Player flow field, cached on state and rebuilt only when the player's tile
// (or the map) changes — the maybeComputeFOV trick applied to navigation.
export function getPlayerField(state, clearance = 1) {
  const nav = buildNavGrid(state.map)
  const p = state.player
  const cache = state._flowFields ?? (state._flowFields = {})
  const c = cache[clearance]
  if (!c || c.x !== p.x || c.y !== p.y || c.nav !== nav) {
    cache[clearance] = { x: p.x, y: p.y, nav, field: buildFlowField(nav, p.x, p.y, clearance) }
  }
  return cache[clearance].field
}

// Push-apart vector from nearby living enemies so groups fan out.
function separation(e, state) {
  let sx = 0, sy = 0
  for (const o of state.entities) {
    if (o === e || o.type === 'player' || o.maxHp === undefined || o.px === undefined) continue
    const dx = e.px - o.px, dy = e.py - o.py
    const d = Math.hypot(dx, dy)
    if (d > 0 && d < SEP_RADIUS) {
      const k = (1 - d / SEP_RADIUS) / d
      sx += dx * k; sy += dy * k
    }
  }
  return [sx, sy]
}

// Steer in direction (dx,dy): adds separation, then moves per-axis so walls
// slide instead of stopping dead. Returns true if any axis moved.
function moveDir(e, state, delta, dx, dy, speed) {
  const half = e.aiHalf ?? 4
  const map = state.map
  const len = Math.hypot(dx, dy)
  if (len < 1e-6 || speed <= 0) return false
  if (!canMoveTo(map, e.px, e.py, half)) { escapeMove(e, state, delta, speed); return true }
  const [sx, sy] = separation(e, state)
  const vx = dx / len + sx * SEP_WEIGHT, vy = dy / len + sy * SEP_WEIGHT
  const vlen = Math.hypot(vx, vy) || 1
  const mx = (vx / vlen) * speed * delta, my = (vy / vlen) * speed * delta
  let moved = false
  // 1e-6 px threshold: cos(PI/2) leaves ~1e-17 residue that must not count as movement
  if (Math.abs(mx) > 1e-6 && canMoveTo(map, e.px + mx, e.py, half)) { e.px += mx; moved = true }
  if (Math.abs(my) > 1e-6 && canMoveTo(map, e.px, e.py + my, half)) { e.py += my; moved = true }
  e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
  return moved
}

// Wedged in geometry (bad spawn / knockback): walk toward the nearest
// passable tile centre ignoring collision — reducing penetration is always OK.
function escapeMove(e, state, delta, speed) {
  const nav = buildNavGrid(state.map)
  const t = nearestPassable(nav, e.x, e.y, clearanceFor(e.aiHalf ?? 4)) ?? { x: e.x, y: e.y }
  const cx = t.x * S + S / 2, cy = t.y * S + S / 2
  const d = Math.hypot(cx - e.px, cy - e.py) || 1
  e.px += ((cx - e.px) / d) * speed * delta
  e.py += ((cy - e.py) / d) * speed * delta
  e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
}

// Follow a cached A* path to `target` (tile coords). Repaths when the target
// tile changes or REPATH_INTERVAL expires. On an unpathable target, leaves
// e.ai.path === null (brain's give-up timer reads this) and steers directly.
function followPath(e, state, delta, target, speed) {
  const ai = e.ai
  const nav = buildNavGrid(state.map)
  const clearance = clearanceFor(e.aiHalf ?? 4)
  ai.repath = Math.max(0, (ai.repath ?? 0) - delta)
  const targetMoved = !ai.pathTarget || ai.pathTarget.x !== target.x || ai.pathTarget.y !== target.y
  if (ai.path === undefined || targetMoved || ai.repath <= 0) {
    ai.path = findPath(nav, e.x, e.y, target.x, target.y, clearance)
    ai.pathTarget = { x: target.x, y: target.y }
    ai.repath = REPATH_INTERVAL
  }
  if (!ai.path) {
    return moveDir(e, state, delta, target.x * S + S / 2 - e.px, target.y * S + S / 2 - e.py, speed)
  }
  while (ai.path.length &&
         Math.hypot(ai.path[0].x * S + S / 2 - e.px, ai.path[0].y * S + S / 2 - e.py) < WAYPOINT_REACHED) {
    ai.path.shift()
  }
  // smooth: skip a waypoint when the one after it is directly visible.
  // Small entities only — a wide body could clip the corner the skip cuts.
  while (clearance === 1 && ai.path.length >= 2 &&
         hasLineOfSight(state.map, e.y, e.x, ai.path[1].y, ai.path[1].x)) {
    ai.path.shift()
  }
  if (!ai.path.length) return false
  const wp = ai.path[0]
  return moveDir(e, state, delta, wp.x * S + S / 2 - e.px, wp.y * S + S / 2 - e.py, speed)
}

// One flow-field step: move toward the best downhill/uphill neighbour tile.
function followField(e, state, delta, speed, dir) {
  const clearance = clearanceFor(e.aiHalf ?? 4)
  const nav = buildNavGrid(state.map)
  const field = getPlayerField(state, clearance)
  const step = fieldStep(field, nav, e.x, e.y, clearance, dir)
  if (!step) return false
  return moveDir(e, state, delta, step.x * S + S / 2 - e.px, step.y * S + S / 2 - e.py, speed)
}

export function act(e, state, delta, intent) {
  if (!e.ai) e.ai = {}
  const { player, map } = state
  const speed = intent.speed ?? 60
  const dist = Math.hypot(player.px - e.px, player.py - e.py)
  switch (intent.mode) {
    case 'hold':
      return false
    case 'patrol':
      return followPath(e, state, delta, intent.target, speed)
    case 'approach': {
      if (intent.target) return followPath(e, state, delta, intent.target, speed)
      if (intent.stopRange && dist <= intent.stopRange) return false
      // close + visible: beeline, avoids tile-centre zigzag at melee range
      if (dist < 3 * S && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
        return moveDir(e, state, delta, player.px - e.px, player.py - e.py, speed)
      }
      return followField(e, state, delta, speed, 'down')
    }
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/act.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/act.js test/act.test.js
git commit -m "feat(act): movement executor with flow-field/A* following, separation and escape"
```

---

### Task 6: act.js — kite, flee, strafe, charge modes

**Files:**
- Modify: `renderer/systems/act.js`
- Test: `test/act.test.js` (append)

**Interfaces:**
- Consumes: Task 5 internals (`moveDir`, `followField`, `canMoveTo`).
- Produces: `act` handles four more intents:
  - `{ mode: 'flee', speed }` — uphill on the player field; returns false when cornered (caller/brain treats that as "stand and fight").
  - `{ mode: 'kite', band: [min, max], speed }` — below min flee, above max approach, inside the band strafe.
  - `{ mode: 'strafe', speed, inward = 0 }` — orbit the player blending `inward` fraction toward them (the crab's 30/70 blend = `inward: 0.3`); flips `e.ai.strafeDir` on a timer (2–3 s) or when blocked.
  - `{ mode: 'charge', angle, speed }` — straight full-vector dash, **no separation, no sliding**; returns false the moment the swept box would hit a wall (cyclops reads false → stunned).

- [ ] **Step 1: Write the failing tests**

Append to `test/act.test.js`:

```js
describe('act flee and kite', () => {
  it('flee moves away from the player; cornered flee returns false', () => {
    // dead-end corridor: floor at y=4, x=1..5
    const map = createMap(8, 8)
    for (let x = 1; x <= 5; x++) map[4][x].tile = TILE.FLOOR
    const e = enemyAt(3, 4)
    const state = makeState(map, { x: 5, y: 4 }, [e])
    const d0 = Math.hypot(e.px - state.player.px, e.py - state.player.py)
    for (let i = 0; i < 60; i++) act(e, state, 1 / 60, { mode: 'flee', speed: 80 })
    assert.ok(Math.hypot(e.px - state.player.px, e.py - state.player.py) > d0, 'moved away')
    // pin it at the closed end: no uphill neighbour left
    const cornered = enemyAt(1, 4)
    const state2 = makeState(map, { x: 5, y: 4 }, [cornered])
    assert.equal(act(cornered, state2, 1 / 60, { mode: 'flee', speed: 80 }), false)
  })

  it('kite backs off when too close and closes when too far', () => {
    const map = columnMap()
    const close = enemyAt(8, 2) // player right next door
    const state = makeState(map, { x: 9, y: 2 }, [close])
    for (let i = 0; i < 60; i++) act(close, state, 1 / 60, { mode: 'kite', band: [70, 120], speed: 80 })
    assert.ok(Math.hypot(close.px - state.player.px, close.py - state.player.py) > 40, 'backed away')

    const far = enemyAt(2, 6)
    const state2 = makeState(map, { x: 9, y: 2 }, [far])
    const d0 = Math.hypot(far.px - state2.player.px, far.py - state2.player.py)
    for (let i = 0; i < 60; i++) act(far, state2, 1 / 60, { mode: 'kite', band: [70, 120], speed: 80 })
    assert.ok(Math.hypot(far.px - state2.player.px, far.py - state2.player.py) < d0, 'closed in')
  })
})

describe('act strafe', () => {
  it('orbits without net approach when inward is 0, and flips when blocked', () => {
    const map = columnMap()
    const e = enemyAt(5, 2)
    e.ai.strafeDir = 1
    const state = makeState(map, { x: 5, y: 5 }, [e])
    const d0 = Math.hypot(e.px - state.player.px, e.py - state.player.py)
    for (let i = 0; i < 30; i++) act(e, state, 1 / 60, { mode: 'strafe', speed: 60, inward: 0 })
    const d1 = Math.hypot(e.px - state.player.px, e.py - state.player.py)
    assert.ok(Math.abs(d1 - d0) < 24, 'roughly constant orbit distance')
    // fully blocked strafe flips direction immediately: 1-wide corridor,
    // player due east, so strafe dir 1 pushes straight into the south wall
    const corridor = createMap(8, 8)
    for (let x = 1; x <= 5; x++) corridor[4][x].tile = TILE.FLOOR
    const wallHugger = enemyAt(2, 4)
    wallHugger.ai.strafeDir = 1
    wallHugger.ai.strafeTimer = 999 // pin the periodic flip; only blocking may flip
    const s2 = makeState(corridor, { x: 5, y: 4 }, [wallHugger])
    act(wallHugger, s2, 1 / 60, { mode: 'strafe', speed: 80, inward: 0 })
    assert.equal(wallHugger.ai.strafeDir, -1, 'strafeDir flipped at the wall')
  })
})

describe('act charge', () => {
  it('dashes in a straight line and reports a wall hit as false', () => {
    const map = columnMap()
    const e = enemyAt(2, 2)
    const state = makeState(map, { x: 9, y: 7 }, [e])
    assert.equal(act(e, state, 1 / 60, { mode: 'charge', angle: 0, speed: 300 }), true)
    assert.ok(e.px > 2 * 32 + 16)
    // charge due east until the wall stops it
    let blocked = false
    for (let i = 0; i < 240 && !blocked; i++) {
      blocked = !act(e, state, 1 / 60, { mode: 'charge', angle: 0, speed: 300 })
    }
    assert.ok(blocked, 'charge reported the wall')
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/act.test.js`
Expected: FAIL — flee/kite/strafe/charge cases return false / don't move (unhandled modes).

- [ ] **Step 3: Extend the implementation**

In `renderer/systems/act.js`, add the four cases to the `switch` in `act` (before the closing `return false`):

```js
    case 'flee':
      return followField(e, state, delta, speed, 'up')   // false = cornered: stand and fight
    case 'kite': {
      if (dist < intent.band[0]) return followField(e, state, delta, speed, 'up')
      if (dist > intent.band[1]) return act(e, state, delta, { ...intent, mode: 'approach', target: undefined })
      return act(e, state, delta, { mode: 'strafe', speed: speed * 0.7, inward: 0 })
    }
    case 'strafe': {
      if (e.ai.strafeDir === undefined) e.ai.strafeDir = Math.random() < 0.5 ? 1 : -1
      e.ai.strafeTimer = (e.ai.strafeTimer ?? (2 + Math.random())) - delta
      if (e.ai.strafeTimer <= 0) { e.ai.strafeDir = -e.ai.strafeDir; e.ai.strafeTimer = 2 + Math.random() }
      const toAngle = Math.atan2(player.py - e.py, player.px - e.px)
      const inward = intent.inward ?? 0
      const perp = toAngle + (Math.PI / 2) * e.ai.strafeDir
      const dx = Math.cos(toAngle) * inward + Math.cos(perp) * (1 - inward)
      const dy = Math.sin(toAngle) * inward + Math.sin(perp) * (1 - inward)
      const moved = moveDir(e, state, delta, dx, dy, speed)
      if (!moved) { e.ai.strafeDir = -e.ai.strafeDir; e.ai.strafeTimer = 2 + Math.random() }
      return moved
    }
    case 'charge': {
      const mx = Math.cos(intent.angle) * speed * delta
      const my = Math.sin(intent.angle) * speed * delta
      if (!canMoveTo(map, e.px + mx, e.py + my, e.aiHalf ?? 4)) return false
      e.px += mx; e.py += my
      e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
      return true
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/act.test.js`
Expected: PASS. Note the strafe wall-flip test: axis-separated `moveDir` can slide along the wall (returning true), so the flip may come from the periodic timer instead — the loop allows 120 frames (2 s simulated) to cover both routes; if it proves flaky, pin `e.ai.strafeTimer = 999` and assert the *blocked* flip only with both axes obstructed (put the enemy in the corridor map's closed end instead).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/act.js test/act.test.js
git commit -m "feat(act): kite, flee, strafe and charge movement modes"
```

---

### Task 7: brain.js — perception: chase, hunt, flee

**Files:**
- Create: `renderer/systems/brain.js`
- Test: `test/brain.test.js`

**Interfaces:**
- Consumes: `getAIConfig` from `renderer/data/enemy-ai.js`; `hasLineOfSight`, `TILE` from `entities.js`; `buildNavGrid`, `findPath`, `clearanceFor`, `passable` from `nav.js`.
- Produces:
  - `updateBrain(e, state, delta) -> intent` — the per-frame decision. Reads/writes `e.ai` (`mode`, `lastSeen`, `huntWait`, `giveUp`, `dwell`, `patrolIdx`, `patrolPoints`) and sets `e.aiHalf` on first call.
  - `ensureAI(e, state, cfg) -> e.ai` — lazy init (exported for tests and spawns).
  - Exported tuning consts: `HUNT_PAUSE = 1.5`, `UNREACHABLE_GIVEUP = 3`.
  - In this task, patrol intents are stubbed: with `ai.patrolPoints` empty (patrol generation arrives in Task 8), idle enemies get `{ mode: 'hold' }`.

- [ ] **Step 1: Write the failing tests**

Create `test/brain.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { updateBrain, HUNT_PAUSE } from '../renderer/systems/brain.js'

const S = 32
// 14x9: floor interior with a wall spur at x=7, y=1..5 (LOS blocker to hide behind)
function spurMap() {
  const map = createMap(14, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 13; x++) map[y][x].tile = TILE.FLOOR
  for (let y = 1; y <= 5; y++) map[y][7].tile = TILE.WALL
  return map
}
function makeState(map, playerTile, enemies = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities: enemies }
}
function guardAt(x, y, hp = 4) {
  return { type: 'guard', maxHp: 4, hp, x, y, px: x * S + S / 2, py: y * S + S / 2 }
}

describe('updateBrain perception', () => {
  it('visible player within sight -> chase (approach intent)', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'approach')
    assert.equal(e.ai.mode, 'chase')
    assert.deepEqual(e.ai.lastSeen, { x: 5, y: 3 })
  })

  it('losing LOS -> hunt toward the last seen tile', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    updateBrain(e, state, 1 / 60)                    // sees the player at (5,3)
    state.player.x = 10; state.player.y = 3          // teleport behind the wall spur
    state.player.px = 10 * S + S / 2; state.player.py = 3 * S + S / 2
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'hunt')
    assert.equal(intent.mode, 'approach')
    assert.deepEqual(intent.target, { x: 5, y: 3 })  // heads to where it last saw them
  })

  it('arriving at the last-seen tile with nothing there -> pause, then patrol', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    updateBrain(e, state, 1 / 60)
    state.player.x = 10; state.player.px = 10 * S + S / 2   // beyond sight range AND behind the spur
    updateBrain(e, state, 1 / 60)                            // now hunting
    e.x = 5; e.y = 3; e.px = 5 * S + S / 2; e.py = 3 * S + S / 2  // teleport to last-seen
    const holding = updateBrain(e, state, 1 / 60)
    assert.equal(holding.mode, 'hold')                       // looking around
    for (let t = 0; t < HUNT_PAUSE + 0.1; t += 1 / 60) updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'patrol')
  })

  it('a badly hurt guard flees while the player is near', () => {
    const map = spurMap()
    const e = guardAt(3, 3, 1)   // 1/4 HP, guard fleeHp default 0.3
    const state = makeState(map, { x: 5, y: 3 }, [e])
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'flee')
  })

  it('kiting and strafing types get their configured combat intents', () => {
    const map = spurMap()
    const spider = { type: 'monster', variant: 'medium', maxHp: 2, hp: 2, x: 3, y: 3, px: 3 * S + S / 2, py: 3 * S + S / 2 }
    const crab = { type: 'crab', maxHp: 6, hp: 6, x: 3, y: 5, px: 3 * S + S / 2, py: 5 * S + S / 2 }
    const state = makeState(map, { x: 5, y: 3 }, [spider, crab])
    assert.equal(updateBrain(spider, state, 1 / 60).mode, 'kite')
    const crabIntent = updateBrain(crab, state, 1 / 60)
    assert.equal(crabIntent.mode, 'strafe')
    assert.equal(crabIntent.inward, 0.3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/brain.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/brain.js`:

```js
// Perception + intent: decides WHAT an enemy wants — chase the player, hunt a
// last-known position, patrol, flee, kite — and emits an intent object for
// act() to execute. Never moves anything itself.
import { hasLineOfSight, TILE } from './entities.js'
import { buildNavGrid, findPath, clearanceFor, passable } from './nav.js'
import { getAIConfig } from '../data/enemy-ai.js'

const S = 32
export const HUNT_PAUSE = 1.5        // s spent looking around where the trail ends
export const UNREACHABLE_GIVEUP = 3  // s steering at an unpathable target before quitting
const DWELL = 1.2                    // s paused at each patrol point

export function ensureAI(e, state, cfg) {
  if (e.ai?.patrolPoints) return e.ai
  e.aiHalf = cfg.half
  e.ai = {
    ...(e.ai ?? {}),
    mode: 'patrol', lastSeen: null, huntWait: 0, dwell: 0, giveUp: 0, patrolIdx: 0,
    patrolPoints: [],   // Task 8 fills this via generatePatrol
    path: undefined, pathTarget: null, repath: 0,
  }
  return e.ai
}

export function updateBrain(e, state, delta) {
  const cfg = getAIConfig(e)
  const ai = ensureAI(e, state, cfg)
  const { player, map } = state
  const dist = Math.hypot(player.px - e.px, player.py - e.py)
  const seen = dist <= cfg.sightRange && hasLineOfSight(map, e.y, e.x, player.y, player.x)

  if (seen) {
    ai.mode = 'chase'
    ai.lastSeen = { x: player.x, y: player.y }
    ai.huntWait = 0; ai.giveUp = 0
  } else if (ai.mode === 'chase') {
    ai.mode = 'hunt'; ai.huntWait = 0; ai.giveUp = 0
  }

  // hurt + threat nearby -> run; config decides who routs (taxon sets defaults)
  if (cfg.fleeHp > 0 && e.maxHp && e.hp / e.maxHp <= cfg.fleeHp && dist < cfg.sightRange * 1.25) {
    return { mode: 'flee', speed: cfg.speed }
  }

  if (ai.mode === 'chase') {
    if (cfg.combat === 'strafe') return { mode: 'strafe', inward: cfg.inward ?? 0.3, speed: cfg.speed }
    if (cfg.kiteBand) return { mode: 'kite', band: cfg.kiteBand, speed: cfg.speed }
    return { mode: 'approach', speed: cfg.speed, stopRange: cfg.stopRange }
  }

  if (ai.mode === 'hunt' && ai.lastSeen) {
    const t = ai.lastSeen
    const arrived = Math.hypot(t.x * S + S / 2 - e.px, t.y * S + S / 2 - e.py) < S
    // act() left path === null for this exact target -> it is unreachable
    const unpathable = ai.path === null && ai.pathTarget &&
                       ai.pathTarget.x === t.x && ai.pathTarget.y === t.y
    if (unpathable) {
      ai.giveUp += delta
      if (ai.giveUp >= UNREACHABLE_GIVEUP) {
        ai.mode = 'patrol'; ai.lastSeen = null; ai.giveUp = 0
        return { mode: 'hold' }
      }
    }
    if (arrived) {
      ai.huntWait += delta
      if (ai.huntWait >= HUNT_PAUSE) { ai.mode = 'patrol'; ai.lastSeen = null }
      return { mode: 'hold' }
    }
    return { mode: 'approach', target: t, speed: cfg.speed }
  }

  // patrol (points generated in Task 8; empty -> stand watch)
  ai.mode = 'patrol'
  if (!ai.patrolPoints.length) return { mode: 'hold' }
  const pt = ai.patrolPoints[ai.patrolIdx]
  const arrivedAtPt = Math.hypot(pt.x * S + S / 2 - e.px, pt.y * S + S / 2 - e.py) < S * 0.75
  const unpathablePt = ai.path === null && ai.pathTarget &&
                       ai.pathTarget.x === pt.x && ai.pathTarget.y === pt.y
  if (unpathablePt) {
    ai.giveUp += delta
    if (ai.giveUp >= UNREACHABLE_GIVEUP) {
      ai.giveUp = 0
      ai.patrolIdx = (ai.patrolIdx + 1) % ai.patrolPoints.length
      return { mode: 'hold' }
    }
  }
  if (arrivedAtPt) {
    ai.dwell += delta
    if (ai.dwell >= DWELL) {
      ai.dwell = 0
      ai.patrolIdx = (ai.patrolIdx + 1) % ai.patrolPoints.length
    }
    return { mode: 'hold' }
  }
  return { mode: 'patrol', target: pt, speed: cfg.wanderSpeed }
}
```

Note the unused imports (`TILE`, `buildNavGrid`, `findPath`, `clearanceFor`, `passable`) — Task 8's `generatePatrol` uses them; keeping the import line stable avoids churn.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/brain.test.js`
Expected: PASS. The third test's teleport-hide step: player at tile (10,3), enemy hunting from (3,3) — the spur at x=7 spans y=1..5 so LOS along y=3 is blocked; verify with the test output, and if LOS sneaks through, extend the spur (`y <= 6`).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/brain.js test/brain.test.js
git commit -m "feat(brain): perception loop — chase, hunt-to-last-seen, flee, give-up"
```

---

### Task 8: brain.js — auto-generated patrols

**Files:**
- Modify: `renderer/systems/brain.js`
- Test: `test/brain.test.js` (append)

**Interfaces:**
- Consumes: Task 7's `ensureAI` and imports.
- Produces: `generatePatrol(nav, map, x, y, cfg = {}) -> [{x, y}, ...]` (exported; up to 3 points, each ≥ 2 and ≤ 8 tiles away, mutually ≥ 3 tiles apart, all A\*-reachable, preferring feature tiles: DOOR, TREASURE, SHRINE, STAIRS_DOWN, STAIRS_UP). `ensureAI` now fills `ai.patrolPoints` with it. Deterministic — no randomness, so tests are stable.

- [ ] **Step 1: Write the failing tests**

Append to `test/brain.test.js`:

```js
import { generatePatrol, ensureAI } from '../renderer/systems/brain.js'
import { buildNavGrid, findPath } from '../renderer/systems/nav.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'

describe('generatePatrol', () => {
  it('picks 2-3 reachable, spread-out points near the spawn', () => {
    const map = spurMap()
    const nav = buildNavGrid(map)
    const pts = generatePatrol(nav, map, 3, 3, { half: 4 })
    assert.ok(pts.length >= 2 && pts.length <= 3, `got ${pts.length} points`)
    for (const p of pts) {
      const d = Math.hypot(p.x - 3, p.y - 3)
      assert.ok(d >= 2 && d <= 8, `point (${p.x},${p.y}) at distance ${d}`)
      assert.ok(findPath(nav, 3, 3, p.x, p.y, 1) !== null, 'reachable')
    }
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 3, 'spread out')
  })

  it('prefers feature tiles like a shrine', () => {
    const map = spurMap()
    map[6][4].tile = TILE.SHRINE
    const nav = buildNavGrid(map)
    const pts = generatePatrol(nav, map, 3, 3, { half: 4 })
    assert.ok(pts.some(p => p.x === 4 && p.y === 6), 'shrine tile chosen as a patrol point')
  })

  it('ensureAI wires patrol points into e.ai', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 11, y: 7 }, [e])
    ensureAI(e, state, getAIConfig(e))
    assert.ok(e.ai.patrolPoints.length >= 2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/brain.test.js`
Expected: FAIL — `generatePatrol` is not exported / patrolPoints empty.

- [ ] **Step 3: Write the implementation**

In `renderer/systems/brain.js`, add below the consts:

```js
const PATROL_RADIUS = 8
const FEATURE_TILES = new Set([TILE.DOOR, TILE.TREASURE, TILE.SHRINE, TILE.STAIRS_DOWN, TILE.STAIRS_UP])

// Up to 3 patrol points near (x,y): feature tiles first, then the farthest
// open tiles; every point A*-reachable and >= 3 tiles from the others.
// Deterministic on purpose (stable tests, reproducible behavior).
export function generatePatrol(nav, map, x, y, cfg = {}) {
  const clearance = clearanceFor(cfg.half ?? 4)
  const cands = []
  for (let dy = -PATROL_RADIUS; dy <= PATROL_RADIUS; dy++) {
    for (let dx = -PATROL_RADIUS; dx <= PATROL_RADIUS; dx++) {
      const tx = x + dx, ty = y + dy
      const t = map[ty]?.[tx]
      if (!t || !passable(nav, tx, ty, clearance)) continue
      const d = Math.hypot(dx, dy)
      if (d < 2 || d > PATROL_RADIUS) continue
      cands.push({ x: tx, y: ty, feature: FEATURE_TILES.has(t.tile) ? 1 : 0, d })
    }
  }
  cands.sort((a, b) => (b.feature - a.feature) || (b.d - a.d))
  const points = []
  for (const c of cands) {
    if (points.length >= 3) break
    if (points.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 3)) continue
    if (!findPath(nav, x, y, c.x, c.y, clearance)) continue
    points.push({ x: c.x, y: c.y })
  }
  return points
}
```

And in `ensureAI`, replace `patrolPoints: [],   // Task 8 fills this via generatePatrol` with:

```js
    patrolPoints: generatePatrol(buildNavGrid(state.map), state.map, e.x, e.y, cfg),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/brain.test.js`
Expected: PASS (including Task 7's tests — the third test now ends in `patrol` mode with real points, which is still `patrol`).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/brain.js test/brain.test.js
git commit -m "feat(brain): auto-generated patrol routes preferring feature tiles"
```

---

### Task 9: game.js — switch basic enemies to brain + act

**Files:**
- Modify: `renderer/game.js` (imports ~line 2–19; constants lines 23–26; spawn init `wander()` ~line 136–146; enemy movement block lines ~468–487)

**Interfaces:**
- Consumes: `updateBrain` from `./systems/brain.js`, `act` from `./systems/act.js`.
- Produces: guards, monsters (all variants), and the mini-dragon now chase/hunt/patrol/kite/flee via the new AI. No new exports.

- [ ] **Step 1: Add imports**

In `renderer/game.js`, after the existing system imports (near line 18):

```js
import { updateBrain } from './systems/brain.js'
import { act } from './systems/act.js'
```

- [ ] **Step 2: Replace the movement block**

Find the shared enemy loop (after the four custom-enemy dispatch lines). Replace this exact block:

```js
    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    e.wanderTimer    = Math.max(0, e.wanderTimer    - delta)
    const dist = Math.hypot(e.px - player.px, e.py - player.py)
    const chasing = dist < CHASE_RANGE && hasLineOfSight(map, e.y, e.x, player.y, player.x)
    const canMove = e.type !== 'dragon' || e.breathState === 'idle'
    const prevPx = e.px
    if (canMove && chasing && dist > CONTACT_RANGE) {
      const len = dist || 1
      const speed = e.type === 'dragon' ? 60 : ENEMY_CHASE_SPEED
      moveEntity(e, (player.px - e.px) / len * speed * delta, (player.py - e.py) / len * speed * delta, map, ENEMY_HALF)
    } else if (canMove && dist < CHASE_DROP_RANGE) {
      if (e.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2
        e.wanderDx = Math.cos(angle); e.wanderDy = Math.sin(angle)
        e.wanderTimer = 1 + Math.random()
      }
      moveEntity(e, e.wanderDx * ENEMY_WANDER_SPEED * delta, e.wanderDy * ENEMY_WANDER_SPEED * delta, map, ENEMY_HALF)
    }
    const movedX = e.px - prevPx
    if (Math.abs(movedX) > 0.1) e.facing = movedX > 0 ? 'east' : 'west'
```

with:

```js
    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    const dist = Math.hypot(e.px - player.px, e.py - player.py)
    const canMove = e.type !== 'dragon' || e.breathState === 'idle'
    const prevPx = e.px
    if (canMove) act(e, state, delta, updateBrain(e, state, delta))
    const movedX = e.px - prevPx
    if (Math.abs(movedX) > 0.1) e.facing = movedX > 0 ? 'east' : 'west'
```

`dist` stays — the spider-shoot and dragon-breath code below still reads it.

- [ ] **Step 3: Clean out the wander machinery and dead constants**

- Rename the spawn-init helper (line ~136) from
  `const wander = () => ({ wanderTimer: Math.random() * 2, wanderDx: 0, wanderDy: 0, damageCooldown: 0 })`
  to
  `const aiInit = () => ({ damageCooldown: 0 })`
  and update its three call sites (`guard`, `monster`, dragon spawn) from `...wander()` to `...aiInit()`.
- Delete constants `ENEMY_CHASE_SPEED`, `ENEMY_WANDER_SPEED`, `CHASE_RANGE`, `CHASE_DROP_RANGE` (lines 23–26). First verify nothing else references them: `grep -n "ENEMY_CHASE_SPEED\|ENEMY_WANDER_SPEED\|CHASE_RANGE\|CHASE_DROP_RANGE" renderer/ -r` — expected: only the lines you are deleting. Keep `CONTACT_RANGE` (spider-shoot uses it) and `ENEMY_HALF` (knockback resolution line ~639 uses it).
- Check whether `moveEntity` still has callers: `grep -n "moveEntity" renderer/game.js`. Player movement uses it — keep it. If only its definition remains, delete it.

- [ ] **Step 4: Run the full suite and smoke-test**

Run: `npm test`
Expected: PASS. If an existing test (e.g. `test/arena.test.js`, `test/boss-test-arena.test.js`) constructed enemies with `wanderTimer` expectations or stepped the old chase logic, update it to the new behavior — the contract to preserve is *observable*: an enemy with line of sight within its sight range closes distance to the player; out-of-sight enemies no longer teleport-forget (they hunt).

Then a 10-second manual check: `npm start`, walk near a monster, confirm it follows you around a corner instead of hugging the wall.

- [ ] **Step 5: Commit**

```bash
git add renderer/game.js test/
git commit -m "feat(game): basic enemies use brain+act pathfinding (chase/hunt/patrol/kite/flee)"
```

---

### Task 10: wizard.js and crab.js — route movement through act()

**Files:**
- Modify: `renderer/systems/wizard.js`, `renderer/systems/crab.js`
- Test: `test/wizard.test.js`, `test/crab.test.js` (adapt existing)

**Interfaces:**
- Consumes: `updateBrain`, `act` (same signatures as Task 9).
- Produces: no new exports; `makeWizard`/`makeCrab` lose their `strafeDir`/`strafeDirTimer` fields (act owns strafe state in `e.ai`).

- [ ] **Step 1: Migrate wizard.js**

- Add imports: `import { updateBrain } from './brain.js'` and `import { act } from './act.js'`.
- Delete the local `canMoveTo` helper and the `isWalkable` import (now unused; keep `hasLineOfSight`, `makeMonster`).
- In `makeWizard`, remove `strafeDir: 1` and `strafeDirTimer: 2 + Math.random()`.
- In `updateWizard`, delete the strafe-flip block (`e.strafeDirTimer = ...` through the flip `if`) and the whole "Kiting movement" block (from `const toAngle = ...` is still needed by spells — **keep the `toAngle` line**, it is used by spell aiming; delete only the `if (dist < FLEE_RANGE) ... else ...` movement and the `e.x = ...; e.y = ...` lines that follow it). Replace with:

```js
  act(e, state, delta, updateBrain(e, state, delta))
```

- Delete the now-unused `FLEE_SPEED`, `STRAFE_SPEED`, `FLEE_RANGE`, `ENEMY_HALF` consts (wizard kite band now lives in `renderer/data/enemy-ai.js` as `[120, 240]`).
- In the summon block, remove `wanderTimer: 0, wanderDx: 0, wanderDy: 0,` from the pushed minion (keep `damageCooldown: 0`).

- [ ] **Step 2: Migrate crab.js**

- Add the same two imports; delete local `canMoveTo` and the `isWalkable` import; delete `CRAB_SPEED` (speed 65 now in config) and `CRAB_HALF`.
- In `makeCrab`, remove `strafeDir` and `strafeDirTimer`.
- In `updateCrab`, delete the strafe-flip block and the "Strafe movement" block (the vector math through `e.y = Math.floor(...)`). Replace with:

```js
  act(e, state, delta, updateBrain(e, state, delta))
```

- Keep untouched: cooldown ticking, `e.facing` tracking, the grab state machine (it `return`s early while grabbing, so `act` is skipped — state-machine priority per the spec), the grab trigger, and `tryStartEnemyAttack`.

- [ ] **Step 3: Adapt the existing tests**

Run: `node --test test/wizard.test.js test/crab.test.js`
Likely failures: tests asserting `strafeDir` fields on the maker objects, or stepping movement on a minimal/absent map. Fixes:
- Maker-shape assertions: drop the removed fields from expectations.
- Movement tests: give the state a real map (`createMap(w, h)` + floor fill, as in `test/act.test.js`) and assert the *observable* contract instead of exact positions: wizard within 120 px of the player moves away over 60 frames; crab with line of sight orbits (distance to player roughly constant while its angle around the player changes).
- The grab machine tests should pass unchanged — if they don't, that's a regression in your migration, not the tests.

Expected after fixes: PASS.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/wizard.js renderer/systems/crab.js test/wizard.test.js test/crab.test.js
git commit -m "refactor(enemies): wizard kites and crab strafes through the shared act() brain"
```

---

### Task 11: cyclops.js and dragonboss.js — wide-clearance navigation

**Files:**
- Modify: `renderer/systems/cyclops.js`, `renderer/systems/dragonboss.js`
- Test: `test/cyclops.test.js`, `test/dragonboss.test.js` (adapt existing)

**Interfaces:**
- Consumes: `updateBrain`, `act`; `buildNavGrid`, `findPath` from `./nav.js` (dragonboss).
- Produces: no new exports. Cyclops chases via the clearance-2 flow field (its `half: 28` config makes `clearanceFor` return 2 automatically); its charge stays deliberately dumb. Dragon boss stomp-steps follow A\*.

- [ ] **Step 1: Migrate cyclops.js**

- Add imports: `import { updateBrain } from './brain.js'`, `import { act } from './act.js'`; delete local `canMoveTo` and the `isWalkable` import (keep `hasLineOfSight`).
- In the `'chase'` state, replace the "Move toward player" block (the `if (dist > CONTACT_RANGE) { ... }` movement) with:

```js
    act(e, state, delta, updateBrain(e, state, delta))
```

(The config `stopRange: 40` reproduces the old `dist > CONTACT_RANGE` gate. Brain always runs in chase state first, which sets `e.aiHalf = 28` before any charge can occur.)
- In the `'charging'` state, replace the movement + wall check with:

```js
  } else if (e.state === 'charging') {
    if (Math.hypot(e.px - player.px, e.py - player.py) < 50) {
      if (damagePlayer(state, 5, 'hit', 'Cyclops charges! (-5 HP)')) {
        startKnockback(player, player.px - e.px, player.py - e.py, KNOCKBACK_DIST)
        e.inCombat = true
      }
      e.state = 'stunned'
      e.stateTimer = 0.5
    } else if (!act(e, state, delta, { mode: 'charge', angle: e.chargeAngle, speed: CYCLOPS_CHARGE_SPEED })) {
      e.state = 'stunned'
      e.stateTimer = 2.5
    }

    if (e.state === 'charging' && e.stateTimer <= 0) {
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }
```

- Delete the now-unused `CYCLOPS_SPEED` and `CYCLOPS_HALF` consts (both live in config now).

- [ ] **Step 2: Migrate dragonboss.js `startStomp`**

Add `import { buildNavGrid, findPath } from './nav.js'` and change `startStomp` to try A\* first, keeping the greedy step as fallback:

```js
// Begin a single grid-step toward the player. A* (clearance 2 — the boss is
// wide) picks the step so the boss rounds obstacles; the old greedy step
// remains as a fallback for tight arenas where clearance-2 has no route.
function startStomp(e, state) {
  const { map, player } = state
  const here = { x: Math.floor(e.px / TILE), y: Math.floor(e.py / TILE) }
  const path = findPath(buildNavGrid(map), here.x, here.y, player.x, player.y, 2)
  if (path && path.length) {
    const step = path[0]
    e.stepFrom = { x: e.px, y: e.py }
    e.stepTo = { x: step.x * TILE + TILE / 2, y: step.y * TILE + TILE / 2 }
    e.stepK = 0; e.crushDone = false; e.state = 'stomp'
    return
  }
  const sx = Math.sign(player.px - e.px), sy = Math.sign(player.py - e.py)
  const cands = [[sx, sy], [sx, 0], [0, sy]].filter(([dx, dy]) => dx !== 0 || dy !== 0)
  for (const [dx, dy] of cands) {
    const tx = here.x + dx, ty = here.y + dy
    if (map[ty]?.[tx] && isWalkable(map[ty][tx].tile, map[ty][tx])) {
      e.stepFrom = { x: e.px, y: e.py }
      e.stepTo = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
      e.stepK = 0; e.crushDone = false; e.state = 'stomp'
      return
    }
  }
  e.state = 'idle'; e.stepTimer = STEP_INTERVAL
}
```

- [ ] **Step 3: Adapt tests and run the full suite**

Run: `node --test test/cyclops.test.js test/dragonboss.test.js test/boss-hitboxes.test.js test/boss-test-arena.test.js`, then `npm test`.
Likely failures: cyclops tests asserting beeline positions after N frames (assert *distance decreased* instead), or a stomp test expecting the greedy step where A\* now picks a different (equally valid) neighbour — assert the step lands on a walkable adjacent tile that reduces path distance, not a specific tile.
Expected after fixes: PASS.

- [ ] **Step 4: Commit**

```bash
git add renderer/systems/cyclops.js renderer/systems/dragonboss.js test/
git commit -m "feat(bosses): cyclops navigates via wide-clearance field; boss stomps follow A*"
```

---

### Task 12: Live verification and docs

**Files:**
- Modify: `/home/lappemikb/CLAUDE.md` (dungeon-crawler architecture bullet)
- No new code.

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 2: Update CLAUDE.md**

In the dungeon-crawler architecture section, extend the systems list:

```
- `renderer/systems/` — gameplay logic: `map`, `walk`, `entities`, `phase`, `progression`, `meta`, `decorate`, enemy AI (`nav` flow-field/A* pathfinding, `brain` perception/intent, `act` movement modes; tuning in `renderer/data/enemy-ai.js`), and enemies (`crab`, `cyclops`, `dragonboss`)
```

- [ ] **Step 3: Live arena runs (arena-test skill)**

Invoke the `arena-test` skill (it enforces its own journal: question + criteria BEFORE each run). Suggested runs, one journal entry each:

1. **Unstick:** arena with a column line between spawn and player; question: "does a monster route around the columns to reach me?"; criterion: enemy reaches melee range within 10 s without grinding a wall.
2. **Kite:** spawn a `medium` monster; criterion: it maintains roughly 70–120 px, backing off when approached, still shooting.
3. **Flee:** spawn a guard, hit it to 1 HP; criterion: it runs away from the player, and turns to fight only when cornered.
4. **Hunt:** aggro a monster, break line of sight behind a wall; criterion: it appears at the corner (last-seen position) instead of forgetting instantly.
5. **Crab strafe + cyclops width:** crab orbits around a column without sticking; cyclops never wedges into a 1-tile gap.

Follow the skill's config/journal workflow exactly (it fetches config before the phase flip — see its SKILL.md).

- [ ] **Step 4: Commit**

```bash
git add /home/lappemikb/CLAUDE.md
git commit -m "docs: note enemy AI modules (nav/brain/act) in architecture overview"
```

---

## Self-Review Notes (kept for the record)

- **Spec coverage:** unstick → Tasks 1–3, 5, 9; hunt-out-of-sight → Task 7; combat movement (separation, wall-aware strafe) → Tasks 5–6; patrol → Task 8; flee/kite per config + taxon → Tasks 4, 6, 7; wide-enemy clearance → Tasks 1–3, 11; edge cases (unreachable give-up → Task 7; wedged escape → Task 5; state-machine priority → Tasks 10–11 keep early returns; perf caching → Tasks 1, 5); testing → every task + Task 12 live runs.
- **Type consistency:** intents are `{ mode, speed, target?, stopRange?, band?, inward?, angle? }` throughout; `target` is always **tile** coords `{x, y}`; paths are arrays of tile coords; `e.ai.path === null` is the unreachable flag read by brain; `e.aiHalf` is the pixel half-size everywhere.
- **Known behavior changes (intended):** guards/rats rout at ≤30 % HP; crab gains sight-based aggro (was omniscient); enemies patrol instead of random-wandering; spider keeps distance.

