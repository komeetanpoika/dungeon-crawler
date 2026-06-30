# Larger Dragon Boss (Depth 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, larger, procedurally-drawn articulated dragon **boss** as the finale on a new depth 10 — anchored, turns to face the player, with a fixed fire cone, a head-driven sweeping breath, and a tail-sweep knockback. The existing depth-9 dragon is untouched.

**Architecture:** A new pure-logic module `renderer/systems/dragonboss.js` (entity + AI + a unit-tested `pointInCone` helper) drives animation state fields; a new render module `renderer/render/dragonboss.js` draws the articulated rig (scaled body, bendy neck, segmented tail, paneled wings) from those fields. Level data adds depth 10 (`GREAT_LAIR` arena, theme, config) and moves the treasure there. `game.js` wires spawning, the AI loop, combat, and the final-depth bump.

**Tech Stack:** Vanilla ES modules, HTML5 canvas 2D, `node --test`. No new deps. Tile size = 32px.

**Reference spec:** `docs/superpowers/specs/2026-06-08-larger-dragon-boss-design.md`

---

### Task 1: Boss entity core — `pointInCone`, `makeDragonBoss`, facing & contact

**Files:**
- Create: `renderer/systems/dragonboss.js`
- Test: `test/dragonboss.test.js`

- [ ] **Step 1: Write the failing tests** — create `test/dragonboss.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeDragonBoss, updateDragonBoss, pointInCone, BOSS_HP } from '../renderer/systems/dragonboss.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const T = 32
function openMap(w = 40, h = 40) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}
function mkPlayer(px, py) { return { type: 'player', x: Math.floor(px/T), y: Math.floor(py/T), px, py, hp: 30, maxHp: 30 } }
function mkState(boss, player) { return { player, map: openMap(), projectiles: [], entities: [boss], log: [] } }

describe('pointInCone', () => {
  it('true for a point inside the half-angle and within length', () => {
    assert.equal(pointInCone(100, 0, 0, 0, 0, 0.4, 200), true)       // straight ahead (aim 0 = +x)
  })
  it('false beyond the length', () => {
    assert.equal(pointInCone(300, 0, 0, 0, 0, 0.4, 200), false)
  })
  it('false outside the half-angle', () => {
    assert.equal(pointInCone(0, 100, 0, 0, 0, 0.4, 200), false)      // 90° off-axis
  })
  it('respects a rotated aim', () => {
    assert.equal(pointInCone(0, 100, 0, 0, Math.PI/2, 0.4, 200), true) // aim points +y
  })
})

describe('makeDragonBoss', () => {
  it('has correct initial fields', () => {
    const e = makeDragonBoss(10, 8)
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.hp, BOSS_HP); assert.equal(e.maxHp, BOSS_HP)
    assert.equal(e.state, 'idle')
    assert.equal(e.anchorX, 10); assert.equal(e.anchorY, 8)
    assert.equal(e.tailSwing, 0); assert.equal(e.neckRear, 0)
  })
})

describe('updateDragonBoss facing', () => {
  it('eases facing toward the player over time', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    const player = mkPlayer(10*T, 16*T)           // due south => target angle +PI/2
    const state = mkState(e, player)
    for (let i = 0; i < 60; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(Math.abs(e.facing - Math.PI/2) < 0.2, `facing should approach +PI/2, got ${e.facing}`)
  })
})

describe('updateDragonBoss contact damage', () => {
  it('damages the player on body contact, respecting cooldown', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T
    const player = mkPlayer(10*T + 8, 10*T)       // overlapping the body
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    const after = player.hp
    assert.ok(after < 30, 'contact should deal damage')
    updateDragonBoss(e, state, 1/60)              // still on cooldown
    assert.equal(player.hp, after, 'no second hit while damageCooldown active')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -iE "dragonboss|cannot find" | head`
Expected: FAIL — `renderer/systems/dragonboss.js` does not exist.

- [ ] **Step 3: Create `renderer/systems/dragonboss.js`** (core only — the attack state machine is added in Task 2):

```js
import { isWalkable } from './entities.js'

const TILE = 32
export const BOSS_HP = 28
const TURN_RATE   = 2.5            // rad/s the body rotates to track the player
const BOSS_CONTACT = 1.4 * TILE    // contact radius (body spans ~3×4 tiles)
const CONTACT_DMG = 2
const CONTACT_CD  = 0.8

// Is (px,py) inside the cone with apex (ox,oy), centre direction `aim`,
// half-angle `half` (rad) and length `len`? Pure — unit tested.
export function pointInCone(px, py, ox, oy, aim, half, len) {
  const dx = px - ox, dy = py - oy
  const d = Math.hypot(dx, dy)
  if (d === 0 || d > len) return false
  let diff = Math.atan2(dy, dx) - aim
  while (diff >  Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return Math.abs(diff) <= half
}

export function makeDragonBoss(x, y) {
  return {
    type: 'dragon_boss', x, y, hp: BOSS_HP, maxHp: BOSS_HP, inCombat: false,
    anchorX: x, anchorY: y, facing: 0,
    // animation state read by the renderer:
    neckRear: 0, headAim: 0, tailSwing: 0, breathTime: 0,
    // ai/attack state:
    state: 'idle', stateTimer: 0, attackCooldown: 1.2,
    repositionTimer: 10, damageCooldown: 0, dmgAcc: 0,
  }
}

export function approach(c, t, s) { return c < t ? Math.min(t, c + s) : Math.max(t, c - s) }

export function easeAngle(cur, target, maxStep) {
  let d = target - cur
  while (d >  Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep
}

export function updateDragonBoss(e, state, delta) {
  const { player } = state
  e.breathTime += delta
  e.damageCooldown = Math.max(0, e.damageCooldown - delta)
  const dist = Math.hypot(player.px - e.px, player.py - e.py)
  if (dist < 12 * TILE) e.inCombat = true

  // turn to face the player
  const target = Math.atan2(player.py - e.py, player.px - e.px)
  e.facing = easeAngle(e.facing, target, TURN_RATE * delta)

  // contact damage
  if (dist < BOSS_CONTACT && e.damageCooldown <= 0) {
    player.hp -= CONTACT_DMG
    e.damageCooldown = CONTACT_CD
    state.log = [...state.log, `Hit for ${CONTACT_DMG} damage!`].slice(-5)
  }

  // (attack state machine added in Task 2 — for now just settle to idle)
  e.neckRear  = approach(e.neckRear, 0, 3 * delta)
  e.tailSwing = approach(e.tailSwing, 0, 4 * delta)
  e.headAim   = approach(e.headAim, 0, 3 * delta)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: all pass (new dragonboss tests + existing suites), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/dragonboss.js test/dragonboss.test.js
git commit -m "feat: dragon boss entity core (pointInCone, facing, contact)"
```

---

### Task 2: Boss attack state machine

**Files:**
- Modify: `renderer/systems/dragonboss.js`
- Test: `test/dragonboss.test.js`

- [ ] **Step 1: Add the failing tests** — append inside `test/dragonboss.test.js`:

```js
describe('updateDragonBoss attacks', () => {
  function ready(e) { e.attackCooldown = 0; e.repositionTimer = 999 }  // force an attack, no reposition

  it('picks a tail attack when the player is in close range', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; ready(e)
    const player = mkPlayer(10*T + 2*T, 10*T)     // ~2 tiles away => within tail reach
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    assert.ok(e.state === 'tail_windup' || e.state === 'tail', `expected tail*, got ${e.state}`)
  })

  it('picks a ranged breath (cone or sweep) at distance', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; ready(e)
    const player = mkPlayer(10*T + 6*T, 10*T)     // far => ranged
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    assert.ok(['cone','sweep_windup','sweep'].includes(e.state), `expected ranged, got ${e.state}`)
  })

  it('does not start a new attack while attackCooldown is active', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T
    e.attackCooldown = 1; e.repositionTimer = 999
    const player = mkPlayer(10*T + 6*T, 10*T)
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    assert.equal(e.state, 'idle')
  })

  it('sweeping breath damages a player inside the swept cone', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    e.state = 'sweep'; e.stateTimer = 1.5; e.headAim = 0
    const player = mkPlayer(10*T + 3*T, 10*T)     // straight ahead, within cone length
    const state = mkState(e, player); const hp0 = player.hp
    for (let i = 0; i < 30; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(player.hp < hp0, 'player in cone should take breath damage')
  })

  it('tail sweep applies burst damage and knocks the player back', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    e.state = 'tail'; e.stateTimer = 0.45; e.dmgAcc = 0
    const player = mkPlayer(10*T + 2*T, 10*T)
    const state = mkState(e, player)
    const px0 = player.px, hp0 = player.hp
    for (let i = 0; i < 30; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(player.hp < hp0, 'tail sweep should deal damage')
    assert.ok(player.px > px0, 'player should be knocked outward (away from dragon at -x side)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -iE "attacks|tail|sweep" | head`
Expected: FAIL (attacks never trigger — the state machine isn't implemented yet).

- [ ] **Step 3: Implement the state machine.** In `renderer/systems/dragonboss.js`, add these constants below the existing ones (after `CONTACT_CD`):

```js
const CONE_HALF   = 0.34
const CONE_LEN    = 6 * TILE
const CONE_DPS    = 3
const SWEEP_ARC   = 0.7            // headAim sweeps from -SWEEP_ARC to +SWEEP_ARC
const TAIL_REACH  = 3.2 * TILE
const TAIL_DMG    = 4
const KNOCKBACK   = 26
const REPOSITION_EVERY = 10
```

Then add these helpers at the end of the module:

```js
function tileWalkable(map, px, py) {
  const t = map[Math.floor(py / TILE)]?.[Math.floor(px / TILE)]
  return !!(t && isWalkable(t.tile, t))
}

function coneDamage(e, state, aim, delta) {
  const { player } = state
  if (pointInCone(player.px, player.py, e.px, e.py, aim, CONE_HALF, CONE_LEN)) {
    e.dmgAcc += CONE_DPS * delta
    while (e.dmgAcc >= 1) {
      player.hp -= 1; e.dmgAcc -= 1
      state.log = [...state.log, 'Dragon fire! (-1 HP)'].slice(-5)
    }
  }
}

function knockback(e, player, map) {
  const dx = player.px - e.px, dy = player.py - e.py, d = Math.hypot(dx, dy) || 1
  const nx = player.px + (dx / d) * KNOCKBACK, ny = player.py + (dy / d) * KNOCKBACK
  if (tileWalkable(map, nx, player.py)) { player.px = nx; player.x = Math.floor(nx / TILE) }
  if (tileWalkable(map, player.px, ny)) { player.py = ny; player.y = Math.floor(ny / TILE) }
}

function startReposition(e, state) {
  const { map } = state
  for (const [dx, dy] of [[3,0],[-3,0],[0,3],[0,-3],[2,2],[-2,-2]]) {
    const tx = e.x + dx, ty = e.y + dy
    if (map[ty]?.[tx] && isWalkable(map[ty][tx].tile, map[ty][tx])) { e.anchorX = tx; e.anchorY = ty; break }
  }
  e.state = 'reposition'; e.stateTimer = 1.2
}

function endAttack(e) { e.state = 'idle'; e.attackCooldown = 1.2 + Math.random() * 0.6; e.stateTimer = 0 }
```

Now **replace** the placeholder tail comment block at the end of `updateDragonBoss`:

```js
  // (attack state machine added in Task 2 — for now just settle to idle)
  e.neckRear  = approach(e.neckRear, 0, 3 * delta)
  e.tailSwing = approach(e.tailSwing, 0, 4 * delta)
  e.headAim   = approach(e.headAim, 0, 3 * delta)
```

with the full machine:

```js
  e.stateTimer     = Math.max(0, e.stateTimer - delta)
  e.attackCooldown = Math.max(0, e.attackCooldown - delta)
  e.repositionTimer -= delta

  switch (e.state) {
    case 'idle':
      e.neckRear  = approach(e.neckRear, 0, 3 * delta)
      e.tailSwing = approach(e.tailSwing, 0, 4 * delta)
      e.headAim   = approach(e.headAim, 0, 3 * delta)
      if (e.repositionTimer <= 0) { startReposition(e, state); break }
      if (e.attackCooldown <= 0) {
        if (dist <= TAIL_REACH)        { e.state = 'tail_windup';  e.stateTimer = 0.4 }
        else if (Math.random() < 0.6)  { e.state = 'sweep_windup'; e.stateTimer = 0.6 }
        else                           { e.state = 'cone';         e.stateTimer = 0.7 }
      }
      break

    case 'cone':
      coneDamage(e, state, e.facing, delta)
      if (e.stateTimer <= 0) endAttack(e)
      break

    case 'sweep_windup':
      e.neckRear = approach(e.neckRear, 1, 2 * delta)
      if (e.stateTimer <= 0) { e.state = 'sweep'; e.stateTimer = 1.5; e.headAim = -SWEEP_ARC }
      break

    case 'sweep': {
      const k = 1 - e.stateTimer / 1.5
      e.headAim = -SWEEP_ARC + 2 * SWEEP_ARC * k
      coneDamage(e, state, e.facing + e.headAim, delta)
      if (e.stateTimer <= 0) { e.neckRear = 0; endAttack(e) }
      break
    }

    case 'tail_windup':
      e.tailSwing = approach(e.tailSwing, -0.6, 4 * delta)
      if (e.stateTimer <= 0) { e.state = 'tail'; e.stateTimer = 0.45; e.dmgAcc = 0 }
      break

    case 'tail': {
      const k = 1 - e.stateTimer / 0.45
      e.tailSwing = -0.6 + 1.6 * k
      if (k > 0.3 && k < 0.8 && e.dmgAcc === 0 && dist <= TAIL_REACH) {
        player.hp -= TAIL_DMG; e.dmgAcc = 1
        knockback(e, player, state.map)
        state.log = [...state.log, `Tail sweep! (-${TAIL_DMG})`].slice(-5)
      }
      if (e.stateTimer <= 0) { e.tailSwing = 0; endAttack(e) }
      break
    }

    case 'reposition': {
      const ax = e.anchorX * TILE + TILE / 2, ay = e.anchorY * TILE + TILE / 2
      const dx = ax - e.px, dy = ay - e.py, dd = Math.hypot(dx, dy)
      if (dd > 2) { const sp = 60 * delta; e.px += (dx / dd) * Math.min(sp, dd); e.py += (dy / dd) * Math.min(sp, dd); e.x = Math.floor(e.px / TILE); e.y = Math.floor(e.py / TILE) }
      if (e.stateTimer <= 0 || dd <= 2) { e.state = 'idle'; e.repositionTimer = REPOSITION_EVERY; e.attackCooldown = 1.0 }
      break
    }
  }
```

(The `dist` and `target` lines and the contact-damage block above this stay as written in Task 1.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: all pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/dragonboss.js test/dragonboss.test.js
git commit -m "feat: dragon boss attack state machine (cone, sweep, tail, reposition)"
```

---

### Task 3: Level data — depth 10 arena, theme, config; move treasure

**Files:**
- Modify: `renderer/data/levels.js`
- Modify: `renderer/systems/map.js`
- Test: `test/map.test.js`

- [ ] **Step 1: Write a failing map test** — append to `test/map.test.js`:

```js
import { generateLevel } from '../renderer/systems/map.js'
import { FINAL_DEPTH } from '../renderer/data/levels.js'
import { TILE as MTILE } from '../renderer/systems/entities.js'

describe('depth 10 boss arena', () => {
  it('FINAL_DEPTH is 10', () => { assert.equal(FINAL_DEPTH, 10) })

  it('spawns a dragon_boss and a treasure tile on depth 10', () => {
    let foundBoss = false, foundTreasure = false
    for (let attempt = 0; attempt < 5 && !(foundBoss && foundTreasure); attempt++) {
      const { map, entitySpawns } = generateLevel(10)
      if (entitySpawns.some(s => s.kind === 'dragon_boss')) foundBoss = true
      if (map.some(row => row.some(t => t.tile === MTILE.TREASURE))) foundTreasure = true
    }
    assert.ok(foundBoss, 'depth 10 should spawn a dragon_boss')
    assert.ok(foundTreasure, 'depth 10 should place a treasure tile')
  })
})
```

(First read the existing import lines at the top of `test/map.test.js`; only add imports that aren't already present — e.g. `generateLevel`, `assert`, `describe`, `it` may already be imported. The `TILE as MTILE` alias avoids colliding with any existing `TILE` import.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep -iE "FINAL_DEPTH is 10|dragon_boss|boss arena" | head`
Expected: FAIL — FINAL_DEPTH is 9 and no `dragon_boss` spawn exists.

- [ ] **Step 3a: Edit `renderer/data/levels.js` — bump FINAL_DEPTH:**

```js
export const FINAL_DEPTH = 10
```

- [ ] **Step 3b: Remove the depth-9 treasure** from the `DRAGON_LAIR` template. Its center rows currently are:

```js
      '##.....D...............#',
      '##...C...X...C.........#',
      '##.....T...............#',
```

Change the `T` (treasure) to floor `.` — leave the `D` (dragon) and `X` (snare) as-is:

```js
      '##.....D...............#',
      '##...C...X...C.........#',
      '##.....................#',
```

- [ ] **Step 3c: Add the `GREAT_LAIR` template** to the `TEMPLATES` object in `levels.js` (a 26×16 open chamber; `B` = boss near back-centre, `T` = treasure behind it):

```js
  GREAT_LAIR: {
    tiles: [
      '##########################',
      '##......................##',
      '#........................#',
      '#..........TT............#',
      '#..........BB............#',
      '#..........BB............#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '##......................##',
      '##########################',
    ],
    width: 26, height: 16,
  },
```

- [ ] **Step 3d: Add the depth-10 `LEVEL_CONFIG` entry.** Append to the `LEVEL_CONFIG` array (after the depth-9 row):

```js
  { depth: 10, staircaseWidth: 1, guardCount:  3, monsterDensity: 0.004, trapDensity: 0.05, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.01, landmark: 'GREAT_LAIR', weapons: ['longsword', 'axe'] },
```

- [ ] **Step 3e: Add a depth-10 theme.** In `DEPTH_THEMES`, add `10` to the deepest theme's `depths` OR add a dedicated climax theme. Use a dedicated one — append this object to the `DEPTH_THEMES` array:

```js
  {
    depths: [10],
    floorTile: 'floor',
    bgColor:  '#0a0406',
    tint:     'rgba(60,10,0,0.35)',
    fogAlpha: 0.80,
    props: {
      room: ['prop_gravestone', 'prop_grave'],
    },
  },
```

- [ ] **Step 3f: Teach `placeTemplate` the `B` marker.** In `renderer/systems/map.js`, inside `placeTemplate`, add a branch alongside the existing `D` handling (after the `else if (ch === 'D') { ... }` block):

```js
      } else if (ch === 'B') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'dragon_boss', x: tx, y: ty })
```

Note: the template paints four `B` cells (a 2×2 anchor block); that yields up to four `dragon_boss` spawns. To spawn exactly one, only emit on the first `B` seen. Implement by guarding with a flag at the top of `placeTemplate` (just after `const spawns = []`):

```js
  let bossPlaced = false
```

and make the `B` branch:

```js
      } else if (ch === 'B') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        if (!bossPlaced) { spawns.push({ kind: 'dragon_boss', x: tx, y: ty }); bossPlaced = true }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: all pass, 0 fail (the depth-10 test now finds a boss + treasure; existing map tests still pass).

- [ ] **Step 5: Commit**

```bash
git add renderer/data/levels.js renderer/systems/map.js test/map.test.js
git commit -m "feat: depth 10 boss arena (GREAT_LAIR), theme, config; move treasure"
```

---

### Task 4: Render the articulated boss — `dragonboss.js` draw module + canvas branch

**Files:**
- Create: `renderer/render/dragonboss.js`
- Modify: `renderer/render/canvas.js`

No unit test (canvas rendering verified by running the game). Each step is a concrete edit.

> **Note (deviation from spec):** The spec suggested generalizing `canvas.js`'s `drawDragonBreath` so both dragons share one cone renderer. Instead, the boss module draws its **own** self-contained `flameCone` (below). This keeps the boss render module decoupled (it never reaches into `canvas.js` internals) and leaves the existing depth-9 dragon's `drawDragonBreath` completely untouched. The fiery-cone visual is equivalent.

- [ ] **Step 1: Create `renderer/render/dragonboss.js`** — the procedural rig, ported from the approved mockups, drawn in a local frame (body centre at origin) and driven by entity animation state. `S` = tile size (32):

```js
// Procedural articulated dragon-boss renderer. Drawn around the boss's screen
// position, rotated by e.facing so the head points at the player. All sub-parts
// are local to the body centre (0,0); +y is "back" (toward the tail).

// Locked scale-layout (from the brainstorming tuner)
const L = { size:0.9, aspect:1.45, rowSpace:0.36, colSpace:0.5, bow:0.6, bowExp:1.4,
            rotFollow:0.6, spineBias:0.16, jitter:0.42, peak:0.04, round:0.16 }

// body half-width profile: [yFrac (-0.5 front .. 0.5 back), halfWidthFrac of bw]
const STATIONS = [[-0.50,0.30],[-0.40,0.42],[-0.30,0.52],[-0.12,0.50],[0.06,0.47],
                  [0.22,0.52],[0.34,0.44],[0.46,0.26],[0.50,0.16]]

function widthAt(yf, bw) {
  for (let i = 1; i < STATIONS.length; i++) {
    if (yf <= STATIONS[i][0]) {
      const [y0,w0] = STATIONS[i-1], [y1,w1] = STATIONS[i]
      const k = (yf - y0) / (y1 - y0)
      return (w0 + (w1 - w0) * k) * bw
    }
  }
  return STATIONS[STATIONS.length - 1][1] * bw
}
function bodyPath(ctx, bw, bh) {
  const pts = STATIONS.map(([yf,wf]) => [yf*bh, wf*bw])
  ctx.beginPath(); ctx.moveTo(pts[0][1], pts[0][0])
  for (let i = 1; i < pts.length; i++) { const [y,w] = pts[i], [py,pw] = pts[i-1]; ctx.quadraticCurveTo(pw, (py+y)/2, w, y) }
  for (let i = pts.length-2; i >= 0; i--) { const [y,w] = pts[i], [py,pw] = pts[i+1]; ctx.quadraticCurveTo(-pw, (py+y)/2, -w, y) }
  ctx.closePath()
}
function hash(i, j) { const s = Math.sin(i*12.9898 + j*78.233) * 43758.5453; return s - Math.floor(s) }

function shieldScale(ctx, w, h, top, bot) {
  const tl=-w/2, tr=w/2, ty=-h/2, by=h/2, tp=h*L.peak
  ctx.beginPath()
  ctx.moveTo(tl, ty+tp); ctx.lineTo(0, ty); ctx.lineTo(tr, ty+tp)
  ctx.quadraticCurveTo(tr, h*L.round, 0, by)
  ctx.quadraticCurveTo(tl, h*L.round, tl, ty+tp)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, ty, 0, by); g.addColorStop(0, top); g.addColorStop(1, bot)
  ctx.fillStyle = g; ctx.fill()
  ctx.strokeStyle = 'rgba(28,8,5,0.6)'; ctx.lineWidth = 1; ctx.stroke()
}
function scaleBody(ctx, bw, bh, S) {
  const sw0 = S*L.size, sh0 = S*L.size*L.aspect
  const stepY = sh0*L.rowSpace, stepX = sw0*L.colSpace, bowPx = S*L.bow
  ctx.save(); bodyPath(ctx, bw, bh); ctx.clip()
  ctx.fillStyle = '#3a120d'; ctx.fillRect(-bw, -bh, bw*2, bh*2)
  const rows = []; for (let y = -bh*0.5; y <= bh*0.5; y += stepY) rows.push(y)
  for (let ri = rows.length-1; ri >= 0; ri--) {
    const y = rows[ri], yf = y/bh, hw = widthAt(yf, bw), front = 1 - (yf + 0.5)
    const top = `rgb(${78+front*30|0},${24+front*14|0},${18+front*8|0})`
    const bot = `rgb(${170+front*55|0},${62+front*28|0},${48+front*16|0})`
    const off = (ri % 2) * stepX * 0.5
    let col = 0
    for (let x = -hw + off; x <= hw; x += stepX, col++) {
      const nx = hw > 0 ? x/hw : 0
      const yc = y - bowPx * Math.pow(Math.abs(nx), L.bowExp)          // upward-opening parabola
      const slope = (-L.bowExp * bowPx * Math.pow(Math.abs(nx), L.bowExp-1) * Math.sign(nx)) / (hw || 1)
      const rot = Math.atan(slope) * L.rotFollow
      const sizeF = (1 - L.spineBias*Math.abs(nx)) * (1 - L.jitter*0.5 + L.jitter*hash(ri, col))
      ctx.save(); ctx.translate(x, yc); ctx.rotate(rot)
      shieldScale(ctx, sw0*sizeF, sh0*sizeF, top, bot)
      ctx.restore()
    }
  }
  ctx.restore()
  bodyPath(ctx, bw, bh); ctx.strokeStyle = 'rgba(255,140,90,0.5)'; ctx.lineWidth = 2; ctx.stroke()
}
function chain(ctx, x, y, startAng, segs, segLen, wFn, color, bendFn) {
  let px = x, py = y, ang = startAng
  for (let i = 0; i < segs; i++) {
    ang += bendFn(i)
    const nx = px + Math.cos(ang)*segLen, ny = py + Math.sin(ang)*segLen
    ctx.strokeStyle = color; ctx.lineWidth = wFn(i); ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke()
    px = nx; py = ny
  }
  return { x: px, y: py, ang }
}
function wing(ctx, sx, sy, s, t, S) {
  const flap = Math.sin(t*1.5)*0.10 + 0.18
  ctx.save(); ctx.translate(sx, sy); ctx.scale(s, 1); ctx.rotate(-flap)
  const fingers = [{a:-0.55,l:S*2.9},{a:-0.15,l:S*3.2},{a:0.30,l:S*3.0},{a:0.75,l:S*2.4}]
  const tips = fingers.map(f => [Math.cos(f.a)*f.l, Math.sin(f.a)*f.l])
  ctx.fillStyle = 'rgba(110,30,24,0.8)'
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tips[0][0], tips[0][1])
  for (let i = 0; i < tips.length-1; i++) { const a = tips[i], b = tips[i+1]; ctx.quadraticCurveTo((a[0]+b[0])/2, (a[1]+b[1])/2 + S*0.5, b[0], b[1]) }
  ctx.lineTo(S*0.6, S*0.4); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = '#7c241b'; ctx.lineWidth = 3; ctx.lineCap = 'round'
  for (const tp of tips) { ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tp[0], tp[1]); ctx.stroke() }
  ctx.strokeStyle = '#9c2e24'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tips[0][0], tips[0][1]); ctx.stroke()
  ctx.restore()
}
function leg(ctx, bx, by, s, reach, t, S) {
  const sw = Math.sin(t*2.0)*0.06*s
  ctx.save(); ctx.translate(bx, by); ctx.rotate(sw)
  ctx.fillStyle = '#7a241b'; ctx.beginPath(); ctx.ellipse(s*reach, 0, S*0.9, S*0.55, s*0.5, 0, 7); ctx.fill()
  ctx.strokeStyle = '#e8c08a'; ctx.lineWidth = 2; ctx.lineCap = 'round'
  for (let c = -1; c <= 1; c++) { ctx.beginPath(); ctx.moveTo(s*reach*1.3, c*5); ctx.lineTo(s*reach*1.7, c*7); ctx.stroke() }
  ctx.restore()
}
function flameCone(ctx, x, y, ang, S) {
  const len = S*5.2, half = 0.34
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang)
  const g = ctx.createLinearGradient(0, 0, len, 0)
  g.addColorStop(0, '#ffe08a'); g.addColorStop(0.5, '#ff7a2a'); g.addColorStop(1, 'rgba(200,40,0,0.05)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len, -Math.tan(half)*len); ctx.lineTo(len, Math.tan(half)*len); ctx.closePath(); ctx.fill()
  ctx.restore()
}

export function drawDragonBoss(ctx, e, camX, camY, S) {
  const ox = Math.round(e.px - camX), oy = Math.round(e.py - camY)
  const t = e.breathTime ?? 0
  const breath = 0.5 + 0.5*Math.sin(t*1.4)
  const bw = 3*S*(1 + breath*0.02), bh = 4*S*(1 + breath*0.02)

  ctx.save()
  ctx.translate(ox, oy)
  ctx.rotate((e.facing ?? 0) + Math.PI/2)        // local "up" (head, -y) -> facing direction

  const shoulderY = -bh*0.22
  wing(ctx, -bw*0.12, shoulderY, -1, t, S); wing(ctx, bw*0.12, shoulderY, 1, t, S)
  leg(ctx, -bw*0.42, -bh*0.18, -1, S*0.7, t, S);   leg(ctx, bw*0.42, -bh*0.18, 1, S*0.7, t, S)
  leg(ctx, -bw*0.40,  bh*0.20, -1, S*0.8, t+1, S); leg(ctx, bw*0.40,  bh*0.20, 1, S*0.8, t+1, S)

  const sweep = (e.tailSwing ?? 0)
  chain(ctx, 0, bh*0.48, Math.PI/2, 6, S*0.85, i => (6-i)/6*S*1.1 + 3, '#9c2e24',
        i => Math.sin(t*2.2 - i*0.7)*0.18 + sweep*(i+1)/6*0.5)

  scaleBody(ctx, bw, bh, S)

  ctx.fillStyle = '#e8c08a'
  for (let y = -bh*0.36; y < bh*0.40; y += S*0.62) {
    const h = S*0.5*(1 - Math.abs(y/bh)*0.6)
    ctx.beginPath(); ctx.moveTo(-h*0.5, y); ctx.lineTo(0, y - h*1.4); ctx.lineTo(h*0.5, y); ctx.closePath(); ctx.fill()
  }

  const rear = e.neckRear ?? 0
  const aim = (e.state === 'sweep') ? (e.headAim ?? 0) : 0
  const tip = chain(ctx, 0, -bh*0.48, -Math.PI/2, 5, S*0.72, i => S*0.85 - i*S*0.06, '#a82f25',
    i => {
      const idle = Math.sin(t*0.9 - i*0.6)*0.22
      const rearBend = rear * (i < 2 ? 0.55 : -0.65)
      const aimBend = (i === 4 ? aim*0.9 : aim*0.15)
      return idle*(1 - rear*0.6) + rearBend + aimBend
    })

  if (e.state === 'cone' || e.state === 'sweep') flameCone(ctx, tip.x, tip.y, tip.ang, S)

  ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(tip.ang + Math.PI/2)
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.ellipse(0, -S*0.2, S*0.8, S*0.7, 0, 0, 7); ctx.fill()
  ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 2; ctx.stroke()
  ctx.strokeStyle = '#e8c08a'; ctx.lineWidth = 3
  for (const s of [-1,1]) { ctx.beginPath(); ctx.moveTo(s*S*0.5, -S*0.6); ctx.lineTo(s*S*0.9, -S*1.2); ctx.stroke() }
  ctx.fillStyle = '#ffd23a'; for (const s of [-1,1]) { ctx.beginPath(); ctx.arc(s*S*0.35, -S*0.2, 3, 0, 7); ctx.fill() }
  ctx.restore()

  ctx.restore()
}
```

- [ ] **Step 2: Wire it into `canvas.js`.** At the top of `renderer/render/canvas.js`, add the import after the existing imports:

```js
import { drawDragonBoss } from './dragonboss.js'
```

- [ ] **Step 3: Add the draw branch.** In `drawEntity`, add a branch (place it right after the existing `if (entity.type === 'dragon') { ... }` block). Note `drawEntity` doesn't currently receive the camera, so pass it through from the call site — change the boss branch to use module-scope values via a thin wrapper: instead, handle the boss in the `render()` entity loop where `camX/camY` are in scope. Concretely, in `render()`, the entity loop computes `epx/epy` then calls `drawEntity(...)`. Replace the per-entity draw line:

```js
      drawEntity(ctx, e, epx, epy, S, sprites)
```

with:

```js
      if (e.type === 'dragon_boss') drawDragonBoss(ctx, e, camX, camY, S)
      else drawEntity(ctx, e, epx, epy, S, sprites)
```

(`camX, camY, S` are already destructured at the top of `render()`.)

- [ ] **Step 4: Sanity-check syntax**

Run: `node --check renderer/render/dragonboss.js && node --check renderer/render/canvas.js`
Expected: no output, exit 0.

Run: `npm test 2>&1 | tail -6`
Expected: existing suite still passes (no canvas tests, but nothing broke).

- [ ] **Step 5: Commit**

```bash
git add renderer/render/dragonboss.js renderer/render/canvas.js
git commit -m "feat: render articulated dragon boss (scaled body, neck, tail, wings)"
```

---

### Task 5: Wire the boss into the game loop — `game.js`

**Files:**
- Modify: `renderer/game.js`

- [ ] **Step 1: Import the boss module.** Add after the crab import (line ~5):

```js
import { makeDragonBoss, updateDragonBoss } from './systems/dragonboss.js'
```

- [ ] **Step 2: Spawn handling.** In `buildEntities`, add a case alongside the other large enemies (near the `cyclops`/`wizard`/`crab` cases):

```js
      case 'dragon_boss': return [{ ...makeDragonBoss(s.x, s.y), px: cx, py: cy }]
```

- [ ] **Step 3: Treat it as an enemy.** In `isEnemy`, add `'dragon_boss'`:

```js
function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss'
}
```

- [ ] **Step 4: AI dispatch.** In the enemy AI loop, add an early dispatch next to the cyclops/wizard/crab ones:

```js
    if (e.type === 'dragon_boss') { updateDragonBoss(e, state, delta); continue }
```

- [ ] **Step 5: Larger melee/projectile hit radius vs the boss.** The melee uses `meleeHit(...)` on `e.px - player.px`; the boss body is large, so a hit anywhere near the body should count. In the melee block, the check is `if (!meleeHit(atk.style, fa, e.px - player.px, e.py - player.py)) return e`. Replace it so the boss is hit when the player is adjacent to its large body:

```js
        if (e.type === 'dragon_boss') {
          if (Math.hypot(e.px - player.px, e.py - player.py) > 2.2 * TILE_SIZE) return e
        } else if (!meleeHit(atk.style, fa, e.px - player.px, e.py - player.py)) {
          return e
        }
```

And for projectiles, the collision check `if (Math.hypot(e.px - p.px, e.py - p.py) < 8)` is too tight for the big body — widen it for the boss:

```js
        const hitR = e.type === 'dragon_boss' ? 1.6 * TILE_SIZE : 8
        if (Math.hypot(e.px - p.px, e.py - p.py) < hitR) {
```

- [ ] **Step 6: Final-depth literal.** In `startNewRun`, the run object hardcodes `deepestLevel: 9`. Change it to start from depth 1 (it's `Math.max`'d on descent anyway):

```js
    run: { deepestLevel: 1, won: false },
```

- [ ] **Step 7: Sanity-check + full test run**

Run: `node --check renderer/game.js`
Expected: exit 0.

Run: `npm test 2>&1 | tail -6`
Expected: all suites pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add renderer/game.js
git commit -m "feat: wire dragon boss into spawning, AI loop, combat, final depth"
```

---

### Task 6: Manual visual verification

**Files:** none (run the app).

- [ ] **Step 1: Launch** — `npm start`. To reach depth 10 quickly for testing, descend through stairs (or temporarily start at a deeper level if a debug shortcut exists — otherwise play down).

- [ ] **Step 2: Verify, then close the window:**
  - On **depth 10** a large articulated dragon is drawn from shield scales, with bendy neck, segmented tail, paneled wings, dorsal spikes, legs — matching the locked look. It **rotates to face the player**.
  - **Sweeping breath:** the neck rears (telegraph) then a fire cone fires from the head and sweeps across an arc; standing in it costs HP.
  - **Fixed cone:** a straight fire cone at range.
  - **Tail sweep** when you're close: the tail whips and you take burst damage + get knocked back.
  - Occasionally the dragon **repositions** to a new anchor and re-faces.
  - Killing it (28 HP) is possible; the **treasure sits behind it**, and grabbing it (press `X`) wins the run.
  - **Depth 9 is unchanged** — the original small dragon, no treasure/win there anymore.

- [ ] **Step 3 (optional): tune** — adjust constants in `dragonboss.js` (HP, `TURN_RATE`, `SWEEP_ARC`, `TAIL_REACH`, damage) and re-run. Commit if changed.

---

## Notes for the implementer

- The game is **real-time** with continuous `px/py`. The boss is anchored: it does not chase; `updateDragonBoss` only repositions in short bursts.
- `dragonboss.js` (systems) is pure logic and fully unit-tested; `dragonboss.js` (render) is verified by running the game.
- The render module is a faithful port of the brainstorming mockups (`.superpowers/brainstorm/.../dragon-scalebody-v7.html` for the body, `dragon-articulated-v2.html` for neck/wings/tail), adapted to draw in a local frame (body centre at origin) and to read entity state instead of mockup timers. If a part looks off, those mockup files are the visual source of truth.
- Keep the existing `dragon` (depth 9) code untouched throughout.
```
