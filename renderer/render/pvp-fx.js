// PvP 2a's signature-move visuals, drawn from snapshot state alone (a
// hero's combo, move and charging), so the local match and an online view
// draw the same thing: the Warrior's hold (move arrows and a pulsing ring),
// the lunge's streak, the fence's glints, the whirlwind's ring and sparks,
// and the Archer's draw glow. The pure helpers up top are node-tested; the
// draw calls below them only touch the canvas they are handed.
import { FACING_ANGLE } from '../systems/entities.js'
import { WARRIOR_COMBOS, drawFrac, doubleShotBand, BUFFS, BUFF_COLORS } from '../data/pvp.js'

const SECTOR_ANGLE = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 }
const SECTOR_FACING = { n: 'north', e: 'east', s: 'south', w: 'west' }
// The hold ring's colour by moves entered: white, gold, orange, red, crimson.
const HOLD_COLORS = ['#e6e8e3', '#facc15', '#f59e0b', '#ef4444', '#dc2626']

// The local hero's screen shake: a short one while its own whirlwind spins.
export function comboShake(hero) {
  const mv = hero?.move
  if (mv?.kind !== 'whirl') return 0
  return 5 * Math.max(0, 1 - mv.t / WARRIOR_COMBOS.fxDur)
}

// The hold's arrows above the head: one per move, centred, 8 px apart.
export function holdArrows(combo) {
  const n = combo?.moves?.length ?? 0
  return (combo?.moves ?? []).map((dir, i) => ({ dir, angle: SECTOR_ANGLE[dir], dx: (i - (n - 1) / 2) * 8 }))
}

// The fence thrusts fired by now, each with its fade (1 fresh → 0 gone after
// 0.18 s — widened from 0.12 (m7) so the glint reads clearly before it fades).
const GLINT_FADE = 0.18
export function fenceGlints(move) {
  if (move?.kind !== 'fence') return []
  return WARRIOR_COMBOS.fence.times
    .map((at, i) => ({ i, age: move.t - at }))
    .filter(g => g.age >= -1e-9 && g.age < GLINT_FADE)
    .map(g => ({ i: g.i, alpha: 1 - Math.max(0, g.age) / GLINT_FADE }))
}

// The draw glow's colour: the band the draw has reached, dim white below it.
export function drawGlow(hero) {
  if (hero?.charging?.kind !== 'double') return null
  const frac = drawFrac(hero.charging.t)
  const band = doubleShotBand(frac)
  return { color: band?.color ?? 'rgba(255,255,255,0.35)', frac, full: frac >= 1 - 1e-9 }
}

// --- drawing -----------------------------------------------------------

export function drawComboFx(ctx, hero, camX, camY) {
  const cx = hero.px - camX, cy = hero.py - camY
  if (hero.combo) drawHold(ctx, hero.combo, cx, cy)
  const mv = hero.move
  if (mv?.kind === 'lunge') drawLunge(ctx, mv, cx, cy, camX, camY)
  else if (mv?.kind === 'fence') drawFence(ctx, mv, cx, cy)
  else if (mv?.kind === 'whirl') drawWhirl(ctx, mv, cx, cy)
  const glow = drawGlow(hero)
  if (glow) drawBowGlow(ctx, hero, glow, cx, cy)
}

function drawHold(ctx, combo, cx, cy) {
  const n = combo.moves.length
  ctx.save()
  // The ring swells a step with each move and breathes while held.
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.012)
  ctx.strokeStyle = HOLD_COLORS[Math.min(n, HOLD_COLORS.length - 1)]
  ctx.lineWidth = 2 + n * 0.5
  ctx.globalAlpha = 0.45 + 0.35 * pulse
  ctx.beginPath(); ctx.arc(cx, cy, 15 + n * 2 + pulse * 1.5, 0, Math.PI * 2); ctx.stroke()
  // One small arrow per move, above the head.
  ctx.globalAlpha = 0.95
  ctx.fillStyle = '#f8fafc'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1
  for (const a of holdArrows(combo)) {
    ctx.save()
    ctx.translate(cx + a.dx, cy - 26)
    ctx.rotate(a.angle)
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-3, 3.5); ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}

// A bright blade-trail from where the dash began to where the hero is: a
// wide streak at full alpha, brightest at the leading (hero) end, with a
// hot white core down the middle (m7: raised from a thin, half-alpha line
// so the lunge reads clearly). One gradient and two strokes — no
// shadowBlur, no per-frame allocation beyond that.
function drawLunge(ctx, mv, cx, cy, camX, camY) {
  const fx = mv.from.px - camX, fy = mv.from.py - camY
  const fade = Math.max(0, 1 - mv.t / WARRIOR_COMBOS.fxDur)
  if (Math.hypot(cx - fx, cy - fy) < 1) return
  ctx.save()
  const g = ctx.createLinearGradient(fx, fy, cx, cy)
  g.addColorStop(0, 'rgba(186,230,253,0)')
  g.addColorStop(0.4, `rgba(186,230,253,${(0.6 * fade).toFixed(3)})`)
  g.addColorStop(1, `rgba(255,255,255,${fade.toFixed(3)})`)
  ctx.strokeStyle = g
  ctx.lineCap = 'round'
  ctx.lineWidth = 12
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(cx, cy); ctx.stroke()
  // The bright core running down the middle of the streak.
  ctx.strokeStyle = `rgba(255,255,255,${fade.toFixed(3)})`
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(cx, cy); ctx.stroke()
  ctx.restore()
}

// Three zig-zag steel glints, one per thrust, ahead along the fence's line:
// a wider zig-zag with a bright white core over the steel (m7: the old
// narrow, thin-lined glint was easy to miss). Re-stroking the same path for
// the core costs one more stroke call, not a rebuilt path.
function drawFence(ctx, mv, cx, cy) {
  const a = FACING_ANGLE[SECTOR_FACING[mv.dir]] ?? 0
  const reach = WARRIOR_COMBOS.fence.reach
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(a)
  ctx.lineJoin = 'miter'
  for (const g of fenceGlints(mv)) {
    const side = g.i % 2 === 0 ? 1 : -1               // alternate high and low
    ctx.globalAlpha = g.alpha
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.lineTo(22, -9 * side); ctx.lineTo(30, 9 * side); ctx.lineTo(reach, 0)
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(reach, 0, 3, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

// A spinning ring of steel at the whirlwind's reach, sparks flying off it.
function drawWhirl(ctx, mv, cx, cy) {
  const k = Math.min(1, mv.t / WARRIOR_COMBOS.fxDur)
  const r = WARRIOR_COMBOS.whirl.reach
  const spin = k * Math.PI * 4
  ctx.save()
  ctx.globalAlpha = 1 - k
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 4
  for (let i = 0; i < 4; i++) {                       // four blades of steel chasing round
    const a0 = spin + i * Math.PI / 2
    ctx.beginPath(); ctx.arc(cx, cy, r * (0.7 + 0.3 * k), a0, a0 + Math.PI / 3); ctx.stroke()
  }
  ctx.fillStyle = '#fde68a'
  for (let i = 0; i < 10; i++) {                      // sparks thrown outward
    const a = i * 2.39996 + spin * 0.5
    const d = r * (0.8 + k * 0.9)
    ctx.fillRect(cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 2, 2)
  }
  ctx.restore()
}

// A glow on the bow side, stepping through the bands; a steady ring at full.
function drawBowGlow(ctx, hero, glow, cx, cy) {
  const a = FACING_ANGLE[hero.facing] ?? 0
  const bx = cx + Math.cos(a) * 12, by = cy + Math.sin(a) * 12
  ctx.save()
  ctx.globalAlpha = 0.35 + 0.5 * glow.frac
  ctx.fillStyle = glow.color
  ctx.beginPath(); ctx.arc(bx, by, 3 + 5 * glow.frac, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = glow.color
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, 15, -Math.PI / 2, -Math.PI / 2 + glow.frac * Math.PI * 2); ctx.stroke()
  if (glow.full) {
    ctx.globalAlpha = 0.3 + 0.3 * Math.sin(Date.now() * 0.02)
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
}

// A double-shot arrow's tail, in its band's colour.
export function drawArrowTrail(ctx, p, bpx, bpy) {
  const len = Math.hypot(p.dx, p.dy) || 1
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = p.color ?? '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bpx - (p.dx / len) * 12, bpy - (p.dy / len) * 12)
  ctx.lineTo(bpx, bpy)
  ctx.stroke()
  ctx.restore()
}

// --- 2b: buff spots, buff looks ---------------------------------------
// (spec 2026-09-27-pvp-2b-pickups-arenas-design.md §2-§3)

// Each buff's icon in the sprite atlas.
export const BUFF_ICON = { haste: 'buff_haste', might: 'buff_might', ward: 'buff_ward', ember: 'buff_ember', venom: 'buff_venom' }

// How a buff spot is drawn: the icon of the buff up now, or — while the
// spot is down — the ghost of the one it brings back at 30 % alpha. A
// major is drawn larger, with a gold rim and a slow pulse (`t`: seconds,
// the renderer's clock).
export function spotLook(p, t = 0) {
  const major = p.tier === 'major'
  const kind = p.up ? p.buff : p.next
  const pulse = major ? 0.5 + 0.5 * Math.sin(t * 2.5) : 0
  return { key: BUFF_ICON[kind] ?? null, kind, alpha: p.up ? 1 : 0.3, scale: major ? 1.3 + 0.08 * pulse : 1,
    rim: major, pulse }
}

// What a hero's buffs and damage-over-time look like: the Haste trail,
// the Might glint, the Ward bubble (its opacity the pool left, 0-1), the
// edge's embers or drips, a burn's flicker, a poison's tint.
export function heroLooks(hero) {
  const b = hero?.buffs ?? {}
  const ward = b.ward ? b.ward.pool / BUFFS.ward[b.ward.tier].pool : 0
  return { haste: !!b.haste, might: !!b.might, ward, edge: b.edge?.kind ?? null,
    burning: (hero?.burn?.t ?? 0) > 0, poisoned: (hero?.poison?.t ?? 0) > 0 }
}

// A buff spot, at its tile's top-left (px, py).
export function drawBuffSpot(ctx, p, sprites, px, py, S, t = performance.now() / 1000) {
  const look = spotLook(p, t)
  const img = look.key && sprites[look.key]
  const size = S * look.scale, x = px + (S - size) / 2, y = py + (S - size) / 2
  ctx.save()
  // A soft disc in the buff's colour under the icon, so each kind reads at a glance.
  ctx.fillStyle = BUFF_COLORS[look.kind] ?? '#ffffff'
  ctx.globalAlpha = look.alpha * 0.25
  ctx.beginPath(); ctx.arc(px + S / 2, py + S / 2, size * 0.45, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = look.alpha
  if (look.rim) {
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2 + look.pulse
    ctx.beginPath(); ctx.arc(px + S / 2, py + S / 2, size * 0.55, 0, Math.PI * 2); ctx.stroke()
  }
  if (img) ctx.drawImage(img, x, y, size, size)
  ctx.restore()
}

// Under the sprite: Haste's speed trail, three streaks behind the facing.
export function drawBuffUnder(ctx, hero, cx, cy, S, t = performance.now() / 1000) {
  if (!heroLooks(hero).haste) return
  const a = (FACING_ANGLE[hero.facing] ?? 0) + Math.PI
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux
  ctx.save()
  ctx.strokeStyle = BUFF_COLORS.haste
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  for (let i = -1; i <= 1; i++) {
    const len = 14 + 5 * Math.sin(t * 18 + i * 2)
    const sx = cx + ux * S * 0.3 + nx * i * 8, sy = cy + uy * S * 0.3 + ny * i * 8
    ctx.globalAlpha = i === 0 ? 0.75 : 0.5
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * len, sy + uy * len); ctx.stroke()
  }
  ctx.restore()
}

// Over the sprite: the Ward bubble, the Might glint, the edge's embers or
// drips, and a burn's flicker or a poison's tint over the hero's square.
export function drawBuffOver(ctx, hero, hx, hy, S, t = performance.now() / 1000) {
  const look = heroLooks(hero)
  const cx = hx + S / 2, cy = hy + S / 2
  ctx.save()
  if (look.burning) {
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t * 18)
    ctx.fillStyle = '#f97316'
    ctx.fillRect(hx, hy, S, S)
    ctx.fillStyle = '#fde047'                         // two licks of flame at the feet
    for (let i = 0; i < 2; i++) {
      const h = 6 + 4 * Math.sin(t * 14 + i * 3)
      ctx.globalAlpha = 0.85
      ctx.fillRect(hx + 8 + i * 12, hy + S - h, 4, h)
    }
  }
  if (look.poisoned) {
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(hx, hy, S, S)
  }
  if (look.ward > 0) {
    ctx.globalAlpha = 0.15 + 0.3 * look.ward
    ctx.fillStyle = BUFF_COLORS.ward
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.62, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.4 + 0.5 * look.ward
    ctx.strokeStyle = '#e0e7ff'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  if (look.might) {
    // A red four-point glint at the weapon hand, on the side the hero faces.
    const side = hero.facing === 'west' ? -1 : 1
    const gx = cx + side * S * 0.32, gy = cy + S * 0.1
    const r = 4 + 2 * Math.sin(t * 9)
    ctx.globalAlpha = 1
    ctx.fillStyle = BUFF_COLORS.might
    ctx.beginPath()
    ctx.moveTo(gx, gy - r * 1.8); ctx.lineTo(gx + r * 0.5, gy); ctx.lineTo(gx, gy + r * 1.8); ctx.lineTo(gx - r * 0.5, gy); ctx.closePath()
    ctx.moveTo(gx - r * 1.8, gy); ctx.lineTo(gx, gy + r * 0.5); ctx.lineTo(gx + r * 1.8, gy); ctx.lineTo(gx, gy - r * 0.5); ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillRect(gx - 1, gy - 1, 2, 2)
  }
  if (look.edge === 'ember') {
    ctx.fillStyle = BUFF_COLORS.ember
    for (let i = 0; i < 6; i++) {
      const k = (t * 0.9 + i / 6) % 1
      ctx.globalAlpha = 0.95 * (1 - k)
      ctx.fillRect(cx - 13 + i * 5 + Math.sin(t * 5 + i) * 2, cy + S * 0.35 - k * S, 3, 3)
    }
  } else if (look.edge === 'venom') {
    ctx.fillStyle = BUFF_COLORS.venom
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.8 + i / 4) % 1
      ctx.globalAlpha = 0.95 * (1 - k)
      ctx.fillRect(cx - 11 + i * 7, cy - S * 0.1 + k * S * 0.6, 3, 4)
    }
  }
  ctx.restore()
}
