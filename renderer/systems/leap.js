// Leap episodes: per-map story flags, the runestone's unlock rule, the Echo's
// line choice and the missing person's return. Pure — game.js and the
// episode modules (systems/episodes/*) do the world mutation.
import { EPISODES } from '../data/leaps.js'
import { isMapComplete } from './adventure.js'
import { npcSpawnIndex } from './openmap.js'
import { isNight } from './weather.js'
import { DAY_START } from '../data/weather.js'
import { storyFlags, setStoryFlag, makeCtx, poiCell, checkDeliveries } from './story.js'

// Re-exported so the episode modules and their tests keep importing these
// from leap.js — the engine moved, the episode-facing surface did not.
export { poiCell, checkDeliveries }

export function episodeFor(mapData) { return (mapData?.leap && EPISODES[mapData.name]) || null }

export function leapFlags(save, mapName) { return storyFlags(save.leaps, mapName) }

export function setFlag(save, mapName, flag, value = true) { setStoryFlag(save.leaps, mapName, flag, value) }

// Declared wolves whose spawn id is not in the dead record — wherever they
// are declared. The fold homes its wolves at the den (npcs.at), so the ids
// come from openmap.js's own roster rather than an offset recomputed here.
export function wolvesAlive(save, mapData) {
  const dead = new Set(save.npcs?.[mapData.name]?.dead ?? [])
  return npcSpawnIndex(mapData).filter(e => e.species === 'wolf' && !dead.has(`npc:${mapData.name}:${e.i}`)).length
}

export const ruleCtx = (save, mapData) => ({ wolvesAlive: wolvesAlive(save, mapData), night: isNight(save.clock ?? DAY_START) })

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
// walkable cell by expanding rings (never the POI itself, which is usually
// art). `role: 'missing'` is what tells the renderer to give them their own
// face instead of the id-rotated village one — the person who came back
// should not look like one of the neighbours.
export function missingSpawn(mapData) {
  const ep = episodeFor(mapData)
  const v = poiCell(mapData, 'village') ?? mapData.playerSpawn
  const at = (x, y) => ({ kind: 'npc', species: ep.missing.species, id: `npc:${mapData.name}:missing`, role: 'missing', x, y, hostile: false })
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = v.x + dx, y = v.y + dy
    if (mapData.walk[y]?.[x] === '1') return at(x, y)
  }
  return at(mapData.playerSpawn.x, mapData.playerSpawn.y)
}

// One Echo per leap map, spawned on the player's arrival cell; it follows
// from there (systems/echo.js). Non-leap maps get none.
export function echoSpawns(mapData, at) {
  return episodeFor(mapData) ? [{ kind: 'echo', x: at.x, y: at.y }] : []
}

// The per-map episode ctx. Everything but `episode` comes from the shared
// engine (systems/story.js); the leap record is the sub-record it writes.
export function makeEpCtx({ getState, save, mapData, persist, resolve, refreshInventory, spawn }) {
  return makeCtx({
    getState, save, record: save.leaps, mapData,
    persist, resolve, refreshInventory, spawn,
    extra: { episode: episodeFor(mapData) },
  })
}
