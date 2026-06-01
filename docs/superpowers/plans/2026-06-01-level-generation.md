# Level Generation Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve level generation with shape-aware room carving, mixed corridor widths, randomised placement, entrance alcoves, and depth-themed visuals giving a civilisation-descent arc.

**Architecture:** Nine tasks split into two logical groups — Tasks 1–6 are all map structure changes confined to `map.js` (plus a TILE.SAND constant); Tasks 7–9 are visual theme changes across `levels.js`, `sprites.js`, `canvas.js`, and `game.js`. Each group can ship independently.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron, Node built-in test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Add `TILE.SAND = 10` |
| `renderer/systems/map.js` | Shape carvers; `chooseShape`; updated `buildRooms`, `center`, `carveCorridor`, `connectRoomsMST`, `generateLevel`; `carveAlcove`; sand floor swap; prop scattering |
| `renderer/data/levels.js` | Add `DEPTH_THEMES` export |
| `renderer/render/sprites.js` | Add `sand` + 15 `prop_*` sprite entries |
| `renderer/render/canvas.js` | `drawTile` sand case; `drawEntity` prop case; theme bg/tint/fog in `Renderer.render` |
| `renderer/game.js` | Import `DEPTH_THEMES`; add `theme` to state; add `'prop'` case in `buildEntities` |
| `test/map.test.js` | New tests for shape carvers, mixed corridors, alcove, sand floor |

---

## Task 1: TILE.SAND constant

**Files:**
- Modify: `renderer/systems/entities.js`
- Modify: `test/entities.test.js`

- [ ] **Step 1: Add test for TILE.SAND**

In `test/entities.test.js`, add inside `describe('TILE', ...)`:

```js
  it('has SAND distinct from WALL, FLOOR, COLUMN, SNARE and is walkable', () => {
    assert.equal(typeof TILE.SAND, 'number')
    assert.notEqual(TILE.SAND, TILE.WALL)
    assert.notEqual(TILE.SAND, TILE.FLOOR)
    assert.notEqual(TILE.SAND, TILE.COLUMN)
    assert.notEqual(TILE.SAND, TILE.SNARE)
    assert.equal(isWalkable(TILE.SAND), true)
  })
```

Also update the import line at the top to include `isWalkable`:

```js
import { makeGuard, makeMonster, makeDragon, TILE, hasLineOfSight, isWalkable } from '../renderer/systems/entities.js'
```

- [ ] **Step 2: Run to confirm test fails**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js 2>&1 | tail -6
```

Expected: FAIL — `TILE.SAND` undefined.

- [ ] **Step 3: Add TILE.SAND to entities.js**

In `renderer/systems/entities.js`, find:

```js
export const TILE = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  STAIRS_UP: 4,
  TREASURE: 5,
  SHRINE: 6,
  FLOOR_WOOD: 7,
  COLUMN: 8,
  SNARE: 9,
}
```

Replace with:

```js
export const TILE = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  STAIRS_UP: 4,
  TREASURE: 5,
  SHRINE: 6,
  FLOOR_WOOD: 7,
  COLUMN: 8,
  SNARE: 9,
  SAND: 10,
}
```

`isWalkable` needs no change — it already passes anything that isn't WALL or COLUMN.

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/entities.js test/entities.test.js && git commit -m "feat: add TILE.SAND constant"
```

---

## Task 2: Shape carver functions

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `test/map.test.js`

Add four carver functions and `carveRoomShaped` dispatcher. Export `carveRoomShaped` for testing.

- [ ] **Step 1: Write failing tests**

In `test/map.test.js`, add after the existing imports and before the first `describe`:

```js
import { generateLevel, isFullyConnected, createMap, carveRoomShaped } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

function wallMap(w = 20, h = 20) {
  return createMap(w, h)  // all WALL
}

describe('carveRoomShaped — lshape', () => {
  it('carves floor tiles and returns a walkable center', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 12, h: 10, id: 0, shape: 'lshape' }
    carveRoomShaped(map, room)
    assert.ok(room.center, 'room.center should be set')
    assert.equal(isWalkable(map[room.center.y][room.center.x].tile), true)
  })
})

describe('carveRoomShaped — cross', () => {
  it('carves floor tiles and returns center at geometric middle', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 11, h: 11, id: 0, shape: 'cross' }
    carveRoomShaped(map, room)
    assert.ok(room.center)
    const cx = 1 + Math.floor(11 / 2), cy = 1 + Math.floor(11 / 2)
    assert.equal(room.center.x, cx)
    assert.equal(room.center.y, cy)
    assert.equal(isWalkable(map[cy][cx].tile), true)
  })
})

describe('carveRoomShaped — sunken', () => {
  it('carves an outer floor ring and leaves inner area as walls', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 11, h: 9, id: 0, shape: 'sunken' }
    carveRoomShaped(map, room)
    assert.ok(room.center)
    assert.equal(isWalkable(map[room.center.y][room.center.x].tile), true)
    // inner tile should be WALL
    const innerX = 1 + Math.floor(11 / 2)
    const innerY = 1 + Math.floor(9 / 2)
    assert.equal(map[innerY][innerX].tile, TILE.WALL)
  })
})

describe('carveRoomShaped — rect', () => {
  it('carves a rectangle and leaves center unset (uses geometric center)', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 8, h: 8, id: 0, shape: 'rect' }
    carveRoomShaped(map, room)
    assert.equal(room.center, undefined)
    const cx = 1 + Math.floor(8 / 2), cy = 1 + Math.floor(8 / 2)
    assert.equal(isWalkable(map[cy][cx].tile), true)
  })
})
```

Also update the existing import line at top of `test/map.test.js`:

```js
import { generateLevel, isFullyConnected, createMap, carveRoomShaped } from '../renderer/systems/map.js'
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -8
```

Expected: FAIL — `carveRoomShaped` not exported.

- [ ] **Step 3: Add carver functions to map.js**

In `renderer/systems/map.js`, after the existing `carveRoom` function, add:

```js
function carveRoomL(map, room) {
  const { x, y, w, h, id } = room
  const hw = Math.floor(w / 2)
  const hh = Math.floor(h / 2)
  const orient = Math.floor(Math.random() * 4)
  let cx, cy

  if (orient === 0) {
    // top-full + bottom-left
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+1; col < x+hw; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + Math.floor(hh / 2)
  } else if (orient === 1) {
    // top-full + bottom-right
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+hw; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + Math.floor(hh / 2)
  } else if (orient === 2) {
    // bottom-full + top-left
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+1; col < x+hw; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + hh + Math.floor((h - hh) / 2)
  } else {
    // bottom-full + top-right
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+hw; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + hh + Math.floor((h - hh) / 2)
  }
  return { x: cx, y: cy }
}

function carveRoomCross(map, room) {
  const { x, y, w, h, id } = room
  const cx = x + Math.floor(w / 2)
  const cy = y + Math.floor(h / 2)
  const hw = Math.max(1, Math.floor(w / 4))
  const hh = Math.max(1, Math.floor(h / 4))
  // Horizontal bar
  for (let row = cy - hh; row <= cy + hh; row++)
    for (let col = x+1; col < x+w-1; col++)
      if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
  // Vertical bar
  for (let row = y+1; row < y+h-1; row++)
    for (let col = cx - hw; col <= cx + hw; col++)
      if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
  return { x: cx, y: cy }
}

function carveRoomSunken(map, room) {
  const { x, y, w, h, id } = room
  for (let row = y+1; row < y+h-1; row++) {
    for (let col = x+1; col < x+w-1; col++) {
      if (!map[row]?.[col]) continue
      const isRing = row === y+1 || row === y+h-2 || col === x+1 || col === x+w-2
      map[row][col].tile = isRing ? TILE.FLOOR : TILE.WALL
      map[row][col].roomId = id
    }
  }
  return { x: x + Math.floor(w / 2), y: y + 1 }
}

export function carveRoomShaped(map, room) {
  switch (room.shape) {
    case 'lshape': room.center = carveRoomL(map, room);      break
    case 'cross':  room.center = carveRoomCross(map, room);  break
    case 'sunken': room.center = carveRoomSunken(map, room); break
    default:       carveRoom(map, room);                      break
  }
}
```

Also update the `center` function to use `room.center` when set:

```js
function center(room) {
  if (room.center) return room.center
  return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js
```

Expected: all shape carver tests pass.

- [ ] **Step 5: Run full suite**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: add L-shaped, cross, and sunken room carver functions"
```

---

## Task 3: Shape-aware buildRooms + carving in generateLevel

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `test/map.test.js`

Wire `chooseShape` into `buildRooms` and replace the `carveRoom` call in `generateLevel` with `carveRoomShaped`.

- [ ] **Step 1: Write failing test**

In `test/map.test.js`, add inside `describe('generateLevel', ...)`:

```js
  it('produces rooms with valid walkable centers across all depths', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, rooms } = generateLevel(depth)
      for (const room of rooms) {
        const c = room.center ?? { x: Math.floor(room.x + room.w/2), y: Math.floor(room.y + room.h/2) }
        assert.equal(isWalkable(map[c.y][c.x].tile), true,
          `depth ${depth} room id=${room.id} shape=${room.shape} center not walkable`)
      }
    }
  })
```

Also update `generateLevel`'s return to include `rooms` — we'll do that in the implementation step. For now the test will fail because `generateLevel` doesn't return `rooms` yet.

- [ ] **Step 2: Run to confirm test fails**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -A2 "walkable centers"
```

Expected: FAIL.

- [ ] **Step 3: Add `chooseShape` to map.js**

In `renderer/systems/map.js`, after the `shuffle` function, add:

```js
function chooseShape(leaf, depth) {
  const { w, h } = leaf
  const wts = depth <= 3 ? { rect: 65, lshape: 25, cross:  8, sunken:  2 }
            : depth <= 6 ? { rect: 50, lshape: 25, cross: 15, sunken: 10 }
            :              { rect: 35, lshape: 25, cross: 22, sunken: 18 }
  const can = {
    lshape: (w >= 10 && h >= 8) || (w >= 8 && h >= 10),
    cross:  w >= 9 && h >= 9,
    sunken: w >= 9 && h >= 9,
  }
  const pool = [
    { shape: 'rect',   w: wts.rect },
    ...(can.lshape ? [{ shape: 'lshape',  w: wts.lshape  }] : []),
    ...(can.cross  ? [{ shape: 'cross',   w: wts.cross   }] : []),
    ...(can.sunken ? [{ shape: 'sunken',  w: wts.sunken  }] : []),
  ]
  const total = pool.reduce((s, e) => s + e.w, 0)
  let r = Math.random() * total
  for (const e of pool) { r -= e.w; if (r <= 0) return e.shape }
  return 'rect'
}
```

- [ ] **Step 4: Update `buildRooms` to accept depth and assign shape**

Find:

```js
function buildRooms(leaves, idStart) {
  let id = idStart
  return leaves.map(leaf => {
    const m = 2
    return { x: leaf.x + m, y: leaf.y + m, w: Math.max(6, leaf.w - m * 2), h: Math.max(6, leaf.h - m * 2), id: id++ }
  })
}
```

Replace with:

```js
function buildRooms(leaves, idStart, depth = 1) {
  let id = idStart
  return leaves.map(leaf => {
    const m = 2
    return {
      x: leaf.x + m, y: leaf.y + m,
      w: Math.max(6, leaf.w - m * 2),
      h: Math.max(6, leaf.h - m * 2),
      id: id++,
      shape: chooseShape(leaf, depth),
    }
  })
}
```

- [ ] **Step 5: Update generateLevel to use carveRoomShaped and return rooms**

In `generateLevel`, find:

```js
    const rooms = buildRooms(leaves, roomId)
    roomId += rooms.length
    rooms.forEach(r => carveRoom(map, r))
    rooms.forEach(r => { if (Math.random() < 0.5) placeColumns(map, r) })
```

Replace with:

```js
    const rooms = buildRooms(leaves, roomId, depth)
    roomId += rooms.length
    rooms.forEach(r => carveRoomShaped(map, r))
    rooms.forEach(r => { if (r.shape === 'rect' && Math.random() < 0.5) placeColumns(map, r) })
```

And update the `return` at the end of the attempt loop from:

```js
    return { map, entitySpawns, playerSpawn, rooms }
```

(It already returns `rooms` — just confirm it's there. If not, add it.)

- [ ] **Step 6: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass including new "walkable centers" test.

- [ ] **Step 7: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: shape-aware room carving — L, cross, sunken rooms alongside rectangles"
```

---

## Task 4: Mixed corridor widths

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `test/map.test.js`

- [ ] **Step 1: Write failing test**

In `test/map.test.js`, add:

```js
describe('carveCorridor width', () => {
  it('width=1 carves exactly a 1-tile path', () => {
    const map = createMap(10, 10)
    // horizontal corridor y=5, x=1 to x=8
    carveCorridor(map, 1, 5, 8, 5, 1)
    assert.equal(map[5][4].tile, TILE.FLOOR)
    assert.equal(map[4][4].tile, TILE.WALL)
    assert.equal(map[6][4].tile, TILE.WALL)
  })

  it('width=3 carves a 3-tile-wide path', () => {
    const map = createMap(10, 10)
    carveCorridor(map, 1, 5, 8, 5, 3)
    assert.equal(map[4][4].tile, TILE.FLOOR)
    assert.equal(map[5][4].tile, TILE.FLOOR)
    assert.equal(map[6][4].tile, TILE.FLOOR)
  })
})
```

Also add `carveCorridor` to the import:

```js
import { generateLevel, isFullyConnected, createMap, carveRoomShaped, carveCorridor } from '../renderer/systems/map.js'
```

- [ ] **Step 2: Run to confirm test fails**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -A3 "corridor width"
```

Expected: FAIL — `carveCorridor` not exported.

- [ ] **Step 3: Update carveCorridor to support width and export it**

In `renderer/systems/map.js`, find:

```js
function carveCorridor(map, x1, y1, x2, y2) {
  let x = x1, y = y1
  while (x !== x2) { map[y][x].tile = TILE.FLOOR; x += x < x2 ? 1 : -1 }
  while (y !== y2) { map[y][x].tile = TILE.FLOOR; y += y < y2 ? 1 : -1 }
}
```

Replace with:

```js
export function carveCorridor(map, x1, y1, x2, y2, width = 1) {
  const offsets = width === 1 ? [0] : width === 2 ? [0, 1] : [-1, 0, 1]
  let x = x1, y = y1
  while (x !== x2) {
    for (const o of offsets) if (map[y + o]?.[x]) map[y + o][x].tile = TILE.FLOOR
    x += x < x2 ? 1 : -1
  }
  while (y !== y2) {
    for (const o of offsets) if (map[y]?.[x + o]) map[y][x + o].tile = TILE.FLOOR
    y += y < y2 ? 1 : -1
  }
}
```

- [ ] **Step 4: Add `randCorridorWidth` and use it in `connectRoomsMST`**

In `renderer/systems/map.js`, after the `carveCorridor` function, add:

```js
function randCorridorWidth() {
  const r = Math.random()
  return r < 0.60 ? 1 : r < 0.85 ? 2 : 3
}
```

In `connectRoomsMST`, find:

```js
    carveCorridor(map, centers[bestFrom].x, centers[bestFrom].y, centers[bestTo].x, centers[bestTo].y)
```

Replace with:

```js
    carveCorridor(map, centers[bestFrom].x, centers[bestFrom].y, centers[bestTo].x, centers[bestTo].y, randCorridorWidth())
```

- [ ] **Step 5: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: mixed corridor widths — 60% narrow, 25% 2-tile, 15% 3-tile"
```

---

## Task 5: Randomised spawn / stair / landmark placement

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `test/map.test.js`

- [ ] **Step 1: Write failing tests**

In `test/map.test.js`, add inside `describe('generateLevel', ...)`:

```js
  it('spawn room center is walkable and closest to top-left', () => {
    for (let depth = 1; depth <= 3; depth++) {
      const { map, playerSpawn, rooms } = generateLevel(depth)
      assert.equal(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), true,
        `depth ${depth}: playerSpawn not walkable`)
    }
  })

  it('stairs-down tile is not in the same room as playerSpawn', () => {
    const { map, playerSpawn } = generateLevel(1)
    // Find stairs-down position
    let sx = -1, sy = -1
    for (let y = 0; y < map.length && sx === -1; y++)
      for (let x = 0; x < map[y].length && sx === -1; x++)
        if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
    assert.ok(sx !== -1, 'no stairs-down found')
    // Stairs-down should not be at playerSpawn
    assert.ok(sx !== playerSpawn.x || sy !== playerSpawn.y)
  })
```

- [ ] **Step 2: Run to confirm the new test for stairs separation fails or is trivially satisfied**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Replace spawn/stair/landmark placement logic in generateLevel**

In `renderer/systems/map.js`, inside `generateLevel`, find and replace the entire block from `if (cfg.landmark ...)` through to `if (depth < FINAL_DEPTH) map[lastCenter.y][lastCenter.x].tile = TILE.STAIRS_DOWN`:

**Find** (the entire block from landmark through playerSpawn):
```js
    if (cfg.landmark && TEMPLATES[cfg.landmark]) {
      const tmpl = TEMPLATES[cfg.landmark]
      const ox = width - tmpl.width - 2
      const oy = height - tmpl.height - 2
      entitySpawns.push(...placeTemplate(map, tmpl, ox, oy, roomId++))
      const lc = { x: ox + Math.floor(tmpl.width / 2), y: oy + Math.floor(tmpl.height / 2) }
      const nearest = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - lc.x) + Math.abs(c.y - lc.y)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearest.r).x, center(nearest.r).y, lc.x, lc.y)
    }

    healConnectivity(map)

    // Level 6: carve a 7×7 cyclops arena near map centre
    if (cfg.cyclopsArena) {
      const ax = Math.floor(width / 2) - 3
      const ay = Math.floor(height / 2) - 3
      for (let y = ay; y < ay + 7; y++)
        for (let x = ax; x < ax + 7; x++) {
          map[y][x].tile = TILE.FLOOR
          map[y][x].roomId = roomId
        }
      const acx = ax + 3, acy = ay + 3
      entitySpawns.push({ kind: 'cyclops', x: acx, y: acy })
      const nearestArena = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - acx) + Math.abs(c.y - acy)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearestArena.r).x, center(nearestArena.r).y, acx, acy)
      roomId++
    }

    const firstCenter = center(rooms[0])
    const lastCenter = center(rooms[rooms.length - 1])
    map[firstCenter.y][firstCenter.x].tile = TILE.STAIRS_UP
    if (depth < FINAL_DEPTH) map[lastCenter.y][lastCenter.x].tile = TILE.STAIRS_DOWN

    if (!isFullyConnected(map)) continue

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR) floorTiles.push({ x, y })

    const occupiedKeys = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    let playerSpawn = { x: firstCenter.x, y: firstCenter.y + 1 }
    if (!isWalkable(map[playerSpawn.y]?.[playerSpawn.x]?.tile)) playerSpawn = firstCenter
    occupiedKeys.add(`${playerSpawn.x},${playerSpawn.y}`)
```

**Replace with:**
```js
    // Spawn room: BSP room whose center is closest to map top-left (0,0)
    const spawnRoom = rooms.reduce((best, r) => {
      const c = center(r), bc = center(best)
      return (c.x + c.y) < (bc.x + bc.y) ? r : best
    }, rooms[0])
    const spawnC = center(spawnRoom)

    // Stairs-down room: farthest from spawn
    const nonSpawn = rooms.filter(r => r !== spawnRoom)
    const stairsRoom = nonSpawn.reduce((best, r) => {
      const c = center(r), bc = center(best)
      const d  = Math.abs(c.x  - spawnC.x) + Math.abs(c.y  - spawnC.y)
      const bd = Math.abs(bc.x - spawnC.x) + Math.abs(bc.y - spawnC.y)
      return d > bd ? r : best
    }, nonSpawn[0] ?? rooms[0])

    // Landmark room: random, not spawn, not stairs
    const landmarkCandidates = rooms.filter(r => r !== spawnRoom && r !== stairsRoom)
    const landmarkRoom = landmarkCandidates.length > 0
      ? landmarkCandidates[Math.floor(Math.random() * landmarkCandidates.length)]
      : null

    if (cfg.landmark && TEMPLATES[cfg.landmark] && landmarkRoom) {
      const tmpl = TEMPLATES[cfg.landmark]
      const lc = center(landmarkRoom)
      const ox = Math.max(0, Math.min(width  - tmpl.width,  lc.x - Math.floor(tmpl.width  / 2)))
      const oy = Math.max(0, Math.min(height - tmpl.height, lc.y - Math.floor(tmpl.height / 2)))
      entitySpawns.push(...placeTemplate(map, tmpl, ox, oy, roomId++))
      const tlc = { x: ox + Math.floor(tmpl.width / 2), y: oy + Math.floor(tmpl.height / 2) }
      carveCorridor(map, lc.x, lc.y, tlc.x, tlc.y)
    } else if (cfg.landmark && TEMPLATES[cfg.landmark]) {
      // Fallback: bottom-right corner
      const tmpl = TEMPLATES[cfg.landmark]
      const ox = width - tmpl.width - 2
      const oy = height - tmpl.height - 2
      entitySpawns.push(...placeTemplate(map, tmpl, ox, oy, roomId++))
      const lc = { x: ox + Math.floor(tmpl.width / 2), y: oy + Math.floor(tmpl.height / 2) }
      const nearest = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - lc.x) + Math.abs(c.y - lc.y)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearest.r).x, center(nearest.r).y, lc.x, lc.y)
    }

    healConnectivity(map)

    // Level 6: carve a 7×7 cyclops arena near map centre
    if (cfg.cyclopsArena) {
      const ax = Math.floor(width / 2) - 3
      const ay = Math.floor(height / 2) - 3
      for (let y = ay; y < ay + 7; y++)
        for (let x = ax; x < ax + 7; x++) {
          map[y][x].tile = TILE.FLOOR
          map[y][x].roomId = roomId
        }
      const acx = ax + 3, acy = ay + 3
      entitySpawns.push({ kind: 'cyclops', x: acx, y: acy })
      const nearestArena = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - acx) + Math.abs(c.y - acy)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearestArena.r).x, center(nearestArena.r).y, acx, acy)
      roomId++
    }

    if (depth < FINAL_DEPTH) map[center(stairsRoom).y][center(stairsRoom).x].tile = TILE.STAIRS_DOWN
    map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // temporary — Task 6 replaces with alcove

    if (!isFullyConnected(map)) continue

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR) floorTiles.push({ x, y })

    const occupiedKeys = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    let playerSpawn = spawnC
    occupiedKeys.add(`${playerSpawn.x},${playerSpawn.y}`)
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: randomise spawn/stairs/landmark placement — all three far from each other"
```

---

## Task 6: Entrance alcove

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `test/map.test.js`

- [ ] **Step 1: Write failing test**

In `test/map.test.js`, add inside `describe('generateLevel', ...)`:

```js
  it('playerSpawn is a walkable tile and has STAIRS_UP nearby', () => {
    for (let depth = 1; depth <= 3; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      assert.equal(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), true,
        `depth ${depth}: playerSpawn tile not walkable`)
      // STAIRS_UP should be within 3 tiles of spawn
      let found = false
      for (let dy = -3; dy <= 3 && !found; dy++)
        for (let dx = -3; dx <= 3 && !found; dx++)
          if (map[playerSpawn.y + dy]?.[playerSpawn.x + dx]?.tile === TILE.STAIRS_UP) found = true
      assert.ok(found, `depth ${depth}: no STAIRS_UP near playerSpawn`)
    }
  })
```

- [ ] **Step 2: Run to confirm test fails**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/map.test.js 2>&1 | grep -A3 "STAIRS_UP near"
```

Expected: FAIL — stairs up is at spawnC, not near alcove spawn.

- [ ] **Step 3: Add `carveAlcove` to map.js**

In `renderer/systems/map.js`, after `carveRoomSunken`, add:

```js
function carveAlcove(map, spawnRoom) {
  const sc = center(spawnRoom)
  const ay = spawnRoom.y - 3
  if (ay < 1) return null  // spawn room too close to map top

  const ax = Math.max(1, sc.x - 2)
  const axEnd = Math.min(map[0].length - 2, ax + 5)

  // Carve 5×3 floor area above spawn room
  for (let row = ay; row < ay + 3; row++)
    for (let col = ax; col < axEnd; col++)
      if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = spawnRoom.id }

  // Stairs up on top row of alcove
  if (map[ay]?.[sc.x]) map[ay][sc.x].tile = TILE.STAIRS_UP

  // Open spawn room's top wall to connect alcove
  if (map[spawnRoom.y]?.[sc.x]) map[spawnRoom.y][sc.x].tile = TILE.FLOOR

  // Player spawns in middle of alcove
  return { x: sc.x, y: ay + 1 }
}
```

- [ ] **Step 4: Use carveAlcove in generateLevel**

Find the block from Task 5 (stairs-down + temporary stairs-up + playerSpawn):

```js
    if (depth < FINAL_DEPTH) map[center(stairsRoom).y][center(stairsRoom).x].tile = TILE.STAIRS_DOWN
    map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // temporary — Task 6 replaces with alcove

    if (!isFullyConnected(map)) continue

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR) floorTiles.push({ x, y })

    const occupiedKeys = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    let playerSpawn = spawnC
    occupiedKeys.add(`${playerSpawn.x},${playerSpawn.y}`)
```

Replace with:

```js
    if (depth < FINAL_DEPTH) map[center(stairsRoom).y][center(stairsRoom).x].tile = TILE.STAIRS_DOWN

    // Entrance alcove above spawn room — sets stairs-up and returns player spawn position
    const alcoveSpawn = carveAlcove(map, spawnRoom)
    if (!alcoveSpawn) map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // fallback if alcove OOB

    if (!isFullyConnected(map)) continue

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR) floorTiles.push({ x, y })

    const playerSpawn = alcoveSpawn ?? spawnC
    const occupiedKeys = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    occupiedKeys.add(`${playerSpawn.x},${playerSpawn.y}`)
```

- [ ] **Step 5: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js test/map.test.js && git commit -m "feat: entrance alcove — dedicated 5×3 spawn room with stairs up on back wall"
```

---

## Task 7: DEPTH_THEMES + sprite entries

**Files:**
- Modify: `renderer/data/levels.js`
- Modify: `renderer/render/sprites.js`

No automated tests — verified visually in Task 9.

- [ ] **Step 1: Add DEPTH_THEMES to levels.js**

In `renderer/data/levels.js`, add before `export const FINAL_DEPTH`:

```js
export const DEPTH_THEMES = [
  {
    depths: [1, 2, 3],
    floorTile: 'floor',
    bgColor:  '#12121e',
    tint:     null,
    fogAlpha: 0.65,
    props: {
      room: ['prop_table', 'prop_chair', 'prop_anvil', 'prop_barrel',
             'prop_pipe_flow', 'prop_gargoyle_flow', 'prop_fountain_full'],
    },
  },
  {
    depths: [4, 5, 6],
    floorTile: 'sand',
    bgColor:  '#1a1206',
    tint:     'rgba(40,20,0,0.2)',
    fogAlpha: 0.65,
    props: {
      room: ['prop_pipe_dry', 'prop_gargoyle_dry', 'prop_fountain_empty',
             'prop_gravestone', 'prop_anvil'],
    },
  },
  {
    depths: [7, 8, 9],
    floorTile: 'floor',
    bgColor:  '#07070f',
    tint:     'rgba(0,0,20,0.35)',
    fogAlpha: 0.80,
    props: {
      room: ['prop_gravestone', 'prop_grave'],
    },
  },
]
```

- [ ] **Step 2: Add sprite entries to sprites.js**

In `renderer/render/sprites.js`, inside the `SPRITES` object, add after the `crab` entry:

```js
  // floor variants
  sand:                'tile_0048',
  // props — civilisation gradient
  prop_table:          'tile_0072',
  prop_chair:          'tile_0073',
  prop_anvil:          'tile_0074',
  prop_barrel:         'tile_0082',
  prop_pipe_dry:       'tile_0007',
  prop_pipe_flow:      'tile_0008',
  prop_gargoyle_dry:   'tile_0019',
  prop_gargoyle_flow:  'tile_0020',
  prop_fountain_empty: 'tile_0031',
  prop_fountain_full:  'tile_0032',
  prop_gravestone:     'tile_0065',
  prop_grave:          'tile_0066',
```

- [ ] **Step 3: Run all tests (no regressions)**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/data/levels.js renderer/render/sprites.js && git commit -m "feat: add DEPTH_THEMES and prop sprite entries"
```

---

## Task 8: Canvas depth theme rendering

**Files:**
- Modify: `renderer/render/canvas.js`

- [ ] **Step 1: Add TILE.SAND to drawTile**

In `renderer/render/canvas.js`, inside `drawTile`, find the switch:

```js
      case TILE.STAIRS_UP:   return sprites.stairs_up
      case TILE.TREASURE:    return sprites.treasure
      case TILE.SHRINE:      return sprites.shrine
      default: return null
```

Replace with:

```js
      case TILE.STAIRS_UP:   return sprites.stairs_up
      case TILE.TREASURE:    return sprites.treasure
      case TILE.SHRINE:      return sprites.shrine
      case TILE.SAND:        return sprites.sand
      default: return null
```

Also update the import at the top of canvas.js to include `TILE.SAND` — it's already included via `import { TILE } from '../systems/entities.js'` so no change needed there.

- [ ] **Step 2: Add prop entity case to drawEntity**

In `renderer/render/canvas.js`, in `drawEntity`, find:

```js
  if (entity.type === 'cyclops') {
```

Insert BEFORE that block:

```js
  if (entity.type === 'prop') {
    const s = sprites[entity.propType]
    if (s) ctx.drawImage(s, px, py, S, S)
    return
  }
```

- [ ] **Step 3: Apply theme background, tint, and fog in Renderer.render()**

In `renderer/render/canvas.js`, in `Renderer.render(state)`, find:

```js
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
```

Replace with:

```js
    const theme = state.theme ?? { bgColor: '#000', tint: null, fogAlpha: 0.65 }
    ctx.fillStyle = theme.bgColor
    ctx.fillRect(0, 0, W, H)
```

Then find the FOV fog line inside the tile rendering loop:

```js
        if (!t.visible) {
          ctx.fillStyle = 'rgba(0,0,0,0.65)'
          ctx.fillRect(px, py, S, S)
        }
```

Replace with:

```js
        if (!t.visible) {
          ctx.fillStyle = `rgba(0,0,0,${theme.fogAlpha})`
          ctx.fillRect(px, py, S, S)
        }
```

Then find (after the tile rendering loop, before the entity loop):

```js
    for (const e of entities) {
      const margin = e.type === 'dragon' ? 5 : e.type === 'cyclops' ? 2 : 0
```

Insert BEFORE that block:

```js
    // Depth tint overlay (after tiles, before entities)
    if (theme.tint) {
      ctx.fillStyle = theme.tint
      ctx.fillRect(0, 0, W, H)
    }
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: canvas depth theme rendering — bg colour, tint overlay, variable FOV fog"
```

---

## Task 9: Prop scattering + sand floor + game.js theme wiring

**Files:**
- Modify: `renderer/systems/map.js`
- Modify: `renderer/game.js`

- [ ] **Step 1: Import DEPTH_THEMES in map.js and add prop + sand logic**

In `renderer/systems/map.js`, find:

```js
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH } from '../data/levels.js'
```

Replace with:

```js
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES } from '../data/levels.js'
```

In `generateLevel`, find:

```js
    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR) floorTiles.push({ x, y })
```

Replace with:

```js
    // Apply sand floor for depths 4–6
    const theme = DEPTH_THEMES.find(t => t.depths.includes(depth))
    if (theme?.floorTile === 'sand') {
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++)
          if (map[row][col].tile === TILE.FLOOR) map[row][col].tile = TILE.SAND
    }

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR || map[y][x].tile === TILE.SAND)
          floorTiles.push({ x, y })
```

Then find the last entity placement loop (wizard/crab) and add after it — before `return { map, entitySpawns, playerSpawn, rooms }`:

```js
    // Scatter props based on depth theme
    const roomProps = theme?.props?.room ?? []
    if (roomProps.length > 0) {
      for (const room of rooms) {
        const count = Math.floor(Math.random() * 3)  // 0–2 props per room
        const candidates = shuffle(floorTiles.filter(t =>
          t.x > room.x && t.x < room.x + room.w - 1 &&
          t.y > room.y && t.y < room.y + room.h - 1 &&
          !occupiedKeys.has(`${t.x},${t.y}`)
        ))
        for (let i = 0; i < count && i < candidates.length; i++) {
          const propType = roomProps[Math.floor(Math.random() * roomProps.length)]
          entitySpawns.push({ kind: 'prop', propType, x: candidates[i].x, y: candidates[i].y })
          occupiedKeys.add(`${candidates[i].x},${candidates[i].y}`)
        }
      }
    }
```

- [ ] **Step 2: Add `prop` case to buildEntities and theme to state in game.js**

In `renderer/game.js`, add to the import line at the top:

```js
import { DEPTH_THEMES } from './data/levels.js'
```

In `buildEntities`, find:

```js
      case 'crab':    return [{ ...makeCrab(s.x, s.y),    px: cx, py: cy }]
      default:        return []
```

Replace with:

```js
      case 'crab':    return [{ ...makeCrab(s.x, s.y),    px: cx, py: cy }]
      case 'prop':    return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y }]
      default:        return []
```

In `startNewRun`, find:

```js
  state = {
    level: 2,
    map,
    player,
```

Replace with:

```js
  const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]
  state = {
    level: 1,
    map,
    player,
    theme,
```

(This also corrects the hardcoded level to 1 — the level was set to 2 for testing.)

In `descendLevel`, find:

```js
  state = {
    ...state,
    level: next,
    map,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    player: {
```

Replace with:

```js
  const theme = DEPTH_THEMES.find(t => t.depths.includes(next)) ?? DEPTH_THEMES[0]
  state = {
    ...state,
    level: next,
    map,
    theme,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    player: {
```

- [ ] **Step 3: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all pass.

- [ ] **Step 4: Smoke-test all three depth zones visually**

Run the game at level 1 (start), then descend to level 4 (sand + warm tint), then level 7 (dark stone + blue tint). Confirm:

- Level 1: grey stone floors, props (tables, chairs, etc.) scattered in rooms, blue-black background
- Level 4: sand floor tile, warm orange background tint, dry pipes/gravestones/fountains
- Level 7: grey stone but dark blue-black background + heavy fog, only gravestones/graves
- All levels: mixed corridor widths, L/cross/sunken rooms alongside rectangles, entrance alcove at spawn

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/map.js renderer/game.js && git commit -m "feat: prop scattering + sand floor swap + game.js depth theme wiring"
```

---

## Final verification

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

Manual smoke test across all 9 levels confirms: shaped rooms, mixed corridors, randomised placement, entrance alcove, and depth-appropriate visuals from stone dungeon to catacombs.
