// Melee/ranged stance and projectile firing. Pure player-state logic —
// game.js owns projectile spawning, log messages, and input.
import { hasTalent } from './talents.js'

const STANCE_ORDER = ['melee', 'ranged', 'magic']
const STANCE_TALENT = { ranged: 'ranged_stance', magic: 'magic_stance' }

// Cycle to the next learned stance; null (no change) when only melee is known.
export function toggleAttackMode(player) {
  const from = STANCE_ORDER.indexOf(player.attackMode)
  for (let step = 1; step <= STANCE_ORDER.length; step++) {
    const mode = STANCE_ORDER[(from + step) % STANCE_ORDER.length]
    if (mode === player.attackMode) break
    if (!STANCE_TALENT[mode] || hasTalent(player, STANCE_TALENT[mode])) {
      player.attackMode = mode
      return mode
    }
  }
  return null
}

// Attempt to fire the equipped ranged weapon. On success spends 1 ammo,
// starts the weapon's cooldown, and returns the projectile's combat stats.
export function tryFire(player) {
  if (!hasTalent(player, 'ranged_stance')) return { ok: false, reason: 'not_learned' }
  if (!player.ranged) return { ok: false, reason: 'no_weapon' }
  if (player.ranged.ammo <= 0) return { ok: false, reason: 'no_ammo' }
  if (player.rangedCooldown > 0) return { ok: false, reason: 'cooldown' }
  player.ranged.ammo -= 1
  player.rangedCooldown = player.ranged.cooldown
  return {
    ok: true,
    damage: player.ranged.damage,
    color: player.ranged.color,
    shape: player.ranged.kind === 'bow' ? 'arrow' : 'bolt',
    ...(player.ranged.explodes ? { explodes: true } : {}),
  }
}

// HUD log lines per fail reason. Cooldown fails stay silent.
export const FIRE_FAIL_MESSAGES = {
  no_weapon: 'Nothing to shoot with!',
  no_ammo: 'Out of ammo!',
  not_learned: "I don't know how to use this.",
}
