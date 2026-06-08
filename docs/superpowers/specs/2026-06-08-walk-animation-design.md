# Walk Animation — Procedural Step Sway

**Date:** 2026-06-08
**Status:** Approved design

## Problem

Characters in the game move with continuous pixel-based velocity (`px`/`py`), but
each is drawn as a single static Kenney sprite. The sprite never changes relative to
itself while travelling, so characters appear to **glide** across the floor rather than
walk. The Kenney tiny-dungeon tileset has no walk-cycle frames, so a spritesheet swap is
not available.

## Goal

Make walking characters visibly *walk* using a **procedural** animation: a side-to-side
"step sway" — the sprite rocks left and right from its feet, like shifting weight between
steps. The motion is driven by actual movement, so characters stand still and upright when
idle and sway only while moving.

## Scope

Animation applies to **upright bipeds only**:

- `player`
- `guard`
- `wizard`

Explicitly **unchanged**: monsters/spiders, `crab`, `cyclops`, `dragon` — these keep their
current rendering (they have non-bipedal forms and/or bespoke animations).

## Approach

Chosen style: **step sway (tilt)** — a sinusoidal rotation about the character's feet.
Selected over bob/hop, squash-&-stretch, and a combined walk during visual brainstorming
because it reads clearly as walking without a cartoon bounce.

The animation is **distance-driven**, not time-driven: the sway phase advances in
proportion to the pixels a character actually moves. Consequences:

- Faster movement → faster sway (naturally tied to speed).
- A character pressed against a wall (no actual displacement) does **not** sway.
- When a character stops, the sway amplitude eases back to zero so the sprite settles
  **upright** rather than freezing mid-tilt.

## Components

### 1. `renderer/systems/walk.js` (new, pure logic)

```js
export const STRIDE_PX = 30      // distance for one full left-right sway cycle
export const MAX_TILT  = 7        // degrees of peak rotation
const AMP_ATTACK = 12, AMP_DECAY = 10   // sway ramp-in / ease-out rates (per second)

function approach(cur, target, step) {   // move cur toward target, no overshoot
  if (cur < target) return Math.min(target, cur + step)
  return Math.max(target, cur - step)
}

// Advance an entity's walk state from how far it moved since last frame.
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

State lives on the entity object (`walkPhase`, `swayAmp`, `_wpx`, `_wpy`); no separate
registry. Fields are lazily initialised via `?? 0`, so existing entities need no changes
to their factory functions.

### 2. `renderer/game.js` (integration)

Import `tickWalk`. After all movement for the frame is resolved (near the end of
`update(delta)`, before the death/hit-flash cleanup), tick the walkers:

```js
tickWalk(player, delta)
for (const e of state.entities)
  if (e.type === 'guard' || e.type === 'wizard') tickWalk(e, delta)
```

Movement logic is untouched — `tickWalk` only reads `px`/`py`.

### 3. `renderer/render/canvas.js` (rendering)

Add a helper that draws a sprite rotated about its feet, combined with the existing
horizontal flip:

```js
function drawWalker(ctx, sprite, px, py, S, flip, tiltDeg) {
  ctx.save()
  ctx.translate(px + S/2, py + S)          // pivot at feet (center-bottom)
  ctx.rotate(tiltDeg * Math.PI/180)
  ctx.scale(flip ? -1 : 1, 1)
  ctx.drawImage(sprite, -S/2, -S, S, S)
  ctx.restore()
}
```

Wire it into `drawEntity`:

- **player** — draw the body sprite via `drawWalker` with `walkTilt(entity)`. Wrap the
  held-weapon overlay in the **same** transform so the weapon rocks with the body. The
  melee swing animation (`drawMeleeSwing`) is drawn separately and stays untouched.
- **guard** — replace the existing `drawImg(...)` call with `drawWalker(...)`.
- **wizard** — apply `drawWalker` to the **sprite only**; the shield aura circle continues
  to be drawn un-rotated, centered on the wizard.

`drawWalker` requires `walkTilt` and the entity's animation fields; `canvas.js` imports
`walkTilt` from `../systems/walk.js`. All other entity types keep the existing
`drawImg`/flip path.

## Data Flow

```
keyboard / AI  ──>  moveEntity (updates px,py)  ──>  tickWalk (px,py -> walkPhase,swayAmp)
                                                              │
                                                              v
                          drawEntity ── walkTilt(e) ──> drawWalker (tilts sprite at feet)
```

## Edge Cases

- **Idle:** `swayAmp` decays to 0 → `walkTilt` returns 0 → sprite drawn upright.
- **Blocked movement:** no `px`/`py` change → `moved ≈ 0` → no phase advance, sway eases out.
- **Facing flip:** rotation and horizontal flip compose in `drawWalker`; feet stay planted.
- **Large `delta`** (already clamped to 100 ms in `gameLoop`): bounded phase/amp steps.
- **Wizard shield:** unaffected — drawn outside the tilt transform.

## Testing

`test/walk.test.js` (new), matching the existing `node --test` style:

- `walkPhase` advances when `px` changes between `tickWalk` calls; unchanged when `px` is
  static.
- `swayAmp` rises from 0 toward 1 across successive moving frames; decays toward 0 across
  successive idle frames.
- `walkTilt` is exactly 0 when idle (settled upright) and non-zero mid-stride while moving.
- `|walkTilt|` never exceeds `MAX_TILT`.

Manual visual confirmation: `npm start`, walk the player and observe guards/wizard.

## Out of Scope

- Spritesheet / multi-frame animations.
- Animating monsters, crab, cyclops, dragon.
- Attack, hurt, or idle-breathing animations.
- Footstep audio or dust particles.
