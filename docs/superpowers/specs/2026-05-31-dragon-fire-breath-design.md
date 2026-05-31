# Dragon Fire Breath Design

**Date:** 2026-05-31

## Summary

Replace the dragon's current dot-projectile attack with a three-phase pixel-art fire breath. The attack has a visible 1s charge (dragon stops and glows), locks direction at charge-end giving the player a dodge window, then fires an 0.8s cone of pixel-art fire cells with scattered particles. Damage is applied each frame to any player inside the cone geometry. All four fire styles (particle cone, growing fireball, breath cone, ember wave) are saved as named presets for future enemy assignment.

---

## Section 1 — Attack state machine

**File:** `renderer/game.js`

The dragon's existing `shootCooldown` / dot-projectile shooting block is removed and replaced with a state machine on the dragon entity.

**New fields added to dragon in `buildEntities`:**
- `breathState: 'idle'` — current phase (`'idle'` | `'charge'` | `'exhale'`)
- `breathTimer: 2.5` — seconds until next transition
- `breathAngle: 0` — locked firing direction in radians (set at end of charge)

**State transitions:**

| From | To | Condition | Action |
|---|---|---|---|
| `idle` | `charge` | `breathTimer <= 0` AND player within `DRAGON_SHOOT_RANGE` (200px) AND LOS | Set `breathTimer = 1.0`, dragon stops moving |
| `charge` | `exhale` | `breathTimer <= 0` | Lock `breathAngle = atan2(player.py - dragon.py, player.px - dragon.px)`, set `breathTimer = 0.8` |
| `exhale` | `idle` | `breathTimer <= 0` | Set `breathTimer = 2.5` |

During `charge` and `exhale`, the dragon does **not** chase or wander — it stands still.

**Damage:** Each frame during `exhale`, check if the player's center falls inside the cone (distance < 200px AND angle from `breathAngle` within ±12°). If yes, deal `3 * delta` HP to player (= 3 HP/sec). Accumulate fractional damage: apply 1 HP when accumulated damage ≥ 1.

The existing dot-projectile code for the dragon (`isShooter` block in the enemy AI loop with `shootCooldown`) is removed for the dragon. Spiders (medium monsters) keep their existing projectile attack unchanged.

---

## Section 2 — Visual rendering

**File:** `renderer/render/canvas.js`

Add `drawDragonBreath(ctx, dragon, camX, camY, S)`, called in `Renderer.render()` after entity sprites, before health bars. Only runs if `dragon.breathState !== 'idle'`.

### Constants (defined at top of canvas.js or inline)

```
FIRE_PAL = [null, '#3d0000', '#7a0800', '#c22000', '#e85000',
            '#f97316', '#fbbf24', '#fde68a', '#ffffff']
CELL = 4  // px per fire cell
CONE_HALF = Math.PI * 0.21   // ±12° (24° total)
CONE_LEN  = 200               // px
CHARGE_DUR = 1.0              // seconds
EXHALE_DUR = 0.8              // seconds
```

### Charge phase

Draw concentric pixel-art squares (4px stroke, `ctx.strokeRect`) centered on the dragon's screen position. Number of rings = `Math.round(progress * 5) + 1` where `progress = 1 - breathTimer / CHARGE_DUR`. Inner rings hotter (white/yellow), outer rings cooler (orange/red). Alpha fades with ring index. The whole glow flickers via `Math.sin(frame * 0.4)`.

### Exhale phase

**Step 1 — cone fill:** Iterate a grid of 4px cells covering the cone rectangle. For each cell at grid offset `(gx, gy)` from dragon center:
- Compute `halfW = Math.tan(CONE_HALF) * (gx * CELL)` — cone width at this depth
- Skip if `|gy * CELL| > halfW`
- Compute heat: `edgeFall = 1 - (|gy * CELL| / halfW)²`, `tipFall = 1 - progress * 0.4`, `flicker = 0.85 + sin(...)  * 0.15`, `heat = edgeFall * tipFall * flicker * 7 + 1`
- Apply 15% noise kill (random cells omitted) past 30% progress for ragged edges
- Look up `FIRE_PAL[round(heat)]`, draw `fillRect`

The grid is axis-aligned; the dragon always faces east in the sprite (flipped for west). The cone is drawn in world-space using `breathAngle` via `ctx.save() / rotate(breathAngle) / ... / restore()`.

**Step 2 — particles:** Maintain `dragon.breathParticles` array (initialized empty on exhale start, cleared on exhale end). Each frame during exhale, spawn 5 new particles:
- Random angle within `breathAngle ± CONE_HALF`
- Random distance 8–50px from dragon center
- Velocity: `(vx, vy)` along that angle at 1.5–3.5 px/frame with ±0.3 random drift
- Heat: 5–8, decay 0.04–0.1/frame

Each particle draws as a single 4px cell using `FIRE_PAL`, fading with `life`.

---

## Saved fire style presets

All four styles are implemented as named functions in `canvas.js` for future enemy assignment:

| Name | Best for |
|---|---|
| `fireStyleCone(ctx, entity, ...)` | Dragon (C+A combined — this spec) |
| `fireStyleParticles(ctx, entity, ...)` | Fast/small enemy burst |
| `fireStyleFireball(ctx, entity, ...)` | Mid-range growing projectile |
| `fireStyleEmberWave(ctx, entity, ...)` | Boss projectile with spread |

Each accepts `(ctx, entity, targetX, targetY, camX, camY, S)` so they can be wired to any entity in the future.
