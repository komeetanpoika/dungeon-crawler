// Per-enemy-type movement-AI tuning (data, not code).
// `taxon` drives the default low-HP flee rule: humanoids and mammals run when
// badly hurt; beasts and bosses fight to the death. Explicit fleeHp overrides.
// `half` is the pixel half-size used for collision AND clearance class
// (<= 16 fits one tile; the 56px-wide cyclops needs 2-tile clearance).
import { NPC_SPECIES } from './npcs.js'

const fleeDefault = taxon => (taxon === 'humanoid' || taxon === 'mammal') ? 0.3 : 0

const BASE = {
  guard:       { taxon: 'humanoid', speed: 80, wanderSpeed: 30, half: 4,  sightRange: 180, stopRange: 20 },
  monster:     { taxon: 'beast',    speed: 80, wanderSpeed: 30, half: 4,  sightRange: 180, stopRange: 20 },
  dragon:      { taxon: 'beast',    speed: 60, wanderSpeed: 30, half: 4,  sightRange: 200, stopRange: 20 },
  crab:        { taxon: 'beast',    speed: 65, wanderSpeed: 25, half: 4,  sightRange: 240, stopRange: 0, combat: 'strafe', inward: 0.3 },
  wizard:      { taxon: 'humanoid', speed: 70, wanderSpeed: 30, half: 4,  sightRange: 300, stopRange: 0, kiteBand: [120, 240], fleeHp: 0 },
  cyclops:     { taxon: 'humanoid', speed: 40, wanderSpeed: 20, half: 28, sightRange: 320, stopRange: 40, fleeHp: 0 },
  // npc: speed/wanderSpeed/fleeHp come from the species (see getAIConfig)
  npc:         { taxon: 'humanoid', speed: 70, wanderSpeed: 40, half: 4,  sightRange: 200, stopRange: 20 },
  // dragon_boss row is documentation only — updateDragonBoss never consults getAIConfig (its stomp navigation is bespoke)
  dragon_boss: { taxon: 'beast',    speed: 0,  wanderSpeed: 0,  half: 28, sightRange: 448, stopRange: 0 },
  // Leap-episode creatures. nakki has no row here — it is never isEnemy, so
  // its movement is driven entirely by its own update hook, not the brain.
  maahinen:    { taxon: 'beast', speed: 70, wanderSpeed: 0,  half: 28, sightRange: 320, stopRange: 30, fleeHp: 0 },
  sammunut:    { taxon: 'beast', speed: 80, wanderSpeed: 40, half: 12, sightRange: 400, stopRange: 0,  fleeHp: 0 },
}

// Monster variants override the base monster row.
const VARIANTS = {
  weak:   { taxon: 'mammal' },                      // rats: rout when badly hurt
  medium: { taxon: 'beast', kiteBand: [70, 120] },  // shooting spider: kite inside its 130px range
  strong: { taxon: 'beast' },
  boss:   { taxon: 'beast' },
}

export function getAIConfig(e) {
  const base = BASE[e.type] ?? BASE.monster
  let merged = e.type === 'monster' ? { ...base, ...(VARIANTS[e.variant] ?? {}) } : { ...base }
  if (e.type === 'npc') {
    const sp = NPC_SPECIES[e.species]
    if (sp) merged = { ...merged, speed: sp.speed, wanderSpeed: sp.wanderSpeed, fleeHp: sp.fleeHp,
                       taxon: sp.walker ? 'humanoid' : 'mammal' }
  }
  if (merged.fleeHp === undefined) merged.fleeHp = fleeDefault(merged.taxon)
  return merged
}
