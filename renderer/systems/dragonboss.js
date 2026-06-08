import { isWalkable } from './entities.js'

const TILE = 32
export const BOSS_HP = 28
const TURN_RATE   = 1.2            // rad/s the body rotates to track the player (~2.6s for a 180° turn)
const BOSS_CONTACT = 1.4 * TILE    // contact radius around the body centre (~1.4 tiles)
const CONTACT_DMG = 2
const CONTACT_CD  = 0.8
const CONE_HALF   = 0.34
const CONE_LEN    = 6 * TILE
const CONE_DPS    = 3
const SWEEP_ARC   = 0.7            // headAim sweeps from -SWEEP_ARC to +SWEEP_ARC
const TAIL_REACH  = 3.2 * TILE
const TAIL_HALF   = 1.4            // half-angle of the rear arc the tail sweeps through (~80°)
const TAIL_DMG    = 4
const KNOCKBACK   = 26
const REPOSITION_EVERY = 10

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

  e.stateTimer     = Math.max(0, e.stateTimer - delta)
  e.attackCooldown = Math.max(0, e.attackCooldown - delta)
  e.repositionTimer = Math.max(0, e.repositionTimer - delta)

  switch (e.state) {
    case 'idle':
      e.neckRear  = approach(e.neckRear, 0, 3 * delta)
      e.tailSwing = approach(e.tailSwing, 0, 4 * delta)
      e.headAim   = approach(e.headAim, 0, 3 * delta)
      if (e.repositionTimer <= 0) { startReposition(e, state); break }
      if (e.attackCooldown <= 0) {
        // tail only when the player has flanked into the rear arc (where the tail sweeps);
        // breath handles the front, which is where the facing boss usually keeps the player
        if (inTailArc(e, player))      { e.state = 'tail_windup';  e.stateTimer = 0.4 }
        else if (Math.random() < 0.6)  { e.state = 'sweep_windup'; e.stateTimer = 0.6 }
        else                           { e.state = 'cone';         e.stateTimer = 0.7 }
      }
      break

    case 'cone':
      coneDamage(e, state, e.facing, delta)
      if (e.stateTimer <= 0) endAttack(e)
      break

    case 'sweep_windup':
      e.neckRear = approach(e.neckRear, 1, 2 * delta)
      if (e.stateTimer <= 0) { e.state = 'sweep'; e.stateTimer = 1.5; e.headAim = -SWEEP_ARC }
      break

    case 'sweep': {
      const k = 1 - e.stateTimer / 1.5
      e.headAim = -SWEEP_ARC + 2 * SWEEP_ARC * k
      coneDamage(e, state, e.facing + e.headAim, delta)
      if (e.stateTimer <= 0) { e.neckRear = 0; endAttack(e) }
      break
    }

    case 'tail_windup':
      e.tailSwing = approach(e.tailSwing, -0.6, 4 * delta)
      if (e.stateTimer <= 0) { e.state = 'tail'; e.stateTimer = 0.45; e.dmgAcc = 0 }
      break

    case 'tail': {
      const k = 1 - e.stateTimer / 0.45
      e.tailSwing = -0.6 + 1.6 * k
      if (k > 0.3 && k < 0.8 && e.dmgAcc === 0 && inTailArc(e, player)) {
        player.hp -= TAIL_DMG; e.dmgAcc = 1
        knockback(e, player, state.map)
        state.log = [...state.log, `Tail sweep! (-${TAIL_DMG})`].slice(-5)
      }
      if (e.stateTimer <= 0) { e.tailSwing = 0; endAttack(e) }
      break
    }

    case 'reposition': {
      const ax = e.anchorX * TILE + TILE / 2, ay = e.anchorY * TILE + TILE / 2
      const dx = ax - e.px, dy = ay - e.py, dd = Math.hypot(dx, dy)
      if (dd > 2) {
        const sp = Math.min(60 * delta, dd)
        e.px += (dx / dd) * sp
        e.py += (dy / dd) * sp
        e.x = Math.floor(e.px / TILE)
        e.y = Math.floor(e.py / TILE)
      }
      if (e.stateTimer <= 0 || dd <= 2) {
        e.state = 'idle'; e.repositionTimer = REPOSITION_EVERY; e.attackCooldown = 1.0
      }
      break
    }
  }
}

// The player is within the tail's swing — a wide arc behind the boss (opposite its facing).
function inTailArc(e, player) {
  return pointInCone(player.px, player.py, e.px, e.py, e.facing + Math.PI, TAIL_HALF, TAIL_REACH)
}

function tileWalkable(map, px, py) {
  const t = map[Math.floor(py / TILE)]?.[Math.floor(px / TILE)]
  return !!(t && isWalkable(t.tile, t))
}

function coneDamage(e, state, aim, delta) {
  const { player } = state
  if (pointInCone(player.px, player.py, e.px, e.py, aim, CONE_HALF, CONE_LEN)) {
    e.dmgAcc += CONE_DPS * delta
    while (e.dmgAcc >= 1) {
      player.hp -= 1; e.dmgAcc -= 1
      state.log = [...state.log, 'Dragon fire! (-1 HP)'].slice(-5)
    }
  }
}

function knockback(e, player, map) {
  const dx = player.px - e.px, dy = player.py - e.py, d = Math.hypot(dx, dy) || 1
  const nx = player.px + (dx / d) * KNOCKBACK, ny = player.py + (dy / d) * KNOCKBACK
  if (tileWalkable(map, nx, player.py)) { player.px = nx; player.x = Math.floor(nx / TILE) }
  if (tileWalkable(map, player.px, ny)) { player.py = ny; player.y = Math.floor(ny / TILE) }
}

function startReposition(e, state) {
  const { map } = state
  for (const [dx, dy] of [[3,0],[-3,0],[0,3],[0,-3],[2,2],[-2,-2]]) {
    const tx = e.x + dx, ty = e.y + dy
    if (map[ty]?.[tx] && isWalkable(map[ty][tx].tile, map[ty][tx])) { e.anchorX = tx; e.anchorY = ty; break }
  }
  e.state = 'reposition'; e.stateTimer = 1.2
}

function endAttack(e) { e.state = 'idle'; e.attackCooldown = 1.2 + Math.random() * 0.6; e.stateTimer = 0; e.dmgAcc = 0 }
