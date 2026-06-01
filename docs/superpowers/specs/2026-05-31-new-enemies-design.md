# New Enemy Types Design

**Date:** 2026-05-31

## Summary

Add three new enemy types — cyclops, evil wizard, and crab — each implemented in its own behavior module under `renderer/systems/`. Each file exports a factory function and an update function called from the main game loop. This structure makes it easy to add further enemies without touching the core loop.

---

## Architecture

Three new files in `renderer/systems/`:

| File | Exports |
|---|---|
| `cyclops.js` | `makeCyclops(x, y)`, `updateCyclops(entity, state, delta)` |
| `wizard.js` | `makeWizard(x, y)`, `updateWizard(entity, state, delta)` |
| `crab.js` | `makeCrab(x, y)`, `updateCrab(entity, state, delta)` |

`game.js` imports each update function and calls it from the enemy AI loop. `buildEntities()` adds three new spawn cases. `sprites.js` gets three new entries. `canvas.js` handles 2×2 cyclops rendering and the player grab tint.

The existing `isEnemy()` helper in `game.js` is extended to include `'cyclops'`, `'wizard'`, and `'crab'`.

---

## Section 1 — Cyclops (Level 6 Boss)

**Sprite:** `tile_0109` drawn at 64×64px (2× normal tile size)

**Stats:**
- HP: 30
- Speed: 40 px/sec
- Contact damage: 3 HP (cooldown 0.8s)
- Collision box: 56×56px centered on `px/py`

**State machine:**

| State | Duration | Behavior |
|---|---|---|
| `chase` | — | Moves toward player at 40 px/sec. Triggers `charge_windup` if player within 200px + LOS and `chargeCooldown === 0`. Triggers `slam_windup` every 5–8s (randomized). |
| `charge_windup` | 1.5s | Stops moving. Shakes in place (`sin(Date.now() * 0.03) * 3` px offset). On expire: locks `chargeAngle` toward player, enters `charging`. |
| `charging` | max 3s | Moves at 300 px/sec along `chargeAngle`. Wall collision → `stunned` 2.5s. Player within 50px → 5 HP + 60px knockback + `stunned` 0.5s. Timer expire → `chase`. |
| `stunned` | variable | Fully immobile. Drawn at 60% opacity. On expire: sets `chargeCooldown = 8`, → `chase`. |
| `slam_windup` | 1s | Stops moving. Orange glow. On expire → `slamming`. |
| `slamming` | 0.4s | Instant AOE: 80px radius, 4 HP to player if in range. Expanding ring drawn for 0.4s. Then → `chase`. |

**Entity fields:**
```js
{
  type: 'cyclops', x, y, px, py,
  hp: 30, maxHp: 30,
  state: 'chase', stateTimer: 0,
  chargeAngle: 0,
  slamTimer: 5,        // countdown to next slam attempt
  slamRing: null,      // { radius, timer } when active
  damageCooldown: 0, chargeCooldown: 0,
  wanderDx: 0, wanderDy: 0,
}
```

**Rendering additions in `canvas.js`:**
- Sprite drawn at 64×64 (pass `size = S * 2` to draw call)
- `charge_windup`: horizontal shake offset
- `stunned`: `ctx.globalAlpha = 0.6`
- `slam_windup`: orange glow ring (strokeRect, expanding)
- `slamming`: expanding circle ring fading out

**Level generation:**
- Level 6 map generation guarantees a 7×7 clear floor area (no walls, no columns) placed near the map center.
- Cyclops spawns at the center tile of this arena.
- Implementation: after the normal level generation pass, carve out the arena by forcing those tiles to `TILE.FLOOR`.

---

## Section 2 — Evil Wizard (Levels 3–5)

**Sprite:** `tile_0111`

**Stats:**
- HP: 12
- Speed: 50–70 px/sec (context-dependent)
- No contact damage
- Collision box: 12×12px (same as other enemies)

**Movement (kiting):**
- If player within 120px: flee directly away at 70 px/sec
- Otherwise: strafe in a circle around the player at 50 px/sec (move perpendicular to player direction)

**Spell rotation** (2s cooldown between casts, cycles in order):

| Index | Spell | Projectile |
|---|---|---|
| 0 | Bolt | Single, 300 px/sec, 2 HP, purple |
| 1 | Bolt | Same |
| 2 | Spread | 3 projectiles at −20°/0°/+20° toward player, 200 px/sec, 1 HP each, purple |
| 3 | Shield | 3s full invincibility + white glow ring, resets index to 0 after |

Wizard projectiles use `color: 'purple'` to distinguish them from player projectiles (yellow).

**Summoning:**
- Every 8s, spawns 1–2 bat entities within 60px
- Capped at 4 active summoned minions total — checked by counting entities where `e.summonedBy === wizard.id`
- Spawned bats have `summonedBy` set to the wizard's id; no separate counter needed
- Each wizard gets a unique `id`: `'wizard_' + Math.random().toString(36).slice(2)`

**Entity fields:**
```js
{
  type: 'wizard', x, y, px, py,
  hp: 12, maxHp: 12,
  spellIndex: 0, spellCooldown: 2,
  shieldTimer: 0,       // >0 = invincible
  summonTimer: 8,
  damageCooldown: 0,
  id: 'wizard_' + Math.random().toString(36).slice(2),
}
```

**Rendering additions:** White glow ring (strokeRect or arc) when `shieldTimer > 0`.

---

## Section 3 — Crab (Levels 2–4)

**Sprite:** `tile_0110`

**Stats:**
- HP: 20
- Speed: 65 px/sec
- Contact damage: 1 HP (cooldown 0.8s)
- Collision box: 12×12px

**Armored front:**
- Each frame: `crab.facing = atan2(player.py - crab.py, player.px - crab.px)`
- Incoming projectile deflection check: `angleDiff = |projectile_angle - crab.facing|` (normalized to [0, π]). If `angleDiff < π/3` (60°): projectile removed, no damage.
- Melee damage always applies regardless of angle.

**Strafe movement:**
- Direction toward player: `(dx, dy)` normalized
- Perpendicular: `(-dy, dx)` (right-strafe)
- Alternates strafe direction every 2–3s (randomized: `strafeDirTimer = 2 + Math.random()`) to prevent pure circling
- Combined velocity: `0.3 * toward + 0.7 * perpendicular`, normalized, × 65 px/sec

**Pincer grab:**
- Trigger: crab center within 25px of player center, `grabCooldown === 0`
- While grabbing: player `px/py` locked, crab stops, `grabDamageTimer` ticks
- Damage: 1 HP every 0.3s for 2s total
- On release (2s or crab death): `grabCooldown = 5`
- Visual: red tint overlay on player sprite (`ctx.globalAlpha` + red fillRect over player)

**Entity fields:**
```js
{
  type: 'crab', x, y, px, py,
  hp: 20, maxHp: 20,
  facing: 0,
  strafeDir: 1,         // 1 or -1, flips periodically
  strafeDirTimer: 2,
  grabState: null,      // null | 'grabbing'
  grabTimer: 0,
  grabDamageTimer: 0,
  grabCooldown: 0,
  damageCooldown: 0,
}
```

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/cyclops.js` | New: factory + update |
| `renderer/systems/wizard.js` | New: factory + update |
| `renderer/systems/crab.js` | New: factory + update |
| `renderer/systems/map.js` | Add arena carve-out for level 6 |
| `renderer/game.js` | Import update fns; extend `isEnemy`; add spawn cases; pass `grabbed` state to render |
| `renderer/render/sprites.js` | Add cyclops, wizard, crab entries |
| `renderer/render/canvas.js` | 2×2 cyclops draw; slam ring; shield glow; grab tint; projectile color support (wizard = purple, player = yellow) |
| `renderer/data/levels.js` | Add cyclops/wizard/crab to level spawn configs |
