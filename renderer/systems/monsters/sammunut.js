// The Sammunut — a blind, wall-ignoring wraith that drifts toward campfires
// and snuffs them out (leap-3 hermit episode, docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.3). It does NOT
// use the enemy brain/nav — no pathfinding, no line of sight, just a straight
// line toward the nearest fire (or a wandered point when none burns). It is
// invisible outside firelight, a mushroom trance, or the half-second after
// touching the player — and vulnerable only inside a deadwood (grey) fire's
// light, where it also burns: a hand's blow elsewhere passes through it. A
// deadwood fire cannot be snuffed; the wraith hovers at HOVER px, takes
// BURN_DPS while inside its light, and crosses BURN_STAGES hp thresholds
// that force it to flee and shun deadwood fires until it snuffs an ordinary
// one. Pure — no browser/Electron imports.

import { spendStamina } from '../stamina.js'
import { sfx } from '../sfx.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA, hurtCreature } from '../creatures.js'
import { stepFade } from '../fade.js'
import { isDeadwoodFire } from '../campfire.js'

const TILE_SIZE = 32

export const FIRELIGHT = 160       // px — visible/vulnerable radius around a burning campfire
export const DRIFT = 80            // px/s toward its target (fire or wander point)
export const TOUCH = 20            // px — touch range on the player
export const TOUCH_TIME = 0.5      // seconds touchT (and visibility-after-touch) lasts
export const DRAIN_PER_S = 12      // stamina drained per second of touch
export const WANDER_REPICK = 3     // seconds between wander-target picks
export const BURN_DPS = 4          // hp/s lost while inside a deadwood fire's light
export const BURN_STAGES = [12, 6] // hp thresholds: crossing one → flee + shun
export const FLEE_SPEED = 160      // px/s while fleeing a deadwood fire
export const FLEE_TIME = 3         // seconds a flee lasts
export const HOVER = 24            // px it holds off a deadwood fire it cannot snuff

// Lazy init: a registry spawn arrives with only type/x/y/px/py/hp, so the
// first touch stamps the wraith state on it. Idempotent — the `wisp` flag
// is the "already stamped" marker. fadeA starts at 0 (invisible) so a fresh
// wraith fades in rather than snapping visible on its first firelit frame.
export function ensureSammunut(e) {
  if (e.wisp) return e
  Object.assign(e, { wisp: true, target: null, wanderT: 0, touchT: 0, inCombat: false,
                     hp: e.hp ?? 18, maxHp: e.maxHp ?? 18,
                     state: 'drift', shun: false, burnStage: 0, fleeT: 0, burn: 0, flicker: 0,
                     fadeA: e.fadeA ?? 0 })
  return e
}

export function makeSammunut(x, y) {
  return ensureSammunut({ type: 'sammunut', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 })
}

// Fires this wraith will go to: every ordinary fire, deadwood ones only
// while it is not shunning them.
export function nearestFire(entities, e) {
  let best = null, bestDist = Infinity
  for (const f of entities) {
    if (f.type !== 'campfire') continue
    if (isDeadwoodFire(f) && e.shun) continue
    const d = Math.hypot(f.px - e.px, f.py - e.py)
    if (d < bestDist) { bestDist = d; best = f }
  }
  return best
}

export function inFirelight(entities, px, py) {
  return entities.some(f => f.type === 'campfire' && Math.hypot(f.px - px, f.py - py) <= FIRELIGHT)
}
export function inDeadwoodLight(entities, px, py) {
  return entities.some(f => isDeadwoodFire(f) && Math.hypot(f.px - px, f.py - py) <= FIRELIGHT)
}
// Closest deadwood fire currently lighting this wraith (ignores `shun` — it
// gates seeking a target, not whether standing in the light still burns).
const nearestDeadwoodInLight = (entities, e) =>
  entities.filter(f => isDeadwoodFire(f) && Math.hypot(f.px - e.px, f.py - e.py) <= FIRELIGHT)
          .sort((a, b) => Math.hypot(a.px - e.px, a.py - e.py) - Math.hypot(b.px - e.px, b.py - e.py))[0] ?? null

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

// Starts a flee away from (fromPx, fromPy) — the deadwood fire that just
// crossed a burn stage — and begins shunning deadwood fires until an
// ordinary one is snuffed.
export function startFlee(e, fromPx, fromPy) {
  const dx = e.px - fromPx, dy = e.py - fromPy
  const d = Math.hypot(dx, dy)
  e.fleeDir = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 }
  e.state = 'fleeing'
  e.fleeT = FLEE_TIME
  e.shun = true
  e.wanderPoint = null
}

function fleeTick(e, delta, map) {
  const w = map[0].length, h = map.length
  e.px = clamp(e.px + e.fleeDir.x * FLEE_SPEED * delta, TILE_SIZE, (w - 1) * TILE_SIZE)
  e.py = clamp(e.py + e.fleeDir.y * FLEE_SPEED * delta, TILE_SIZE, (h - 1) * TILE_SIZE)
  e.fleeT -= delta
  if (e.fleeT <= 0) e.state = 'drift'
}

// Burns the wraith while it stands in a deadwood fire's light, drives the
// burn visual channel, and escalates through BURN_STAGES into a flee+shun.
function burnTick(e, state, delta) {
  const fire = nearestDeadwoodInLight(state.entities, e)
  if (!fire) return
  hurtCreature(state, e, BURN_DPS * delta, { source: 'fire' })
  e.burn = Math.max(0, 1 - e.hp / e.maxHp)
  if (e.pose) e.pose.hpSeen = e.hp          // a slow burn is not a hit flash
  e.burnCue = (e.burnCue ?? 0) - delta
  if (e.burnCue <= 0) { sfx(state, 'wraith-burn', { px: e.px, py: e.py }); e.burnCue = 0.6 }
  if (e.burnStage < BURN_STAGES.length && e.hp <= BURN_STAGES[e.burnStage]) {
    e.burnStage++
    startFlee(e, fire.px, fire.py)
  }
}

export function updateSammunut(e, state, delta) {
  ensureSammunut(e)
  const { entities, map, player } = state
  const prevPx = e.px, prevPy = e.py

  if (e.state === 'fleeing') {
    e.target = null
    fleeTick(e, delta, map)
  } else {
    const target = nearestFire(entities, e)
    e.target = target
    if (target) {
      e.wanderPoint = null
      const dist = Math.hypot(target.px - e.px, target.py - e.py)
      if (isDeadwoodFire(target)) {
        if (dist > HOVER) driftToward(e, target.px, target.py, delta, map)
      } else {
        driftToward(e, target.px, target.py, delta, map)
        if (dist < 16 && !target.eternal) {
          state.entities = entities.filter(f => f !== target)
          e.shun = false
          sfx(state, 'campfire-out', { px: target.px, py: target.py })
        }
      }
    } else {
      e.wanderT = (e.wanderT ?? 0) - delta
      if (!e.wanderPoint || e.wanderT <= 0) {
        e.wanderPoint = pickWanderPoint(map, e.rng ?? Math.random)
        e.wanderT = WANDER_REPICK
      }
      driftToward(e, e.wanderPoint.px, e.wanderPoint.py, delta, map)
    }
    burnTick(e, state, delta)
  }

  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)

  e.touchCue = Math.max(0, (e.touchCue ?? 0) - delta)
  if (Math.hypot(player.px - e.px, player.py - e.py) <= TOUCH) {
    spendStamina(player, DRAIN_PER_S * delta)
    e.touchT = TOUCH_TIME
    if (e.touchCue <= 0) {
      sfx(state, 'wraith-touch', { px: e.px, py: e.py })
      e.touchCue = TOUCH_TIME
    }
  }
  e.touchT = Math.max(0, (e.touchT ?? 0) - delta)

  const visible = sammunutVisible(e, state)
  stepFade(e, visible ? 1 : 0, delta)
  const moving = Math.hypot(e.px - prevPx, e.py - prevPy) > 0.01
  e.flicker = moving ? 1 - e.fadeA : 0
  if (!visible) e.inCombat = false
}

CREATURE_UPDATE.sammunut = updateSammunut

CREATURE_HIT.sammunut = (e, state, dmg, { source = 'player' } = {}) => {
  ensureSammunut(e)
  if (source === 'fire') return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: null }
  const fire = nearestDeadwoodInLight(state.entities ?? [], e)
  if (!fire) return { entity: e, absorbed: true, cue: 'chop', think: 'Your blade passes through it.' }
  const entity = { ...e, hp: e.hp - 1, inCombat: true, touchT: TOUCH_TIME }
  startFlee(entity, fire.px, fire.py)
  return { entity, absorbed: false, cue: 'melee-hit' }
}

CREATURE_ALPHA.sammunut = e => (e.fadeA ?? 0) * 0.85
