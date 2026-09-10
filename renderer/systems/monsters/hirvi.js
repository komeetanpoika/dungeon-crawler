// Hiiden hirvi, the Elk of Hiisi — the Clearings quest's quarry
// (docs/superpowers/specs/2026-09-10-adventure-quests-design.md §2). It beds
// at a wallow, bolts when the player gets close, and on the last wallow turns
// and fights. The fight is not this module's business: makeStand hands the
// entity to the ordinary enemy brain (`brainDriven`, see
// systems/monsters.js isStoryCreature), which is also what lets spells reach
// it. Until then it is untouchable — a lucky longbow shot at the first wallow
// would delete the whole hunt.
// Pure — no browser/Electron imports.
import { canMoveTo } from '../nav.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA } from '../creatures.js'
import { stepFade } from '../fade.js'

const S = 32

export const FLUSH_TILES = 6     // Chebyshev tiles: how close spooks it
export const BOLT_TIME = 1.6     // s it runs before it is gone from the map
export const BOLT_SPEED = 150    // px/s — faster than a walking player
export const HALF = 10           // matches stats.half in hirvi.json

// A registry spawn arrives with only type/x/y/px/py/hp, so the first touch
// stamps the chase state. Idempotent — an already-bedded elk is left alone.
export function ensureHirvi(e) {
  if (e.mood) return e
  Object.assign(e, { mood: 'bedded', boltT: 0, bolted: false, fadeA: 1 })
  return e
}

export function makeHirvi(x, y) {
  return ensureHirvi({ type: 'hirvi', x, y, px: x * S + S / 2, py: y * S + S / 2, hp: 30, maxHp: 30, damage: 2 })
}

export function startBolt(e) {
  ensureHirvi(e)
  if (e.mood !== 'bedded') return false
  e.mood = 'bolting'
  e.boltT = BOLT_TIME
  return true
}

// The last wallow: it stops being a story creature and becomes an enemy.
export function makeStand(e) {
  ensureHirvi(e)
  e.mood = 'standing'
  e.brainDriven = true
  e.fadeA = 1
}

export function updateHirvi(e, state, delta) {
  ensureHirvi(e)
  if (e.mood !== 'bolting') return   // bedded: it waits. standing: the brain has it.

  e.boltT = Math.max(0, e.boltT - delta)
  const dx = e.px - state.player.px, dy = e.py - state.player.py
  const len = Math.hypot(dx, dy) || 1
  const step = BOLT_SPEED * delta
  // Per-axis so it slides along a tree line instead of stopping dead against it.
  const nx = e.px + (dx / len) * step
  const ny = e.py + (dy / len) * step
  if (canMoveTo(state.map, nx, e.py, HALF)) e.px = nx
  if (canMoveTo(state.map, e.px, ny, HALF)) e.py = ny
  e.x = Math.floor(e.px / S)
  e.y = Math.floor(e.py / S)
  // Fades out over the tail of the run so it leaves rather than blinking away.
  stepFade(e, e.boltT > 0.4 ? 1 : 0, delta, { inTime: 0.1, outTime: 0.4 })
  if (e.boltT <= 0) e.bolted = true   // the quest module reads this and re-homes it
}

CREATURE_UPDATE.hirvi = updateHirvi
// Absorbed until the stand; an ordinary hit afterward, so death runs the
// standard pipeline and hurtCreature records the kill.
CREATURE_HIT.hirvi = (e, state, dmg) => {
  ensureHirvi(e)
  return e.mood === 'standing'
    ? { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
    : { entity: e, absorbed: true, cue: 'wall-slam' }
}
CREATURE_ALPHA.hirvi = e => e.fadeA ?? 1
