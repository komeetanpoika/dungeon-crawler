// Poison: what a scorpion's sting leaves in the hero
// (systems/monsters/skorpioni.js). One hp every POISON.every seconds, as many
// times as the sting gave; a new sting restarts the clock and keeps the
// larger count, never stacking. It weakens and does not kill: with the hero
// at POISON.floor hp a bite takes nothing, though it still counts down.
//
// Cures: anything eaten or drunk that heals (game.js useInventoryItem calls
// curePoison), and POISON.cureAfter seconds on end beside a well or water
// (`water`, which game.js asks of wilds/heat.js). On top of the coach the
// clock stands still; it ends with the hero's death. No poison takes hold of
// a hero with the talent Käärmeenkieli (systems/talents.js). Pure and DOM-free.
//
//   player.poison   { left, next, wash }   bites left, seconds to the next,
//                                          seconds beside water so far
import { damagePlayer } from './player-damage.js'
import { addFloat } from './feedback.js'
import { sfx } from './sfx.js'
import { hasTalent } from './talents.js'

export const POISON = { every: 4, floor: 1, cureAfter: 1 }

// The sting's poison, as against the arena's Venom (pvp/dots.js keeps its
// own `hero.poison` of another shape and draws its own wash).
export const isPoisoned = hero => hero?.poison?.left > 0

export function poisonPlayer(player, ticks) {
  if (!(ticks > 0) || hasTalent(player, 'kaarmeenkieli')) return
  player.poison = { left: Math.max(ticks, player.poison?.left ?? 0), next: POISON.every, wash: 0 }
}

export function curePoison(player) {
  if (!player.poison) return false
  player.poison = undefined
  return true
}

export function tickPoison(state, delta, { water = false } = {}) {
  const { player } = state
  const p = player?.poison
  if (!p || player.riding) return
  if (!(player.hp > 0)) { player.poison = undefined; return }   // it dies with him
  p.wash = water ? p.wash + delta : 0
  if (p.wash >= POISON.cureAfter) {
    curePoison(player)
    addFloat(state.feedback, { px: player.px, py: player.py - 12, text: 'washed out', kind: 'note' })
    return
  }
  p.next -= delta
  if (p.next > 0) return
  p.next += POISON.every
  p.left--
  if (player.hp > POISON.floor) {
    damagePlayer(state, 1, 'dot')
    sfx(state, 'poison', { px: player.px, py: player.py })
  }
  if (p.left <= 0) player.poison = undefined
}
