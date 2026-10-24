// tools/monster-bench/overlay.js
// The bench's hitbox overlay, drawn over the finished frame: every living
// entity's hit capsule (systems/hitbox.js — the shapes damage is tested
// against) in screen space, the bench monster's own debugDraw (range rings,
// aim lines) at its centre. A handful of strokes per entity — cheap enough
// for the software canvas.
import { hitShape } from '../../renderer/systems/hitbox.js'
import { getMonsterDef } from '../../renderer/systems/monsters.js'

export const capsuleToScreen = (c, camX, camY) =>
  ({ ax: c.ax - camX, ay: c.ay - camY, bx: c.bx - camX, by: c.by - camY, r: c.r })

function strokeCapsule(ctx, c) {
  const ang = Math.atan2(c.by - c.ay, c.bx - c.ax)
  ctx.beginPath()
  ctx.arc(c.ax, c.ay, c.r, ang + Math.PI / 2, ang + Math.PI * 1.5)
  ctx.arc(c.bx, c.by, c.r, ang - Math.PI / 2, ang + Math.PI / 2)
  ctx.closePath()
  ctx.stroke()
}

const COLOURS = { player: '#60a5fa', bench: '#4ade80', other: '#facc15' }
let warnedDraw = false

export function drawOverlay(ctx, state, renderer, name) {
  const { camX, camY, S } = renderer
  ctx.save()
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  for (const e of [state.player, ...state.entities]) {
    if (!e || !Number.isFinite(e.px) || (e !== state.player && !(e.hp > 0))) continue
    ctx.strokeStyle = e === state.player ? COLOURS.player : e.type === name ? COLOURS.bench : COLOURS.other
    strokeCapsule(ctx, capsuleToScreen(hitShape(e), camX, camY))
  }
  ctx.restore()
  const draw = getMonsterDef(name)?.hookModule?.debugDraw
  if (typeof draw !== 'function') return
  for (const e of state.entities) {
    if (e.type !== name) continue
    ctx.save()
    ctx.translate(Math.round(e.px - camX), Math.round(e.py - camY))
    // A broken debugDraw must not take the frame down with it; say so once.
    try { draw(ctx, e, S) } catch (err) { if (!warnedDraw) { warnedDraw = true; console.warn(`bench: ${name} debugDraw failed: ${err.message}`) } }
    ctx.restore()
  }
}
