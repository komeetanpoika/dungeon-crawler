// Learned abilities. Everything that unlocks a talent — rite, boss kill,
// dungeon clear, future NPC — funnels through grantTalent. Persistence is
// the caller's job (game.js persists for Adventure; Dungeon Rush never does).
import { announce } from './feedback.js'

export const TALENTS = {
  ranged_stance: { name: 'Marksmanship', desc: 'Use bows and wands in the ranged stance.' },
  magic_stance:  { name: 'Gust of Wind', desc: 'Channel mana in the magic stance.' },
  heavy_weapons: { name: 'Might',        desc: 'Wield heavy weapons.' },
}

// Dungeon Rush: per-run talents taught by the depth ladder's boss kills.
export const RUSH_TALENT_LADDER = { 1: 'ranged_stance', 2: 'magic_stance', 3: 'heavy_weapons' }

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
  announce(state, `Talent learned — ${def.name}!`)
  return true
}
