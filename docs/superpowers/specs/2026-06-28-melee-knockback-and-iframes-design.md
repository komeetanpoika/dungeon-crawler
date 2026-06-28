# Melee Knockback + Damage I-Frames & Flicker — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)

## Summary

Three combat-feel improvements:

1. **Weapon-scaled melee knockback** — when a player melee attack hits an enemy,
   the enemy slides away. The distance scales with the weapon. The slide is an
   **animated** decaying-velocity motion (not an instant snap) and stops at walls.
2. **Damage i-frames** — when the player takes a *discrete hit*, they become
   invulnerable to further discrete hits for a short window.
3. **Flicker** — during that window the player sprite flickers, as the visible
   tell that they are invulnerable.

The knockback motion is built as a **general per-entity mechanism** so it serves
both enemies (shoved by player melee) and the player (shoved by the cyclops
charge and the boss tail). The existing instant knockbacks (cyclops charge, boss
tail) are converted to use it.

## Background

Relevant existing code (from the combat exploration):

- **Player melee** — `meleeHit(style, ...)` + the melee block in `renderer/game.js`
  (~lines 362–384). Attack styles `snap` / `arc` / `slash` / `spin` come from
  `getAttack(weaponType)`. On hit, enemies are rebuilt via `.map` as
  `{ ...e, hp: e.hp - dmg, inCombat: true }`. The dragon boss uses a separate
  range check (`BOSS_MELEE_RANGE`).
- **Player damage is scattered** — `player.hp -= …` happens in `renderer/game.js`
  (generic contact, dragon L9 fire breath), `renderer/systems/crab.js` (grab tick,
  contact), `renderer/systems/cyclops.js` (contact, charge, slam), and
  `renderer/systems/dragonboss.js` (contact, fire cone, tail). Each site also
  pushes a message to `state.log`.
- **Existing knockbacks are instant** — cyclops charge does `player.px += cos(a)*60`
  (and a stun); boss tail does `player.px += (dx/d)*KNOCKBACK` (26px). Both clamp
  against terrain inline.
- **Game loop** — `update(delta)` runs all combat/AI, then clears
  `state.hitEffects`; `render()` draws from finalized state. Player sprite is drawn
  in `renderer/render/canvas.js` (`drawEntity`), with a grab overlay afterward.
- **Entities** track both tile coords (`x`, `y`) and pixel coords (`px`, `py`).

## Design

### Unit 1 — Knockback mechanism (`renderer/systems/knockback.js`)

A small, framework-free module. No DOM, no map specifics — collision is injected.

- **State:** an entity carries `knockback = { vx, vy }` (velocity in px/s) while
  being shoved; the field is cleared (deleted / set to null) when at rest.
- **`startKnockback(entity, dirX, dirY, distance)`** — normalizes `(dirX, dirY)`
  and sets `entity.knockback` to an initial velocity calibrated so the entity
  travels approximately `distance` pixels before settling. Model: velocity with
  exponential drag, `v(t) = v0 · e^(−DRAG·t)`, whose total travel is `v0 / DRAG`;
  therefore `v0 = distance · DRAG`. `DRAG` is chosen so motion settles in ~0.12s
  (e.g. `DRAG = 25`, giving ~3 time constants ≈ 0.12s). A zero/degenerate
  direction is a no-op.
- **`stepKnockback(entity, delta, canMove)`** — advances one frame:
  1. Move per-axis: tentatively `px += vx·delta`; keep it only if
     `canMove(newPx, py)` is true (else zero `vx` so it stops at the wall). Same
     for the Y axis with `canMove(px, newPy)`.
  2. Recompute tile coords: `x = floor(px / TILE_SIZE)`, `y = floor(py / TILE_SIZE)`.
  3. Apply drag: `vx *= e^(−DRAG·delta)` (and `vy`); framerate-independent.
  4. If speed `hypot(vx, vy)` is below a small threshold (e.g. 5 px/s), clear
     `entity.knockback`.
  - Returns nothing; mutates the entity. Safe to call on an entity with no
     `knockback` (no-op).

`canMove(px, py)` is supplied by the caller (`game.js`) and wraps the same
walkability test the game already uses (tile at `floor(px/TILE)`, `floor(py/TILE)`
is walkable). Injecting it keeps this module pure and unit-testable.

### Unit 2 — Player damage with i-frames (`renderer/systems/player-damage.js`)

A single funnel for all player damage. Operates on the shared `state` object.

- **`damagePlayer(state, amount, kind)`** → `boolean` (whether damage landed):
  - `kind === 'hit'`:
    - If `state.player.invulnTimer > 0` → return `false` (no HP change, no log).
    - Else: `state.player.hp -= amount`; set `state.player.invulnTimer = INVULN_DURATION`
      (0.8); append the caller-appropriate log line; return `true`.
  - `kind === 'dot'`:
    - Always: `state.player.hp -= amount`; append log; return `true`.
    - Never reads or sets `invulnTimer`.
  - Log text: preserve the existing per-source messages. The caller passes the
    message (e.g. `damagePlayer(state, 3, 'hit', 'Cyclops hits! (-3 HP)')`), so
    each source keeps its current wording. (Signature:
    `damagePlayer(state, amount, kind, message)`.)
- **`INVULN_DURATION = 0.8`** exported from this module (single source of truth).
- The timer is **decremented** each frame in `update()`:
  `player.invulnTimer = Math.max(0, (player.invulnTimer ?? 0) - delta)`.

**Why a return value:** callers that pair an effect with a hit gate it on the
result. The cyclops charge only knocks the player back / stuns when the hit
actually lands — a charge into an i-framed player connects with nothing.

### Unit 3 — Weapon-scaled melee knockback (wiring in `game.js`)

- Add a `knockback` distance to each attack style returned by `getAttack`:

  | Style (weapon) | knockback (px) |
  |---|---|
  | `snap` (dagger) | 10 |
  | `arc` (sword) | 18 |
  | `slash` (longsword) | 24 |
  | `spin` (axe) | 34 |

- In the melee hit block, for each hit enemy **except `dragon_boss`**, call
  `startKnockback(enemy, enemy.px − player.px, enemy.py − player.py, atk.knockback)`.
  The direction is player-center → enemy-center. The dragon boss is exempt
  (articulated rig; shoving it looks broken). All other enemies (guard, monster,
  normal dragon, crab, cyclops, wizard) are knocked.
  - Because the melee code rebuilds enemies via `.map`, set the knockback on the
    rebuilt object (the same object that gets the HP/`inCombat` update).

### Unit 4 — Convert existing knockbacks to the slide

- **Cyclops charge** (`cyclops.js`): replace the instant `player.px/py += …` shove
  with `startKnockback(player, dx, dy, 60)` (same 60px magnitude, same direction
  away from the cyclops). Gate the whole charge-hit effect (damage + knockback +
  stun) on `damagePlayer(state, 5, 'hit', …) === true`.
- **Boss tail** (`dragonboss.js`): replace the instant tail knockback with
  `startKnockback(player, dx, dy, 26)` (same 26px, outward), gated on the tail
  `damagePlayer(state, 4, 'hit', …)` landing.

### Unit 5 — Central knockback step (in `game.js update()`)

One dedicated pass, placed near the end of `update()` **after** all AI has run
and before `state.hitEffects` is cleared:

```
for (const e of state.entities) stepKnockback(e, delta, canMove)
stepKnockback(state.player, delta, canMove)
```

Running after AI means the brief, high-speed slide visibly dominates chase
movement. Accepted caveat: an actively chasing enemy slightly shortens its own
effective slide; acceptable for v1 and tunable later. No per-AI changes are
required for v1.

### Unit 6 — Flicker rendering (`canvas.js`)

- Pure helper **`isFlickerVisible(invulnTimer, interval = 0.08)`** → `boolean`:
  returns whether to draw the player this frame. Implementation:
  `invulnTimer <= 0 ? true : Math.floor(invulnTimer / interval) % 2 === 0`.
  (Always visible when not invulnerable; otherwise toggles every `interval`.)
- In `drawEntity` / the player-draw path, when the entity is the player and
  `isFlickerVisible(player.invulnTimer)` is false, skip drawing the player body
  sprite for that frame. Other overlays (grab tint, weapon swing) are unaffected.
- Knocked enemies already render at `px/py`, so no render change is needed for
  them beyond confirming the entity draw uses `px/py` (it does).

## Data Flow

```
player presses attack
  → meleeHit() selects enemies (game.js)
  → for each hit enemy ≠ boss: startKnockback(enemy, dir, atk.knockback)   [Unit 3]

enemy attack reaches player
  → damagePlayer(state, amount, 'hit'|'dot', msg)                          [Unit 2]
       'hit' & invuln>0 → blocked (false)
       'hit' & not invuln → hp−, invulnTimer=0.8, true
       'dot' → hp−, true
  → on true, hit-paired effects fire (e.g. startKnockback(player, …))      [Unit 4]

update() each frame
  → invulnTimer decay                                                      [Unit 2]
  → stepKnockback(every entity + player, delta, canMove)                   [Unit 5]

render() each frame
  → isFlickerVisible(player.invulnTimer) decides player-sprite draw        [Unit 6]
```

## Damage-source tagging (hit vs dot)

| Source | File | kind |
|---|---|---|
| Generic enemy contact (guard/monster/dragon) | game.js | hit |
| Dragon (L9) fire breath | game.js | dot |
| Cyclops contact | cyclops.js | hit |
| Cyclops charge | cyclops.js | hit (gates knockback+stun) |
| Cyclops slam | cyclops.js | hit |
| Crab contact | crab.js | hit |
| Crab grab pincer tick | crab.js | dot |
| Boss contact | dragonboss.js | hit |
| Boss fire cone | dragonboss.js | dot |
| Boss tail | dragonboss.js | hit (gates knockback) |

## Constants

- `INVULN_DURATION = 0.8` (s) — i-frame / flicker window.
- Flicker `interval = 0.08` (s).
- Knockback `DRAG = 25` (1/s); settle threshold `5` px/s.
- Melee knockback distances: snap 10, arc 18, slash 24, spin 34 (px).
- Reused magnitudes: cyclops charge 60px, boss tail 26px.

## Error / Edge Handling

- **Walls:** `stepKnockback` zeroes the blocked axis when `canMove` is false, so
  entities never slide into or through walls; diagonal knockback can slide along a
  wall (one axis blocked, the other free).
- **Degenerate direction:** `startKnockback` with a zero vector is a no-op.
- **Boss exemption:** dragon boss never receives melee knockback.
- **i-frames vs DoT:** invulnerability never blocks `dot`; standing in fire or a
  grab that already landed keeps ticking. A grab tick does **not** grant i-frames,
  so it cannot accidentally shield the player from a simultaneous hit.
- **Pause:** `invulnTimer` only decays during `PHASE.PLAYING`, so the flicker
  freezes (rather than draining) while paused — acceptable.
- **Missing fields:** all reads use `?? 0` / null-safe checks so pre-existing
  entities without `knockback` / `invulnTimer` behave correctly.

## Testing

- **`knockback.js`** (pure):
  - `startKnockback` sets velocity in the given direction, scaled to distance;
    zero direction → no `knockback`.
  - `stepKnockback` integrated over enough frames yields total displacement ≈ the
    requested distance (within tolerance) when `canMove` always true.
  - `canMove` returning false on an axis stops motion on that axis (wall-stop).
  - velocity decays and `knockback` clears once settled.
- **`player-damage.js`:**
  - `'hit'` when not invulnerable: HP drops, `invulnTimer` set to 0.8, returns true.
  - `'hit'` when `invulnTimer > 0`: no HP change, returns false.
  - `'dot'`: HP always drops, `invulnTimer` untouched, returns true.
  - (timer decay is exercised via the helper used in `update()`.)
- **`isFlickerVisible`:** true when `invulnTimer <= 0`; alternates true/false on
  successive `interval` buckets.
- **Existing test update:** `test/cyclops.test.js` currently asserts the charge
  instantly shifts `player.px`. Update it to assert the charge sets
  `player.knockback` (velocity away from the cyclops) and respects i-frames
  (no second hit while `invulnTimer > 0`).

## Out of Scope (YAGNI)

- Damage numbers / floating combat text.
- Enemy hit-flash / tint, hit-stop / time-freeze, screen shake.
- Knockback for ranged (projectile) hits.
- Suspending enemy AI movement during knockback (the post-AI step pass is enough
  for v1).
- Knockback resistance/weight per enemy beyond the boss exemption.
