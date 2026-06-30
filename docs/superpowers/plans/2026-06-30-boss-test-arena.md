# Dragon Boss Test Arena (Level 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a level-0 debug arena — reachable by typing `level0` on the title screen — containing only the dragon boss and 20 alternating weapon/potion chests, so the boss can be iterated on in isolation.

**Architecture:** A new pure `buildBossTestArena(width, height)` in `renderer/systems/map.js` constructs a single walled room with the boss centered and 20 chests ringed around the interior perimeter, returning the same `{ map, entitySpawns, playerSpawn, rooms }` shape as `generateLevel`. `generateLevel(0, …)` early-returns it, so all existing wiring (`startNewRun` → `buildEntities` → render/update) is unchanged. The `level0` cheat is enabled in `parseLevelCheat`, and a depth-0 `LEVEL_CONFIG` entry + the depth-5 theme supply size and look.

**Tech Stack:** Vanilla ES modules, HTML5 canvas 2D, `node --test`. No new dependencies. Tile size = 32px.

**Reference spec:** `docs/superpowers/specs/2026-06-30-boss-test-arena-design.md`

## Global Constraints

- Vanilla ES modules only; no new dependencies; no bundler.
- Tests are `node:test` files under `test/`, run via `npm test`.
- `FINAL_DEPTH = 5` (`renderer/data/levels.js`). The cheat range becomes `0..FINAL_DEPTH`.
- Tile size = 32px. Maps are indexed `map[y][x]`; `createMap(width, height)` returns `height` rows of `width` cells, all `TILE.WALL` by default.
- Spawn objects use the existing `buildEntities` vocabulary: `{ kind: 'dragon_boss', x, y, isBoss: true }`, `{ kind: 'weapon', x, y, weaponType }`, `{ kind: 'potion', x, y }`.

---

### Task 1: Enable the `level0` cheat

**Files:**
- Modify: `renderer/systems/cheats.js`
- Test: `test/cheats.test.js`

**Interfaces:**
- Produces: `parseLevelCheat(buffer)` now returns `0` for a `level0` suffix (was `null`); unchanged for `1..FINAL_DEPTH`; `null` otherwise.

- [ ] **Step 1: Update the failing test**

In `test/cheats.test.js`, change the out-of-range test so `level0` is no longer expected to be `null`, and add a dedicated assertion. Replace the existing `it('ignores out-of-range depths', …)` block with these two blocks:

```js
  it('accepts level0 as the boss test arena', () => {
    assert.equal(parseLevelCheat('level0'), 0)
  })

  it('ignores out-of-range depths', () => {
    assert.equal(parseLevelCheat('level6'), null)
    assert.equal(parseLevelCheat('level9'), null)
    assert.equal(parseLevelCheat('level10'), null)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/cheats.test.js`
Expected: FAIL — `accepts level0 as the boss test arena` expects `0` but gets `null`.

- [ ] **Step 3: Widen the accepted range in `parseLevelCheat`**

In `renderer/systems/cheats.js`, change the final return so the lower bound is `0`:

```js
export function parseLevelCheat(buffer) {
  const m = /level(\d+)$/.exec(String(buffer).toLowerCase())
  if (!m) return null
  const depth = Number(m[1])
  return depth >= 0 && depth <= FINAL_DEPTH ? depth : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/cheats.test.js`
Expected: PASS (all `parseLevelCheat` cases green).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/cheats.js test/cheats.test.js
git commit -m "feat(cheats): accept level0 for the boss test arena"
```

---

### Task 2: `buildBossTestArena` + `generateLevel` routing

**Files:**
- Modify: `renderer/systems/map.js` (import `WEAPON_TYPES`; add `buildBossTestArena`; route `depth === 0` in `generateLevel`)
- Test: `test/boss-test-arena.test.js` (create)

**Interfaces:**
- Consumes: `createMap(width, height)` and `TILE`, `WEAPON_TYPES` from `./entities.js`.
- Produces: `buildBossTestArena(width, height)` → `{ map, entitySpawns, playerSpawn, rooms }`. `entitySpawns` is `[{ kind:'dragon_boss', x, y, isBoss:true }, …20 chests…]` where chests alternate `{ kind:'weapon', x, y, weaponType }` (even indices) and `{ kind:'potion', x, y }` (odd indices). `generateLevel(0, w, h)` returns the same.

- [ ] **Step 1: Write the failing tests**

Create `test/boss-test-arena.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildBossTestArena, generateLevel } from '../renderer/systems/map.js'
import { TILE, WEAPON_TYPES } from '../renderer/systems/entities.js'

const W = 26, H = 18

describe('buildBossTestArena', () => {
  it('builds a walled room of the requested size', () => {
    const { map } = buildBossTestArena(W, H)
    assert.equal(map.length, H)
    assert.equal(map[0].length, W)
    assert.equal(map[0][0].tile, TILE.WALL)
    assert.equal(map[H - 1][W - 1].tile, TILE.WALL)
    assert.equal(map[1][1].tile, TILE.FLOOR)
    assert.equal(map[H - 2][W - 2].tile, TILE.FLOOR)
  })

  it('spawns exactly one dragon_boss at the center, flagged isBoss', () => {
    const { entitySpawns } = buildBossTestArena(W, H)
    const bosses = entitySpawns.filter(s => s.kind === 'dragon_boss')
    assert.equal(bosses.length, 1)
    assert.equal(bosses[0].x, Math.floor(W / 2))
    assert.equal(bosses[0].y, Math.floor(H / 2))
    assert.equal(bosses[0].isBoss, true)
  })

  it('spawns exactly 20 chests, mixing weapon and potion', () => {
    const { entitySpawns } = buildBossTestArena(W, H)
    const chests = entitySpawns.filter(s => s.kind === 'weapon' || s.kind === 'potion')
    assert.equal(chests.length, 20)
    assert.ok(chests.some(s => s.kind === 'weapon'), 'has weapon chests')
    assert.ok(chests.some(s => s.kind === 'potion'), 'has potion chests')
    for (const w of chests.filter(s => s.kind === 'weapon'))
      assert.ok(WEAPON_TYPES[w.weaponType], `valid weapon type: ${w.weaponType}`)
  })

  it('places every spawn on an in-bounds floor tile', () => {
    const { map, entitySpawns } = buildBossTestArena(W, H)
    for (const s of entitySpawns) {
      assert.ok(s.x >= 0 && s.x < W && s.y >= 0 && s.y < H, `in bounds: ${s.x},${s.y}`)
      assert.equal(map[s.y][s.x].tile, TILE.FLOOR, `floor under spawn ${s.x},${s.y}`)
    }
  })

  it('player spawns on floor, clear of the boss and all chests', () => {
    const { map, entitySpawns, playerSpawn } = buildBossTestArena(W, H)
    assert.equal(map[playerSpawn.y][playerSpawn.x].tile, TILE.FLOOR)
    const onSpawn = entitySpawns.some(s => s.x === playerSpawn.x && s.y === playerSpawn.y)
    assert.equal(onSpawn, false, 'no entity on the player spawn')
  })
})

describe('generateLevel routes depth 0 to the boss arena', () => {
  it('returns the arena (1 boss + 20 chests, no exit door)', () => {
    const { entitySpawns } = generateLevel(0, W, H)
    assert.equal(entitySpawns.filter(s => s.kind === 'dragon_boss').length, 1)
    assert.equal(entitySpawns.filter(s => s.kind === 'weapon' || s.kind === 'potion').length, 20)
    assert.equal(entitySpawns.some(s => s.kind === 'exit_door'), false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/boss-test-arena.test.js`
Expected: FAIL — `buildBossTestArena` is not exported / not a function.

- [ ] **Step 3: Add the `WEAPON_TYPES` import**

In `renderer/systems/map.js`, line 1, extend the entities import:

```js
import { TILE, isWalkable, WEAPON_TYPES } from './entities.js'
```

- [ ] **Step 4: Implement `buildBossTestArena`**

Add this function to `renderer/systems/map.js` (e.g. directly above `export function generateLevel`):

```js
// Build the level-0 debug arena: a single walled room with the dragon boss
// centered and 20 weapon/potion chests ringed around the interior perimeter.
// Pure (map + spawn data only); returns the same shape as generateLevel so the
// startNewRun → buildEntities wiring is unchanged. Deterministic: no randomness.
export function buildBossTestArena(width, height) {
  const map = createMap(width, height) // all TILE.WALL
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++)
      map[y][x].tile = TILE.FLOOR

  const cx = Math.floor(width / 2)
  const cy = Math.floor(height / 2)
  const playerSpawn = { x: cx, y: height - 2 } // bottom-center interior

  const entitySpawns = [{ kind: 'dragon_boss', x: cx, y: cy, isBoss: true }]

  // Ordered ring of interior-perimeter floor cells (clockwise from top-left),
  // minus the player-spawn cell so a chest never lands on the player.
  const ring = []
  for (let x = 1; x <= width - 2; x++)   ring.push({ x, y: 1 })           // top
  for (let y = 2; y <= height - 2; y++)  ring.push({ x: width - 2, y })   // right
  for (let x = width - 3; x >= 1; x--)   ring.push({ x, y: height - 2 })  // bottom
  for (let y = height - 3; y >= 2; y--)  ring.push({ x: 1, y })           // left
  const cells = ring.filter(c => !(c.x === playerSpawn.x && c.y === playerSpawn.y))

  // 20 evenly-spaced chests; alternate weapon/potion, cycling weapon types.
  const weaponKeys = Object.keys(WEAPON_TYPES)
  const CHEST_COUNT = 20
  for (let i = 0; i < CHEST_COUNT; i++) {
    const cell = cells[Math.round(i * cells.length / CHEST_COUNT) % cells.length]
    if (i % 2 === 0) {
      entitySpawns.push({ kind: 'weapon', x: cell.x, y: cell.y, weaponType: weaponKeys[(i / 2) % weaponKeys.length] })
    } else {
      entitySpawns.push({ kind: 'potion', x: cell.x, y: cell.y })
    }
  }

  return { map, entitySpawns, playerSpawn, rooms: [] }
}
```

- [ ] **Step 5: Route depth 0 in `generateLevel`**

In `renderer/systems/map.js`, add an early return as the first line inside `generateLevel` (before `const cfg = …`):

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false, structures = {} } = {}) {
  if (depth === 0) return buildBossTestArena(width, height)
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
  // …unchanged…
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/boss-test-arena.test.js`
Expected: PASS (all 6 cases green).

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/map.js test/boss-test-arena.test.js
git commit -m "feat(map): buildBossTestArena + generateLevel depth-0 routing"
```

---

### Task 3: Depth-0 config + theme wiring

**Files:**
- Modify: `renderer/data/levels.js` (`LEVEL_CONFIG` depth-0 entry; add `0` to the depth-5 theme's `depths`)
- Test: `test/levels-config.test.js`

**Interfaces:**
- Consumes (by `startNewRun`): `LEVEL_CONFIG.find(c => c.depth === 0)` must yield `{ mapW: 26, mapH: 18, … }`; `DEPTH_THEMES.find(t => t.depths.includes(0))` must yield a theme.
- Produces: depth-0 arena renders at 26×18 with the molten boss theme.

- [ ] **Step 1a: Update the existing count test**

Adding a depth-0 entry breaks the existing `'has exactly 5 levels, depths 1..5'` test (it asserts `LEVEL_CONFIG.length === 5` and depths `[1,2,3,4,5]`). In `test/levels-config.test.js`, replace that `it(...)` block (lines 6–9) with one that asserts the 5 *playable* levels plus the depth-0 debug arena:

```js
  it('has 5 playable levels (depths 1..5) plus the depth-0 debug arena', () => {
    const playable = LEVEL_CONFIG.filter(c => c.depth >= 1)
    assert.equal(playable.length, 5)
    assert.deepEqual(playable.map(c => c.depth), [1, 2, 3, 4, 5])
    assert.ok(LEVEL_CONFIG.some(c => c.depth === 0), 'depth-0 debug arena present')
  })
```

The other tests in this file index specific depths (`byDepth[1..5]`) or iterate harmlessly, so they need no change. Imports (`LEVEL_CONFIG`, `DEPTH_THEMES`, `describe`, `it`, `assert`) are already present.

- [ ] **Step 1b: Add the new depth-0 tests**

Append a new describe block to `test/levels-config.test.js`:

```js
describe('boss test arena (depth 0)', () => {
  it('has a depth-0 config sized 26x18 with no enemies', () => {
    const cfg = LEVEL_CONFIG.find(c => c.depth === 0)
    assert.ok(cfg, 'depth-0 config exists')
    assert.equal(cfg.mapW, 26)
    assert.equal(cfg.mapH, 18)
    assert.equal(cfg.guardCount, 0)
    assert.equal(cfg.monsterDensity, 0)
  })

  it('resolves a theme for depth 0', () => {
    const theme = DEPTH_THEMES.find(t => t.depths.includes(0))
    assert.ok(theme, 'a theme includes depth 0')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/levels-config.test.js`
Expected: FAIL — the updated count test fails on `depth-0 debug arena present`, and the new block fails (no depth-0 config; no theme includes depth 0).

- [ ] **Step 3: Add the depth-0 `LEVEL_CONFIG` entry**

In `renderer/data/levels.js`, add this as the first element of the `LEVEL_CONFIG` array (before the `depth: 1` entry):

```js
  { depth: 0, mapW: 26, mapH: 18, staircaseWidth: 1, guardCount: 0, monsterDensity: 0, trapDensity: 0, puzzleDensity: 0, weaponDensity: 0, potionDensity: 0, landmark: null, weapons: ['dagger'] },
```

- [ ] **Step 4: Add depth 0 to the boss theme**

In `renderer/data/levels.js`, in `DEPTH_THEMES`, change the molten boss theme's `depths` from `[5]` to `[0, 5]`:

```js
  {
    depths: [0, 5],
    floorTile: 'floor',
    bgColor:  '#0a0406',
    tint:     'rgba(60,10,0,0.35)',
    fogAlpha: 0.80,
    props: { room: ['prop_gravestone', 'prop_grave'] },
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/levels-config.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass (previous suite count + the new arena/cheat/config tests).

- [ ] **Step 7: Commit**

```bash
git add renderer/data/levels.js test/levels-config.test.js
git commit -m "feat(levels): depth-0 boss arena config + theme"
```

---

### Task 4: In-game runtime verification

**Files:** none (verification only)

This task confirms the arena works end-to-end in the actual Electron game; it does not change code.

- [ ] **Step 1: Drive the game via the run-game driver**

Use the repo's `.claude/skills/run-game` Playwright driver (or the `verify` skill) on WSLg (`DISPLAY=:0`). Launch, then on the title screen type the cheat `level0` (six `keyboard.press` calls: `l e v e l 0`), then screenshot.

- [ ] **Step 2: Confirm the arena visually**

Expected observations in the screenshot:
- A single walled room with the **dragon boss** drawn at the center.
- **Chests ringed** around the room's interior perimeter.
- The player at bottom-center; FOV shows the boss/chests in sight.

- [ ] **Step 3: Confirm chest pickup (optional probe)**

Hold a movement key to walk the player onto a perimeter chest; confirm it is picked up (walk-onto), exercising the `weapon`/`potion` → `makeChest` path.

- [ ] **Step 4: Note the result**

Record PASS/FAIL with the screenshot as evidence. No commit (verification only). Clean up any throwaway driver script (name it `debug*.mjs` so it is gitignored).

---

## Notes for the implementer

- **Why depth 0 short-circuits before `cfg`:** `generateLevel(0, …)` returns the arena before reading `LEVEL_CONFIG`, so Task 2's unit tests pass without Task 3. Task 3 only affects the *runtime* size/theme that `startNewRun` reads (`cfg.mapW`/`cfg.mapH` and the resolved theme).
- **Killing the boss at depth 0** runs the existing non-final drop path (`state.level < FINAL_DEPTH` → "the boss drops a key"). This is intentional and out of scope — do not modify boss-death/win handling.
- **No stairs/exit** are created in the arena, so the player cannot descend — it is a dead-end test room by design.
