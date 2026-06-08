import { isWalkable } from './entities.js'

const TILE = 32
export const BOSS_HP = 28
const TURN_RATE   = 2.5            // rad/s the body rotates to track the player
const BOSS_CONTACT = 1.4 * TILE    // contact radius around the body centre (~1.4 tiles)
const CONTACT_DMG = 2
const CONTACT_CD  = 0.8

// Is (px,py) inside the cone with apex (ox,oy), centre direction `aim`,
// half-angle `half` (rad) and length `len`? Pure — unit tested.
export function pointInCone(px, py, ox, oy, aim, half, len) {
  const dx = px - ox, dy = py - oy
  const d = Math.hypot(dx, dy)
  if (d === 0 || d > len) return false
  let diff = Math.atan2(dy, dx) - aim
  while (diff >  Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return Math.abs(diff) <= half
}

export function makeDragonBoss(x, y) {
  return {
    type: 'dragon_boss', x, y, hp: BOSS_HP, maxHp: BOSS_HP, inCombat: false,
    anchorX: x, anchorY: y, facing: 0,
    // animation state read by the renderer:
    neckRear: 0, headAim: 0, tailSwing: 0, breathTime: 0,
    // ai/attack state:
    state: 'idle', stateTimer: 0, attackCooldown: 1.2,
    repositionTimer: 10, damageCooldown: 0, dmgAcc: 0,
  }
}

export function approach(c, t, s) { return c < t ? Math.min(t, c + s) : Math.max(t, c - s) }

export function easeAngle(cur, target, maxStep) {
  let d = target - cur
  while (d >  Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep
}

export function updateDragonBoss(e, state, delta) {
  const { player } = state
  e.breathTime += delta
  e.damageCooldown = Math.max(0, e.damageCooldown - delta)
  const dist = Math.hypot(player.px - e.px, player.py - e.py)
  if (dist < 12 * TILE) e.inCombat = true

  // turn to face the player
  const target = Math.atan2(player.py - e.py, player.px - e.px)
  e.facing = easeAngle(e.facing, target, TURN_RATE * delta)

  // contact damage
  if (dist < BOSS_CONTACT && e.damageCooldown <= 0) {
    player.hp -= CONTACT_DMG
    e.damageCooldown = CONTACT_CD
    state.log = [...state.log, `Hit for ${CONTACT_DMG} damage!`].slice(-5)
  }

  // (attack state machine added in Task 2 — for now just settle to idle)
  e.neckRear  = approach(e.neckRear, 0, 3 * delta)
  e.tailSwing = approach(e.tailSwing, 0, 4 * delta)
  e.headAim   = approach(e.headAim, 0, 3 * delta)
}
