// The Sammunut — a blind, wall-ignoring wraith that drifts toward campfires
// and snuffs them out (leap-3 hermit episode, docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.3). It does NOT
// use the enemy brain/nav — no pathfinding, no line of sight, just a straight
// line toward the nearest fire (or a wandered point when none burns). It is
// invisible and invulnerable outside firelight, a mushroom trance, or the
// half-second after touching the player. Pure — no browser/Electron imports.

import { spendStamina } from '../stamina.js'
import { sfx } from '../sfx.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA } from '../creatures.js'

const TILE_SIZE = 32

export const FIRELIGHT = 160       // px — visible/vulnerable radius around a burning campfire
export const DRIFT = 80            // px/s toward its target (fire or wander point)
export const TOUCH = 20            // px — touch range on the player
export const TOUCH_TIME = 0.5      // seconds touchT (and visibility-after-touch) lasts
export const DRAIN_PER_S = 12      // stamina drained per second of touch
export const WANDER_REPICK = 3     // seconds between wander-target picks

// Lazy init: a registry spawn arrives with only type/x/y/px/py/hp, so the
// first touch stamps the wraith state on it. Idempotent — the `wisp` flag
// is the "already stamped" marker.
export function ensureSammunut(e) {
  if (e.wisp) return e
  Object.assign(e, { wisp: true, target: null, wanderT: 0, touchT: 0, inCombat: false,
                     hp: e.hp ?? 18, maxHp: e.maxHp ?? 18 })
  return e
}

export function makeSammunut(x, y) {
  return ensureSammunut({ type: 'sammunut', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 })
}

export function nearestFire(entities, e) {
  let best = null, bestDist = Infinity
  for (const f of entities) {
    if (f.type !== 'campfire') continue
    const d = Math.hypot(f.px - e.px, f.py - e.py)
    if (d < bestDist) { bestDist = d; best = f }
  }
  return best
}

export function inFirelight(entities, px, py) {
  return entities.some(f => f.type === 'campfire' && Math.hypot(f.px - px, f.py - py) <= FIRELIGHT)
}

export function sammunutVisible(e, state) {
  return inFirelight(state.entities, e.px, e.py) || (state.player.trance ?? 0) > 0 || e.touchT > 0
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Straight-line drift toward (tx, ty) at DRIFT px/s, ignoring walls, clamped
// to the map interior.
function driftToward(e, tx, ty, delta, map) {
  const dx = tx - e.px, dy = ty - e.py
  const dist = Math.hypot(dx, dy)
  if (dist > 1e-6) {
    const step = Math.min(dist, DRIFT * delta)
    e.px += (dx / dist) * step
    e.py += (dy / dist) * step
  }
  const w = map[0].length, h = map.length
  e.px = clamp(e.px, TILE_SIZE, (w - 1) * TILE_SIZE)
  e.py = clamp(e.py, TILE_SIZE, (h - 1) * TILE_SIZE)
}

function pickWanderPoint(map, rng) {
  const w = map[0].length, h = map.length
  const x = 1 + Math.floor(rng() * Math.max(1, w - 2))
  const y = 1 + Math.floor(rng() * Math.max(1, h - 2))
  return { px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 }
}

export function updateSammunut(e, state, delta) {
  ensureSammunut(e)
  const { entities, map, player } = state

  const target = nearestFire(entities, e)
  e.target = target

  if (target) {
    e.wanderPoint = null
    driftToward(e, target.px, target.py, delta, map)
    const dist = Math.hypot(target.px - e.px, target.py - e.py)
    if (dist < 16 && !target.eternal) {
      state.entities = entities.filter(f => f !== target)
      sfx(state, 'campfire-out', { px: target.px, py: target.py })
    }
  } else {
    e.wanderT = (e.wanderT ?? 0) - delta
    if (!e.wanderPoint || e.wanderT <= 0) {
      e.wanderPoint = pickWanderPoint(map, e.rng ?? Math.random)
      e.wanderT = WANDER_REPICK
    }
    driftToward(e, e.wanderPoint.px, e.wanderPoint.py, delta, map)
  }

  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)

  e.touchCue = Math.max(0, (e.touchCue ?? 0) - delta)
  const distPlayer = Math.hypot(player.px - e.px, player.py - e.py)
  if (distPlayer <= TOUCH) {
    spendStamina(player, DRAIN_PER_S * delta)
    e.touchT = TOUCH_TIME
    if (e.touchCue <= 0) {
      sfx(state, 'wraith-touch', { px: e.px, py: e.py })
      e.touchCue = TOUCH_TIME
    }
  }
  e.touchT = Math.max(0, (e.touchT ?? 0) - delta)

  if (!sammunutVisible(e, state)) e.inCombat = false
}

CREATURE_UPDATE.sammunut = updateSammunut
CREATURE_HIT.sammunut = (e, state, dmg) => {
  if (inFirelight(state.entities, e.px, e.py)) {
    return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
  }
  return { entity: e, absorbed: true, cue: 'chop' }
}
CREATURE_ALPHA.sammunut = (e, state) => sammunutVisible(e, state) ? 0.85 : 0
