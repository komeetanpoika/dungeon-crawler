# Staircase Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework staircase passages so they descend into an impassable void, auto-trigger level descent on step, spawn the player at the top of the entrance passage, and ensure the passage is always surrounded by wall tiles.

**Architecture:** Four changes to map.js (12-tile exit passage, void zone, isolation check, entrance spawn), one to entities.js (isWalkable void-zone), one to game.js (remove Enter gate), one to canvas.js (darkness gradient). All changes are backward-compatible; no new tile constants needed.

**Tech Stack:** Vanilla JS, Node.js test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | `isWalkable` accepts optional tile object; returns false when `voidZone: true` |
| `renderer/systems/map.js` | `carveExitPassage` 12-tile structure; `passageIsolated` helper; room selection filters; entrance spawn at topRow |
| `renderer/game.js` | Remove `keys['Enter'] &&` gate from STAIRS_DOWN check |
| `renderer/render/canvas.js` | Darkness overlay on STAIR and STAIRS_DOWN tiles using `stairDepth` |
| `test/map.test.js` | Update entrance spawn tests; add void-zone and exit passage structure tests |

---

## Task 1: isWalkable — void-zone support

**Files:**
- Modify: `renderer/systems/entities.js:25-27`
- Modify: `renderer/systems/entities.js:37` (hasLineOfSight call site)
- Modify: `renderer/game.js:76` (player movement)
- Modify: `renderer/game.js:307` (enemy movement)
- Test: `test/map.test.js`

- [ ] **Step 1: Write failing tests**

Add this describe block to `test/map.test.js` (after the existing `isFullyConnected` block):

```js
describe('isWalkable — void zone', () => {
  it('returns false for a STAIR tile with voidZone:true', () => {
    assert.equal(isWalkable(TILE.STAIR, { voidZone: true }), false)
  })
  it('returns true for a STAIR tile without a tile object', () => {
    assert.equal(isWalkable(TILE.STAIR), true)
  })
  it('returns true for a STAIR tile with voidZone:false', () => {
    assert.equal(isWalkable(TILE.STAIR, { voidZone: false }), true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -E "FAIL|pass|fail|isWalkable"
```

Expected: the three new tests FAIL (isWalkable ignores the second argument).

- [ ] **Step 3: Update `isWalkable` in `renderer/systems/entities.js:25-27`**

```js
export function isWalkable(tileId, tileObj = null) {
  if (tileObj?.voidZone) return false
  return tileId !== TILE.WALL && tileId !== TILE.COLUMN
}
```

- [ ] **Step 4: Update `hasLineOfSight` call site in `renderer/systems/entities.js:37`**

```js
// before
if (!map[y]?.[x] || !isWalkable(map[y][x].tile)) return false
// after
if (!map[y]?.[x] || !isWalkable(map[y][x].tile, map[y][x])) return false
```

- [ ] **Step 5: Update player movement check in `renderer/game.js:76`**

```js
// before
return tile && isWalkable(tile.tile)
// after
return tile && isWalkable(tile.tile, tile)
```

- [ ] **Step 6: Update enemy movement check in `renderer/game.js:307`**

```js
// before
if (!tile || !isWalkable(tile.tile)) continue
// after
if (!tile || !isWalkable(tile.tile, tile)) continue
```

- [ ] **Step 7: Run all tests and verify they pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass (the three new ones now pass; no regressions).

- [ ] **Step 8: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/entities.js renderer/game.js test/map.test.js && git commit -m "feat: isWalkable accepts tile object; returns false for voidZone tiles"
```

---

## Task 2: carveExitPassage — 12-tile structure with void zone

**Files:**
- Modify: `renderer/systems/map.js:139-161`
- Test: `test/map.test.js`

The new passage structure (all rows relative to `entryRow = stairsRoom.y + stairsRoom.h - 1`):
- `entryRow`: FLOOR (south wall of room, opened — same as before)
- `entryRow+1` to `entryRow+7`: TILE.STAIR, walkable, `stairDepth` 0–6
- `entryRow+8`: TILE.STAIRS_DOWN, walkable, `stairDepth` 7
- `entryRow+9` to `entryRow+12`: TILE.STAIR, `voidZone: true`, `stairDepth` 8–11

- [ ] **Step 1: Write failing tests**

Add to the `generateLevel` describe block in `test/map.test.js`:

```js
it('STAIRS_DOWN has 7 walkable STAIR tiles above it in the exit passage', () => {
  for (let depth = 1; depth < 9; depth++) {
    const { map } = generateLevel(depth)
    let sx = -1, sy = -1
    for (let y = 0; y < map.length && sx === -1; y++)
      for (let x = 0; x < map[y].length && sx === -1; x++)
        if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
    assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
    for (let dy = 1; dy <= 7; dy++) {
      const t = map[sy - dy]?.[sx]
      assert.ok(t, `depth ${depth}: row sy-${dy} out of bounds`)
      assert.equal(t.tile, TILE.STAIR, `depth ${depth}: row sy-${dy} should be TILE.STAIR`)
      assert.ok(!t.voidZone, `depth ${depth}: row sy-${dy} should not be voidZone`)
    }
  }
})

it('STAIRS_DOWN has 4 non-walkable void STAIR tiles below it', () => {
  for (let depth = 1; depth < 9; depth++) {
    const { map } = generateLevel(depth)
    let sx = -1, sy = -1
    for (let y = 0; y < map.length && sx === -1; y++)
      for (let x = 0; x < map[y].length && sx === -1; x++)
        if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
    assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
    let voidCount = 0
    for (let dy = 1; dy <= 4; dy++) {
      const t = map[sy + dy]?.[sx]
      if (!t) break  // hit map edge — acceptable near boundary
      assert.equal(t.tile, TILE.STAIR, `depth ${depth}: row sy+${dy} should be TILE.STAIR`)
      assert.equal(t.voidZone, true, `depth ${depth}: row sy+${dy} should be voidZone`)
      assert.equal(isWalkable(t.tile, t), false, `depth ${depth}: row sy+${dy} should not be walkable`)
      voidCount++
    }
    assert.ok(voidCount >= 1, `depth ${depth}: expected at least 1 void tile below STAIRS_DOWN`)
  }
})

it('STAIRS_DOWN has stairDepth 7', () => {
  for (let depth = 1; depth < 9; depth++) {
    const { map } = generateLevel(depth)
    let sx = -1, sy = -1
    for (let y = 0; y < map.length && sx === -1; y++)
      for (let x = 0; x < map[y].length && sx === -1; x++)
        if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
    assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
    assert.equal(map[sy][sx].stairDepth, 7, `depth ${depth}: STAIRS_DOWN should have stairDepth 7`)
  }
})
```

Also **remove** this now-obsolete test (it expects STAIR below STAIRS_DOWN, but new structure has STAIR above):
```js
it('TILE.STAIR tiles exist below STAIRS_DOWN (exit passage)', () => { ... })
```

- [ ] **Step 2: Run tests to verify the new tests fail and old ones pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -10
```

Expected: the three new tests FAIL; no other regressions.

- [ ] **Step 3: Replace `carveExitPassage` in `renderer/systems/map.js:139-161`**

```js
function carveExitPassage(map, stairsRoom, width) {
  const sc = center(stairsRoom)
  const WALKABLE_LEN = 7   // walkable STAIR tiles before STAIRS_DOWN
  const VOID_LEN    = 4    // non-walkable void STAIR tiles after STAIRS_DOWN
  const half = Math.floor((width - 1) / 2)

  const entryRow  = stairsRoom.y + stairsRoom.h - 1
  const totalRows = WALKABLE_LEN + 1 + VOID_LEN  // 12
  const bottomRow = Math.min(map.length - 2, entryRow + totalRows)

  for (let row = entryRow + 1; row <= bottomRow; row++) {
    const depth = row - entryRow - 1  // 0-indexed: 0 at entryRow+1, 11 at entryRow+12
    const isVoid       = depth >= WALKABLE_LEN + 1                // depths 8–11
    const isStairsDown = depth === WALKABLE_LEN                   // depth 7

    for (let i = 0; i < width; i++) {
      const col = sc.x - half + i
      if (!map[row]?.[col]) continue

      if (isStairsDown && i === Math.floor((width - 1) / 2)) {
        // Centre column of the trigger row becomes STAIRS_DOWN
        map[row][col].tile       = TILE.STAIRS_DOWN
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
      } else if (isStairsDown) {
        // Non-centre columns on the STAIRS_DOWN row are regular walkable STAIR
        map[row][col].tile       = TILE.STAIR
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
      } else if (isVoid) {
        map[row][col].tile       = TILE.STAIR
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
        map[row][col].voidZone   = true
      } else {
        map[row][col].tile       = TILE.STAIR
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
      }
    }
  }
}
```

- [ ] **Step 4: Run all tests and verify they pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: exit passage 12 tiles — 7 STAIR + STAIRS_DOWN + 4 void zone with stairDepth"
```

---

## Task 3: Placement isolation check

**Files:**
- Modify: `renderer/systems/map.js` — add `passageIsolated` helper; update stairsRoom and spawnRoom selection
- Test: `test/map.test.js`

- [ ] **Step 1: Write failing test**

Add to the `generateLevel` describe block in `test/map.test.js`:

```js
it('exit passage sides are WALL tiles (no adjacent floor) across 5 generated levels per depth', () => {
  for (let depth = 1; depth < 9; depth++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { map } = generateLevel(depth)
      let sx = -1, sy = -1
      for (let y = 0; y < map.length && sx === -1; y++)
        for (let x = 0; x < map[y].length && sx === -1; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
      if (sx === -1) continue
      // Check 7 STAIR rows above STAIRS_DOWN and 4 void rows below
      for (let dy = -7; dy <= 4; dy++) {
        const row = sy + dy
        const leftTile  = map[row]?.[sx - 1]
        const rightTile = map[row]?.[sx + 1]
        if (leftTile)
          assert.equal(leftTile.tile, TILE.WALL,
            `depth ${depth} attempt ${attempt}: col left of passage at row ${row} should be WALL, got ${leftTile.tile}`)
        if (rightTile)
          assert.equal(rightTile.tile, TILE.WALL,
            `depth ${depth} attempt ${attempt}: col right of passage at row ${row} should be WALL, got ${rightTile.tile}`)
      }
    }
  }
})
```

- [ ] **Step 2: Run tests to verify the new test fails on some runs**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -E "isolation|passage sides|FAIL|fail"
```

Expected: the new test may fail (isolation not yet enforced) or pass by luck — run 2–3 times to confirm it is flaky.

- [ ] **Step 3: Add `passageIsolated` helper to `renderer/systems/map.js` (add after `createMap`)**

```js
function passageIsolated(map, cx, half, topRow, bottomRow) {
  for (let row = topRow; row <= bottomRow; row++)
    for (let col = cx - half - 1; col <= cx + half + 1; col++)
      if (map[row]?.[col]?.tile !== TILE.WALL) return false
  return true
}
```

- [ ] **Step 4: Move `staircaseWidth` extraction earlier in `generateLevel` and update stairsRoom pool**

In `generateLevel`, find the lines that compute `passageClearance` and `stairsPool`. The `staircaseWidth` extraction currently appears later in the function — move it to just before the room-selection section.

Replace this block (lines near 396–402 of map.js):
```js
const nonSpawn = rooms.filter(r => r !== spawnRoom)
const passageClearance = nonSpawn.filter(r => r.y + r.h < height - 9)
const stairsPool = passageClearance.length > 0 ? passageClearance : nonSpawn
```

With:
```js
const staircaseWidth = cfg.staircaseWidth ?? 1
const stairHalf = Math.floor((staircaseWidth - 1) / 2)

const nonSpawn = rooms.filter(r => r !== spawnRoom)
const passageClearance = nonSpawn.filter(r => {
  if (r.y + r.h >= height - 13) return false
  const cx = center(r).x
  const entryRow = r.y + r.h - 1
  return passageIsolated(map, cx, stairHalf, entryRow + 1, Math.min(map.length - 2, entryRow + 12))
})
const stairsPool = passageClearance.length > 0 ? passageClearance : nonSpawn
```

Note: the clearance row check changes from `< height - 9` to `>= height - 13` to account for the longer 12-tile passage.

- [ ] **Step 5: Update spawnRoom selection to add entrance passage isolation check**

Replace the `alcoveReady` filter block:
```js
const alcoveReady = rooms.filter(r => r.y >= 4)
const spawnPool = alcoveReady.length > 0 ? alcoveReady : rooms
```

With:
```js
const alcoveReady = rooms.filter(r => {
  if (r.y < 4) return false
  const cx = center(r).x
  const topRow = Math.max(1, r.y - 8)
  return passageIsolated(map, cx, stairHalf, topRow, r.y - 1)
})
const spawnPool = alcoveReady.length > 0 ? alcoveReady : rooms
```

- [ ] **Step 6: Remove the now-duplicate `const staircaseWidth = cfg.staircaseWidth ?? 1` line** that appears later in `generateLevel` (around line 462 in the original) since it was moved earlier in Step 4.

- [ ] **Step 7: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass. Run 3 times to confirm the isolation test is stable.

- [ ] **Step 8: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: passage isolation check — stairsRoom and spawnRoom must have clear passage footprint"
```

---

## Task 4: carveEntrancePassage — spawn at STAIRS_UP

**Files:**
- Modify: `renderer/systems/map.js:110-137`
- Test: `test/map.test.js`

- [ ] **Step 1: Update failing tests in `test/map.test.js`**

Replace the existing `playerSpawn is on TILE.STAIR` test:
```js
// REMOVE this test:
it('playerSpawn is on TILE.STAIR (inside entrance passage)', () => { ... })
// REMOVE this test:
it('STAIRS_UP is directly above playerSpawn within 8 tiles', () => { ... })
```

Add these replacements:
```js
it('playerSpawn is on TILE.STAIRS_UP (top of entrance passage)', () => {
  for (let depth = 1; depth <= 9; depth++) {
    const { map, playerSpawn } = generateLevel(depth)
    assert.equal(map[playerSpawn.y][playerSpawn.x].tile, TILE.STAIRS_UP,
      `depth ${depth}: playerSpawn should be TILE.STAIRS_UP`)
  }
})

it('entrance passage STAIR tiles lead south from playerSpawn into dungeon', () => {
  for (let depth = 1; depth <= 9; depth++) {
    const { map, playerSpawn } = generateLevel(depth)
    let foundStair = false
    for (let dy = 1; dy <= 8 && !foundStair; dy++)
      if (map[playerSpawn.y + dy]?.[playerSpawn.x]?.tile === TILE.STAIR) foundStair = true
    assert.ok(foundStair, `depth ${depth}: no STAIR tile south of playerSpawn (STAIRS_UP)`)
  }
})
```

- [ ] **Step 2: Run tests to verify the new tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -E "STAIRS_UP|entrance passage|FAIL|fail"
```

Expected: the two new tests fail (`playerSpawn` is still on TILE.STAIR, not TILE.STAIRS_UP).

- [ ] **Step 3: Update the return value in `carveEntrancePassage`**

In `renderer/systems/map.js`, find this line (currently around line 136):
```js
  // Player spawns at the bottom tile of the passage (one tile above spawn room's top wall)
  return { x: sc.x, y: spawnRoom.y - 1 }
```

Replace with:
```js
  return { x: sc.x, y: topRow }
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: player spawns at STAIRS_UP (top of entrance passage)"
```

---

## Task 5: Auto-trigger descent on step

**Files:**
- Modify: `renderer/game.js:234-236`

- [ ] **Step 1: Remove the Enter-key gate**

Find this block in `renderer/game.js`:
```js
  // Stairs
  if (keys['Enter'] && map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
    keys['Enter'] = false
    descendLevel(); return
  }
```

Replace with:
```js
  // Stairs
  if (map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
    descendLevel(); return
  }
```

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js && git commit -m "feat: stepping on STAIRS_DOWN auto-triggers level descent (no Enter required)"
```

---

## Task 6: Darkness gradient on stair tiles

**Files:**
- Modify: `renderer/render/canvas.js:6-18` (TILE.STAIR block) and lines 40-41 (generic drawImage path)

`stairDepth` is set only on exit passage tiles (depths 0–11). Entrance passage tiles have no `stairDepth`, so they naturally get `alpha = 0` (no overlay).

- [ ] **Step 1: Update the TILE.STAIR block in `renderer/render/canvas.js`**

Find this block (lines 7–18):
```js
  if (tileId === TILE.STAIR) {
    const w   = tileObj?.stairWidth ?? 1
    const col = tileObj?.stairCol   ?? 0
    let s
    if (w === 3) {
      s = col === 0 ? sprites.stair_left : col === 1 ? sprites.stair_mid : sprites.stair_right
    }
    s = s ?? sprites.stair
    if (s) ctx.drawImage(s, px, py, S, S)
    else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
    return
  }
```

Replace with:
```js
  if (tileId === TILE.STAIR) {
    const w   = tileObj?.stairWidth ?? 1
    const col = tileObj?.stairCol   ?? 0
    let s
    if (w === 3) {
      s = col === 0 ? sprites.stair_left : col === 1 ? sprites.stair_mid : sprites.stair_right
    }
    s = s ?? sprites.stair
    if (s) ctx.drawImage(s, px, py, S, S)
    else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
    const depth = tileObj?.stairDepth ?? 0
    if (depth > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(depth / 11, 1) * 0.85})`
      ctx.fillRect(px, py, S, S)
    }
    return
  }
```

- [ ] **Step 2: Add darkness overlay for STAIRS_DOWN in the generic drawImage path**

Find these lines (lines 40–41 in the original):
```js
  if (s) ctx.drawImage(s, px, py, S, S)
  else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
```

Replace with:
```js
  if (s) ctx.drawImage(s, px, py, S, S)
  else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
  if (tileId === TILE.STAIRS_DOWN && tileObj?.stairDepth != null) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(tileObj.stairDepth / 11, 1) * 0.85})`
    ctx.fillRect(px, py, S, S)
  }
```

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: darkness gradient on exit stair passage tiles using stairDepth"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Exit passage 12 tiles, void zone: Task 2
  - ✅ `voidZone` walkability: Task 1
  - ✅ Auto-trigger: Task 5
  - ✅ Darkness gradient: Task 6
  - ✅ Entrance spawn at STAIRS_UP: Task 4
  - ✅ Isolation check (exit + entrance): Task 3
- **Placeholders:** none
- **Type consistency:** `stairDepth`, `voidZone`, `stairCol`, `stairWidth` used consistently across all tasks; `isWalkable(tileId, tileObj)` signature consistent across Tasks 1–3
