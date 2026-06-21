# 5-Level Boss-Gated Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the run into 5 levels, each gated by a single boss whose death materializes the exit (stairs for L1–4, victory treasure for L5).

**Architecture:** Data-driven level config in `renderer/data/levels.js` (5 rows, per-level map size, boss via lair template/arena). Generation in `renderer/systems/map.js` no longer carves a pre-existing exit and tags the boss spawn `isBoss`. A new pure module `renderer/systems/progression.js` decides when/where the exit appears. The imperative shell `renderer/game.js` wires it: tracks the living boss, spawns the exit on death, and ends the run when the player walks onto the L5 treasure.

**Tech Stack:** Vanilla ES modules, Electron renderer, `node --test` test runner.

## Global Constraints

- Test runner: `npm test` (= `node --test test/`). Run individual files with `node --test test/<file>.js`.
- ES modules (`"type": "module"`); use `import`/`export`.
- Bosses keep **base stats** — no HP multipliers.
- Reuse existing monster makers and existing lair designs; only L1/L2 get new small lair templates.
- The exit appears **at the boss's death tile** — no key-press to collect; the player walks onto it.
- Map sizes: L1 50×32, L2 64×40, L3/L4/L5 80×50. `FINAL_DEPTH = 5`.
- Boss-to-level: L1 crab, L2 wizard, L3 cyclops, L4 dragon, L5 dragon_boss.

---

### Task 1: Restructure level data to 5 levels

**Files:**
- Modify: `renderer/data/levels.js` (`LEVEL_CONFIG`, `DEPTH_THEMES`, `FINAL_DEPTH`)
- Test: `test/map.test.js` (update `FINAL_DEPTH` assertion)
- Test: `test/levels-config.test.js` (new)

**Interfaces:**
- Produces: `LEVEL_CONFIG` — array of 5 objects, each `{ depth, mapW, mapH, staircaseWidth, guardCount, monsterDensity, trapDensity, puzzleDensity, weaponDensity, potionDensity, landmark, weapons, cyclopsArena? }`. No `crabCount`/`wizardCount` fields.
- Produces: `FINAL_DEPTH = 5`.
- Produces: `DEPTH_THEMES` covering depths 1–5.

- [ ] **Step 1: Write the failing test** — create `test/levels-config.test.js`:

```javascript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES } from '../renderer/data/levels.js'

describe('LEVEL_CONFIG (5-level run)', () => {
  it('has exactly 5 levels, depths 1..5', () => {
    assert.equal(LEVEL_CONFIG.length, 5)
    assert.deepEqual(LEVEL_CONFIG.map(c => c.depth), [1, 2, 3, 4, 5])
  })

  it('L1 is 50x32 and L2 is 64x40, L3-5 are 80x50', () => {
    const byDepth = Object.fromEntries(LEVEL_CONFIG.map(c => [c.depth, c]))
    assert.deepEqual([byDepth[1].mapW, byDepth[1].mapH], [50, 32])
    assert.deepEqual([byDepth[2].mapW, byDepth[2].mapH], [64, 40])
    for (const d of [3, 4, 5]) assert.deepEqual([byDepth[d].mapW, byDepth[d].mapH], [80, 50])
  })

  it('maps each level to its boss lair / arena', () => {
    const byDepth = Object.fromEntries(LEVEL_CONFIG.map(c => [c.depth, c]))
    assert.equal(byDepth[1].landmark, 'CRAB_LAIR')
    assert.equal(byDepth[2].landmark, 'WIZARD_SANCTUM')
    assert.equal(byDepth[3].cyclopsArena, true)
    assert.equal(byDepth[4].landmark, 'DRAGON_LAIR')
    assert.equal(byDepth[5].landmark, 'GREAT_LAIR')
  })

  it('no scattered crab/wizard counts remain', () => {
    for (const c of LEVEL_CONFIG) {
      assert.equal(c.crabCount, undefined)
      assert.equal(c.wizardCount, undefined)
    }
  })

  it('FINAL_DEPTH is 5', () => assert.equal(FINAL_DEPTH, 5))

  it('DEPTH_THEMES covers depths 1..5', () => {
    for (let d = 1; d <= 5; d++)
      assert.ok(DEPTH_THEMES.some(t => t.depths.includes(d)), `no theme for depth ${d}`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/levels-config.test.js`
Expected: FAIL (LEVEL_CONFIG still has 10 rows / `FINAL_DEPTH` is 10).

- [ ] **Step 3: Replace `LEVEL_CONFIG`** in `renderer/data/levels.js` with these 5 rows:

```javascript
export const LEVEL_CONFIG = [
  { depth: 1, mapW: 50, mapH: 32, staircaseWidth: 1, guardCount: 2, monsterDensity: 0,     trapDensity: 0.03, puzzleDensity: 0.01, weaponDensity: 0.012, potionDensity: 0.008, landmark: 'CRAB_LAIR',      weapons: ['dagger'] },
  { depth: 2, mapW: 64, mapH: 40, staircaseWidth: 1, guardCount: 3, monsterDensity: 0,     trapDensity: 0.04, puzzleDensity: 0.02, weaponDensity: 0.012, potionDensity: 0.008, landmark: 'WIZARD_SANCTUM',  weapons: ['dagger', 'sword'] },
  { depth: 3, mapW: 80, mapH: 50, staircaseWidth: 1, guardCount: 5, monsterDensity: 0.006, trapDensity: 0.06, puzzleDensity: 0.03, weaponDensity: 0.012, potionDensity: 0.008, landmark: null,             weapons: ['sword', 'longsword'], cyclopsArena: true },
  { depth: 4, mapW: 80, mapH: 50, staircaseWidth: 1, guardCount: 7, monsterDensity: 0.010, trapDensity: 0.08, puzzleDensity: 0.03, weaponDensity: 0.012, potionDensity: 0.008, landmark: 'DRAGON_LAIR',    weapons: ['longsword', 'axe'] },
  { depth: 5, mapW: 80, mapH: 50, staircaseWidth: 1, guardCount: 4, monsterDensity: 0.004, trapDensity: 0.05, puzzleDensity: 0.02, weaponDensity: 0.012, potionDensity: 0.012, landmark: 'GREAT_LAIR',     weapons: ['longsword', 'axe'] },
]
```

- [ ] **Step 4: Replace `DEPTH_THEMES`** in `renderer/data/levels.js` with 5-level bands:

```javascript
export const DEPTH_THEMES = [
  {
    depths: [1, 2],
    floorTile: 'floor',
    ruleset: 'catacombs',
    bgColor:  '#12121e',
    tint:     null,
    fogAlpha: 0.65,
    props: { room: ['prop_table', 'prop_chair', 'prop_anvil', 'prop_barrel'] },
  },
  {
    depths: [3],
    floorTile: 'sand',
    bgColor:  '#1a1206',
    tint:     'rgba(40,20,0,0.2)',
    fogAlpha: 0.65,
    props: { room: ['prop_gravestone', 'prop_anvil'] },
  },
  {
    depths: [4],
    floorTile: 'floor',
    bgColor:  '#07070f',
    tint:     'rgba(0,0,20,0.35)',
    fogAlpha: 0.80,
    props: { room: ['prop_gravestone', 'prop_grave'] },
  },
  {
    depths: [5],
    floorTile: 'floor',
    bgColor:  '#0a0406',
    tint:     'rgba(60,10,0,0.35)',
    fogAlpha: 0.80,
    props: { room: ['prop_gravestone', 'prop_grave'] },
  },
]
```

- [ ] **Step 5: Change `FINAL_DEPTH`** in `renderer/data/levels.js`:

```javascript
export const FINAL_DEPTH = 5
```

- [ ] **Step 6: Update the stale `FINAL_DEPTH` assertion** in `test/map.test.js` (around line 384):

```javascript
  it('FINAL_DEPTH is 10', () => { assert.equal(FINAL_DEPTH, 10) })
```
becomes
```javascript
  it('FINAL_DEPTH is 5', () => { assert.equal(FINAL_DEPTH, 5) })
```

- [ ] **Step 7: Run the new config test**

Run: `node --test test/levels-config.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add renderer/data/levels.js test/levels-config.test.js test/map.test.js
git commit -m "feat(levels): restructure to 5 boss-gated levels with per-level map sizes"
```

---

### Task 2: Boss lair templates + boss legend symbols + placeTemplate flag

**Files:**
- Modify: `renderer/data/levels.js` (`TEMPLATE_LEGEND`, `TEMPLATES`)
- Modify: `renderer/systems/map.js` (`placeTemplate`)
- Test: `test/map.test.js` (new tests in the `placeTemplate`/template area)

**Interfaces:**
- Consumes: `TEMPLATE_LEGEND` from Task 1's file.
- Produces: legend symbols `R` (crab, `isBoss`) and `Z` (wizard, `isBoss`); `D`/`B` gain `isBoss: true`.
- Produces: `TEMPLATES.CRAB_LAIR` (11×7) and `TEMPLATES.WIZARD_SANCTUM` (13×7).
- Produces: `placeTemplate(map, template, ox, oy, roomId)` pushes spawn objects that carry `isBoss: true` when the legend entry is a boss.

- [ ] **Step 1: Write the failing test** — append to `test/map.test.js` (inside the existing top-level imports it already has `placeTemplate`, `TEMPLATE_LEGEND`, `createMap`, `TILE`):

```javascript
describe('boss template spawns', () => {
  it('legend marks crab/wizard/dragon/boss as isBoss', () => {
    assert.equal(TEMPLATE_LEGEND['R'].spawn, 'crab')
    assert.equal(TEMPLATE_LEGEND['R'].isBoss, true)
    assert.equal(TEMPLATE_LEGEND['Z'].spawn, 'wizard')
    assert.equal(TEMPLATE_LEGEND['Z'].isBoss, true)
    assert.equal(TEMPLATE_LEGEND['D'].isBoss, true)
    assert.equal(TEMPLATE_LEGEND['B'].isBoss, true)
  })

  it('placeTemplate tags the boss spawn with isBoss', () => {
    const map = createMap(20, 20)
    const tpl = { tiles: ['#####', '#.R.#', '#####'], width: 5, height: 3 }
    const spawns = placeTemplate(map, tpl, 0, 0, 7)
    const crab = spawns.find(s => s.kind === 'crab')
    assert.ok(crab, 'expected a crab spawn')
    assert.equal(crab.isBoss, true)
  })

  it('non-boss spawns are not tagged isBoss', () => {
    const map = createMap(20, 20)
    const tpl = { tiles: ['#####', '#.W.#', '#####'], width: 5, height: 3 }
    const spawns = placeTemplate(map, tpl, 0, 0, 7)
    const weapon = spawns.find(s => s.kind === 'weapon')
    assert.ok(weapon, 'expected a weapon spawn')
    assert.equal(weapon.isBoss, undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/map.test.js`
Expected: FAIL (`TEMPLATE_LEGEND['R']` is undefined).

- [ ] **Step 3: Add legend symbols and `isBoss` flags** in `renderer/data/levels.js` `TEMPLATE_LEGEND`. Change the `D` and `B` lines and add `R`/`Z`:

```javascript
  'D': { label: 'Dragon',   kind: 'spawn', spawn: 'dragon',      roomScoped: true,  isBoss: true, color: '#a33333', icon: '🐉' },
  'B': { label: 'Boss',     kind: 'spawn', spawn: 'dragon_boss', roomScoped: true, single: true, isBoss: true, color: '#cc2222', icon: '🐲' },
  'R': { label: 'Crab',     kind: 'spawn', spawn: 'crab',        roomScoped: false, isBoss: true, color: '#c87a3a', icon: '🦀' },
  'Z': { label: 'Wizard',   kind: 'spawn', spawn: 'wizard',      roomScoped: false, isBoss: true, color: '#6a3a8a', icon: '🧙' },
```

- [ ] **Step 4: Add the two lair templates** to `TEMPLATES` in `renderer/data/levels.js`:

```javascript
  CRAB_LAIR: {
    tiles: [
      '###########',
      '#.........#',
      '#.........#',
      '#....R....#',
      '#.........#',
      '#.........#',
      '###########',
    ],
    width: 11, height: 7,
  },
  WIZARD_SANCTUM: {
    tiles: [
      '#############',
      '#...........#',
      '#.C.......C.#',
      '#.....Z.....#',
      '#.C.......C.#',
      '#...........#',
      '#############',
    ],
    width: 13, height: 7,
  },
```

- [ ] **Step 5: Propagate `isBoss` in `placeTemplate`** — in `renderer/systems/map.js`, replace the spawn-push block (currently lines ~268-270):

```javascript
      const spawn = { kind: entry.spawn, x: tx, y: ty }
      if (entry.roomScoped) spawn.roomId = roomId
      spawns.push(spawn)
```
with:
```javascript
      const spawn = { kind: entry.spawn, x: tx, y: ty }
      if (entry.roomScoped) spawn.roomId = roomId
      if (entry.isBoss) spawn.isBoss = true
      spawns.push(spawn)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/map.test.js`
Expected: the three new `boss template spawns` tests PASS. (Exit-passage tests still fail — fixed in Task 3.)

- [ ] **Step 7: Commit**

```bash
git add renderer/data/levels.js renderer/systems/map.js test/map.test.js
git commit -m "feat(levels): crab/wizard lair templates + isBoss spawn tagging"
```

---

### Task 3: Drop the pre-carved exit; tag cyclops arena boss

**Files:**
- Modify: `renderer/systems/map.js` (`generateLevel`: remove `carveExitPassage` call; flag cyclops arena spawn)
- Test: `test/map.test.js` (update depth loops 1..9 → 1..5; remove obsolete exit-passage tests; add no-exit test)

**Interfaces:**
- Consumes: `LEVEL_CONFIG` (per-level sizes), `placeTemplate` (Task 2).
- Produces: `generateLevel(depth, width, height, opts)` returns a map with **no** `STAIRS_DOWN` tile; cyclops-arena levels include a spawn `{ kind: 'cyclops', x, y, isBoss: true }`.

- [ ] **Step 1: Update existing depth-range loops** in `test/map.test.js`. Replace every `depth <= 9` with `depth <= 5` and every `depth < 9` with `depth <= 5` in the `generateLevel` describe block (lines ~63, 74, 92, 100, 111 use `<= 9`; lines ~121, 138, 156, 168 use `< 9`).

- [ ] **Step 2: Delete obsolete exit-passage tests** in `test/map.test.js`. Remove these four `it(...)` blocks entirely (the exit passage no longer exists in generated maps):
  - `'stairs-down is not at playerSpawn position'` (~lines 81-89)
  - `'STAIRS_DOWN has 4 walkable STAIR tiles above it in the exit passage'` (~lines 120-135)
  - `'STAIRS_DOWN has 3 non-walkable void STAIR tiles below it'` (~lines 137-153)
  - `'STAIRS_DOWN has stairDepth 4'` (~lines 155-165)
  - `'STAIRS_DOWN is always at col 77 (MAP_W-3), row 45 (MAP_H-5)'` (~lines 167-178)

- [ ] **Step 3: Add a "no pre-carved exit" test** to the `generateLevel` describe block in `test/map.test.js`:

```javascript
  it('does not pre-carve a STAIRS_DOWN exit (exit appears on boss death)', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map } = generateLevel(depth)
      let found = false
      for (let y = 0; y < map.length && !found; y++)
        for (let x = 0; x < map[y].length && !found; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) found = true
      assert.equal(found, false, `depth ${depth}: should have no pre-carved STAIRS_DOWN`)
    }
  })

  it('generates connected maps at the smaller L1/L2 sizes', () => {
    assert.equal(isFullyConnected(generateLevel(1, 50, 32).map), true)
    assert.equal(isFullyConnected(generateLevel(2, 64, 40).map), true)
  })
```

- [ ] **Step 4: Run tests to verify the no-exit test fails**

Run: `node --test test/map.test.js`
Expected: FAIL on `does not pre-carve a STAIRS_DOWN exit` (exit still carved).

- [ ] **Step 5: Remove the exit-passage call** in `renderer/systems/map.js` `generateLevel`. Delete this line (~496):

```javascript
    // Exit passage going down from south wall of stairs room
    if (depth < FINAL_DEPTH) carveExitPassage(map, staircaseWidth, rooms)
```

(Leave the `carveExitPassage` function definition in place — `generateFallback` still uses it so a degenerate fallback level remains passable.)

- [ ] **Step 6: Tag the cyclops-arena spawn** in `renderer/systems/map.js` `generateLevel` (~line 486):

```javascript
      entitySpawns.push({ kind: 'cyclops', x: acx, y: acy })
```
becomes
```javascript
      entitySpawns.push({ kind: 'cyclops', x: acx, y: acy, isBoss: true })
```

- [ ] **Step 7: Run the full map test file**

Run: `node --test test/map.test.js`
Expected: PASS (all remaining tests, including the new no-exit and small-map tests).

- [ ] **Step 8: Commit**

```bash
git add renderer/systems/map.js test/map.test.js
git commit -m "feat(map): drop pre-carved exit; tag cyclops arena as boss"
```

---

### Task 4: Progression module — boss count + exit spawning

**Files:**
- Create: `renderer/systems/progression.js`
- Test: `test/progression.test.js` (new)

**Interfaces:**
- Consumes: `TILE` from `renderer/systems/entities.js`.
- Produces: `countBosses(entities) -> number` — count of entities with truthy `isBoss`.
- Produces: `spawnLevelExit(map, tile, isFinal) -> {x, y} | null` — when `isFinal`, sets `map[tile.y][tile.x].tile = TILE.TREASURE` and returns the victory tile `{x, y}`; otherwise sets that cell to `TILE.STAIRS_DOWN` (with `stairWidth: 1`, `stairCol: 0`) and returns `null`. Returns `null` if the tile is out of bounds.

- [ ] **Step 1: Write the failing test** — create `test/progression.test.js`:

```javascript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { countBosses, spawnLevelExit } from '../renderer/systems/progression.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

describe('countBosses', () => {
  it('counts only entities flagged isBoss', () => {
    assert.equal(countBosses([{ isBoss: true }, { type: 'guard' }, { isBoss: true }]), 2)
    assert.equal(countBosses([{ type: 'guard' }]), 0)
    assert.equal(countBosses([]), 0)
  })
})

describe('spawnLevelExit', () => {
  it('non-final: writes STAIRS_DOWN and returns null', () => {
    const map = createMap(10, 10)
    map[5][5].tile = TILE.FLOOR
    const result = spawnLevelExit(map, { x: 5, y: 5 }, false)
    assert.equal(result, null)
    assert.equal(map[5][5].tile, TILE.STAIRS_DOWN)
    assert.equal(map[5][5].stairWidth, 1)
    assert.equal(map[5][5].stairCol, 0)
  })

  it('final: writes TREASURE and returns the victory tile', () => {
    const map = createMap(10, 10)
    map[4][6].tile = TILE.FLOOR
    const result = spawnLevelExit(map, { x: 6, y: 4 }, true)
    assert.deepEqual(result, { x: 6, y: 4 })
    assert.equal(map[4][6].tile, TILE.TREASURE)
  })

  it('out of bounds: returns null and mutates nothing', () => {
    const map = createMap(10, 10)
    assert.equal(spawnLevelExit(map, { x: 99, y: 99 }, false), null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/progression.test.js`
Expected: FAIL (`progression.js` does not exist).

- [ ] **Step 3: Create `renderer/systems/progression.js`**:

```javascript
import { TILE } from './entities.js'

// Number of living bosses among the given entities.
export function countBosses(entities) {
  return entities.filter(e => e.isBoss).length
}

// Materialize a level's exit at the boss's death tile.
//   isFinal=false → carve STAIRS_DOWN there (player walks onto it to descend).
//   isFinal=true  → place victory TREASURE there; returns the tile so the caller
//                   can detect the walk-onto win.
// Returns the victory tile {x,y} on the final level, otherwise null.
export function spawnLevelExit(map, tile, isFinal) {
  const cell = map[tile.y]?.[tile.x]
  if (!cell) return null
  if (isFinal) {
    cell.tile = TILE.TREASURE
    cell.dirty = true
    return { x: tile.x, y: tile.y }
  }
  cell.tile = TILE.STAIRS_DOWN
  cell.stairWidth = 1
  cell.stairCol = 0
  cell.dirty = true
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/progression.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/progression.js test/progression.test.js
git commit -m "feat(progression): countBosses + spawnLevelExit"
```

---

### Task 5: Wire boss gating into the game shell

**Files:**
- Modify: `renderer/game.js` (imports, `buildEntities`, `startNewRun`, `descendLevel`, `update`)

**Interfaces:**
- Consumes: `LEVEL_CONFIG`, `FINAL_DEPTH` (levels.js); `countBosses`, `spawnLevelExit` (progression.js).
- Produces: runtime behavior — boss death spawns the exit; walking onto L5 treasure ends the run won.

This task changes the DOM-bound imperative shell, which the `node --test` suite does not load. Verification is the full suite still passing (no import/regression breakage) plus a runtime check via the Electron+Playwright path.

- [ ] **Step 1: Add imports** in `renderer/game.js`. Change the levels import (line ~12):

```javascript
import { FINAL_DEPTH, DEPTH_THEMES } from './data/levels.js'
```
to
```javascript
import { FINAL_DEPTH, DEPTH_THEMES, LEVEL_CONFIG } from './data/levels.js'
import { countBosses, spawnLevelExit } from './systems/progression.js'
```

- [ ] **Step 2: Propagate `isBoss` in `buildEntities`** — in `renderer/game.js`, update the five boss-kind cases to carry the flag:

```javascript
      case 'dragon':  return [{ ...makeDragon(s.x, s.y, s.roomId), px: cx, py: cy, facing: 'east',
  breathState: 'idle', breathTimer: DRAGON_BREATH_COOLDOWN, breathAngle: 0,
  breathProgress: 0, breathParticles: [], breathDamageAcc: 0, ...wander(), ...(s.isBoss && { isBoss: true }) }]
```
```javascript
      case 'cyclops': return [{ ...makeCyclops(s.x, s.y), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) }]
      case 'wizard':  return [{ ...makeWizard(s.x, s.y),  px: cx, py: cy, ...(s.isBoss && { isBoss: true }) }]
      case 'crab':    return [{ ...makeCrab(s.x, s.y),    px: cx, py: cy, ...(s.isBoss && { isBoss: true }) }]
      case 'dragon_boss': return [{ ...makeDragonBoss(s.x, s.y), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) }]
```

- [ ] **Step 3: Pass per-level size + reset gate state in `startNewRun`** — in `renderer/game.js`, replace the generate call (lines ~161-163):

```javascript
  const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(1, undefined, undefined, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```
with:
```javascript
  const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === 1)
  const { map, entitySpawns, playerSpawn } =
    generateLevel(1, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```
and add the gate fields to the `state` object literal (after `gameOver: false,`):
```javascript
    gameOver: false,
    exitSpawned: false,
    lastBossTile: null,
    victoryTile: null,
```

- [ ] **Step 4: Pass per-level size + reset gate state in `descendLevel`** — in `renderer/game.js`, replace the generate call (lines ~546-548):

```javascript
  const theme = DEPTH_THEMES.find(t => t.depths.includes(next)) ?? DEPTH_THEMES[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(next, undefined, undefined, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```
with:
```javascript
  const theme = DEPTH_THEMES.find(t => t.depths.includes(next)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === next) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(next, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```
and add the gate fields to the `state = { ...state, ... }` object (alongside `hitEffects: [],`):
```javascript
    hitEffects: [],
    exitSpawned: false,
    lastBossTile: null,
    victoryTile: null,
```

- [ ] **Step 5: Replace the X-steal handler with the victory walk-onto check** — in `renderer/game.js` `update`, replace the steal block (lines ~270-273):

```javascript
  // Steal treasure
  if ((keys['x'] || keys['X']) && map[player.y]?.[player.x]?.tile === TILE.TREASURE) {
    state.gameOver = true; endRun(true); return
  }
```
with:
```javascript
  // Victory: walk onto the treasure the final boss dropped
  if (state.victoryTile && player.x === state.victoryTile.x && player.y === state.victoryTile.y) {
    state.gameOver = true; endRun(true); return
  }
```

- [ ] **Step 6: Add boss-death → exit-spawn logic** near the end of `update` in `renderer/game.js`, immediately before the `// Clear hit flash` block (line ~532):

```javascript
  // Boss gating: remember the living boss's tile; when it dies, materialize the exit
  if (countBosses(state.entities) > 0) {
    const boss = state.entities.find(e => e.isBoss)
    state.lastBossTile = { x: boss.x, y: boss.y }
  } else if (state.lastBossTile && !state.exitSpawned) {
    const isFinal = state.level >= FINAL_DEPTH
    const victoryTile = spawnLevelExit(state.map, state.lastBossTile, isFinal)
    if (victoryTile) state.victoryTile = victoryTile
    state.exitSpawned = true
    state.log = [...state.log, isFinal ? 'The dragon falls — treasure glimmers!' : 'The way down opens.'].slice(-5)
  }

```

- [ ] **Step 7: Run the full test suite for regressions**

Run: `npm test`
Expected: PASS (no test loads `game.js`; this confirms levels.js/map.js/progression.js changes are consistent and nothing else broke).

- [ ] **Step 8: Runtime verification via Electron + Playwright** (per project note: the game runs on WSLg with `DISPLAY=:0` through `playwright-core`'s `_electron`). Launch the game, confirm on Level 1:
  - no stairs exist until the crab is killed;
  - killing the crab turns its tile into stairs;
  - stepping on the stairs advances to Level 2 (smaller-but-larger map).

  If a quick scripted check is preferred, drive it with a short `node` script using `playwright-core` `_electron.launch({ args: ['.'] })`, evaluate `window`-side state to confirm `state.exitSpawned` flips to `true` after the boss is removed. Document the observed result.

- [ ] **Step 9: Commit**

```bash
git add renderer/game.js
git commit -m "feat(game): boss-gated exits and 5-level walk-onto victory"
```

---

## Self-Review

**Spec coverage:**
- Core loop (explore → kill boss → exit at corpse → walk onto) → Tasks 4 (spawn) + 5 (wiring, steps 5–6). ✓
- Level/boss/size table → Task 1 (`LEVEL_CONFIG`, themes), Task 2 (lairs/legend), Task 3 (cyclops arena flag), Task 5 (per-level sizes). ✓
- Boss tracking via `isBoss` legend→spawn→entity → Task 2 (legend + placeTemplate), Task 3 (arena spawn), Task 5 step 2 (buildEntities). ✓
- Remove scattered crab/wizard counts → Task 1 (`LEVEL_CONFIG` rows omit them; test asserts absence). ✓
- Exit-on-death: drop `carveExitPassage` from main path → Task 3 step 5; spawn stairs/treasure → Task 4 + Task 5 step 6. ✓
- Bosses base stats (no multiplier) → no HP change anywhere. ✓
- Remove X-to-steal; walk-onto victory; decorative TREASURE doesn't win → Task 5 step 5 (win keyed to `state.victoryTile`, not any TREASURE tile). ✓
- `FINAL_DEPTH = 5` → Task 1 step 5. ✓
- Testing requirements (isBoss propagation, exit-on-death, victory ends run, small-map connectivity, no pre-carved exit) → Tasks 1–4 tests; victory-ends-run + isBoss-on-entity verified at runtime in Task 5 step 8 (game.js is not unit-testable in this harness). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `spawnLevelExit(map, tile, isFinal)` returns `{x,y}|null` — consumed identically in Task 5 step 6. `countBosses(entities)` used with the same signature. `LEVEL_CONFIG` fields (`mapW`/`mapH`) defined in Task 1 and read in Task 5 steps 3–4. `isBoss` flows legend (Task 2) → spawn (Task 2/3) → entity (Task 5). ✓

**Note on game.js testing:** This codebase has no DOM/game-loop test harness (existing tests cover only `renderer/systems/*` and `renderer/data/*`). Task 5's logic is therefore verified by the full suite passing plus the runtime Playwright check, consistent with the existing project testing boundary rather than introducing a new harness.
