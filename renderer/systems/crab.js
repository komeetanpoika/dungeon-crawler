import { damagePlayer } from './player-damage.js'
import { tryStartEnemyAttack } from './enemy-attack.js'
import { updateBrain } from './brain.js'
import { act } from './act.js'

const S = 32
const GRAB_RANGE       = 25
const GRAB_DURATION    = 2.0
const GRAB_DMG_INTERVAL = 0.3
const GRAB_COOLDOWN    = 5.0

export function makeCrab(x, y) {
  return {
    type: 'crab', x, y,
    hp: 6, maxHp: 6, inCombat: false,
    facing: 0,
    grabState: null,
    grabTimer: 0,
    grabDamageTimer: 0,
    grabCooldown: 0,
    damageCooldown: 0,
  }
}

export function updateCrab(e, state, delta) {
  const { player } = state
  const dist = Math.hypot(e.px - player.px, e.py - player.py)

  e.damageCooldown  = Math.max(0, e.damageCooldown  - delta)
  e.grabCooldown    = Math.max(0, e.grabCooldown    - delta)

  // Track player direction
  e.facing = Math.atan2(player.py - e.py, player.px - e.px)

  // Grab update
  if (e.grabState === 'grabbing') {
    e.grabTimer       = Math.max(0, e.grabTimer       - delta)
    e.grabDamageTimer = Math.max(0, e.grabDamageTimer - delta)
    state.player.grabbed = true

    if (e.grabDamageTimer <= 0) {
      damagePlayer(state, 1, 'dot', 'Crab pincer! (-1 HP)')
      e.grabDamageTimer = GRAB_DMG_INTERVAL
      e.inCombat = true
    }

    if (e.grabTimer <= 0) {
      e.grabState = null
      e.grabCooldown = GRAB_COOLDOWN
    }
    return  // crab stands still while grabbing
  }

  act(e, state, delta, updateBrain(e, state, delta))

  // Grab trigger
  if (dist < GRAB_RANGE && e.grabCooldown <= 0) {
    e.grabState = 'grabbing'
    e.grabTimer = GRAB_DURATION
    e.grabDamageTimer = GRAB_DMG_INTERVAL
    state.player.grabbed = true
    return
  }

  // Contact melee — pincer via the weapon framework
  tryStartEnemyAttack(e, state, 'Crab pinches! (-1 HP)')
}
