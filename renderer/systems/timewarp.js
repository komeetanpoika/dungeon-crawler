// Timewarp mode's save: one record per leap episode, each carrying an
// adventure-shaped mini-save scoped to that single map — so every helper
// that reads a save (leap flags, cave instances, npc records, felled trees,
// cleared dungeons, the traveling body) works unchanged against it.
// Fully independent of the adventure save by design.
import { OPEN_MAPS } from '../data/open-maps.js'
import { EPISODES } from '../data/leaps.js'
import { normalizeAdventureSave } from './adventure.js'
import { isResolved } from './leap.js'

export function leapDepths() {
  return Object.keys(OPEN_MAPS).map(Number).filter(d => OPEN_MAPS[d].leap).sort((a, b) => a - b)
}

function freshEpisodeSave(depth) {
  const s = normalizeAdventureSave(null)
  s.progress.mapDepth = depth
  return s
}

// legacyLeaps/legacyNpcs: the pre-split adventure save's records, used once
// to seed episodes so pre-v7 progress isn't lost. resolved is derived with
// the episode's real rule (fold's needs the npc record for wolvesAlive).
export function normalizeTimewarpSave(raw, legacyLeaps = null, legacyNpcs = null) {
  if (raw && typeof raw === 'object' && raw.episodes) return { episodes: { ...raw.episodes } }
  const tw = { episodes: {} }
  for (const depth of leapDepths()) {
    const name = OPEN_MAPS[depth].name
    const flags = legacyLeaps?.[name]?.flags
    if (!flags || Object.keys(flags).length === 0) continue
    const rec = enterEpisode(tw, depth)
    rec.save.leaps[name] = { flags: { ...flags } }
    if (legacyNpcs?.[name]) rec.save.npcs[name] = { dead: [...legacyNpcs[name].dead], hostile: !!legacyNpcs[name].hostile }
    rec.resolved = isResolved(rec.save, OPEN_MAPS[depth])
  }
  return tw
}

// Get-or-create the record for the episode at `depth`. A resolved episode
// re-enters fresh — replay from the top, only the checkmark survives.
export function enterEpisode(tw, depth) {
  const name = OPEN_MAPS[depth].name
  const rec = tw.episodes[name] ??= { resolved: false, save: freshEpisodeSave(depth) }
  if (rec.resolved) rec.save = freshEpisodeSave(depth)
  return rec
}

export function episodeEntries(tw) {
  return leapDepths().map(d => {
    const name = OPEN_MAPS[d].name
    return { depth: d, title: OPEN_MAPS[d].title, persona: EPISODES[name]?.persona, resolved: !!tw.episodes[name]?.resolved }
  })
}
