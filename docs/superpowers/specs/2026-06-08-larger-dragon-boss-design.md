# Larger Dragon Boss (Depth 10) — Design

**Date:** 2026-06-08
**Status:** Approved design

## Problem / Goal

The current dragon (depth 9) is a single flat `creature_dragon` sprite drawn at 3×, with a
fixed fire-breath cone. We want a **new, larger, articulated dragon boss** as the game's
true finale on a new **depth 10** — with independently animated head and tail, a scaled
procedurally-drawn body, and two signature attacks. The existing depth-9 dragon stays
exactly as-is; the boss is a separate entity.

## Scope

**In scope:** a new `dragon_boss` entity (logic + procedural articulated rendering), a new
depth-10 arena + theme, moving the treasure/win condition to depth 10, and wiring the boss
into spawning, the AI loop, combat, and FOV/health-bar rendering.

**Out of scope:** changing the existing `dragon`; enrage/second phase; meteor/dive/wing-buffet
attacks; new art assets (the boss is drawn procedurally on the canvas).

## Progression & Arena

- `FINAL_DEPTH`: **9 → 10** (`renderer/data/levels.js`).
- **Depth 9 unchanged** except it is no longer the finale: it keeps the current dragon, but
  the treasure/win is removed there (it now lives on depth 10). The depth-9 `DRAGON_LAIR`
  template currently contains a `T` (treasure tile) in its center row — that `T` is replaced
  with floor (`.`) directly in the template string (no runtime special-casing); the
  treasure moves to the new depth-10 `GREAT_LAIR` template. (Note: the `X` in `DRAGON_LAIR`
  is a snare tile, not treasure — leave it.)
- **New arena template `GREAT_LAIR`** in `levels.js` `TEMPLATES`: a large, mostly-open
  chamber ~26×22 (open floor with a thick wall border, gently rounded corners), sized for
  the 3×4 dragon plus room to circle it. Markers in the template (matching `placeTemplate`'s
  existing alphabet — `T` = treasure tile, `D` = old dragon, `#`/`.` = wall/floor; `B` is
  new):
  - `B` — the dragon boss anchor (back-center of the chamber).
  - `T` — the treasure, placed **behind** the boss (between boss and back wall), so the
    fight gates the win.
  - Open floor with no internal pillars (keeps the sweeping breath and tail sweep readable).
- **New depth-10 theme** appended to `DEPTH_THEMES`: climactic molten/obsidian look —
  `bgColor: '#0a0406'`, `tint: 'rgba(60,10,0,0.35)'`, `fogAlpha: 0.8`, `floorTile: 'floor'`,
  reusing existing deep-floor props sparsely.
- **New `LEVEL_CONFIG` entry** for depth 10: `landmark: 'GREAT_LAIR'`, low `guardCount`
  and `monsterDensity` (boss is the focus), `staircaseWidth` irrelevant (no exit — final
  level), `weapons: ['longsword','axe']`.

The map generator (`renderer/systems/map.js`) already stamps landmark templates and reads
tile markers; it must learn the `B` marker → emit a `dragon_boss` spawn (alongside the
existing `D`, `X`, etc. handling). No depth-9 special-casing is needed — the depth-9
treasure is removed by editing the `DRAGON_LAIR` template itself.

## Boss Entity & Behavior

New module **`renderer/systems/dragonboss.js`** — pure logic, no rendering.

### `makeDragonBoss(x, y)`

Returns an entity:

```js
{
  type: 'dragon_boss', x, y,
  hp: 28, maxHp: 28, inCombat: false,
  anchorX: x, anchorY: y,             // tile the dragon holds
  facing: 0,                          // body/head aim angle (radians), eases toward player
  // animation state read by the renderer:
  neckRear: 0,                        // 0..1, how far the neck is reared (breath windup)
  headAim: 0,                         // extra head yaw offset (sweeping breath sweep)
  tailSwing: 0,                       // -1..1, tail whip progress (0 = idle)
  breathTime: 0,                      // seconds, drives idle breathing pulse
  // attack/AI state:
  state: 'idle',                      // 'idle'|'cone'|'sweep_windup'|'sweep'|'tail_windup'|'tail'|'reposition'
  stateTimer: 0,
  attackCooldown: 1.2,
  repositionTimer: 10,
  damageCooldown: 0,
}
```

### `updateDragonBoss(e, state, delta)`

Dispatched from the `game.js` enemy AI loop (like `updateCyclops`/`updateWizard`/`updateCrab`).

1. **Facing:** compute angle to player; ease `e.facing` toward it (clamped turn rate, e.g.
   ~2.5 rad/s) so the whole rig rotates to track the player.
2. **Idle clock:** `e.breathTime += delta` (drives the breathing pulse + wing flap in the
   renderer). When `state==='idle'`, ease `neckRear`, `headAim`, `tailSwing` back toward 0.
3. **Reposition:** `repositionTimer` counts down; when it expires, **or** the player has
   stayed in a rear arc (behind the dragon, |angleToPlayer − facing| > ~2.4 rad) for >3s,
   enter `reposition`: pick a new anchor tile a few tiles away (toward open floor, still
   walkable), crawl `e.px/e.py` toward it over ~1.2s, then resume `idle` and reset the timer.
4. **Attack selection** (when `state==='idle'` and `attackCooldown<=0`), by distance
   `d = hypot(player.px−e.px, player.py−e.py)`:
   - `d` within **tail reach** (≲ 3.2 tiles) and roughly beside/behind → **tail sweep**.
   - otherwise → alternate **fixed cone** and **sweeping breath** (favor sweeping ~60%).
5. **Attack state machines:**
   - **Fixed cone (`cone`):** brief windup, then fire a straight cone aimed along `facing`
     for ~0.7s. Damage ticks (e.g. 3 HP/s) while the player is inside a cone of half-angle
     `CONE_HALF` and length `CONE_LEN`, tested with the shared `pointInCone` helper.
   - **Sweeping breath (`sweep_windup` → `sweep`):** windup ~0.6s raises `neckRear` to 1
     (telegraph). Then over ~1.5s, `headAim` sweeps from `−SWEEP_ARC/2` to `+SWEEP_ARC/2`;
     the cone aim = `facing + headAim`. Damage ticks while the player is inside the swept
     cone.
   - **Tail sweep (`tail_windup` → `tail`):** windup ~0.4s coils the tail (`tailSwing` →
     −0.6, telegraph). Then over ~0.45s `tailSwing` whips to +1; on the active frames, if
     the player is within tail reach in the swung arc, apply **burst damage (4)** + a
     **knockback impulse** away from the dragon (reuse the cyclops slam-ring knockback
     approach — push the player's `px/py` outward, respecting `canMoveTo`).
   - After any attack, set `attackCooldown` (~1.2–1.8s) and return to `idle`.
6. **Contact damage:** if the player overlaps the body footprint (use a larger radius,
   `BOSS_CONTACT ≈ 1.4 tiles`, since the body spans ~3×4 tiles) and `damageCooldown<=0`,
   deal 2 and set the cooldown.
7. Set `e.inCombat = true` once the player is engaged (drives the health bar).

### Shared geometry helper

`pointInCone(px, py, ox, oy, aimAngle, halfAngle, length)` → bool. Pure, unit-tested,
reused by the fixed cone, the sweeping cone, and (with a wide half-angle / short length)
the tail arc check.

## Rendering

New module **`renderer/render/dragonboss.js`** exporting
`drawDragonBoss(ctx, e, camX, camY, S)`. `canvas.js` adds one branch in `drawEntity`:

```js
if (entity.type === 'dragon_boss') { drawDragonBoss(ctx, entity, this.camX, this.camY, this.S); return }
```

(Note: the boss draw needs camera + tile size; `canvas.js` passes them, mirroring how
`drawDragonBreath`/`drawCyclopsEffects` already receive `camX,camY`.)

The module ports the procedural rig validated in brainstorming, **driven by entity state**
(not mockup timers). Draw order: wings → legs → tail → body(scales) → dorsal spikes →
neck → head → active breath cone. The whole rig is translated to the boss's screen position
and rotated by `e.facing` (so it tracks the player), with positions rounded to integers to
keep the pixel art crisp.

**Locked scale-body layout constants** (from the tuner):

```
size 0.9, aspect 1.45, rowSpace 0.36, colSpace 0.5,
bow 0.6, bowExp 1.4, rotFollow 0.6, spineBias 0.16,
jitter 0.42, peak 0.04, round 0.16
```

Scale rows follow an **upward-opening parabola** (`yc = y − bow·|nx|^bowExp`, vertex at row
middle), each scale rotated to the curve tangent (`rotFollow`), sized larger near the spine
(`spineBias`) with stable hash jitter, shaded **dark-top → light-bottom**, peak/round per
the shield shape. A dark underlay is clipped to the body silhouette so seams don't show.

Component parts (all procedural, as in the v3/v7 mockups):
- **Body:** tapered silhouette (`STATIONS` width profile) filled entirely by shield scales.
- **Neck:** 5-segment bendy chain from the front of the body; bend driven by `neckRear`
  (S-curve rear-up) and idle sway; head sits at the chain tip, oriented to the tip angle.
- **Head:** ellipse head with horns + eyes; the breath cone originates here.
- **Tail:** 6-segment chain from the rear; idle travelling sine + whip driven by `tailSwing`.
- **Wings:** paneled membranes with finger-struts, shoulder pivots inboard near the
  centerline/front, gentle flap from `breathTime`.
- **Dorsal spikes**, **four legs** with claw hints.

**Breath cone effect:** generalize the existing `drawDragonBreath` (in `canvas.js`) to take
an explicit `(aimAngle, halfAngle, length)` so the same fiery cone renders for both the
fixed and sweeping breath; the boss renderer calls it with `e.facing (+ e.headAim)` while
`state` is `cone`/`sweep`. (Keep the existing depth-9 dragon calling it with its current
parameters unchanged.)

## Integration Points (`renderer/game.js`)

- Import `makeDragonBoss`/`updateDragonBoss`; `buildEntities` handles spawn kind
  `dragon_boss` (place at tile center like other large enemies).
- `isEnemy(e)` includes `'dragon_boss'` (so player melee/projectiles damage it and it's
  culled at `hp<=0`).
- The enemy AI loop dispatches `dragon_boss` → `updateDragonBoss(e, state, delta)` (early
  `continue`, like cyclops/wizard/crab), bypassing the generic chase logic.
- Melee/projectile **hit radius vs the boss**: the generic checks use small radii; add a
  larger effective radius when the target is `dragon_boss` so hits on the big body register.
- Win flow unchanged: stepping on the depth-10 `TREASURE` tile and pressing `X` triggers
  `endRun(true)`. `run.deepestLevel` default and any `9` literals tied to the old final
  depth are updated to use `FINAL_DEPTH`.
- Health bar: the existing `drawHealthBars` renders for `inCombat` entities with `hp/maxHp`;
  the boss qualifies. Bar is drawn above the body; acceptable for v1 (a dedicated screen-top
  boss bar is a possible later polish, out of scope).

## Data Flow

```
map gen ('B' marker) ──> dragon_boss spawn ──> buildEntities ──> entity in state.entities
game loop update ──> updateDragonBoss (writes facing, neckRear, headAim, tailSwing, breathTime, hp)
                          │   └─ pointInCone / knockback ──> player.hp, player.px/py
                          v
canvas.drawEntity ──> drawDragonBoss(ctx, e, camX, camY, S)  ──> articulated rig + breath cone
```

## Testing

`test/dragonboss.test.js` (`node --test`, matching existing suites):
- `makeDragonBoss` initial fields (hp 28, state 'idle', anchors set).
- **Facing easing:** after several `updateDragonBoss` ticks with the player to one side,
  `e.facing` moves toward the angle to the player (and is clamped per-frame).
- **Attack selection:** player in close/rear range → enters a tail state; player at range →
  enters a cone/sweep state; no new attack while `attackCooldown > 0`.
- **Sweeping cone damage:** player inside the swept arc loses HP during `sweep`; player
  outside does not.
- **Tail sweep:** during the active `tail` frames a player in reach takes burst damage and
  is pushed outward (px/py change away from the dragon).
- **Contact damage** respects `damageCooldown`.
- **`pointInCone`** geometry: points inside/outside the half-angle and beyond length; a
  rotated cone (non-zero aim) classifies correctly.

Renderer verified by running the game (`npm start`): the boss tracks the player, the neck
rears and the cone sweeps, the tail whips with knockback, and the scaled body matches the
locked look. Depth-9 dragon confirmed unchanged.

## Files

- **New:** `renderer/systems/dragonboss.js`, `renderer/render/dragonboss.js`,
  `test/dragonboss.test.js`.
- **Modified:** `renderer/data/levels.js` (FINAL_DEPTH, `GREAT_LAIR` template, depth-10
  theme + config, remove `T` from `DRAGON_LAIR` template), `renderer/systems/map.js` (`B`
  marker → boss spawn), `renderer/render/canvas.js` (`dragon_boss` draw branch; generalize
  breath-cone params), `renderer/game.js` (imports, `buildEntities`, `isEnemy`, AI dispatch,
  boss hit radius, `FINAL_DEPTH` literals).
```
