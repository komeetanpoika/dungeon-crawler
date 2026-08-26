// The magic stance and its default spell: a gust of wind. No damage — a
// short cone that stuns regular enemies and shoves whatever it catches.
// Minibosses shrug the stun and are only shoved lightly; the dragon boss is
// too massive to care. Gust is priced in stamina, not mana, and can be held
// to charge a bigger tier — mirroring melee's heavy-weapon charge.
import { inSwing } from './melee.js'
import { startKnockback } from './knockback.js'
import { hasTalent } from './talents.js'
import { GUST_COSTS, canAfford, spendStamina } from './stamina.js'

export const GUST = {
  cooldown: 3,
  stun: 1.0,
  knockback: 30,
  bossKnockback: 12,
  reach: 80,                       // ~2.5 tiles
  halfAngle: Math.PI * 55 / 180,
}

// Hold-to-charge, mirroring melee's heavy weapons: wind up to widen the
// cone; overcharge adds a wall-slam. moveFactor slows the caster mid-wind.
export const GUST_CHARGE = { full: 0.5, over: 1.1, moveFactor: 0.5 }
const AUTO_RELEASE_GRACE = 0.5

export const resolveGustTier = held =>
  held >= GUST_CHARGE.over ? 'over' : held >= GUST_CHARGE.full ? 'full' : 'tap'

export const shouldAutoReleaseGust = held =>
  held > GUST_CHARGE.over + AUTO_RELEASE_GRACE

export const GUST_TIERS = {
  tap:  { mul: 1,    stun: 1.0, knockback: 30, bossKnockback: 12, slam: false },
  full: { mul: 1.25, stun: 1.5, knockback: 45, bossKnockback: 18, slam: false },
  over: { mul: 1.5,  stun: 2.0, knockback: 70, bossKnockback: 28, slam: true },
}
const SLAM_DAMAGE = 3

const stunnable = e => !e.isBoss && e.type !== 'dragon_boss'

// Cast the gust from the player's position along their facing. Spends
// stamina and starts the cooldown on success; refusals name their reason so
// the caller can surface it.
export function tryGust(state, tier = 'tap') {
  const p = state.player
  if (!hasTalent(p, 'magic_stance')) return { ok: false, reason: 'not_learned' }
  if ((p.magicCooldown ?? 0) > 0) return { ok: false, reason: 'cooldown' }
  const t = GUST_TIERS[tier]
  if (!canAfford(p, GUST_COSTS[tier])) return { ok: false, reason: 'stamina' }
  spendStamina(p, GUST_COSTS[tier])
  p.magicCooldown = GUST.cooldown
  const fa = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[p.facing] ?? 0
  const slamOpts = t.slam ? { slam: { damage: SLAM_DAMAGE } } : undefined
  let caught = 0
  for (const e of state.entities) {
    if (!e.hp || e.type === 'player') continue
    if (!inSwing(GUST.reach * t.mul, GUST.halfAngle * t.mul, fa, e.px - p.px, e.py - p.py)) continue
    if (e.type === 'dragon_boss') continue
    caught++
    if (stunnable(e)) {
      e.stunTimer = t.stun
      startKnockback(e, e.px - p.px, e.py - p.py, t.knockback, slamOpts)
    } else {
      startKnockback(e, e.px - p.px, e.py - p.py, t.bossKnockback, slamOpts)
    }
  }
  return { ok: true, caught, tier }
}
