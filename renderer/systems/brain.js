// Perception + intent: decides WHAT an enemy wants — chase the player, hunt a
// last-known position, patrol, flee, kite — and emits an intent object for
// act() to execute. Never moves anything itself.
import { hasLineOfSight, TILE } from './entities.js'
import { buildNavGrid, findPath, clearanceFor, passable } from './nav.js'
import { getAIConfig } from '../data/enemy-ai.js'

const S = 32
export const HUNT_PAUSE = 1.5        // s spent looking around where the trail ends
export const UNREACHABLE_GIVEUP = 3  // s steering at an unpathable target before quitting
const DWELL = 1.2                    // s paused at each patrol point

const PATROL_RADIUS = 8
const FEATURE_TILES = new Set([TILE.DOOR, TILE.TREASURE, TILE.SHRINE, TILE.STAIRS_DOWN, TILE.STAIRS_UP])

// Up to 3 patrol points near (x,y): feature tiles first, then the farthest
// open tiles; every point A*-reachable and >= 3 tiles from the others.
// Deterministic on purpose (stable tests, reproducible behavior).
export function generatePatrol(nav, map, x, y, cfg = {}) {
  const clearance = clearanceFor(cfg.half ?? 4)
  const cands = []
  for (let dy = -PATROL_RADIUS; dy <= PATROL_RADIUS; dy++) {
    for (let dx = -PATROL_RADIUS; dx <= PATROL_RADIUS; dx++) {
      const tx = x + dx, ty = y + dy
      const t = map[ty]?.[tx]
      if (!t || !passable(nav, tx, ty, clearance)) continue
      const d = Math.hypot(dx, dy)
      if (d < 2 || d > PATROL_RADIUS) continue
      cands.push({ x: tx, y: ty, feature: FEATURE_TILES.has(t.tile) ? 1 : 0, d })
    }
  }
  cands.sort((a, b) => (b.feature - a.feature) || (b.d - a.d))
  const points = []
  for (const c of cands) {
    if (points.length >= 3) break
    if (points.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 3)) continue
    if (!findPath(nav, x, y, c.x, c.y, clearance)) continue
    points.push({ x: c.x, y: c.y })
  }
  return points
}

export function ensureAI(e, state, cfg) {
  if (e.ai?.patrolPoints) return e.ai
  e.aiHalf = cfg.half
  e.ai = {
    ...(e.ai ?? {}),
    mode: 'patrol', lastSeen: null, huntWait: 0, dwell: 0, giveUp: 0, patrolIdx: 0,
    patrolPoints: generatePatrol(buildNavGrid(state.map), state.map, e.x, e.y, cfg),
    path: undefined, pathTarget: null, repath: 0,
  }
  return e.ai
}

export function updateBrain(e, state, delta) {
  const cfg = getAIConfig(e)
  const ai = ensureAI(e, state, cfg)
  const { player, map } = state
  const dist = Math.hypot(player.px - e.px, player.py - e.py)
  const seen = dist <= cfg.sightRange && hasLineOfSight(map, e.y, e.x, player.y, player.x)

  if (seen) {
    ai.mode = 'chase'
    ai.lastSeen = { x: player.x, y: player.y }
    ai.huntWait = 0; ai.giveUp = 0
  } else if (ai.mode === 'chase') {
    ai.mode = 'hunt'; ai.huntWait = 0; ai.giveUp = 0
  }

  // hurt + threat nearby -> run; config decides who routs (taxon sets defaults)
  // no LOS gate: a badly hurt enemy panics when the threat is merely close (fear radius), even unseen
  if (cfg.fleeHp > 0 && e.maxHp && e.hp / e.maxHp <= cfg.fleeHp && dist < cfg.sightRange * 1.25) {
    return { mode: 'flee', speed: cfg.speed }
  }

  if (ai.mode === 'chase') {
    if (cfg.combat === 'strafe') return { mode: 'strafe', inward: cfg.inward ?? 0.3, speed: cfg.speed }
    if (cfg.kiteBand) return { mode: 'kite', band: cfg.kiteBand, speed: cfg.speed }
    return { mode: 'approach', speed: cfg.speed, stopRange: cfg.stopRange }
  }

  if (ai.mode === 'hunt' && ai.lastSeen) {
    const t = ai.lastSeen
    // A wide enemy hunting a wall-adjacent lastSeen gets a nearestPassable-
    // substituted path that ends >= 1 tile short — an exhausted path for this
    // exact target counts as arrival, or the hunt would never resolve.
    const pathExhausted = Array.isArray(ai.path) && ai.path.length === 0 &&
                          ai.pathTarget && ai.pathTarget.x === t.x && ai.pathTarget.y === t.y
    const arrived = pathExhausted ||
                    Math.hypot(t.x * S + S / 2 - e.px, t.y * S + S / 2 - e.py) < S
    // act() left path === null for this exact target -> it is unreachable
    const unpathable = ai.path === null && ai.pathTarget &&
                       ai.pathTarget.x === t.x && ai.pathTarget.y === t.y
    if (unpathable) {
      ai.giveUp += delta
      if (ai.giveUp >= UNREACHABLE_GIVEUP) {
        ai.mode = 'patrol'; ai.lastSeen = null; ai.giveUp = 0
        return { mode: 'hold' }
      }
    }
    if (arrived) {
      ai.huntWait += delta
      if (ai.huntWait >= HUNT_PAUSE) { ai.mode = 'patrol'; ai.lastSeen = null }
      return { mode: 'hold' }
    }
    return { mode: 'approach', target: t, speed: cfg.speed }
  }

  // patrol (points generated in Task 8; empty -> stand watch)
  ai.mode = 'patrol'
  if (!ai.patrolPoints.length) return { mode: 'hold' }
  const pt = ai.patrolPoints[ai.patrolIdx]
  const arrivedAtPt = Math.hypot(pt.x * S + S / 2 - e.px, pt.y * S + S / 2 - e.py) < S * 0.75
  const unpathablePt = ai.path === null && ai.pathTarget &&
                       ai.pathTarget.x === pt.x && ai.pathTarget.y === pt.y
  if (unpathablePt) {
    ai.giveUp += delta
    if (ai.giveUp >= UNREACHABLE_GIVEUP) {
      ai.giveUp = 0
      ai.patrolIdx = (ai.patrolIdx + 1) % ai.patrolPoints.length
      return { mode: 'hold' }
    }
  }
  if (arrivedAtPt) {
    ai.dwell += delta
    if (ai.dwell >= DWELL) {
      ai.dwell = 0
      ai.patrolIdx = (ai.patrolIdx + 1) % ai.patrolPoints.length
    }
    return { mode: 'hold' }
  }
  return { mode: 'patrol', target: pt, speed: cfg.wanderSpeed }
}
