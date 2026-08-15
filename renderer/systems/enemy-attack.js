// Enemy melee-attack framework: weapons with stats, windup→strike→swing lifecycle.
// Pure logic — no canvas/DOM imports. The renderer reads e.attack.
import { damagePlayer } from './player-damage.js'
import { getSwingArc, inSwing } from './melee.js'

export const ATTACK_COOLDOWN = 0.8

// Windups are all 0 for now (behavior-preserving seeds); the lifecycle below
// fully supports nonzero windups — see the telegraph tests.
//
// `reach` is how far the swing bites from the wielder's center, in pixels (a
// tile is 32). It is the same number the renderer sizes the swing arc from, so
// a blow can only land where the player can see the blade coming. Each reach
// sits at least at the wielder's `stopRange` in enemy-ai.js — the distance its
// AI walks to — and scales with the creature: a guard's arm, a dragon's claw
// swiping inside its 3-tile body, a cyclops' two-handed club.
export const WEAPONS = {
  sword:       { sprite: 'weapon_sword', style: 'arc',   marks: null,     damage: 1, windup: 0, duration: 0.25, reach: 34 },
  club:        { sprite: 'weapon_club',  style: 'slash', marks: null,     damage: 3, windup: 0, duration: 0.30, reach: 52 },
  claw:        { sprite: null,           style: 'snap',  marks: 'claw',   damage: 1, windup: 0, duration: 0.20, reach: 28 },
  dragon_claw: { sprite: null,           style: 'arc',   marks: 'claw',   damage: 2, windup: 0, duration: 0.25, reach: 44 },
  pincer:      { sprite: null,           style: 'snap',  marks: 'pincer', damage: 1, windup: 0, duration: 0.20, reach: 28 },
}

// The wedge a weapon carves: its own reach, at the width of its swing style.
export function weaponWedge(w) {
  return { reach: w.reach, halfAngle: getSwingArc(w.style).halfAngle }
}

export const ENEMY_MELEE = {
  guard:   'sword',
  monster: 'claw',
  dragon:  'dragon_claw',
  crab:    'pincer',
  cyclops: 'club',
}

// Per-entity weaponId beats the type default; weaponOverrides tweaks individual
// stats — the hook for spawns carrying varied weapons later.
export function getEnemyWeapon(e) {
  const id = e.weaponId ?? ENEMY_MELEE[e.type]
  if (!id || !WEAPONS[id]) return null
  return { id, ...WEAPONS[id], ...(e.weaponOverrides ?? {}) }
}

export function tryStartEnemyAttack(e, state, message) {
  if (e.attack) return false
  if ((e.damageCooldown ?? 0) > 0) return false
  const w = getEnemyWeapon(e)
  if (!w) return false
  const { player } = state
  // Starting the swing only asks whether the player is close enough — the
  // enemy turns to face them as it commits, so direction is settled here.
  if (Math.hypot(e.px - player.px, e.py - player.py) >= w.reach) return false
  e.attack = {
    weaponId: w.id,
    phase: 'windup',
    timer: w.windup,
    duration: w.windup,
    angle: Math.atan2(player.py - e.py, player.px - e.px),
    message: message ?? `Hit for ${w.damage} damage!`,
  }
  if (w.windup <= 0) strike(e, state)
  return true
}

function strike(e, state) {
  const w = getEnemyWeapon(e)
  const a = e.attack
  const { player } = state
  // The blow lands only where the blade actually goes: the wedge is centred on
  // the angle the swing committed to at windup, so a player who steps aside
  // during a telegraph is missed even at point-blank range.
  const { reach, halfAngle } = weaponWedge(w)
  const connects = inSwing(reach, halfAngle, a.angle, player.px - e.px, player.py - e.py)
  if (connects && !damagePlayer(state, w.damage, 'hit', a.message)) {
    e.attack = null   // i-framed: no cooldown, no animation — retries next frame
    return
  }
  if (connects) e.inCombat = true
  e.damageCooldown = ATTACK_COOLDOWN   // landed, or whiffed after a windup: the attack is spent
  a.phase = 'swing'
  a.timer = w.duration
  a.duration = w.duration
}

export function stepEnemyAttack(e, state, delta) {
  const a = e.attack
  if (!a) return
  a.timer = Math.max(0, a.timer - delta)
  if (a.timer > 0) return
  if (a.phase === 'windup') strike(e, state)
  else e.attack = null
}
