// Maunonmiekka's on-hit magic: a crimson shockwave bursts from the struck
// enemy, splashing damage + knockback onto nearby enemies. Pure — game.js
// owns the visuals (state.shockwaves) and calls this for the gameplay part.
import { startKnockback } from './knockback.js'

export const SHOCK_RADIUS = 80    // px
export const SHOCK_DAMAGE = 3
export const SHOCK_KNOCKBACK = 30 // px of shove away from the blast center

const SPLASHABLE = new Set(['guard', 'monster', 'dragon', 'cyclops', 'wizard', 'crab', 'npc'])

// Splash out from (cx, cy). `exclude` is the set of directly-struck enemies
// (they already took the full weapon hit). Returns the updated entity list
// (splash kills removed) and how many enemies the wave actually hit.
export function applyShockwave(entities, cx, cy, exclude = new Set()) {
  let hitCount = 0
  const updated = entities.map(e => {
    if (!SPLASHABLE.has(e.type) || exclude.has(e)) return e
    if (e.type === 'wizard' && e.shieldTimer > 0) return e
    if (e.px === undefined || Math.hypot(e.px - cx, e.py - cy) > SHOCK_RADIUS) return e
    hitCount++
    const hit = { ...e, hp: e.hp - SHOCK_DAMAGE, inCombat: true }
    startKnockback(hit, hit.px - cx, hit.py - cy, SHOCK_KNOCKBACK)
    return hit
  })
  return { entities: updated.filter(e => !SPLASHABLE.has(e.type) || e.hp > 0), hitCount }
}
