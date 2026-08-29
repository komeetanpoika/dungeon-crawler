// Leap episodes: per-map story flags, the runestone's unlock rule, the Echo's
// line choice and the missing person's return. Pure — game.js and the
// episode modules (systems/episodes/*) do the world mutation.
import { EPISODES } from '../data/leaps.js'
import { isMapComplete } from './adventure.js'
import { removeItem } from './inventory.js'

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

// One Echo per declared spot, standing on the POI cell it speaks from. A spot
// whose POI the map doesn't actually declare is silently dropped (poiCell(...)
// -> null), matching the "every echo spot names a POI the map declares" rule.
export function echoSpawns(mapData) {
  const ep = episodeFor(mapData)
  return (ep?.echoSpots ?? []).map((s, i) => ({ ...poiCell(mapData, s.fromPoi), kind: 'echo', spot: i }))
    .filter(s => Number.isFinite(s.x)).map(({ kind, x, y, spot }) => ({ kind, x, y, spot }))
}

export function echoAdjacent(entities, player) {
  return entities.find(e => e.type === 'echo' && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1) ?? null
}

// The per-map episode ctx handed to onArrive/tick. `state` is a live getter
// (not a captured value) so it always reflects the current module-level
// state object even after game.js swaps it wholesale on a cave dive/return
// (buildCaveState / restoreSurface) — a captured reference would go stale
// the moment `state` is reassigned, silently mutating a stashed surface
// object underground and reading a stale player afterward.
export function makeEpCtx({ getState, save, mapData, persist, resolve, refreshInventory, spawn }) {
  return {
    get state() { return getState() },
    save, mapData, episode: episodeFor(mapData), flags: leapFlags(save, mapData.name),
    set: (f, v = true) => setFlag(save, mapData.name, f, v),
    persist, resolve, refreshInventory, spawn,
  }
}

const carries = (player, kind) => player.inventory.findIndex(i => i.kind === kind)
const onCell = (player, c) => c && player.x === c.x && player.y === c.y
const besideNpc = (entities, player, species) => entities.some(e => e.type === 'npc' && e.species === species && !e.hostile
  && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1)

// One delivery per call: the first whose item is carried and whose target the
// player stands on (POI) or beside (NPC of the species). Removes one item,
// sets the flag, returns the delivery for game.js to cue and drop `gives`.
export function checkDeliveries(ctx, deliveries) {
  const { state, mapData, flags } = ctx
  for (const d of deliveries) {
    if (flags[d.sets]) continue
    const i = carries(state.player, d.item)
    if (i === -1) continue
    const here = d.to.poi ? onCell(state.player, poiCell(mapData, d.to.poi)) : besideNpc(state.entities, state.player, d.to.species)
    if (!here) continue
    removeItem(state.player, i)
    ctx.set(d.sets)
    return d
  }
  return null
}
