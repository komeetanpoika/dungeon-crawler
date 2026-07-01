# Dragon Boss — Collision & Hitbox Revamp

**Date:** 2026-06-30
**Status:** Approved design, ready for implementation plan

## Problem

The final dragon boss looks massive — the renderer (`renderer/render/dragonboss.js`)
draws an articulated beast roughly **6 tiles wide × 8 tiles tall** (`bw = 3*S`,
`bh = 4*S` half-extents). But every gameplay system treats it as a **single point**
at `(e.px, e.py)`:

- **Collision:** `canMoveTo` (`renderer/game.js`) only tests map *tiles*; entities
  never block movement. The player walks straight through the dragon's body, so it
  has no physical presence — it "floats."
- **Movement:** `reposition` in `updateDragonBoss` is a raw pixel-lerp toward an
  anchor at 60 px/s with no weight or acceleration, and the whole rotated sprite
  glides rigidly — it "slides."
- **Contact damage:** a single 1.4-tile circle (`BOSS_CONTACT`) at center. The
  visible head/flanks/tail extend 3–4 tiles past it, so they overlap the player while
  dealing nothing.
- **Player hits:** melee and projectiles land anywhere within a circle of *center*
  (`BOSS_MELEE_RANGE`, `BOSS_PROJECTILE_R`) — you "hit the head" by tapping the tail.
  Hit detection ignores the body shape entirely.

The fix: give the dragon a real, oriented spatial footprint that blocks the player,
deals contact damage where the body actually is, takes hits per-part, and moves with
weight — and shape it all around a specific intended fight loop.

## Intended fight loop (north star)

1. The dragon faces the player and telegraphs its fire breath (neck-rear windup).
2. The player sidesteps out of the forward breath cone.
3. The player is now beside the dragon's exposed **neck** (the weak spot).
4. The player melees the neck for bonus damage.
5. The dragon recovers, turns slowly to re-face, and stomp-pursues to re-close the gap.
6. Repeat.

Ranged attacks are useless against the dragon, so the duel is entirely positional.

## Design

### 1. Spatial model — segmented capsules

The dragon's body is an ordered set of **capsules** defined in **local space**
(relative to the body center, before rotation), transformed by `e.facing` each frame
into world space.

A capsule is `{ part, ax, ay, bx, by, radius }` — a line segment (`a`→`b`) with a
radius. A point is "inside" the capsule when its distance to the segment ≤ radius.
This is a pure, unit-tested function.

Three parts, with geometry derived from the **same constants the renderer uses**
(`bw = 3*S`, `bh = 4*S`, head at the neck-tip ≈ `-bh*0.46` forward, tail at
`+bh*0.46` back) so the hitboxes track the art:

- **`neck`** — from the shoulders forward through the head tip. This is the exposed
  flank **weak spot**. Its forward endpoint follows the neck animation
  (`neckRear` / `headAim`) so the capsule sits where the head visually is. The head
  is folded into this single front part (no separate head hitbox).
- **`core`** — the main body mass. This is the **solid, blocking** part.
- **`tail`** — the rear segment; its endpoint follows `tailSwing` so a tail hit lands
  where the tail visibly is.

Local-frame convention matches the renderer: `-y` is forward (head), `+y` is back
(tail); world transform rotates local coordinates by `e.facing` and offsets by
`(e.px, e.py)`.

### 2. Collision / blocking

- The **`core` capsule is solid.** Player movement that would place the player inside
  the core is rejected, mirroring the existing per-axis `canMoveTo` pattern in
  `moveEntity` (test the tile, then additionally test the core capsule). The player
  can no longer phase through the dragon.
- **`neck` and `tail` do NOT block** — the player must be able to step beside the neck
  to strike it. Those parts deal contact damage instead (see §4).

### 3. Grid-stomp locomotion + crush

Replaces the smooth `reposition` lerp.

- The dragon's **center steps tile-to-tile toward the player** (slow pursuit): each
  step picks the adjacent walkable tile that most reduces distance to the player and
  moves the center one tile, landing on tile centers. Steps fire on an interval
  (`STEP_INTERVAL`, ~0.8 s) with a quick **stomp-then-settle** ease *within* the step
  (the visual eases, but the logical destination is grid-aligned).
- **Facing stays smooth and slow** via the existing `easeAngle` / `TURN_RATE`, and
  remains locked during attack windups — that lock is what opens the
  sidestep→neck window.
- **Footfall feedback:** each completed step triggers a **screenshake** (a decaying
  `state.shake` magnitude read in `Renderer.updateCamera`, applied as a `camX/camY`
  offset) and a **dust puff** reusing the existing particle system.
- **Crush:** if a step would land the `core` on the player, the player is knocked back
  out of the core and takes crush damage instead of overlapping. The dragon cannot be
  face-tanked.

The dragon moves slowly and telegraphs — a lumbering, heavy pursuit, not a glide.

### 4. Hitboxes — damage rules

- **Player melee → dragon:** base damage is a **flat 1, weapon ignored** (weapon
  choice must not trivialize the duel). Resolve which capsule the swing overlaps; if it
  overlaps several, pick the **highest-modifier** part so a neck hit always counts as
  neck. Apply the part modifier:
  - **`neck` ×1.5** → 1.5 damage
  - **`core` ×1.0** → 1 damage
  - **`tail` ×1.0** → 1 damage
- **Player ranged → dragon: immune.** Projectiles register no hit on the dragon and
  pass through (optional tiny "no-effect" visual tick as polish). This forces the melee
  dance.
- **Dragon → player contact:** replace the single center circle (`BOSS_CONTACT`) with
  **per-capsule contact** — overlapping any body capsule deals `CONTACT_DMG` on the
  existing cooldown, so flank/neck/tail contact hurts where the body actually is.
  (Core overlap is normally prevented by blocking; neck/tail contact still applies.)

### 5. Attacks originate from real parts

- **Fire breath / cone** emits from the **head/neck tip** (the renderer already
  computes this point) instead of the body center — fire comes from the mouth, and the
  forward cone the player must sidestep is well-defined.
- **Tail sweep** emits from the **tail tip**, with its arc following `tailSwing`.

### 6. HP / pacing (deferred to playtest)

With a flat-1 base, a neck-only kill is ≈ ⌈28 / 1.5⌉ ≈ **19 hits** and a body-only
kill is **28 hits** (`BOSS_HP = 28`). This may feel long. `BOSS_HP` is left as a
**playtest tuning knob** rather than committing a new number in this spec; revisit it
once the loop is playable (a value around ~18–20 is a likely starting point).

## Components & boundaries

- **Capsule geometry (pure):** `pointInCapsule`, capsule local→world transform by
  facing, and "which part does this point hit (weak-spot wins on overlap)". No
  SQLAlchemy/DOM/Electron deps — lives alongside or beside `systems/dragonboss.js` and
  is unit-tested in isolation.
- **`systems/dragonboss.js`:** owns the capsule definitions (driven by animation
  state), the grid-stomp pursuit state machine (replacing `reposition`), crush
  resolution, per-capsule contact damage, and emitting attacks from real part tips.
- **`game.js`:** player-movement blocking against the core capsule; melee damage
  resolution (flat 1 × part modifier); ranged immunity; footfall → `state.shake` /
  dust wiring.
- **`render/canvas.js`:** `updateCamera` applies the `state.shake` offset. The dragon
  renderer itself is largely unchanged (already articulated); attack-origin points are
  shared with the systems layer.

## Testing

**Unit (pure geometry & rules):**
- `pointInCapsule` correctness (inside, outside, on the radius boundary, zero-length
  segment).
- Local→world capsule transform by `facing` (rotation + offset) lands where expected.
- Multi-overlap part resolution returns the weak-spot (`neck`) when a point is in
  multiple capsules.
- Blocking: a move into the `core` is rejected; moves into `neck`/`tail` are allowed.
- Crush: a stomp step onto the player produces damage + knockback and no overlap.
- Damage: neck = 1.5, core = 1.0, tail = 1.0, regardless of weapon; ranged deals 0.
- Grid-stomp: steps land on tile centers and reduce distance to the player; cadence
  respects `STEP_INTERVAL`.

**Runtime (feel & visuals):**
- Playwright-Electron pass on WSLg (`DISPLAY=:0`) to confirm: the body blocks the
  player, the stomp + screenshake reads as heavy, breath emits from the mouth,
  sidestep→neck hits land, and ranged does nothing.

## Out of scope

- Re-art of the dragon renderer (the articulated look stays).
- New attacks beyond the existing cone/sweep/tail set.
- Tail-hit stagger/interrupt (explicitly dropped — tail is a plain ×1.0 hit).
- Committing a final `BOSS_HP` value (playtest tuning).
