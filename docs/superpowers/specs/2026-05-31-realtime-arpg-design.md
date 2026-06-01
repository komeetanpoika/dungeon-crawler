# Real-Time ARPG Conversion Design

**Date:** 2026-05-31

## Summary

Convert the dungeon crawler from turn-based to a real-time action RPG. The dungeon generator, sprite system, tile renderer, level configs, and win condition are preserved unchanged. The game loop, player movement, combat, and enemy AI are rewritten from scratch. Stealth, noise, and alert systems are removed entirely.

---

## Section 1 — Game loop & input

Replace the `keydown → processTurn` event chain with a `requestAnimationFrame` loop. A persistent input state object tracks held keys:

```js
const keys = {}
window.addEventListener('keydown', e => keys[e.key] = true)
window.addEventListener('keyup',   e => keys[e.key] = false)
```

Each frame computes `delta = Math.min(now - lastTime, 100) / 1000` (seconds, capped at 100ms to prevent spiral-of-death on tab switch). All movement and timers multiply by `delta`.

The noise bar is removed from the HUD. All other HUD elements (HP, level, weapon, log) are preserved.

**Files:**
- `renderer/game.js` — rewrite game loop; remove `processTurn`, `onKey`, `noiseMap`, `pendingNoise`
- `renderer/render/hud.js` — remove `hud-noise-bar` update
- `renderer/index.html` — remove noise bar DOM element

---

## Section 2 — Player movement & collision

Player position becomes `{ px: float, py: float }` in pixels (distinct from tile coords `x`, `y` which are derived as `Math.floor(px / TILE_SIZE)`). Speed: **120 px/sec**.

**8-directional movement:** WASD and arrow keys. When two perpendicular keys are held, the velocity vector is normalized so diagonal speed equals straight speed.

**Collision:** Each frame, compute intended new position. Test the player's **12×12px bounding box** (centered in the 32px tile) against the tile map using the existing `isWalkable`. Resolve per-axis: attempt X movement first, then Y — if blocked on one axis, slide along the other.

**Facing:** Updated to the last pressed movement direction (north/south/east/west). Defaults south.

**Pickups:** Walk onto a weapon/potion tile to collect (same auto-pickup as before). Stairs: walk onto stair tile + press Enter to descend.

---

## Section 3 — Combat

### Melee (Space)

Pressing Space swings in the current facing direction. The hitbox is a **48×24px rectangle** extending 1.5 tiles in front of the player, active for one frame. All enemies whose center falls inside take `weapon.damage` HP (1 if unarmed). Cooldown: **0.4s**. Reuses existing `drawHitEffect` for visual feedback.

### Ranged (Shift)

Pressing Shift spawns a projectile at the player's center moving at **280 px/sec** in the facing direction. Projectile travels until it hits a non-walkable tile or an enemy center comes within **8px**. On enemy hit: deals `weapon.damage` HP and despawns. On wall hit: despawns. Unlimited ammo. Cooldown: **0.6s** (independent of melee). Renders as a **4×4px yellow rectangle**.

Projectiles are tracked in a `state.projectiles` array: `{ x, y, dx, dy }`.

### Enemy contact damage

If an enemy's center is within **20px** of the player's center, it deals **1 HP** to the player. Per-enemy damage cooldown: **0.8s** (tracked as `damageCooldown` on the entity). This replaces guard/dragon bump-attack.

### Death

Enemy HP ≤ 0 → removed from `state.entities`. Existing removal logic unchanged.

---

## Section 4 — Enemy AI

All enemy types (guard, monster, dragon) share one behavior loop:

**Idle (wander):** Move at **30 px/sec** in a random direction. Pick a new random direction every **1–2 seconds** (random per entity). Blocked by walls — on collision, pick a new direction immediately.

**Chase:** If player is within **180px** AND `hasLineOfSight` returns true (reused from `stealth.js`), switch to chase at **80 px/sec** directly toward the player.

**Return to idle:** If player moves beyond **240px** from enemy, drop back to wander.

Enemies do not collide with each other. Enemy collision against walls uses the same tile-based bounding box check as the player (8×8px box for enemies).

Each enemy gains: `{ px: float, py: float, wanderTimer: float, wanderDx: float, wanderDy: float, damageCooldown: float }`.

The dragon has 12 HP and 2 HP contact damage (0.8s cooldown). The snare tile in the lair has no effect in this mode.

---

## What is removed

| System | File | Action |
|---|---|---|
| Turn processing | `renderer/game.js` | Delete `processTurn`, `onKey` |
| Player action resolver | `renderer/systems/turn.js` | Entire file unused |
| Stealth & noise | `renderer/systems/stealth.js` | Most functions unused; `hasLineOfSight` is moved to `renderer/systems/map.js` before the file is removed |
| Alert states | `renderer/systems/entities.js` | `ALERT` enum unused; remove from guard/monster factories |
| Patrol routes | `renderer/systems/entities.js` | `patrol`, `patrolIndex`, `moveCooldown`, `moveTimer` removed from `makeGuard` |
| Noise bar | `renderer/render/hud.js` + `index.html` | Remove element and update call |
| Dragon snare mechanic | `renderer/game.js` | Snare timer / SLEEPING override removed |
| Dragon sleep meter | `renderer/render/hud.js` | `showDragonMeter` / `hideDragonMeter` unused |

## What is kept

- `renderer/systems/map.js` — dungeon generator, unchanged
- `renderer/render/canvas.js` — tile + entity renderer; add projectile draw
- `renderer/render/sprites.js` — sprite loader, unchanged
- `renderer/data/levels.js` — templates and level configs (guardCount etc. become spawn counts for the generic enemy spawner)
- `renderer/data/entities.js` — `TILE`, `TILE.SNARE`, `makePlayer`, weapon types, `isWalkable`, `hasLineOfSight`; entity factories simplified
- `renderer/systems/meta.js` — run metadata, unchanged
- Win condition (reach TREASURE tile → won), stairs descent, chests, potions — all unchanged
