// Melee/ranged stance and projectile firing. Pure player-state logic —
// game.js owns projectile spawning, log messages, and input.

export function toggleAttackMode(player) {
  const cycle = { melee: 'ranged', ranged: 'magic', magic: 'melee' }
  player.attackMode = cycle[player.attackMode] ?? 'melee'
  return player.attackMode
}

// Attempt to fire the equipped ranged weapon. On success spends 1 ammo,
// starts the weapon's cooldown, and returns the projectile's combat stats.
export function tryFire(player) {
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
}
