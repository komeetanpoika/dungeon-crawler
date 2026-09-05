// The magic stance and its default spell: a gust of wind. No damage — a
// short cone that stuns regular enemies and shoves whatever it catches.
// Minibosses shrug the stun and are only shoved lightly; the dragon boss is
// too massive to care. Gust is priced in stamina, not mana, and can be held
// to charge a bigger tier — mirroring melee's heavy-weapon charge.
import { inSwing } from './melee.js'
import { startKnockback } from './knockback.js'
import { hasTalent } from './talents.js'
import { GUST_COSTS, affordableTier, canAfford, spendStamina } from './stamina.js'
import { applyFreeze, applySlow } from './status.js'
import { isStoryCreature } from './monsters.js'

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

// Gust's charge-tier degrade; the generic version lives in stamina.js.
export const affordableGustTier = (stamina, tier) => affordableTier(stamina, GUST_COSTS, tier)

export const shouldAutoReleaseGust = held =>
  held > GUST_CHARGE.over + AUTO_RELEASE_GRACE

export const GUST_TIERS = {
  tap:  { mul: 1,    stun: 1.0, knockback: 30, bossKnockback: 12, slam: false },
  full: { mul: 1.25, stun: 1.5, knockback: 45, bossKnockback: 18, slam: false },
  over: { mul: 1.5,  stun: 2.0, knockback: 70, bossKnockback: 28, slam: true },
}
const SLAM_DAMAGE = 3

const stunnable = e => !e.isBoss && e.type !== 'dragon_boss'

// The cone primitive, shared by Gust and the Frost Wand's Rime: sweep the
// wedge in front of the caster and apply whatever the tier asks for (stun,
// shove, chill, freeze). Pure effect — gating and stamina belong to the
// caller (tryGust below, tryCast in spells.js), so the cone is never paid
// for twice. A tier gives its cone as an explicit reach/halfAngle or lets
// the gust defaults scale by `mul`.
export function castCone(state, t) {
  const p = state.player
  const reach = t.reach ?? GUST.reach * t.mul
  const halfAngle = t.halfAngle ?? GUST.halfAngle * t.mul
  const fa = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[p.facing] ?? 0
  const slamOpts = t.slam ? { slam: { damage: SLAM_DAMAGE } } : undefined
  let caught = 0
  for (const e of state.entities) {
    if (!e.hp || e.type === 'player' || isStoryCreature(e)) continue
    if (!inSwing(reach, halfAngle, fa, e.px - p.px, e.py - p.py)) continue
    if (e.type === 'dragon_boss') continue
    caught++
    // Minibosses shrug the crowd control (stun, freeze) but not the shove.
    if (stunnable(e)) {
      if (t.stun) e.stunTimer = t.stun
      if (t.freeze) applyFreeze(e, t.freeze)
    }
    if (t.slow) applySlow(e, t.slow.mul, t.slow.dur)
    const distance = stunnable(e) ? t.knockback : t.bossKnockback
    if (distance) startKnockback(e, e.px - p.px, e.py - p.py, distance, slamOpts)
  }
  return { caught }
}

// Cast the gust from the player's position along their facing. Spends
// stamina and starts the cooldown on success; refusals name their reason so
// the caller can surface it.
export function tryGust(state, tier = 'tap') {
  const p = state.player
  if (!hasTalent(p, 'magic_stance')) return { ok: false, reason: 'not_learned' }
  if ((p.magicCooldown ?? 0) > 0) return { ok: false, reason: 'cooldown' }
  if (!canAfford(p, GUST_COSTS[tier])) return { ok: false, reason: 'stamina' }
  spendStamina(p, GUST_COSTS[tier])
  p.magicCooldown = GUST.cooldown
  return { ok: true, ...castCone(state, GUST_TIERS[tier]), tier }
}
