// Möhkäle, "the Lump": the mountain trolls' fighter (systems/tribes.js,
// tribe `peikot`). The enemy brain walks him at the hero and his club is his
// weapon (the def's `maul`); this hook is his stone slab.
//
// While the slab is up, the hero's blade and shots are stopped with a clank.
// It is down while he swings and for `open` seconds after, and whenever a
// spell holds him: slowed, rooted, frozen or stunned. Spells, fire, lightning
// and his own band's stones and boulder are never stopped. Bait the swing,
// step out, strike.
//
// A supplement: the update runs after brain and act (game.js enemy loop) and
// not at all while he is stunned, so a blow that lands on a held one puts the
// drawn slab down itself. Pure: no browser imports.
//
//   e.lump       { open }   seconds the slab stays down yet
//   e.channels   { slab, stirred, side }   for his rig (render/monster-rigs/troll.js)
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { trollStruck, trollLook } from '../tribes/rockfall.js'

export const TUNING_SCHEMA = [
  { key: 'open', label: 'Open after a swing', group: 'slab', type: 'range', min: 0, max: 3, step: 0.05, default: 0.9, hint: 'seconds the slab stays down once the club has swung' },
  { key: 'raise', label: 'Slab moves in', group: 'slab', type: 'range', min: 0.02, max: 1, step: 0.02, default: 0.16, hint: 'seconds from down to up as drawn; a blow is judged at once' },
]

function ensure(e) {
  if (e.lump) return e.lump
  e.channels = { ...(e.channels ?? null), slab: 1, stirred: 0 }
  return e.lump = { open: 0 }
}
const held = e => e.slowTimer > 0 || e.rootTimer > 0 || !!e.frozen || e.stunTimer > 0

// Whether the slab would stop a blade just now.
export function slabUp(e) { return !e.attack && !(e.lump?.open > 0) && !held(e) }

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  m.open = e.attack ? T.open : Math.max(0, m.open - delta)
  const c = e.channels, step = delta / T.raise
  c.slab = slabUp(e) ? Math.min(1, c.slab + step) : Math.max(0, c.slab - step)
  trollLook(e)
}

export function hit(e, state, dmg, opts = {}) {
  ensure(e)
  if (slabUp(e) && opts.source === 'player' && (opts.via === 'melee' || opts.via === 'shot')) {
    e.inCombat = true
    return { entity: e, absorbed: true, cue: 'clank' }
  }
  if (held(e)) e.channels.slab = 0
  return trollStruck(e, state, dmg, opts)
}

export function debugState(e) {
  const m = e.lump
  return m ? `slab ${slabUp(e) ? 'up' : 'down'}${m.open > 0 ? ` open ${m.open.toFixed(1)}` : ''}${held(e) ? ' held' : ''}` : '-'
}

CREATURE_UPDATE.mohkale = update
CREATURE_HIT.mohkale = hit
