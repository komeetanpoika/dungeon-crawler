// The magic stance and its default spell: a gust of wind. No damage — a
// short cone that stuns regular enemies and shoves whatever it catches.
// Minibosses shrug the stun and are only shoved lightly; the dragon boss is
// too massive to care. Gust is priced in stamina, not mana, and can be held
// to charge a bigger tier — mirroring melee's heavy-weapon charge.
import { inSwing } from './melee.js'
import { startKnockback } from './knockback.js'
import { hasTalent } from './talents.js'
import { GUST_COSTS, canAfford, spendStamina } from './stamina.js'
import { isCreature } from './creatures.js'

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

// A release at a tier the player can't afford degrades to the highest tier
// they *can* afford (over -> full -> tap) rather than refusing outright —
// the charge isn't wasted just because the reached tier overshoots the
// tank. Returns null when even tap is unaffordable, so the caller can fall
// through to tryGust's own refusal path.
const GUST_TIER_ORDER = ['over', 'full', 'tap']
export function affordableGustTier(stamina, tier) {
  const start = GUST_TIER_ORDER.indexOf(tier)
  for (let i = start; i < GUST_TIER_ORDER.length; i++) {
    if (stamina >= GUST_COSTS[GUST_TIER_ORDER[i]]) return GUST_TIER_ORDER[i]
  }
  return null
}

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
    if (!e.hp || e.type === 'player' || isCreature(e)) continue
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
