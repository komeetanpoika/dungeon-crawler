// PvP 2a's signature-move visuals, drawn from snapshot state alone (a
// hero's combo, move and charging), so the local match and an online view
// draw the same thing: the Warrior's hold (move arrows and a pulsing ring),
// the lunge's streak, the fence's glints, the whirlwind's ring and sparks,
// and the Archer's draw glow. The pure helpers up top are node-tested; the
// draw calls below them only touch the canvas they are handed.
import { FACING_ANGLE } from '../systems/entities.js'
import { WARRIOR_COMBOS, drawFrac, doubleShotBand } from '../data/pvp.js'

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

// The fence thrusts fired by now, each with its fade (1 fresh → 0 gone after 0.12 s).
export function fenceGlints(move) {
  if (move?.kind !== 'fence') return []
  return WARRIOR_COMBOS.fence.times
    .map((at, i) => ({ i, age: move.t - at }))
    .filter(g => g.age >= -1e-9 && g.age < 0.12)
    .map(g => ({ i: g.i, alpha: 1 - Math.max(0, g.age) / 0.12 }))
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

// A bright blade-trail from where the dash began to where the hero is.
function drawLunge(ctx, mv, cx, cy, camX, camY) {
  const fx = mv.from.px - camX, fy = mv.from.py - camY
  const fade = Math.max(0, 1 - mv.t / WARRIOR_COMBOS.fxDur)
  if (Math.hypot(cx - fx, cy - fy) < 1) return
  ctx.save()
  const g = ctx.createLinearGradient(fx, fy, cx, cy)
  g.addColorStop(0, 'rgba(186,230,253,0)')
  g.addColorStop(1, `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`)
  ctx.strokeStyle = g
  ctx.lineCap = 'round'
  ctx.lineWidth = 8
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(cx, cy); ctx.stroke()
  ctx.strokeStyle = `rgba(125,211,252,${(0.8 * fade).toFixed(3)})`
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(cx, cy); ctx.stroke()
  ctx.restore()
}

// Three zig-zag steel glints, one per thrust, ahead along the fence's line.
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
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.lineTo(22, -5 * side); ctx.lineTo(30, 5 * side); ctx.lineTo(reach, 0)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(reach, 0, 2.5, 0, Math.PI * 2); ctx.fill()
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
