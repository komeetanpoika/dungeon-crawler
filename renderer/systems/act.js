// The movement brain: executes parameterized movement intents from brain.js
// (or directly from enemy state machines). Owns the HOW of moving — path and
// field following, enemy separation, wall sliding, escape from geometry —
// while brain.js owns the WHAT (chase, hunt, patrol, flee).
import { buildNavGrid, buildFlowField, findPath, fieldStep, canMoveTo, clearanceFor, nearestPassable } from './nav.js'
import { hasLineOfSight } from './entities.js'

const S = 32
const SEP_RADIUS = 20        // px within which enemies push each other apart
const SEP_WEIGHT = 0.6
const REPATH_INTERVAL = 0.5  // s between A* recomputes for a moving target
const WAYPOINT_REACHED = 10  // px

// Player flow field, cached on state and rebuilt only when the player's tile
// (or the map) changes — the maybeComputeFOV trick applied to navigation.
export function getPlayerField(state, clearance = 1) {
  const nav = buildNavGrid(state.map)
  const p = state.player
  const cache = state._flowFields ?? (state._flowFields = {})
  const c = cache[clearance]
  if (!c || c.x !== p.x || c.y !== p.y || c.nav !== nav) {
    cache[clearance] = { x: p.x, y: p.y, nav, field: buildFlowField(nav, p.x, p.y, clearance) }
  }
  return cache[clearance].field
}

// Push-apart vector from nearby living enemies so groups fan out.
function separation(e, state) {
  let sx = 0, sy = 0
  for (const o of state.entities) {
    if (o === e || o.type === 'player' || o.maxHp === undefined || o.px === undefined) continue
    const dx = e.px - o.px, dy = e.py - o.py
    const d = Math.hypot(dx, dy)
    if (d > 0 && d < SEP_RADIUS) {
      const k = (1 - d / SEP_RADIUS) / d
      sx += dx * k; sy += dy * k
    }
  }
  return [sx, sy]
}

// Steer in direction (dx,dy): adds separation, then moves per-axis so walls
// slide instead of stopping dead. Returns true if any axis moved.
function moveDir(e, state, delta, dx, dy, speed) {
  const half = e.aiHalf ?? 4
  const map = state.map
  const len = Math.hypot(dx, dy)
  if (len < 1e-6 || speed <= 0) return false
  if (!canMoveTo(map, e.px, e.py, half)) { escapeMove(e, state, delta, speed); return true }
  const [sx, sy] = separation(e, state)
  const vx = dx / len + sx * SEP_WEIGHT, vy = dy / len + sy * SEP_WEIGHT
  const vlen = Math.hypot(vx, vy) || 1
  const mx = (vx / vlen) * speed * delta, my = (vy / vlen) * speed * delta
  let moved = false
  // 1e-6 px threshold: cos(PI/2) leaves ~1e-17 residue that must not count as movement
  if (Math.abs(mx) > 1e-6 && canMoveTo(map, e.px + mx, e.py, half)) { e.px += mx; moved = true }
  if (Math.abs(my) > 1e-6 && canMoveTo(map, e.px, e.py + my, half)) { e.py += my; moved = true }
  e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
  return moved
}

// Wedged in geometry (bad spawn / knockback): walk toward the nearest
// passable tile centre ignoring collision — reducing penetration is always OK.
function escapeMove(e, state, delta, speed) {
  const nav = buildNavGrid(state.map)
  const t = nearestPassable(nav, e.x, e.y, clearanceFor(e.aiHalf ?? 4)) ?? { x: e.x, y: e.y }
  const cx = t.x * S + S / 2, cy = t.y * S + S / 2
  const d = Math.hypot(cx - e.px, cy - e.py) || 1
  e.px += ((cx - e.px) / d) * speed * delta
  e.py += ((cy - e.py) / d) * speed * delta
  e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
}

// Follow a cached A* path to `target` (tile coords). Repaths when the target
// tile changes or REPATH_INTERVAL expires. On an unpathable target, leaves
// e.ai.path === null (brain's give-up timer reads this) and steers directly.
function followPath(e, state, delta, target, speed) {
  const ai = e.ai
  const nav = buildNavGrid(state.map)
  const clearance = clearanceFor(e.aiHalf ?? 4)
  ai.repath = Math.max(0, (ai.repath ?? 0) - delta)
  const targetMoved = !ai.pathTarget || ai.pathTarget.x !== target.x || ai.pathTarget.y !== target.y
  if (ai.path === undefined || targetMoved || ai.repath <= 0) {
    ai.path = findPath(nav, e.x, e.y, target.x, target.y, clearance)
    ai.pathTarget = { x: target.x, y: target.y }
    ai.repath = REPATH_INTERVAL
  }
  if (!ai.path) {
    return moveDir(e, state, delta, target.x * S + S / 2 - e.px, target.y * S + S / 2 - e.py, speed)
  }
  while (ai.path.length &&
         Math.hypot(ai.path[0].x * S + S / 2 - e.px, ai.path[0].y * S + S / 2 - e.py) < WAYPOINT_REACHED) {
    ai.path.shift()
  }
  // smooth: skip a waypoint when the one after it is directly visible.
  // Small entities only — a wide body could clip the corner the skip cuts.
  while (clearance === 1 && ai.path.length >= 2 &&
         hasLineOfSight(state.map, e.y, e.x, ai.path[1].y, ai.path[1].x)) {
    ai.path.shift()
  }
  if (!ai.path.length) return false
  const wp = ai.path[0]
  return moveDir(e, state, delta, wp.x * S + S / 2 - e.px, wp.y * S + S / 2 - e.py, speed)
}

// One flow-field step: move toward the best downhill/uphill neighbour tile.
function followField(e, state, delta, speed, dir) {
  const clearance = clearanceFor(e.aiHalf ?? 4)
  const nav = buildNavGrid(state.map)
  const field = getPlayerField(state, clearance)
  const step = fieldStep(field, nav, e.x, e.y, clearance, dir)
  if (!step) return false
  return moveDir(e, state, delta, step.x * S + S / 2 - e.px, step.y * S + S / 2 - e.py, speed)
}

export function act(e, state, delta, intent) {
  if (!e.ai) e.ai = {}
  const { player, map } = state
  const speed = intent.speed ?? 60
  const dist = Math.hypot(player.px - e.px, player.py - e.py)
  switch (intent.mode) {
    case 'hold':
      return false
    case 'patrol':
      return followPath(e, state, delta, intent.target, speed)
    case 'approach': {
      if (intent.target) return followPath(e, state, delta, intent.target, speed)
      if (intent.stopRange && dist <= intent.stopRange) return false
      // close + visible: beeline, avoids tile-centre zigzag at melee range
      if (dist < 3 * S && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
        return moveDir(e, state, delta, player.px - e.px, player.py - e.py, speed)
      }
      return followField(e, state, delta, speed, 'down')
    }
    case 'flee':
      return followField(e, state, delta, speed, 'up')   // false = cornered: stand and fight
    case 'kite': {
      if (dist < intent.band[0]) return followField(e, state, delta, speed, 'up')
      if (dist > intent.band[1]) return act(e, state, delta, { ...intent, mode: 'approach', target: undefined })
      return act(e, state, delta, { mode: 'strafe', speed: speed * 0.7, inward: 0 })
    }
    case 'strafe': {
      if (e.ai.strafeDir === undefined) e.ai.strafeDir = Math.random() < 0.5 ? 1 : -1
      e.ai.strafeTimer = (e.ai.strafeTimer ?? (2 + Math.random())) - delta
      if (e.ai.strafeTimer <= 0) { e.ai.strafeDir = -e.ai.strafeDir; e.ai.strafeTimer = 2 + Math.random() }
      const toAngle = Math.atan2(player.py - e.py, player.px - e.px)
      const inward = intent.inward ?? 0
      const perp = toAngle + (Math.PI / 2) * e.ai.strafeDir
      const dx = Math.cos(toAngle) * inward + Math.cos(perp) * (1 - inward)
      const dy = Math.sin(toAngle) * inward + Math.sin(perp) * (1 - inward)
      const moved = moveDir(e, state, delta, dx, dy, speed)
      if (!moved) { e.ai.strafeDir = -e.ai.strafeDir; e.ai.strafeTimer = 2 + Math.random() }
      return moved
    }
    case 'charge': {
      const mx = Math.cos(intent.angle) * speed * delta
      const my = Math.sin(intent.angle) * speed * delta
      if (!canMoveTo(map, e.px + mx, e.py + my, e.aiHalf ?? 4)) return false
      e.px += mx; e.py += my
      e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
      return true
    }
  }
  return false
}
