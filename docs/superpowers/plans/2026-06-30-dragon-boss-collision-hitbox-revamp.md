# Dragon Boss — Collision & Hitbox Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dragon boss's point-based collision and hitboxes with a segmented-capsule body that blocks the player, deals contact damage where the body actually is, takes per-part melee hits (neck weak-spot), is immune to ranged, and stomps tile-by-tile with weight.

**Architecture:** A new pure-geometry module (`renderer/systems/capsules.js`) computes the dragon's three capsules (neck/core/tail) in world space from its position, facing, and animation state, plus point-in-capsule and weak-spot resolution. `systems/dragonboss.js` consumes it for grid-stomp locomotion, crush, and per-capsule contact damage. `game.js` consumes it for player-movement blocking, flat-1 melee with part modifiers, and ranged immunity. `render/canvas.js` gains a screenshake camera offset.

**Tech Stack:** Vanilla ES modules, `node:test` + `node:assert/strict`. No bundler. Tests live in `test/<name>.test.js` and run via `npm test` (`node --test test/`).

## Global Constraints

- ES modules only (`import`/`export`); no TypeScript, no new dependencies.
- Tile size is 32px; the constant is `TILE` (32) in systems, `TILE_SIZE` (32) in `game.js`.
- Local capsule frame matches the renderer: `-y` is forward (head), `+y` is back (tail); world transform rotates local coords by `e.facing` then offsets by `(e.px, e.py)`.
- Renderer body half-extents (the source of truth for geometry): `bw = 3*S`, `bh = 4*S` where `S = 32`. Neck tip ≈ local `(0, -bh*0.46)`, tail base ≈ local `(0, +bh*0.46)`.
- Pure modules (`capsules.js`) must not import FastAPI/DOM/Electron/map — geometry only.
- Melee damage against the dragon is a flat base of `1`, weapon damage ignored. Part modifiers: neck `1.5`, core `1.0`, tail `1.0`. On multi-capsule overlap, the highest modifier wins.
- Ranged (friendly projectiles) deal `0` to the dragon and do not consume the projectile on it.
- `BOSS_HP` stays `28` for now (playtest tuning knob — do not change in this plan).
- Tests use the existing helpers pattern from `test/dragonboss.test.js`: `openMap()`, `mkPlayer(px,py)`, `mkState(boss, player)`.

---

### Task 1: Pure capsule geometry module

**Files:**
- Create: `renderer/systems/capsules.js`
- Test: `test/capsules.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `export function pointInCapsule(px, py, ax, ay, bx, by, radius)` → `boolean` — true when point `(px,py)` is within `radius` of segment `a→b`.
  - `export function dragonCapsules(e)` → `Array<{ part: 'neck'|'core'|'tail', ax, ay, bx, by, radius }>` in **world space**, derived from `e.px, e.py, e.facing` and animation fields `e.neckRear`, `e.headAim`, `e.tailSwing` (all default to 0 if absent).
  - `export function hitPart(px, py, e)` → `'neck'|'core'|'tail'|null` — the part a point lands in; when the point is inside multiple capsules, returns the one with the highest damage modifier (`neck` > `core`/`tail`); `null` if in none.
  - `export const PART_MODIFIER = { neck: 1.5, core: 1.0, tail: 1.0 }`.

- [ ] **Step 1: Write the failing test for `pointInCapsule`**

Create `test/capsules.test.js`:

```javascript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pointInCapsule, dragonCapsules, hitPart, PART_MODIFIER } from '../renderer/systems/capsules.js'

describe('pointInCapsule', () => {
  it('true at a point on the segment', () => {
    assert.equal(pointInCapsule(5, 0, 0, 0, 10, 0, 2), true)
  })
  it('true within radius perpendicular to the segment', () => {
    assert.equal(pointInCapsule(5, 1.5, 0, 0, 10, 0, 2), true)
  })
  it('false beyond the radius perpendicular to the segment', () => {
    assert.equal(pointInCapsule(5, 3, 0, 0, 10, 0, 2), false)
  })
  it('true within radius past the endpoint (rounded cap)', () => {
    assert.equal(pointInCapsule(11, 0, 0, 0, 10, 0, 2), true)
  })
  it('false past the endpoint beyond the radius', () => {
    assert.equal(pointInCapsule(13, 0, 0, 0, 10, 0, 2), false)
  })
  it('handles a zero-length segment as a circle', () => {
    assert.equal(pointInCapsule(1, 1, 5, 5, 5, 5, 6), true)
    assert.equal(pointInCapsule(20, 20, 5, 5, 5, 5, 6), false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/capsules.test.js` (or `node --test test/capsules.test.js`)
Expected: FAIL — `Cannot find module '../renderer/systems/capsules.js'`.

- [ ] **Step 3: Implement `pointInCapsule` and `PART_MODIFIER`**

Create `renderer/systems/capsules.js`:

```javascript
// Pure geometry for the dragon boss's segmented body. No DOM/map/Electron imports.
// Local frame matches the renderer: -y forward (head), +y back (tail).

const TILE = 32

export const PART_MODIFIER = { neck: 1.5, core: 1.0, tail: 1.0 }

// Distance from point (px,py) to segment a->b, then compare to radius.
export function pointInCapsule(px, py, ax, ay, bx, by, radius) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + dx * t, cy = ay + dy * t
  return Math.hypot(px - cx, py - cy) <= radius
}
```

- [ ] **Step 4: Run the test to verify `pointInCapsule` passes**

Run: `npm test -- test/capsules.test.js`
Expected: PASS for the `pointInCapsule` block.

- [ ] **Step 5: Write the failing test for `dragonCapsules` (world transform)**

Add to `test/capsules.test.js`:

```javascript
function mkBoss(px, py, facing = 0) {
  return { px, py, facing, neckRear: 0, headAim: 0, tailSwing: 0 }
}

describe('dragonCapsules', () => {
  it('returns the three named parts', () => {
    const parts = dragonCapsules(mkBoss(320, 320, 0)).map(c => c.part)
    assert.deepEqual(parts.sort(), ['core', 'neck', 'tail'])
  })
  it('facing 0 (head toward +x) puts the neck capsule ahead in +x', () => {
    // facing 0 means the head points along +x in world space.
    const neck = dragonCapsules(mkBoss(320, 320, 0)).find(c => c.part === 'neck')
    // forward endpoint (the head tip) is the one furthest from the body centre
    const tip = Math.hypot(neck.ax - 320, neck.ay - 320) > Math.hypot(neck.bx - 320, neck.by - 320)
      ? { x: neck.ax, y: neck.ay } : { x: neck.bx, y: neck.by }
    assert.ok(tip.x > 320 + 32, `expected head tip ahead in +x, got ${tip.x}`)
    assert.ok(Math.abs(tip.y - 320) < 16, `expected head tip near centre y, got ${tip.y}`)
  })
  it('facing PI/2 (head toward +y) puts the neck tip below centre', () => {
    const neck = dragonCapsules(mkBoss(320, 320, Math.PI / 2)).find(c => c.part === 'neck')
    const tip = Math.hypot(neck.ax - 320, neck.ay - 320) > Math.hypot(neck.bx - 320, neck.by - 320)
      ? { x: neck.ax, y: neck.ay } : { x: neck.bx, y: neck.by }
    assert.ok(tip.y > 320 + 32, `expected head tip ahead in +y, got ${tip.y}`)
    assert.ok(Math.abs(tip.x - 320) < 16, `expected head tip near centre x, got ${tip.x}`)
  })
}
)
```

- [ ] **Step 6: Run the test to verify `dragonCapsules` fails**

Run: `npm test -- test/capsules.test.js`
Expected: FAIL — `dragonCapsules is not a function`.

- [ ] **Step 7: Implement `dragonCapsules`**

Add to `renderer/systems/capsules.js`. Local endpoints use the renderer's geometry
(`bw = 3*TILE`, `bh = 4*TILE`); `-y` is forward. `neckRear`/`headAim` nudge the neck
tip; `tailSwing` rotates the tail tip about the tail base. Transform local→world by
rotating by `facing + PI/2` (the renderer rotates the local `-y`/up axis onto
`facing`) and offsetting by `(px,py)`.

```javascript
// Local body half-extents — must track render/dragonboss.js (bw=3S, bh=4S).
const BW = 3 * TILE
const BH = 4 * TILE

// Local-frame part endpoints (before rotation). -y forward, +y back.
// Each returns {ax,ay,bx,by,radius} in LOCAL coords.
function localCapsules(e) {
  const neckRear = e.neckRear ?? 0
  const headAim = e.headAim ?? 0
  const tailSwing = e.tailSwing ?? 0

  // neck: from the shoulders (just ahead of centre) to the head tip out front.
  // neckRear pulls the tip back/up slightly during a windup; headAim shifts it sideways.
  // shoulderY/radius are tuned so the neck's rear cap stays AHEAD of the body centre,
  // i.e. a dead-centre hit resolves to core, not the neck weak-spot (|shoulderY| > radius).
  const shoulderY = -BH * 0.28
  const tipY = -BH * 0.62 + neckRear * BH * 0.14
  const tipX = Math.sin(headAim) * BW * 0.5
  const neck = { part: 'neck', ax: 0, ay: shoulderY, bx: tipX, by: tipY, radius: BW * 0.28 }

  // core: the main mass straddling the centre.
  const core = { part: 'core', ax: 0, ay: -BH * 0.16, bx: 0, by: BH * 0.30, radius: BW * 0.5 }

  // tail: from the tail base back to the tip; tailSwing rotates the tip sideways.
  const baseX = 0, baseY = BH * 0.30
  const tailLen = BH * 0.5
  const ang = Math.PI / 2 + tailSwing   // +y is back; swing rotates about base
  const tail = {
    part: 'tail', ax: baseX, ay: baseY,
    bx: baseX + Math.cos(ang) * tailLen, by: baseY + Math.sin(ang) * tailLen,
    radius: BW * 0.22,
  }
  return [neck, core, tail]
}

// Rotate a local point by the boss facing and offset to world coords.
// The renderer rotates local up (-y) onto `facing`, i.e. ctx.rotate(facing + PI/2).
function toWorld(lx, ly, px, py, facing) {
  const a = facing + Math.PI / 2
  const c = Math.cos(a), s = Math.sin(a)
  return [px + (lx * c - ly * s), py + (lx * s + ly * c)]
}

export function dragonCapsules(e) {
  const px = e.px, py = e.py, facing = e.facing ?? 0
  return localCapsules(e).map(cap => {
    const [ax, ay] = toWorld(cap.ax, cap.ay, px, py, facing)
    const [bx, by] = toWorld(cap.bx, cap.by, px, py, facing)
    return { part: cap.part, ax, ay, bx, by, radius: cap.radius }
  })
}
```

- [ ] **Step 8: Run the test to verify `dragonCapsules` passes**

Run: `npm test -- test/capsules.test.js`
Expected: PASS. If the `+y forward` vs `-y forward` orientation is flipped, the
facing-0 test will show the tip behind centre; the `facing + PI/2` rotation above is
correct against the renderer (`render/dragonboss.js:185`).

- [ ] **Step 9: Write the failing test for `hitPart` weak-spot resolution**

Add to `test/capsules.test.js`:

```javascript
describe('hitPart', () => {
  it('returns null for a far-away point', () => {
    assert.equal(hitPart(0, 0, mkBoss(320, 320, 0)), null)
  })
  it('returns core for a point at the body centre', () => {
    assert.equal(hitPart(320, 320, mkBoss(320, 320, 0)), 'core')
  })
  it('returns neck for a point at the head tip (facing 0 = +x)', () => {
    assert.equal(hitPart(320 + BH * 0.6, 320, mkBoss(320, 320, 0)), 'neck')
  })
  it('weak-spot wins: neck beats core where the capsules overlap', () => {
    // A point in the neck/core overlap zone resolves to neck (higher modifier).
    const boss = mkBoss(320, 320, 0)
    const caps = dragonCapsules(boss)
    const neck = caps.find(c => c.part === 'neck')
    // midpoint of the neck segment is inside both neck and (near) core
    const mx = (neck.ax + neck.bx) / 2, my = (neck.ay + neck.by) / 2
    assert.equal(hitPart(mx, my, boss), 'neck')
  })
})
```

Note: `BH` is not exported; add `const BH = 4 * 32` near the top of the test file's
helpers, or inline `4 * 32 * 0.6` in the assertion. Use a local `const BH = 128` in the
test to keep it readable.

- [ ] **Step 10: Run the test to verify `hitPart` fails**

Run: `npm test -- test/capsules.test.js`
Expected: FAIL — `hitPart is not a function`.

- [ ] **Step 11: Implement `hitPart`**

Add to `renderer/systems/capsules.js`:

```javascript
// Which part does the world point land in? On overlap, the highest modifier wins
// (neck weak-spot beats core/tail). Returns null when in no capsule.
export function hitPart(px, py, e) {
  let best = null, bestMod = -Infinity
  for (const cap of dragonCapsules(e)) {
    if (pointInCapsule(px, py, cap.ax, cap.ay, cap.bx, cap.by, cap.radius)) {
      const mod = PART_MODIFIER[cap.part]
      if (mod > bestMod) { best = cap.part; bestMod = mod }
    }
  }
  return best
}
```

- [ ] **Step 12: Run the full module test to verify all pass**

Run: `npm test -- test/capsules.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 13: Commit**

```bash
git add renderer/systems/capsules.js test/capsules.test.js
git commit -m "feat(dragon-boss): pure capsule geometry (point-in-capsule, world transform, weak-spot)"
```

---

### Task 2: Per-capsule contact damage (dragon → player)

Replaces the single 1.4-tile center circle with per-capsule contact in
`systems/dragonboss.js`.

**Files:**
- Modify: `renderer/systems/dragonboss.js` (imports at top; contact-damage block at lines 68-73)
- Test: `test/dragonboss.test.js` (add a describe block)

**Interfaces:**
- Consumes: `dragonCapsules`, `pointInCapsule` from `./capsules.js`.
- Produces: contact damage applies when the player overlaps any capsule (with the
  existing `CONTACT_DMG`/`CONTACT_CD` cooldown), not just a center circle.

- [ ] **Step 1: Write the failing test**

Add to `test/dragonboss.test.js`:

```javascript
describe('contact damage uses capsules', () => {
  it('damages the player standing against the flank, not just dead centre', () => {
    const boss = makeDragonBoss(10, 10)
    boss.px = 10 * 32 + 16; boss.py = 10 * 32 + 16; boss.facing = 0
    boss.damageCooldown = 0
    // Player ~2 tiles in FRONT — inside the neck capsule (which reaches ~2.5 tiles
    // forward), and outside the old 1.4-tile centre circle (44.8px). (The core's flank
    // radius is only ~1.5 tiles, so a side probe would sit outside every capsule.)
    const player = mkPlayer(boss.px + 2 * 32, boss.py)
    const state = mkState(boss, player)
    const hpBefore = player.hp
    updateDragonBoss(boss, state, 0.016)
    assert.ok(player.hp < hpBefore, 'expected contact damage from capsule overlap')
  })
  it('does not damage a player standing clear of every capsule', () => {
    const boss = makeDragonBoss(10, 10)
    boss.px = 10 * 32 + 16; boss.py = 10 * 32 + 16; boss.facing = 0
    boss.damageCooldown = 0
    const player = mkPlayer(boss.px + 10 * 32, boss.py)  // far away
    const state = mkState(boss, player)
    const hpBefore = player.hp
    updateDragonBoss(boss, state, 0.016)
    assert.equal(player.hp, hpBefore)
  })
})
```

- [ ] **Step 2: Run the test to verify the second case may pass but first fails**

Run: `npm test -- test/dragonboss.test.js`
Expected: FAIL on "damages the player standing against the flank" (old circle is only
1.4 tiles; player is 2 tiles off-center so no damage yet).

- [ ] **Step 3: Add the capsule import**

In `renderer/systems/dragonboss.js`, add after the existing imports (line 3):

```javascript
import { dragonCapsules, pointInCapsule, hitPart, PART_MODIFIER } from './capsules.js'
```

- [ ] **Step 4: Replace the center-circle contact block with a capsule check**

In `renderer/systems/dragonboss.js`, replace lines 68-73 (the `// contact damage`
block guarded by `dist < BOSS_CONTACT`) with:

```javascript
  // contact damage — overlapping ANY body capsule hurts, matching the visible body.
  // Only while NOT mid-attack: during an attack the attack itself is the damage source,
  // and sharing the i-frame window would eat that attack's dedicated knockback.
  if ((e.state === 'idle' || e.state === 'reposition') && e.damageCooldown <= 0 && playerTouchesBody(e, player)) {
    if (damagePlayer(state, CONTACT_DMG, 'hit', `Hit for ${CONTACT_DMG} damage!`)) {
      e.damageCooldown = CONTACT_CD
    }
  }
```

> Note: Task 4 replaces the `reposition` state with `stomp` (which has its own crush
> contact). When Task 4 lands, this gate becomes `e.state === 'idle'` — `stomp` handles
> its own contact via crush, so passive contact should not also fire during a step.

Then add this helper near the bottom of the file (next to `inTailArc`):

```javascript
function playerTouchesBody(e, player) {
  return dragonCapsules(e).some(c =>
    pointInCapsule(player.px, player.py, c.ax, c.ay, c.bx, c.by, c.radius))
}
```

`BOSS_CONTACT` is now unused — delete its declaration (line 8) to avoid a dead const.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/dragonboss.test.js`
Expected: PASS (both new cases plus all existing dragonboss tests).

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/dragonboss.js test/dragonboss.test.js
git commit -m "feat(dragon-boss): per-capsule contact damage replaces centre circle"
```

---

### Task 3: Attacks originate from real parts (breath from the mouth)

Move the cone damage origin from the body center to the head/neck tip so sidestepping
the forward cone is well-defined.

**Files:**
- Modify: `renderer/systems/dragonboss.js` (`coneDamage`, lines 153-162; its callers at lines 95 and 107)
- Test: `test/dragonboss.test.js`

**Interfaces:**
- Consumes: `dragonCapsules` (the neck capsule's tip endpoint is the mouth).
- Produces: cone damage emits from the head tip, not `(e.px,e.py)`.

- [ ] **Step 1: Write the failing test**

Add to `test/dragonboss.test.js`:

```javascript
describe('cone emits from the head tip', () => {
  it('burns a player in front of the mouth', () => {
    const boss = makeDragonBoss(10, 10)
    boss.px = 10 * 32 + 16; boss.py = 10 * 32 + 16; boss.facing = 0  // head toward +x
    boss.state = 'cone'; boss.stateTimer = 0.7; boss.dmgAcc = 0
    // Player straight ahead, ~4 tiles out — within the 6-tile cone from the mouth.
    const player = mkPlayer(boss.px + 4 * 32, boss.py)
    const state = mkState(boss, player)
    const hpBefore = player.hp
    for (let i = 0; i < 30; i++) updateDragonBoss(boss, state, 0.05)  // ~1.5s of fire
    assert.ok(player.hp < hpBefore, 'expected fire damage in front of the mouth')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npm test -- test/dragonboss.test.js`
Expected: This may already PASS (the old cone from center also reaches +x). That's
fine — it pins the behavior. If it passes, proceed; the refactor must keep it green.

> Calibration (applied during execution): moving the cone apex to the mouth (~2.48
> tiles forward) means the existing "sweeping breath" test's 3-tile player sat almost on
> the apex, where the rotating aim whips past too fast to accumulate a full tick. That
> test's player moves to `10*T + 5*T` (~2.5 tiles from the mouth, within cone length),
> assertion unchanged. Also prune the leftover unused import in `dragonboss.js` to
> `import { dragonCapsules, pointInCapsule } from './capsules.js'`.

- [ ] **Step 3: Add a mouth-origin helper and use it in `coneDamage`**

In `renderer/systems/dragonboss.js`, add a helper (near `playerTouchesBody`):

```javascript
// World position of the dragon's mouth (the neck capsule's forward tip).
function mouth(e) {
  const neck = dragonCapsules(e).find(c => c.part === 'neck')
  // the tip is the endpoint further from the body centre
  const da = Math.hypot(neck.ax - e.px, neck.ay - e.py)
  const db = Math.hypot(neck.bx - e.px, neck.by - e.py)
  return da > db ? { x: neck.ax, y: neck.ay } : { x: neck.bx, y: neck.by }
}
```

Then change `coneDamage` (lines 153-162) to emit from the mouth:

```javascript
function coneDamage(e, state, aim, delta) {
  const { player } = state
  const m = mouth(e)
  if (pointInCone(player.px, player.py, m.x, m.y, aim, CONE_HALF, CONE_LEN)) {
    e.dmgAcc += CONE_DPS * delta
    while (e.dmgAcc >= 1) {
      damagePlayer(state, 1, 'dot', 'Dragon fire! (-1 HP)')
      e.dmgAcc -= 1
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it still passes**

Run: `npm test -- test/dragonboss.test.js`
Expected: PASS (the new case and all existing cone/sweep tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/dragonboss.js test/dragonboss.test.js
git commit -m "feat(dragon-boss): breath cone emits from the mouth, not body centre"
```

---

### Task 4: Grid-stomp locomotion + crush (replaces lerp reposition)

> Corrections applied during execution (see fix commit): (1) `e.footfall = false` must
> live BEFORE the `switch` (per-frame reset), not inside the stomp case, so footfall
> pulses for exactly one frame. (2) Add `e.stepTimer = Math.max(0, e.stepTimer - delta)`
> with the other timer decrements and gate the idle→stomp trigger on `e.stepTimer <= 0` —
> otherwise `stepTimer` is dead and STEP_INTERVAL pacing never happens (and the boss
> never breathes at range because `attackCooldown` can't decay). Also: contact gate is
> `idle` only; facing-ease condition is `idle || stomp`.

Replace the `reposition` state's smooth pixel-lerp with discrete tile-steps toward the
player, plus crush-on-step-onto-player. Emit a footfall signal the renderer/game can
consume for screenshake (wired in Task 6).

**Files:**
- Modify: `renderer/systems/dragonboss.js` (`makeDragonBoss`, the `idle`→reposition
  trigger, the `reposition` case lines 130-144, `startReposition` lines 164-171)
- Test: `test/dragonboss.test.js`

**Interfaces:**
- Consumes: `dragonCapsules`/`pointInCapsule` (crush check), `startKnockback`
  (already imported), `isWalkable` (already imported).
- Produces:
  - New boss state `'stomp'` driven by `e.stepTimer` / `STEP_INTERVAL`.
  - On a completed step, sets `e.footfall = true` for one frame (Task 6 reads it).
  - Crush: stepping onto the player applies `CRUSH_DMG` + knockback away from the core.

- [ ] **Step 1: Write the failing test for stepping toward the player**

Add to `test/dragonboss.test.js`:

```javascript
describe('grid-stomp locomotion', () => {
  it('steps its centre one tile toward the player and lands on a tile centre', () => {
    const boss = makeDragonBoss(10, 10)
    boss.px = 10 * 32 + 16; boss.py = 10 * 32 + 16
    boss.state = 'stomp'; boss.stepTimer = 0; boss.stepFrom = null
    const player = mkPlayer(20 * 32 + 16, 10 * 32 + 16)  // due east, far
    const state = mkState(boss, player)
    const startX = boss.px
    for (let i = 0; i < 80; i++) updateDragonBoss(boss, state, 0.05)  // ~4s
    assert.ok(boss.px > startX, 'expected the boss to advance east toward the player')
    // landed on a tile centre (…*32 + 16)
    assert.equal(((boss.px - 16) % 32 + 32) % 32, 0, 'expected to land on a tile centre x')
  })
  it('raises a one-frame footfall on each completed step', () => {
    const boss = makeDragonBoss(10, 10)
    boss.px = 10 * 32 + 16; boss.py = 10 * 32 + 16
    boss.state = 'stomp'; boss.stepTimer = 0; boss.stepFrom = null
    const player = mkPlayer(20 * 32 + 16, 10 * 32 + 16)
    const state = mkState(boss, player)
    let sawFootfall = false
    for (let i = 0; i < 80; i++) { updateDragonBoss(boss, state, 0.05); if (boss.footfall) sawFootfall = true }
    assert.ok(sawFootfall, 'expected at least one footfall during stomping')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/dragonboss.test.js`
Expected: FAIL — there is no `'stomp'` state; the boss never advances.

- [ ] **Step 3: Add stomp constants and init fields**

In `renderer/systems/dragonboss.js`, add constants near the others (after line 19):

```javascript
const STEP_INTERVAL = 0.8          // seconds between stomp steps
const STEP_DUR      = 0.35         // seconds the body eases across one tile
const STOMP_RANGE   = 14 * TILE    // start pursuing within this distance
const CRUSH_DMG     = 3
const CRUSH_KNOCK   = 30
```

In `makeDragonBoss` (lines 33-43), add fields to the returned object:

```javascript
    stepTimer: 0, stepFrom: null, stepTo: null, stepK: 0, footfall: false,
```

- [ ] **Step 4: Route idle into stomp pursuit and replace the reposition case**

In `updateDragonBoss`, change the idle reposition trigger (lines 84) from
`if (e.repositionTimer <= 0) { startReposition(e, state); break }` to:

```javascript
      if (dist > 1.6 * TILE && dist < STOMP_RANGE && e.attackCooldown > 0.2) { startStomp(e, state); break }
```

Replace the entire `case 'reposition':` block (lines 130-144) with a `case 'stomp':`:

```javascript
    case 'stomp': {
      e.footfall = false
      if (!e.stepTo) { e.state = 'idle'; break }
      e.stepK = Math.min(1, e.stepK + delta / STEP_DUR)
      // ease across the tile (smoothstep) — logical destination is a tile centre
      const t = e.stepK * e.stepK * (3 - 2 * e.stepK)
      e.px = e.stepFrom.x + (e.stepTo.x - e.stepFrom.x) * t
      e.py = e.stepFrom.y + (e.stepTo.y - e.stepFrom.y) * t
      e.x = Math.floor(e.px / TILE); e.y = Math.floor(e.py / TILE)
      // crush: if the core now overlaps the player, shove + damage (once per step)
      if (!e.crushDone && coreHitsPlayer(e, player)) {
        e.crushDone = true
        if (damagePlayer(state, CRUSH_DMG, 'hit', `Crushed! (-${CRUSH_DMG})`)) {
          startKnockback(player, player.px - e.px, player.py - e.py, CRUSH_KNOCK)
        }
      }
      if (e.stepK >= 1) {
        e.footfall = true                 // one-frame signal for screenshake/dust
        e.px = e.stepTo.x; e.py = e.stepTo.y
        e.stepTo = null; e.crushDone = false
        e.stepTimer = STEP_INTERVAL
        e.state = 'idle'; e.attackCooldown = Math.max(e.attackCooldown, 0.4)
      }
      break
    }
```

- [ ] **Step 5: Replace `startReposition` with `startStomp` + helpers**

Replace `startReposition` (lines 164-171) with:

```javascript
// Begin a single grid-step toward the player along the best walkable cardinal/diagonal.
function startStomp(e, state) {
  const { map, player } = state
  const here = { x: Math.floor(e.px / TILE), y: Math.floor(e.py / TILE) }
  const sx = Math.sign(player.px - e.px), sy = Math.sign(player.py - e.py)
  // candidate steps, preferring the direction that most reduces distance
  const cands = [[sx, sy], [sx, 0], [0, sy]].filter(([dx, dy]) => dx !== 0 || dy !== 0)
  for (const [dx, dy] of cands) {
    const tx = here.x + dx, ty = here.y + dy
    if (map[ty]?.[tx] && isWalkable(map[ty][tx].tile, map[ty][tx])) {
      e.stepFrom = { x: e.px, y: e.py }
      e.stepTo = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
      e.stepK = 0; e.crushDone = false; e.state = 'stomp'
      return
    }
  }
  // nowhere to step — stay idle
  e.state = 'idle'; e.stepTimer = STEP_INTERVAL
}

// Does the core capsule currently overlap the player?
function coreHitsPlayer(e, player) {
  const core = dragonCapsules(e).find(c => c.part === 'core')
  return pointInCapsule(player.px, player.py, core.ax, core.ay, core.bx, core.by, core.radius)
}
```

Also delete the now-unused `REPOSITION_EVERY` const (line 19) and any
`e.repositionTimer` references: in `updateDragonBoss` remove the
`e.repositionTimer = Math.max(0, e.repositionTimer - delta)` line (77) and the
`repositionTimer` field in `makeDragonBoss` (line 41). The idle case's reposition
trigger was already replaced in Step 4.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- test/dragonboss.test.js`
Expected: PASS (both stomp cases plus existing tests). If existing tests referenced
`reposition` state, update them to `stomp` (grep the test file for `reposition`).

- [ ] **Step 7: Write the failing crush test**

Add to `test/dragonboss.test.js`:

```javascript
describe('crush on step', () => {
  it('damages and knocks back a player the core steps onto', () => {
    const boss = makeDragonBoss(10, 10)
    boss.px = 10 * 32 + 16; boss.py = 10 * 32 + 16; boss.facing = 0
    boss.state = 'stomp'; boss.stepTimer = 0
    // player sitting one tile east — the core will sweep onto them as it steps east
    const player = mkPlayer(11 * 32 + 16, 10 * 32 + 16)
    const state = mkState(boss, player)
    const hpBefore = player.hp
    boss.stepFrom = { x: boss.px, y: boss.py }
    boss.stepTo = { x: 11 * 32 + 16, y: 10 * 32 + 16 }
    boss.stepK = 0; boss.crushDone = false
    for (let i = 0; i < 12; i++) updateDragonBoss(boss, state, 0.05)
    assert.ok(player.hp < hpBefore, 'expected crush damage')
    assert.ok(player.knockback || player.px > 11 * 32, 'expected knockback away from the core')
  })
})
```

- [ ] **Step 8: Run the crush test**

Run: `npm test -- test/dragonboss.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add renderer/systems/dragonboss.js test/dragonboss.test.js
git commit -m "feat(dragon-boss): grid-stomp pursuit with crush, replacing lerp reposition"
```

---

### Task 5: Player-side hitboxes — blocking, flat-1 melee with modifiers, ranged immunity

Wire the capsules into `game.js`: the core blocks player movement, melee uses flat-1 ×
part modifier, and projectiles are immune.

**Files:**
- Modify: `renderer/game.js` (imports line 6 area; `canMoveTo`/`moveEntity` lines
  106-124; melee block lines 379-396; projectile block lines 416-427)
- Test: `test/dragonboss.test.js` is system-level; add a new `test/boss-hitboxes.test.js`
  that imports the small pure helpers. Because the damage logic currently lives inline
  in `game.js` (which imports DOM globals), extract the resolution into a pure helper in
  `capsules.js` and test that.

**Interfaces:**
- `game.js` consumes `meleeDamageToDragon`, `coreBlocks` from `./systems/capsules.js`.
  (Those helpers internally use `dragonCapsules`/`pointInCapsule`/`PART_MODIFIER`, which
  stay inside `capsules.js` — `game.js` does not import them directly.)
- Produces (new pure helpers in `capsules.js`):
  - `export function meleeDamageToDragon(player, e, swingHit)` → `number` — flat 1 ×
    the modifier of the best part the swing reaches, or `0` if the swing reaches no
    capsule. `swingHit(cx, cy)` is a predicate testing whether the player's swing covers
    world point `(cx,cy)`.

- [ ] **Step 1: Write the failing test for `meleeDamageToDragon`**

Create `test/boss-hitboxes.test.js`:

```javascript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { meleeDamageToDragon, coreBlocks } from '../renderer/systems/capsules.js'

const T = 32
function mkBoss(px, py, facing = 0) { return { px, py, facing, neckRear: 0, headAim: 0, tailSwing: 0 } }
// Swing proxy: covers world points within `reach` px of the player — a stand-in for the
// real forward arc, enough to prove which capsule SURFACE the swing lands on.
const near = (player, reach = 14) => (cx, cy) => Math.hypot(cx - player.px, cy - player.py) < reach

// Geometry reminder (boss at 320,320 facing 0 → whole body lies along y=320):
//   tail  x∈[217.6, 281.6] r≈21   core x∈[281.6, 340.48] r=48   neck x∈[355.84, 399.36] r≈27
describe('meleeDamageToDragon', () => {
  it('returns 0 when the swing reaches no capsule', () => {
    const boss = mkBoss(320, 320, 0)
    assert.equal(meleeDamageToDragon({ px: 0, py: 0 }, boss, () => false), 0)
  })
  it('returns 1.0 for a swing beside the core flank only', () => {
    const boss = mkBoss(320, 320, 0)
    // ~55px south of the core midpoint: just off the 48px core surface, clear of neck/tail.
    const player = { px: 311, py: 320 + 55 }
    assert.equal(meleeDamageToDragon(player, boss, near(player)), 1.0)
  })
  it('returns 1.5 for a swing beside the neck (facing 0 = +x)', () => {
    const boss = mkBoss(320, 320, 0)
    // ~34px south of the neck midpoint (x≈377): within reach of the ~27px neck surface.
    const player = { px: 377, py: 320 + 34 }
    assert.equal(meleeDamageToDragon(player, boss, near(player)), 1.5)
  })
  it('weak-spot wins where the swing reaches both neck and core', () => {
    const boss = mkBoss(320, 320, 0)
    // Near the neck/core seam (x≈350): both surfaces within reach → neck (1.5) beats core.
    const player = { px: 350, py: 320 + 30 }
    assert.equal(meleeDamageToDragon(player, boss, near(player, 24)), 1.5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/boss-hitboxes.test.js`
Expected: FAIL — `meleeDamageToDragon is not a function`.

- [ ] **Step 3: Implement `meleeDamageToDragon` in `capsules.js`**

Add to `renderer/systems/capsules.js`. For each capsule it tests the point on the
capsule **surface nearest the player** against the swing predicate — so a swing landing
anywhere along the body registers on the correct part (robust to narrow swings, unlike
sparse endpoint sampling). The best (highest-modifier) part the swing reaches sets the
damage; base damage is a flat 1 regardless of weapon.

```javascript
// Closest point on segment a->b to (px,py).
function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return [ax + dx * t, ay + dy * t]
}

// Flat-1 melee base × the best part modifier the swing reaches (weapon damage ignored).
// swingHit(cx, cy) -> boolean: does the player's swing cover world point (cx,cy)?
export function meleeDamageToDragon(player, e, swingHit) {
  let bestMod = 0
  for (const cap of dragonCapsules(e)) {
    const [cx, cy] = closestOnSeg(player.px, player.py, cap.ax, cap.ay, cap.bx, cap.by)
    const d = Math.hypot(player.px - cx, player.py - cy)
    // the capsule surface point facing the player (or the player's own position if inside)
    const sx = d > cap.radius ? cx + (player.px - cx) / d * cap.radius : player.px
    const sy = d > cap.radius ? cy + (player.py - cy) / d * cap.radius : player.py
    if (swingHit(sx, sy)) bestMod = Math.max(bestMod, PART_MODIFIER[cap.part])
  }
  return bestMod === 0 ? 0 : 1 * bestMod
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/boss-hitboxes.test.js`
Expected: PASS.

- [ ] **Step 5: Add a blocking test for player movement (pure `canMoveTo` helper)**

The blocking check needs the boss capsules. To keep it testable, add a pure predicate to
`capsules.js`:

```javascript
// True when a player half-box centred at (px,py) would intrude the solid core capsule.
export function coreBlocks(px, py, half, e) {
  const core = dragonCapsules(e).find(c => c.part === 'core')
  // test the four corners of the player's AABB against the core capsule
  for (const [cx, cy] of [[px-half,py-half],[px+half,py-half],[px-half,py+half],[px+half,py+half]]) {
    if (pointInCapsule(cx, cy, core.ax, core.ay, core.bx, core.by, core.radius)) return true
  }
  return false
}
```

Add to `test/boss-hitboxes.test.js` (`coreBlocks` is already imported at the top of the
file alongside `meleeDamageToDragon` — do NOT add a second import):

```javascript
describe('coreBlocks', () => {
  it('blocks a player at the body centre', () => {
    assert.equal(coreBlocks(320, 320, 6, mkBoss(320, 320, 0)), true)
  })
  it('does not block a player two tiles clear of the body', () => {
    assert.equal(coreBlocks(320 + 6 * T, 320, 6, mkBoss(320, 320, 0)), false)
  })
})
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- test/boss-hitboxes.test.js`
Expected: PASS.

- [ ] **Step 7: Wire blocking into `game.js` `moveEntity`**

In `renderer/game.js`, add to the imports (after line 16). Import ONLY what `game.js`
references directly — `meleeDamageToDragon` and `coreBlocks` (the part modifiers live
inside `meleeDamageToDragon`; `game.js` does not use `hitPart`/`PART_MODIFIER`):

```javascript
import { meleeDamageToDragon, coreBlocks } from './systems/capsules.js'
```

Change `moveEntity` (lines 119-124) so the **player** is also blocked by the boss core.
Add an optional boss param and check it:

```javascript
function moveEntity(e, dx, dy, map, half = PLAYER_HALF, boss = null) {
  const free = (px, py) => canMoveTo(map, px, py, half) && !(boss && coreBlocks(px, py, half, boss))
  if (dx !== 0 && free(e.px + dx, e.py)) e.px += dx
  if (dy !== 0 && free(e.px, e.py + dy)) e.py += dy
  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)
}
```

At the player-movement call site (line 262), pass the boss:

```javascript
  const boss = state.entities.find(e => e.type === 'dragon_boss') ?? null
  if (!wasGrabbed) moveEntity(player, vx * PLAYER_SPEED * delta, vy * PLAYER_SPEED * delta, map, PLAYER_HALF, boss)
```

(Enemy AI calls to `moveEntity` keep the 5-arg form — only the player collides with the
boss body.)

- [ ] **Step 8: Wire flat-1 melee + modifiers into the melee block**

In `renderer/game.js`, the melee block (lines 379-396) currently maps entities and, for
`dragon_boss`, hits if within `BOSS_MELEE_RANGE`. Replace the boss branch so it computes
damage from the part the swing reaches. Build a `swingHit` predicate from the existing
`meleeHit` (relative to the player, using `fa`):

```javascript
    state.entities = state.entities
      .map(e => {
        if (!isEnemy(e)) return e
        if (e.type === 'dragon_boss') {
          const swingHit = (cx, cy) => meleeHit(atk.style, fa, cx - player.px, cy - player.py)
          const dmg = meleeDamageToDragon(player, e, swingHit)
          if (dmg <= 0) return e
          return { ...e, hp: e.hp - dmg, inCombat: true }
        }
        if (!meleeHit(atk.style, fa, e.px - player.px, e.py - player.py)) return e
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        const hitEnemy = { ...e, hp: e.hp - dmg, inCombat: true }
        startKnockback(hitEnemy, hitEnemy.px - player.px, hitEnemy.py - player.py, atk.knockback)
        return hitEnemy
      })
      .filter(e => !isEnemy(e) || e.hp > 0)
```

Note: the non-boss branch still uses the weapon `dmg` (computed at line 377 as
`const dmg = player.weapon?.damage ?? 1`). The boss branch shadows `dmg` with the
flat-1× value via `meleeDamageToDragon`. Verify the variable scoping after editing — if
the linter flags the shadow, rename the boss-branch local to `bossDmg` and use it:
`return { ...e, hp: e.hp - bossDmg, inCombat: true }`. `BOSS_MELEE_RANGE` becomes unused
— remove its declaration (line 39).

- [ ] **Step 9: Make the dragon immune to ranged**

In the friendly-projectile block (lines 416-427), skip the dragon entirely so the
projectile neither damages it nor is consumed by it:

```javascript
      state.entities = state.entities.map(e => {
        if (!isEnemy(e) || hit) return e
        if (e.type === 'dragon_boss') return e          // immune to ranged; projectile passes over
        const hitR = 8
        if (Math.hypot(e.px - p.px, e.py - p.py) < hitR) {
          if (e.type === 'wizard' && e.shieldTimer > 0) { hit = true; return e }
          hit = true
          return { ...e, hp: e.hp - p.damage, inCombat: true }
        }
        return e
      })
```

`BOSS_PROJECTILE_R` becomes unused — remove its declaration (line 40).

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS (all suites). Watch for failures in any test that assumed the boss took
weapon damage or was hit by projectiles — update those expectations to the new rules
(flat-1 melee, ranged immune).

- [ ] **Step 11: Commit**

```bash
git add renderer/game.js renderer/systems/capsules.js test/boss-hitboxes.test.js
git commit -m "feat(dragon-boss): body blocks player, flat-1 melee w/ neck weak-spot, ranged immunity"
```

---

### Task 6: Screenshake on footfall

Read the boss's one-frame `footfall` signal in `game.js`, drive a decaying
`state.shake`, and apply it as a camera offset in `render/canvas.js`.

**Files:**
- Modify: `renderer/game.js` (state init ~line 197; update loop — add shake decay + read
  footfall near the AI loop)
- Modify: `renderer/render/canvas.js` (`updateCamera`, lines 536-541)
- Test: `test/canvas.test.js` (camera offset) — or a small unit on the decay if the
  camera is hard to instantiate headless; see Step 1.

**Interfaces:**
- Consumes: `e.footfall` (boolean, set by Task 4).
- Produces: `state.shake` (number, px magnitude, decays each frame); `updateCamera`
  offsets `camX/camY` by a shake vector derived from `state.shake`.

- [ ] **Step 1: Write the failing test for the camera offset**

Inspect `test/canvas.test.js` for how `Renderer` is constructed headless. Add a test
that `updateCamera` applies a shake offset when `state.shake > 0`. If the existing test
constructs a `Renderer` with a fake canvas, follow that; otherwise test a pure
`shakeOffset(shake)` helper. Add to `test/canvas.test.js`:

```javascript
import { shakeOffset } from '../renderer/render/canvas.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('shakeOffset', () => {
  it('is zero at rest', () => {
    const { x, y } = shakeOffset(0)
    assert.equal(x, 0); assert.equal(y, 0)
  })
  it('grows with magnitude and stays within ±shake', () => {
    const { x, y } = shakeOffset(6)
    assert.ok(Math.abs(x) <= 6 && Math.abs(y) <= 6)
    assert.ok(Math.abs(x) + Math.abs(y) > 0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/canvas.test.js`
Expected: FAIL — `shakeOffset is not a function`.

- [ ] **Step 3: Implement `shakeOffset` and apply it in `updateCamera`**

In `renderer/render/canvas.js`, add an exported helper (above the `Renderer` class) and
use it in `updateCamera`. Use a deterministic-ish offset from the magnitude (random
jitter is fine here; render is not unit-tested for exact values):

```javascript
export function shakeOffset(shake) {
  if (!shake || shake <= 0) return { x: 0, y: 0 }
  return { x: (Math.random() * 2 - 1) * shake, y: (Math.random() * 2 - 1) * shake }
}
```

Change `updateCamera` (lines 536-541) to read `state` shake. Since `updateCamera`
currently takes only `player`, pass the shake in from the caller. Update the signature:

```javascript
  updateCamera(player, shake = 0) {
    const px = player.px ?? (player.x * this.S + this.S / 2)
    const py = player.py ?? (player.y * this.S + this.S / 2)
    const o = shakeOffset(shake)
    this.camX = px - this.canvas.width / 2 + o.x
    this.camY = py - this.canvas.height / 2 + o.y
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/canvas.test.js`
Expected: PASS.

- [ ] **Step 5: Drive `state.shake` from footfall in `game.js`**

In `renderer/game.js`, add `shake: 0` to the initial state objects (the `startNewRun`
state literal near line 197, and the `descendLevel` literal near line 653 — search for
`hitEffects: []` and add `shake: 0,` beside each).

In `update(delta)`, near the top add a decay (after `const { player, map } = state`):

```javascript
  state.shake = Math.max(0, (state.shake ?? 0) - 30 * delta)   // px/s decay
```

After the enemy AI loop (the `for (const e of [...state.entities])` block that calls
`updateDragonBoss`), add a footfall read. The simplest place: right after the AI loop
ends (before the boss-gating block ~line 601):

```javascript
  const stomper = state.entities.find(e => e.type === 'dragon_boss' && e.footfall)
  if (stomper) state.shake = 6
```

- [ ] **Step 6: Pass shake into the camera in `render()`**

In `renderer/game.js` `render()` (line 626), change:

```javascript
  renderer.updateCamera(state.player, state.shake ?? 0)
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git add renderer/game.js renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(dragon-boss): screenshake on each stomp footfall"
```

---

### Task 7: Runtime verification (Playwright-Electron) + tuning pass

Confirm feel and visuals in the real game, then capture any `BOSS_HP` tuning decision.

**Files:**
- No production code changes expected unless verification reveals a defect (then fix +
  re-run the affected unit test).
- Reference: memory `verify-editor-with-playwright` — the Electron game runs under WSLg
  with `DISPLAY=:0` via `playwright-core` `_electron`.

**Interfaces:** none (manual/automated runtime check).

- [ ] **Step 1: Launch the boss arena and observe**

Run the game into the depth-0 boss test arena (the level-0 cheat, per recent branch
work). With the existing harness pattern from memory, launch via `playwright-core`
`_electron` with `DISPLAY=:0`, or run `npm start` and use the `level0` cheat.

Confirm each, capturing a screenshot or note per item:
- The player **cannot walk through** the dragon's body (core blocks).
- The dragon **stomps** tile-by-tile toward the player with a visible **screenshake** on each footfall.
- **Fire breath emits from the mouth**; sidestepping the forward cone avoids damage.
- Standing beside the **neck** and meleeing kills faster than hitting the body (neck ×1.5).
- **Ranged** attacks do nothing to the dragon.
- A **stomp onto the player** crushes (damage + knockback), not overlap.

- [ ] **Step 2: Record findings**

If any item fails, write a one-line defect note, add/adjust the relevant unit test in
the matching task's test file to capture it, fix the code, and re-run `npm test`.

- [ ] **Step 3: Tuning decision for `BOSS_HP`**

Play one full kill. If it feels too long (flat-1 base → ~19 neck hits at HP 28), lower
`BOSS_HP` in `renderer/systems/dragonboss.js` (try 18-20) and update the `BOSS_HP`
assertion in `test/dragonboss.test.js` if one exists. If 28 feels right, leave it.

- [ ] **Step 4: Commit any tuning/fixes**

```bash
git add -A
git commit -m "fix(dragon-boss): runtime verification tuning (feel/HP)"
```

(Skip the commit if Steps 1-3 produced no changes.)

---

## Self-Review

**Spec coverage:**
- §1 segmented capsules → Task 1 (`dragonCapsules`, `pointInCapsule`, `hitPart`). ✓
- §2 collision/blocking (core solid, neck/tail not) → Task 5 (`coreBlocks` + `moveEntity`). ✓
- §3 grid-stomp + crush + footfall → Task 4; screenshake → Task 6; dust → noted as
  reuse but **not implemented as a task**. Decision: dust is polish and optional in the
  spec ("optional"); footfall signal + screenshake deliver the weight. Dust is **out of
  scope for this plan** — recorded here so it is not a silent gap.
- §4 flat-1 melee × modifiers, ranged immune, per-capsule contact → Tasks 2 (contact),
  5 (melee + ranged). ✓
- §5 attacks from real parts (breath from mouth) → Task 3. Tail-sweep origin: the tail
  capsule already follows `tailSwing` (Task 1), and the existing tail attack uses
  `inTailArc` from center; moving the tail arc origin to the tip is **not separately
  tasked**. Decision: the spec's tail change is cosmetic relative to the neck-focused
  loop; left as-is to avoid scope creep, noted here.
- §6 `BOSS_HP` playtest knob → Task 7 Step 3. ✓
- §8 testing (unit geometry, blocking, crush, modifiers, ranged immunity, cadence) →
  Tasks 1-6 tests; runtime → Task 7. ✓

**Two acknowledged scope trims** (dust particles; tail-arc origin move) are polish items
explicitly flagged rather than silently dropped. Everything load-bearing for the
intended fight loop is tasked.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have
expected output. ✓

**Type consistency:** `dragonCapsules`/`pointInCapsule`/`hitPart`/`PART_MODIFIER`/
`meleeDamageToDragon`/`coreBlocks`/`shakeOffset` names are used identically across
Tasks 1-6. Boss state field names (`stepFrom`/`stepTo`/`stepK`/`stepTimer`/`footfall`/
`crushDone`) are introduced in Task 4 and used consistently. ✓
