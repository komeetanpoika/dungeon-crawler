// Enemy melee-attack framework: weapons with stats, windup→strike→swing lifecycle.
// Pure logic — no canvas/DOM imports. The renderer reads e.attack.
import { damagePlayer } from './player-damage.js'

export const ATTACK_COOLDOWN = 0.8

// Windups are all 0 for now (behavior-preserving seeds); the lifecycle below
// fully supports nonzero windups — see the telegraph tests.
export const WEAPONS = {
  sword:       { sprite: 'weapon_sword', style: 'arc',   marks: null,     damage: 1, windup: 0, duration: 0.25, range: 20 },
  club:        { sprite: 'weapon_club',  style: 'slash', marks: null,     damage: 3, windup: 0, duration: 0.30, range: 40 },
  claw:        { sprite: null,           style: 'snap',  marks: 'claw',   damage: 1, windup: 0, duration: 0.20, range: 20 },
  dragon_claw: { sprite: null,           style: 'arc',   marks: 'claw',   damage: 2, windup: 0, duration: 0.25, range: 20 },
  pincer:      { sprite: null,           style: 'snap',  marks: 'pincer', damage: 1, windup: 0, duration: 0.20, range: 20 },
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
  if (Math.hypot(e.px - player.px, e.py - player.py) >= w.range) return false
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
  const inRange = Math.hypot(e.px - player.px, e.py - player.py) < w.range
  if (inRange && !damagePlayer(state, w.damage, 'hit', a.message)) {
    e.attack = null   // i-framed: no cooldown, no animation — retries next frame
    return
  }
  if (inRange) e.inCombat = true
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
