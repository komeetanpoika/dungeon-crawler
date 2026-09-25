// Hero-vs-hero damage for the PvP simulation. Every hit on a hero goes
// through hurtHero, which hands it to damagePlayer — so shield blocks, outfit
// protect and i-frames are exactly single-player's — and records who dealt it
// for kill credit. Pure: no DOM.
import { damagePlayer } from '../systems/player-damage.js'
import { startKnockback } from '../systems/knockback.js'
import { BLOCK_SHOVE } from '../systems/shield.js'

export const heroById = (match, id) => id == null ? null : match.heroes.find(h => h.id === id) ?? null

// hp <= 0 is untargetable even before resolveDeaths sets h.dead: otherwise a
// hero killed earlier in the same tick (a projectile, say) stays hittable
// for a later hit in that same tick (lightning, a shock tick) — which both
// steals kill credit by overwriting lastHitBy and lets the corpse soak a
// second hit that should have missed.
export const isTargetable = h => h?.type === 'hero' && !h.dead && h.hp > 0 && !(h.spawnProtect > 0)

export const foesOf = (match, hero) => match.heroes.filter(h => h !== hero && isTargetable(h))

// match.entities is what stepProjectiles, lightning and cones sweep: the
// targetable heroes only. Rebuilt whenever a hero dies, respawns or loses
// its spawn protection.
export function refreshTargets(match) {
  match.entities = match.heroes.filter(isTargetable)
}

export function hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false } = {}) {
  if (!isTargetable(target)) return false
  if (by && by === target) return false
  const at = from ?? (by ? { px: by.px, py: by.py } : null)
  const before = target.hp
  const landed = damagePlayer(match, amount, kind, at, target)
  if (!landed) {
    // A shield took a melee blow: the striker is pushed back, as enemies are.
    if (melee && by && target.blockedHit) startKnockback(by, by.px - target.px, by.py - target.py, BLOCK_SHOVE)
    return false
  }
  if (by) target.lastHitBy = { id: by.id, t: match.clock }
  // The damage that actually landed (after outfit protect), not the raw hit amount.
  match.events.push({ type: 'hit', target: target.id, by: by?.id ?? null, amount: before - target.hp })
  return true
}
