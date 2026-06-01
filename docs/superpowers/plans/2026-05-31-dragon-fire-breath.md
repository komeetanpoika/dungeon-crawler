# Dragon Fire Breath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dragon's dot-projectile attack with a three-phase pixel-art fire breath: 1s charge (dragon glows, stands still), direction locks, 0.8s cone exhale with fire-cell grid + scattered particles, 2.5s cooldown.

**Architecture:** Three tasks — (1) update dragon entity init and remove dot-projectile code from game.js, (2) add the breath state machine + damage + particle logic to the enemy AI loop in game.js, (3) add pixel-art rendering in canvas.js. The spider's projectile attack is untouched throughout.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron

---

## File Map

| File | Change |
|---|---|
| `renderer/game.js` | Add breath constants; update `buildEntities`; block movement during breath; add breath state machine; add particle logic in AI loop |
| `renderer/render/canvas.js` | Add `FIRE_PAL`, `drawDragonBreath`; call it in `Renderer.render()` |

---

## Task 1: Dragon entity init + remove dot-projectile

**Files:**
- Modify: `renderer/game.js`

No automated tests — game.js uses browser globals. Verified by running the game.

- [ ] **Step 1: Replace dragon constants and remove `DRAGON_SHOOT_COOLDOWN`**

In `renderer/game.js`, find and replace the existing constants block. The current constants include:

```js
const SPIDER_SHOOT_RANGE = 130
const DRAGON_SHOOT_RANGE = 200
const SPIDER_SHOOT_COOLDOWN = 2.0
const DRAGON_SHOOT_COOLDOWN = 1.5
```

Replace with (keep `SPIDER_*`, remove dragon-specific shoot cooldown, add breath timing):

```js
const SPIDER_SHOOT_RANGE = 130
const DRAGON_SHOOT_RANGE = 200
const SPIDER_SHOOT_COOLDOWN = 2.0
const DRAGON_CHARGE_DUR   = 1.0
const DRAGON_EXHALE_DUR   = 0.8
const DRAGON_BREATH_COOLDOWN = 2.5
const DRAGON_CONE_HALF    = Math.PI * 0.21   // ±12°, 24° total
```

- [ ] **Step 2: Update dragon entry in `buildEntities`**

In `renderer/game.js`, find:

```js
case 'dragon':  return [{ ...makeDragon(s.x, s.y, s.roomId),  px: cx, py: cy, facing: 'east', shootCooldown: Math.random() * DRAGON_SHOOT_COOLDOWN, ...wander() }]
```

Replace with:

```js
case 'dragon':  return [{ ...makeDragon(s.x, s.y, s.roomId), px: cx, py: cy, facing: 'east',
  breathState: 'idle', breathTimer: DRAGON_BREATH_COOLDOWN, breathAngle: 0,
  breathProgress: 0, breathParticles: [], breathDamageAcc: 0, ...wander() }]
```

- [ ] **Step 3: Remove dragon from the `isShooter` block**

In `renderer/game.js`, find:

```js
const isShooter = (e.type === 'monster' && e.variant === 'medium') || e.type === 'dragon'
```

Replace with (spider only):

```js
const isShooter = e.type === 'monster' && e.variant === 'medium'
```

- [ ] **Step 4: Block dragon movement during charge and exhale**

In `renderer/game.js`, find the movement block in the enemy AI loop:

```js
    const prevPx = e.px
    if (chasing && dist > CONTACT_RANGE) {
```

Replace with:

```js
    const canMove = e.type !== 'dragon' || e.breathState === 'idle'
    const prevPx = e.px
    if (canMove && chasing && dist > CONTACT_RANGE) {
```

Also gate the wander movement the same way. Find:

```js
    } else if (dist < CHASE_DROP_RANGE) {
```

Replace with:

```js
    } else if (canMove && dist < CHASE_DROP_RANGE) {
```

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js && git commit -m "feat: replace dragon dot-projectile with breath state machine setup"
```

---

## Task 2: Dragon breath state machine + damage + particles

**Files:**
- Modify: `renderer/game.js`

No automated tests — verified by running the game on level 9.

- [ ] **Step 1: Add breath state machine to the enemy AI loop**

In `renderer/game.js`, directly after the `movedX` / facing update line and before the `isShooter` block, add:

```js
    // Dragon fire breath state machine
    if (e.type === 'dragon') {
      e.breathTimer = Math.max(0, e.breathTimer - delta)

      if (e.breathState === 'idle') {
        if (e.breathTimer <= 0 && dist < DRAGON_SHOOT_RANGE &&
            hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
          e.breathState = 'charge'
          e.breathTimer = DRAGON_CHARGE_DUR
          e.breathProgress = 0
        }

      } else if (e.breathState === 'charge') {
        e.breathProgress = 1 - e.breathTimer / DRAGON_CHARGE_DUR
        if (e.breathTimer <= 0) {
          e.breathState = 'exhale'
          e.breathTimer = DRAGON_EXHALE_DUR
          e.breathProgress = 0
          e.breathAngle = Math.atan2(player.py - e.py, player.px - e.px)
          e.breathParticles = []
          e.breathDamageAcc = 0
        }

      } else if (e.breathState === 'exhale') {
        e.breathProgress = 1 - e.breathTimer / DRAGON_EXHALE_DUR

        // Damage: 3 HP/sec while player is inside cone
        const dx = player.px - e.px, dy = player.py - e.py
        const playerDist = Math.hypot(dx, dy)
        if (playerDist < DRAGON_SHOOT_RANGE && playerDist > 0) {
          let angleDiff = Math.atan2(dy, dx) - e.breathAngle
          while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI
          if (Math.abs(angleDiff) < DRAGON_CONE_HALF) {
            e.breathDamageAcc += 3 * delta
            while (e.breathDamageAcc >= 1) {
              player.hp -= 1
              e.breathDamageAcc -= 1
              state.log = [...state.log, 'Dragon fire! (-1 HP)'].slice(-5)
            }
          }
        }

        // Spawn particles
        for (let i = 0; i < 5; i++) {
          const a = e.breathAngle + (Math.random() - 0.5) * DRAGON_CONE_HALF * 2
          const spd = 1.5 + Math.random() * 2
          const d = 8 + Math.random() * 50
          e.breathParticles.push({
            x: e.px + Math.cos(a) * d, y: e.py + Math.sin(a) * d,
            vx: Math.cos(a + (Math.random() - 0.5) * 0.6) * spd,
            vy: Math.sin(a + (Math.random() - 0.5) * 0.6) * spd,
            heat: 5 + Math.random() * 3, life: 1,
            decay: 0.04 + Math.random() * 0.06,
          })
        }

        // Advance and cull particles
        e.breathParticles = e.breathParticles
          .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy,
            vx: p.vx + (Math.random() - 0.5) * 0.2,
            vy: p.vy + (Math.random() - 0.5) * 0.2,
            life: p.life - p.decay, heat: Math.max(1, p.heat - 0.06) }))
          .filter(p => p.life > 0)

        if (e.breathTimer <= 0) {
          e.breathState = 'idle'
          e.breathTimer = DRAGON_BREATH_COOLDOWN
          e.breathParticles = []
        }
      }
    }
```

- [ ] **Step 2: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js && git commit -m "feat: dragon breath state machine with damage and particles"
```

---

## Task 3: Pixel-art fire breath rendering

**Files:**
- Modify: `renderer/render/canvas.js`

No automated tests — verified visually.

- [ ] **Step 1: Add `FIRE_PAL` and `drawDragonBreath` to `canvas.js`**

In `renderer/render/canvas.js`, add this block immediately before the `drawHealthBars` function:

```js
const FIRE_PAL = [
  null, '#3d0000', '#7a0800', '#c22000', '#e85000',
  '#f97316', '#fbbf24', '#fde68a', '#ffffff',
]
const BREATH_CELL = 4
const BREATH_CONE_MAX = 200
const BREATH_CONE_HALF = Math.PI * 0.21

function drawDragonBreath(ctx, dragon, camX, camY) {
  if (!dragon || dragon.breathState === 'idle') return
  const cx = dragon.px - camX
  const cy = dragon.py - camY

  if (dragon.breathState === 'charge') {
    const t = dragon.breathProgress ?? 0
    const flicker = Math.sin(Date.now() * 0.012) * 0.5 + 0.5
    const rings = Math.round(t * 5) + 1
    ctx.save()
    ctx.lineWidth = BREATH_CELL
    for (let r = 1; r <= rings; r++) {
      const heat = Math.min(8, Math.max(1, Math.round((7 - r) * flicker + 1)))
      ctx.globalAlpha = flicker * (1 - r * 0.16)
      ctx.strokeStyle = FIRE_PAL[heat]
      const hw = r * BREATH_CELL * 2
      ctx.strokeRect(cx - hw, cy - hw, hw * 2, hw * 2)
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  if (dragon.breathState === 'exhale') {
    const t = dragon.breathProgress ?? 0
    const coneLen = BREATH_CONE_MAX * Math.min(1, t * 2.5)
    const gridCols = Math.ceil(coneLen / BREATH_CELL)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(dragon.breathAngle)

    for (let gx = 0; gx < gridCols; gx++) {
      const worldX = gx * BREATH_CELL
      const halfW = Math.tan(BREATH_CONE_HALF) * worldX
      const halfCells = Math.ceil(halfW / BREATH_CELL) + 1
      const progress = gx / Math.max(1, gridCols)

      for (let gy = -halfCells; gy <= halfCells; gy++) {
        const worldY = gy * BREATH_CELL
        const edgeDist = halfW > 0 ? Math.abs(worldY) / halfW : 0
        if (edgeDist > 1) continue
        if (progress > 0.3 && Math.random() < 0.15) continue  // ragged edges

        const edgeFall = 1 - edgeDist * edgeDist
        const tipFall  = 1 - progress * 0.4
        const flicker  = 0.85 + Math.sin(gx * 0.8 + gy * 1.2) * 0.15
        const heat = Math.min(8, Math.max(1, Math.round(edgeFall * tipFall * flicker * 7 + 1)))

        ctx.globalAlpha = Math.min(1, edgeFall * 1.4)
        ctx.fillStyle = FIRE_PAL[heat]
        ctx.fillRect(gx * BREATH_CELL, gy * BREATH_CELL, BREATH_CELL, BREATH_CELL)
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()

    // Particles
    if (dragon.breathParticles) {
      for (const p of dragon.breathParticles) {
        if (p.life <= 0) continue
        const px = Math.round((p.x - camX) / BREATH_CELL) * BREATH_CELL
        const py = Math.round((p.y - camY) / BREATH_CELL) * BREATH_CELL
        const heat = Math.min(8, Math.max(1, Math.round(p.heat)))
        ctx.globalAlpha = p.life * 0.9
        ctx.fillStyle = FIRE_PAL[heat]
        ctx.fillRect(px, py, BREATH_CELL, BREATH_CELL)
      }
      ctx.globalAlpha = 1
    }
  }
}
```

- [ ] **Step 2: Call `drawDragonBreath` in `Renderer.render()`**

In `renderer/render/canvas.js`, inside `Renderer.render(state)`, find:

```js
    drawMeleeSwing(ctx, player, sprites, camX, camY, S)
    drawHealthBars(ctx, entities, map, camX, camY, S)
```

Replace with:

```js
    drawMeleeSwing(ctx, player, sprites, camX, camY, S)
    const dragon = entities.find(e => e.type === 'dragon')
    if (dragon) drawDragonBreath(ctx, dragon, camX, camY)
    drawHealthBars(ctx, entities, map, camX, camY, S)
```

- [ ] **Step 3: Start the game and verify**

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

Verification:
- [ ] On level 9, when approaching the dragon, it stops and pulses with expanding pixel squares for ~1s
- [ ] After charge, a narrow pixel-art fire cone fires in the locked direction for ~0.8s
- [ ] Player takes damage while standing in the cone (log says "Dragon fire! (-1 HP)")
- [ ] Player can dodge by moving out of the cone direction during the 1s charge
- [ ] After exhale, the dragon resumes normal behaviour for 2.5s before charging again
- [ ] Spider projectiles (purple dots) are unaffected

- [ ] **Step 4: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: pixel-art dragon fire breath rendering — cone + particles"
```
