import { hasLineOfSight } from './entities.js'
import { damagePlayer } from './player-damage.js'
import { startKnockback } from './knockback.js'
import { tryStartEnemyAttack } from './enemy-attack.js'
import { updateBrain } from './brain.js'
import { act } from './act.js'

const S = 32
const CYCLOPS_CHARGE_SPEED = 300
const CHARGE_WINDUP        = 1.5
const CHARGE_DURATION      = 3.0
const CHARGE_COOLDOWN      = 8
const SLAM_WINDUP          = 1.0
const SLAM_RING_DURATION   = 0.4
const SLAM_RADIUS          = 80
const SLAM_DAMAGE          = 4
const CONTACT_RANGE        = 40
const KNOCKBACK_DIST       = 60

export function makeCyclops(x, y) {
  return {
    type: 'cyclops', x, y,
    hp: 30, maxHp: 30, inCombat: false,
    state: 'chase', stateTimer: 0,
    chargeAngle: 0,
    chargeCooldown: 0,
    slamTimer: 5 + Math.random() * 3,
    slamRing: null,
    damageCooldown: 0,
  }
}

export function updateCyclops(e, state, delta) {
  const { player, map } = state
  const dist = Math.hypot(e.px - player.px, e.py - player.py)

  e.damageCooldown = Math.max(0, e.damageCooldown - delta)
  e.chargeCooldown = Math.max(0, e.chargeCooldown - delta)
  e.stateTimer     = Math.max(0, e.stateTimer     - delta)

  if (e.state === 'chase') {
    e.slamTimer = Math.max(0, e.slamTimer - delta)

    // Move toward player
    act(e, state, delta, updateBrain(e, state, delta))

    // Charge takes priority over slam
    if (e.chargeCooldown <= 0 && dist < 200 && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
      e.state = 'charge_windup'
      e.stateTimer = CHARGE_WINDUP
    } else if (e.slamTimer <= 0) {
      e.state = 'slam_windup'
      e.stateTimer = SLAM_WINDUP
    }

    // Contact melee — club via the weapon framework (range 40 matches CONTACT_RANGE)
    tryStartEnemyAttack(e, state, 'Cyclops hits! (-3 HP)')

  } else if (e.state === 'charge_windup') {
    if (e.stateTimer <= 0) {
      e.chargeAngle = Math.atan2(player.py - e.py, player.px - e.px)
      e.state = 'charging'
      e.stateTimer = CHARGE_DURATION
    }

  } else if (e.state === 'charging') {
    if (Math.hypot(e.px - player.px, e.py - player.py) < 50) {
      if (damagePlayer(state, 5, 'hit', 'Cyclops charges! (-5 HP)')) {
        startKnockback(player, player.px - e.px, player.py - e.py, KNOCKBACK_DIST)
        e.inCombat = true
      }
      e.state = 'stunned'
      e.stateTimer = 0.5
    } else if (!act(e, state, delta, { mode: 'charge', angle: e.chargeAngle, speed: CYCLOPS_CHARGE_SPEED })) {
      e.state = 'stunned'
      e.stateTimer = 2.5
    }

    if (e.state === 'charging' && e.stateTimer <= 0) {
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }

  } else if (e.state === 'stunned') {
    if (e.stateTimer <= 0) {
      e.chargeCooldown = CHARGE_COOLDOWN
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }

  } else if (e.state === 'slam_windup') {
    if (e.stateTimer <= 0) {
      e.state = 'slamming'
      e.stateTimer = SLAM_RING_DURATION
      e.slamRing = { radius: 0, maxRadius: SLAM_RADIUS }
      if (dist < SLAM_RADIUS) {
        if (damagePlayer(state, SLAM_DAMAGE, 'hit', `Ground slam! (-${SLAM_DAMAGE} HP)`)) {
          e.inCombat = true
        }
      }
    }

  } else if (e.state === 'slamming') {
    if (e.slamRing) e.slamRing.radius = SLAM_RADIUS * (1 - e.stateTimer / SLAM_RING_DURATION)
    if (e.stateTimer <= 0) {
      e.slamRing = null
      e.state = 'chase'
      e.slamTimer = 5 + Math.random() * 3
    }
  }
}
