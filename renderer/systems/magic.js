// The magic stance and its default spell: a gust of wind. No damage — a
// short cone that stuns regular enemies and shoves whatever it catches.
// Minibosses shrug the stun and are only shoved lightly; the dragon boss is
// too massive to care. Mana is a small pool that recharges slowly.
import { inSwing } from './melee.js'
import { startKnockback } from './knockback.js'
import { hasTalent } from './talents.js'

export const MANA_MAX = 4
export const MANA_REGEN_TIME = 8   // seconds per charge

export const GUST = {
  cooldown: 3,
  stun: 1.0,
  knockback: 30,
  bossKnockback: 12,
  reach: 80,                       // ~2.5 tiles
  halfAngle: Math.PI * 55 / 180,
}

export function tickMana(player, dt) {
  if ((player.mana ?? MANA_MAX) >= MANA_MAX) { player.manaRegenT = 0; return }
  player.manaRegenT = (player.manaRegenT ?? 0) + dt
  while (player.manaRegenT >= MANA_REGEN_TIME && player.mana < MANA_MAX) {
    player.mana += 1
    player.manaRegenT -= MANA_REGEN_TIME
  }
  if (player.mana >= MANA_MAX) player.manaRegenT = 0
}

const stunnable = e => !e.isBoss && e.type !== 'dragon_boss'

// Cast the gust from the player's position along their facing. Spends mana
// and starts the cooldown on success; refusals name their reason so the
// caller can surface it.
export function tryGust(state) {
  const p = state.player
  if (!hasTalent(p, 'magic_stance')) return { ok: false, reason: 'not_learned' }
  if ((p.magicCooldown ?? 0) > 0) return { ok: false, reason: 'cooldown' }
  if ((p.mana ?? 0) < 1) return { ok: false, reason: 'mana' }
  p.mana -= 1
  p.magicCooldown = GUST.cooldown
  const fa = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[p.facing] ?? 0
  let caught = 0
  for (const e of state.entities) {
    if (!e.hp || e.type === 'player') continue
    if (!inSwing(GUST.reach, GUST.halfAngle, fa, e.px - p.px, e.py - p.py)) continue
    if (e.type === 'dragon_boss') continue
    caught++
    if (stunnable(e)) {
      e.stunTimer = GUST.stun
      startKnockback(e, e.px - p.px, e.py - p.py, GUST.knockback)
    } else {
      startKnockback(e, e.px - p.px, e.py - p.py, GUST.bossKnockback)
    }
  }
  return { ok: true, caught }
}
