// Learned abilities. Everything that unlocks a talent — rite, boss kill,
// dungeon clear, future NPC — funnels through grantTalent. Persistence is
// the caller's job (game.js persists for Adventure; Dungeon Rush never does).
import { queueToast } from './feedback.js'
import { sfx } from './sfx.js'

export const TALENTS = {
  ranged_stance: { name: 'Marksmanship', desc: 'Use bows, crossbows and slings in the ranged stance.' },
  magic_stance:  { name: 'Gust of Wind', desc: 'Shape spells in the magic stance — wands give new ones.' },
  heavy_weapons: { name: 'Might',        desc: 'Wield heavy weapons.' },
}

// Dungeon Rush: every talent from the first step — the run is about the
// descent, not the unlocks. Assigned silently at spawn (no toasts).
export const RUSH_START_TALENTS = Object.keys(TALENTS)

// Adventure interim sources: first dungeon cleared on the named map.
// (magic_stance comes from the mushroom-circle rite instead — see rites.js.)
export const MAP_CLEAR_TALENTS = {
  'forest-1-clearings': 'ranged_stance',
  'forest-3-autumn':    'heavy_weapons',
}

export function hasTalent(player, id) {
  return (player?.talents ?? []).includes(id)
}

// Returns true only when newly learned, so callers know to persist.
export function grantTalent(state, id) {
  const def = TALENTS[id]
  if (!def) return false
  const p = state.player
  p.talents ??= []
  if (p.talents.includes(id)) return false
  p.talents.push(id)
  queueToast(state, { title: 'Talent learned', lines: [def.name, def.desc].filter(Boolean) })
  sfx(state, 'talent-learned')
  return true
}
