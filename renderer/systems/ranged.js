// Melee/ranged stance and projectile firing. Pure player-state logic —
// game.js owns projectile spawning, log messages, and input.
import { hasTalent } from './talents.js'
import { spendAmmo } from './inventory.js'

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

// Longbow hold-to-draw tiers, mirroring magic.js's GUST_CHARGE/resolveGustTier.
// tap = plain shot; full/over add damage and pierce (see tryFire). Only the
// longbow sets the `draw` flag, so other bows ignore the tier entirely.
export const DRAW_CHARGE = { full: 0.4, over: 0.9, moveFactor: 0.6 }
const AUTO_RELEASE_GRACE = 0.5

export const resolveDrawTier = held =>
  held >= DRAW_CHARGE.over ? 'over' : held >= DRAW_CHARGE.full ? 'full' : 'tap'

export const shouldAutoReleaseDraw = held =>
  held > DRAW_CHARGE.over + AUTO_RELEASE_GRACE

// Per-tier damage/pierce bonus for a `draw` weapon. Tap gets neither.
const DRAW_BONUS = {
  tap:  { damage: 0, pierce: undefined },
  full: { damage: 1, pierce: 1 },
  over: { damage: 2, pierce: Infinity },
}

// Projectile shapes, which are a rendering concern and not the ammo kind: a
// crossbow spends a 'bolt' from the pool but flies a 'quarrel', because the
// renderer already spends 'bolt' on wand bolts and fireballs.
const SHAPE_BY_KIND = { bow: 'arrow', crossbow: 'quarrel', sling: 'stone' }

// Attempt to fire the equipped ranged weapon. On success spends 1 ammo from
// the shared pool (player.ammo[ammoKind]), starts the weapon's cooldown, and
// returns the projectile's combat stats. `tier` (from resolveDrawTier) only
// affects weapons with the `draw` flag (the longbow).
export function tryFire(player, tier = 'tap') {
  if (!hasTalent(player, 'ranged_stance')) return { ok: false, reason: 'not_learned' }
  const r = player.ranged
  if (!r) return { ok: false, reason: 'no_weapon' }
  const ammoKind = r.ammoKind
  if ((player.ammo?.[ammoKind] ?? 0) <= 0) return { ok: false, reason: 'no_ammo' }
  if (player.rangedCooldown > 0) return { ok: false, reason: 'cooldown' }
  if (!spendAmmo(player, ammoKind, 1)) return { ok: false, reason: 'no_ammo' }
  player.rangedCooldown = r.cooldown

  const result = {
    ok: true,
    damage: r.damage,
    color: r.color,
    shape: SHAPE_BY_KIND[r.kind] ?? 'arrow',
    ammoKind,
  }
  if (r.draw) {
    const bonus = DRAW_BONUS[tier] ?? DRAW_BONUS.tap
    result.damage += bonus.damage
    if (bonus.pierce !== undefined) result.pierce = bonus.pierce
  }
  if (r.fork) result.fork = r.fork
  // Merged rather than two separate assignments, so a future weapon that
  // sets both stun and knockback wouldn't have one silently clobber the other.
  if (r.stun !== undefined || r.knockback !== undefined) {
    result.onHit = { ...(r.stun !== undefined ? { stun: r.stun } : {}),
      ...(r.knockback !== undefined ? { knockback: r.knockback } : {}) }
  }
  if (r.piercesShield) result.piercesShield = true
  return result
}

// HUD log lines per fail reason. Cooldown fails stay silent. no_ammo is
// per-ammo-kind (see noAmmoMessage) rather than a single generic line.
export const FIRE_FAIL_MESSAGES = {
  no_weapon: 'Nothing to shoot with!',
  not_learned: "I don't know how to use this.",
}

const AMMO_NOUNS = { arrow: 'arrows', bolt: 'bolts', stone: 'stones' }

export function noAmmoMessage(ammoKind) {
  return `Out of ${AMMO_NOUNS[ammoKind] ?? 'ammo'}!`
}
