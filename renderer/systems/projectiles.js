// Projectile stepping: movement, wall/maxDist stop, and friendly-vs-enemy
// hit resolution (pierce, fork, chain, onHit status effects, shield
// absorption, boss immunity). Lifted out of game.js so it is unit-testable
// without a DOM/canvas — game.js supplies hurt/detonate/damagePlayer/
// isHittable as hooks, and this module touches nothing else of its own.
import { isWalkable } from './entities.js'
import { startKnockback } from './knockback.js'

const TILE_SIZE = 32
const HIT_RADIUS = 8          // enemies
const PLAYER_HIT_RADIUS = 10  // player, hit by enemy projectiles

// Entities aren't guaranteed an id (most are plain spawned objects); hitIds
// needs stable identity, so stamp one on first use — same pattern wizard.js
// uses for its own id field.
function idOf(e) {
  if (e.id === undefined) e.id = (e.type ?? 'e') + '_' + Math.random().toString(36).slice(2)
  return e.id
}

// Split a forking projectile into `count` copies fanned around its current
// heading by `spread` radians each (the unit the weapon tables use — the
// splitbow's Math.PI / 9 is 20° between neighbours). The middle copy (for an
// odd count) keeps the exact original dx/dy — no trig round-trip — so "straight ahead" is
// really straight ahead; the rest are rotated by their offset from centre.
export function makeForks(p) {
  const { count, spread } = p.fork
  const speed = Math.hypot(p.dx, p.dy)
  const baseAngle = Math.atan2(p.dy, p.dx)
  const mid = (count - 1) / 2
  const forks = []
  for (let i = 0; i < count; i++) {
    const offset = i - mid
    const base = { ...p, fork: undefined, forked: true, distTraveled: 0, hitIds: new Set(p.hitIds) }
    if (offset === 0) {
      forks.push(base)
    } else {
      const angle = baseAngle + offset * spread
      forks.push({ ...base, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed })
    }
  }
  return forks
}

// Point a chaining projectile at the nearest candidate within p.chain.range
// that isn't already in p.hitIds, rescaling dx/dy to the projectile's
// original speed. `entities` is the caller's pre-filtered candidate list
// (hittable, boss-immune already excluded) so this stays a plain geometry
// helper with no rules knowledge of its own. Returns the target entity, or
// null if nothing qualifies — the caller ends the chain in that case.
export function retargetChain(p, entities) {
  const hitIds = p.hitIds ?? new Set() // tolerate a bare call with no hitIds yet
  const speed = Math.hypot(p.dx, p.dy)
  let best = null
  let bestDist = Infinity
  for (const e of entities) {
    if (hitIds.has(idOf(e))) continue
    const dist = Math.hypot(e.px - p.px, e.py - p.py)
    if (dist <= p.chain.range && dist < bestDist) { best = e; bestDist = dist }
  }
  if (!best) return null
  const dx = best.px - p.px
  const dy = best.py - p.py
  const len = Math.hypot(dx, dy) || 1
  p.dx = (dx / len) * speed
  p.dy = (dy / len) * speed
  return best
}

// stun sets a floor on stunTimer (never shortens an existing longer stun);
// knockback rides the projectile's own travel direction, pushing the target
// further along the shot rather than back toward the shooter.
function applyOnHit(p, target) {
  if (p.onHit.stun !== undefined) target.stunTimer = Math.max(target.stunTimer ?? 0, p.onHit.stun)
  if (p.onHit.knockback !== undefined) startKnockback(target, p.dx, p.dy, p.onHit.knockback)
}

// Advance every projectile one frame. Mutates state.projectiles (replaced
// with the survivors) and state.entities (via hooks.hurt's replacement
// entity, and hooks.cull's culling); returns { hits } for callers that want
// a count (e.g. combo/sfx bookkeeping upstream). hooks: { hurt(e, damage, p)
// -> entity, detonate(px, py, blastTiles), damagePlayer(damage),
// isHittable(e), cull(entities) -> entities (optional, defaults to identity
// — game.js passes its real cullDead with the keep predicate it uses
// elsewhere, since a corpse can sit at 0 hp without isHittable/dying saying
// so, and would otherwise soak a second projectile arriving the same frame) }.
export function stepProjectiles(state, delta, hooks) {
  const { player, map } = state
  const cull = hooks.cull ?? (entities => entities)
  let hits = 0
  const live = []

  for (const p of state.projectiles) {
    const speed = Math.hypot(p.dx, p.dy)
    p.px += p.dx * delta
    p.py += p.dy * delta
    // Unlike the old game.js loop (which only tracked this under maxDist),
    // distTraveled is always accumulated — fork's `after` threshold needs it
    // even on projectiles with no maxDist of their own.
    p.distTraveled = (p.distTraveled ?? 0) + speed * delta

    if (p.maxDist !== undefined && p.distTraveled >= p.maxDist) {
      if (p.explodes) hooks.detonate(p.lastPx ?? p.px, p.lastPy ?? p.py, p.blastTiles)
      continue // culled: ran out of range
    }

    const tile = map?.[Math.floor(p.py / TILE_SIZE)]?.[Math.floor(p.px / TILE_SIZE)]
    if (!tile || !isWalkable(tile.tile, tile)) {
      if (p.explodes) hooks.detonate(p.lastPx ?? p.px, p.lastPy ?? p.py, p.blastTiles)
      continue // culled: hit a wall
    }
    if (p.explodes) { p.lastPx = p.px; p.lastPy = p.py }

    // Fork before the hit-test: past `after` px the original is replaced by
    // its fanned copies, which fly on (and can themselves hit) next frame.
    // (No `!p.forked` guard needed: makeForks clears `fork` on every copy,
    // so `p.fork` is already falsy on anything that has already forked.)
    if (p.fork && p.distTraveled >= p.fork.after) {
      live.push(...makeForks(p))
      continue
    }

    let consumed = false

    if (p.friendly) {
      p.hitIds ??= new Set()
      let target = null
      for (const e of state.entities) {
        if (!hooks.isHittable(e)) continue
        if (e.type === 'dragon_boss') continue // immune to all friendly projectiles
        if (p.hitIds.has(idOf(e))) continue
        if (Math.hypot(e.px - p.px, e.py - p.py) < HIT_RADIUS) { target = e; break }
      }
      if (target) {
        if (target.type === 'wizard' && target.shieldTimer > 0 && !p.piercesShield) {
          consumed = true // shield absorbs the hit outright: no damage, no onHit, no pierce/chain
        } else {
          const struck = hooks.hurt(target, p.damage, p)
          state.entities = state.entities.map(e => e === target ? struck : e)
          hits++
          p.hitIds.add(idOf(target))
          if (p.onHit) applyOnHit(p, struck)

          if (p.chain && p.chain.left > 0) {
            // Chain wins over pierce when a projectile somehow carries both
            // (deliberate: a chaining shot retargets instead of piercing).
            const candidates = state.entities.filter(e => hooks.isHittable(e) && e.type !== 'dragon_boss')
            const next = retargetChain(p, candidates)
            if (next) p.chain.left--
            else consumed = true // nothing left in range: chain ends
          } else if (p.pierce !== undefined && p.pierce > 0) {
            p.pierce--
          } else {
            consumed = true // single-target hit: projectile spent
          }
        }
        // Direct-impact blast: fires on ANY resolved hit, including one a
        // shield absorbed (mirrors the original game.js `hit = true` before
        // the shield fallthrough) — at the projectile's current position,
        // not lastPx/lastPy (that pair is only for the wall/maxDist stop).
        if (p.explodes) hooks.detonate(p.px, p.py, p.blastTiles)
        // A hit can drop an entity to 0 hp without removing it — isHittable
        // only checks `dying`, not hp — so cull now, after the replacement
        // above has landed in state.entities, or a second projectile later
        // in this same frame could still find the corpse as a target.
        state.entities = cull(state.entities)
      }
    } else if (Math.hypot(player.px - p.px, player.py - p.py) < PLAYER_HIT_RADIUS) {
      hooks.damagePlayer(p.damage)
      hits++
      consumed = true
    }

    if (!consumed) live.push(p)
  }

  state.projectiles = live
  return { hits }
}
