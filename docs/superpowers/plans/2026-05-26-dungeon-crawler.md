# Dungeon Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a turn-based stealth dungeon crawler in Electron where the player descends 9 levels, sneaks past guards, monsters, and traps, and steals treasure from a sleeping dragon without waking it.

**Architecture:** Electron shell with a single renderer window. All game logic runs in the renderer as vanilla ES modules — no framework, no bundler. HTML5 Canvas for rendering; DOM overlays for the HUD. Pure-function systems (map, stealth, turn, meta) are unit-tested with `node:test`.

**Tech Stack:** Electron 30, vanilla JS ES modules, HTML5 Canvas, `node:test` (built-in)

---

## File Map

```
dungeon-crawler/
├── main.js                          # Electron main — window + save file IPC
├── preload.js                       # contextBridge: exposes saveAPI to renderer
├── package.json                     # npm scripts: start, test
├── renderer/
│   ├── index.html                   # Shell: <canvas> + HUD divs + module entry
│   ├── game.js                      # Entry point — init, input, turn loop
│   ├── systems/
│   │   ├── entities.js              # TILE/ALERT constants + entity factory functions
│   │   ├── map.js                   # BSP map gen + template placement + connectivity
│   │   ├── stealth.js               # Noise propagation, FOV raycasting, alert updates
│   │   ├── turn.js                  # Player action resolution, entity AI steps
│   │   └── meta.js                  # Milestone bonus tracking + save validation
│   ├── render/
│   │   ├── canvas.js                # Tile/entity drawing, camera, debug overlay
│   │   └── hud.js                   # DOM HUD updates (top bar + log strip)
│   └── data/
│       ├── items.js                 # Item definitions
│       └── levels.js                # Hand-crafted room templates + level configs
└── test/
    ├── map.test.js
    ├── stealth.test.js
    ├── turn.test.js
    └── meta.test.js
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `main.js`
- Create: `preload.js`
- Create: `renderer/index.html`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "dungeon-crawler",
  "version": "0.1.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test test/"
  },
  "devDependencies": {
    "electron": "^30.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd projects/dungeon-crawler
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create `main.js`**

```js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const SAVE_DIR = path.join(app.getPath('userData'), 'dungeon-crawler')
const RUN_FILE = path.join(SAVE_DIR, 'run.json')
const META_FILE = path.join(SAVE_DIR, 'meta.json')

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  win.loadFile('renderer/index.html')
}

app.whenReady().then(() => {
  fs.mkdirSync(SAVE_DIR, { recursive: true })
  createWindow()
})

ipcMain.handle('save-meta', (_e, data) => fs.writeFileSync(META_FILE, JSON.stringify(data)))
ipcMain.handle('load-meta', () => {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch { return null }
})
ipcMain.handle('delete-run', () => { try { fs.unlinkSync(RUN_FILE) } catch {} })
```

- [ ] **Step 4: Create `preload.js`**

```js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('saveAPI', {
  saveMeta: (data) => ipcRenderer.invoke('save-meta', data),
  loadMeta: () => ipcRenderer.invoke('load-meta'),
  deleteRun: () => ipcRenderer.invoke('delete-run'),
})
```

- [ ] **Step 5: Create `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dungeon Crawler</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d0d; color: #ccc; font-family: monospace;
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }
    #hud-top {
      background: #1a1a1a; border-bottom: 1px solid #333;
      padding: 4px 12px; display: flex; gap: 24px; align-items: center;
      font-size: 13px; flex-shrink: 0;
    }
    #canvas-wrap { flex: 1; overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
    #hud-log {
      background: #1a1a1a; border-top: 1px solid #333;
      padding: 4px 12px; font-size: 12px; color: #888;
      flex-shrink: 0; height: 24px; overflow: hidden;
    }
  </style>
</head>
<body>
  <div id="hud-top">
    <span id="hud-level">LVL 1</span>
    <span>HP <span id="hud-hp-bar">██████</span></span>
    <span>NOISE <span id="hud-noise-bar">░░░░░░</span></span>
    <span id="hud-items">—</span>
  </div>
  <div id="canvas-wrap">
    <canvas id="game-canvas"></canvas>
  </div>
  <div id="hud-log">Descend into the dungeon…</div>
  <script type="module" src="game.js"></script>
</body>
</html>
```

- [ ] **Step 6: Smoke-test the window opens**

```bash
npm start
```

Expected: Electron window opens showing an empty black page with the HUD strip. No console errors. Close the window.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json main.js preload.js renderer/index.html
git commit -m "feat: scaffold Electron app with HUD shell"
```

---

## Task 2: Data Definitions

**Files:**
- Create: `renderer/data/items.js`
- Create: `renderer/data/levels.js`
- Create: `renderer/systems/entities.js`

- [ ] **Step 1: Create `renderer/data/items.js`**

```js
export const ITEMS = {
  DAGGER:     { id: 'DAGGER',     emoji: '🗡',  name: 'Dagger',     use: 'attack',   damage: 3 },
  KEY:        { id: 'KEY',        emoji: '🔑',  name: 'Key',        use: 'unlock' },
  POTION:     { id: 'POTION',     emoji: '🧪',  name: 'Potion',     use: 'heal',     hp: 5 },
  SMOKE_BOMB: { id: 'SMOKE_BOMB', emoji: '💨',  name: 'Smoke Bomb', use: 'distract', noise: 8, radius: 4 },
  ROPE:       { id: 'ROPE',       emoji: '🪢',  name: 'Rope',       use: 'descend' },
}
```

- [ ] **Step 2: Create `renderer/data/levels.js`**

Each template is a string array. Character legend: `#` wall, `.` floor, `D` dragon spawn, `T` treasure, `S` shrine, `V` vault item floor.

```js
export const TEMPLATES = {
  DRAGON_LAIR: {
    tiles: [
      '############',
      '#..........#',
      '#....D.....#',
      '#..........#',
      '#..........#',
      '#....T.....#',
      '#..........#',
      '############',
    ],
    width: 12,
    height: 8,
  },
  SHRINE: {
    tiles: [
      '#######',
      '#.....#',
      '#..S..#',
      '#.....#',
      '#######',
    ],
    width: 7,
    height: 5,
  },
  VAULT: {
    tiles: [
      '#########',
      '#.......#',
      '#.V.V.V.#',
      '#.......#',
      '#########',
    ],
    width: 9,
    height: 5,
  },
}

// depth 9 is the final level (dragon lair always placed there)
export const LEVEL_CONFIG = [
  { depth: 1, enemyDensity: 0.06, trapDensity: 0.03, landmark: null },
  { depth: 2, enemyDensity: 0.08, trapDensity: 0.04, landmark: null },
  { depth: 3, enemyDensity: 0.10, trapDensity: 0.05, landmark: 'SHRINE' },
  { depth: 4, enemyDensity: 0.12, trapDensity: 0.06, landmark: null },
  { depth: 5, enemyDensity: 0.14, trapDensity: 0.07, landmark: 'VAULT' },
  { depth: 6, enemyDensity: 0.16, trapDensity: 0.08, landmark: null },
  { depth: 7, enemyDensity: 0.18, trapDensity: 0.09, landmark: 'SHRINE' },
  { depth: 8, enemyDensity: 0.20, trapDensity: 0.10, landmark: null },
  { depth: 9, enemyDensity: 0.22, trapDensity: 0.11, landmark: 'DRAGON_LAIR' },
]

export const FINAL_DEPTH = 9
```

- [ ] **Step 3: Create `renderer/systems/entities.js`**

```js
export const TILE = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  STAIRS_UP: 4,
  TREASURE: 5,
  SHRINE: 6,
}

export const ALERT = {
  UNAWARE: 'unaware',
  CURIOUS: 'curious',
  SEARCHING: 'searching',
  ALERTED: 'alerted',
}

export const DRAGON_STATE = {
  SLEEPING: 'sleeping',
  STIRRING: 'stirring',
  AWAKE: 'awake',
}

export function makePlayer(x, y, bonuses = []) {
  const quietSteps = bonuses.filter(b => b === 'quiet_step').length
  const extraSlots = bonuses.filter(b => b === 'extra_slot').length
  return {
    type: 'player',
    x, y,
    hp: 10,
    maxHp: 10,
    inventory: [],
    maxInventory: 5 + extraSlots,
    noiseFootprint: Math.max(0, 2 - quietSteps),
    bonuses,
  }
}

export function makeGuard(x, y, patrol = []) {
  return {
    type: 'guard',
    x, y,
    facing: 'south',
    fovAngle: 90,
    fovRange: 5,
    patrol,
    patrolIndex: 0,
    alertState: ALERT.UNAWARE,
    hearingRadius: 4,
    hp: 4,
  }
}

export function makeMonster(x, y) {
  return {
    type: 'monster',
    x, y,
    wanderRadius: 3,
    alertState: ALERT.UNAWARE,
    hearingRadius: 3,
    hp: 2,
  }
}

export function makeTrap(x, y, trapType = 'pressure_plate') {
  return {
    type: 'trap',
    x, y,
    trapType,
    triggered: false,
    noiseBurst: 8,
  }
}

export function makePuzzle(x, y, puzzleType = 'lever') {
  return {
    type: 'puzzle',
    x, y,
    puzzleType,
    solved: false,
    reward: null,
  }
}

export function makeDragon(x, y, roomId) {
  return {
    type: 'dragon',
    x, y,
    sleepMeter: 0,
    dragonState: DRAGON_STATE.SLEEPING,
    roomId,
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add renderer/data/items.js renderer/data/levels.js renderer/systems/entities.js
git commit -m "feat: add data definitions and entity factories"
```

---

## Task 3: Map Generation

**Files:**
- Create: `renderer/systems/map.js`
- Create: `test/map.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/map.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateLevel, isFullyConnected, createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

describe('isFullyConnected', () => {
  it('returns true for a single-room map', () => {
    const map = createMap(10, 10)
    map[1][1].tile = TILE.FLOOR
    map[1][2].tile = TILE.FLOOR
    map[2][1].tile = TILE.FLOOR
    assert.equal(isFullyConnected(map), true)
  })

  it('returns false when two floor regions are separated by walls', () => {
    const map = createMap(10, 10)
    map[1][1].tile = TILE.FLOOR
    map[8][8].tile = TILE.FLOOR
    assert.equal(isFullyConnected(map), false)
  })
})

describe('generateLevel', () => {
  it('produces a connected map for each depth 1–9', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map } = generateLevel(depth)
      assert.equal(isFullyConnected(map), true, `depth ${depth} not connected`)
    }
  })

  it('includes a playerSpawn object with x and y', () => {
    const { playerSpawn } = generateLevel(1)
    assert.equal(typeof playerSpawn.x, 'number')
    assert.equal(typeof playerSpawn.y, 'number')
  })

  it('places STAIRS_DOWN on non-final levels', () => {
    const { map } = generateLevel(1)
    const hasStairs = map.some(row => row.some(t => t.tile === TILE.STAIRS_DOWN))
    assert.equal(hasStairs, true)
  })

  it('does not place STAIRS_DOWN on level 9', () => {
    const { map } = generateLevel(9)
    const hasStairs = map.some(row => row.some(t => t.tile === TILE.STAIRS_DOWN))
    assert.equal(hasStairs, false)
  })

  it('places a TREASURE tile on level 9', () => {
    const { map } = generateLevel(9)
    const hasTreasure = map.some(row => row.some(t => t.tile === TILE.TREASURE))
    assert.equal(hasTreasure, true)
  })

  it('returns entitySpawns as an array', () => {
    const { entitySpawns } = generateLevel(1)
    assert.ok(Array.isArray(entitySpawns))
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/map.test.js
```

Expected: errors like `Cannot find module '../renderer/systems/map.js'`.

- [ ] **Step 3: Create `renderer/systems/map.js`**

```js
import { TILE, ALERT } from './entities.js'
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH } from '../data/levels.js'

const MAP_W = 80
const MAP_H = 50

export function createMap(width = MAP_W, height = MAP_H) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ tile: TILE.WALL, dirty: true, roomId: null }))
  )
}

function bspSplit(rect, minSize = 8) {
  const { x, y, w, h } = rect
  if (w < minSize * 2 && h < minSize * 2) return [rect]
  const splitH = w < minSize * 2 ? true : h < minSize * 2 ? false : Math.random() < 0.5
  if (splitH) {
    const sy = Math.floor(minSize + Math.random() * (h - minSize * 2))
    return [
      ...bspSplit({ x, y, w, h: sy }, minSize),
      ...bspSplit({ x, y: y + sy, w, h: h - sy }, minSize),
    ]
  }
  const sx = Math.floor(minSize + Math.random() * (w - minSize * 2))
  return [
    ...bspSplit({ x, y, w: sx, h }, minSize),
    ...bspSplit({ x: x + sx, y, w: w - sx, h }, minSize),
  ]
}

function carveRoom(map, room) {
  for (let row = room.y + 1; row < room.y + room.h - 1; row++)
    for (let col = room.x + 1; col < room.x + room.w - 1; col++) {
      map[row][col].tile = TILE.FLOOR
      map[row][col].roomId = room.id
    }
}

function carveCorridor(map, x1, y1, x2, y2) {
  let x = x1, y = y1
  while (x !== x2) { map[y][x].tile = TILE.FLOOR; x += x < x2 ? 1 : -1 }
  while (y !== y2) { map[y][x].tile = TILE.FLOOR; y += y < y2 ? 1 : -1 }
}

function center(room) {
  return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) }
}

function placeTemplate(map, template, ox, oy, roomId) {
  const spawns = []
  template.tiles.forEach((row, dy) => {
    ;[...row].forEach((ch, dx) => {
      const tx = ox + dx, ty = oy + dy
      if (!map[ty]?.[tx]) return
      if (ch === '#') {
        map[ty][tx].tile = TILE.WALL
      } else if (ch === '.') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
      } else if (ch === 'D') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'dragon', x: tx, y: ty, roomId })
      } else if (ch === 'T') {
        map[ty][tx].tile = TILE.TREASURE
        map[ty][tx].roomId = roomId
      } else if (ch === 'S') {
        map[ty][tx].tile = TILE.SHRINE
        map[ty][tx].roomId = roomId
      } else if (ch === 'V') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'item', x: tx, y: ty })
      }
    })
  })
  return spawns
}

export function isFullyConnected(map) {
  const floors = []
  for (let y = 0; y < map.length; y++)
    for (let x = 0; x < map[y].length; x++)
      if (map[y][x].tile !== TILE.WALL) floors.push({ x, y })
  if (floors.length === 0) return true

  const visited = new Set()
  const queue = [floors[0]]
  visited.add(`${floors[0].x},${floors[0].y}`)
  while (queue.length) {
    const { x, y } = queue.shift()
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`
      if (!visited.has(key) && map[ny]?.[nx]?.tile !== TILE.WALL) {
        visited.add(key)
        queue.push({ x: nx, y: ny })
      }
    }
  }
  return visited.size === floors.length
}

function buildRooms(leaves, idStart) {
  let id = idStart
  return leaves.map(leaf => {
    const m = 2
    return { x: leaf.x + m, y: leaf.y + m, w: Math.max(6, leaf.w - m * 2), h: Math.max(6, leaf.h - m * 2), id: id++ }
  })
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }

export function generateLevel(depth, width = MAP_W, height = MAP_H) {
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]

  for (let attempt = 0; attempt < 5; attempt++) {
    const map = createMap(width, height)
    const entitySpawns = []
    let roomId = 0

    const leaves = bspSplit({ x: 0, y: 0, w: width, h: height })
    const rooms = buildRooms(leaves, roomId)
    roomId += rooms.length
    rooms.forEach(r => carveRoom(map, r))
    for (let i = 1; i < rooms.length; i++) {
      const a = center(rooms[i - 1]), b = center(rooms[i])
      carveCorridor(map, a.x, a.y, b.x, b.y)
    }

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
      const nc = center(nearest.r)
      carveCorridor(map, nc.x, nc.y, lc.x, lc.y)
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

    const playerSpawn = { x: firstCenter.x, y: firstCenter.y + 1 }
    const farTiles = shuffle(floorTiles.filter(t =>
      Math.abs(t.x - firstCenter.x) + Math.abs(t.y - firstCenter.y) > 6
    ))

    const enemyCount = Math.floor(farTiles.length * cfg.enemyDensity)
    const trapCount = Math.floor(farTiles.length * cfg.trapDensity)

    for (let i = 0; i < enemyCount && i < farTiles.length; i++) {
      const kind = depth > 5 && Math.random() < 0.4 ? 'monster' : 'guard'
      entitySpawns.push({ kind, ...farTiles[i] })
    }
    for (let i = enemyCount; i < enemyCount + trapCount && i < farTiles.length; i++) {
      entitySpawns.push({ kind: 'trap', ...farTiles[i] })
    }

    return { map, entitySpawns, playerSpawn, rooms }
  }

  return generateFallback(depth, width, height)
}

function generateFallback(depth, width, height) {
  const map = createMap(width, height)
  const rooms = [
    { x: 2, y: 2,  w: 14, h: 10, id: 0 },
    { x: 28, y: 10, w: 20, h: 15, id: 1 },
    { x: 58, y: 32, w: 16, h: 12, id: 2 },
  ]
  rooms.forEach(r => carveRoom(map, r))
  carveCorridor(map, 9, 7, 38, 17)
  carveCorridor(map, 38, 17, 66, 38)
  map[7][9].tile = TILE.STAIRS_UP
  if (depth < FINAL_DEPTH) map[38][66].tile = TILE.STAIRS_DOWN
  return { map, entitySpawns: [], playerSpawn: { x: 9, y: 8 }, rooms }
}
```

- [ ] **Step 4: Run the tests**

```bash
node --test test/map.test.js
```

Expected: all tests pass (`✔`). The connectivity test runs for all 9 depths — may take 1–2 seconds.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/map.js test/map.test.js
git commit -m "feat: BSP map generation with template placement and connectivity check"
```

---

## Task 4: Stealth System

**Files:**
- Create: `renderer/systems/stealth.js`
- Create: `test/stealth.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/stealth.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  propagateNoise, decayNoiseMap, mergeNoiseMaps,
  hasLineOfSight, guardCanSeePlayer, updateGuardAlert, updateDragonSleep,
} from '../renderer/systems/stealth.js'
import { TILE, ALERT, makeGuard, makePlayer, makeDragon } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

describe('propagateNoise', () => {
  it('places noise at source', () => {
    const map = openMap()
    const nm = propagateNoise(map, { x: 5, y: 5 }, 5)
    assert.ok(nm['5,5'] > 0)
  })

  it('decays with distance', () => {
    const map = openMap()
    const nm = propagateNoise(map, { x: 5, y: 5 }, 6)
    assert.ok(nm['5,5'] > (nm['5,6'] ?? 0))
  })

  it('does not pass through walls', () => {
    const map = openMap()
    for (let y = 0; y < 20; y++) map[y][6].tile = TILE.WALL
    const nm = propagateNoise(map, { x: 5, y: 5 }, 10)
    assert.equal(nm['8,5'] ?? 0, 0)
  })
})

describe('decayNoiseMap', () => {
  it('reduces all values by decay amount', () => {
    const nm = { '1,1': 5, '2,2': 3 }
    const result = decayNoiseMap(nm, 2)
    assert.equal(result['1,1'], 3)
    assert.equal(result['2,2'], 1)
  })

  it('removes entries that reach 0 or below', () => {
    const nm = { '1,1': 1 }
    const result = decayNoiseMap(nm, 1)
    assert.equal(result['1,1'], undefined)
  })
})

describe('hasLineOfSight', () => {
  it('returns true for adjacent tiles on open map', () => {
    const map = openMap()
    assert.equal(hasLineOfSight(map, 5, 5, 5, 7), true)
  })

  it('returns false when a wall is between source and target', () => {
    const map = openMap()
    map[5][6].tile = TILE.WALL
    assert.equal(hasLineOfSight(map, 5, 5, 5, 8), false)
  })
})

describe('guardCanSeePlayer', () => {
  it('detects player directly in front within range', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    const player = makePlayer(5, 8)
    guard.facing = 'south'
    assert.equal(guardCanSeePlayer(map, guard, player), true)
  })

  it('does not detect player behind the guard', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    const player = makePlayer(5, 2)
    guard.facing = 'south'
    assert.equal(guardCanSeePlayer(map, guard, player), false)
  })

  it('does not detect player beyond fovRange', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    guard.fovRange = 3
    const player = makePlayer(5, 15)
    guard.facing = 'south'
    assert.equal(guardCanSeePlayer(map, guard, player), false)
  })
})

describe('updateGuardAlert', () => {
  it('sets guard to ALERTED when player is in sight', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    guard.facing = 'south'
    const player = makePlayer(5, 7)
    const result = updateGuardAlert(guard, {}, map, player)
    assert.equal(result.alertState, ALERT.ALERTED)
  })

  it('sets guard to CURIOUS when noise is high nearby', () => {
    const map = openMap()
    const guard = makeGuard(5, 5)
    const player = makePlayer(15, 15)
    const noiseMap = { '5,5': guard.hearingRadius }
    const result = updateGuardAlert(guard, noiseMap, map, player)
    assert.equal(result.alertState, ALERT.CURIOUS)
  })
})

describe('updateDragonSleep', () => {
  it('increases sleep meter when noise is present', () => {
    const dragon = makeDragon(5, 5, 0)
    const noiseMap = { '5,5': 6 }
    const result = updateDragonSleep(dragon, noiseMap)
    assert.ok(result.sleepMeter > 0)
  })

  it('decreases sleep meter when no noise', () => {
    const dragon = { ...makeDragon(5, 5, 0), sleepMeter: 50 }
    const result = updateDragonSleep(dragon, {})
    assert.ok(result.sleepMeter < 50)
  })

  it('sets dragonState to awake at meter >= 100', () => {
    const dragon = { ...makeDragon(5, 5, 0), sleepMeter: 99 }
    const noiseMap = { '5,5': 10 }
    const result = updateDragonSleep(dragon, noiseMap)
    assert.equal(result.dragonState, 'awake')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/stealth.test.js
```

Expected: module not found error.

- [ ] **Step 3: Create `renderer/systems/stealth.js`**

```js
import { TILE, ALERT } from './entities.js'

export function propagateNoise(map, source, amount) {
  const noiseMap = {}
  function bfs(x, y, remaining) {
    if (remaining <= 0) return
    const key = `${x},${y}`
    if ((noiseMap[key] ?? 0) >= remaining) return
    noiseMap[key] = remaining
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = x + dx, ny = y + dy
      if (map[ny]?.[nx]?.tile === TILE.WALL) continue
      bfs(nx, ny, remaining - 1)
    }
  }
  bfs(source.x, source.y, amount)
  return noiseMap
}

export function mergeNoiseMaps(a, b) {
  const result = { ...a }
  for (const [key, val] of Object.entries(b)) result[key] = Math.max(result[key] ?? 0, val)
  return result
}

export function decayNoiseMap(nm, amount = 1) {
  const result = {}
  for (const [key, val] of Object.entries(nm)) if (val - amount > 0) result[key] = val - amount
  return result
}

export function hasLineOfSight(map, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  if (steps === 0) return true
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x1 + (dx * i) / steps)
    const y = Math.round(y1 + (dy * i) / steps)
    if (x === x2 && y === y2) break
    if (map[y]?.[x]?.tile === TILE.WALL) return false
  }
  return true
}

const FACING_ANGLE = { north: 270, south: 90, east: 0, west: 180 }

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function guardCanSeePlayer(map, guard, player) {
  const dist = Math.abs(guard.x - player.x) + Math.abs(guard.y - player.y)
  if (dist > guard.fovRange) return false
  const angle = (Math.atan2(player.y - guard.y, player.x - guard.x) * 180 / Math.PI + 360) % 360
  if (angleDiff(angle, FACING_ANGLE[guard.facing]) > guard.fovAngle / 2) return false
  return hasLineOfSight(map, guard.x, guard.y, player.x, player.y)
}

export function updateGuardAlert(guard, noiseMap, map, player) {
  if (guardCanSeePlayer(map, guard, player)) return { ...guard, alertState: ALERT.ALERTED }
  if (guard.alertState === ALERT.ALERTED) return guard

  const noise = noiseMap[`${guard.x},${guard.y}`] ?? 0
  if (noise >= guard.hearingRadius * 0.5) return { ...guard, alertState: ALERT.CURIOUS }
  if (guard.alertState === ALERT.CURIOUS) return { ...guard, alertState: ALERT.SEARCHING }
  if (guard.alertState === ALERT.SEARCHING) return { ...guard, alertState: ALERT.UNAWARE }
  return guard
}

export function updateDragonSleep(dragon, noiseMap) {
  const noise = noiseMap[`${dragon.x},${dragon.y}`] ?? 0
  const meter = Math.max(0, Math.min(100, dragon.sleepMeter + (noise > 0 ? noise * 0.5 : -1)))
  const dragonState = meter < 61 ? 'sleeping' : meter < 91 ? 'stirring' : 'awake'
  return { ...dragon, sleepMeter: meter, dragonState }
}
```

- [ ] **Step 4: Run tests**

```bash
node --test test/stealth.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/stealth.js test/stealth.test.js
git commit -m "feat: stealth system — noise propagation, FOV raycasting, alert states"
```

---

## Task 5: Turn System

**Files:**
- Create: `renderer/systems/turn.js`
- Create: `test/turn.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/turn.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlayerAction, stepGuard, stepMonster, ACTION_NOISE } from '../renderer/systems/turn.js'
import { TILE, makePlayer, makeGuard, makeMonster, makeTrap } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(overrides = {}) {
  return {
    level: 1,
    map: openMap(),
    player: makePlayer(5, 5),
    entities: [],
    log: [],
    noiseMap: {},
    run: { deepestLevel: 1, won: false },
    ...overrides,
  }
}

describe('resolvePlayerAction — move', () => {
  it('moves player on open floor', () => {
    const state = makeState()
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.player.x, 6)
    assert.equal(next.player.y, 5)
  })

  it('does not move player into a wall', () => {
    const state = makeState()
    state.map[5][6].tile = TILE.WALL
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.player.x, 5)
  })

  it('sets pendingNoise.amount > 0 for a move', () => {
    const state = makeState()
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.ok(next.pendingNoise.amount > 0)
  })

  it('triggers a trap on stepped tile', () => {
    const trap = makeTrap(6, 5)
    const state = makeState({ entities: [trap] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updatedTrap = next.entities.find(e => e.type === 'trap')
    assert.equal(updatedTrap.triggered, true)
    assert.ok(next.pendingNoise.amount >= ACTION_NOISE.trigger_trap)
  })

  it('attacks and damages a guard on the target tile', () => {
    const guard = makeGuard(6, 5)
    const state = makeState({ entities: [guard] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updatedGuard = next.entities.find(e => e.type === 'guard')
    assert.ok(updatedGuard.hp < guard.hp)
  })

  it('removes guard from entities when HP reaches 0', () => {
    const guard = { ...makeGuard(6, 5), hp: 1 }
    const state = makeState({ entities: [guard] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.entities.filter(e => e.type === 'guard').length, 0)
  })
})

describe('resolvePlayerAction — steal', () => {
  it('sets won:true when player is on TREASURE tile', () => {
    const state = makeState()
    state.map[5][5].tile = TILE.TREASURE
    const next = resolvePlayerAction(state, { type: 'steal' })
    assert.equal(next.won, true)
  })
})

describe('resolvePlayerAction — descend', () => {
  it('sets descend:true when player is on STAIRS_DOWN tile', () => {
    const state = makeState()
    state.map[5][5].tile = TILE.STAIRS_DOWN
    const next = resolvePlayerAction(state, { type: 'descend' })
    assert.equal(next.descend, true)
  })
})

describe('stepGuard', () => {
  it('moves guard along its patrol path', () => {
    const map = openMap()
    const guard = makeGuard(5, 5, [{ x: 7, y: 5 }])
    const next = stepGuard(guard, map)
    assert.equal(next.x, 6)
  })

  it('does not move guard into a wall', () => {
    const map = openMap()
    map[5][6].tile = TILE.WALL
    const guard = makeGuard(5, 5, [{ x: 7, y: 5 }])
    const next = stepGuard(guard, map)
    assert.equal(next.x, 5)
  })
})

describe('stepMonster', () => {
  it('moves monster to an adjacent floor tile', () => {
    const map = openMap()
    const monster = makeMonster(5, 5)
    const next = stepMonster(monster, map)
    const dx = Math.abs(next.x - 5), dy = Math.abs(next.y - 5)
    assert.ok((dx === 1 && dy === 0) || (dx === 0 && dy === 1))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/turn.test.js
```

Expected: module not found error.

- [ ] **Step 3: Create `renderer/systems/turn.js`**

```js
import { TILE, ALERT } from './entities.js'

export const ACTION_NOISE = {
  move: 2,
  wait: 0,
  attack: 10,
  unlock: 5,
  trigger_trap: 8,
}

export function resolvePlayerAction(state, action) {
  const { player, map, entities } = state
  let newPlayer = { ...player }
  let newEntities = [...entities]
  const logs = []
  let noiseAmount = ACTION_NOISE[action.type] ?? 0

  if (action.type === 'move') {
    noiseAmount = Math.max(0, ACTION_NOISE.move - player.noiseFootprint)
    const nx = player.x + action.dx, ny = player.y + action.dy
    const tile = map[ny]?.[nx]
    if (!tile || tile.tile === TILE.WALL) {
      return { ...state, log: [...state.log, 'Blocked.'].slice(-5) }
    }

    const blockerIdx = newEntities.findIndex(e => e.x === nx && e.y === ny && (e.type === 'guard' || e.type === 'monster'))
    if (blockerIdx !== -1) {
      const blocker = newEntities[blockerIdx]
      newEntities = [...newEntities]
      newEntities[blockerIdx] = { ...blocker, hp: blocker.hp - 1 }
      if (newEntities[blockerIdx].hp <= 0) newEntities.splice(blockerIdx, 1)
      noiseAmount = ACTION_NOISE.attack
      logs.push(`You strike the ${blocker.type}!`)
    } else {
      newPlayer = { ...newPlayer, x: nx, y: ny }
      const trapIdx = newEntities.findIndex(e => e.x === nx && e.y === ny && e.type === 'trap' && !e.triggered)
      if (trapIdx !== -1) {
        newEntities = [...newEntities]
        newEntities[trapIdx] = { ...newEntities[trapIdx], triggered: true }
        noiseAmount = ACTION_NOISE.trigger_trap
        logs.push('You triggered a trap!')
      }
      if (tile.tile === TILE.STAIRS_DOWN) logs.push('Press Enter to descend.')
      if (tile.tile === TILE.TREASURE) logs.push('The treasure gleams before you… Press X to steal it.')
    }
  }

  if (action.type === 'descend' && map[player.y][player.x].tile === TILE.STAIRS_DOWN) {
    return { ...state, player: newPlayer, entities: newEntities, descend: true, log: [...state.log, 'You descend…'].slice(-5) }
  }

  if (action.type === 'steal' && map[player.y][player.x].tile === TILE.TREASURE) {
    return { ...state, player: newPlayer, entities: newEntities, won: true, log: [...state.log, 'You seize the treasure!'].slice(-5) }
  }

  if (action.type === 'wait') logs.push('You wait.')

  return {
    ...state,
    player: newPlayer,
    entities: newEntities,
    pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: noiseAmount },
    log: [...state.log, ...logs].slice(-5),
  }
}

export function stepGuard(guard, map) {
  if (guard.patrol.length === 0) return guard
  if (guard.alertState === ALERT.ALERTED || guard.alertState === ALERT.SEARCHING) return guard
  const target = guard.patrol[guard.patrolIndex % guard.patrol.length]
  const dx = Math.sign(target.x - guard.x), dy = Math.sign(target.y - guard.y)
  const nx = guard.x + dx, ny = guard.y + dy
  if (map[ny]?.[nx]?.tile === TILE.WALL) return guard
  const facing = dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north'
  const arrived = nx === target.x && ny === target.y
  return { ...guard, x: nx, y: ny, facing, patrolIndex: arrived ? guard.patrolIndex + 1 : guard.patrolIndex }
}

export function stepMonster(monster, map) {
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]]
  const valid = dirs.filter(([dx, dy]) => map[monster.y + dy]?.[monster.x + dx]?.tile !== TILE.WALL)
  if (valid.length === 0) return monster
  const [dx, dy] = valid[Math.floor(Math.random() * valid.length)]
  return { ...monster, x: monster.x + dx, y: monster.y + dy }
}
```

- [ ] **Step 4: Run tests**

```bash
node --test test/turn.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/turn.js test/turn.test.js
git commit -m "feat: turn system — player actions, guard patrol, monster wander"
```

---

## Task 6: Meta-Progression

**Files:**
- Create: `renderer/systems/meta.js`
- Create: `test/meta.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/meta.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getInitialMeta, applyRunResult, getStartingItems, validateMeta, MILESTONES,
} from '../renderer/systems/meta.js'

describe('getInitialMeta', () => {
  it('returns zero-state meta', () => {
    const meta = getInitialMeta()
    assert.equal(meta.deepestReached, 0)
    assert.deepEqual(meta.unlockedBonuses, [])
    assert.equal(meta.runsCompleted, 0)
    assert.equal(meta.treasureStolen, false)
  })
})

describe('applyRunResult', () => {
  it('updates deepestReached', () => {
    const meta = getInitialMeta()
    const next = applyRunResult(meta, { deepestLevel: 4, won: false })
    assert.equal(next.deepestReached, 4)
  })

  it('does not decrease deepestReached', () => {
    const meta = { ...getInitialMeta(), deepestReached: 6 }
    const next = applyRunResult(meta, { deepestLevel: 2, won: false })
    assert.equal(next.deepestReached, 6)
  })

  it('unlocks bonus when milestone depth is reached', () => {
    const meta = getInitialMeta()
    const milestone = MILESTONES[0]
    const next = applyRunResult(meta, { deepestLevel: milestone.depth, won: false })
    assert.ok(next.unlockedBonuses.includes(milestone.bonus))
  })

  it('does not duplicate bonuses on subsequent runs', () => {
    const meta = getInitialMeta()
    const milestone = MILESTONES[0]
    const once = applyRunResult(meta, { deepestLevel: milestone.depth, won: false })
    const twice = applyRunResult(once, { deepestLevel: milestone.depth, won: false })
    assert.equal(twice.unlockedBonuses.filter(b => b === milestone.bonus).length, 1)
  })

  it('sets treasureStolen on win', () => {
    const meta = getInitialMeta()
    const next = applyRunResult(meta, { deepestLevel: 9, won: true })
    assert.equal(next.treasureStolen, true)
  })

  it('increments runsCompleted', () => {
    const meta = getInitialMeta()
    const next = applyRunResult(meta, { deepestLevel: 1, won: false })
    assert.equal(next.runsCompleted, 1)
  })
})

describe('getStartingItems', () => {
  it('returns empty array when starting_potion bonus is not unlocked', () => {
    const meta = getInitialMeta()
    assert.deepEqual(getStartingItems(meta), [])
  })

  it('returns one potion when starting_potion is unlocked', () => {
    const meta = { ...getInitialMeta(), unlockedBonuses: ['starting_potion'] }
    const items = getStartingItems(meta)
    assert.equal(items.length, 1)
    assert.equal(items[0].use, 'heal')
  })
})

describe('validateMeta', () => {
  it('returns true for valid meta', () => {
    assert.equal(validateMeta(getInitialMeta()), true)
  })

  it('returns false for null', () => {
    assert.equal(validateMeta(null), false)
  })

  it('returns false for missing fields', () => {
    assert.equal(validateMeta({ deepestReached: 0 }), false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/meta.test.js
```

Expected: module not found error.

- [ ] **Step 3: Create `renderer/systems/meta.js`**

```js
import { ITEMS } from '../data/items.js'

export const MILESTONES = [
  { depth: 3, bonus: 'quiet_step',      label: 'Quieter footsteps' },
  { depth: 6, bonus: 'extra_slot',      label: 'Extra inventory slot' },
  { depth: 9, bonus: 'starting_potion', label: 'Start each run with a potion' },
]

export function getInitialMeta() {
  return { deepestReached: 0, unlockedBonuses: [], runsCompleted: 0, treasureStolen: false }
}

export function applyRunResult(meta, { deepestLevel, won }) {
  const newBonuses = [...meta.unlockedBonuses]
  for (const m of MILESTONES) {
    if (deepestLevel >= m.depth && !newBonuses.includes(m.bonus)) newBonuses.push(m.bonus)
  }
  return {
    deepestReached: Math.max(meta.deepestReached, deepestLevel),
    unlockedBonuses: newBonuses,
    runsCompleted: meta.runsCompleted + 1,
    treasureStolen: meta.treasureStolen || won,
  }
}

export function getStartingItems(meta) {
  return meta.unlockedBonuses.includes('starting_potion') ? [{ ...ITEMS.POTION }] : []
}

export function validateMeta(data) {
  return (
    data !== null &&
    data !== undefined &&
    typeof data.deepestReached === 'number' &&
    Array.isArray(data.unlockedBonuses) &&
    typeof data.runsCompleted === 'number' &&
    typeof data.treasureStolen === 'boolean'
  )
}
```

- [ ] **Step 4: Run tests**

```bash
node --test test/meta.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
node --test test/
```

Expected: all tests across all files pass.

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/meta.js test/meta.test.js
git commit -m "feat: meta-progression — milestone bonuses, save validation"
```

---

## Task 7: Canvas Renderer

**Files:**
- Create: `renderer/render/canvas.js`

No unit tests — rendering is verified visually when the game runs.

- [ ] **Step 1: Create `renderer/render/canvas.js`**

```js
import { TILE, ALERT } from '../systems/entities.js'

const TILE_SIZE = 16

const COLORS = {
  wall:       '#4a3728',
  wall_top:   '#5a4535',
  floor:      '#2a2218',
  door:       '#8b5e3c',
  stairs_dn:  '#1a3a5c',
  stairs_up:  '#3a1a5c',
  treasure:   '#ffd700',
  shrine:     '#8b5cf6',
}

function drawTile(ctx, tileId, px, py, S) {
  switch (tileId) {
    case TILE.WALL:
      ctx.fillStyle = COLORS.wall; ctx.fillRect(px, py, S, S)
      ctx.fillStyle = COLORS.wall_top; ctx.fillRect(px, py, S, 3)
      break
    case TILE.FLOOR:
      ctx.fillStyle = COLORS.floor; ctx.fillRect(px, py, S, S)
      break
    case TILE.DOOR:
      ctx.fillStyle = COLORS.floor; ctx.fillRect(px, py, S, S)
      ctx.fillStyle = COLORS.door; ctx.fillRect(px + 3, py + 2, S - 6, S - 4)
      break
    case TILE.STAIRS_DOWN:
      ctx.fillStyle = COLORS.stairs_dn; ctx.fillRect(px, py, S, S)
      ctx.fillStyle = '#90cdf4'; ctx.font = `${S - 2}px monospace`
      ctx.textBaseline = 'top'; ctx.fillText('▼', px + 2, py + 1)
      break
    case TILE.STAIRS_UP:
      ctx.fillStyle = COLORS.stairs_up; ctx.fillRect(px, py, S, S)
      ctx.fillStyle = '#c4b5fd'; ctx.font = `${S - 2}px monospace`
      ctx.textBaseline = 'top'; ctx.fillText('▲', px + 2, py + 1)
      break
    case TILE.TREASURE:
      ctx.fillStyle = COLORS.floor; ctx.fillRect(px, py, S, S)
      ctx.fillStyle = COLORS.treasure; ctx.fillRect(px + 3, py + 4, S - 6, S - 8)
      break
    case TILE.SHRINE:
      ctx.fillStyle = COLORS.floor; ctx.fillRect(px, py, S, S)
      ctx.fillStyle = COLORS.shrine; ctx.fillRect(px + 4, py + 2, S - 8, S - 6)
      break
    default:
      ctx.fillStyle = '#000'; ctx.fillRect(px, py, S, S)
  }
}

function drawEntity(ctx, entity, px, py, S) {
  ctx.textBaseline = 'top'
  if (entity.type === 'dragon') {
    ctx.font = `${S * 3}px serif`
    ctx.fillText('🐉', px - S, py - S)
    return
  }
  ctx.font = `${S - 2}px serif`
  const glyphs = {
    player:  '🧙',
    guard:   entity.alertState === ALERT.ALERTED ? '💂' : '🪖',
    monster: '👹',
    trap:    entity.triggered ? null : '⚠',
    puzzle:  entity.solved ? null : '🔒',
  }
  const g = glyphs[entity.type]
  if (g) ctx.fillText(g, px, py)
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.S = TILE_SIZE
    this.camX = 0
    this.camY = 0
    this.debug = false
  }

  resize() {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
  }

  updateCamera(player) {
    this.camX = player.x * this.S - this.canvas.width / 2
    this.camY = player.y * this.S - this.canvas.height / 2
  }

  render(state) {
    const { ctx, S, camX, camY } = this
    const { map, entities, player } = state
    const W = this.canvas.width, H = this.canvas.height

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    const c0 = Math.max(0, Math.floor(camX / S))
    const c1 = Math.min(map[0].length, Math.ceil((camX + W) / S))
    const r0 = Math.max(0, Math.floor(camY / S))
    const r1 = Math.min(map.length, Math.ceil((camY + H) / S))

    for (let row = r0; row < r1; row++) {
      for (let col = c0; col < c1; col++) {
        const px = Math.round(col * S - camX)
        const py = Math.round(row * S - camY)
        drawTile(ctx, map[row][col].tile, px, py, S)
      }
    }

    for (const e of entities) {
      if (e.x < c0 || e.x >= c1 || e.y < r0 || e.y >= r1) continue
      drawEntity(ctx, e, Math.round(e.x * S - camX), Math.round(e.y * S - camY), S)
    }
    drawEntity(ctx, player, Math.round(player.x * S - camX), Math.round(player.y * S - camY), S)

    if (this.debug) this._drawDebug(state, c0, c1, r0, r1)
  }

  _drawDebug(state, c0, c1, r0, r1) {
    const { ctx, S, camX, camY } = this
    if (state.noiseMap) {
      for (const [key, val] of Object.entries(state.noiseMap)) {
        const [x, y] = key.split(',').map(Number)
        if (x < c0 || x >= c1 || y < r0 || y >= r1) continue
        ctx.fillStyle = `rgba(255,200,0,${Math.min(0.6, val / 10)})`
        ctx.fillRect(Math.round(x * S - camX), Math.round(y * S - camY), S, S)
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = '7px monospace'
    for (let row = r0; row < r1; row++)
      for (let col = c0; col < c1; col++)
        ctx.fillText(`${col},${row}`, Math.round(col * S - camX), Math.round(row * S - camY) + 7)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/render/canvas.js
git commit -m "feat: canvas renderer with tile drawing, entity glyphs, camera, debug overlay"
```

---

## Task 8: HUD

**Files:**
- Create: `renderer/render/hud.js`

- [ ] **Step 1: Create `renderer/render/hud.js`**

```js
function bar(value, max, length = 6) {
  const filled = Math.round(Math.max(0, Math.min(1, value / max)) * length)
  return '█'.repeat(filled) + '░'.repeat(length - filled)
}

export function updateHUD(state) {
  const { player, level, log, noiseMap } = state
  document.getElementById('hud-level').textContent = `LVL ${level}`
  document.getElementById('hud-hp-bar').textContent = bar(player.hp, player.maxHp)
  const noise = noiseMap?.[`${player.x},${player.y}`] ?? 0
  document.getElementById('hud-noise-bar').textContent = bar(noise, 10)
  document.getElementById('hud-items').textContent =
    player.inventory.length > 0 ? player.inventory.map(i => i.emoji).join(' ') : '—'
  document.getElementById('hud-log').textContent = log[log.length - 1] ?? ''
}

export function showDragonMeter(dragon) {
  let el = document.getElementById('hud-dragon')
  if (!el) {
    el = document.createElement('span')
    el.id = 'hud-dragon'
    document.getElementById('hud-top').appendChild(el)
  }
  el.textContent = `🐉 ${bar(dragon.sleepMeter, 100)}`
  el.style.color = dragon.sleepMeter > 60 ? '#f87171' : '#888'
}

export function hideDragonMeter() {
  document.getElementById('hud-dragon')?.remove()
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/render/hud.js
git commit -m "feat: HUD — level, HP bar, noise bar, inventory, log strip, dragon meter"
```

---

## Task 9: Game Entry Point

**Files:**
- Create: `renderer/game.js`

- [ ] **Step 1: Create `renderer/game.js`**

```js
import { generateLevel } from './systems/map.js'
import { propagateNoise, decayNoiseMap, mergeNoiseMaps, updateGuardAlert, updateDragonSleep } from './systems/stealth.js'
import { resolvePlayerAction, stepGuard, stepMonster } from './systems/turn.js'
import { makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle } from './systems/entities.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta } from './systems/meta.js'
import { Renderer } from './render/canvas.js'
import { updateHUD, showDragonMeter, hideDragonMeter } from './render/hud.js'
import { FINAL_DEPTH } from './data/levels.js'

const DEBUG = location.search.includes('debug')

let state = null
let meta = null
let renderer = null
let inputLocked = false

async function init() {
  const canvas = document.getElementById('game-canvas')
  renderer = new Renderer(canvas)
  renderer.resize()
  renderer.debug = DEBUG

  const savedMeta = await window.saveAPI.loadMeta()
  meta = validateMeta(savedMeta) ? savedMeta : getInitialMeta()

  window.addEventListener('resize', () => { renderer.resize(); render() })
  window.addEventListener('keydown', onKey)

  startNewRun()
}

function buildEntities(spawns) {
  return spawns.flatMap(s => {
    switch (s.kind) {
      case 'guard':   return [makeGuard(s.x, s.y)]
      case 'monster': return [makeMonster(s.x, s.y)]
      case 'trap':    return [makeTrap(s.x, s.y)]
      case 'dragon':  return [makeDragon(s.x, s.y, s.roomId)]
      default:        return []
    }
  })
}

function startNewRun() {
  hideDragonMeter()
  const { map, entitySpawns, playerSpawn } = generateLevel(1)
  const player = makePlayer(playerSpawn.x, playerSpawn.y, meta.unlockedBonuses)
  player.inventory.push(...getStartingItems(meta))
  state = {
    level: 1,
    map,
    player,
    entities: buildEntities(entitySpawns),
    log: ['You descend into the dungeon…'],
    noiseMap: {},
    run: { deepestLevel: 1, won: false },
  }
  render()
}

function onKey(e) {
  if (inputLocked) return
  const dirMap = {
    ArrowUp: {dx:0,dy:-1}, w: {dx:0,dy:-1},
    ArrowDown: {dx:0,dy:1}, s: {dx:0,dy:1},
    ArrowLeft: {dx:-1,dy:0}, a: {dx:-1,dy:0},
    ArrowRight: {dx:1,dy:0}, d: {dx:1,dy:0},
  }
  const dir = dirMap[e.key]
  if (dir) return processTurn({ type: 'move', ...dir })
  if (e.key === 'Enter') return processTurn({ type: 'descend' })
  if (e.key === 'x' || e.key === 'X') return processTurn({ type: 'steal' })
  if (e.key === '.') return processTurn({ type: 'wait' })
}

async function processTurn(action) {
  state = resolvePlayerAction(state, action)

  if (state.won) { await endRun(true); return }
  if (state.descend) { descendLevel(); return }

  if (state.pendingNoise?.amount > 0) {
    const incoming = propagateNoise(state.map, state.pendingNoise.source, state.pendingNoise.amount)
    state = { ...state, noiseMap: mergeNoiseMaps(state.noiseMap, incoming), pendingNoise: null }
  }

  state.entities = state.entities.map(e =>
    e.type === 'guard' ? updateGuardAlert(e, state.noiseMap, state.map, state.player) : e
  )
  state.entities = state.entities.map(e => {
    if (e.type === 'guard') return stepGuard(e, state.map)
    if (e.type === 'monster') return stepMonster(e, state.map)
    return e
  })

  const dragon = state.entities.find(e => e.type === 'dragon')
  if (dragon) {
    const updated = updateDragonSleep(dragon, state.noiseMap)
    state.entities = state.entities.map(e => e.type === 'dragon' ? updated : e)
    showDragonMeter(updated)
    if (updated.dragonState === 'awake') {
      state.log = [...state.log, 'The dragon AWAKENS! Your run is over.'].slice(-5)
      render()
      await endRun(false)
      return
    }
  }

  if (state.player.hp <= 0) {
    state.log = [...state.log, 'You have fallen…'].slice(-5)
    render()
    await endRun(false)
    return
  }

  state = { ...state, noiseMap: decayNoiseMap(state.noiseMap) }
  render()
}

function descendLevel() {
  const next = state.level + 1
  const { map, entitySpawns, playerSpawn } = generateLevel(next)
  state = {
    ...state,
    level: next,
    map,
    entities: buildEntities(entitySpawns),
    player: { ...state.player, x: playerSpawn.x, y: playerSpawn.y },
    noiseMap: {},
    descend: false,
    log: [`Level ${next}. The air grows colder…`],
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
  }
  if (!state.entities.find(e => e.type === 'dragon')) hideDragonMeter()
  render()
}

async function endRun(won) {
  inputLocked = true
  meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
  await window.saveAPI.saveMeta(meta)
  await window.saveAPI.deleteRun()

  const msg = won
    ? '🏆 Treasure stolen! Press R to play again.'
    : '💀 Run over. Press R to try again.'
  state.log = [...state.log, msg].slice(-5)
  render()

  const restart = e => {
    if (e.key !== 'r' && e.key !== 'R') return
    window.removeEventListener('keydown', restart)
    inputLocked = false
    startNewRun()
  }
  window.addEventListener('keydown', restart)
}

function render() {
  renderer.updateCamera(state.player)
  renderer.render(state)
  updateHUD(state)
}

init()
```

- [ ] **Step 2: Launch the game and verify the golden path**

```bash
npm start
```

Check:
- [ ] Dungeon renders — tiles visible, player glyph (🧙) centered on screen
- [ ] Arrow keys / WASD move the player
- [ ] HUD top bar shows LVL, HP bar, NOISE bar, items
- [ ] Log strip at bottom shows messages
- [ ] Moving into a wall shows "Blocked."
- [ ] Moving onto STAIRS_DOWN shows "Press Enter to descend."
- [ ] Pressing Enter on stairs loads the next level (level counter increments)
- [ ] Dragon meter appears on level 9 (or test by temporarily setting depth to 1 in DRAGON_LAIR template)
- [ ] Press `.` to wait — noise bar stays quiet
- [ ] On level 9: move near treasure, press X — "You seize the treasure!" and win screen

- [ ] **Step 3: Test debug mode**

```bash
npm start -- --args '?debug'
```

(Or open DevTools in Electron and navigate to `?debug` — alternatively, temporarily set `DEBUG = true` in game.js.)

Check: noise heatmap (yellow overlay) visible on tiles when player moves.

- [ ] **Step 4: Run full test suite one final time**

```bash
node --test test/
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/game.js
git commit -m "feat: game entry point — full turn loop, win/lose, run restart"
```

---

## Task 10: Puzzle Spawning & Interaction

**Files:**
- Modify: `renderer/systems/map.js` — spawn puzzles in procedural rooms
- Modify: `renderer/systems/turn.js` — add `interact` action to solve puzzles
- Modify: `renderer/game.js` — bind `e` key to interact
- Modify: `test/turn.test.js` — add puzzle interaction test

- [ ] **Step 1: Add puzzle density to level config in `renderer/data/levels.js`**

Add `puzzleDensity` field to every entry in `LEVEL_CONFIG`:

```js
export const LEVEL_CONFIG = [
  { depth: 1, enemyDensity: 0.06, trapDensity: 0.03, puzzleDensity: 0.01, landmark: null },
  { depth: 2, enemyDensity: 0.08, trapDensity: 0.04, puzzleDensity: 0.01, landmark: null },
  { depth: 3, enemyDensity: 0.10, trapDensity: 0.05, puzzleDensity: 0.02, landmark: 'SHRINE' },
  { depth: 4, enemyDensity: 0.12, trapDensity: 0.06, puzzleDensity: 0.02, landmark: null },
  { depth: 5, enemyDensity: 0.14, trapDensity: 0.07, puzzleDensity: 0.02, landmark: 'VAULT' },
  { depth: 6, enemyDensity: 0.16, trapDensity: 0.08, puzzleDensity: 0.03, landmark: null },
  { depth: 7, enemyDensity: 0.18, trapDensity: 0.09, puzzleDensity: 0.03, landmark: 'SHRINE' },
  { depth: 8, enemyDensity: 0.20, trapDensity: 0.10, puzzleDensity: 0.03, landmark: null },
  { depth: 9, enemyDensity: 0.22, trapDensity: 0.11, puzzleDensity: 0.04, landmark: 'DRAGON_LAIR' },
]
```

- [ ] **Step 2: Spawn puzzles in `renderer/systems/map.js`**

In `generateLevel`, after the trap spawn loop, add:

```js
const puzzleCount = Math.floor(farTiles.length * cfg.puzzleDensity)
const puzzleStart = enemyCount + trapCount
for (let i = puzzleStart; i < puzzleStart + puzzleCount && i < farTiles.length; i++) {
  entitySpawns.push({ kind: 'puzzle', ...farTiles[i] })
}
```

- [ ] **Step 3: Add puzzle interaction to `renderer/systems/turn.js`**

Add an `interact` case inside `resolvePlayerAction`, before the closing `return` statement:

```js
if (action.type === 'interact') {
  // Check all 4 adjacent tiles for an unsolved puzzle
  const adjacent = [[0,1],[0,-1],[1,0],[-1,0]]
    .map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
  const puzzleIdx = newEntities.findIndex(e =>
    e.type === 'puzzle' && !e.solved && adjacent.some(a => a.x === e.x && a.y === e.y)
  )
  if (puzzleIdx !== -1) {
    newEntities = [...newEntities]
    newEntities[puzzleIdx] = { ...newEntities[puzzleIdx], solved: true }
    logs.push('You solved the puzzle! A passage opens.')
    noiseAmount = 1
  } else {
    logs.push('Nothing to interact with.')
    noiseAmount = 0
  }
}
```

- [ ] **Step 4: Write a failing test, then run it**

Add to `test/turn.test.js`:

```js
describe('resolvePlayerAction — interact', () => {
  it('solves an adjacent puzzle', () => {
    const puzzle = makePuzzle(6, 5)
    const state = makeState({ entities: [puzzle] })
    const next = resolvePlayerAction(state, { type: 'interact' })
    const updated = next.entities.find(e => e.type === 'puzzle')
    assert.equal(updated.solved, true)
  })

  it('does nothing when no puzzle is adjacent', () => {
    const state = makeState()
    const next = resolvePlayerAction(state, { type: 'interact' })
    assert.ok(next.log[next.log.length - 1].includes('Nothing'))
  })
})
```

Add `makePuzzle` to the import in `test/turn.test.js`:

```js
import { TILE, makePlayer, makeGuard, makeMonster, makeTrap, makePuzzle } from '../renderer/systems/entities.js'
```

Run:

```bash
node --test test/turn.test.js
```

Expected: new tests fail (interact not handled yet). Add the code from Step 3. Run again — all pass.

- [ ] **Step 5: Bind `e` key in `renderer/game.js`**

Add to the `onKey` function:

```js
if (e.key === 'e' || e.key === 'E') return processTurn({ type: 'interact' })
```

- [ ] **Step 6: Handle puzzle entity in `buildEntities` in `renderer/game.js`**

Add a `puzzle` case to the `buildEntities` switch:

```js
case 'puzzle': return [makePuzzle(s.x, s.y)]
```

Add `makePuzzle` to the import line at the top of `game.js`:

```js
import { makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle } from './systems/entities.js'
```

- [ ] **Step 7: Run full test suite**

```bash
node --test test/
```

Expected: all tests pass.

- [ ] **Step 8: Launch and verify puzzles appear and solve**

```bash
npm start
```

Check: 🔒 glyphs appear in dungeon. Standing adjacent and pressing `e` logs "You solved the puzzle!" and the 🔒 glyph disappears.

- [ ] **Step 9: Commit**

```bash
git add renderer/data/levels.js renderer/systems/map.js renderer/systems/turn.js renderer/game.js test/turn.test.js
git commit -m "feat: puzzle spawning and lever interaction"
```

---

## Task 11: Add `.gitignore`

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
.superpowers/
dist/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

---

## Done

The game is fully playable end-to-end. Future extensions (sound, more puzzle types, sprite sheets, a main menu) can be layered on top without touching the core systems.
