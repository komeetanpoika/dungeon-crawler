// Leap episodes: per-map story flags, the runestone's unlock rule, the Echo's
// line choice and the missing person's return. Pure — game.js and the
// episode modules (systems/episodes/*) do the world mutation.
import { EPISODES } from '../data/leaps.js'
import { isMapComplete } from './adventure.js'

export function episodeFor(mapData) { return (mapData?.leap && EPISODES[mapData.name]) || null }

export function leapFlags(save, mapName) {
  const rec = save.leaps[mapName] ??= { flags: {} }
  return rec.flags
}

export function setFlag(save, mapName, flag, value = true) { leapFlags(save, mapName)[flag] = value }

export function poiCell(mapData, label) {
  const p = mapData.pois.find(q => q.label === label)
  return p ? { x: p.x, y: p.y } : null
}

// Declared wild wolves whose spawn id is not in the dead record. Ids index
// the concatenated village+wild list (openmap.js npcSpawnsForMap).
export function wolvesAlive(save, mapData) {
  const village = mapData.npcs?.village?.length ?? 0
  const dead = new Set(save.npcs?.[mapData.name]?.dead ?? [])
  return (mapData.npcs?.wild ?? []).filter((sp, i) => sp === 'wolf' && !dead.has(`npc:${mapData.name}:${village + i}`)).length
}

export const ruleCtx = (save, mapData) => ({ wolvesAlive: wolvesAlive(save, mapData) })

export function isResolved(save, mapData) {
  const ep = episodeFor(mapData)
  return !!ep && !!ep.rule(leapFlags(save, mapData.name), ruleCtx(save, mapData))
}

export function isMapUnlocked(save, mapData) {
  return episodeFor(mapData) ? isResolved(save, mapData) : isMapComplete(save.progress, mapData)
}

export function echoLine(episode, spotIndex, flags, ctx) {
  const spot = episode?.echoSpots?.[spotIndex]
  if (!spot) return null
  return spot.lines.find(l => l.when(flags, ctx))?.text ?? null
}

// The returned local: a villager beside the village POI, on the nearest
// walkable cell by expanding rings (never the POI itself, which is usually art).
export function missingSpawn(mapData) {
  const ep = episodeFor(mapData)
  const v = poiCell(mapData, 'village') ?? mapData.playerSpawn
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = v.x + dx, y = v.y + dy
    if (mapData.walk[y]?.[x] === '1') return { kind: 'npc', species: ep.missing.species, id: `npc:${mapData.name}:missing`, x, y, hostile: false }
  }
  return { kind: 'npc', species: ep.missing.species, id: `npc:${mapData.name}:missing`, x: mapData.playerSpawn.x, y: mapData.playerSpawn.y, hostile: false }
}
