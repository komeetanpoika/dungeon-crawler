# Enemy Weapons & Melee Slash Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give melee enemies (guard, monster, dragon, crab, cyclops — not the dragon boss or wizard) visible weapons and slash animations, driven by a small attack framework that supports telegraphs (wind-ups) and weapon-derived stats, seeded so combat behavior is unchanged.

**Architecture:** A new pure system module `renderer/systems/enemy-attack.js` holds a `WEAPONS` stats table and an `ENEMY_MELEE` type→weapon map, and runs a windup→strike→swing lifecycle stored on `e.attack`. Existing contact-damage sites (game.js generic block, crab.js, cyclops.js) are replaced with calls into it. Rendering extracts the player's swing code in `renderer/render/canvas.js` into a shared `drawSwing` used by a new `drawEnemySwing`, plus held-at-idle weapon drawing for guard and cyclops.

**Tech Stack:** Vanilla JS (ES modules), Electron renderer, `node:test` for tests. No bundler.

**Spec:** `docs/superpowers/specs/2026-07-02-enemy-weapons-melee-animations-design.md`

## Global Constraints

- Behavior-preserving seeds: damages guard 1, monster 1, dragon 2, crab 1, cyclops 3; ranges 20px (cyclops 40px); cooldown 0.8s; **all windups 0**.
- I-frame-blocked strikes must NOT set the cooldown and must NOT leave an animation (today's silent per-frame retry).
- Log messages must keep their exact current wording: `Hit for ${dmg} damage!` (generic), `Crab pinches! (-1 HP)`, `Cyclops hits! (-3 HP)`.
- Player melee visuals must be pixel-identical after the `drawSwing` extraction.
- Dragon boss and wizard are untouched.
- `renderer/systems/` modules stay pure — no canvas/DOM imports.
- Run tests with `npm test` (which is `node --test test/`) from the repo root `~/projects/dungeon-crawler`.
- **Known accepted delta:** the framework sets `e.inCombat = true` when an enemy's strike lands, so guard/monster/dragon now show their health bar after hitting the player (previously only after being hit). This is intentional; do not "fix" it.

---

### Task 1: Attack framework module (`enemy-attack.js`)

**Files:**
- Create: `renderer/systems/enemy-attack.js`
- Test: `test/enemy-attack.test.js`

**Interfaces:**
- Consumes: `damagePlayer(state, amount, 'hit', message)` from `renderer/systems/player-damage.js` (returns `false` when blocked by i-frames).
- Produces (used by Tasks 2–5):
  - `WEAPONS` — `{ sword, club, claw, dragon_claw, pincer }`, each `{ sprite: string|null, style: 'arc'|'slash'|'snap', marks: 'claw'|'pincer'|null, damage, windup, duration, range }`
  - `ENEMY_MELEE` — `{ guard: 'sword', monster: 'claw', dragon: 'dragon_claw', crab: 'pincer', cyclops: 'club' }`
  - `getEnemyWeapon(e)` → `{ id, ...stats }` or `null`
  - `tryStartEnemyAttack(e, state, message?)` → `boolean` (attack initiated)
  - `stepEnemyAttack(e, state, delta)` → void
  - `ATTACK_COOLDOWN = 0.8`
  - Attack state on the entity: `e.attack = { weaponId, phase: 'windup'|'swing', timer, duration, angle, message }`, `null`/absent when idle.

- [ ] **Step 1: Write the failing test**

Create `test/enemy-attack.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEAPONS, ENEMY_MELEE, ATTACK_COOLDOWN,
  getEnemyWeapon, tryStartEnemyAttack, stepEnemyAttack,
} from '../renderer/systems/enemy-attack.js'

function makeState(player) {
  return { player, log: [] }
}

function makeEnemy(type, px = 100, py = 100) {
  return { type, px, py, x: 3, y: 3, hp: 5, maxHp: 5, inCombat: false, damageCooldown: 0 }
}

describe('getEnemyWeapon', () => {
  it('resolves the type default', () => {
    const w = getEnemyWeapon(makeEnemy('guard'))
    assert.equal(w.id, 'sword')
    assert.equal(w.damage, 1)
    assert.equal(w.style, 'arc')
  })

  it('per-entity weaponId overrides the type default', () => {
    const e = makeEnemy('guard')
    e.weaponId = 'club'
    const w = getEnemyWeapon(e)
    assert.equal(w.id, 'club')
    assert.equal(w.damage, 3)
  })

  it('weaponOverrides tweaks individual stats', () => {
    const e = makeEnemy('guard')
    e.weaponOverrides = { damage: 9, windup: 0.5 }
    const w = getEnemyWeapon(e)
    assert.equal(w.id, 'sword')
    assert.equal(w.damage, 9)
    assert.equal(w.windup, 0.5)
  })

  it('returns null for enemies with no melee weapon', () => {
    assert.equal(getEnemyWeapon(makeEnemy('wizard')), null)
    assert.equal(getEnemyWeapon(makeEnemy('dragon_boss')), null)
  })
})

describe('tryStartEnemyAttack — windup 0 (seeded behavior)', () => {
  it('strikes instantly: damage, cooldown, swing animation, angle toward player', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    const started = tryStartEnemyAttack(e, state)
    assert.equal(started, true)
    assert.equal(state.player.hp, 9)
    assert.equal(e.damageCooldown, ATTACK_COOLDOWN)
    assert.equal(e.attack.phase, 'swing')
    assert.equal(e.attack.weaponId, 'sword')
    assert.ok(Math.abs(e.attack.angle) < 0.01, 'angle points east toward the player')
    assert.equal(e.inCombat, true)
  })

  it('deals the seeded per-type damage values', () => {
    const cases = [
      ['guard', 1], ['monster', 1], ['dragon', 2], ['crab', 1], ['cyclops', 3],
    ]
    for (const [type, dmg] of cases) {
      const e = makeEnemy(type, 100, 100)
      const state = makeState({ px: 110, py: 100, hp: 10 })
      tryStartEnemyAttack(e, state)
      assert.equal(state.player.hp, 10 - dmg, `${type} deals ${dmg}`)
    }
  })

  it('uses the default log message with the weapon damage', () => {
    const e = makeEnemy('dragon', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    assert.deepEqual(state.log, ['Hit for 2 damage!'])
  })

  it('uses a custom message when provided', () => {
    const e = makeEnemy('crab', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state, 'Crab pinches! (-1 HP)')
    assert.deepEqual(state.log, ['Crab pinches! (-1 HP)'])
  })

  it('does not start out of range (sword range 20)', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 125, py: 100, hp: 10 })
    assert.equal(tryStartEnemyAttack(e, state), false)
    assert.equal(state.player.hp, 10)
    assert.equal(e.attack ?? null, null)
  })

  it('cyclops club reaches 40px', () => {
    const e = makeEnemy('cyclops', 100, 100)
    const state = makeState({ px: 135, py: 100, hp: 10 })
    assert.equal(tryStartEnemyAttack(e, state), true)
    assert.equal(state.player.hp, 7)
  })

  it('does not start while damageCooldown is running', () => {
    const e = makeEnemy('guard', 100, 100)
    e.damageCooldown = 0.5
    const state = makeState({ px: 110, py: 100, hp: 10 })
    assert.equal(tryStartEnemyAttack(e, state), false)
    assert.equal(state.player.hp, 10)
  })

  it('i-framed strike cancels silently: no damage, no cooldown, no animation', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10, invulnTimer: 0.5 })
    tryStartEnemyAttack(e, state)
    assert.equal(state.player.hp, 10)
    assert.equal(e.damageCooldown, 0)
    assert.equal(e.attack ?? null, null)
    assert.equal(e.inCombat, false)
  })
})

describe('windup > 0 (telegraph framework)', () => {
  it('telegraphs first, then strikes when the windup elapses', () => {
    const e = makeEnemy('guard', 100, 100)
    e.weaponOverrides = { windup: 0.3 }
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    assert.equal(e.attack.phase, 'windup')
    assert.equal(state.player.hp, 10, 'no damage during windup')

    stepEnemyAttack(e, state, 0.15)
    assert.equal(e.attack.phase, 'windup')
    assert.equal(state.player.hp, 10)

    stepEnemyAttack(e, state, 0.2)
    assert.equal(e.attack.phase, 'swing')
    assert.equal(state.player.hp, 9)
    assert.equal(e.damageCooldown, ATTACK_COOLDOWN)
  })

  it('whiffs when the player leaves range during the windup: no damage, cooldown still set', () => {
    const e = makeEnemy('guard', 100, 100)
    e.weaponOverrides = { windup: 0.3 }
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    state.player.px = 300
    stepEnemyAttack(e, state, 0.4)
    assert.equal(state.player.hp, 10, 'dodged — no damage')
    assert.equal(e.damageCooldown, ATTACK_COOLDOWN, 'attack is still spent')
    assert.equal(e.attack.phase, 'swing', 'the swing plays out')
    assert.equal(e.inCombat, false)
  })
})

describe('stepEnemyAttack — swing lifecycle', () => {
  it('clears the attack when the swing finishes', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    stepEnemyAttack(e, state, 0.1)
    assert.ok(e.attack, 'still swinging (sword duration 0.25)')
    stepEnemyAttack(e, state, 0.2)
    assert.equal(e.attack ?? null, null, 'swing over, state cleared')
  })

  it('is a safe no-op without an active attack', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    stepEnemyAttack(e, state, 0.016)
    assert.equal(e.attack ?? null, null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/enemy-attack.test.js` (or `node --test test/enemy-attack.test.js`)
Expected: FAIL — `Cannot find module .../renderer/systems/enemy-attack.js`

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/enemy-attack.js`:

```js
// Enemy melee-attack framework: weapons with stats, windup→strike→swing lifecycle.
// Pure logic — no canvas/DOM imports. The renderer reads e.attack.
import { damagePlayer } from './player-damage.js'

export const ATTACK_COOLDOWN = 0.8

// Windups are all 0 for now (behavior-preserving seeds); the lifecycle below
// fully supports nonzero windups — see the telegraph tests.
export const WEAPONS = {
  sword:       { sprite: 'weapon_sword', style: 'arc',   marks: null,     damage: 1, windup: 0, duration: 0.25, range: 20 },
  club:        { sprite: 'weapon_club',  style: 'slash', marks: null,     damage: 3, windup: 0, duration: 0.30, range: 40 },
  claw:        { sprite: null,           style: 'snap',  marks: 'claw',   damage: 1, windup: 0, duration: 0.20, range: 20 },
  dragon_claw: { sprite: null,           style: 'arc',   marks: 'claw',   damage: 2, windup: 0, duration: 0.25, range: 20 },
  pincer:      { sprite: null,           style: 'snap',  marks: 'pincer', damage: 1, windup: 0, duration: 0.20, range: 20 },
}

export const ENEMY_MELEE = {
  guard:   'sword',
  monster: 'claw',
  dragon:  'dragon_claw',
  crab:    'pincer',
  cyclops: 'club',
}

// Per-entity weaponId beats the type default; weaponOverrides tweaks individual
// stats — the hook for spawns carrying varied weapons later.
export function getEnemyWeapon(e) {
  const id = e.weaponId ?? ENEMY_MELEE[e.type]
  if (!id || !WEAPONS[id]) return null
  return { id, ...WEAPONS[id], ...(e.weaponOverrides ?? {}) }
}

export function tryStartEnemyAttack(e, state, message) {
  if (e.attack) return false
  if ((e.damageCooldown ?? 0) > 0) return false
  const w = getEnemyWeapon(e)
  if (!w) return false
  const { player } = state
  if (Math.hypot(e.px - player.px, e.py - player.py) >= w.range) return false
  e.attack = {
    weaponId: w.id,
    phase: 'windup',
    timer: w.windup,
    duration: w.windup,
    angle: Math.atan2(player.py - e.py, player.px - e.px),
    message: message ?? `Hit for ${w.damage} damage!`,
  }
  if (w.windup <= 0) strike(e, state)
  return true
}

function strike(e, state) {
  const w = getEnemyWeapon(e)
  const a = e.attack
  const { player } = state
  const inRange = Math.hypot(e.px - player.px, e.py - player.py) < w.range
  if (inRange && !damagePlayer(state, w.damage, 'hit', a.message)) {
    e.attack = null   // i-framed: no cooldown, no animation — retries next frame
    return
  }
  if (inRange) e.inCombat = true
  e.damageCooldown = ATTACK_COOLDOWN   // landed, or whiffed after a windup: the attack is spent
  a.phase = 'swing'
  a.timer = w.duration
  a.duration = w.duration
}

export function stepEnemyAttack(e, state, delta) {
  const a = e.attack
  if (!a) return
  a.timer = Math.max(0, a.timer - delta)
  if (a.timer > 0) return
  if (a.phase === 'windup') strike(e, state)
  else e.attack = null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/enemy-attack.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (nothing else touched).

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/enemy-attack.js test/enemy-attack.test.js
git commit -m "feat(enemy-attack): melee weapon framework with windup/strike/swing lifecycle"
```

---

### Task 2: Route generic contact damage (guard/monster/dragon) through the framework

**Files:**
- Modify: `renderer/game.js` (imports ~line 18; contact block ~lines 567–573; knockback pass ~lines 623–626; unused constant ~line 30)

**Interfaces:**
- Consumes: `tryStartEnemyAttack(e, state)`, `stepEnemyAttack(e, state, delta)` from Task 1.
- Produces: every enemy's `e.attack` is stepped centrally each frame — crab/cyclops (Task 3) rely on this pass; the renderer (Task 4) relies on `e.attack` being populated.

- [ ] **Step 1: Add the import**

In `renderer/game.js`, after the existing import of `knockback.js` (line 17), add:

```js
import { tryStartEnemyAttack, stepEnemyAttack } from './systems/enemy-attack.js'
```

- [ ] **Step 2: Replace the contact-damage block**

Find (at ~line 567, the end of the generic enemy AI loop):

```js
    // Contact damage
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      const contactDmg = e.type === 'dragon' ? 2 : 1
      if (damagePlayer(state, contactDmg, 'hit', `Hit for ${contactDmg} damage!`)) {
        e.damageCooldown = CONTACT_DAMAGE_COOLDOWN
      }
    }
```

Replace with:

```js
    // Contact melee — weapon framework (damage/range/cooldown from the enemy's weapon)
    tryStartEnemyAttack(e, state)
```

The default message (`Hit for ${damage} damage!`) reproduces the current wording exactly (guard/monster 1, dragon 2).

- [ ] **Step 3: Add the central attack-step pass**

Find the knockback pass (~line 623):

```js
  for (const e of state.entities) {
    stepKnockback(e, delta, (px, py) => canMoveTo(map, px, py, ENEMY_HALF))
  }
```

Add directly above it:

```js
  // Advance in-flight enemy melee attacks (windup → strike → swing)
  for (const e of state.entities) stepEnemyAttack(e, state, delta)
```

This central pass covers guard/monster/dragon and (after Task 3) crab/cyclops, including while the crab is grabbing or the cyclops is mid-charge.

- [ ] **Step 4: Remove the now-unused constant**

Delete line 30:

```js
const CONTACT_DAMAGE_COOLDOWN = 0.8
```

(`CONTACT_RANGE` stays — it still gates chase movement and spider shooting.)
Verify no other references: `grep -n CONTACT_DAMAGE_COOLDOWN renderer/game.js` → no matches.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. (game.js has no direct unit tests; the framework logic is covered by Task 1. Runtime verification happens in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add renderer/game.js
git commit -m "feat(game): route guard/monster/dragon contact damage through the enemy-attack framework"
```

---

### Task 3: Route crab and cyclops contact damage through the framework

**Files:**
- Modify: `renderer/systems/crab.js` (contact block lines 100–106; constants lines 7–9)
- Modify: `renderer/systems/cyclops.js` (contact block lines 77–83; constants lines 17–18)
- Test: `test/crab.test.js`, `test/cyclops.test.js` (add cases)

**Interfaces:**
- Consumes: `tryStartEnemyAttack(e, state, message)` from Task 1; the central `stepEnemyAttack` pass from Task 2.
- Produces: crab/cyclops populate `e.attack` like every other melee enemy.

- [ ] **Step 1: Write the failing tests**

Append to `test/cyclops.test.js` (inside a new describe at the bottom):

```js
describe('updateCyclops — contact melee via weapon framework', () => {
  it('club hit damages the player and starts a swing animation', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.chargeCooldown = 99   // keep it in chase
    c.slamTimer = 99
    const player = { x: 6, y: 5, px: c.px + 30, py: c.py, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.016)
    assert.equal(player.hp, 7, 'club deals 3')
    assert.equal(c.attack.weaponId, 'club')
    assert.equal(c.attack.phase, 'swing')
    assert.equal(c.damageCooldown, 0.8)
    assert.equal(c.inCombat, true)
  })
})
```

Append to `test/crab.test.js` (match the file's existing state/mock helpers — it tests `updateCrab` with a `state` of the same shape as cyclops's; reuse its helpers if present, otherwise mirror this):

```js
describe('updateCrab — contact melee via weapon framework', () => {
  it('pincer hit damages the player and starts a swing animation', () => {
    const e = makeCrab(5, 5)
    e.px = 5 * 32 + 16; e.py = 5 * 32 + 16
    e.grabCooldown = 99   // keep the grab from triggering first
    const player = { x: 5, y: 5, px: e.px + 10, py: e.py, hp: 10, grabbed: false }
    const state = { player, map: openMap(), projectiles: [], entities: [e], log: [] }
    updateCrab(e, state, 0.016)
    assert.equal(player.hp, 9, 'pincer deals 1')
    assert.equal(e.attack.weaponId, 'pincer')
    assert.equal(e.attack.phase, 'swing')
    assert.deepEqual(state.log, ['Crab pinches! (-1 HP)'])
  })
})
```

(If `test/crab.test.js` has no `openMap` helper, copy the one from `test/cyclops.test.js` lines 9–15 — it needs `createMap` from `../renderer/systems/map.js` and `TILE` from `../renderer/systems/entities.js`. Note the crab strafes before the contact check, so place the player 10px away — still inside the 20px range after one frame of movement.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test test/crab.test.js test/cyclops.test.js`
Expected: the two new cases FAIL (`e.attack` is undefined); all pre-existing cases PASS.

- [ ] **Step 3: Modify `crab.js`**

Add the import (after line 2):

```js
import { tryStartEnemyAttack } from './enemy-attack.js'
```

Replace the contact block (lines 100–106):

```js
  // Contact damage
  if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
    if (damagePlayer(state, CONTACT_DAMAGE, 'hit', 'Crab pinches! (-1 HP)')) {
      e.damageCooldown = CONTACT_COOLDOWN
      e.inCombat = true
    }
  }
```

with:

```js
  // Contact melee — pincer via the weapon framework
  tryStartEnemyAttack(e, state, 'Crab pinches! (-1 HP)')
```

Delete the now-unused constants (lines 7–9):

```js
const CONTACT_DAMAGE   = 1
const CONTACT_COOLDOWN = 0.8
const CONTACT_RANGE    = 20
```

(Keep the `damagePlayer` import — the grab still uses it.)

- [ ] **Step 4: Modify `cyclops.js`**

Add the import (after line 3):

```js
import { tryStartEnemyAttack } from './enemy-attack.js'
```

Replace the contact block (lines 77–83, inside the `chase` branch):

```js
    // Contact damage
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      if (damagePlayer(state, CONTACT_DAMAGE, 'hit', `Cyclops hits! (-${CONTACT_DAMAGE} HP)`)) {
        e.damageCooldown = CONTACT_COOLDOWN
        e.inCombat = true
      }
    }
```

with:

```js
    // Contact melee — club via the weapon framework (range 40 matches CONTACT_RANGE)
    tryStartEnemyAttack(e, state, 'Cyclops hits! (-3 HP)')
```

Delete the now-unused constants (lines 17–18):

```js
const CONTACT_DAMAGE       = 3
const CONTACT_COOLDOWN     = 0.8
```

(Keep `CONTACT_RANGE = 40` — the chase-movement gate at line 58 still uses it. Keep the `damagePlayer` import — charge and slam still use it.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/crab.test.js test/cyclops.test.js`
Expected: PASS, including all pre-existing cases (charge, slam, grab are untouched).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/crab.js renderer/systems/cyclops.js test/crab.test.js test/cyclops.test.js
git commit -m "feat(crab,cyclops): route contact damage through the enemy-attack framework"
```

---

### Task 4: Shared swing renderer + enemy swing & telegraph drawing

**Files:**
- Modify: `renderer/render/sprites.js` (add `weapon_club`)
- Modify: `renderer/render/canvas.js` (extract `drawSwing` from `drawMeleeSwing` ~lines 259–330; add `drawEnemySwing` + windup pose; call it from the render entity loop ~line 596)
- Test: `test/canvas.test.js` (add cases)

**Interfaces:**
- Consumes: `WEAPONS` from `renderer/systems/enemy-attack.js` (for style/marks lookup); `e.attack = { weaponId, phase, timer, duration, angle }` from Tasks 1–3.
- Produces: exported `drawEnemySwing(ctx, e, sprites, camX, camY, S)` (exported for tests); internal `drawSwing(ctx, cx, cy, ws, style, t, S, opts)` where `opts = { baseAngle, tint: [r,g,b], scale, marks }`.

- [ ] **Step 1: Register the club sprite**

In `renderer/render/sprites.js`, after `weapon_axe: 'tile_0118',` (line 52), add:

```js
  weapon_club:      'tile_0107',
```

- [ ] **Step 2: Write the failing tests**

Append to `test/canvas.test.js`. First add the import at the top (extend the existing import from canvas.js):

```js
import { drawTile, isFlickerVisible, shakeOffset, drawEnemySwing } from '../renderer/render/canvas.js'
```

Then add a fuller recording mock and the cases:

```js
// Mock ctx with the full 2D-context surface the swing renderer touches.
function swingCtx() {
  const images = []
  return {
    images,
    drawImage: (img) => images.push(img),
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {},
    fillRect() {},
    set fillStyle(_v) {}, get fillStyle() { return '' },
    set strokeStyle(_v) {}, get strokeStyle() { return '' },
    set lineWidth(_v) {}, get lineWidth() { return 0 },
    set lineCap(_v) {}, get lineCap() { return '' },
    set globalAlpha(_v) {}, get globalAlpha() { return 1 },
  }
}

describe('drawEnemySwing', () => {
  const sprites = { weapon_sword: 'SWORD', weapon_club: 'CLUB' }

  it('draws the weapon sprite during a sword swing', () => {
    const ctx = swingCtx()
    const e = { px: 100, py: 100, attack: { weaponId: 'sword', phase: 'swing', timer: 0.1, duration: 0.25, angle: 0 } }
    drawEnemySwing(ctx, e, sprites, 0, 0, 32)
    assert.ok(ctx.images.includes('SWORD'))
  })

  it('draws the weapon sprite raised during a windup (telegraph)', () => {
    const ctx = swingCtx()
    const e = { px: 100, py: 100, attack: { weaponId: 'club', phase: 'windup', timer: 0.2, duration: 0.4, angle: 0 } }
    drawEnemySwing(ctx, e, sprites, 0, 0, 32)
    assert.ok(ctx.images.includes('CLUB'))
  })

  it('draws procedural marks (no sprite image) for claw and pincer swings', () => {
    for (const weaponId of ['claw', 'pincer', 'dragon_claw']) {
      const ctx = swingCtx()
      const e = { px: 100, py: 100, attack: { weaponId, phase: 'swing', timer: 0.1, duration: 0.2, angle: 0 } }
      drawEnemySwing(ctx, e, sprites, 0, 0, 32)
      assert.equal(ctx.images.length, 0, `${weaponId} uses no sprite`)
    }
  })

  it('draws nothing without an active attack', () => {
    const ctx = swingCtx()
    drawEnemySwing(ctx, { px: 100, py: 100 }, sprites, 0, 0, 32)
    assert.equal(ctx.images.length, 0)
  })
})
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `node --test test/canvas.test.js`
Expected: FAIL — `drawEnemySwing` is not exported.

- [ ] **Step 4: Extract `drawSwing` and keep the player wrapper identical**

In `renderer/render/canvas.js`, add the import at the top (after the walkTilt import):

```js
import { WEAPONS } from '../systems/enemy-attack.js'
```

Replace the whole `drawMeleeSwing` function (lines 259–330) with the extracted core plus a thin player wrapper. The style blocks, radii, widths, and per-style default tints are **copied verbatim** — player visuals must not change:

```js
// Per-style default trail tints — the player's original colors.
const SWING_TINTS = { snap: [255, 230, 80], arc: [180, 180, 255], slash: [150, 220, 255], spin: [255, 140, 50] }

// Shared swing core: rotates a weapon sprite (or draws natural-attack marks)
// around (cx, cy) with a colored arc trail. t ∈ [0,1] is swing progress.
// opts: { baseAngle, tint: [r,g,b], scale, marks: 'claw'|'pincer'|null }
function drawSwing(ctx, cx, cy, ws, style, t, S, opts = {}) {
  const alpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2
  const base = opts.baseAngle ?? 0
  const [r, g, b] = opts.tint ?? SWING_TINTS[style] ?? [200, 200, 200]
  const scale = opts.scale ?? 1

  function trail(a0, a1, radius, width) {
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1)
    if (hi - lo < 0.01) return
    ctx.save()
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.4})`
    ctx.lineWidth = width; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(cx, cy, radius * scale, lo, hi); ctx.stroke()
    ctx.restore()
  }

  function weapon(angle, wscale = 1) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    ctx.rotate(-Math.PI / 2)   // orient so blade points outward along the arm
    ctx.scale(wscale * scale, wscale * scale)
    ctx.globalAlpha = alpha
    if (ws) {
      ctx.drawImage(ws, -S/2, -S * 0.9, S, S)
    } else if (opts.marks === 'claw') {
      // three claw lines raking outward
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
      ctx.lineWidth = 2; ctx.lineCap = 'round'
      for (const off of [-5, 0, 5]) {
        ctx.beginPath(); ctx.moveTo(off, -S * 0.25); ctx.lineTo(off * 1.4, -S * 0.75); ctx.stroke()
      }
    } else if (opts.marks === 'pincer') {
      // two arcs closing like a pincer
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
      ctx.lineWidth = 3; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.arc(-4, -S * 0.5, S * 0.22, -Math.PI * 0.2, Math.PI * 0.8); ctx.stroke()
      ctx.beginPath(); ctx.arc( 4, -S * 0.5, S * 0.22, Math.PI * 0.2, -Math.PI * 0.8, true); ctx.stroke()
    } else {
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -S * 0.9); ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  if (style === 'snap') {
    // Dagger/claw: fast 90° snap with slight overshoot
    const raw = t < 0.65
      ? easeOutCubic(t / 0.65)
      : 1 + Math.sin((t - 0.65) / 0.35 * Math.PI) * 0.22
    const angle = base + (raw - 0.5) * (Math.PI / 2)
    trail(base - Math.PI/4, angle, S * 0.8, 7)
    weapon(angle, 0.85)

  } else if (style === 'arc') {
    // Sword: 140° side-to-side sweep
    const sweep = (easeOutCubic(t) * 2 - 1) * (Math.PI * 70/180)
    const angle = base + sweep
    trail(base - Math.PI*70/180, angle, S * 1.3, 11)
    weapon(angle)

  } else if (style === 'slash') {
    // Longsword/club: overhead slam from –162° to +18°
    const startA = base - Math.PI * 0.9
    const endA   = base + Math.PI * 0.1
    const angle  = startA + easeOutCubic(t) * (endA - startA)
    trail(startA, angle, S * 1.55, 14)
    weapon(angle, 1.25)

  } else if (style === 'spin') {
    // Axe: full 360° spin with fading trail
    const angle = base + easeInOutCubic(t) * Math.PI * 2
    for (let i = 2; i >= 0; i--) {
      const ta = Math.max(0, t - i * 0.07)
      trail(base, base + easeInOutCubic(ta) * Math.PI * 2, S + i * 5, 13 - i * 3)
    }
    weapon(angle, 1.15)
  }
}

function drawMeleeSwing(ctx, player, sprites, camX, camY, S) {
  if (!(player.attackTimer > 0) || !(player.attackDuration > 0)) return
  const t = 1 - player.attackTimer / player.attackDuration
  const base = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.attackFacing] ?? 0
  const ws = sprites[`weapon_${player.weapon?.weaponType}`]
  drawSwing(ctx, player.px - camX, player.py - camY, ws, player.attackStyle, t, S, { baseAngle: base })
}
```

Note the one intentional refactor detail: the original `trail()` didn't scale its radius; `drawSwing` multiplies `radius * scale`, but the player always passes no `scale` (defaults to 1), so player output is unchanged.

- [ ] **Step 5: Add `drawEnemySwing` + windup pose**

Add directly below `drawMeleeSwing` in `canvas.js`:

```js
// Per-weapon enemy swing presentation (tint/scale on top of the shared core).
const ENEMY_SWING = {
  sword:       { spriteKey: 'weapon_sword', tint: [180, 180, 255], scale: 1 },
  club:        { spriteKey: 'weapon_club',  tint: [255, 170, 60],  scale: 1.3 },
  claw:        { marks: 'claw',   tint: [220, 220, 200], scale: 1 },
  dragon_claw: { marks: 'claw',   tint: [255, 150, 60],  scale: 1.4 },
  pincer:      { marks: 'pincer', tint: [255, 90, 90],   scale: 1 },
}

// Where each swing style starts, relative to its base angle — the windup pose
// holds the weapon there so the telegraph shows where the swing will come from.
const SWING_START = { snap: -Math.PI / 4, arc: -Math.PI * 70/180, slash: -Math.PI * 0.9, spin: 0 }

function drawWindupPose(ctx, cx, cy, ws, baseAngle, style, k, S, cfg) {
  const quiver = Math.sin(Date.now() * 0.04) * 0.08 * k
  const angle = baseAngle + (SWING_START[style] ?? -Math.PI / 2) + quiver
  const scale = cfg.scale ?? 1
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.rotate(-Math.PI / 2)
  ctx.scale(scale, scale)
  ctx.globalAlpha = 0.55 + 0.45 * k
  if (ws) {
    ctx.drawImage(ws, -S/2, -S * 0.9, S, S)
  } else {
    // natural-attack tell: a faint ring that tightens as the strike nears
    const [r, g, b] = cfg.tint ?? [220, 220, 220]
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 + 0.5 * k})`
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, -S * 0.5, S * 0.2 + k * 4, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

export function drawEnemySwing(ctx, e, sprites, camX, camY, S) {
  const a = e.attack
  if (!a) return
  const cfg = ENEMY_SWING[a.weaponId] ?? {}
  const style = WEAPONS[a.weaponId]?.style ?? 'arc'
  const cx = e.px - camX, cy = e.py - camY
  const ws = cfg.spriteKey ? sprites[cfg.spriteKey] : null
  const k = a.duration > 0 ? 1 - a.timer / a.duration : 1
  if (a.phase === 'windup') {
    drawWindupPose(ctx, cx, cy, ws, a.angle, style, k, S, cfg)
    return
  }
  drawSwing(ctx, cx, cy, ws, style, k, S, { baseAngle: a.angle, tint: cfg.tint, scale: cfg.scale, marks: cfg.marks })
}
```

- [ ] **Step 6: Call it from the render loop**

In the render entity loop (~line 595), change:

```js
      if (e.type === 'dragon_boss') drawDragonBoss(ctx, e, camX, camY, S)
      else drawEntity(ctx, e, epx, epy, S, sprites)
```

to:

```js
      if (e.type === 'dragon_boss') drawDragonBoss(ctx, e, camX, camY, S)
      else drawEntity(ctx, e, epx, epy, S, sprites)
      if (e.attack) drawEnemySwing(ctx, e, sprites, camX, camY, S)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/canvas.test.js`
Expected: PASS — new drawEnemySwing cases and all pre-existing drawTile/isFlickerVisible/shakeOffset cases.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add renderer/render/canvas.js renderer/render/sprites.js test/canvas.test.js
git commit -m "feat(render): shared drawSwing core + enemy swing and windup-telegraph rendering"
```

---

### Task 5: Held-at-idle weapons (guard sword, cyclops club + slam raise)

**Files:**
- Modify: `renderer/render/canvas.js` (`drawWalker` ~line 91; guard branch ~line 202; cyclops branch ~line 179; export `drawEntity`)
- Test: `test/canvas.test.js` (add cases)

**Interfaces:**
- Consumes: `e.attack` (hide the idle weapon while swinging), cyclops `state` field (`slam_windup` / `slamming`), sprites `weapon_sword` / `weapon_club` from Task 4.
- Produces: `drawEntity` exported from `renderer/render/canvas.js` (for tests); `drawWalker(ctx, sprite, px, py, S, flip, tiltDeg, heldWeapon = null)`.

- [ ] **Step 1: Write the failing tests**

Extend the canvas.js import in `test/canvas.test.js`:

```js
import { drawTile, isFlickerVisible, shakeOffset, drawEnemySwing, drawEntity } from '../renderer/render/canvas.js'
```

Append (reuses `swingCtx()` from Task 4):

```js
describe('drawEntity — held idle weapons', () => {
  const sprites = { guard: 'GUARD', cyclops: 'CYC', weapon_sword: 'SWORD', weapon_club: 'CLUB' }

  it('guard carries a sword at idle', () => {
    const ctx = swingCtx()
    drawEntity(ctx, { type: 'guard', facing: 'east', walkPhase: 0, swayAmp: 0 }, 0, 0, 32, sprites)
    assert.deepEqual(ctx.images, ['GUARD', 'SWORD'])
  })

  it('guard hides the idle sword while swinging', () => {
    const ctx = swingCtx()
    const attack = { weaponId: 'sword', phase: 'swing', timer: 0.1, duration: 0.25, angle: 0 }
    drawEntity(ctx, { type: 'guard', facing: 'east', walkPhase: 0, swayAmp: 0, attack }, 0, 0, 32, sprites)
    assert.deepEqual(ctx.images, ['GUARD'])
  })

  it('cyclops carries a club at idle and hides it while swinging', () => {
    const ctx = swingCtx()
    drawEntity(ctx, { type: 'cyclops', state: 'chase' }, 0, 0, 32, sprites)
    assert.deepEqual(ctx.images, ['CYC', 'CLUB'])

    const ctx2 = swingCtx()
    const attack = { weaponId: 'club', phase: 'swing', timer: 0.1, duration: 0.3, angle: 0 }
    drawEntity(ctx2, { type: 'cyclops', state: 'chase', attack }, 0, 0, 32, sprites)
    assert.deepEqual(ctx2.images, ['CYC'])
  })

  it('cyclops raises the club during slam states', () => {
    for (const s of ['slam_windup', 'slamming']) {
      const ctx = swingCtx()
      drawEntity(ctx, { type: 'cyclops', state: s }, 0, 0, 32, sprites)
      assert.deepEqual(ctx.images, ['CYC', 'CLUB'], `club drawn during ${s}`)
    }
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test test/canvas.test.js`
Expected: FAIL — `drawEntity` is not exported.

- [ ] **Step 3: Export `drawEntity` and extend `drawWalker`**

Change the declaration (line 106):

```js
export function drawEntity(ctx, entity, px, py, S, sprites) {
```

Extend `drawWalker` (line 91) with an optional held weapon, drawn in the same "behind on the right" pocket the player's held weapon uses:

```js
function drawWalker(ctx, sprite, px, py, S, flip, tiltDeg, heldWeapon = null) {
  ctx.save()
  ctx.translate(px + S / 2, py + S)        // pivot at the feet (center-bottom)
  ctx.rotate(tiltDeg * Math.PI / 180)
  ctx.scale(flip ? -1 : 1, 1)
  ctx.drawImage(sprite, -S / 2, -S, S, S)
  if (heldWeapon) {
    const hw = Math.round(S * 0.5)
    ctx.drawImage(heldWeapon, S / 2 - hw, -hw, hw, hw)
  }
  ctx.restore()
}
```

- [ ] **Step 4: Guard branch**

Replace the guard branch (~line 202):

```js
  if (entity.type === 'guard') {
    const flip = entity.facing === 'west'
    if (sprites.guard) drawWalker(ctx, sprites.guard, px, py, S, flip, walkTilt(entity))
    return
  }
```

with:

```js
  if (entity.type === 'guard') {
    const flip = entity.facing === 'west'
    const held = entity.attack ? null : sprites.weapon_sword   // the swing draws it instead
    if (sprites.guard) drawWalker(ctx, sprites.guard, px, py, S, flip, walkTilt(entity), held)
    return
  }
```

- [ ] **Step 5: Cyclops branch**

Replace the cyclops branch (~line 179):

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
```

with:

```js
  if (entity.type === 'cyclops') {
    const S2 = S * 2
    const shakeX = entity.state === 'charge_windup' ? Math.sin(Date.now() * 0.03) * 3 : 0
    const savedAlpha = ctx.globalAlpha
    if (entity.state === 'stunned') ctx.globalAlpha = 0.6
    if (sprites.cyclops) ctx.drawImage(sprites.cyclops, px - Math.round(S / 2) + shakeX, py - Math.round(S / 2), S2, S2)
    if (sprites.weapon_club && !entity.attack) {
      const cw = Math.round(S * 0.9)
      ctx.save()
      ctx.translate(px + S / 2 + shakeX, py + S / 2)   // body center of the 2S sprite
      if (entity.state === 'slam_windup' || entity.state === 'slamming') {
        // club raised overhead, quivering through the windup
        const q = entity.state === 'slam_windup' ? Math.sin(Date.now() * 0.04) * 0.06 : 0
        ctx.rotate(q)
        ctx.drawImage(sprites.weapon_club, -cw / 2, -Math.round(S2 * 0.95), cw, cw)
      } else {
        // resting at its side
        ctx.rotate(0.5)
        ctx.drawImage(sprites.weapon_club, Math.round(S * 0.55), -cw / 2, cw, cw)
      }
      ctx.restore()
    }
    ctx.globalAlpha = savedAlpha
    return
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/canvas.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(render): guard and cyclops carry their weapons at idle; club raised during slam"
```

---

### Task 6: Full verification + runtime eyeball

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Full test suite**

Run from the repo root: `npm test`
Expected: all tests PASS. Paste the summary line as evidence.

- [ ] **Step 2: Runtime eyeball via Playwright-driven Electron**

The Electron game can be run and observed on WSLg (DISPLAY=:0) with `playwright-core`'s `_electron` (see the project memory note "Verify editor with Playwright"). Write a throwaway script in the session scratchpad (NOT in the repo) that:

1. Launches the game: `_electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })` from the repo root.
2. Uses the `level<N>` cheat or the menu to reach a level with guards/monsters (any early level works), and walks the player next to an enemy (send arrow-key presses via `page.keyboard`).
3. Takes 3–4 screenshots ~150ms apart while an enemy attacks, saved to the scratchpad.
4. Also screenshots a guard and the cyclops standing idle (held sword / club visible).

Inspect the screenshots: guard shows an idle sword and a blue-white arc swing when it hits; monster shows claw marks; crab shows the red pincer snap; cyclops shows the held club, the club swing on contact hits, and the raised club during its slam. The player's own attack must look unchanged.

- [ ] **Step 3: Check for editor-autosave side effects**

Run: `git status --porcelain renderer/data/`
Expected: empty. If `painter-maps.json` changed, restore it: `git checkout renderer/data/painter-maps.json`.

- [ ] **Step 4: Fix anything the eyeball reveals**

Tuning-level fixes (offsets, scales, tints) can be applied directly with a follow-up commit `fix(render): tune enemy weapon offsets/tints`. Anything behavioral goes back to the responsible task's module with a test.

- [ ] **Step 5: Final commit (if any tuning happened) and report**

Report results with the test summary and screenshot paths. Then use the superpowers:finishing-a-development-branch skill to decide integration (merge/PR).
