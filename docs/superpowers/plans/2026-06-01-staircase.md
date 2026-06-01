# Staircase Passages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat stair tiles and the 5×3 alcove with carved 8-tile staircase passages above (entrance) and below (exit) room walls, width scaling with depth.

**Architecture:** Four tasks — (1) add TILE.STAIR constant, stair sprites, and staircaseWidth to LEVEL_CONFIG; (2) write carveEntrancePassage + carveExitPassage and update map tests; (3) wire the new functions into generateLevel replacing carveAlcove; (4) render TILE.STAIR in canvas.js and add sprite tests.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron, `node --test`

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Add `TILE.STAIR = 11` |
| `renderer/data/levels.js` | Add `staircaseWidth` to each `LEVEL_CONFIG` entry |
| `renderer/render/sprites.js` | Add `stair`, `stair_left`, `stair_mid`, `stair_right` |
| `renderer/systems/map.js` | Replace `carveAlcove` with `carveEntrancePassage`; add `carveExitPassage`; update `generateLevel` |
| `renderer/render/canvas.js` | Add `TILE.STAIR` handling to `drawTile`; pass tile object at call site |
| `test/map.test.js` | Replace stair proximity test; add 3 new staircase passage tests |
| `test/sprites.test.js` | Add assertions for `stair`, `stair_left`, `stair_mid`, `stair_right` |

---

## Task 1: TILE.STAIR + sprites + LEVEL_CONFIG

**Files:**
- Modify: `renderer/systems/entities.js`
- Modify: `renderer/render/sprites.js`
- Modify: `renderer/data/levels.js`

No automated tests — verified by later tasks that import these.

- [ ] **Step 1: Add TILE.STAIR to entities.js**

In `renderer/systems/entities.js`, find:

```js
  SAND: 10,
}
```

Replace with:

```js
  SAND: 10,
  STAIR: 11,
}
```

- [ ] **Step 2: Add stair sprites to sprites.js**

In `renderer/render/sprites.js`, find:

```js
  prop_drain_empty:    'tile_0043',
  prop_drain_liquid:   'tile_0044',
```

Replace with:

```js
  prop_drain_empty:    'tile_0043',
  prop_drain_liquid:   'tile_0044',
  // staircase passages
  stair:       'tile_0039',
  stair_left:  'tile_0036',
  stair_mid:   'tile_0037',
  stair_right: 'tile_0038',
```

- [ ] **Step 3: Add staircaseWidth to LEVEL_CONFIG**

In `renderer/data/levels.js`, replace the entire `LEVEL_CONFIG` array with:

```js
export const LEVEL_CONFIG = [
  { depth: 1, staircaseWidth: 1, guardCount:  2, monsterDensity: 0,     trapDensity: 0.03, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'ARMORY',     weapons: ['dagger'] },
  { depth: 2, staircaseWidth: 1, guardCount:  3, monsterDensity: 0,     trapDensity: 0.04, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'GATEHOUSE',  weapons: ['dagger'],               crabCount: 1 },
  { depth: 3, staircaseWidth: 1, guardCount:  4, monsterDensity: 0,     trapDensity: 0.05, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['dagger'],               wizardCount: 1, crabCount: 1 },
  { depth: 4, staircaseWidth: 1, guardCount:  5, monsterDensity: 0,     trapDensity: 0.06, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'INFIRMARY',  weapons: ['dagger', 'sword'],      wizardCount: 1, crabCount: 2 },
  { depth: 5, staircaseWidth: 1, guardCount:  6, monsterDensity: 0.005, trapDensity: 0.07, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'VAULT',      weapons: ['dagger', 'sword'],      wizardCount: 2 },
  { depth: 6, staircaseWidth: 2, guardCount:  7, monsterDensity: 0.007, trapDensity: 0.08, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['sword', 'longsword'],   cyclopsArena: true },
  { depth: 7, staircaseWidth: 1, guardCount:  8, monsterDensity: 0.010, trapDensity: 0.09, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['sword', 'longsword', 'axe'] },
  { depth: 8, staircaseWidth: 1, guardCount:  9, monsterDensity: 0.012, trapDensity: 0.10, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['longsword', 'axe'] },
  { depth: 9, staircaseWidth: 3, guardCount: 10, monsterDensity: 0.015, trapDensity: 0.11, puzzleDensity: 0.04, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'DRAGON_LAIR', weapons: ['longsword', 'axe'] },
]
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all 106 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/entities.js renderer/render/sprites.js renderer/data/levels.js && git commit -m "feat: TILE.STAIR constant; stair sprites; staircaseWidth in LEVEL_CONFIG"
```

---

## Task 2: Passage carver functions + map tests

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `test/map.test.js`

- [ ] **Step 1: Update existing stair proximity test and add new staircase tests**

In `test/map.test.js`, find and replace:

```js
  it('playerSpawn is a walkable tile and has STAIRS_UP within 3 tiles', () => {
    for (let depth = 1; depth <= 3; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      assert.equal(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), true,
        `depth ${depth}: playerSpawn tile not walkable`)
      let found = false
      for (let dy = -3; dy <= 3 && !found; dy++)
        for (let dx = -3; dx <= 3 && !found; dx++)
          if (map[playerSpawn.y + dy]?.[playerSpawn.x + dx]?.tile === TILE.STAIRS_UP) found = true
      assert.ok(found, `depth ${depth}: no STAIRS_UP within 3 tiles of playerSpawn`)
    }
  })
```

Replace with:

```js
  it('playerSpawn is on TILE.STAIR (inside entrance passage)', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      assert.equal(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), true,
        `depth ${depth}: playerSpawn not walkable`)
      assert.equal(map[playerSpawn.y][playerSpawn.x].tile, TILE.STAIR,
        `depth ${depth}: playerSpawn should be TILE.STAIR, got ${map[playerSpawn.y][playerSpawn.x].tile}`)
    }
  })

  it('STAIRS_UP is directly above playerSpawn within 8 tiles', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      let found = false
      for (let dy = 1; dy <= 8 && !found; dy++)
        if (map[playerSpawn.y - dy]?.[playerSpawn.x]?.tile === TILE.STAIRS_UP) found = true
      assert.ok(found, `depth ${depth}: no STAIRS_UP directly above playerSpawn within 8 tiles`)
    }
  })

  it('TILE.STAIR tiles exist below STAIRS_DOWN (exit passage)', () => {
    for (let depth = 1; depth < 9; depth++) {
      const { map } = generateLevel(depth)
      let sx = -1, sy = -1
      for (let y = 0; y < map.length && sx === -1; y++)
        for (let x = 0; x < map[y].length && sx === -1; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
      assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
      let hasStairBelow = false
      for (let dy = 1; dy <= 8 && !hasStairBelow; dy++)
        if (map[sy + dy]?.[sx]?.tile === TILE.STAIR) hasStairBelow = true
      assert.ok(hasStairBelow, `depth ${depth}: no TILE.STAIR below STAIRS_DOWN`)
    }
  })
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -8
```

Expected: FAIL — `TILE.STAIR` is 11 but `carveEntrancePassage` doesn't exist yet (alcove still returns TILE.FLOOR tile for playerSpawn).

- [ ] **Step 3: Add carveEntrancePassage to map.js**

In `renderer/systems/map.js`, find the existing `carveAlcove` function and replace it with:

```js
function carveEntrancePassage(map, spawnRoom, width) {
  const sc = center(spawnRoom)
  const PASSAGE_LEN = 8
  const half = Math.floor((width - 1) / 2)

  // Passage rows: from topRow (inclusive) to spawnRoom.y - 1 (inclusive)
  const topRow = Math.max(1, spawnRoom.y - PASSAGE_LEN)
  if (topRow >= spawnRoom.y) return null  // no space above room

  for (let row = topRow; row < spawnRoom.y; row++) {
    for (let i = 0; i < width; i++) {
      const col = sc.x - half + i
      if (!map[row]?.[col]) continue
      map[row][col].tile = TILE.STAIR
      map[row][col].roomId = spawnRoom.id
      map[row][col].stairCol = i
      map[row][col].stairWidth = width
    }
  }

  // STAIRS_UP at the topmost tile of the center column
  if (map[topRow]?.[sc.x]) map[topRow][sc.x].tile = TILE.STAIRS_UP

  // Open spawn room's top wall at center so player can walk into the passage
  if (map[spawnRoom.y]?.[sc.x]) map[spawnRoom.y][sc.x].tile = TILE.FLOOR

  // Player spawns at the bottom tile of the passage (one tile above spawn room's top wall)
  return { x: sc.x, y: spawnRoom.y - 1 }
}

function carveExitPassage(map, stairsRoom, width) {
  const sc = center(stairsRoom)
  const PASSAGE_LEN = 8
  const half = Math.floor((width - 1) / 2)

  // Passage starts at the south wall of the stairs room
  const entryRow = stairsRoom.y + stairsRoom.h - 1
  const bottomRow = Math.min(map.length - 2, entryRow + PASSAGE_LEN - 1)

  for (let row = entryRow; row <= bottomRow; row++) {
    for (let i = 0; i < width; i++) {
      const col = sc.x - half + i
      if (!map[row]?.[col]) continue
      map[row][col].tile = TILE.STAIR
      map[row][col].stairCol = i
      map[row][col].stairWidth = width
    }
  }

  // STAIRS_DOWN at the center column of the entry row (overwrites STAIR set above)
  if (map[entryRow]?.[sc.x]) map[entryRow][sc.x].tile = TILE.STAIRS_DOWN
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js
```

The new tests still fail because `generateLevel` still calls the old `carveAlcove` (not yet wired). That's expected — Task 3 wires them in.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: carveEntrancePassage and carveExitPassage functions; update map tests for passage structure"
```

---

## Task 3: Wire passages into generateLevel

**Files:**
- Modify: `renderer/systems/map.js`

- [ ] **Step 1: Replace stair placement and carveAlcove in generateLevel**

In `renderer/systems/map.js`, inside `generateLevel`, find:

```js
    if (depth < FINAL_DEPTH) map[center(stairsRoom).y][center(stairsRoom).x].tile = TILE.STAIRS_DOWN

    // Entrance alcove above spawn room — sets stairs-up and returns player spawn position
    const alcoveSpawn = carveAlcove(map, spawnRoom)
    if (!alcoveSpawn) map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // fallback if alcove OOB
```

Replace with:

```js
    const staircaseWidth = cfg.staircaseWidth ?? 1

    // Exit passage going down from south wall of stairs room
    if (depth < FINAL_DEPTH) carveExitPassage(map, stairsRoom, staircaseWidth)

    // Entrance passage going up from spawn room — returns player spawn position
    const entranceSpawn = carveEntrancePassage(map, spawnRoom, staircaseWidth)
    if (!entranceSpawn) map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // fallback if OOB
```

- [ ] **Step 2: Update playerSpawn reference**

In the same function, find:

```js
    const playerSpawn = alcoveSpawn ?? spawnC
```

Replace with:

```js
    const playerSpawn = entranceSpawn ?? spawnC
```

- [ ] **Step 3: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass including the three new staircase tests.

- [ ] **Step 4: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js && git commit -m "feat: wire staircase passages into generateLevel; replace alcove with 8-tile carved passages"
```

---

## Task 4: Render TILE.STAIR + sprites test

**Files:**
- Modify: `renderer/render/canvas.js`
- Modify: `test/sprites.test.js`

- [ ] **Step 1: Update drawTile to handle TILE.STAIR and accept tile object**

In `renderer/render/canvas.js`, find:

```js
function drawTile(ctx, tileId, px, py, S, sprites) {
  if (tileId === TILE.SNARE) {
```

Replace with:

```js
function drawTile(ctx, tileId, px, py, S, sprites, tileObj = null) {
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
  if (tileId === TILE.SNARE) {
```

- [ ] **Step 2: Pass tile object at the drawTile call site**

In `renderer/render/canvas.js`, inside `Renderer.render()`, find:

```js
        drawTile(ctx, t.tile, px, py, S, sprites)
```

Replace with:

```js
        drawTile(ctx, t.tile, px, py, S, sprites, t)
```

- [ ] **Step 3: Add stair sprite assertions to sprites.test.js**

In `test/sprites.test.js`, find:

```js
describe('room decoration props', () => {
```

Insert BEFORE that block:

```js
describe('staircase passage sprites', () => {
  it('stair      = tile_0039 (single-tile stair)', () => assert.equal(SPRITES.stair,       'tile_0039'))
  it('stair_left = tile_0036 (wide stair left)',   () => assert.equal(SPRITES.stair_left,  'tile_0036'))
  it('stair_mid  = tile_0037 (wide stair middle)', () => assert.equal(SPRITES.stair_mid,   'tile_0037'))
  it('stair_right= tile_0038 (wide stair right)',  () => assert.equal(SPRITES.stair_right, 'tile_0038'))
})

```

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass (106+ tests, 0 failures).

- [ ] **Step 5: Screenshot the game to verify visually**

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

Confirm:
- [ ] Player spawns inside the entrance passage (stair tiles visible above them going to darkness)
- [ ] Stairs-up tile visible at the top of the passage
- [ ] Stairs-down passage visible at the south edge of the exit room going downward
- [ ] Level 6 (cyclops): passage is 2 tiles wide
- [ ] Level 9 (dragon): passage is 3 tiles wide using stair_left/mid/right sprites

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js test/sprites.test.js && git commit -m "feat: render TILE.STAIR with width-aware stair sprites; add sprite mapping tests"
```

---

## Final verification

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.
