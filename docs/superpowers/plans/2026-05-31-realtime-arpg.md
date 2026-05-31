# Real-Time ARPG Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the dungeon crawler from turn-based to a real-time action RPG with pixel movement, melee swing, and ranged projectile attack.

**Architecture:** Four tasks: (1) simplify entity factories + migrate FOV helpers + delete obsolete tests, (2) strip HUD noise bar, (3) rewrite game.js as an rAF loop with pixel movement + AI + combat, (4) render projectiles + switch canvas to pixel-based entity positioning. The dungeon generator, sprite system, and win condition are untouched.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron, Node built-in test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Simplify makeGuard, makeMonster, makeDragon; remove ALERT; add `hasLineOfSight` and `computePlayerFOV` exports |
| `renderer/systems/stealth.js` | No longer imported — leave in place but unused |
| `renderer/systems/turn.js` | No longer imported — leave in place but unused |
| `renderer/render/hud.js` | Remove noise bar update; remove showDragonMeter/hideDragonMeter exports |
| `renderer/index.html` | Remove `hud-noise-bar` span |
| `renderer/game.js` | Complete rewrite: rAF loop, input state, update/render pipeline |
| `renderer/render/canvas.js` | `updateCamera` uses px/py; entity loop uses px/py; add projectile draw |
| `test/entities.test.js` | Update to match simplified factories |
| `test/turn.test.js` | Delete — tests code that no longer exists |

---

## Task 1: Simplify entity factories + migrate FOV helpers

**Files:**
- Modify: `renderer/systems/entities.js`
- Modify: `test/entities.test.js`
- Delete: `test/turn.test.js`

- [ ] **Step 1: Delete `test/turn.test.js` and `test/stealth.test.js`**

These files test code that will no longer be used. `stealth.test.js` also imports `ALERT` from `entities.js` which is being removed.

```bash
rm /home/lappemikb/projects/dungeon-crawler/test/turn.test.js
rm /home/lappemikb/projects/dungeon-crawler/test/stealth.test.js
```

- [ ] **Step 2: Update `test/entities.test.js` to match the simplified factories**

Replace the entire file with:

```js
// test/entities.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard, makeMonster, makeDragon, makePlayer, TILE, hasLineOfSight } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE as TILE2 } from '../renderer/systems/entities.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

describe('TILE', () => {
  it('has a SNARE constant distinct from WALL, FLOOR, COLUMN', () => {
    assert.equal(typeof TILE.SNARE, 'number')
    assert.notEqual(TILE.SNARE, TILE.WALL)
    assert.notEqual(TILE.SNARE, TILE.FLOOR)
    assert.notEqual(TILE.SNARE, TILE.COLUMN)
  })
})

describe('makeGuard', () => {
  it('has hp, maxHp, inCombat — no patrol or alertState', () => {
    const g = makeGuard(5, 5)
    assert.equal(g.hp, 4)
    assert.equal(g.maxHp, 4)
    assert.equal(g.inCombat, false)
    assert.equal(g.patrol, undefined)
    assert.equal(g.alertState, undefined)
  })
})

describe('makeMonster', () => {
  it('has hp and maxHp matching variant — no alertState', () => {
    const cases = [['weak', 1], ['medium', 2], ['strong', 3], ['boss', 5]]
    for (const [variant, hp] of cases) {
      const m = makeMonster(5, 5, variant)
      assert.equal(m.hp, hp)
      assert.equal(m.maxHp, hp)
      assert.equal(m.alertState, undefined)
    }
  })
})

describe('makeDragon', () => {
  it('has hp:12, maxHp:12, inCombat:false — no sleepMeter or snareTimer', () => {
    const d = makeDragon(5, 5, 1)
    assert.equal(d.hp, 12)
    assert.equal(d.maxHp, 12)
    assert.equal(d.inCombat, false)
    assert.equal(d.sleepMeter, undefined)
    assert.equal(d.snareTimer, undefined)
  })
})

describe('hasLineOfSight', () => {
  it('returns true for two points with open floor between them', () => {
    const map = openMap()
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), true)
  })

  it('returns false when a wall blocks the line', () => {
    const map = openMap()
    for (let y = 0; y < 20; y++) map[y][7].tile = TILE.WALL
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), false)
  })
})
```

- [ ] **Step 3: Run to confirm tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js 2>&1 | tail -8
```

Expected: FAIL — factories still have old fields and `hasLineOfSight` not yet exported from entities.js.

- [ ] **Step 4: Simplify entity factories in `renderer/systems/entities.js`**

Replace the file with this complete version:

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

export const DRAGON_STATE = { SLEEPING: 'sleeping', STIRRING: 'stirring', AWAKE: 'awake' }

export const WEAPON_TYPES = {
  dagger:    { name: 'Dagger',    damage: 1 },
  sword:     { name: 'Sword',     damage: 2 },
  longsword: { name: 'Longsword', damage: 3 },
  axe:       { name: 'Axe',       damage: 4 },
}

export function isWalkable(tileId) {
  return tileId !== TILE.WALL && tileId !== TILE.COLUMN
}

export function hasLineOfSight(map, y1, x1, y2, x2) {
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  if (steps === 0) return true
  for (let i = 1; i <= steps; i++) {
    const y = Math.round(y1 + (dy * i) / steps)
    const x = Math.round(x1 + (dx * i) / steps)
    if (y === y2 && x === x2) break
    if (!map[y]?.[x] || !isWalkable(map[y][x].tile)) return false
  }
  return true
}

export function computePlayerFOV(map, player, radius = 8) {
  for (const row of map) for (const tile of row) tile.visible = false
  const { x: px, y: py } = player
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = px + dx, ty = py + dy
      if (!map[ty]?.[tx]) continue
      if (hasLineOfSight(map, py, px, ty, tx)) {
        map[ty][tx].visible = true
        map[ty][tx].explored = true
      }
    }
  }
}

export function makePlayer(x, y, bonuses = []) {
  const quietSteps = bonuses.filter(b => b === 'quiet_step').length
  const extraSlots = bonuses.filter(b => b === 'extra_slot').length
  return {
    type: 'player', x, y,
    hp: 10, maxHp: 10,
    inventory: [], maxInventory: 5 + extraSlots,
    noiseFootprint: Math.max(0, 2 - quietSteps),
    bonuses, weapon: null,
  }
}

export function makeGuard(x, y) {
  return { type: 'guard', x, y, hp: 4, maxHp: 4, inCombat: false }
}

const MONSTER_VARIANTS = {
  weak:   { hp: 1, damage: 1 },
  medium: { hp: 2, damage: 1 },
  strong: { hp: 3, damage: 1 },
  boss:   { hp: 5, damage: 2 },
}

export function makeMonster(x, y, variant = 'weak') {
  const stats = MONSTER_VARIANTS[variant] ?? MONSTER_VARIANTS.weak
  return { type: 'monster', x, y, variant, hp: stats.hp, maxHp: stats.hp, damage: stats.damage, inCombat: false }
}

export function makeTrap(x, y) {
  return { type: 'trap', x, y, triggered: false, noiseBurst: 8 }
}

export function makePuzzle(x, y) {
  return { type: 'puzzle', x, y, solved: false, reward: null }
}

export function makeDragon(x, y, roomId) {
  return { type: 'dragon', x, y, roomId, hp: 12, maxHp: 12, inCombat: false }
}

export function makeWeapon(x, y, weaponType = 'dagger') {
  const def = WEAPON_TYPES[weaponType] ?? WEAPON_TYPES.dagger
  return { type: 'weapon', x, y, weaponType, name: def.name, damage: def.damage }
}

export function makePotion(x, y, amount = 4) {
  return { type: 'potion', x, y, amount }
}

export function makeChest(x, y, contents) {
  return { type: 'chest', x, y, contents, opening: false, frame: 0 }
}

export function makeDoor(x, y) {
  return { type: 'door', x, y, opening: false, frame: 0 }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite — confirm only entities.test passes cleanly**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/ 2>&1 | tail -8
```

Expected: the stealth and map tests still pass; entities tests pass. (Note: meta.test.js and map.test.js should be unaffected.)

- [ ] **Step 7: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/entities.js test/entities.test.js && git rm test/turn.test.js test/stealth.test.js && git commit -m "refactor: simplify entity factories; migrate hasLineOfSight/computePlayerFOV to entities.js"
```

---

## Task 2: HUD and HTML cleanup

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/render/hud.js`

No automated tests — visual verification (game loads without console errors).

- [ ] **Step 1: Remove `hud-noise-bar` from `renderer/index.html`**

In `renderer/index.html`, remove this line from the `#hud-top` div:

```html
<span>NOISE <span id="hud-noise-bar">░░░░░░</span></span>
```

The resulting `#hud-top` div should be:

```html
<div id="hud-top">
  <span id="hud-level">LVL 1</span>
  <span>HP <span id="hud-hp-bar">██████</span></span>
  <span id="hud-weapon" style="color:#f6ad55">Unarmed</span>
  <span id="hud-items">—</span>
</div>
```

- [ ] **Step 2: Rewrite `renderer/render/hud.js`**

Replace the entire file:

```js
function bar(value, max, length = 6) {
  if (!max) return '░'.repeat(length)
  const filled = Math.round(Math.max(0, Math.min(1, value / max)) * length)
  return '█'.repeat(filled) + '░'.repeat(length - filled)
}

function el(id) { return document.getElementById(id) }

export function updateHUD(state) {
  const { player, level, log } = state
  if (!player) return
  el('hud-level').textContent = `LVL ${level}`
  el('hud-hp-bar').textContent = bar(player.hp, player.maxHp)
  el('hud-weapon').textContent = player.weapon
    ? `${player.weapon.name} (${player.weapon.damage} dmg)`
    : 'Unarmed'
  el('hud-items').textContent =
    player.inventory.length > 0 ? player.inventory.map(i => i.emoji).join(' ') : '—'
  el('hud-log').textContent = log?.at(-1) ?? ''
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/index.html renderer/render/hud.js && git commit -m "refactor: remove noise bar from HUD"
```

---

## Task 3: Game loop + player pixel movement

**Files:**
- Rewrite: `renderer/game.js`
- Modify: `renderer/render/canvas.js`

No automated tests — verify visually: player moves smoothly, camera follows, FOV works, weapon pickups work, stairs descend.

- [ ] **Step 1: Rewrite `renderer/game.js`**

Replace the entire file:

```js
import { generateLevel } from './systems/map.js'
import { computePlayerFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeWeapon, makePotion, makeChest, makeDoor, WEAPON_TYPES, TILE, isWalkable } from './systems/entities.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta } from './systems/meta.js'
import { Renderer } from './render/canvas.js'
import { updateHUD } from './render/hud.js'
import { FINAL_DEPTH } from './data/levels.js'

const TILE_SIZE = 32
const PLAYER_SPEED = 120
const ENEMY_CHASE_SPEED = 80
const ENEMY_WANDER_SPEED = 30
const CHASE_RANGE = 180
const CHASE_DROP_RANGE = 240
const MELEE_COOLDOWN = 0.4
const RANGED_COOLDOWN = 0.6
const PROJECTILE_SPEED = 280
const CONTACT_RANGE = 20
const CONTACT_DAMAGE_COOLDOWN = 0.8
const PLAYER_HALF = 6
const ENEMY_HALF = 4

const keys = {}
window.addEventListener('keydown', e => { keys[e.key] = true })
window.addEventListener('keyup',   e => { keys[e.key] = false })

let state = null
let meta = null
let renderer = null
let lastTime = 0
let rafId = null

function canMoveTo(map, px, py, half = PLAYER_HALF) {
  const corners = [
    [px - half, py - half],
    [px + half, py - half],
    [px - half, py + half],
    [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const tile = map[Math.floor(cy / TILE_SIZE)]?.[Math.floor(cx / TILE_SIZE)]
    return tile && isWalkable(tile.tile)
  })
}

function moveEntity(e, dx, dy, map, half = PLAYER_HALF) {
  if (dx !== 0 && canMoveTo(map, e.px + dx, e.py, half)) e.px += dx
  if (dy !== 0 && canMoveTo(map, e.px, e.py + dy, half)) e.py += dy
  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)
}

function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
}

function buildEntities(spawns, map) {
  return spawns.flatMap(s => {
    const cx = s.x * TILE_SIZE + TILE_SIZE / 2
    const cy = s.y * TILE_SIZE + TILE_SIZE / 2
    const wander = () => ({ wanderTimer: Math.random() * 2, wanderDx: 0, wanderDy: 0, damageCooldown: 0 })
    switch (s.kind) {
      case 'guard':   return [{ ...makeGuard(s.x, s.y),   px: cx, py: cy, ...wander() }]
      case 'monster': return [{ ...makeMonster(s.x, s.y, s.variant), px: cx, py: cy, ...wander() }]
      case 'dragon':  return [{ ...makeDragon(s.x, s.y, s.roomId),  px: cx, py: cy, ...wander() }]
      case 'trap':    return [makeTrap(s.x, s.y)]
      case 'puzzle':  return [makePuzzle(s.x, s.y)]
      case 'weapon': {
        const wt = s.weaponType ?? 'dagger'
        const def = WEAPON_TYPES[wt] ?? WEAPON_TYPES.dagger
        return [makeChest(s.x, s.y, { type: 'weapon', weaponType: wt, name: def.name, damage: def.damage })]
      }
      case 'potion':  return [makeChest(s.x, s.y, { type: 'potion', amount: 4 })]
      case 'door':    return [makeDoor(s.x, s.y)]
      default:        return []
    }
  })
}

function startNewRun() {
  if (rafId) cancelAnimationFrame(rafId)
  const { map, entitySpawns, playerSpawn } = generateLevel(1)
  const player = makePlayer(playerSpawn.x, playerSpawn.y, meta.unlockedBonuses)
  player.px = playerSpawn.x * TILE_SIZE + TILE_SIZE / 2
  player.py = playerSpawn.y * TILE_SIZE + TILE_SIZE / 2
  player.facing = 'south'
  player.meleeCooldown = 0
  player.rangedCooldown = 0
  player.inventory.push(...getStartingItems(meta))
  state = {
    level: 1,
    map,
    player,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    log: ['You enter the dungeon…'],
    hitEffects: [],
    run: { deepestLevel: 1, won: false },
    gameOver: false,
  }
  lastTime = performance.now()
  rafId = requestAnimationFrame(gameLoop)
}

function gameLoop(timestamp) {
  const delta = Math.min(timestamp - lastTime, 100) / 1000
  lastTime = timestamp
  if (!state.gameOver) update(delta)
  render()
  rafId = requestAnimationFrame(gameLoop)
}

function update(delta) {
  const { player, map } = state

  // -- Player movement --
  let vx = 0, vy = 0
  if (keys['ArrowLeft']  || keys['a']) { vx -= 1; player.facing = 'west'  }
  if (keys['ArrowRight'] || keys['d']) { vx += 1; player.facing = 'east'  }
  if (keys['ArrowUp']    || keys['w']) { vy -= 1; player.facing = 'north' }
  if (keys['ArrowDown']  || keys['s']) { vy += 1; player.facing = 'south' }
  if (vx !== 0 && vy !== 0) { const len = Math.SQRT2; vx /= len; vy /= len }
  moveEntity(player, vx * PLAYER_SPEED * delta, vy * PLAYER_SPEED * delta, map, PLAYER_HALF)

  // -- Pickups & tile interactions --
  const pickupIdx = state.entities.findIndex(e =>
    e.x === player.x && e.y === player.y && (e.type === 'weapon' || e.type === 'potion'))
  if (pickupIdx !== -1) {
    const item = state.entities[pickupIdx]
    if (item.type === 'weapon') {
      player.weapon = { weaponType: item.weaponType, name: item.name, damage: item.damage }
      state.log = [...state.log, `Picked up ${item.name}!`].slice(-5)
    } else {
      const healed = Math.min(player.maxHp - player.hp, item.amount)
      player.hp += healed
      state.log = [...state.log, healed > 0 ? `Healed ${healed} HP!` : 'Already full.'].slice(-5)
    }
    state.entities = state.entities.filter((_, i) => i !== pickupIdx)
  }

  // Open chest by bumping
  const chestIdx = state.entities.findIndex(e =>
    e.type === 'chest' && !e.opening && e.x === player.x && e.y === player.y)
  if (chestIdx !== -1) {
    const chest = state.entities[chestIdx]
    if (chest.contents.type === 'weapon') {
      const { weaponType, name, damage } = chest.contents
      player.weapon = { weaponType, name, damage }
      state.log = [...state.log, `Found ${name}!`].slice(-5)
    } else if (chest.contents.type === 'potion') {
      const healed = Math.min(player.maxHp - player.hp, chest.contents.amount)
      player.hp += healed
      state.log = [...state.log, healed > 0 ? `Healed ${healed} HP!` : 'Already full.'].slice(-5)
    }
    state.entities = state.entities.map((e, i) => i === chestIdx ? { ...e, opening: true, frame: 4 } : e)
  }

  // Stairs
  if (keys['Enter'] && map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
    descendLevel(); return
  }

  // Steal treasure
  if ((keys['x'] || keys['X']) && map[player.y]?.[player.x]?.tile === TILE.TREASURE) {
    state.run.won = true; endRun(true); return
  }

  // -- Combat cooldowns --
  player.meleeCooldown  = Math.max(0, player.meleeCooldown  - delta)
  player.rangedCooldown = Math.max(0, player.rangedCooldown - delta)

  // -- Melee (Space) --
  if (keys[' '] && player.meleeCooldown === 0) {
    player.meleeCooldown = MELEE_COOLDOWN
    const dmg = player.weapon?.damage ?? 1
    const SW = 48, SH = 24
    let hx, hy, hw, hh
    switch (player.facing) {
      case 'east':  hx = player.px;       hy = player.py - SH/2; hw = SW; hh = SH; break
      case 'west':  hx = player.px - SW;  hy = player.py - SH/2; hw = SW; hh = SH; break
      case 'south': hx = player.px - SH/2; hy = player.py;       hw = SH; hh = SW; break
      case 'north': hx = player.px - SH/2; hy = player.py - SW;  hw = SH; hh = SW; break
    }
    state.entities = state.entities
      .map(e => isEnemy(e) && e.px >= hx && e.px <= hx+hw && e.py >= hy && e.py <= hy+hh
        ? { ...e, hp: e.hp - dmg, inCombat: true } : e)
      .filter(e => !isEnemy(e) || e.hp > 0)
    state.hitEffects = [{ x: player.x, y: player.y }]
  }

  // -- Ranged (Shift) --
  if ((keys['Shift'] || keys['ShiftLeft'] || keys['ShiftRight']) && player.rangedCooldown === 0) {
    player.rangedCooldown = RANGED_COOLDOWN
    const dmg = player.weapon?.damage ?? 1
    const dir = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[player.facing]
    state.projectiles.push({ px: player.px, py: player.py, dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED, damage: dmg })
  }

  // -- Update projectiles --
  const liveProjectiles = []
  for (const p of state.projectiles) {
    p.px += p.dx * delta
    p.py += p.dy * delta
    const tile = map[Math.floor(p.py / TILE_SIZE)]?.[Math.floor(p.px / TILE_SIZE)]
    if (!tile || !isWalkable(tile.tile)) continue
    let hit = false
    state.entities = state.entities.map(e => {
      if (!isEnemy(e) || hit) return e
      if (Math.hypot(e.px - p.px, e.py - p.py) < 8) { hit = true; return { ...e, hp: e.hp - p.damage, inCombat: true } }
      return e
    })
    state.entities = state.entities.filter(e => !isEnemy(e) || e.hp > 0)
    if (!hit) liveProjectiles.push(p)
  }
  state.projectiles = liveProjectiles

  // -- Enemy AI --
  for (const e of state.entities) {
    if (!isEnemy(e)) continue
    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    e.wanderTimer    = Math.max(0, e.wanderTimer    - delta)
    const dist = Math.hypot(e.px - player.px, e.py - player.py)
    const chasing = dist < CHASE_RANGE && hasLineOfSight(map, e.y, e.x, player.y, player.x)
    if (chasing) {
      const len = dist || 1
      const speed = e.type === 'dragon' ? 60 : ENEMY_CHASE_SPEED
      moveEntity(e, (player.px - e.px) / len * speed * delta, (player.py - e.py) / len * speed * delta, map, ENEMY_HALF)
    } else if (dist < CHASE_DROP_RANGE) {
      if (e.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2
        e.wanderDx = Math.cos(angle); e.wanderDy = Math.sin(angle)
        e.wanderTimer = 1 + Math.random()
      }
      moveEntity(e, e.wanderDx * ENEMY_WANDER_SPEED * delta, e.wanderDy * ENEMY_WANDER_SPEED * delta, map, ENEMY_HALF)
    }
    // Contact damage
    if (dist < CONTACT_RANGE && e.damageCooldown === 0) {
      const contactDmg = e.type === 'dragon' ? 2 : 1
      player.hp -= contactDmg
      e.damageCooldown = CONTACT_DAMAGE_COOLDOWN
      state.log = [...state.log, `Hit for ${contactDmg} damage!`].slice(-5)
    }
  }

  // -- Player death --
  if (player.hp <= 0) {
    state.gameOver = true
    state.log = [...state.log, '💀 You have fallen… (R to restart)'].slice(-5)
    window.addEventListener('keydown', function restart(e) {
      if (e.key === 'r' || e.key === 'R') { window.removeEventListener('keydown', restart); startNewRun() }
    })
  }
}

function render() {
  computePlayerFOV(state.map, state.player)
  renderer.updateCamera(state.player)
  renderer.render(state)
  updateHUD(state)
}

function descendLevel() {
  const next = state.level + 1
  const { map, entitySpawns, playerSpawn } = generateLevel(next)
  const px = playerSpawn.x * TILE_SIZE + TILE_SIZE / 2
  const py = playerSpawn.y * TILE_SIZE + TILE_SIZE / 2
  state = {
    ...state,
    level: next,
    map,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    player: { ...state.player, x: playerSpawn.x, y: playerSpawn.y, px, py },
    log: [`Level ${next}. Deeper into the dark…`],
    hitEffects: [],
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
  }
}

async function endRun(won) {
  if (rafId) cancelAnimationFrame(rafId)
  meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
  await window.saveAPI.saveMeta(meta)
  await window.saveAPI.deleteRun()
  const msg = won ? '🏆 Treasure stolen! Press R to play again.' : '💀 Run over. Press R.'
  state.log = [...state.log, msg].slice(-5)
  render()
  window.addEventListener('keydown', function restart(e) {
    if (e.key === 'r' || e.key === 'R') { window.removeEventListener('keydown', restart); startNewRun() }
  })
}

async function init() {
  const canvas = document.getElementById('game-canvas')
  renderer = new Renderer(canvas)
  renderer.resize()
  await renderer.loadSprites()
  const savedMeta = await window.saveAPI.loadMeta()
  meta = validateMeta(savedMeta) ? savedMeta : getInitialMeta()
  window.addEventListener('resize', () => renderer.resize())
  startNewRun()
}

init()
```

- [ ] **Step 2: Update `renderer/render/canvas.js` — camera and entity rendering use pixel coords**

In `renderer/render/canvas.js`, update the `updateCamera` method and the entity rendering loop. Find and replace these two sections:

**`updateCamera` method** (currently uses tile coords):

```js
  updateCamera(player) {
    const px = player.px ?? (player.x * this.S + this.S / 2)
    const py = player.py ?? (player.y * this.S + this.S / 2)
    this.camX = px - this.canvas.width / 2
    this.camY = py - this.canvas.height / 2
  }
```

**Entity rendering loop** inside `render(state)` (replace the existing `for (const e of entities)` loop and the player draw line):

```js
    for (const e of entities) {
      const margin = e.type === 'dragon' ? 5 : 0
      if (e.x + margin < c0 || e.x - margin >= c1 || e.y + margin < r0 || e.y - margin >= r1) continue
      if (!map[e.y]?.[e.x]?.visible) continue
      const epx = e.px !== undefined ? Math.round(e.px - S/2 - camX) : Math.round(e.x * S - camX)
      const epy = e.py !== undefined ? Math.round(e.py - S/2 - camY) : Math.round(e.y * S - camY)
      drawEntity(ctx, e, epx, epy, S, sprites)
    }
    const ppx = player.px !== undefined ? Math.round(player.px - S/2 - camX) : Math.round(player.x * S - camX)
    const ppy = player.py !== undefined ? Math.round(player.py - S/2 - camY) : Math.round(player.y * S - camY)
    drawEntity(ctx, player, ppx, ppy, S, sprites)
    drawHealthBars(ctx, entities, map, camX, camY, S)
```

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass (turn.test.js is gone; remaining tests pass).

- [ ] **Step 4: Start the game and verify player movement**

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

Verify:
- [ ] Player moves smoothly in 8 directions with WASD or arrow keys
- [ ] Camera follows the player
- [ ] FOV reveals tiles around player
- [ ] Walking over a chest opens it and gives the weapon
- [ ] HUD shows level, HP bar, weapon name — no noise bar

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js renderer/render/canvas.js && git commit -m "feat: replace turn-based loop with real-time rAF game loop; pixel movement"
```

---

## Task 4: Add projectile rendering to canvas.js

**Files:**
- Modify: `renderer/render/canvas.js`

- [ ] **Step 1: Add projectile draw call inside `Renderer.render()`**

In `renderer/render/canvas.js`, inside the `render(state)` method, after `drawHealthBars(...)` and before the `hitEffects` block, add:

```js
    // Draw projectiles
    for (const p of state.projectiles ?? []) {
      const ppx = Math.round(p.px - camX)
      const ppy = Math.round(p.py - camY)
      ctx.fillStyle = '#facc15'
      ctx.fillRect(ppx - 2, ppy - 2, 4, 4)
    }
```

- [ ] **Step 2: Start the game and verify projectiles**

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

Verify:
- [ ] Pressing Shift fires a yellow 4×4px dot in the player's facing direction
- [ ] Projectile disappears on hitting a wall
- [ ] Projectile disappears on hitting an enemy (and enemy takes damage)
- [ ] Melee (Space) flashes the hit effect on nearby enemies

- [ ] **Step 3: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: render projectiles as yellow dots"
```

---

## Final verification

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

Manual smoke test with `npm start`:
- [ ] Player moves smoothly, camera follows
- [ ] Enemies wander; when player is within ~6 tiles and LOS, they chase
- [ ] Melee (Space) hits nearby enemies; ranged (Shift) fires projectile
- [ ] Enemy contact deals damage; player HP bar decrements
- [ ] Death shows restart message; R restarts
- [ ] Chests give weapons; weapon name updates in HUD
- [ ] Stairs descend to next level on Enter
- [ ] Treasure tile + X wins the run
