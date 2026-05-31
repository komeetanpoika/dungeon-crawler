# New Enemies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cyclops (level 6 boss, 2×2, three-phase attack), evil wizard (levels 3–5, spell rotation + summoning), and crab (levels 2–4, armored front + pincer grab) as separate behavior modules.

**Architecture:** Each enemy lives in its own file (`renderer/systems/cyclops.js`, `wizard.js`, `crab.js`) exporting a factory + update function. `game.js` dispatches to each in the enemy AI loop. `canvas.js` draws effects. Level gen gets wizard/crab counts and a level-6 cyclops arena carve-out.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron, Node built-in test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/render/sprites.js` | Add cyclops, wizard, crab sprite entries |
| `renderer/systems/cyclops.js` | New: `makeCyclops`, `updateCyclops` |
| `renderer/systems/wizard.js` | New: `makeWizard`, `updateWizard` |
| `renderer/systems/crab.js` | New: `makeCrab`, `updateCrab`, `deflects` |
| `test/cyclops.test.js` | New: factory + state-machine tests |
| `test/wizard.test.js` | New: factory + spell/summon tests |
| `test/crab.test.js` | New: factory + deflect + grab tests |
| `renderer/data/levels.js` | Add `wizardCount`, `crabCount`, `cyclopsArena` to LEVEL_CONFIG |
| `renderer/systems/map.js` | Add arena carve-out + wizard/crab spawn logic to `generateLevel` |
| `renderer/game.js` | Extend `isEnemy`; snapshot loop; extend `buildEntities`; wizard shield + crab deflect in projectile loop; player grab flag; call update fns |
| `renderer/render/canvas.js` | 2×2 cyclops draw + shake/stun; slam ring; wizard shield glow; crab draw; player grab tint |

---

## Task 1: Add sprites

**Files:**
- Modify: `renderer/render/sprites.js`

- [ ] **Step 1: Add three sprite entries**

In `renderer/render/sprites.js`, add inside the `SPRITES` object after `monster_boss`:

```js
  cyclops: 'tile_0109',
  wizard:  'tile_0111',
  crab:    'tile_0110',
```

- [ ] **Step 2: Verify sprites load**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all 26 tests pass (no regressions).

- [ ] **Step 3: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/sprites.js && git commit -m "feat: add cyclops, wizard, crab sprite entries"
```

---

## Task 2: Cyclops module

**Files:**
- Create: `renderer/systems/cyclops.js`
- Create: `test/cyclops.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/cyclops.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeCyclops, updateCyclops } from '../renderer/systems/cyclops.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const S = 32

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(cyclops, player) {
  return { player, map: openMap(), projectiles: [], entities: [cyclops], log: [] }
}

describe('makeCyclops', () => {
  it('has correct initial fields', () => {
    const c = makeCyclops(5, 5)
    assert.equal(c.type, 'cyclops')
    assert.equal(c.hp, 30)
    assert.equal(c.maxHp, 30)
    assert.equal(c.state, 'chase')
    assert.equal(c.chargeCooldown, 0)
    assert.equal(c.slamRing, null)
    assert.equal(typeof c.slamTimer, 'number')
    assert.ok(c.slamTimer > 0)
  })
})

describe('updateCyclops — state transitions', () => {
  it('enters charge_windup when player within 200px with LOS and chargeCooldown is 0', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.slamTimer = 99
    const player = { x: 7, y: 5, px: 7 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.016)
    assert.equal(c.state, 'charge_windup')
  })

  it('transitions from charge_windup to charging when stateTimer expires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.state = 'charge_windup'
    c.stateTimer = 0.01
    const player = { x: 7, y: 5, px: 7 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'charging')
    assert.ok(c.chargeAngle !== undefined)
  })

  it('resets chargeCooldown to 8 and returns to chase when stunned timer expires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.state = 'stunned'
    c.stateTimer = 0.01
    c.chargeCooldown = 0
    const player = { x: 12, y: 5, px: 12 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'chase')
    assert.equal(c.chargeCooldown, 8)
  })

  it('enters slam_windup when slamTimer expires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.slamTimer = 0.01
    c.chargeCooldown = 99  // prevent charge from winning
    const player = { x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'slam_windup')
  })

  it('creates slamRing and damages player in range when slam fires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.state = 'slam_windup'
    c.stateTimer = 0.01
    const player = { x: 6, y: 5, px: 6 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'slamming')
    assert.ok(c.slamRing !== null)
    assert.ok(state.player.hp < 10)
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/cyclops.test.js 2>&1 | tail -6
```

Expected: FAIL — `cyclops.js` does not exist yet.

- [ ] **Step 3: Create `renderer/systems/cyclops.js`**

```js
import { hasLineOfSight, isWalkable } from './entities.js'

const S = 32
const CYCLOPS_SPEED        = 40
const CYCLOPS_CHARGE_SPEED = 300
const CYCLOPS_HALF         = 28
const CHARGE_WINDUP        = 1.5
const CHARGE_DURATION      = 3.0
const CHARGE_COOLDOWN      = 8
const SLAM_WINDUP          = 1.0
const SLAM_RING_DURATION   = 0.4
const SLAM_RADIUS          = 80
const SLAM_DAMAGE          = 4
const CONTACT_RANGE        = 40
const CONTACT_DAMAGE       = 3
const CONTACT_COOLDOWN     = 0.8
const KNOCKBACK_DIST       = 60

function canMoveTo(map, px, py) {
  return [
    [px - CYCLOPS_HALF, py - CYCLOPS_HALF],
    [px + CYCLOPS_HALF, py - CYCLOPS_HALF],
    [px - CYCLOPS_HALF, py + CYCLOPS_HALF],
    [px + CYCLOPS_HALF, py + CYCLOPS_HALF],
  ].every(([cx, cy]) => {
    const tile = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return tile && isWalkable(tile.tile)
  })
}

export function makeCyclops(x, y) {
  return {
    type: 'cyclops', x, y,
    hp: 30, maxHp: 30, inCombat: false,
    state: 'chase', stateTimer: 0,
    chargeAngle: 0,
    chargeCooldown: 0,
    slamTimer: 5 + Math.random() * 3,
    slamRing: null,
    damageCooldown: 0,
  }
}

export function updateCyclops(e, state, delta) {
  const { player, map } = state
  const dist = Math.hypot(e.px - player.px, e.py - player.py)

  e.damageCooldown = Math.max(0, e.damageCooldown - delta)
  e.chargeCooldown = Math.max(0, e.chargeCooldown - delta)
  e.stateTimer     = Math.max(0, e.stateTimer     - delta)

  if (e.state === 'chase') {
    e.slamTimer = Math.max(0, e.slamTimer - delta)

    // Move toward player
    if (dist > CONTACT_RANGE) {
      const len = dist || 1
      const mx = (player.px - e.px) / len * CYCLOPS_SPEED * delta
      const my = (player.py - e.py) / len * CYCLOPS_SPEED * delta
      if (canMoveTo(map, e.px + mx, e.py)) e.px += mx
      if (canMoveTo(map, e.px, e.py + my)) e.py += my
      e.x = Math.floor(e.px / S)
      e.y = Math.floor(e.py / S)
    }

    // Charge takes priority over slam
    if (e.chargeCooldown <= 0 && dist < 200 && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
      e.state = 'charge_windup'
      e.stateTimer = CHARGE_WINDUP
    } else if (e.slamTimer <= 0) {
      e.state = 'slam_windup'
      e.stateTimer = SLAM_WINDUP
    }

    // Contact damage
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      player.hp -= CONTACT_DAMAGE
      e.damageCooldown = CONTACT_COOLDOWN
      e.inCombat = true
      state.log = [...state.log, `Cyclops hits! (-${CONTACT_DAMAGE} HP)`].slice(-5)
    }

  } else if (e.state === 'charge_windup') {
    if (e.stateTimer <= 0) {
      e.chargeAngle = Math.atan2(player.py - e.py, player.px - e.px)
      e.state = 'charging'
      e.stateTimer = CHARGE_DURATION
    }

  } else if (e.state === 'charging') {
    const cdx = Math.cos(e.chargeAngle) * CYCLOPS_CHARGE_SPEED * delta
    const cdy = Math.sin(e.chargeAngle) * CYCLOPS_CHARGE_SPEED * delta

    if (!canMoveTo(map, e.px + cdx, e.py + cdy)) {
      e.state = 'stunned'
      e.stateTimer = 2.5
    } else {
      if (canMoveTo(map, e.px + cdx, e.py)) e.px += cdx
      if (canMoveTo(map, e.px, e.py + cdy)) e.py += cdy
      e.x = Math.floor(e.px / S)
      e.y = Math.floor(e.py / S)

      if (Math.hypot(e.px - player.px, e.py - player.py) < 50) {
        player.hp -= 5
        const a = Math.atan2(player.py - e.py, player.px - e.px)
        player.px += Math.cos(a) * KNOCKBACK_DIST
        player.py += Math.sin(a) * KNOCKBACK_DIST
        e.inCombat = true
        state.log = [...state.log, 'Cyclops charges! (-5 HP)'].slice(-5)
        e.state = 'stunned'
        e.stateTimer = 0.5
      }
    }

    if (e.state === 'charging' && e.stateTimer <= 0) {
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }

  } else if (e.state === 'stunned') {
    if (e.stateTimer <= 0) {
      e.chargeCooldown = CHARGE_COOLDOWN
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }

  } else if (e.state === 'slam_windup') {
    if (e.stateTimer <= 0) {
      e.state = 'slamming'
      e.stateTimer = SLAM_RING_DURATION
      e.slamRing = { radius: 0, maxRadius: SLAM_RADIUS }
      if (dist < SLAM_RADIUS) {
        player.hp -= SLAM_DAMAGE
        e.inCombat = true
        state.log = [...state.log, `Ground slam! (-${SLAM_DAMAGE} HP)`].slice(-5)
      }
    }

  } else if (e.state === 'slamming') {
    if (e.slamRing) e.slamRing.radius = SLAM_RADIUS * (1 - e.stateTimer / SLAM_RING_DURATION)
    if (e.stateTimer <= 0) {
      e.slamRing = null
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/cyclops.test.js
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Run full suite — no regressions**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/cyclops.js test/cyclops.test.js && git commit -m "feat: cyclops enemy module — 6-state machine with charge, ground slam, contact damage"
```

---

## Task 3: Wizard module

**Files:**
- Create: `renderer/systems/wizard.js`
- Create: `test/wizard.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/wizard.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeWizard, updateWizard } from '../renderer/systems/wizard.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const S = 32

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(wizard, player) {
  return { player, map: openMap(), projectiles: [], entities: [wizard], log: [] }
}

describe('makeWizard', () => {
  it('has correct initial fields', () => {
    const w = makeWizard(5, 5)
    assert.equal(w.type, 'wizard')
    assert.equal(w.hp, 12)
    assert.equal(w.maxHp, 12)
    assert.equal(w.spellIndex, 0)
    assert.equal(w.shieldTimer, 0)
    assert.equal(w.inCombat, false)
    assert.ok(typeof w.id === 'string' && w.id.startsWith('wizard_'))
  })
})

describe('updateWizard — spell rotation', () => {
  it('fires a single bolt at spell index 0 when in LOS with spellCooldown 0', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 0; w.spellIndex = 0
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.equal(state.projectiles.length, 1)
    assert.equal(state.projectiles[0].damage, 2)
    assert.equal(state.projectiles[0].friendly, false)
    assert.equal(state.projectiles[0].color, '#a855f7')
    assert.equal(w.spellIndex, 1)
  })

  it('fires 3 spread projectiles at spell index 2', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 0; w.spellIndex = 2
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.equal(state.projectiles.length, 3)
    assert.ok(state.projectiles.every(p => p.damage === 1 && p.color === '#a855f7'))
  })

  it('activates shield at spell index 3, resets index to 0, fires no projectile', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 0; w.spellIndex = 3
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.ok(w.shieldTimer > 0)
    assert.equal(w.spellIndex, 0)
    assert.equal(state.projectiles.length, 0)
  })

  it('does not cast when spellCooldown > 0', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 1.5; w.spellIndex = 0
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.equal(state.projectiles.length, 0)
  })
})

describe('updateWizard — summoning', () => {
  it('pushes at least one bat to state.entities when summonTimer expires', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.summonTimer = 0.01
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.02)
    const bats = state.entities.filter(e => e.summonedBy === w.id)
    assert.ok(bats.length >= 1)
    assert.ok(bats.every(b => b.type === 'monster' && b.variant === 'weak'))
  })

  it('does not summon beyond MAX_MINIONS cap', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.summonTimer = 0.01
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    // Pre-populate 4 minions
    const minions = Array.from({ length: 4 }, (_, i) => ({
      type: 'monster', variant: 'weak', hp: 1, maxHp: 1, summonedBy: w.id,
      x: 5, y: 5, px: (5 + i) * S, py: 5 * S,
    }))
    const state = { player, map: openMap(), projectiles: [], entities: [w, ...minions], log: [] }
    updateWizard(w, state, 0.02)
    const after = state.entities.filter(e => e.summonedBy === w.id)
    assert.equal(after.length, 4)  // cap not exceeded
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/wizard.test.js 2>&1 | tail -6
```

Expected: FAIL — `wizard.js` does not exist yet.

- [ ] **Step 3: Create `renderer/systems/wizard.js`**

```js
import { hasLineOfSight, isWalkable, makeMonster } from './entities.js'

const S = 32
const FLEE_SPEED    = 70
const STRAFE_SPEED  = 50
const FLEE_RANGE    = 120
const ENEMY_HALF    = 4
const BOLT_SPEED    = 300
const SPREAD_SPEED  = 200
const SPELL_COOLDOWN = 2.0
const SHIELD_DUR    = 3.0
const SUMMON_INTERVAL = 8.0
const MAX_MINIONS   = 4

function canMoveTo(map, px, py) {
  return [
    [px - ENEMY_HALF, py - ENEMY_HALF],
    [px + ENEMY_HALF, py - ENEMY_HALF],
    [px - ENEMY_HALF, py + ENEMY_HALF],
    [px + ENEMY_HALF, py + ENEMY_HALF],
  ].every(([cx, cy]) => {
    const tile = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return tile && isWalkable(tile.tile)
  })
}

export function makeWizard(x, y) {
  return {
    type: 'wizard', x, y,
    hp: 12, maxHp: 12, inCombat: false,
    spellIndex: 0, spellCooldown: SPELL_COOLDOWN,
    shieldTimer: 0,
    summonTimer: SUMMON_INTERVAL,
    damageCooldown: 0,
    id: 'wizard_' + Math.random().toString(36).slice(2),
  }
}

export function updateWizard(e, state, delta) {
  const { player, map } = state
  const dist = Math.hypot(e.px - player.px, e.py - player.py)

  e.spellCooldown = Math.max(0, e.spellCooldown - delta)
  e.shieldTimer   = Math.max(0, e.shieldTimer   - delta)
  e.summonTimer   = Math.max(0, e.summonTimer   - delta)

  // Kiting movement
  const toAngle = Math.atan2(player.py - e.py, player.px - e.px)
  if (dist < FLEE_RANGE) {
    const mx = -Math.cos(toAngle) * FLEE_SPEED * delta
    const my = -Math.sin(toAngle) * FLEE_SPEED * delta
    if (canMoveTo(map, e.px + mx, e.py)) e.px += mx
    if (canMoveTo(map, e.px, e.py + my)) e.py += my
  } else {
    const mx = -Math.sin(toAngle) * STRAFE_SPEED * delta
    const my =  Math.cos(toAngle) * STRAFE_SPEED * delta
    if (canMoveTo(map, e.px + mx, e.py)) e.px += mx
    if (canMoveTo(map, e.px, e.py + my)) e.py += my
  }
  e.x = Math.floor(e.px / S)
  e.y = Math.floor(e.py / S)

  // Spell rotation
  if (e.spellCooldown <= 0 && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
    e.inCombat = true
    if (e.spellIndex === 3) {
      e.shieldTimer = SHIELD_DUR
      e.spellIndex  = 0
      e.spellCooldown = SPELL_COOLDOWN
    } else if (e.spellIndex === 2) {
      for (const offset of [-Math.PI / 9, 0, Math.PI / 9]) {
        const a = toAngle + offset
        state.projectiles.push({
          px: e.px, py: e.py,
          dx: Math.cos(a) * SPREAD_SPEED, dy: Math.sin(a) * SPREAD_SPEED,
          damage: 1, friendly: false, color: '#a855f7',
        })
      }
      e.spellIndex++
      e.spellCooldown = SPELL_COOLDOWN
    } else {
      state.projectiles.push({
        px: e.px, py: e.py,
        dx: Math.cos(toAngle) * BOLT_SPEED, dy: Math.sin(toAngle) * BOLT_SPEED,
        damage: 2, friendly: false, color: '#a855f7',
      })
      e.spellIndex++
      e.spellCooldown = SPELL_COOLDOWN
    }
  }

  // Summoning
  if (e.summonTimer <= 0) {
    e.summonTimer = SUMMON_INTERVAL
    const minionCount = state.entities.filter(en => en.summonedBy === e.id).length
    if (minionCount < MAX_MINIONS) {
      const count = Math.min(1 + Math.floor(Math.random() * 2), MAX_MINIONS - minionCount)
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 40 + Math.random() * 20
        const sx = e.x + Math.round(Math.cos(a) * 2)
        const sy = e.y + Math.round(Math.sin(a) * 2)
        state.entities.push({
          ...makeMonster(sx, sy, 'weak'),
          px: e.px + Math.cos(a) * r, py: e.py + Math.sin(a) * r,
          facing: 'east',
          wanderTimer: 0, wanderDx: 0, wanderDy: 0, damageCooldown: 0,
          summonedBy: e.id,
        })
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/wizard.test.js
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/wizard.js test/wizard.test.js && git commit -m "feat: wizard enemy module — spell rotation (bolt/spread/shield) + bat summoning"
```

---

## Task 4: Crab module

**Files:**
- Create: `renderer/systems/crab.js`
- Create: `test/crab.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/crab.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeCrab, updateCrab, deflects } from '../renderer/systems/crab.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const S = 32

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(crab, player) {
  return { player, map: openMap(), projectiles: [], entities: [crab], log: [] }
}

describe('makeCrab', () => {
  it('has correct initial fields', () => {
    const c = makeCrab(5, 5)
    assert.equal(c.type, 'crab')
    assert.equal(c.hp, 20)
    assert.equal(c.maxHp, 20)
    assert.equal(c.grabState, null)
    assert.equal(c.grabCooldown, 0)
    assert.equal(typeof c.facing, 'number')
    assert.ok(c.strafeDir === 1 || c.strafeDir === -1)
  })
})

describe('deflects', () => {
  it('deflects a projectile coming from the front (within 60°)', () => {
    const c = makeCrab(5, 5)
    c.facing = 0  // facing east (toward player at east)
    // Player shoots westward (dx < 0) — hitting crab from the east side (front)
    const p = { dx: -200, dy: 0 }
    assert.equal(deflects(c, p), true)
  })

  it('does not deflect a projectile from the side', () => {
    const c = makeCrab(5, 5)
    c.facing = 0  // facing east
    // Projectile going northward — hits crab from south (side)
    const p = { dx: 0, dy: -200 }
    assert.equal(deflects(c, p), false)
  })

  it('does not deflect a projectile from behind', () => {
    const c = makeCrab(5, 5)
    c.facing = 0  // facing east
    // Projectile going eastward — hits crab from west (behind)
    const p = { dx: 200, dy: 0 }
    assert.equal(deflects(c, p), false)
  })
})

describe('updateCrab — grab', () => {
  it('enters grabbing state and sets player.grabbed when within grab range', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabCooldown = 0
    // Player very close
    const player = { x: 5, y: 5, px: 5 * S + 30, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCrab(c, state, 0.016)
    assert.equal(c.grabState, 'grabbing')
    assert.equal(state.player.grabbed, true)
  })

  it('releases player after grab duration expires', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabState = 'grabbing'
    c.grabTimer = 0.01
    c.grabDamageTimer = 99
    const player = { x: 5, y: 5, px: 5 * S + 20, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCrab(c, state, 0.02)
    assert.equal(c.grabState, null)
    assert.ok(c.grabCooldown > 0)
  })

  it('does not grab again while grabCooldown > 0', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabCooldown = 5
    const player = { x: 5, y: 5, px: 5 * S + 20, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCrab(c, state, 0.016)
    assert.equal(c.grabState, null)
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/crab.test.js 2>&1 | tail -6
```

Expected: FAIL — `crab.js` does not exist yet.

- [ ] **Step 3: Create `renderer/systems/crab.js`**

```js
import { isWalkable } from './entities.js'

const S = 32
const CRAB_SPEED       = 65
const CRAB_HALF        = 4
const CONTACT_DAMAGE   = 1
const CONTACT_COOLDOWN = 0.8
const CONTACT_RANGE    = 20
const GRAB_RANGE       = 25
const GRAB_DURATION    = 2.0
const GRAB_DMG_INTERVAL = 0.3
const GRAB_COOLDOWN    = 5.0
const FRONT_CONE       = Math.PI / 3  // 60°

function canMoveTo(map, px, py) {
  return [
    [px - CRAB_HALF, py - CRAB_HALF],
    [px + CRAB_HALF, py - CRAB_HALF],
    [px - CRAB_HALF, py + CRAB_HALF],
    [px + CRAB_HALF, py + CRAB_HALF],
  ].every(([cx, cy]) => {
    const tile = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return tile && isWalkable(tile.tile)
  })
}

function normalizeAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

// Returns true if a friendly projectile hits the crab's armored front.
export function deflects(crab, projectile) {
  // The incoming direction as seen FROM the crab: opposite of the projectile's travel
  const incomingAngle = Math.atan2(-projectile.dy, -projectile.dx)
  const diff = normalizeAngle(incomingAngle - crab.facing)
  return Math.abs(diff) < FRONT_CONE
}

export function makeCrab(x, y) {
  return {
    type: 'crab', x, y,
    hp: 20, maxHp: 20, inCombat: false,
    facing: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    strafeDirTimer: 2 + Math.random(),
    grabState: null,
    grabTimer: 0,
    grabDamageTimer: 0,
    grabCooldown: 0,
    damageCooldown: 0,
  }
}

export function updateCrab(e, state, delta) {
  const { player, map } = state
  const dist = Math.hypot(e.px - player.px, e.py - player.py)

  e.damageCooldown  = Math.max(0, e.damageCooldown  - delta)
  e.grabCooldown    = Math.max(0, e.grabCooldown    - delta)
  e.strafeDirTimer  = Math.max(0, e.strafeDirTimer  - delta)

  // Track player direction
  e.facing = Math.atan2(player.py - e.py, player.px - e.px)

  // Flip strafe direction periodically
  if (e.strafeDirTimer <= 0) {
    e.strafeDir = -e.strafeDir
    e.strafeDirTimer = 2 + Math.random()
  }

  // Grab update
  if (e.grabState === 'grabbing') {
    e.grabTimer       = Math.max(0, e.grabTimer       - delta)
    e.grabDamageTimer = Math.max(0, e.grabDamageTimer - delta)
    state.player.grabbed = true

    if (e.grabDamageTimer <= 0) {
      player.hp -= 1
      e.grabDamageTimer = GRAB_DMG_INTERVAL
      e.inCombat = true
      state.log = [...state.log, 'Crab pincer! (-1 HP)'].slice(-5)
    }

    if (e.grabTimer <= 0) {
      e.grabState = null
      e.grabCooldown = GRAB_COOLDOWN
    }
    return  // crab stands still while grabbing
  }

  // Strafe movement: 30% toward + 70% perpendicular
  const toAngle = e.facing
  const perpAngle = toAngle + (Math.PI / 2) * e.strafeDir
  const vx = Math.cos(toAngle) * 0.3 + Math.cos(perpAngle) * 0.7
  const vy = Math.sin(toAngle) * 0.3 + Math.sin(perpAngle) * 0.7
  const len = Math.hypot(vx, vy) || 1
  const mx = (vx / len) * CRAB_SPEED * delta
  const my = (vy / len) * CRAB_SPEED * delta
  if (canMoveTo(map, e.px + mx, e.py)) e.px += mx
  if (canMoveTo(map, e.px, e.py + my)) e.py += my
  e.x = Math.floor(e.px / S)
  e.y = Math.floor(e.py / S)

  // Grab trigger
  if (dist < GRAB_RANGE && e.grabCooldown <= 0) {
    e.grabState = 'grabbing'
    e.grabTimer = GRAB_DURATION
    e.grabDamageTimer = GRAB_DMG_INTERVAL
    state.player.grabbed = true
    return
  }

  // Contact damage
  if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
    player.hp -= CONTACT_DAMAGE
    e.damageCooldown = CONTACT_COOLDOWN
    e.inCombat = true
    state.log = [...state.log, 'Crab pinches! (-1 HP)'].slice(-5)
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/crab.test.js
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/crab.js test/crab.test.js && git commit -m "feat: crab enemy module — armored front deflection, strafe movement, pincer grab"
```

---

## Task 5: Level config + arena generation

**Files:**
- Modify: `renderer/data/levels.js`
- Modify: `renderer/systems/map.js`

- [ ] **Step 1: Add wizardCount, crabCount, and cyclopsArena to LEVEL_CONFIG**

In `renderer/data/levels.js`, replace the `LEVEL_CONFIG` array with:

```js
export const LEVEL_CONFIG = [
  { depth: 1, guardCount:  2, monsterDensity: 0,     trapDensity: 0.03, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'ARMORY',     weapons: ['dagger'] },
  { depth: 2, guardCount:  3, monsterDensity: 0,     trapDensity: 0.04, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'GATEHOUSE',  weapons: ['dagger'],               crabCount: 1 },
  { depth: 3, guardCount:  4, monsterDensity: 0,     trapDensity: 0.05, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['dagger'],               wizardCount: 1, crabCount: 1 },
  { depth: 4, guardCount:  5, monsterDensity: 0,     trapDensity: 0.06, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'INFIRMARY',  weapons: ['dagger', 'sword'],      wizardCount: 1, crabCount: 2 },
  { depth: 5, guardCount:  6, monsterDensity: 0.005, trapDensity: 0.07, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'VAULT',      weapons: ['dagger', 'sword'],      wizardCount: 2 },
  { depth: 6, guardCount:  7, monsterDensity: 0.007, trapDensity: 0.08, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['sword', 'longsword'],   cyclopsArena: true },
  { depth: 7, guardCount:  8, monsterDensity: 0.010, trapDensity: 0.09, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['sword', 'longsword', 'axe'] },
  { depth: 8, guardCount:  9, monsterDensity: 0.012, trapDensity: 0.10, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['longsword', 'axe'] },
  { depth: 9, guardCount: 10, monsterDensity: 0.015, trapDensity: 0.11, puzzleDensity: 0.04, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'DRAGON_LAIR', weapons: ['longsword', 'axe'] },
]
```

- [ ] **Step 2: Add arena carve-out and wizard/crab spawns to `generateLevel` in `renderer/systems/map.js`**

In `renderer/systems/map.js`, inside `generateLevel`, find the block that begins:

```js
    healConnectivity(map)

    const firstCenter = center(rooms[0])
```

Replace it with:

```js
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
```

- [ ] **Step 3: Add wizard and crab placement after the existing guard/monster loops**

In `renderer/systems/map.js`, inside `generateLevel`, find:

```js
    for (let i = 0; i < potionCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'potion', ...farTiles[idx] })
    }

    return { map, entitySpawns, playerSpawn, rooms }
```

Replace with:

```js
    for (let i = 0; i < potionCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'potion', ...farTiles[idx] })
    }

    const wizardCount = cfg.wizardCount ?? 0
    const crabCount   = cfg.crabCount   ?? 0
    for (let i = 0; i < wizardCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'wizard', ...farTiles[idx] })
    }
    for (let i = 0; i < crabCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'crab', ...farTiles[idx] })
    }

    return { map, entitySpawns, playerSpawn, rooms }
```

- [ ] **Step 4: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass (map.js changes are not directly unit-tested, but existing map tests must not regress).

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/data/levels.js renderer/systems/map.js && git commit -m "feat: add wizard/crab to LEVEL_CONFIG; level 6 cyclops arena carve-out"
```

---

## Task 6: Wire up game.js

**Files:**
- Modify: `renderer/game.js`

- [ ] **Step 1: Add imports at the top of game.js**

In `renderer/game.js`, find:

```js
import { generateLevel } from './systems/map.js'
import { computePlayerFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, WEAPON_TYPES, TILE, isWalkable } from './systems/entities.js'
```

Replace with:

```js
import { generateLevel } from './systems/map.js'
import { computePlayerFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, WEAPON_TYPES, TILE, isWalkable } from './systems/entities.js'
import { makeCyclops, updateCyclops } from './systems/cyclops.js'
import { makeWizard, updateWizard } from './systems/wizard.js'
import { makeCrab, updateCrab, deflects } from './systems/crab.js'
```

- [ ] **Step 2: Extend `isEnemy` to include the three new types**

Find:

```js
function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
}
```

Replace with:

```js
function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
}
```

- [ ] **Step 3: Add new cases to `buildEntities`**

Find:

```js
      case 'door':   return [makeDoor(s.x, s.y)]
      default:       return []
```

Replace with:

```js
      case 'door':    return [makeDoor(s.x, s.y)]
      case 'cyclops': return [{ ...makeCyclops(s.x, s.y), px: cx, py: cy }]
      case 'wizard':  return [{ ...makeWizard(s.x, s.y),  px: cx, py: cy }]
      case 'crab':    return [{ ...makeCrab(s.x, s.y),    px: cx, py: cy }]
      default:        return []
```

- [ ] **Step 4: Apply player grab flag before movement**

Find:

```js
  // Player movement
  let vx = 0, vy = 0
  if (keys['ArrowLeft']  || keys['a']) { vx -= 1; player.facing = 'west'  }
```

Replace with:

```js
  // Player movement — skip if grabbed by a crab this frame
  const wasGrabbed = player.grabbed ?? false
  player.grabbed = false
  let vx = 0, vy = 0
  if (keys['ArrowLeft']  || keys['a']) { vx -= 1; player.facing = 'west'  }
```

Then find:

```js
  if (vx !== 0 && vy !== 0) { const len = Math.SQRT2; vx /= len; vy /= len }
  moveEntity(player, vx * PLAYER_SPEED * delta, vy * PLAYER_SPEED * delta, map, PLAYER_HALF)
```

Replace with:

```js
  if (vx !== 0 && vy !== 0) { const len = Math.SQRT2; vx /= len; vy /= len }
  if (!wasGrabbed) moveEntity(player, vx * PLAYER_SPEED * delta, vy * PLAYER_SPEED * delta, map, PLAYER_HALF)
```

- [ ] **Step 5: Add wizard shield + crab deflect checks in the projectile hit loop**

Find:

```js
    if (p.friendly) {
      state.entities = state.entities.map(e => {
        if (!isEnemy(e) || hit) return e
        if (Math.hypot(e.px - p.px, e.py - p.py) < 8) { hit = true; return { ...e, hp: e.hp - p.damage, inCombat: true } }
        return e
      })
      state.entities = state.entities.filter(e => !isEnemy(e) || e.hp > 0)
```

Replace with:

```js
    if (p.friendly) {
      state.entities = state.entities.map(e => {
        if (!isEnemy(e) || hit) return e
        if (Math.hypot(e.px - p.px, e.py - p.py) < 8) {
          if (e.type === 'wizard' && e.shieldTimer > 0) { hit = true; return e }
          if (e.type === 'crab' && deflects(e, p))      { hit = true; return e }
          hit = true
          return { ...e, hp: e.hp - p.damage, inCombat: true }
        }
        return e
      })
      state.entities = state.entities.filter(e => !isEnemy(e) || e.hp > 0)
```

- [ ] **Step 6: Add wizard shield check in the melee hit block**

Find:

```js
    state.entities = state.entities
      .map(e => isEnemy(e) && meleeHit(atk.style, fa, e.px - player.px, e.py - player.py)
        ? { ...e, hp: e.hp - dmg, inCombat: true } : e)
      .filter(e => !isEnemy(e) || e.hp > 0)
```

Replace with:

```js
    state.entities = state.entities
      .map(e => {
        if (!isEnemy(e)) return e
        if (!meleeHit(atk.style, fa, e.px - player.px, e.py - player.py)) return e
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        return { ...e, hp: e.hp - dmg, inCombat: true }
      })
      .filter(e => !isEnemy(e) || e.hp > 0)
```

- [ ] **Step 7: Dispatch to per-enemy update functions in the enemy AI loop**

Find:

```js
  // Enemy AI
  for (const e of state.entities) {
    if (!isEnemy(e)) continue
    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    e.wanderTimer    = Math.max(0, e.wanderTimer    - delta)
```

Replace with:

```js
  // Enemy AI — iterate a snapshot so wizard summons don't re-enter this frame
  for (const e of [...state.entities]) {
    if (!isEnemy(e)) continue

    if (e.type === 'cyclops') { updateCyclops(e, state, delta); continue }
    if (e.type === 'wizard')  { updateWizard(e, state, delta);  continue }
    if (e.type === 'crab')    { updateCrab(e, state, delta);    continue }

    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    e.wanderTimer    = Math.max(0, e.wanderTimer    - delta)
```

- [ ] **Step 8: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js && git commit -m "feat: wire cyclops/wizard/crab into game loop — isEnemy, buildEntities, projectile/melee checks, grab flag"
```

---

## Task 7: Canvas rendering

**Files:**
- Modify: `renderer/render/canvas.js`

- [ ] **Step 1: Add cyclops, wizard, and crab cases to `drawEntity`**

In `renderer/render/canvas.js`, find:

```js
  if (entity.type === 'player') {
```

Insert before that block:

```js
  if (entity.type === 'cyclops') {
    const S2 = S * 2
    const shakeX = entity.state === 'charge_windup' ? Math.sin(Date.now() * 0.03) * 3 : 0
    const savedAlpha = ctx.globalAlpha
    if (entity.state === 'stunned') ctx.globalAlpha = 0.6
    if (sprites.cyclops) ctx.drawImage(sprites.cyclops, px - Math.round(S / 2) + shakeX, py - Math.round(S / 2), S2, S2)
    ctx.globalAlpha = savedAlpha
    return
  }
  if (entity.type === 'wizard') {
    if (sprites.wizard) ctx.drawImage(sprites.wizard, px, py, S, S)
    if (entity.shieldTimer > 0) {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.arc(px + S / 2, py + S / 2, S * 0.8, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    return
  }
  if (entity.type === 'crab') {
    if (sprites.crab) ctx.drawImage(sprites.crab, px, py, S, S)
    return
  }
```

- [ ] **Step 2: Add `drawCyclopsEffects` function**

In `renderer/render/canvas.js`, after the `drawHealthBars` function, add:

```js
function drawCyclopsEffects(ctx, cyclops, camX, camY) {
  if (!cyclops) return
  const cx = Math.round(cyclops.px - camX)
  const cy = Math.round(cyclops.py - camY)

  if (cyclops.state === 'slam_windup') {
    ctx.save()
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.arc(cx, cy, 20, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  if (cyclops.slamRing) {
    const { radius, maxRadius } = cyclops.slamRing
    const alpha = maxRadius > 0 ? 1 - radius / maxRadius : 0
    ctx.save()
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 4
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}
```

- [ ] **Step 3: Wire up cyclops effects and player grab tint in `Renderer.render()`**

Find:

```js
    const dragon = entities.find(e => e.type === 'dragon')
    if (dragon) drawDragonBreath(ctx, dragon, camX, camY)
    drawHealthBars(ctx, entities, map, camX, camY, S)
```

Replace with:

```js
    const dragon = entities.find(e => e.type === 'dragon')
    if (dragon) drawDragonBreath(ctx, dragon, camX, camY)
    const cyclops = entities.find(e => e.type === 'cyclops')
    if (cyclops) drawCyclopsEffects(ctx, cyclops, camX, camY)
    drawHealthBars(ctx, entities, map, camX, camY, S)
```

- [ ] **Step 4: Add player grab tint after player is drawn**

Find:

```js
    drawEntity(ctx, player, ppx, ppy, S, sprites)
    drawMeleeSwing(ctx, player, sprites, camX, camY, S)
```

Replace with:

```js
    drawEntity(ctx, player, ppx, ppy, S, sprites)
    if (player.grabbed) {
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(ppx, ppy, S, S)
      ctx.restore()
    }
    drawMeleeSwing(ctx, player, sprites, camX, camY, S)
```

- [ ] **Step 5: Extend the viewport margin check to give cyclops 2 extra tiles**

Find:

```js
    for (const e of entities) {
      const margin = e.type === 'dragon' ? 5 : 0
```

Replace with:

```js
    for (const e of entities) {
      const margin = e.type === 'dragon' ? 5 : e.type === 'cyclops' ? 2 : 0
```

- [ ] **Step 6: Run all tests**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.

- [ ] **Step 7: Smoke-test each enemy in the game**

In `renderer/game.js`, temporarily change `generateLevel(9)` to `generateLevel(2)` in `startNewRun`. Run the game and verify:

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

- [ ] Crab appears; strafes sideways; projectiles from the front are deflected (don't damage it); backstab projectiles land; pincer grab locks player for ~2s with red tint

Change to `generateLevel(3)` and restart:

- [ ] Wizard appears; kites away; fires bolt/bolt/spread/shield rotation (purple projectiles); summoned bats appear after ~8s; shield makes wizard immune to hits

Change to `generateLevel(6)` and restart:

- [ ] Arena carved in map centre; cyclops is 2×2; shakes during charge windup; charges at wall → stunned (semi-transparent); ground slam shows expanding orange ring; contact does 3 HP

Revert `generateLevel(9)` before committing.

- [ ] **Step 8: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: render cyclops (2×2, slam ring, stun/shake), wizard (shield glow), crab, player grab tint"
```

---

## Final verification

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass with zero failures.
