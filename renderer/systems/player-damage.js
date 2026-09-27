// Single funnel for all player damage — for state.player, or any hero passed as the fifth argument (PvP).
// 'hit' respects and grants i-frames and
// can be blocked (a raised shield, frontal, with a `from` position) and is
// reduced by the worn outfit's protect; 'dot' and 'lightning' always apply
// untouched. Returns whether damage landed (a block returns false and sets
// player.blockedHit for the striker). `soak` (PvP's Ward, 2b) may take some
// or all of what gets past the block and the outfit before hp does: it
// returns what is left. Single-player never passes one.
import { addFloat } from './feedback.js'
import { sfx } from './sfx.js'
import { tryBlock } from './shield.js'
import { outfitOf } from './inventory.js'

export const INVULN_DURATION = 0.8

export function damagePlayer(state, amount, kind, from = null, hero = state.player, soak = null) {
  const player = hero
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  if (kind === 'hit' && tryBlock(state, from, player)) return false
  if (kind === 'hit') amount = Math.max(0, amount - (outfitOf(player, player.attackMode ?? 'melee')?.protect ?? 0))
  if (soak) amount = soak(player, amount)
  player.hp -= amount
  if (kind === 'hit') player.invulnTimer = INVULN_DURATION
  addFloat(state.feedback, { px: player.px, py: player.py, text: amount > 0 ? `-${amount}` : '0', kind: 'taken' })
  sfx(state, 'player-hurt', { px: player.px, py: player.py })
  return true
}
