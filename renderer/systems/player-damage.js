// Single funnel for all player damage. 'hit' respects and grants i-frames and
// can be blocked (a raised shield, frontal, with a `from` position) and is
// reduced by the worn outfit's protect; 'dot' and 'lightning' always apply
// untouched. Returns whether damage landed (a block returns false and sets
// player.blockedHit for the striker).
import { addFloat } from './feedback.js'
import { sfx } from './sfx.js'
import { tryBlock } from './shield.js'
import { outfitOf } from './inventory.js'

export const INVULN_DURATION = 0.8

export function damagePlayer(state, amount, kind, from = null) {
  const player = state.player
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  if (kind === 'hit' && tryBlock(state, from)) return false
  if (kind === 'hit') amount = Math.max(0, amount - (outfitOf(player, player.attackMode ?? 'melee')?.protect ?? 0))
  player.hp -= amount
  if (kind === 'hit') player.invulnTimer = INVULN_DURATION
  addFloat(state.feedback, { px: player.px, py: player.py, text: amount > 0 ? `-${amount}` : '0', kind: 'taken' })
  sfx(state, 'player-hurt', { px: player.px, py: player.py })
  return true
}
