import { isWalkable } from './entities.js'

const S = 32
const CRAB_SPEED       = 65
const CRAB_HALF        = 4
const CONTACT_DAMAGE   = 1
const CONTACT_COOLDOWN = 0.8
const CONTACT_RANGE    = 20
const GRAB_RANGE       = 25
const GRAB_DURATION    = 2.0
const GRAB_DMG_INTERVAL = 0.3
const GRAB_COOLDOWN    = 5.0

function canMoveTo(map, px, py) {
  return [
    [px - CRAB_HALF, py - CRAB_HALF],
    [px + CRAB_HALF, py - CRAB_HALF],
    [px - CRAB_HALF, py + CRAB_HALF],
    [px + CRAB_HALF, py + CRAB_HALF],
  ].every(([cx, cy]) => {
    const tile = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return tile && isWalkable(tile.tile, tile)
  })
}

export function makeCrab(x, y) {
  return {
    type: 'crab', x, y,
    hp: 6, maxHp: 6, inCombat: false,
    facing: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    strafeDirTimer: 2 + Math.random(),
    grabState: null,
    grabTimer: 0,
    grabDamageTimer: 0,
    grabCooldown: 0,
    damageCooldown: 0,
  }
}

export function updateCrab(e, state, delta) {
  const { player, map } = state
  const dist = Math.hypot(e.px - player.px, e.py - player.py)

  e.damageCooldown  = Math.max(0, e.damageCooldown  - delta)
  e.grabCooldown    = Math.max(0, e.grabCooldown    - delta)
  e.strafeDirTimer  = Math.max(0, e.strafeDirTimer  - delta)

  // Track player direction
  e.facing = Math.atan2(player.py - e.py, player.px - e.px)

  // Flip strafe direction periodically
  if (e.strafeDirTimer <= 0) {
    e.strafeDir = -e.strafeDir
    e.strafeDirTimer = 2 + Math.random()
  }

  // Grab update
  if (e.grabState === 'grabbing') {
    e.grabTimer       = Math.max(0, e.grabTimer       - delta)
    e.grabDamageTimer = Math.max(0, e.grabDamageTimer - delta)
    state.player.grabbed = true

    if (e.grabDamageTimer <= 0) {
      player.hp -= 1
      e.grabDamageTimer = GRAB_DMG_INTERVAL
      e.inCombat = true
      state.log = [...state.log, 'Crab pincer! (-1 HP)'].slice(-5)
    }

    if (e.grabTimer <= 0) {
      e.grabState = null
      e.grabCooldown = GRAB_COOLDOWN
    }
    return  // crab stands still while grabbing
  }

  // Strafe movement: 30% toward + 70% perpendicular
  const toAngle = e.facing
  const perpAngle = toAngle + (Math.PI / 2) * e.strafeDir
  const vx = Math.cos(toAngle) * 0.3 + Math.cos(perpAngle) * 0.7
  const vy = Math.sin(toAngle) * 0.3 + Math.sin(perpAngle) * 0.7
  const len = Math.hypot(vx, vy) || 1
  const mx = (vx / len) * CRAB_SPEED * delta
  const my = (vy / len) * CRAB_SPEED * delta
  if (canMoveTo(map, e.px + mx, e.py)) e.px += mx
  if (canMoveTo(map, e.px, e.py + my)) e.py += my
  e.x = Math.floor(e.px / S)
  e.y = Math.floor(e.py / S)

  // Grab trigger
  if (dist < GRAB_RANGE && e.grabCooldown <= 0) {
    e.grabState = 'grabbing'
    e.grabTimer = GRAB_DURATION
    e.grabDamageTimer = GRAB_DMG_INTERVAL
    state.player.grabbed = true
    return
  }

  // Contact damage
  if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
    player.hp -= CONTACT_DAMAGE
    e.damageCooldown = CONTACT_COOLDOWN
    e.inCombat = true
    state.log = [...state.log, 'Crab pinches! (-1 HP)'].slice(-5)
  }
}
