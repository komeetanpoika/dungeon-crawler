# Walk Animation (Step Sway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player, guards, and the wizard visibly *walk* — rocking side-to-side from their feet while moving — instead of gliding as static sprites.

**Architecture:** A new pure module `renderer/systems/walk.js` tracks a per-entity walk phase that advances by distance actually moved, plus an eased amplitude that ramps to zero when idle. `game.js` ticks it each frame for humanoid entities. `canvas.js` draws those sprites rotated about their feet by the derived tilt.

**Tech Stack:** Vanilla ES modules, HTML5 canvas 2D, `node --test` for unit tests. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-08-walk-animation-design.md`

---

### Task 1: Walk-state module (`walk.js`)

**Files:**
- Create: `renderer/systems/walk.js`
- Test: `test/walk.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/walk.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tickWalk, walkTilt, MAX_TILT } from '../renderer/systems/walk.js'

describe('tickWalk', () => {
  it('advances walkPhase when the entity moves', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)          // first call seeds _wpx/_wpy, no movement yet
    const p0 = e.walkPhase ?? 0
    e.px = 10
    tickWalk(e, 0.016)
    assert.ok(e.walkPhase > p0, 'walkPhase should increase after moving')
  })

  it('does not advance walkPhase when the entity is still', () => {
    const e = { px: 5, py: 5 }
    tickWalk(e, 0.016)
    const p0 = e.walkPhase ?? 0
    tickWalk(e, 0.016)          // px/py unchanged
    assert.equal(e.walkPhase ?? 0, p0)
  })

  it('ramps swayAmp up toward 1 while moving', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 30; i++) { e.px += 2; tickWalk(e, 0.016) }
    assert.ok(e.swayAmp > 0.5, `swayAmp should rise while moving, got ${e.swayAmp}`)
  })

  it('decays swayAmp toward 0 when stopped', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 30; i++) { e.px += 2; tickWalk(e, 0.016) }  // build amp up
    for (let i = 0; i < 60; i++) { tickWalk(e, 0.016) }              // now hold still
    assert.ok(e.swayAmp < 0.01, `swayAmp should decay when idle, got ${e.swayAmp}`)
  })
})

describe('walkTilt', () => {
  it('is exactly 0 when idle (settles upright)', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 60; i++) { tickWalk(e, 0.016) }
    assert.equal(walkTilt(e), 0)
  })

  it('is non-zero at some point mid-stride while moving', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    let sawTilt = false
    for (let i = 0; i < 40; i++) { e.px += 3; tickWalk(e, 0.016); if (Math.abs(walkTilt(e)) > 0.5) sawTilt = true }
    assert.ok(sawTilt, 'tilt should be non-zero while walking')
  })

  it('never exceeds MAX_TILT in magnitude', () => {
    const e = { px: 0, py: 0 }
    tickWalk(e, 0.016)
    for (let i = 0; i < 200; i++) { e.px += 4; tickWalk(e, 0.016); assert.ok(Math.abs(walkTilt(e)) <= MAX_TILT + 1e-9) }
  })

  it('returns 0 for a fresh entity with no walk state', () => {
    assert.equal(walkTilt({}), 0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 walk`
Expected: FAIL — cannot import from `../renderer/systems/walk.js` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/walk.js`:

```js
// Procedural "step sway" walk animation.
// Phase advances by distance actually moved; amplitude eases in/out so a
// stopped character settles upright instead of freezing mid-tilt.

export const STRIDE_PX = 30      // px of travel per full left-right sway cycle
export const MAX_TILT  = 7        // degrees of peak rotation
const AMP_ATTACK = 12, AMP_DECAY = 10   // sway ramp-in / ease-out rate (per second)

function approach(cur, target, step) {
  if (cur < target) return Math.min(target, cur + step)
  return Math.max(target, cur - step)
}

// Advance an entity's walk state from how far it moved since the last call.
// Reads e.px/e.py; writes e.walkPhase, e.swayAmp, e._wpx, e._wpy.
export function tickWalk(e, delta) {
  const dx = e.px - (e._wpx ?? e.px)
  const dy = e.py - (e._wpy ?? e.py)
  e._wpx = e.px; e._wpy = e.py
  const moved = Math.hypot(dx, dy)
  if (moved > 0.01) e.walkPhase = (e.walkPhase ?? 0) + (moved / STRIDE_PX) * 2 * Math.PI
  const target = moved > 0.01 ? 1 : 0
  const rate = target > (e.swayAmp ?? 0) ? AMP_ATTACK : AMP_DECAY
  e.swayAmp = approach(e.swayAmp ?? 0, target, rate * delta)
}

// Current tilt in degrees (0 when idle).
export function walkTilt(e) {
  return Math.sin(e.walkPhase ?? 0) * MAX_TILT * (e.swayAmp ?? 0)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass, including the new `walk` describe blocks. No regressions in existing suites.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/walk.js test/walk.test.js
git commit -m "feat: add procedural step-sway walk module"
```

---

### Task 2: Render sprites tilted about their feet (`canvas.js`)

**Files:**
- Modify: `renderer/render/canvas.js` (import at line 1-2; `drawImg` region ~line 67; `drawEntity` wizard block ~line 138, player block ~line 156, guard handling ~line 169-179)

No unit test — canvas rendering is verified manually in Task 4. Each step below is a concrete edit.

- [ ] **Step 1: Import the walk helpers**

At the top of `renderer/render/canvas.js`, add `walkTilt` to the imports. After:

```js
import { TILE } from '../systems/entities.js'
import { loadSprites } from './sprites.js'
```

add:

```js
import { walkTilt } from '../systems/walk.js'
```

- [ ] **Step 2: Add the `drawWalker` helper**

Immediately after the existing `drawImg` function (the one ending at the `ctx.restore() }` around line 74), add:

```js
function drawWalker(ctx, sprite, px, py, S, flip, tiltDeg) {
  ctx.save()
  ctx.translate(px + S / 2, py + S)        // pivot at the feet (center-bottom)
  ctx.rotate(tiltDeg * Math.PI / 180)
  ctx.scale(flip ? -1 : 1, 1)
  ctx.drawImage(sprite, -S / 2, -S, S, S)
  ctx.restore()
}
```

- [ ] **Step 3: Tilt the player (and its held weapon)**

In `drawEntity`, the player block currently reads:

```js
  if (entity.type === 'player') {
    const flip = entity.facing === 'west'
    if (sprites.player) drawImg(ctx, sprites.player, px, py, S, S, flip)
    if (entity.weapon) {
      const ws = sprites[`weapon_${entity.weapon.weaponType}`]
      if (ws) {
        const hw = Math.round(S * 0.5)
        const wx = flip ? px : px + S - hw
        ctx.drawImage(ws, wx, py + S - hw, hw, hw)
      }
    }
    return
  }
```

Replace it with a version that wraps the body sprite and the held-weapon overlay in one feet-pivot tilt, so the weapon rocks with the body:

```js
  if (entity.type === 'player') {
    const flip = entity.facing === 'west'
    const tilt = walkTilt(entity)
    ctx.save()
    ctx.translate(px + S / 2, py + S)        // pivot at the feet
    ctx.rotate(tilt * Math.PI / 180)
    ctx.scale(flip ? -1 : 1, 1)              // flip handled here, so draw un-flipped below
    if (sprites.player) ctx.drawImage(sprites.player, -S / 2, -S, S, S)
    if (entity.weapon) {
      const ws = sprites[`weapon_${entity.weapon.weaponType}`]
      if (ws) {
        const hw = Math.round(S * 0.5)
        // In this flipped local space, "behind on the right" is +x for both facings.
        ctx.drawImage(ws, S / 2 - hw, S - hw, hw, hw)
      }
    }
    ctx.restore()
    return
  }
```

- [ ] **Step 4: Tilt the wizard sprite only (shield aura unchanged)**

The wizard block currently reads:

```js
  if (entity.type === 'wizard') {
    if (sprites.wizard) ctx.drawImage(sprites.wizard, px, py, S, S)
    if (entity.shieldTimer > 0) {
```

Change only the sprite-draw line so the wizard sways while the shield arc that follows stays un-rotated:

```js
  if (entity.type === 'wizard') {
    if (sprites.wizard) drawWalker(ctx, sprites.wizard, px, py, S, false, walkTilt(entity))
    if (entity.shieldTimer > 0) {
```

(The shield `ctx.arc(...)` block below is untouched.)

- [ ] **Step 5: Tilt the guard**

The guard is currently rendered by the generic tail of `drawEntity` (the `switch` returning `sprites.guard`, drawn by `drawImg(ctx, s, px, py, S, S, flip)`). Give it its own block. Immediately **before** the crab block (`if (entity.type === 'crab') {`), add:

```js
  if (entity.type === 'guard') {
    const flip = entity.facing === 'west'
    if (sprites.guard) drawWalker(ctx, sprites.guard, px, py, S, flip, walkTilt(entity))
    return
  }
```

Then remove the now-dead `case 'guard':   return sprites.guard` line from the generic `switch` near the end of `drawEntity` (monster/trap/puzzle stay).

- [ ] **Step 6: Sanity-check syntax**

Run: `node --check renderer/render/canvas.js`
Expected: no output (exit 0) — file parses.

- [ ] **Step 7: Commit**

```bash
git add renderer/render/canvas.js
git commit -m "feat: tilt player, guard, wizard sprites about their feet while walking"
```

---

### Task 3: Tick walk state each frame (`game.js`)

**Files:**
- Modify: `renderer/game.js` (import line ~7; `update` body just before the `// Player death` check ~line 482)

- [ ] **Step 1: Import `tickWalk`**

After the existing render import:

```js
import { Renderer } from './render/canvas.js'
import { updateHUD } from './render/hud.js'
```

add:

```js
import { tickWalk } from './systems/walk.js'
```

- [ ] **Step 2: Tick the walkers after movement is resolved**

In `update(delta)`, find the `// Player death` comment block:

```js
  // Player death
  if (player.hp <= 0) {
    state.gameOver = true
    endRun(false)
  }
```

Immediately **before** it, insert:

```js
  // Walk animation — player + humanoid enemies (guards, wizard)
  tickWalk(player, delta)
  for (const e of state.entities)
    if (e.type === 'guard' || e.type === 'wizard') tickWalk(e, delta)

```

- [ ] **Step 3: Sanity-check syntax**

Run: `node --check renderer/game.js`
Expected: no output (exit 0).

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npm test 2>&1 | tail -15`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/game.js
git commit -m "feat: tick walk animation for player and humanoid enemies"
```

---

### Task 4: Manual visual verification

**Files:** none (run the app).

- [ ] **Step 1: Launch the game**

Run: `npm start`

- [ ] **Step 2: Verify the walk reads correctly**

Check, then close the window:
- Walking the player (WASD / arrows) makes it **rock side-to-side from its feet**; standing still settles it **upright** (no frozen tilt).
- A patrolling/chasing **guard** sways the same way; a **wizard** sways while its shield aura (when active) stays a steady circle.
- **Monsters/spiders, crab, cyclops, dragon do NOT sway** — unchanged from before.
- The held **weapon** stays in the player's hand and rocks with the body; the melee swing animation still fires normally.

- [ ] **Step 3 (optional): Tune feel**

If the sway is too strong/weak or too fast/slow, adjust `MAX_TILT` and `STRIDE_PX` in `renderer/systems/walk.js`, re-run `npm start`. If changed, commit:

```bash
git add renderer/systems/walk.js
git commit -m "tune: adjust walk sway feel"
```

---

## Notes for the implementer

- The game is **real-time with continuous `px`/`py` movement** — there is no turn/grid step. `tickWalk` deliberately derives motion from frame-to-frame `px`/`py` deltas, which is why it must run **after** all movement in `update`.
- Walk state (`walkPhase`, `swayAmp`, `_wpx`, `_wpy`) is created lazily on the entity via `?? 0`; entity factory functions in `entities.js`/`wizard.js` need **no** changes.
- `delta` is already clamped to ≤100 ms in `gameLoop`, so amplitude/phase steps stay bounded.
