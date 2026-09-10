// Adventure quests: the per-map story layer that rides systems/story.js.
// Deliberately thinner than systems/leap.js — a quest has no persona, no
// Echo, no missing villager and no effect on the waystone. Pure logic.
import { QUESTS } from '../data/quests.js'
import { storyFlags, makeCtx, poiCell, checkDeliveries } from './story.js'

// Re-exported so quest modules have one import site, exactly as the episode
// modules import theirs from leap.js.
export { poiCell, checkDeliveries }

// A leap map's story is its episode, never a quest — the two records must
// never both claim one map.
export function questFor(mapData) { return (mapData && !mapData.leap && QUESTS[mapData.name]) || null }

export function questFlags(save, mapName) { return storyFlags(save.quests, mapName) }

export function isQuestDone(save, mapData) {
  const q = questFor(mapData)
  return !!q && !!q.rule(questFlags(save, mapData.name))
}

// The village's lines for the story's current stage: first match wins, and a
// declaration's last stage is the catch-all. Returns the flat
// `{ species: [line] }` shape systems/npc.js already reads from
// state.villagerLines.
export function questLines(quest, flags) {
  return quest?.villagerLines?.find(s => s.when(flags))?.by ?? null
}

export function makeQuestCtx({ getState, save, mapData, persist, refreshInventory, spawn, onFlag }) {
  return makeCtx({ getState, save, record: save.quests, mapData, persist, refreshInventory, spawn, onFlag })
}
