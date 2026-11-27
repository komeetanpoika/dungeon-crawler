// Single funnel for all player damage — for state.player, or any hero passed as the fifth argument (PvP).
// 'hit' respects and grants i-frames and
// can be blocked (a raised shield, frontal, with a `from` position) and is
// reduced by the worn outfit's protect (and by one more for a hero with the
// talent Kivinahka, when it is a blow of three or more); 'dot' and 'lightning' always apply
// untouched. Returns whether damage landed (a block returns false and sets
// player.blockedHit for the striker). `soak` (PvP's Ward, 2b) may take some
// or all of what gets past the block and the outfit before hp does: it
// returns what is left. Single-player never passes one.
//
// `state.mercy(from, state)` (set by Kalevanlinna, wilds/city/law.js) may
// spare the player's life: a blow it spares that would take hp to 0 or below
// leaves 1 hp and sets state.arrest instead (the watch takes a wanted player
// alive, to the stocks). The hero riding on top of the coach takes nothing.
import { addFloat } from './feedback.js'
import { sfx } from './sfx.js'
import { tryBlock } from './shield.js'
import { outfitOf } from './inventory.js'
import { hasTalent } from './talents.js'

export const INVULN_DURATION = 0.8
// Kivinahka (the Mountain King's talent, systems/talents.js): a 'hit' that is
// still this heavy after the block and the outfit lands one lighter.
export const KIVINAHKA_FROM = 3

// The monster bench's seam: (state, player, amount, kind) => the hp the
// hit actually takes, seen after block, protect and soak. The float still
// shows what the hit dealt, so an invulnerable bench hero reads the damage.
// Null outside the bench.
let observer = null
export function setDamageObserver(fn) { observer = fn }

export function damagePlayer(state, amount, kind, from = null, hero = state.player, soak = null) {
  const player = hero
  // on top of the coach (wilds/coach-ride.js) nothing reaches the hero
  if (player.riding) return false
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  if (kind === 'hit' && tryBlock(state, from, player)) return false
  if (kind === 'hit') amount = Math.max(0, amount - (outfitOf(player, player.attackMode ?? 'melee')?.protect ?? 0))
  if (kind === 'hit' && amount >= KIVINAHKA_FROM && hasTalent(player, 'kivinahka')) amount -= 1
  if (soak) amount = soak(player, amount)
  const taken = observer ? observer(state, player, amount, kind) : amount
  const loss = Number.isFinite(taken) ? taken : amount
  if (loss > 0 && player.hp - loss <= 0 && state.mercy?.(from, state)) { player.hp = 1; state.arrest = true }
  else player.hp -= loss
  if (kind === 'hit') player.invulnTimer = INVULN_DURATION
  addFloat(state.feedback, { px: player.px, py: player.py, text: amount > 0 ? `-${amount}` : '0', kind: 'taken' })
  sfx(state, 'player-hurt', { px: player.px, py: player.py })
  return true
}
