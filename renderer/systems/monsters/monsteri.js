// Monsteri, from the user's crayon drawing (monsteri.jpg): a red, upright
// creature with two pairs of clawed arms, a sweeping tail and three yellow
// orbs on stalks above its head. Its mechanics are still to be described —
// until then this is the scaffold's placeholder cycle.
//
// Runs as a CREATURE_UPDATE supplement after the brain and act have moved
// it this frame (see systems/monsters.js). Every number worth tweaking
// lives in TUNING_SCHEMA; the values come from the monster's JSON `tuning`
// and are read through tuningOf every frame, so a monster-bench edit lands
// on the next frame.
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'

export const TUNING_SCHEMA = [
  { key: 'cooldown', label: 'Cooldown', group: 'attack', type: 'range', min: 0.2, max: 10, step: 0.1, default: 2,
    hint: 'seconds between attacks' },
]

export function update(e, state, delta) {
  const T = tuningOf(e.type)
  const m = e.mech ?? (e.mech = { state: 'idle', t: 0, cd: T.cooldown })
  m.t += delta
  m.state = 'idle'
  if (m.t >= T.cooldown) { m.t = 0; m.state = 'attack' }   // placeholder: the attack starts here
  m.cd = Math.max(0, T.cooldown - m.t)
}

// Monster-bench readout: one short line on where the state machine is.
export function debugState(e) {
  return `${e.mech?.state ?? '-'} cd ${(e.mech?.cd ?? 0).toFixed(2)}`
}

// Monster-bench overlay (Hitboxes on): ctx sits at the monster's screen
// centre, S px per tile. Draw range rings and aim lines here.
export function debugDraw(ctx, e, S) {
}

CREATURE_UPDATE.monsteri = update
