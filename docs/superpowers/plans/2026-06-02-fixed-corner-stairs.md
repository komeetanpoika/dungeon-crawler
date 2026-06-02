# Fixed Corner Stairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace room-anchored staircase passages with fixed-corner passages — entrance always at top-left (col 2, row 1), exit always at bottom-right (col 77, rows 41–48) — connected to the dungeon by a corridor from the nearest room, with stair tiles always rendering at full brightness.

**Architecture:** `carveEntrancePassage` and `carveExitPassage` in `map.js` are rewritten to use fixed coordinates and accept `rooms` to find the nearest connection point. `stairsRoom` selection is removed from `generateLevel`. The canvas tile loop gains a one-line stair bypass before the FOV skip.

**Tech Stack:** Vanilla JS, Node.js test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/map.js` | Rewrite `carveEntrancePassage` (fixed col 2); rewrite `carveExitPassage` (fixed col 77); remove `stairsRoom` selection from `generateLevel`; update call sites |
| `renderer/render/canvas.js` | Stair tiles bypass `!t.explored` skip and fog overlay |
| `test/map.test.js` | Add fixed-coordinate assertions; remove/update room-anchored assertions |

---

## Task 1: Fixed entrance passage

**Files:**
- Modify: `renderer/systems/map.js:110-138` (`carveEntrancePassage`)
- Modify: `renderer/systems/map.js:483-485` (call site in `generateLevel`)
- Test: `test/map.test.js`

- [ ] **Step 1: Write a failing test**

Add to the `generateLevel` describe block in `test/map.test.js`:

```js
it('playerSpawn is always at col 2, row 1', () => {
  for (let depth = 1; depth <= 9; depth++) {
    const { playerSpawn } = generateLevel(depth)
    assert.equal(playerSpawn.x, 2,  `depth ${depth}: playerSpawn.x should be 2`)
    assert.equal(playerSpawn.y, 1,  `depth ${depth}: playerSpawn.y should be 1`)
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -E "playerSpawn.*col 2|FAIL|fail" | head -5
```

Expected: test fails (playerSpawn is not at col 2, row 1 with current room-anchored logic).

- [ ] **Step 3: Rewrite `carveEntrancePassage` in `renderer/systems/map.js`**

Replace the entire `carveEntrancePassage` function (currently lines 110–138) with:

```js
function carveEntrancePassage(map, rooms) {
  const col = 2
  for (let row = 1; row <= 8; row++) {
    if (!map[row]?.[col]) continue
    map[row][col].tile      = TILE.STAIR
    map[row][col].stairCol  = 0
    map[row][col].stairWidth = 1
  }
  if (map[1]?.[col]) map[1][col].tile = TILE.STAIRS_UP

  const nearest = rooms.reduce((best, r) => {
    const c = center(r), d = Math.abs(c.x - col) + Math.abs(c.y - 9)
    return d < best.d ? { d, r } : best
  }, { d: Infinity, r: rooms[0] })
  carveCorridor(map, center(nearest.r).x, center(nearest.r).y, col, 9)

  return { x: col, y: 1 }
}
```

- [ ] **Step 4: Update the call site in `generateLevel`**

Find (around line 483):
```js
    const entranceSpawn = carveEntrancePassage(map, spawnRoom, staircaseWidth)
    if (!entranceSpawn) map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // fallback if OOB
```

Replace with:
```js
    const entranceSpawn = carveEntrancePassage(map, rooms)
```

`entranceSpawn` is now always `{ x: 2, y: 1 }` — no fallback needed. The line after (`const playerSpawn = entranceSpawn ?? spawnC`) can remain as-is; it will always use `entranceSpawn`.

- [ ] **Step 5: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass, including the new fixed-coordinate test.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: entrance passage fixed at col 2 row 1; corridor to nearest room"
```

---

## Task 2: Fixed exit passage + remove stairsRoom

**Files:**
- Modify: `renderer/systems/map.js:139-181` (`carveExitPassage`)
- Modify: `renderer/systems/map.js:411-420` (stairsRoom selection in `generateLevel`)
- Modify: `renderer/systems/map.js:422-426` (landmark candidates filter)
- Modify: `renderer/systems/map.js:480-481` (carveExitPassage call site)
- Test: `test/map.test.js`

- [ ] **Step 1: Write a failing test**

Add to the `generateLevel` describe block in `test/map.test.js`:

```js
it('STAIRS_DOWN is always at col 77 (MAP_W-3), row 45 (MAP_H-5)', () => {
  for (let depth = 1; depth < 9; depth++) {
    const { map } = generateLevel(depth)
    let sx = -1, sy = -1
    for (let y = 0; y < map.length && sx === -1; y++)
      for (let x = 0; x < map[y].length && sx === -1; x++)
        if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
    assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
    assert.equal(sx, 77, `depth ${depth}: STAIRS_DOWN should be at col 77, got ${sx}`)
    assert.equal(sy, 45, `depth ${depth}: STAIRS_DOWN should be at row 45, got ${sy}`)
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -E "col 77|MAP_W|FAIL|fail" | head -5
```

Expected: test fails (STAIRS_DOWN is at a random room-based position).

- [ ] **Step 3: Rewrite `carveExitPassage` in `renderer/systems/map.js`**

Replace the entire `carveExitPassage` function (currently lines 139–181) with:

```js
function carveExitPassage(map, width, rooms) {
  const WALKABLE_LEN = 4
  const VOID_LEN    = 3
  const half       = Math.floor((width - 1) / 2)
  const centerCol  = map[0].length - 3          // 77 for MAP_W=80
  const startRow   = map.length - 9             // 41 for MAP_H=50
  const endRow     = map.length - 2             // 48 for MAP_H=50

  for (let row = startRow; row <= endRow; row++) {
    const depth       = row - startRow          // 0 at row 41, 7 at row 48
    const isStairsDown = depth === WALKABLE_LEN // depth 4 → row 45
    const isVoid       = depth >  WALKABLE_LEN  // depths 5–7

    for (let i = 0; i < width; i++) {
      const col = centerCol - half + i
      if (!map[row]?.[col]) continue

      if (isStairsDown && i === Math.floor((width - 1) / 2)) {
        map[row][col].tile       = TILE.STAIRS_DOWN
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
        map[row][col].voidZone   = false
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
        map[row][col].voidZone   = false
      }
    }
  }

  // Connect passage to nearest room via a corridor to the tile just above the passage
  const connRow = startRow - 1                  // row 40
  const nearest = rooms.reduce((best, r) => {
    const c = center(r), d = Math.abs(c.x - centerCol) + Math.abs(c.y - connRow)
    return d < best.d ? { d, r } : best
  }, { d: Infinity, r: rooms[0] })
  carveCorridor(map, center(nearest.r).x, center(nearest.r).y, centerCol, connRow)
}
```

- [ ] **Step 4: Remove `stairsRoom` selection from `generateLevel`**

Find and remove these lines (around lines 411–420):
```js
    // Stairs-down room: farthest from spawn, with enough space below for 8-tile exit passage
    const nonSpawn = rooms.filter(r => r !== spawnRoom)
    const passageClearance = nonSpawn.filter(r => r.y + r.h < height - 9)
    const stairsPool = passageClearance.length > 0 ? passageClearance : nonSpawn
    const stairsRoom = stairsPool.reduce((best, r) => {
      const c = center(r), bc = center(best)
      const d  = Math.abs(c.x  - spawnC.x) + Math.abs(c.y  - spawnC.y)
      const bd = Math.abs(bc.x - spawnC.x) + Math.abs(bc.y - spawnC.y)
      return d > bd ? r : best
    }, stairsPool[0] ?? rooms[0])
```

- [ ] **Step 5: Update landmark candidates filter**

Find (around line 422):
```js
    const landmarkCandidates = rooms.filter(r => r !== spawnRoom && r !== stairsRoom)
```

Replace with:
```js
    const landmarkCandidates = rooms.filter(r => r !== spawnRoom)
```

- [ ] **Step 6: Update the `carveExitPassage` call site**

Find (around line 480):
```js
    if (depth < FINAL_DEPTH) carveExitPassage(map, stairsRoom, staircaseWidth)
```

Replace with:
```js
    if (depth < FINAL_DEPTH) carveExitPassage(map, staircaseWidth, rooms)
```

- [ ] **Step 7: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass. Run 3 times to confirm stability.

- [ ] **Step 8: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: exit passage fixed at col 77 rows 41-48; corridor to nearest room; remove stairsRoom selection"
```

---

## Task 3: Stair tiles bypass FOV

**Files:**
- Modify: `renderer/render/canvas.js:502-514` (tile rendering loop)

No unit tests — this is purely visual. Verify manually by starting a level and confirming stair tiles are visible through walls/darkness.

- [ ] **Step 1: Update the tile rendering loop in `renderer/render/canvas.js`**

Find this block (lines 502–514):
```js
    for (let row = r0; row < r1; row++) {
      for (let col = c0; col < c1; col++) {
        const px = Math.round(col * S - camX)
        const py = Math.round(row * S - camY)
        const t = map[row][col]
        if (!t.explored) continue
        drawTile(ctx, t.tile, px, py, S, sprites, t)
        if (!t.visible) {
          ctx.fillStyle = `rgba(0,0,0,${theme.fogAlpha})`
          ctx.fillRect(px, py, S, S)
        }
      }
    }
```

Replace with:
```js
    for (let row = r0; row < r1; row++) {
      for (let col = c0; col < c1; col++) {
        const px = Math.round(col * S - camX)
        const py = Math.round(row * S - camY)
        const t = map[row][col]
        const isStair = t.tile === TILE.STAIR || t.tile === TILE.STAIRS_UP || t.tile === TILE.STAIRS_DOWN
        if (!t.explored && !isStair) continue
        drawTile(ctx, t.tile, px, py, S, sprites, t)
        if (!t.visible && !isStair) {
          ctx.fillStyle = `rgba(0,0,0,${theme.fogAlpha})`
          ctx.fillRect(px, py, S, S)
        }
      }
    }
```

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: stair tiles always render at full brightness regardless of FOV"
```

---

## Self-Review

**Spec coverage:**
- ✅ Entrance at col 2, rows 1–8, STAIRS_UP at (2,1): Task 1
- ✅ Exit at col 77, rows 41–48, STAIRS_DOWN at row 45: Task 2
- ✅ Corridor from nearest room: Tasks 1 and 2 (both `carveXPassage` functions)
- ✅ spawnRoom kept for entity/landmark use, stairsRoom removed: Task 2
- ✅ Stair tiles bypass FOV: Task 3
- ✅ Width=1 always for entrance: Task 1 (`carveEntrancePassage` has no width param)
- ✅ Multi-column exit (depth 6/9): Task 2 (`half` expansion leftward from col 77)

**Placeholders:** None.

**Type consistency:** `carveEntrancePassage(map, rooms)` and `carveExitPassage(map, width, rooms)` — signatures used consistently in both function definitions and call sites.
