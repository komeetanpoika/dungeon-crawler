// Learned abilities. Everything that unlocks a talent — rite, boss kill,
// dungeon clear, future NPC — funnels through grantTalent. Persistence is
// the caller's job (game.js persists for Adventure; Dungeon Rush never does).
// The stance talents (Marksmanship, Gust of Wind, Might) became outfits on
// 2026-09-17 — see systems/outfits.js. Ski-legs stays a talent.
import { queueToast } from './feedback.js'
import { sfx } from './sfx.js'

export const TALENTS = {
  ski_legs: { name: 'Ski-legs', desc: 'Sprinting costs far less stamina.' },
}
// Dungeon Rush: every talent from the first step (outfits too — see
// systems/outfits.js RUSH_START_OUTFITS). Assigned silently at spawn.
export const RUSH_START_TALENTS = Object.keys(TALENTS)

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
