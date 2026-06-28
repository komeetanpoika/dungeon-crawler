# Melee Knockback + Damage I-Frames & Flicker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weapon-scaled animated knockback to player melee hits, plus a post-hit invulnerability window during which the player sprite flickers.

**Architecture:** Two new pure modules — `knockback.js` (decaying-velocity slide, collision injected) and `player-damage.js` (a single `damagePlayer` funnel with i-frames) — are wired into the existing `update()`/render flow. All scattered `player.hp -= …` sites route through the funnel, tagged `'hit'` (respects i-frames) or `'dot'` (always applies). The existing instant knockbacks (cyclops charge, boss tail) convert to the shared slide.

**Tech Stack:** Vanilla ES modules (Electron renderer), `node:test` + `node:assert/strict`, `playwright-core` (`_electron`) for runtime smoke check.

## Global Constraints

- `INVULN_DURATION = 0.8` (s) — the i-frame / flicker window. Exported once from `player-damage.js`.
- Flicker `interval = 0.08` (s).
- Knockback `DRAG = 25` (1/s), settle threshold `5` px/s. Melee slide distances: snap 10, arc 18, slash 24, spin 34 (px). Reused magnitudes: cyclops charge 60, boss tail 26.
- Pure logic (`knockback.js`, `player-damage.js`, `isFlickerVisible`) stays free of DOM/map access so it is importable under `node --test`; collision is injected via a `canMove(px, py)` predicate.
- The **dragon boss is exempt** from melee knockback. All other enemies are knocked.
- Invulnerability blocks **only** `'hit'` damage. `'dot'` (dragon/boss fire cone, crab grab tick) always applies and never grants i-frames.
- `'hit'`-paired effects (knockback/stun) fire only when the hit actually lands (i.e., `damagePlayer(...) === true`).
- Knocked entities **stop at walls** (per-axis collision); they never slide through.
- `TILE_SIZE` is `32` throughout.

---

### Task 1: Knockback module (`knockback.js`)

**Files:**
- Create: `renderer/systems/knockback.js`
- Test: `test/knockback.test.js`

**Interfaces:**
- Produces:
  - `startKnockback(entity, dirX, dirY, distance)` — sets `entity.knockback = { vx, vy }` (px/s) in the normalized `(dirX,dirY)` direction, calibrated to slide ≈`distance` px. No-op on zero direction or `distance <= 0`.
  - `stepKnockback(entity, delta, canMove)` — advances the slide one frame: moves per-axis (a blocked axis stops at the wall via `canMove(px,py)`), updates `entity.x/y`, applies drag, clears `entity.knockback` once settled. No-op when `entity.knockback` is absent.

- [ ] **Step 1: Write the failing test**

Create `test/knockback.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startKnockback, stepKnockback } from '../renderer/systems/knockback.js'

const FREE = () => true

describe('startKnockback', () => {
  it('sets velocity along the normalized direction, scaled to distance', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 2, 0, 10)          // DRAG=25 -> v0 = 10*25 = 250
    assert.ok(e.knockback)
    assert.equal(Math.round(e.knockback.vx), 250)
    assert.equal(Math.round(e.knockback.vy), 0)
  })

  it('is a no-op for a zero direction', () => {
    const e = { px: 0, py: 0 }
    startKnockback(e, 0, 0, 10)
    assert.equal(e.knockback, undefined)
  })
})

describe('stepKnockback', () => {
  it('slides the entity approximately the requested distance with no walls', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 1, 0, 30)
    for (let i = 0; i < 2000 && e.knockback; i++) stepKnockback(e, 0.001, FREE)
    const travelled = e.px - 100
    assert.ok(travelled > 27 && travelled < 33, `travelled=${travelled}`)
    assert.equal(e.knockback, null)        // cleared once settled
  })

  it('stops at a wall on the blocked axis', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 1, 0, 50)
    // Wall: cannot move past x = 110
    const canMove = (px) => px <= 110
    for (let i = 0; i < 2000 && e.knockback; i++) stepKnockback(e, 0.001, canMove)
    assert.ok(e.px <= 110, `px=${e.px}`)
  })

  it('updates tile coords from pixel position', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 1, 0, 30)
    stepKnockback(e, 0.05, FREE)
    assert.equal(e.x, Math.floor(e.px / 32))
    assert.equal(e.y, Math.floor(e.py / 32))
  })

  it('is a no-op when there is no knockback', () => {
    const e = { px: 5, py: 5 }
    stepKnockback(e, 0.1, FREE)            // must not throw
    assert.equal(e.px, 5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/knockback.test.js`
Expected: FAIL — cannot find module `../renderer/systems/knockback.js`.

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/knockback.js`:

```js
// Per-entity knockback as a decaying velocity. Pure: no DOM, no map access —
// collision is injected via a canMove(px, py) predicate so it is unit-testable.

const TILE = 32
const DRAG = 25        // 1/s; total slide distance ≈ v0 / DRAG. ~0.12s to settle.
const STOP_SPEED = 5   // px/s; below this the slide is finished.

// Give `entity` a knockback velocity in unit direction (dirX, dirY), calibrated
// so it slides ~`distance` px before settling. Zero/degenerate input is a no-op.
export function startKnockback(entity, dirX, dirY, distance) {
  const len = Math.hypot(dirX, dirY)
  if (len === 0 || distance <= 0) return
  const v0 = distance * DRAG
  entity.knockback = { vx: (dirX / len) * v0, vy: (dirY / len) * v0 }
}

// Advance one frame. Moves per-axis (a blocked axis stops at the wall),
// updates tile coords, applies drag, and clears knockback once settled.
// Safe to call on an entity with no knockback.
export function stepKnockback(entity, delta, canMove) {
  const kb = entity.knockback
  if (!kb) return
  const nx = entity.px + kb.vx * delta
  if (canMove(nx, entity.py)) entity.px = nx
  else kb.vx = 0
  const ny = entity.py + kb.vy * delta
  if (canMove(entity.px, ny)) entity.py = ny
  else kb.vy = 0
  entity.x = Math.floor(entity.px / TILE)
  entity.y = Math.floor(entity.py / TILE)
  const decay = Math.exp(-DRAG * delta)
  kb.vx *= decay
  kb.vy *= decay
  if (Math.hypot(kb.vx, kb.vy) < STOP_SPEED) entity.knockback = null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/knockback.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/knockback.js test/knockback.test.js
git commit -m "feat(combat): knockback slide module (decaying velocity, wall-stop)"
```

---

### Task 2: Player damage funnel (`player-damage.js`)

**Files:**
- Create: `renderer/systems/player-damage.js`
- Test: `test/player-damage.test.js`

**Interfaces:**
- Produces:
  - `INVULN_DURATION` — constant `0.8`.
  - `damagePlayer(state, amount, kind, message)` → `boolean`. `kind` is `'hit'` or `'dot'`. Returns `true` if damage was applied, `false` if blocked by an active i-frame. Mutates `state.player.hp`, `state.player.invulnTimer`, and `state.log`.

- [ ] **Step 1: Write the failing test**

Create `test/player-damage.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer, INVULN_DURATION } from '../renderer/systems/player-damage.js'

function freshState() {
  return { player: { hp: 10 }, log: [] }
}

describe('damagePlayer', () => {
  it("'hit' applies damage, sets invuln, logs, returns true", () => {
    const s = freshState()
    const applied = damagePlayer(s, 3, 'hit', 'ouch')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 7)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
    assert.deepEqual(s.log, ['ouch'])
  })

  it("'hit' is blocked while invulnerable (no damage, returns false)", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    const applied = damagePlayer(s, 3, 'hit', 'ouch')
    assert.equal(applied, false)
    assert.equal(s.player.hp, 10)
    assert.deepEqual(s.log, [])
  })

  it("'dot' always applies and never sets invuln", () => {
    const s = freshState()
    const applied = damagePlayer(s, 1, 'dot', 'fire')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, undefined)
  })

  it("'dot' applies even while invulnerable, leaving invuln untouched", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    damagePlayer(s, 1, 'dot', 'fire')
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, 0.5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/player-damage.test.js`
Expected: FAIL — cannot find module `../renderer/systems/player-damage.js`.

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/player-damage.js`:

```js
// Single funnel for all player damage. 'hit' respects and grants i-frames;
// 'dot' always applies and never touches them. Returns whether damage landed.

export const INVULN_DURATION = 0.8

export function damagePlayer(state, amount, kind, message) {
  const player = state.player
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  player.hp -= amount
  if (kind === 'hit') player.invulnTimer = INVULN_DURATION
  if (message) state.log = [...state.log, message].slice(-5)
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/player-damage.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/player-damage.js test/player-damage.test.js
git commit -m "feat(combat): damagePlayer funnel with hit/dot i-frames"
```

---

### Task 3: Flicker helper + player-render wiring (`canvas.js`)

**Files:**
- Modify: `renderer/render/canvas.js` (add `isFlickerVisible`; gate the player-sprite draw at ~line 588)
- Test: `test/canvas.test.js` (append cases; this file already imports from `canvas.js`)

**Interfaces:**
- Produces: `isFlickerVisible(invulnTimer, interval = 0.08)` → `boolean` — `true` when not invulnerable; otherwise alternates every `interval`.
- Consumes: `state.player.invulnTimer` (set in Task 4; absent today → helper returns `true`, so the player always draws until Task 4 lands).

- [ ] **Step 1: Write the failing test**

Append to `test/canvas.test.js` (add the import name to the existing top-of-file import from `'../renderer/render/canvas.js'`, then add this describe block at the end of the file):

```js
import { isFlickerVisible } from '../renderer/render/canvas.js'

describe('isFlickerVisible', () => {
  it('is always visible when not invulnerable', () => {
    assert.equal(isFlickerVisible(0), true)
    assert.equal(isFlickerVisible(undefined), true)
    assert.equal(isFlickerVisible(-1), true)
  })

  it('alternates on the interval boundary', () => {
    assert.equal(isFlickerVisible(0.04), true)   // bucket 0
    assert.equal(isFlickerVisible(0.10), false)  // bucket 1
    assert.equal(isFlickerVisible(0.20), true)   // bucket 2
  })
})
```

(If `canvas.test.js` already imports specific names from `canvas.js`, add `isFlickerVisible` to that existing import instead of writing a second `import` line.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/canvas.test.js`
Expected: FAIL — `isFlickerVisible` is not exported.

- [ ] **Step 3: Add the helper**

In `renderer/render/canvas.js`, add this exported function near the other module-level helpers (e.g., just above `function drawEntity`):

```js
// Whether to draw the player this frame. Flickers while invulnerable (i-frames).
export function isFlickerVisible(invulnTimer, interval = 0.08) {
  if (!(invulnTimer > 0)) return true
  return Math.floor(invulnTimer / interval) % 2 === 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/canvas.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the flicker into the player draw**

In `renderer/render/canvas.js`, the player is drawn at ~line 588:

```js
    drawEntity(ctx, player, ppx, ppy, S, sprites)
```

Wrap it so it is skipped on "off" flicker frames:

```js
    if (isFlickerVisible(player.invulnTimer)) drawEntity(ctx, player, ppx, ppy, S, sprites)
```

Leave the following `if (player.grabbed) { … }` overlay and `drawMeleeSwing(...)` lines unchanged.

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — same totals as before plus the two new `isFlickerVisible` cases.

- [ ] **Step 7: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(render): player flicker during i-frames"
```

---

### Task 4: Route all player damage through the funnel; convert charge/tail knockback

**Files:**
- Modify: `renderer/game.js` (imports; invuln decrement; generic contact; dragon fire breath; enemy-projectile hit)
- Modify: `renderer/systems/cyclops.js` (imports; contact; charge hit + slide)
- Modify: `renderer/systems/crab.js` (imports; grab tick `dot`; contact `hit`)
- Modify: `renderer/systems/dragonboss.js` (imports; contact; cone `dot`; tail `hit` + slide; remove dead `knockback`/`tileWalkable`)
- Test: `test/cyclops.test.js` (add a charge-hit test)

**Interfaces:**
- Consumes: `damagePlayer` (Task 2), `startKnockback` (Task 1).
- Produces: `state.player.invulnTimer` (number, set by hits, decremented each frame) — read by Task 3's flicker.

- [ ] **Step 1: Write the failing test (cyclops charge hit)**

Append to `test/cyclops.test.js` (inside or after the existing `describe('updateCyclops — state transitions', …)` block). This drives a cyclops that is mid-charge and adjacent to the player:

```js
describe('updateCyclops — charge hit', () => {
  it('damages and knocks back the player, then stuns; respects i-frames', () => {
    const S = 32
    const c = makeCyclops(5, 5)
    c.state = 'charging'
    c.stateTimer = 1
    c.chargeAngle = 0                       // charging east, toward the player
    c.px = 5 * S + 16; c.py = 5 * S + 16
    const player = { x: 5, y: 5, px: c.px + 10, py: c.py, hp: 20, grabbed: false }
    const state = { player, map: [], log: [] }

    updateCyclops(c, state, 0.016)

    assert.equal(player.hp, 15)             // -5
    assert.ok(player.knockback, 'player gets a knockback slide')
    assert.ok(player.knockback.vx > 0, 'knocked away from the cyclops (eastward)')
    assert.equal(c.state, 'stunned')

    // Second charge while invulnerable does no further damage.
    const c2 = makeCyclops(5, 5)
    c2.state = 'charging'; c2.stateTimer = 1; c2.chargeAngle = 0
    c2.px = player.px - 10; c2.py = player.py
    player.invulnTimer = 0.8
    const hpBefore = player.hp
    updateCyclops(c2, state, 0.016)
    assert.equal(player.hp, hpBefore, 'no damage during i-frames')
  })
})
```

(`updateCyclops` and `makeCyclops` are already imported at the top of `test/cyclops.test.js`. The `map: []` is fine — `canMoveTo` over an empty map treats tiles as out-of-bounds, but knockback is set on the player by `startKnockback` regardless of the later step.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/cyclops.test.js`
Expected: FAIL — `player.knockback` is undefined (charge still does instant `player.px += …`) and/or i-frame path not respected.

- [ ] **Step 3: Update `cyclops.js` — imports**

At the top of `renderer/systems/cyclops.js`, add:

```js
import { damagePlayer } from './player-damage.js'
import { startKnockback } from './knockback.js'
```

- [ ] **Step 4: Update `cyclops.js` — contact damage**

Replace the contact block (currently):

```js
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      player.hp -= CONTACT_DAMAGE
      e.damageCooldown = CONTACT_COOLDOWN
      e.inCombat = true
      state.log = [...state.log, `Cyclops hits! (-${CONTACT_DAMAGE} HP)`].slice(-5)
    }
```

with:

```js
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      if (damagePlayer(state, CONTACT_DAMAGE, 'hit', `Cyclops hits! (-${CONTACT_DAMAGE} HP)`)) {
        e.damageCooldown = CONTACT_COOLDOWN
        e.inCombat = true
      }
    }
```

- [ ] **Step 5: Update `cyclops.js` — charge hit + slide**

Replace the charge-hit block (currently lines ~103-112):

```js
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
```

with (the charge resolves into a stun regardless; only damage + knockback are gated on the hit landing):

```js
      if (Math.hypot(e.px - player.px, e.py - player.py) < 50) {
        if (damagePlayer(state, 5, 'hit', 'Cyclops charges! (-5 HP)')) {
          startKnockback(player, player.px - e.px, player.py - e.py, KNOCKBACK_DIST)
          e.inCombat = true
        }
        e.state = 'stunned'
        e.stateTimer = 0.5
      }
```

- [ ] **Step 6: Run the cyclops test to verify it passes**

Run: `node --test test/cyclops.test.js`
Expected: PASS (existing cyclops tests + the new charge-hit test).

- [ ] **Step 7: Update `crab.js`**

At the top of `renderer/systems/crab.js`, add:

```js
import { damagePlayer } from './player-damage.js'
```

Replace the grab pincer tick (currently lines ~64-68):

```js
    if (e.grabDamageTimer <= 0) {
      player.hp -= 1
      e.grabDamageTimer = GRAB_DMG_INTERVAL
      e.inCombat = true
      state.log = [...state.log, 'Crab pincer! (-1 HP)'].slice(-5)
    }
```

with (grab pincer is sustained — tag `dot`):

```js
    if (e.grabDamageTimer <= 0) {
      damagePlayer(state, 1, 'dot', 'Crab pincer! (-1 HP)')
      e.grabDamageTimer = GRAB_DMG_INTERVAL
      e.inCombat = true
    }
```

Replace the contact block (currently lines ~101-105):

```js
  if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
    player.hp -= CONTACT_DAMAGE
    e.damageCooldown = CONTACT_COOLDOWN
    e.inCombat = true
    state.log = [...state.log, 'Crab pinches! (-1 HP)'].slice(-5)
  }
```

with:

```js
  if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
    if (damagePlayer(state, CONTACT_DAMAGE, 'hit', 'Crab pinches! (-1 HP)')) {
      e.damageCooldown = CONTACT_COOLDOWN
      e.inCombat = true
    }
  }
```

- [ ] **Step 8: Update `dragonboss.js` — imports + contact + cone**

At the top of `renderer/systems/dragonboss.js`, add:

```js
import { damagePlayer } from './player-damage.js'
import { startKnockback } from './knockback.js'
```

Replace the contact block (currently lines ~67-71):

```js
  if (dist < BOSS_CONTACT && e.damageCooldown <= 0) {
    player.hp -= CONTACT_DMG
    e.damageCooldown = CONTACT_CD
    state.log = [...state.log, `Hit for ${CONTACT_DMG} damage!`].slice(-5)
  }
```

with:

```js
  if (dist < BOSS_CONTACT && e.damageCooldown <= 0) {
    if (damagePlayer(state, CONTACT_DMG, 'hit', `Hit for ${CONTACT_DMG} damage!`)) {
      e.damageCooldown = CONTACT_CD
    }
  }
```

Replace the `coneDamage` inner loop (currently lines ~159-162):

```js
    while (e.dmgAcc >= 1) {
      player.hp -= 1; e.dmgAcc -= 1
      state.log = [...state.log, 'Dragon fire! (-1 HP)'].slice(-5)
    }
```

with (fire cone is sustained — tag `dot`):

```js
    while (e.dmgAcc >= 1) {
      damagePlayer(state, 1, 'dot', 'Dragon fire! (-1 HP)')
      e.dmgAcc -= 1
    }
```

- [ ] **Step 9: Update `dragonboss.js` — tail slide + remove dead helpers**

Replace the tail-hit block (currently lines ~118-122):

```js
      if (k > 0.3 && k < 0.8 && e.dmgAcc === 0 && inTailArc(e, player)) {
        player.hp -= TAIL_DMG; e.dmgAcc = 1
        knockback(e, player, state.map)
        state.log = [...state.log, `Tail sweep! (-${TAIL_DMG})`].slice(-5)
      }
```

with:

```js
      if (k > 0.3 && k < 0.8 && e.dmgAcc === 0 && inTailArc(e, player)) {
        e.dmgAcc = 1
        if (damagePlayer(state, TAIL_DMG, 'hit', `Tail sweep! (-${TAIL_DMG})`)) {
          startKnockback(player, player.px - e.px, player.py - e.py, KNOCKBACK)
        }
      }
```

Then delete the now-unused local `knockback` function (currently lines ~166-171):

```js
function knockback(e, player, map) {
  const dx = player.px - e.px, dy = player.py - e.py, d = Math.hypot(dx, dy) || 1
  const nx = player.px + (dx / d) * KNOCKBACK, ny = player.py + (dy / d) * KNOCKBACK
  if (tileWalkable(map, nx, player.py)) { player.px = nx; player.x = Math.floor(nx / TILE) }
  if (tileWalkable(map, player.px, ny)) { player.py = ny; player.y = Math.floor(ny / TILE) }
}
```

Confirm `tileWalkable` has no other callers, then delete it too:

Run: `grep -n "tileWalkable" renderer/systems/dragonboss.js`
Expected: after deleting `knockback`, the only remaining match is the `function tileWalkable(...)` definition (~line 150). Delete that function. Re-run the grep; expect **no matches**. (`KNOCKBACK` is still used by the new `startKnockback` call, so keep that constant.)

- [ ] **Step 10: Update `game.js` — import + invuln decrement**

At the top of `renderer/game.js`, add the import (next to the other `./systems/*` imports):

```js
import { damagePlayer } from './systems/player-damage.js'
```

In `update()`, just after the combat-cooldown decrements (currently around line 359, after `player.attackTimer = Math.max(0, player.attackTimer - delta)`), add:

```js
  player.invulnTimer = Math.max(0, (player.invulnTimer ?? 0) - delta)
```

- [ ] **Step 11: Update `game.js` — generic contact, dragon breath, enemy projectile**

Replace the generic contact block (currently lines ~554-559):

```js
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      const contactDmg = e.type === 'dragon' ? 2 : 1
      player.hp -= contactDmg
      e.damageCooldown = CONTACT_DAMAGE_COOLDOWN
      state.log = [...state.log, `Hit for ${contactDmg} damage!`].slice(-5)
    }
```

with:

```js
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      const contactDmg = e.type === 'dragon' ? 2 : 1
      if (damagePlayer(state, contactDmg, 'hit', `Hit for ${contactDmg} damage!`)) {
        e.damageCooldown = CONTACT_DAMAGE_COOLDOWN
      }
    }
```

Replace the dragon (L9) fire-breath damage loop (currently lines ~491-496):

```js
            e.breathDamageAcc += 3 * delta
            while (e.breathDamageAcc >= 1) {
              player.hp -= 1
              e.breathDamageAcc -= 1
              state.log = [...state.log, 'Dragon fire! (-1 HP)'].slice(-5)
            }
```

with (fire is sustained — tag `dot`):

```js
            e.breathDamageAcc += 3 * delta
            while (e.breathDamageAcc >= 1) {
              damagePlayer(state, 1, 'dot', 'Dragon fire! (-1 HP)')
              e.breathDamageAcc -= 1
            }
```

Replace the enemy-projectile hit block (currently lines ~417-421):

```js
      if (Math.hypot(player.px - p.px, player.py - p.py) < 10) {
        player.hp -= p.damage
        state.log = [...state.log, `Hit for ${p.damage} damage!`].slice(-5)
        hit = true
      }
```

with (the projectile is consumed on contact; damage applies only if not invulnerable):

```js
      if (Math.hypot(player.px - p.px, player.py - p.py) < 10) {
        damagePlayer(state, p.damage, 'hit', `Hit for ${p.damage} damage!`)
        hit = true
      }
```

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new cyclops charge-hit test. No `player.hp -= …` remains for enemy/trap damage (verify next step).

- [ ] **Step 13: Confirm the funnel is complete**

Run: `grep -rn "player.hp -=" renderer/`
Expected: **no matches** (all player-damage sites now go through `damagePlayer`). Healing (`player.hp +=`) is unaffected and may still appear.

- [ ] **Step 14: Commit**

```bash
git add renderer/game.js renderer/systems/cyclops.js renderer/systems/crab.js renderer/systems/dragonboss.js test/cyclops.test.js
git commit -m "feat(combat): route player damage through damagePlayer (i-frames); slide charge/tail knockback"
```

---

### Task 5: Melee knockback + per-frame knockback step

**Files:**
- Modify: `renderer/game.js` (`ATTACK_STYLES` knockback fields; `getAttack` fallback; melee hit block; per-frame `stepKnockback` pass; import)
- Runtime verification only (no unit test — `game.js` is the renderer entry, not imported by tests; logic it relies on is covered by Tasks 1–2).

**Interfaces:**
- Consumes: `startKnockback`, `stepKnockback` (Task 1); `canMoveTo` (existing, `renderer/game.js:104`); `PLAYER_HALF`, `ENEMY_HALF` (existing consts).

- [ ] **Step 1: Import the knockback functions**

At the top of `renderer/game.js`, add (next to the Task 4 import):

```js
import { startKnockback, stepKnockback } from './systems/knockback.js'
```

- [ ] **Step 2: Add per-weapon knockback distances**

Replace `ATTACK_STYLES` and the `getAttack` fallback (currently lines ~40-49):

```js
const ATTACK_STYLES = {
  dagger:    { style: 'snap',  duration: 0.12, cooldown: 0.30 },
  sword:     { style: 'arc',   duration: 0.20, cooldown: 0.40 },
  longsword: { style: 'slash', duration: 0.22, cooldown: 0.50 },
  axe:       { style: 'spin',  duration: 0.35, cooldown: 0.60 },
}

function getAttack(weaponType) {
  return ATTACK_STYLES[weaponType] ?? { style: 'arc', duration: 0.20, cooldown: 0.40 }
}
```

with:

```js
const ATTACK_STYLES = {
  dagger:    { style: 'snap',  duration: 0.12, cooldown: 0.30, knockback: 10 },
  sword:     { style: 'arc',   duration: 0.20, cooldown: 0.40, knockback: 18 },
  longsword: { style: 'slash', duration: 0.22, cooldown: 0.50, knockback: 24 },
  axe:       { style: 'spin',  duration: 0.35, cooldown: 0.60, knockback: 34 },
}

function getAttack(weaponType) {
  return ATTACK_STYLES[weaponType] ?? { style: 'arc', duration: 0.20, cooldown: 0.40, knockback: 18 }
}
```

- [ ] **Step 3: Apply knockback on melee hits**

In the melee block, replace the enemy-rebuild lines (currently lines ~379-380):

```js
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        return { ...e, hp: e.hp - dmg, inCombat: true }
```

with (boss exempt; all other hit enemies slide away from the player):

```js
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        const hitEnemy = { ...e, hp: e.hp - dmg, inCombat: true }
        if (e.type !== 'dragon_boss') {
          startKnockback(hitEnemy, hitEnemy.px - player.px, hitEnemy.py - player.py, atk.knockback)
        }
        return hitEnemy
```

- [ ] **Step 4: Add the per-frame knockback step**

In `update()`, immediately before the "Clear hit flash" line (currently line ~604, `if (state.hitEffects?.length > 0) state.hitEffects = []`), add:

```js
  // Resolve knockback slides after AI has moved everything this frame.
  for (const e of state.entities) {
    stepKnockback(e, delta, (px, py) => canMoveTo(map, px, py, ENEMY_HALF))
  }
  stepKnockback(player, delta, (px, py) => canMoveTo(map, px, py, PLAYER_HALF))
```

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — unchanged totals from Task 4 (this task adds no unit tests; it must not break existing ones).

- [ ] **Step 6: Runtime smoke check (app boots + loop runs without errors)**

Create `scratchpad/verify-knockback.mjs` in the scratchpad dir
(`/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/1dfcef2c-dcab-45d2-a9ea-fb6f4fddeba9/scratchpad`).
Note: `playwright-core` resolves from the project's `node_modules`; if ESM cannot resolve it from the scratchpad, copy this file to the project root to run it, then delete the copy (do not commit it).

```js
import { _electron as electron } from 'playwright-core'

const app = await electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', e => errors.push(String(e)))
win.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await win.waitForSelector('#menu-overlay', { state: 'visible' })
for (const ch of 'level3') await win.keyboard.press(ch)   // cheat: start a run
await win.waitForFunction(() => {
  const el = document.getElementById('menu-overlay')
  return el && el.style.display === 'none'
}, { timeout: 5000 })

// Let the update/render loop (incl. stepKnockback + invuln decay) run a few seconds.
await win.waitForTimeout(3000)

if (errors.length) { console.log('FAIL: runtime errors:\n' + errors.join('\n')); await app.close(); process.exit(1) }
console.log('PASS: app booted and ran a level for 3s with no runtime errors')
await app.close()
```

Run: `DISPLAY=:0 node scratchpad/verify-knockback.mjs`
Expected: prints `PASS: app booted and ran a level for 3s with no runtime errors`, exit 0. If Electron cannot launch in this environment, report the exact error (the unit tests remain the hard gate).

- [ ] **Step 7: Manual combat confirmation**

Run: `npm start`. Start a run (or type `level3` on the title), then:
- Hit an enemy with melee — it should **slide away** a short distance (further with heavier weapons), stopping at walls.
- Let an enemy hit you — the player should **flicker** for ~0.8s and take **no further hit damage** during that window (walking into fire/grab still ticks).

Confirm both behaviors look right.

- [ ] **Step 8: Commit**

```bash
git add renderer/game.js
git commit -m "feat(combat): weapon-scaled melee knockback + per-frame slide step"
```

---

## Self-Review

**Spec coverage:**
- Knockback slide mechanism (Unit 1) → Task 1. ✓
- Weapon-scaled melee knockback + boss exemption (Unit 2/3) → Task 5 Steps 2-3. ✓
- Central player damage + i-frames (Unit 2 of spec) → Task 2 + Task 4. ✓
- Convert cyclops charge & boss tail to slide (Unit 4) → Task 4 Steps 5, 9. ✓
- Central knockback step (Unit 5) → Task 5 Step 4. ✓
- Flicker render (Unit 6) → Task 3. ✓
- Damage-source tagging table → Task 4 (contact=hit, fire/grab=dot, charge/tail/slam/projectile=hit). ✓ (Enemy projectile, a `player.hp -=` site not in the spec's table, is covered as `hit` per the spec's "every scattered site is refactored" rule — Task 4 Step 11.)
- i-frames block only hits; dot always applies → Task 2 logic + tags. ✓
- Wall-stop, degenerate-direction, missing-field safety → Task 1 + null-safe reads. ✓
- Testing (knockback, player-damage, isFlickerVisible, cyclops charge update) → Tasks 1-4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✓

**Type consistency:** `startKnockback(entity, dirX, dirY, distance)` / `stepKnockback(entity, delta, canMove)` / `damagePlayer(state, amount, kind, message)` / `isFlickerVisible(invulnTimer, interval)` are used identically across Tasks 1-5. `entity.knockback = { vx, vy }` shape and `player.invulnTimer` (number) are consistent between producer (Tasks 1, 2, 4) and consumers (Tasks 3, 5). ✓
