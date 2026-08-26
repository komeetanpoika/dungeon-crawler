# Stamina System & Top-Bar Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mana with a stamina resource that prices melee swings, sprinting, and (newly chargeable) gust casts, and rework the top HUD bar into hearts + equipped slots + a stamina bar.

**Architecture:** A new pure module `renderer/systems/stamina.js` owns the resource, cost tables, and sprint detection; `magic.js` gains gust tiers and loses mana; `knockback.js` gains one-shot wall-slam reporting; `game.js` wires spending/sprint/auto-release; `render/hud.js` + `index.html` get the new bar. All logic lands in pure node-testable modules first; game.js is thin wiring verified by the suite plus a live emulated-phone check.

**Tech Stack:** Vanilla JS ES modules, `node:test`, playwright-core for live checks.

**Spec:** `docs/superpowers/specs/2026-08-26-stamina-and-hud-design.md`

## Global Constraints

- Stamina: max 100, regen 18/s after 0.7s without spending.
- Melee costs (tap/full/over): dagger —/8/—, sword —/12/—, longsword 10/18/34, axe 12/24/**48**, maunonmiekka 14/30/60.
- Gust: costs tap 14 / full 22 / over 40; charge thresholds full 0.5s, over 1.1s, moveFactor 0.5; wall slam 3 dmg at ≥400 px/s, over tier only.
- Sprint: melee/ranged ×1.55 @ 22/s; magic ×1.25 @ 8/s; double-tap gap 0.3s; touch = stick deflection ≥90%.
- Auto-release: 0.5s past the over threshold (melee charge and gust charge).
- Starved swings degrade to tap-tier mods and drain remaining stamina.
- Mana (`mana`, `manaRegenT`, `MANA_MAX`, `MANA_REGEN_TIME`, `tickMana`) is removed everywhere.
- Tests are `node:test` files in `test/`; run a single file with `node --test test/<file>`, everything with `npm test`.
- Commit after every green task. `test/map.test.js` ("procedural item placement…") is a known pre-existing flake — a single failure there alone is not caused by this work; re-run before deciding.

---

### Task 1: Stamina core module

**Files:**
- Create: `renderer/systems/stamina.js`
- Test: `test/stamina.test.js`

**Interfaces:**
- Produces: `STAMINA_MAX=100`, `meleeCost(weaponType, tier) -> number`, `GUST_COSTS = {tap:14, full:22, over:40}`, `canAfford(player, cost) -> bool`, `spendStamina(player, cost)` (clamps at 0, resets regen delay), `tickStamina(player, dt)` (also heals missing fields on old saves), `sprintProfile(attackMode) -> {speedMul, drain}`, `makeSprintDetector(gap=0.3) -> {press(dir,t), release(dir), sprinting()}`.

- [ ] **Step 1: Write the failing tests**

```js
// test/stamina.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAMINA_MAX, meleeCost, GUST_COSTS, canAfford, spendStamina, tickStamina,
  sprintProfile, makeSprintDetector,
} from '../renderer/systems/stamina.js'

const mkPlayer = (over = {}) =>
  ({ stamina: 100, maxStamina: 100, staminaRegenT: 99, ...over })

describe('melee costs', () => {
  it('prices each weapon per tier, axe overcharge at 48', () => {
    assert.equal(meleeCost('dagger', 'full'), 8)
    assert.equal(meleeCost('sword', 'full'), 12)
    assert.equal(meleeCost('longsword', 'tap'), 10)
    assert.equal(meleeCost('longsword', 'over'), 34)
    assert.equal(meleeCost('axe', 'over'), 48)
    assert.equal(meleeCost('maunonmiekka', 'over'), 60)
  })
  it('unknown weapons fall back to the dagger-scale defaults', () => {
    assert.equal(meleeCost('mystery', 'full'), 8)
    assert.equal(meleeCost('mystery', 'tap'), 8)
  })
})

describe('spend and regen', () => {
  it('spending clamps at zero and resets the regen delay', () => {
    const p = mkPlayer({ stamina: 10 })
    spendStamina(p, 25)
    assert.equal(p.stamina, 0)
    assert.equal(p.staminaRegenT, 0)
  })
  it('canAfford is a plain threshold', () => {
    assert.equal(canAfford(mkPlayer({ stamina: 22 }), 22), true)
    assert.equal(canAfford(mkPlayer({ stamina: 21 }), 22), false)
  })
  it('does not regen during the 0.7s delay, then regens at 18/s', () => {
    const p = mkPlayer({ stamina: 50, staminaRegenT: 0 })
    tickStamina(p, 0.5)
    assert.equal(p.stamina, 50)
    tickStamina(p, 0.2)          // delay ends exactly now
    tickStamina(p, 1.0)
    assert.ok(Math.abs(p.stamina - 68) < 1e-9)
  })
  it('caps at maxStamina', () => {
    const p = mkPlayer({ stamina: 99, staminaRegenT: 99 })
    tickStamina(p, 5)
    assert.equal(p.stamina, 100)
  })
  it('heals a saved player that predates stamina', () => {
    const p = { hp: 10 }
    tickStamina(p, 0.016)
    assert.equal(p.stamina, 100)
    assert.equal(p.maxStamina, 100)
  })
})

describe('sprint profiles', () => {
  it('melee and ranged sprint fast and thirsty, magic slow and cheap', () => {
    assert.deepEqual(sprintProfile('melee'), { speedMul: 1.55, drain: 22 })
    assert.deepEqual(sprintProfile('ranged'), { speedMul: 1.55, drain: 22 })
    assert.deepEqual(sprintProfile('magic'), { speedMul: 1.25, drain: 8 })
  })
})

describe('double-tap sprint detector', () => {
  it('two presses of the same direction within the gap start sprinting', () => {
    const d = makeSprintDetector()
    d.press('w', 1.00)
    assert.equal(d.sprinting(), false)
    d.press('w', 1.25)
    assert.equal(d.sprinting(), true)
  })
  it('a slow second tap does not sprint', () => {
    const d = makeSprintDetector()
    d.press('w', 1.0)
    d.press('w', 1.4)
    assert.equal(d.sprinting(), false)
  })
  it('releasing the sprinting direction stops the sprint', () => {
    const d = makeSprintDetector()
    d.press('a', 1.0); d.press('a', 1.2)
    d.release('a')
    assert.equal(d.sprinting(), false)
  })
  it('releasing a different direction keeps the sprint', () => {
    const d = makeSprintDetector()
    d.press('a', 1.0); d.press('a', 1.2)
    d.release('d')
    assert.equal(d.sprinting(), true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/stamina.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// renderer/systems/stamina.js
// One tank prices melee swings, sprinting, and gust casts (mana is gone).
// Pure player-state logic — game.js owns feedback and SFX.

export const STAMINA_MAX = 100
const REGEN_RATE = 18     // per second
const REGEN_DELAY = 0.7   // seconds after the last spend before regen starts

// Per-weapon swing prices by charge tier. Light weapons only ever swing
// 'full'; unknown weapons price like the dagger.
const MELEE_COSTS = {
  dagger:       { full: 8 },
  sword:        { full: 12 },
  longsword:    { tap: 10, full: 18, over: 34 },
  axe:          { tap: 12, full: 24, over: 48 },
  maunonmiekka: { tap: 14, full: 30, over: 60 },
}
export function meleeCost(weaponType, tier) {
  const table = MELEE_COSTS[weaponType] ?? MELEE_COSTS.dagger
  return table[tier] ?? table.full
}

export const GUST_COSTS = { tap: 14, full: 22, over: 40 }

export const canAfford = (player, cost) => (player.stamina ?? 0) >= cost

export function spendStamina(player, cost) {
  player.stamina = Math.max(0, (player.stamina ?? 0) - cost)
  player.staminaRegenT = 0
}

// Also the save-migration point: players persisted before stamina existed
// get a full tank the first time they tick.
export function tickStamina(player, dt) {
  if (player.stamina == null) {
    player.stamina = STAMINA_MAX
    player.maxStamina = STAMINA_MAX
    player.staminaRegenT = 0
    return
  }
  player.staminaRegenT = (player.staminaRegenT ?? 0) + dt
  if (player.staminaRegenT <= REGEN_DELAY) return
  const t = Math.min(dt, player.staminaRegenT - REGEN_DELAY)
  player.stamina = Math.min(player.maxStamina ?? STAMINA_MAX,
    player.stamina + REGEN_RATE * t)
}

// The mage jogs: slower burst, far cheaper — sprinting is how a caster
// keeps distance, not how they close it.
const SPRINT_PROFILES = {
  melee:  { speedMul: 1.55, drain: 22 },
  ranged: { speedMul: 1.55, drain: 22 },
  magic:  { speedMul: 1.25, drain: 8 },
}
export const sprintProfile = mode => SPRINT_PROFILES[mode] ?? SPRINT_PROFILES.melee

// Desktop sprint intent: double-tap a direction and hold. Timestamps are
// injected (seconds) so this stays clock-free and unit-testable.
export function makeSprintDetector(gap = 0.3) {
  const lastPress = {}
  let sprintDir = null
  return {
    press(dir, t) {
      if (t - (lastPress[dir] ?? -Infinity) <= gap) sprintDir = dir
      lastPress[dir] = t
    },
    release(dir) { if (sprintDir === dir) sprintDir = null },
    sprinting() { return sprintDir !== null },
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/stamina.test.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/stamina.js test/stamina.test.js
git commit -m "feat(game): stamina core — costs, spend/regen, sprint profiles and detector"
```

---

### Task 2: Knockback wall slam

**Files:**
- Modify: `renderer/systems/knockback.js`
- Test: `test/knockback.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `startKnockback(entity, dirX, dirY, distance, opts?)` where `opts.slam = { damage: number }`; `stepKnockback(entity, delta, canMove)` now returns `null` or `{ slammed: true, damage: number }` (fires once; flag consumed).

- [ ] **Step 1: Write the failing tests** (append to `test/knockback.test.js`; keep existing tests untouched)

```js
describe('wall slam', () => {
  it('reports a slam once when a flagged knockback hits a wall at speed', () => {
    const e = { px: 100, py: 100, x: 3, y: 3 }
    startKnockback(e, 1, 0, 70, { slam: { damage: 3 } })
    const wallAt = (px) => px < 105          // wall just to the east
    const r1 = stepKnockback(e, 0.016, (px, py) => wallAt(px))
    assert.deepEqual(r1, { slammed: true, damage: 3 })
    const r2 = stepKnockback(e, 0.016, (px, py) => wallAt(px))
    assert.equal(r2, null)
  })
  it('does not slam without the flag', () => {
    const e = { px: 100, py: 100, x: 3, y: 3 }
    startKnockback(e, 1, 0, 70)
    assert.equal(stepKnockback(e, 0.016, () => false), null)
  })
  it('does not slam a slow drift into a wall', () => {
    const e = { px: 100, py: 100, x: 3, y: 3 }
    startKnockback(e, 1, 0, 70, { slam: { damage: 3 } })
    // burn off speed in open space until below the slam threshold (400 px/s)
    for (let i = 0; i < 200 && e.knockback; i++) {
      if (Math.hypot(e.knockback.vx, e.knockback.vy) < 400) break
      stepKnockback(e, 0.016, () => true)
    }
    if (e.knockback) assert.equal(stepKnockback(e, 0.016, () => false), null)
  })
  it('open-space steps still return null', () => {
    const e = { px: 100, py: 100, x: 3, y: 3 }
    startKnockback(e, 0, 1, 30)
    assert.equal(stepKnockback(e, 0.016, () => true), null)
  })
})
```

Add `describe`/imports only if the file lacks them for these names.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/knockback.test.js` — Expected: new tests FAIL (opts ignored / undefined return).

- [ ] **Step 3: Implement** — in `renderer/systems/knockback.js`:

```js
const SLAM_MIN_SPEED = 400   // px/s; slower wall contact is a drift, not a slam

export function startKnockback(entity, dirX, dirY, distance, opts) {
  const len = Math.hypot(dirX, dirY)
  if (len === 0 || distance <= 0) return
  const v0 = distance * DRAG
  entity.knockback = { vx: (dirX / len) * v0, vy: (dirY / len) * v0,
    ...(opts?.slam ? { slam: { ...opts.slam } } : {}) }
}

export function stepKnockback(entity, delta, canMove) {
  const kb = entity.knockback
  if (!kb) return null
  const speed = Math.hypot(kb.vx, kb.vy)
  let blocked = false
  const nx = entity.px + kb.vx * delta
  if (canMove(nx, entity.py)) entity.px = nx
  else { kb.vx = 0; blocked = true }
  const ny = entity.py + kb.vy * delta
  if (canMove(entity.px, ny)) entity.py = ny
  else { kb.vy = 0; blocked = true }
  entity.x = Math.floor(entity.px / TILE)
  entity.y = Math.floor(entity.py / TILE)
  const decay = Math.exp(-DRAG * delta)
  kb.vx *= decay
  kb.vy *= decay
  if (Math.hypot(kb.vx, kb.vy) < STOP_SPEED) entity.knockback = null
  if (blocked && kb.slam && speed >= SLAM_MIN_SPEED) {
    const { damage } = kb.slam
    delete kb.slam                       // one-shot
    return { slammed: true, damage }
  }
  return null
}
```

(Keep the existing header comments; the only semantic changes are `opts`, the `blocked` bookkeeping, and the return value.)

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/knockback.test.js` — Expected: all pass (old tests ignore the return value).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/knockback.js test/knockback.test.js
git commit -m "feat(game): knockback reports one-shot wall slams for flagged shoves"
```

---

### Task 3: Gust tiers, gust charge, mana removal

**Files:**
- Modify: `renderer/systems/magic.js`
- Test: `test/magic.test.js` (update: mana tests go away, tier tests come in)

**Interfaces:**
- Consumes: `GUST_COSTS`, `canAfford`, `spendStamina` from `stamina.js`; `startKnockback(..., opts)` from Task 2.
- Produces: `GUST_CHARGE = { full: 0.5, over: 1.1, moveFactor: 0.5 }`; `resolveGustTier(heldTime) -> 'tap'|'full'|'over'`; `shouldAutoReleaseGust(heldTime) -> bool`; `GUST_TIERS` (per-tier `{ mul, stun, knockback, bossKnockback, slam }`); `tryGust(state, tier = 'tap')` — refusal reasons now `'not_learned' | 'cooldown' | 'stamina'`. `MANA_MAX`, `MANA_REGEN_TIME`, `tickMana` deleted.

- [ ] **Step 1: Update the test file.** In `test/magic.test.js`: delete every test that exercises `tickMana`/`MANA_MAX`/mana regen (read the file first; remove whole `describe` blocks that are mana-only, and change any `mana: N` player fixture fields to `stamina: 100, maxStamina: 100, staminaRegenT: 99`). Then append:

```js
describe('gust charge tiers', () => {
  it('resolves hold time to tiers at 0.5/1.1s', () => {
    assert.equal(resolveGustTier(0.1), 'tap')
    assert.equal(resolveGustTier(0.5), 'full')
    assert.equal(resolveGustTier(1.1), 'over')
  })
  it('auto-releases 0.5s past over', () => {
    assert.equal(shouldAutoReleaseGust(1.55), false)   // threshold is 1.1 + 0.5 = 1.6, exclusive
    assert.equal(shouldAutoReleaseGust(1.7), true)
  })
  it('tiers scale cone, stun, and shove; only over slams', () => {
    assert.deepEqual(GUST_TIERS.tap,  { mul: 1,    stun: 1.0, knockback: 30, bossKnockback: 12, slam: false })
    assert.deepEqual(GUST_TIERS.full, { mul: 1.25, stun: 1.5, knockback: 45, bossKnockback: 18, slam: false })
    assert.deepEqual(GUST_TIERS.over, { mul: 1.5,  stun: 2.0, knockback: 70, bossKnockback: 28, slam: true })
  })
})

describe('tryGust with stamina', () => {
  const mkState = (playerOver = {}, entities = []) => {
    const player = { type: 'player', px: 100, py: 100, facing: 'east',
      talents: ['magic_stance'], magicCooldown: 0,
      stamina: 100, maxStamina: 100, staminaRegenT: 99, ...playerOver }
    return { player, entities: [player, ...entities] }
  }
  it('spends the tier cost on success', () => {
    const s = mkState()
    const r = tryGust(s, 'over')
    assert.equal(r.ok, true)
    assert.equal(s.player.stamina, 60)
  })
  it('refuses with reason stamina when the tank cannot cover the tier', () => {
    const s = mkState({ stamina: 13 })
    assert.deepEqual(tryGust(s, 'tap'), { ok: false, reason: 'stamina' })
    assert.equal(s.player.stamina, 13)
  })
  it('over-tier knocks a caught enemy back with a slam flag', () => {
    const enemy = { type: 'monster', hp: 3, px: 140, py: 100, x: 4, y: 3 }
    const s = mkState({}, [enemy])
    tryGust(s, 'over')
    assert.ok(enemy.knockback)
    assert.deepEqual(enemy.knockback.slam, { damage: 3 })
  })
  it('tap tier knocks back without a slam flag', () => {
    const enemy = { type: 'monster', hp: 3, px: 140, py: 100, x: 4, y: 3 }
    const s = mkState({}, [enemy])
    tryGust(s, 'tap')
    assert.ok(enemy.knockback)
    assert.equal(enemy.knockback.slam, undefined)
  })
  it('over tier reaches further than tap', () => {
    const enemy = { type: 'monster', hp: 3, px: 100 + 100, py: 100, x: 6, y: 3 }   // 100px out, past base 80 reach
    const tap = mkState({}, [{ ...enemy }])
    const over = mkState({}, [enemy])
    assert.equal(tryGust(tap, 'tap').caught, 0)
    assert.equal(tryGust(over, 'over').caught, 1)
  })
})
```

Adjust imports at the top of the test file to `import { GUST, GUST_CHARGE, GUST_TIERS, resolveGustTier, shouldAutoReleaseGust, tryGust } from '../renderer/systems/magic.js'` (drop mana imports).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/magic.test.js` — Expected: FAIL (missing exports).

- [ ] **Step 3: Implement** — rewrite the mana parts of `renderer/systems/magic.js`:

```js
// (imports: add) 
import { GUST_COSTS, canAfford, spendStamina } from './stamina.js'

// (delete MANA_MAX, MANA_REGEN_TIME, tickMana entirely; GUST stays as-is)

// Hold-to-charge, mirroring melee's heavy weapons: wind up to widen the
// cone; overcharge adds a wall-slam. moveFactor slows the caster mid-wind.
export const GUST_CHARGE = { full: 0.5, over: 1.1, moveFactor: 0.5 }
const AUTO_RELEASE_GRACE = 0.5

export const resolveGustTier = held =>
  held >= GUST_CHARGE.over ? 'over' : held >= GUST_CHARGE.full ? 'full' : 'tap'

export const shouldAutoReleaseGust = held =>
  held > GUST_CHARGE.over + AUTO_RELEASE_GRACE

export const GUST_TIERS = {
  tap:  { mul: 1,    stun: 1.0, knockback: 30, bossKnockback: 12, slam: false },
  full: { mul: 1.25, stun: 1.5, knockback: 45, bossKnockback: 18, slam: false },
  over: { mul: 1.5,  stun: 2.0, knockback: 70, bossKnockback: 28, slam: true },
}
const SLAM_DAMAGE = 3

export function tryGust(state, tier = 'tap') {
  const p = state.player
  if (!hasTalent(p, 'magic_stance')) return { ok: false, reason: 'not_learned' }
  if ((p.magicCooldown ?? 0) > 0) return { ok: false, reason: 'cooldown' }
  const t = GUST_TIERS[tier]
  if (!canAfford(p, GUST_COSTS[tier])) return { ok: false, reason: 'stamina' }
  spendStamina(p, GUST_COSTS[tier])
  p.magicCooldown = GUST.cooldown
  const fa = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[p.facing] ?? 0
  const slamOpts = t.slam ? { slam: { damage: SLAM_DAMAGE } } : undefined
  let caught = 0
  for (const e of state.entities) {
    if (!e.hp || e.type === 'player') continue
    if (!inSwing(GUST.reach * t.mul, GUST.halfAngle * t.mul, fa, e.px - p.px, e.py - p.py)) continue
    if (e.type === 'dragon_boss') continue
    caught++
    if (stunnable(e)) {
      e.stunTimer = t.stun
      startKnockback(e, e.px - p.px, e.py - p.py, t.knockback, slamOpts)
    } else {
      startKnockback(e, e.px - p.px, e.py - p.py, t.bossKnockback, slamOpts)
    }
  }
  return { ok: true, caught, tier }
}
```

Also update the module's header comment: mana is gone, gust costs stamina and charges.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/magic.test.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/magic.js test/magic.test.js
git commit -m "feat(game): gust charges in tiers priced in stamina; mana removed"
```

---

### Task 4: Melee auto-release + tier mods export; player fields

**Files:**
- Modify: `renderer/systems/melee.js`, `renderer/systems/entities.js`
- Test: `test/melee.test.js` (append), `test/entities.test.js` (update if it asserts mana fields)

**Interfaces:**
- Produces: `shouldAutoRelease(weaponType, heldTime) -> bool` (false for non-charge weapons); `tierMods(tier) -> { tier, dmgMul, reachMul, kbMul, cooldownMul }` in melee.js. `makePlayer` gains `stamina: 100, maxStamina: 100, staminaRegenT: 0` and loses `mana`, `manaRegenT` (keeps `magicCooldown`).

- [ ] **Step 1: Write the failing tests** (append to `test/melee.test.js`)

```js
describe('charge auto-release', () => {
  it('fires 0.5s past the over threshold, per weapon', () => {
    assert.equal(shouldAutoRelease('axe', 1.6), false)      // over=1.2, grace to 1.7
    assert.equal(shouldAutoRelease('axe', 1.8), true)
    assert.equal(shouldAutoRelease('longsword', 1.7), true) // over=1.1
  })
  it('never fires for non-charge weapons', () => {
    assert.equal(shouldAutoRelease('dagger', 99), false)
  })
})

describe('tierMods', () => {
  it('returns the same mods resolveCharge would for that tier', () => {
    assert.deepEqual(tierMods('tap'), resolveCharge('axe', 0))       // axe at 0s held = tap
    assert.deepEqual(tierMods('full'), resolveCharge('dagger', 0))   // non-charge = full
  })
})
```

And in `test/entities.test.js` (read it first): update/extend the `makePlayer` assertions:

```js
it('starts with a full stamina tank and no mana fields', () => {
  const p = makePlayer(1, 1)
  assert.equal(p.stamina, 100)
  assert.equal(p.maxStamina, 100)
  assert.equal(p.staminaRegenT, 0)
  assert.equal(p.mana, undefined)
  assert.equal(p.manaRegenT, undefined)
  assert.equal(p.magicCooldown, 0)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/melee.test.js test/entities.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `melee.js`, next to `CHARGE`:

```js
const AUTO_RELEASE_GRACE = 0.5   // seconds past 'over' before the swing lets go

export const shouldAutoRelease = (weaponType, heldTime) => {
  const c = CHARGE[weaponType]
  return !!c && heldTime > c.over + AUTO_RELEASE_GRACE
}

export const tierMods = tier => ({ tier, ...TIER_MODS[tier] })
```

In `entities.js` `makePlayer`, replace the mana line:

```js
    stamina: 100, maxStamina: 100, staminaRegenT: 0,
    magicCooldown: 0,   // gust unlocks via the magic_stance talent
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/melee.test.js test/entities.test.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/melee.js renderer/systems/entities.js test/melee.test.js test/entities.test.js
git commit -m "feat(game): melee auto-release + tierMods; player carries stamina, not mana"
```

---

### Task 5: Wall-slam SFX cue

**Files:**
- Modify: `renderer/systems/sfx.js` (CUE_NAMES), `renderer/render/audio.js` (RECIPES)

**Interfaces:**
- Produces: cue name `'wall-slam'` usable via `sfx(state, 'wall-slam', {px, py})`.

- [ ] **Step 1: Check the drift test.** Read `test/sfx.test.js` / `test/audio.test.js` for the CUE_NAMES↔RECIPES parity test; it will fail if only one side is added — that IS the failing-test step. Add `'wall-slam'` to CUE_NAMES only, run `node --test test/sfx.test.js test/audio.test.js`, watch the drift test fail. If no parity test exists, first append one to `test/audio.test.js`:

```js
it('every cue name has a recipe and vice versa', () => {
  assert.deepEqual([...CUE_NAMES].sort(), Object.keys(RECIPES).sort())
})
```

- [ ] **Step 2: Implement.** In `sfx.js` CUE_NAMES combat group, add `'wall-slam'`. In `audio.js` RECIPES add:

```js
  'wall-slam':      { kind: 'burst',  freq: 180,  q: 0.9,  dur: 0.16, vol: 1.0 },
```

- [ ] **Step 3: Run** `node --test test/sfx.test.js test/audio.test.js` — Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add renderer/systems/sfx.js renderer/render/audio.js
git commit -m "feat(game): wall-slam sound cue"
```

---

### Task 6: game.js wiring

**Files:**
- Modify: `renderer/game.js`

**Interfaces:**
- Consumes everything from Tasks 1–5. No new exports. Touch layer will hold the synthetic key `'sprint'` (Task 8).

No unit tests of its own (game.js is the untested orchestrator by convention); the suite must stay green and Task 9 verifies live. Steps:

- [ ] **Step 1: Imports.** Add `import { meleeCost, canAfford, spendStamina, tickStamina, sprintProfile, makeSprintDetector } from './systems/stamina.js'`. Extend the melee import with `resolveCharge, isChargeWeapon, chargeMoveFactor` (already there) plus `shouldAutoRelease, tierMods`. Replace the magic import: drop `tickMana`, add `GUST_CHARGE, GUST_TIERS, resolveGustTier, shouldAutoReleaseGust` beside `tryGust, GUST`.

- [ ] **Step 2: Sprint intent.** Below the `keys` listeners (game.js:68), add:

```js
// Desktop sprint: double-tap a direction and hold. Touch sprint arrives as
// the synthetic 'sprint' key from the stick rim (ui/touch-controls.js).
const SPRINT_DIR_KEYS = { ArrowUp: 'w', w: 'w', ArrowDown: 's', s: 's',
  ArrowLeft: 'a', a: 'a', ArrowRight: 'd', d: 'd' }
const sprintDetector = makeSprintDetector()
window.addEventListener('keydown', e => {
  const dir = SPRINT_DIR_KEYS[e.key]
  if (dir && !e.repeat) sprintDetector.press(dir, performance.now() / 1000)
})
window.addEventListener('keyup', e => {
  const dir = SPRINT_DIR_KEYS[e.key]
  if (dir) sprintDetector.release(dir)
})
```

- [ ] **Step 3: Movement speed.** Replace the `const speed = …` line (game.js:552):

```js
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(player.attackMode)
  const sprinting = moving && !player.charging && player.stamina > 0 &&
    (keys['sprint'] || sprintDetector.sprinting())
  const chargeFactor = player.charging
    ? (player.charging.kind === 'gust' ? GUST_CHARGE.moveFactor
                                       : chargeMoveFactor(player.weapon?.weaponType))
    : 1
  const speed = PLAYER_SPEED * chargeFactor * (sprinting ? profile.speedMul : 1)
  if (sprinting) spendStamina(player, profile.drain * delta)
```

(Note: `spendStamina` per-frame also resets the regen delay — that is the intended "sprinting defers regen".)

- [ ] **Step 4: Tick + refusal timer.** Replace `tickMana(player, delta)` with:

```js
  tickStamina(player, delta)
  player.staminaRefusedT = Math.max(0, (player.staminaRefusedT ?? 0) - delta)
```

- [ ] **Step 5: Melee spending + starved rule + auto-release.** In the `swing(mods)` helper, insert at the very top:

```js
    const cost = meleeCost(meleeWT, mods.tier)
    if (!canAfford(player, cost)) {
      mods = tierMods('tap')                     // starved: weak swing
      player.staminaRefusedT = 0.4
      spendStamina(player, meleeCost(meleeWT, 'tap'))  // drains whatever is left
    } else {
      spendStamina(player, cost)
    }
```

In the charge-weapon branch, extend the held update with auto-release:

```js
    if (player.charging) {
      if (keys[' '] && !shouldAutoRelease(meleeWT, player.charging.t)) {
        player.charging.t += delta
      } else {
        const held = player.charging.t
        player.charging = null
        swing(resolveCharge(meleeWT, held))
        keys[' '] = false     // an auto-release must not instantly re-wind
      }
    } else if (attacking && player.meleeCooldown <= 0) player.charging = { t: 0 }
```

- [ ] **Step 6: Gust charging.** Replace the whole `if (attacking && player.attackMode === 'magic') { … }` block with a charge-and-release flow mirroring melee:

```js
  // Magic (Space in magic stance): hold to charge the gust; release casts
  // at the reached tier. Overlong holds auto-release.
  if (player.attackMode === 'magic') {
    if (player.charging?.kind === 'gust') {
      if (keys[' '] && !shouldAutoReleaseGust(player.charging.t)) {
        player.charging.t += delta
      } else {
        const tier = resolveGustTier(player.charging.t)
        player.charging = null
        keys[' '] = false
        const cast = tryGust(state, tier)
        if (cast.ok) {
          const mul = GUST_TIERS[tier].mul
          const fa = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.facing] ?? 0
          state.shockwaves.push({
            px: player.px + Math.cos(fa) * 44 * mul, py: player.py + Math.sin(fa) * 44 * mul,
            t: 0, dur: 0.3, maxRadius: 44 * mul, color: '#a5f3fc',
          })
          sfx(state, 'magic-cast', { px: player.px, py: player.py })
          state.log = [...state.log,
            tier === 'over' ? 'A raging gale!' : tier === 'full' ? 'A strong gust!' : 'A gust of wind!',
          ].slice(-5)
        } else if (cast.reason === 'stamina') {
          player.staminaRefusedT = 0.4
          state.magicMsgCooldown = Math.max(0, (state.magicMsgCooldown ?? 0) - delta)
          if (state.magicMsgCooldown <= 0) {
            think(state, 'Too winded to shape the wind.')
            state.magicMsgCooldown = 2
          }
        }
      }
    } else if (attacking && (player.magicCooldown ?? 0) <= 0 && hasTalent(player, 'magic_stance')) {
      player.charging = { t: 0, kind: 'gust' }
    }
  }
```

`hasTalent` needs importing from `./systems/talents.js` if game.js doesn't already import it (check; add to the existing import line if present). Also find the stance-switch spot that clears `player.charging` (game.js:113 and the "weapon swapped mid-wind-up" line) and make sure the melee branch's `player.charging = null` cleanup only touches melee charges: change that line to `if (player.charging && player.charging.kind !== 'gust') player.charging = null`.

- [ ] **Step 7: Slam application.** Around game.js:1112, capture the return:

```js
  for (const e of state.entities) {
    if (e === player) continue
    const slam = stepKnockback(e, delta, (px, py) => canMoveTo(map, px, py, ENEMY_HALF))
    if (slam && isEnemy(e)) {
      e.hp -= slam.damage
      e.inCombat = true
      addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${slam.damage}`, kind: 'dealt' })
      sfx(state, e.hp <= 0 ? 'enemy-death' : 'wall-slam', { px: e.px, py: e.py })
    }
  }
  state.entities = state.entities.filter(e => !isEnemy(e) || e.hp > 0)
  stepKnockback(player, delta, (px, py) => canMoveTo(map, px, py, PLAYER_HALF))
```

(Adapt to the actual loop shape at that line — the key points: use the return value, damage only enemies, filter the dead, never slam the player.)

- [ ] **Step 8: Run the full suite.** `npm test` — Expected: green (map.test.js flake caveat in Global Constraints).

- [ ] **Step 9: Commit**

```bash
git add renderer/game.js
git commit -m "feat(game): stamina wired — sprint, priced swings, charged gust, wall slams"
```

---

### Task 7: Top-bar rework (DOM + hud.js)

**Files:**
- Modify: `renderer/index.html` (hud-top DOM + CSS), `renderer/render/hud.js`
- Test: `test/hud.test.js` (rewrite most of it)

**Interfaces:**
- Consumes: `quickUseSummary` (already imported in hud.js), `player.stamina/maxStamina/staminaRefusedT`.
- Produces: `updateHUD(state)` (same signature); element ids `hud-hearts`, `hud-level`, `hud-weapon-slot`, `hud-consumable`, `hud-stamina`, `hud-stamina-fill`; each heart rendered as `<svg class="heart" data-state="full|half|empty">…</svg>`; keeps publishing `data-quick-emoji` on `#hud-items`? — **No**: the quick-use badge data moves to `#hud-consumable` (`data-quick-emoji` attribute there); Task 8 repoints the touch observer.

- [ ] **Step 1: Write the failing tests.** Rewrite `test/hud.test.js`: keep `fakeDom` (nodes also need `innerHTML: ''` and a `dataset: {}` — extend the factory to `{ textContent: '', style: {}, dataset: {}, innerHTML: '' }`), keep the `state()` helper but add `stamina: 100, maxStamina: 100` to the player defaults, then replace the stance-slot describes with:

```js
describe('updateHUD hearts', () => {
  const hearts = nodes => [...nodes['hud-hearts'].innerHTML.matchAll(/data-state="(\w+)"/g)].map(m => m[1])
  it('renders maxHp/2 hearts, half a heart per hitpoint', () => {
    const nodes = fakeDom()
    updateHUD(state({ hp: 7, maxHp: 10 }))
    assert.deepEqual(hearts(nodes), ['full', 'full', 'full', 'half', 'empty'])
  })
  it('full and empty extremes', () => {
    const nodes = fakeDom()
    updateHUD(state({ hp: 10, maxHp: 10 }))
    assert.deepEqual(hearts(nodes), ['full', 'full', 'full', 'full', 'full'])
    updateHUD(state({ hp: 0, maxHp: 10 }))
    assert.deepEqual(hearts(nodes), ['empty', 'empty', 'empty', 'empty', 'empty'])
  })
})

describe('updateHUD weapon slot', () => {
  it('shows the active stance weapon only', () => {
    const nodes = fakeDom()
    updateHUD(state({ weapon: { name: 'Sword', damage: 2 },
      ranged: { name: 'Shortbow', damage: 2, ammo: 8, maxAmmo: 12 }, attackMode: 'ranged' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Shortbow 8/12')
  })
  it('melee shows name and damage; unarmed says so; magic says Gust', () => {
    const nodes = fakeDom()
    updateHUD(state({ weapon: { name: 'Axe', damage: 4 }, attackMode: 'melee' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Axe (4 dmg)')
    updateHUD(state({ attackMode: 'melee' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Unarmed')
    updateHUD(state({ attackMode: 'magic' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Gust')
  })
})

describe('updateHUD consumable slot', () => {
  it('shows next-up emoji with count and publishes the badge attribute', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [{ kind: 'potion', emoji: '🧪', stackable: true, count: 3 }] }))
    assert.equal(nodes['hud-consumable'].textContent, '🧪×3')
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '🧪')
  })
  it('empty sack shows a dash and clears the badge', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.equal(nodes['hud-consumable'].textContent, '—')
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '')
  })
})

describe('updateHUD stamina bar', () => {
  it('fills proportionally', () => {
    const nodes = fakeDom()
    updateHUD(state({ stamina: 45, maxStamina: 100 }))
    assert.equal(nodes['hud-stamina-fill'].style.width, '45%')
  })
  it('flags the refusal flash while staminaRefusedT is live', () => {
    const nodes = fakeDom()
    updateHUD(state({ staminaRefusedT: 0.3 }))
    assert.equal(nodes['hud-stamina'].dataset.refused, '1')
    updateHUD(state({ staminaRefusedT: 0 }))
    assert.equal(nodes['hud-stamina'].dataset.refused, '')
  })
})
```

(The old quick-badge tests on `hud-items` are replaced by the consumable-slot tests; delete them.)

- [ ] **Step 2: Run to verify failure** — `node --test test/hud.test.js`.

- [ ] **Step 3: Implement hud.js.** Full new body of `updateHUD` (keep `el`, delete `bar`):

```js
import { quickUseSummary } from '../systems/inventory.js'

function el(id) { return document.getElementById(id) }

// One pixel heart as inline SVG; state maps to which halves are filled.
const HEART_PATH = 'M1 1h2v1h1V1h2v3h-1v1h-1v1h-1V5H2V4H1z'   // 7x7 blocky heart
function heart(state) {
  const fills = { full: ['#ef4444', '#ef4444'], half: ['#ef4444', '#3a3a44'], empty: ['#3a3a44', '#3a3a44'] }
  const [left, right] = fills[state]
  return `<svg class="heart" data-state="${state}" viewBox="0 0 7 7" width="14" height="14">`
    + `<clipPath id="hl"><rect x="0" y="0" width="3.5" height="7"/></clipPath>`
    + `<path d="${HEART_PATH}" fill="${right}"/>`
    + `<path d="${HEART_PATH}" fill="${left}" clip-path="url(#hl)"/></svg>`
}

export function updateHUD(state) {
  const { player, level, log } = state
  if (!player) return
  el('hud-level').textContent = `LVL ${level}`
  const hearts = Math.ceil((player.maxHp ?? 10) / 2)
  el('hud-hearts').innerHTML = Array.from({ length: hearts }, (_, i) => {
    const hpForHeart = Math.max(0, Math.min(2, player.hp - i * 2))
    return heart(hpForHeart === 2 ? 'full' : hpForHeart === 1 ? 'half' : 'empty')
  }).join('')
  const mode = player.attackMode
  el('hud-weapon-slot').textContent =
    mode === 'magic' ? 'Gust'
    : mode === 'ranged' ? (player.ranged ? `${player.ranged.name} ${player.ranged.ammo}/${player.ranged.maxAmmo}` : 'No ranged weapon')
    : (player.weapon ? `${player.weapon.name} (${player.weapon.damage} dmg)` : 'Unarmed')
  const quick = quickUseSummary(player.inventory)
  const consumableEl = el('hud-consumable')
  consumableEl.textContent = quick ? `${quick.emoji}×${quick.count}` : '—'
  consumableEl.dataset.quickEmoji = quick?.emoji ?? ''
  const staminaEl = el('hud-stamina')
  el('hud-stamina-fill').style.width =
    `${Math.round(100 * (player.stamina ?? 0) / (player.maxStamina ?? 100))}%`
  staminaEl.dataset.refused = (player.staminaRefusedT ?? 0) > 0 ? '1' : ''
  el('hud-log').textContent = log?.at(-1) ?? ''
}
```

- [ ] **Step 4: Run to verify pass** — `node --test test/hud.test.js`.

- [ ] **Step 5: Update `index.html`.** Replace the `#hud-top` contents:

```html
  <div id="hud-top">
    <span id="hud-hearts"></span>
    <span id="hud-level">LVL 1</span>
    <span id="hud-weapon-slot" style="color:#f6ad55">Unarmed</span>
    <span id="hud-consumable">—</span>
    <span id="hud-stamina"><span id="hud-stamina-fill"></span></span>
  </div>
```

Add CSS next to the existing `#hud-top` rule:

```css
    #hud-hearts { display: flex; gap: 3px; align-items: center; }
    #hud-hearts .heart { image-rendering: pixelated; }
    #hud-stamina {
      margin-left: auto; width: 140px; height: 10px;
      background: #101016; border: 1px solid #3a3a44; overflow: hidden;
    }
    #hud-stamina-fill {
      display: block; height: 100%; width: 100%;
      background: #e8b84b; transition: width 0.1s linear;
    }
    #hud-stamina[data-refused="1"] { border-color: #f87171; }
    #hud-stamina[data-refused="1"] #hud-stamina-fill { background: #f87171; }
```

`#hud-top` keeps its flex row; `gap: 24px` may shrink to `16px` for the extra slots. Delete the now-unused `#hud-weapon`/`#hud-ranged`/`#hud-magic`/`#hud-items` spans and any `bar()`-era leftovers.

- [ ] **Step 6: Full suite.** `npm test` — menu/canvas tests must not reference the removed ids; if `test/menu.test.js` or others fake these elements, update their fixtures the same way.

- [ ] **Step 7: Commit**

```bash
git add renderer/render/hud.js renderer/index.html test/hud.test.js
git commit -m "feat(game): top bar reworked — pixel hearts, stance weapon, consumable, stamina bar"
```

---

### Task 8: Touch layer — rim sprint, badge repoint, bubble removal

**Files:**
- Modify: `renderer/ui/touch-controls.js`, `renderer/index.html`

**Interfaces:**
- Consumes: `#hud-consumable[data-quick-emoji]` (Task 7); synthetic key `'sprint'` consumed by game.js (Task 6).

- [ ] **Step 1: Rim sprint.** In `touch-controls.js` `steer()`, after computing `len`:

```js
    if (len >= NUB_RADIUS * 0.9) press('sprint')
    else release('sprint')
```

and in `endStick` add `release('sprint')` before `setDirs([])`. (`press`/`release` already dispatch synthetic KeyboardEvents; `keys['sprint']` is read by game.js.)

- [ ] **Step 2: Badge repoint + bubble removal.** Replace the observer block: `hudItems` becomes `document.getElementById('hud-consumable')`, drop `quickCount` entirely:

```js
  const consumable = document.getElementById('hud-consumable')
  const quickBtn = document.getElementById('touch-quickuse')
  new MutationObserver(() => {
    quickBtn.classList.toggle('empty', !consumable.dataset.quickEmoji)
  }).observe(consumable, { attributes: true, attributeFilter: ['data-quick-emoji'] })
```

In `index.html`: delete the `<span id="quickuse-count"></span>` from the button, the `#quickuse-count` CSS rule, and the `#touch-quickuse.empty #quickuse-count` rule (keep `#touch-quickuse.empty`).

- [ ] **Step 3: Full suite + commit**

```bash
npm test
git add renderer/ui/touch-controls.js renderer/index.html
git commit -m "feat(game): stick-rim sprint on touch; quick-use bubble moves to the HUD"
```

---

### Task 9: Live verification + docs

**Files:**
- Modify: `/home/lappemikb/CLAUDE.md` (dungeon-crawler systems list)

- [ ] **Step 1: Live emulated-phone check.** Adapt the session's scratchpad pattern (see `check-gamepad.mjs` there; serve with `node tools/web-server.mjs`, context `{ viewport: {width: 915, height: 412}, hasTouch: true, isMobile: true }`, start a run by typing the `level0` cheat): assert (a) a screenshot shows hearts + stamina bar, (b) holding the stick at full deflection for ~1s lowers `document.getElementById('hud-stamina-fill').style.width` below 100%, (c) no page errors. Keep it short — one run, three assertions.

- [ ] **Step 2: Desktop sanity.** Same script, fine-pointer context: double-tap-and-hold ArrowRight via CDP keyboard, assert the fill drops; tap Space with a sword equipped, assert it drops further.

- [ ] **Step 3: Update CLAUDE.md.** In the dungeon-crawler architecture paragraph, add `stamina` to the systems list: `…`talents`…, `stamina` (the one tank pricing melee swings, sprint, and gust casts; sprint detection), …` and change the magic mention if it references mana.

- [ ] **Step 4: Full suite one last time, then commit**

```bash
npm test
git add /home/lappemikb/CLAUDE.md
git commit -m "docs: stamina system in the architecture notes"
```
