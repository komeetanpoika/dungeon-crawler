// Kumistin, the gong of the walrus's court: a great scallop shell in a
// driftwood frame (render/monster-rigs/gong.js). It is a thing, not a
// creature: the def is `passive` (never an enemy) and `calm` (striking it
// wrongs nobody, systems/tribes.js), it stands where it was dealt whatever
// shoves it, and no blow harms it.
//
// Every blow rings it (`e.flicker` swings the shell for `ringTime` seconds;
// the cue is `gong`). The hero's own blow, blade, shot or spell, also calls
// the walrus to a bout (mursu.js startDuel): the living walrus that shares
// its `home`, or with none the nearest within `call` tiles (the bench). One
// stroke in `again` seconds counts. Fire, lightning and the rest ring it and
// call nobody. The walrus himself says no while his tribe holds a grudge,
// while he rests, and to a hero who can hardly stand.
//
// Hook-driven. Pure: no browser imports.
//
//   e.gong   { anchor: { px, py, x, y }, cd }
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { tribeOf, roleOf } from '../tribes.js'
import { startDuel } from './mursu.js'

const S = 32

export const TUNING_SCHEMA = [
  { key: 'ringTime', label: 'Rings for', group: 'gong', type: 'range', min: 0.2, max: 6, step: 0.1, default: 1.6, hint: 'seconds the shell swings' },
  { key: 'again', label: 'Strokes apart', group: 'gong', type: 'range', min: 0, max: 5, step: 0.1, default: 0.5, hint: 'seconds before another stroke calls him' },
  { key: 'call', label: 'Heard to', group: 'gong', type: 'range', min: 2, max: 30, step: 1, default: 12, hint: 'tiles: how far off a walrus with no court of his own answers' },
]

function ensure(e) {
  if (e.gong) return e.gong
  e.flicker = 0
  return e.gong = { anchor: { px: e.px, py: e.py, x: e.x, y: e.y }, cd: 0 }
}

// Whom it calls: the champion of its own court, else the nearest in earshot.
function walrusOf(e, state, T) {
  const tribe = tribeOf(e)
  let best = null, bestD = T.call * S
  for (const o of state.entities ?? []) {
    if (!(o.hp > 0) || o.dying > 0 || tribeOf(o) !== tribe || roleOf(o) !== 'boss') continue
    if (e.home && o.home && o.home.x === e.home.x && o.home.y === e.home.y) return o
    const d = Math.hypot(o.px - e.px, o.py - e.py)
    if (d <= bestD) { best = o; bestD = d }
  }
  return best
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  Object.assign(e, m.anchor)
  e.knockback = null
  m.cd = Math.max(0, m.cd - delta)
  e.flicker = Math.max(0, e.flicker - delta / T.ringTime)
}

export function hit(e, state, dmg, opts = {}) {
  const T = tuningOf(e.type), m = ensure(e)
  e.flicker = 1
  if ((opts.source ?? 'player') === 'player' && m.cd <= 0) {
    m.cd = T.again
    const walrus = walrusOf(e, state, T)
    if (walrus) startDuel(walrus, state)
  }
  return { entity: e, absorbed: true, cue: 'gong' }
}

export function debugState(e) {
  return e.gong ? `ringing ${(e.flicker ?? 0).toFixed(2)}` : '-'
}

CREATURE_UPDATE.kumistin = update
CREATURE_HIT.kumistin = hit
