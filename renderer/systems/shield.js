// The shield in the offhand: raised while Q is held (systems/inventory.js
// offhand), it absorbs hits arriving from the front for a stamina price.
// Pure — game.js reads the key and calls tickShield once a frame;
// player-damage.js calls tryBlock for every positioned 'hit'.
import { offhand } from './inventory.js'
import { spendStamina } from './stamina.js'
import { sfx } from './sfx.js'
import { FACING_ANGLE } from './entities.js'

export const SHIELD_DROP = 0.8            // s the shield stays down after the tank empties
export const BLOCK_HALF_ARC = Math.PI / 3 // 60° either side of the facing
export const BLOCK_SPEED_MUL = 0.5        // walk speed while raised
export const BLOCK_SHOVE = 12             // px a blocked melee enemy is pushed back

export const heldShield = player => {
  const off = offhand(player)
  return off?.kind === 'shield' ? off : null
}

// Once a frame. `wantBlock` is the raw key; the shield only rises with a
// shield in hand, stamina in the tank and no drop timer running.
export function tickShield(player, wantBlock, dt) {
  player.shieldDropT = Math.max(0, (player.shieldDropT ?? 0) - dt)
  player.blocking = !!(wantBlock && heldShield(player) && player.shieldDropT <= 0 && (player.stamina ?? 0) > 0)
  return player.blocking
}

// Whether a hit from `from` ({px, py}) arrives inside the raised arc.
export function inBlockArc(player, from) {
  if (!from || !Number.isFinite(from.px) || !Number.isFinite(from.py)) return false
  const fa = FACING_ANGLE[player.facing] ?? 0
  const a = Math.atan2(from.py - player.py, from.px - player.px)
  const d = Math.abs(Math.atan2(Math.sin(a - fa), Math.cos(a - fa)))
  return d <= BLOCK_HALF_ARC
}

// Absorb a hit if the shield is up and the hit is frontal. Costs the
// shield's blockCost; a block that empties the tank drops the shield for
// SHIELD_DROP with the stamina bar's refused flash, the same tell the sprint
// gives. `blockedHit` tells the melee striker (enemy-attack.js) its swing was
// spent on the shield rather than i-framed.
export function tryBlock(state, from) {
  const player = state.player
  if (!player.blocking || !inBlockArc(player, from)) return false
  const shield = heldShield(player)
  if (!shield) return false
  spendStamina(player, shield.blockCost)
  if ((player.stamina ?? 0) <= 0) {
    player.shieldDropT = SHIELD_DROP
    player.blocking = false
    player.staminaRefusedT = 0.4
  }
  player.blockedHit = true
  sfx(state, 'shield-block', { px: player.px, py: player.py })
  return true
}
