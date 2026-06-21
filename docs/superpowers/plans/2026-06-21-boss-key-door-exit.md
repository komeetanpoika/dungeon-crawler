# Boss Key → Exit Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boss-death "exit appears" mechanic — each level (1–4) pre-places a locked exit door; the boss drops a key that opens it; the final boss drops a collectible gold-weapon treasure that wins the run.

**Architecture:** A locked exit-door entity is placed at generation in the room farthest from spawn (depths 1–4). On boss death the game pushes a drop entity at the boss's tile — a key (1–4) or a treasure (5) — via a new pure `spawnBossDrop`. The game shell handles three walk-onto interactions: pick up key (`state.hasKey`), open exit door + descend (consumes key), and collect treasure (win). The old `STAIRS_DOWN`-on-death and `victoryTile` logic is removed.

**Tech Stack:** Vanilla ES modules, Electron renderer, `node --test` runner, Canvas 2D rendering.

## Global Constraints

- Test runner: `npm test` (full) or `node --test test/<file>.js` (one file). ES modules (`"type": "module"`).
- Interactions are **walk-onto**, no key press (player preference): key pickup, door open, treasure collect all trigger by standing on the entity's tile.
- Levels 1–4: boss drops a **key**; the pre-placed **exit door** opens with the key and advances to the next level. Level 5: dragon boss drops a **treasure** (placeholder = a random weapon from the depth's pool, rendered gold-tinted); collecting it wins.
- `FINAL_DEPTH = 5`. Per-level gating state resets in both `startNewRun` and `descendLevel`.
- The exit door is a **door entity** on a normal floor tile (not a blocking tile); it is the transition point, not a barrier.
- `renderer/game.js` is the DOM/game-loop shell — the `node --test` harness does NOT import it. Its tasks are verified by `node --check renderer/game.js` + a green suite + a runtime Electron boot, not unit tests. Do not add a game.js test harness.
- Key sprite placeholder: `tile_0119` (verify it reads as a key in-game; swap if a better tile exists).

---

### Task 1: Drop/door entity factories

**Files:**
- Modify: `renderer/systems/entities.js` (add `makeKey`, `makeExitDoor`, `makeTreasure` near `makeDoor`, entities.js:113)
- Test: `test/entities.test.js`

**Interfaces:**
- Produces: `makeKey(x, y) -> { type:'key', x, y }`
- Produces: `makeExitDoor(x, y) -> { type:'door', x, y, opening:false, frame:0, locked:true, isExit:true }`
- Produces: `makeTreasure(x, y, weaponType) -> { type:'treasure', x, y, weaponType }`

- [ ] **Step 1: Write the failing test** — append to `test/entities.test.js`:

```javascript
import { makeKey, makeExitDoor, makeTreasure } from '../renderer/systems/entities.js'

describe('boss-drop and exit-door factories', () => {
  it('makeKey produces a key entity', () => {
    assert.deepEqual(makeKey(3, 4), { type: 'key', x: 3, y: 4 })
  })

  it('makeExitDoor produces a locked exit door using door frames', () => {
    const d = makeExitDoor(5, 6)
    assert.equal(d.type, 'door')
    assert.equal(d.x, 5); assert.equal(d.y, 6)
    assert.equal(d.locked, true)
    assert.equal(d.isExit, true)
    assert.equal(d.frame, 0)
    assert.equal(d.opening, false)
  })

  it('makeTreasure carries its weapon type', () => {
    const t = makeTreasure(7, 8, 'axe')
    assert.equal(t.type, 'treasure')
    assert.equal(t.x, 7); assert.equal(t.y, 8)
    assert.equal(t.weaponType, 'axe')
  })
})
```

(Note: `test/entities.test.js` already imports `describe`/`it` from `node:test` and `assert` from `node:assert/strict`. Add only the new import line above its existing imports if not already present; do not duplicate the `node:test` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/entities.test.js`
Expected: FAIL — `makeKey`/`makeExitDoor`/`makeTreasure` are not exported.

- [ ] **Step 3: Add the factories** in `renderer/systems/entities.js` immediately after `makeDoor` (entities.js:113-115):

```javascript
export function makeKey(x, y) {
  return { type: 'key', x, y }
}

// The level exit. A door entity (reuses the door_0..3 frames) flagged as the
// locked exit; it opens only when the player holds this level's key.
export function makeExitDoor(x, y) {
  return { type: 'door', x, y, opening: false, frame: 0, locked: true, isExit: true }
}

// Final-boss reward (placeholder: a gold-tinted weapon). Collecting it wins.
export function makeTreasure(x, y, weaponType) {
  return { type: 'treasure', x, y, weaponType }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/entities.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js test/entities.test.js
git commit -m "feat(entities): key, exit-door, and treasure factories"
```

---

### Task 2: `spawnBossDrop` in progression module

**Files:**
- Modify: `renderer/systems/progression.js` (replace `spawnLevelExit` with `spawnBossDrop`; change import)
- Test: `test/progression.test.js` (replace the `spawnLevelExit` tests)

**Interfaces:**
- Consumes: `makeKey`, `makeTreasure` from `entities.js` (Task 1).
- Produces: `spawnBossDrop(tile, isFinal, weaponPool=['dagger']) -> entity` — non-final returns `makeKey(tile.x, tile.y)`; final returns `makeTreasure(tile.x, tile.y, weaponType)` with `weaponType` chosen from `weaponPool`.
- `countBosses(entities)` is unchanged.

- [ ] **Step 1: Write the failing test** — replace the entire contents of `test/progression.test.js` with:

```javascript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { countBosses, spawnBossDrop } from '../renderer/systems/progression.js'

describe('countBosses', () => {
  it('counts only entities flagged isBoss', () => {
    assert.equal(countBosses([{ isBoss: true }, { type: 'guard' }, { isBoss: true }]), 2)
    assert.equal(countBosses([{ type: 'guard' }]), 0)
    assert.equal(countBosses([]), 0)
  })
})

describe('spawnBossDrop', () => {
  it('non-final: drops a key at the tile', () => {
    const drop = spawnBossDrop({ x: 5, y: 9 }, false, ['dagger'])
    assert.deepEqual(drop, { type: 'key', x: 5, y: 9 })
  })

  it('final: drops a treasure with a weapon from the pool', () => {
    const pool = ['longsword', 'axe']
    for (let i = 0; i < 20; i++) {
      const drop = spawnBossDrop({ x: 2, y: 3 }, true, pool)
      assert.equal(drop.type, 'treasure')
      assert.equal(drop.x, 2); assert.equal(drop.y, 3)
      assert.ok(pool.includes(drop.weaponType), `weaponType ${drop.weaponType} not in pool`)
    }
  })

  it('final: weaponPool defaults to dagger', () => {
    const drop = spawnBossDrop({ x: 0, y: 0 }, true)
    assert.equal(drop.weaponType, 'dagger')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/progression.test.js`
Expected: FAIL — `spawnBossDrop` is not exported (only `spawnLevelExit` exists).

- [ ] **Step 3: Rewrite `renderer/systems/progression.js`**:

```javascript
import { makeKey, makeTreasure } from './entities.js'

// Number of living bosses among the given entities.
export function countBosses(entities) {
  return entities.filter(e => e.isBoss).length
}

// The boss's death drop, placed at the boss's last tile.
//   non-final → a key that opens the level's pre-placed exit door.
//   final     → a treasure (placeholder: a random weapon from the depth's pool),
//               which wins the run when collected.
export function spawnBossDrop(tile, isFinal, weaponPool = ['dagger']) {
  if (isFinal) {
    const weaponType = weaponPool[Math.floor(Math.random() * weaponPool.length)]
    return makeTreasure(tile.x, tile.y, weaponType)
  }
  return makeKey(tile.x, tile.y)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/progression.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/progression.js test/progression.test.js
git commit -m "feat(progression): spawnBossDrop (key / final treasure)"
```

---

### Task 3: Pre-place the exit door at generation

**Files:**
- Modify: `renderer/systems/map.js` (`generateLevel` exit-door placement after the cyclops-arena block, map.js:504; `generateFallback` map.js:~627)
- Test: `test/map.test.js`

**Interfaces:**
- Consumes: existing `rooms`, `spawnRoom`, `spawnC`, `landmarkRoom`, `center`, `isWalkable`, `TILE` already in scope in `generateLevel`.
- Produces: for `depth < FINAL_DEPTH`, exactly one `{ kind: 'exit_door', x, y }` entry in `entitySpawns`, on a walkable tile that is not the player spawn. Depth 5 produces none. `generateFallback` produces one for non-final depths.

- [ ] **Step 1: Write the failing test** — add inside the `describe('generateLevel', ...)` block in `test/map.test.js` (it already imports `generateLevel`, `generateFallback`, `isFullyConnected`, `isWalkable`, `TILE`):

```javascript
  it('places exactly one exit_door on depths 1-4, none on depth 5', () => {
    for (let depth = 1; depth <= 4; depth++) {
      const { entitySpawns, playerSpawn } = generateLevel(depth)
      const doors = entitySpawns.filter(s => s.kind === 'exit_door')
      assert.equal(doors.length, 1, `depth ${depth} should have exactly one exit_door`)
      const d = doors[0]
      assert.ok(!(d.x === playerSpawn.x && d.y === playerSpawn.y), `depth ${depth}: door on player spawn`)
    }
    const final = generateLevel(5)
    assert.equal(final.entitySpawns.filter(s => s.kind === 'exit_door').length, 0,
      'depth 5 should have no exit_door')
  })

  it('exit_door sits on a walkable tile', () => {
    for (let depth = 1; depth <= 4; depth++) {
      const { map, entitySpawns } = generateLevel(depth)
      const d = entitySpawns.find(s => s.kind === 'exit_door')
      assert.ok(d, `depth ${depth}: no exit_door`)
      assert.equal(isWalkable(map[d.y][d.x].tile, map[d.y][d.x]), true,
        `depth ${depth}: exit_door tile not walkable`)
    }
  })

  it('fallback places an exit_door on non-final levels', () => {
    const f2 = generateFallback(2, 64, 40)
    assert.equal(f2.entitySpawns.filter(s => s.kind === 'exit_door').length, 1,
      'fallback L2 should have one exit_door')
    const f5 = generateFallback(5, 80, 50)
    assert.equal(f5.entitySpawns.filter(s => s.kind === 'exit_door').length, 0,
      'fallback L5 should have no exit_door')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/map.test.js`
Expected: FAIL — no `exit_door` spawns are produced.

- [ ] **Step 3: Place the exit door in `generateLevel`.** In `renderer/systems/map.js`, immediately after the cyclops-arena `if (cfg.cyclopsArena) { ... }` block closes (map.js:504, the line with `}` before the `// Entrance passage` comment at map.js:506), insert:

```javascript

    // Exit door: levels before the final one place a single locked exit door in
    // the room farthest from the player spawn (and away from the boss lair). The
    // level's boss drops the key that opens it. The final level has no door — its
    // boss drops a treasure instead.
    if (depth < FINAL_DEPTH) {
      let exitRoom = null, exitDist = -1
      for (const r of rooms) {
        if (r === spawnRoom || r === landmarkRoom) continue
        const c = center(r)
        const d = Math.abs(c.x - spawnC.x) + Math.abs(c.y - spawnC.y)
        if (d > exitDist) { exitDist = d; exitRoom = r }
      }
      const er = exitRoom ?? rooms.find(r => r !== spawnRoom) ?? rooms[0]
      const ec = center(er)
      if (map[ec.y]?.[ec.x] && !isWalkable(map[ec.y][ec.x].tile)) {
        map[ec.y][ec.x].tile = TILE.FLOOR
        map[ec.y][ec.x].roomId = er.id
      }
      entitySpawns.push({ kind: 'exit_door', x: ec.x, y: ec.y })
    }
```

- [ ] **Step 4: Place the exit door in `generateFallback`.** In `renderer/systems/map.js`, in `generateFallback`, find the block (map.js:~636-642):

```javascript
  const entitySpawns = []
  if (depth < FINAL_DEPTH) {
    carveExitPassage(map, staircaseWidth, rooms)
  } else {
    // Final level wins by boss death — spawn the boss so a fallback level stays winnable.
    entitySpawns.push({ kind: 'dragon_boss', x: Math.floor(width / 2), y: Math.floor(height / 2), isBoss: true })
  }
```

Replace it with:

```javascript
  const entitySpawns = []
  if (depth < FINAL_DEPTH) {
    // Locked exit door in the far corner of the single interior room.
    entitySpawns.push({ kind: 'exit_door', x: width - 3, y: height - 3 })
  } else {
    // Final level wins by collecting the boss's treasure drop — spawn the boss.
    entitySpawns.push({ kind: 'dragon_boss', x: Math.floor(width / 2), y: Math.floor(height / 2), isBoss: true })
  }
```

(The `carveExitPassage` call is removed here — there is no `STAIRS_DOWN` exit anymore. Leave the `carveExitPassage` function definition in place; it is now unused but removing it is out of scope for this task. The `staircaseWidth` local in `generateFallback` becomes unused — delete that one line `const staircaseWidth = cfg.staircaseWidth ?? 1` in `generateFallback` to keep the output clean.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/map.test.js`
Expected: PASS (the three new tests plus all existing).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/map.js test/map.test.js
git commit -m "feat(map): pre-place locked exit door on non-final levels"
```

---

### Task 4: Render key and treasure entities

**Files:**
- Modify: `renderer/render/sprites.js` (add `key` sprite, sprites.js:48-53 items block)
- Modify: `renderer/render/canvas.js` (`drawEntity`, after the door block at canvas.js:101-105)

**Interfaces:**
- Consumes: entity shapes `{ type:'key' }`, `{ type:'treasure', weaponType }` (Task 1); the existing exit-door renders via the current `type:'door'` branch using `door_${frame}` (frame 0 = closed/locked).
- Produces: visible key and gold-tinted treasure sprites.

This task has no unit tests (rendering). Verify with `node --check` and a runtime boot in Task 5's verification; here, just confirm the files parse.

- [ ] **Step 1: Add the key sprite** in `renderer/render/sprites.js`, in the `// items` section (after sprites.js:53 `potion: 'tile_0116',`):

```javascript
  key:              'tile_0119',
```

- [ ] **Step 2: Add key + treasure rendering** in `renderer/render/canvas.js`, in `drawEntity`, immediately after the door block (canvas.js:101-105, the block ending `return\n  }` for `entity.type === 'door'`):

```javascript
  if (entity.type === 'key') {
    if (sprites.key) ctx.drawImage(sprites.key, px, py, S, S)
    return
  }
  if (entity.type === 'treasure') {
    const s = sprites[`weapon_${entity.weaponType}`] ?? sprites.treasure
    if (s) {
      const prevFilter = ctx.filter
      ctx.filter = 'sepia(1) saturate(3) brightness(1.15)'  // gold tint — placeholder treasure
      ctx.drawImage(s, px, py, S, S)
      ctx.filter = prevFilter
    }
    return
  }
```

- [ ] **Step 3: Verify the files parse**

Run: `node --check renderer/render/canvas.js && node --check renderer/render/sprites.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add renderer/render/sprites.js renderer/render/canvas.js
git commit -m "feat(render): key sprite and gold-tinted treasure"
```

---

### Task 5: Wire key/door/treasure into the game shell

**Files:**
- Modify: `renderer/game.js` (imports; `buildEntities`; boss-death drop; key/door/treasure interactions; remove old stairs/victoryTile; state reset in `startNewRun` + `descendLevel`)

**Interfaces:**
- Consumes: `makeExitDoor` (Task 1); `spawnBossDrop`, `countBosses` (Task 2); `exit_door` spawns (Task 3); key/treasure rendering (Task 4); `LEVEL_CONFIG`, `FINAL_DEPTH`, `descendLevel`, `endRun` (existing).

No unit tests (DOM shell). Verify with `node --check`, a green `npm test`, and a runtime Electron boot.

- [ ] **Step 1: Update imports.** In `renderer/game.js`:

Change the entities import (game.js:2) to add `makeExitDoor` — append it to the existing import list from `./systems/entities.js` (keep all current names):

```javascript
import { computePlayerFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, makeExitDoor, WEAPON_TYPES, TILE, isWalkable } from './systems/entities.js'
```

Change the progression import (game.js:13, currently `import { countBosses, spawnLevelExit } from './systems/progression.js'`) to:

```javascript
import { countBosses, spawnBossDrop } from './systems/progression.js'
```

- [ ] **Step 2: Build the exit-door entity.** In `buildEntities` (game.js, the `switch (s.kind)`), add a case alongside `case 'door':` (game.js:144):

```javascript
      case 'exit_door': return [makeExitDoor(s.x, s.y)]
```

- [ ] **Step 3: Replace the stairs + victory interaction.** In `update`, replace the two blocks at game.js:270-278:

```javascript
  // Stairs
  if (map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
    descendLevel(); return
  }

  // Victory: walk onto the treasure the final boss dropped
  if (state.victoryTile && player.x === state.victoryTile.x && player.y === state.victoryTile.y) {
    state.gameOver = true; endRun(true); return
  }
```

with:

```javascript
  // Key pickup — walk onto the key the boss dropped
  const keyIdx = state.entities.findIndex(e => e.type === 'key' && e.x === player.x && e.y === player.y)
  if (keyIdx !== -1) {
    state.entities = state.entities.filter((_, i) => i !== keyIdx)
    state.hasKey = true
    state.log = [...state.log, 'You picked up the key!'].slice(-5)
  }

  // Exit door — open and descend with the key, otherwise it stays locked
  const exitDoor = state.entities.find(e => e.type === 'door' && e.isExit && e.x === player.x && e.y === player.y)
  if (exitDoor) {
    if (state.hasKey) {
      exitDoor.opening = true; exitDoor.frame = 3
      state.hasKey = false
      descendLevel(); return
    }
    state.lockedMsgCooldown = Math.max(0, (state.lockedMsgCooldown ?? 0) - delta)
    if (state.lockedMsgCooldown <= 0) {
      state.log = [...state.log, 'The door is locked — defeat the boss for its key.'].slice(-5)
      state.lockedMsgCooldown = 2
    }
  }

  // Victory: walk onto the treasure the final boss dropped
  const treasureIdx = state.entities.findIndex(e => e.type === 'treasure' && e.x === player.x && e.y === player.y)
  if (treasureIdx !== -1) { state.gameOver = true; endRun(true); return }
```

- [ ] **Step 4: Replace the boss-death drop logic.** In `update`, replace the boss-gating `else if` branch (the block that calls `spawnLevelExit`, game.js:~547-553):

```javascript
  } else if (state.lastBossTile && !state.exitSpawned) {
    const isFinal = state.level >= FINAL_DEPTH
    const victoryTile = spawnLevelExit(state.map, state.lastBossTile, isFinal)
    if (victoryTile) state.victoryTile = victoryTile
    state.exitSpawned = true
    state.log = [...state.log, isFinal ? 'The dragon falls — treasure glimmers!' : 'The way down opens.'].slice(-5)
  }
```

with:

```javascript
  } else if (state.lastBossTile && !state.dropSpawned) {
    const isFinal = state.level >= FINAL_DEPTH
    const cfg = LEVEL_CONFIG.find(c => c.depth === state.level) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
    state.entities.push(spawnBossDrop(state.lastBossTile, isFinal, cfg.weapons))
    state.dropSpawned = true
    state.log = [...state.log, isFinal ? 'The dragon falls — treasure gleams!' : 'The boss drops a key!'].slice(-5)
  }
```

- [ ] **Step 5: Reset gate state in `startNewRun`.** Replace the three fields at game.js:189-191:

```javascript
    exitSpawned: false,
    lastBossTile: null,
    victoryTile: null,
```

with:

```javascript
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    lockedMsgCooldown: 0,
```

- [ ] **Step 6: Reset gate state in `descendLevel`.** Replace the three fields at game.js:583-585 (inside the `state = { ...state, ... }` object):

```javascript
    exitSpawned: false,
    lastBossTile: null,
    victoryTile: null,
```

with:

```javascript
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    lockedMsgCooldown: 0,
```

- [ ] **Step 7: Verify parse + suite.**

Run: `node --check renderer/game.js && npm test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `node --check` exits 0 (no output); suite all pass, 0 fail.

- [ ] **Step 8: Runtime verification (Electron + Playwright on WSLg, DISPLAY=:0).**

Confirm the game boots on level 1 with zero console errors, and that the level-1 generation produces an `exit_door` spawn (in the live renderer with real structures). Use a temporary script in the project root (so `node_modules` resolves), then delete it:

```javascript
// _kdtest.mjs
import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })
const win = await app.firstWindow()
const errors = []
win.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
win.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
await win.waitForTimeout(3000)
const res = await win.evaluate(async () => {
  const structures = await window.saveAPI.loadStructures()
  const { generateLevel } = await import('./systems/map.js')
  const { entitySpawns } = generateLevel(1, 50, 32, { structures })
  return {
    hasCanvas: !!document.getElementById('game-canvas'),
    exitDoors: entitySpawns.filter(s => s.kind === 'exit_door').length,
    crabBoss: entitySpawns.some(s => s.kind === 'crab' && s.isBoss),
  }
})
console.log('RESULT', JSON.stringify(res), 'ERRORS', errors.length, JSON.stringify(errors.slice(0,5)))
await app.close()
```

Run: `node ./_kdtest.mjs` then `rm -f ./_kdtest.mjs`
Expected: `RESULT {"hasCanvas":true,"exitDoors":1,"crabBoss":true} ERRORS 0 []`. Document the observed output in the report. If the optional deeper check is feasible, also describe driving the player to the crab to confirm key drop → door open; otherwise note it was verified by the generation + boot evidence.

- [ ] **Step 9: Commit**

```bash
git add renderer/game.js
git commit -m "feat(game): boss-key opens pre-placed exit door; final treasure win"
```

---

## Self-Review

**Spec coverage:**
- Pre-placed locked exit door (L1–4), far room → Task 3 (`generateLevel`) + Task 1 (`makeExitDoor`) + Task 5 step 2 (build). ✓
- No door on L5 → Task 3 (depth < FINAL_DEPTH guard) + test. ✓
- Boss drops key (L1–4) / treasure (L5) at corpse tile → Task 2 (`spawnBossDrop`) + Task 5 step 4. ✓
- Key pickup sets `state.hasKey`, walk-onto → Task 5 step 3. ✓
- Door opens with key, consumes key, descends; locked message without key → Task 5 step 3. ✓
- Treasure walk-onto wins → Task 5 step 3. ✓
- Remove old `STAIRS_DOWN`-on-death + `victoryTile` → Task 5 steps 3, 4, 5, 6 (and Task 3 fallback no longer carves stairs). ✓
- Per-level state reset (`hasKey`, `dropSpawned`, `lastBossTile`, `lockedMsgCooldown`) in both `startNewRun` and `descendLevel` → Task 5 steps 5, 6. ✓
- Key sprite + gold treasure render → Task 4. ✓
- Door entity reuses door frames, not a blocking tile → Task 1 (`makeExitDoor`) + Task 4 (existing door render). ✓
- Testing per project boundary (systems/data unit-tested; game.js via check + suite + runtime) → Tasks 1–3 tests; Task 5 step 7–8. ✓

**Placeholder scan:** Gold-weapon treasure is an explicit approved placeholder (spec). No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `spawnBossDrop(tile, isFinal, weaponPool)` returns an entity, pushed directly in Task 5 step 4. `makeKey`/`makeExitDoor`/`makeTreasure` shapes defined in Task 1 match their use in Tasks 2, 4, 5. Entity `type` strings (`'key'`, `'treasure'`, `'door'`+`isExit`) are consistent across factories (Task 1), rendering (Task 4), and interactions (Task 5). State fields (`hasKey`, `dropSpawned`, `lastBossTile`, `lockedMsgCooldown`) are introduced and reset consistently in Task 5 steps 4–6. ✓
