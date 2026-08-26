// Melee/ranged stance and projectile firing. Pure player-state logic —
// game.js owns projectile spawning, log messages, and input.
import { hasTalent } from './talents.js'

const STANCE_ORDER = ['melee', 'ranged', 'magic']
const STANCE_TALENT = { ranged: 'ranged_stance', magic: 'magic_stance' }

// Changing stance is a commitment: the new form takes a moment to settle,
// and no attack works until it does.
export const STANCE_SWITCH_DURATION = 0.7

// The next learned stance in the cycle; null when only melee is known. Pure
// query — flipping attackMode is tickStanceSwitch's job.
export function nextStance(player) {
  const from = STANCE_ORDER.indexOf(player.attackMode)
  for (let step = 1; step <= STANCE_ORDER.length; step++) {
    const mode = STANCE_ORDER[(from + step) % STANCE_ORDER.length]
    if (mode === player.attackMode) break
    if (!STANCE_TALENT[mode] || hasTalent(player, STANCE_TALENT[mode])) return mode
  }
  return null
}

// Begin the timed transition. Returns the target mode, null when there is
// nothing to switch to, or false when a switch is already running (ignored).
export function startStanceSwitch(player) {
  if (player.stanceSwitch) return false
  const to = nextStance(player)
  if (!to) return null
  player.stanceSwitch = { from: player.attackMode, to, t: 0, dur: STANCE_SWITCH_DURATION }
  return to
}

// Advance a running switch; on completion flips attackMode and returns the
// landed mode (the caller announces it), otherwise null.
export function tickStanceSwitch(player, dt) {
  const sw = player.stanceSwitch
  if (!sw) return null
  sw.t += dt
  if (sw.t < sw.dur) return null
  player.attackMode = sw.to
  player.stanceSwitch = null
  return sw.to
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
