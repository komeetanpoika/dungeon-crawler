// The death phase: a rig-drawn monster that reaches 0 hp stays in the
// entity list for DEATH_TIME playing its 'death' pose and fading, instead
// of vanishing on the frame it dies. Dependency-free so game.js, factions
// and the monster registry can all import it without cycles: the caller
// says which entities have a death pose.
import { isDead } from './factions.js'

export const DEATH_TIME = 0.7

export function beginDying(e) {
  e.dying = DEATH_TIME
  e.attack = null
}

// The frame's cull: entities with a death pose enter dying at 0 hp and are
// kept; everything else that isDead is dropped, as before.
export function cullDead(entities, hasDeathPose) {
  return entities.filter(e => {
    if (e.dying > 0) return true
    if (hasDeathPose(e) && Number.isFinite(e.hp) && e.hp <= 0) { beginDying(e); return true }
    return !isDead(e)
  })
}

// Once per frame: advance every dying timer, drop the expired.
export function tickDying(entities, delta) {
  return entities.filter(e => {
    if (!(e.dying > 0)) return true
    e.dying -= delta
    return e.dying > 0
  })
}

// 1 for most of the phase, then a linear ramp to 0 over its last 40 %.
export function dyingAlpha(e) {
  if (!Number.isFinite(e.dying)) return 1
  return Math.max(0, Math.min(1, e.dying / (DEATH_TIME * 0.4)))
}
