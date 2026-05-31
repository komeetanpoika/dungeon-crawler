import { hasLineOfSight, isWalkable } from './entities.js'

const S = 32
const CYCLOPS_SPEED        = 40
const CYCLOPS_CHARGE_SPEED = 300
const CYCLOPS_HALF         = 28
const CHARGE_WINDUP        = 1.5
const CHARGE_DURATION      = 3.0
const CHARGE_COOLDOWN      = 8
const SLAM_WINDUP          = 1.0
const SLAM_RING_DURATION   = 0.4
const SLAM_RADIUS          = 80
const SLAM_DAMAGE          = 4
const CONTACT_RANGE        = 40
const CONTACT_DAMAGE       = 3
const CONTACT_COOLDOWN     = 0.8
const KNOCKBACK_DIST       = 60

function canMoveTo(map, px, py) {
  return [
    [px - CYCLOPS_HALF, py - CYCLOPS_HALF],
    [px + CYCLOPS_HALF, py - CYCLOPS_HALF],
    [px - CYCLOPS_HALF, py + CYCLOPS_HALF],
    [px + CYCLOPS_HALF, py + CYCLOPS_HALF],
  ].every(([cx, cy]) => {
    const tile = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return tile && isWalkable(tile.tile)
  })
}

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
    if (dist > CONTACT_RANGE) {
      const len = dist || 1
      const mx = (player.px - e.px) / len * CYCLOPS_SPEED * delta
      const my = (player.py - e.py) / len * CYCLOPS_SPEED * delta
      if (canMoveTo(map, e.px + mx, e.py)) e.px += mx
      if (canMoveTo(map, e.px, e.py + my)) e.py += my
      e.x = Math.floor(e.px / S)
      e.y = Math.floor(e.py / S)
    }

    // Charge takes priority over slam
    if (e.chargeCooldown <= 0 && dist < 200 && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
      e.state = 'charge_windup'
      e.stateTimer = CHARGE_WINDUP
    } else if (e.slamTimer <= 0) {
      e.state = 'slam_windup'
      e.stateTimer = SLAM_WINDUP
    }

    // Contact damage
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      player.hp -= CONTACT_DAMAGE
      e.damageCooldown = CONTACT_COOLDOWN
      e.inCombat = true
      state.log = [...state.log, `Cyclops hits! (-${CONTACT_DAMAGE} HP)`].slice(-5)
    }

  } else if (e.state === 'charge_windup') {
    if (e.stateTimer <= 0) {
      e.chargeAngle = Math.atan2(player.py - e.py, player.px - e.px)
      e.state = 'charging'
      e.stateTimer = CHARGE_DURATION
    }

  } else if (e.state === 'charging') {
    const cdx = Math.cos(e.chargeAngle) * CYCLOPS_CHARGE_SPEED * delta
    const cdy = Math.sin(e.chargeAngle) * CYCLOPS_CHARGE_SPEED * delta

    if (!canMoveTo(map, e.px + cdx, e.py + cdy)) {
      e.state = 'stunned'
      e.stateTimer = 2.5
    } else {
      if (canMoveTo(map, e.px + cdx, e.py)) e.px += cdx
      if (canMoveTo(map, e.px, e.py + cdy)) e.py += cdy
      e.x = Math.floor(e.px / S)
      e.y = Math.floor(e.py / S)

      if (Math.hypot(e.px - player.px, e.py - player.py) < 50) {
        player.hp -= 5
        const a = Math.atan2(player.py - e.py, player.px - e.px)
        player.px += Math.cos(a) * KNOCKBACK_DIST
        player.py += Math.sin(a) * KNOCKBACK_DIST
        e.inCombat = true
        state.log = [...state.log, 'Cyclops charges! (-5 HP)'].slice(-5)
        e.state = 'stunned'
        e.stateTimer = 0.5
      }
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
        player.hp -= SLAM_DAMAGE
        e.inCombat = true
        state.log = [...state.log, `Ground slam! (-${SLAM_DAMAGE} HP)`].slice(-5)
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
