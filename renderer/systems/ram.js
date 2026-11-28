// The Horned Helm's ram (entities.js WORN_TYPES `power: 'ram'`): a sprint
// that runs into an enemy shoves it back and stuns it for a moment. It costs
// stamina on top of the sprint's own, and the same enemy is not rammed again
// for RAM.every seconds, so standing in a crowd at a run is no free stunlock.
// A boss or a rooted thing takes the stun and keeps its ground.
//
// Only enemies (systems/factions.js isEnemy): a villager walked into is a
// villager walked into. Pure and DOM-free; game.js calls tickRam once a
// frame, after the hero has moved.
import { wornPower } from './worn.js'
import { isEnemy } from './factions.js'
import { pointHits, PLAYER_SHAPE } from './hitbox.js'
import { startKnockback } from './knockback.js'
import { spendStamina } from './stamina.js'
import { sfx } from './sfx.js'

export const RAM = { cost: 12, shove: 40, stun: 0.6, every: 1 }

// What a ram does not move: a lair's boss, the great bosses, anything rooted.
const holdsGround = e => e.isBoss || e.type === 'dragon_boss' || e.type === 'dragon' || e.type === 'cyclops' || (e.rootTimer ?? 0) > 0

// Returns the enemies rammed this frame.
export function tickRam(state, player, { sprinting = false, dt = 0 } = {}) {
  const rammed = []
  for (const e of state.entities) if (e.ramT > 0) e.ramT = Math.max(0, e.ramT - dt)
  if (!sprinting || !wornPower(player, 'ram')) return rammed
  for (const e of state.entities) {
    if (e.ramT > 0 || !(e.hp > 0) || !isEnemy(e)) continue
    if (!pointHits(e, player.px, player.py, PLAYER_SHAPE.r)) continue
    if ((player.stamina ?? 0) < RAM.cost) break
    spendStamina(player, RAM.cost)
    e.ramT = RAM.every
    e.stunTimer = Math.max(e.stunTimer ?? 0, RAM.stun)
    if (!holdsGround(e)) startKnockback(e, e.px - player.px, e.py - player.py, RAM.shove)
    sfx(state, 'ram', { px: e.px, py: e.py })
    rammed.push(e)
  }
  return rammed
}
