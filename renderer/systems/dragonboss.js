import { isWalkable } from './entities.js'
import { damagePlayer } from './player-damage.js'
import { startKnockback } from './knockback.js'
import { dragonCapsules, pointInCapsule } from './capsules.js'

const TILE = 32
export const BOSS_HP = 28
const TURN_RATE   = 0.8            // rad/s the body rotates to track the player (~3.9s for a 180° turn)
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
const STEP_INTERVAL = 0.8          // seconds between stomp steps
const STEP_DUR      = 0.35         // seconds the body eases across one tile
const STOMP_RANGE   = 14 * TILE    // start pursuing within this distance
const CRUSH_DMG     = 3
const CRUSH_KNOCK   = 30

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
    damageCooldown: 0, dmgAcc: 0,
    stepTimer: 0, stepFrom: null, stepTo: null, stepK: 0, footfall: false,
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

  // turn to face the player — but ONLY while not committed to an attack. Locking facing
  // during windups/attacks gives the player a window to run around to the flank/back.
  if (e.state === 'idle' || e.state === 'stomp') {
    const target = Math.atan2(player.py - e.py, player.px - e.px)
    e.facing = easeAngle(e.facing, target, TURN_RATE * delta)
  }

  // contact damage — overlapping ANY body capsule hurts, matching the visible body.
  // passive body contact only while NOT mid-attack — during an attack the attack itself
  // is the damage source, and sharing the i-frame window would eat its knockback.
  if (e.state === 'idle' && e.damageCooldown <= 0 && playerTouchesBody(e, player)) {
    if (damagePlayer(state, CONTACT_DMG, 'hit', `Hit for ${CONTACT_DMG} damage!`)) {
      e.damageCooldown = CONTACT_CD
    }
  }

  e.stateTimer     = Math.max(0, e.stateTimer - delta)
  e.attackCooldown = Math.max(0, e.attackCooldown - delta)

  switch (e.state) {
    case 'idle':
      e.neckRear  = approach(e.neckRear, 0, 3 * delta)
      e.tailSwing = approach(e.tailSwing, 0, 4 * delta)
      e.headAim   = approach(e.headAim, 0, 3 * delta)
      if (dist > 1.6 * TILE && dist < STOMP_RANGE && e.attackCooldown > 0.2) { startStomp(e, state); break }
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
        e.dmgAcc = 1
        if (damagePlayer(state, TAIL_DMG, 'hit', `Tail sweep! (-${TAIL_DMG})`)) {
          startKnockback(player, player.px - e.px, player.py - e.py, KNOCKBACK)
        }
      }
      if (e.stateTimer <= 0) { e.tailSwing = 0; endAttack(e) }
      break
    }

    case 'stomp': {
      e.footfall = false
      if (!e.stepTo) { e.state = 'idle'; break }
      e.stepK = Math.min(1, e.stepK + delta / STEP_DUR)
      // ease across the tile (smoothstep) — logical destination is a tile centre
      const t = e.stepK * e.stepK * (3 - 2 * e.stepK)
      e.px = e.stepFrom.x + (e.stepTo.x - e.stepFrom.x) * t
      e.py = e.stepFrom.y + (e.stepTo.y - e.stepFrom.y) * t
      e.x = Math.floor(e.px / TILE); e.y = Math.floor(e.py / TILE)
      // crush: if the core now overlaps the player, shove + damage (once per step)
      if (!e.crushDone && coreHitsPlayer(e, player)) {
        e.crushDone = true
        if (damagePlayer(state, CRUSH_DMG, 'hit', `Crushed! (-${CRUSH_DMG})`)) {
          startKnockback(player, player.px - e.px, player.py - e.py, CRUSH_KNOCK)
        }
      }
      if (e.stepK >= 1) {
        e.footfall = true                 // one-frame signal for screenshake/dust
        e.px = e.stepTo.x; e.py = e.stepTo.y
        e.stepTo = null; e.crushDone = false
        e.stepTimer = STEP_INTERVAL
        e.state = 'idle'; e.attackCooldown = Math.max(e.attackCooldown, 0.4)
      }
      break
    }
  }
}

function playerTouchesBody(e, player) {
  return dragonCapsules(e).some(c =>
    pointInCapsule(player.px, player.py, c.ax, c.ay, c.bx, c.by, c.radius))
}

// World position of the dragon's mouth (the neck capsule's forward tip).
function mouth(e) {
  const neck = dragonCapsules(e).find(c => c.part === 'neck')
  // the tip is the endpoint further from the body centre
  const da = Math.hypot(neck.ax - e.px, neck.ay - e.py)
  const db = Math.hypot(neck.bx - e.px, neck.by - e.py)
  return da > db ? { x: neck.ax, y: neck.ay } : { x: neck.bx, y: neck.by }
}

// The player is within the tail's swing — a wide arc behind the boss (opposite its facing).
function inTailArc(e, player) {
  return pointInCone(player.px, player.py, e.px, e.py, e.facing + Math.PI, TAIL_HALF, TAIL_REACH)
}

function coneDamage(e, state, aim, delta) {
  const { player } = state
  const m = mouth(e)
  if (pointInCone(player.px, player.py, m.x, m.y, aim, CONE_HALF, CONE_LEN)) {
    e.dmgAcc += CONE_DPS * delta
    while (e.dmgAcc >= 1) {
      damagePlayer(state, 1, 'dot', 'Dragon fire! (-1 HP)')
      e.dmgAcc -= 1
    }
  }
}

// Begin a single grid-step toward the player along the best walkable cardinal/diagonal.
function startStomp(e, state) {
  const { map, player } = state
  const here = { x: Math.floor(e.px / TILE), y: Math.floor(e.py / TILE) }
  const sx = Math.sign(player.px - e.px), sy = Math.sign(player.py - e.py)
  // candidate steps, preferring the direction that most reduces distance
  const cands = [[sx, sy], [sx, 0], [0, sy]].filter(([dx, dy]) => dx !== 0 || dy !== 0)
  for (const [dx, dy] of cands) {
    const tx = here.x + dx, ty = here.y + dy
    if (map[ty]?.[tx] && isWalkable(map[ty][tx].tile, map[ty][tx])) {
      e.stepFrom = { x: e.px, y: e.py }
      e.stepTo = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
      e.stepK = 0; e.crushDone = false; e.state = 'stomp'
      return
    }
  }
  // nowhere to step — stay idle
  e.state = 'idle'; e.stepTimer = STEP_INTERVAL
}

// Does the core capsule currently overlap the player?
function coreHitsPlayer(e, player) {
  const core = dragonCapsules(e).find(c => c.part === 'core')
  return pointInCapsule(player.px, player.py, core.ax, core.ay, core.bx, core.by, core.radius)
}

function endAttack(e) { e.state = 'idle'; e.attackCooldown = 1.2 + Math.random() * 0.6; e.stateTimer = 0; e.dmgAcc = 0 }
