// Adventure progression: twelve open maps chained by depth (see open-maps.js).
// A map's waystone leads onward only when every one of its dungeons has been
// finished — recorded here permanently, so the cave reset timer never
// re-locks a map and dying after a boss kill keeps the credit.
import { OPEN_MAPS } from '../data/open-maps.js'
import { ADVENTURE_DEPTH } from '../data/levels.js'

export function dungeonLabels(mapData) {
  return [...new Set(mapData.pois.filter(p => p.kind === 'dungeon_entrance').map(p => p.label))]
}

export function freshProgress() {
  return { mapDepth: ADVENTURE_DEPTH, cleared: {} }
}

// Record a finished dungeon; duplicates are ignored.
export function markCleared(progress, mapName, label) {
  const list = progress.cleared[mapName] ??= []
  if (!list.includes(label)) list.push(label)
}

export function isMapComplete(progress, mapData) {
  const done = progress.cleared[mapData.name] ?? []
  return dungeonLabels(mapData).every(l => done.includes(l))
}

// The chain follows depth order; null past the last map.
export function nextMapDepth(depth) {
  const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b)
  const i = depths.indexOf(Number(depth))
  return i >= 0 && i + 1 < depths.length ? depths[i + 1] : null
}

// Save-file shapes: v1 was the bare caves map ({mapName: {label: instance}});
// v2 added { caves, progress }; v3 adds learned talents and the traveling
// body (hands + sack); v4 adds npcs ({mapName: {dead, hostile}}) — wiped on
// player death; v5 adds felled ({mapName: ['x,y']}) — permanent, not wiped
// on death. v6 adds leaps ({mapName: {flags}}) and shifts pre-v6 mapDepth >= 8
// by +3 (three leap maps inserted at 8-10); save.v6 marks the shift done.
// Migration is additive — missing fields default.
export function normalizeAdventureSave(raw) {
  const base = (raw && typeof raw === 'object' && raw.progress) ? { ...raw }
    : (raw && typeof raw === 'object' && !raw.caves) ? { caves: raw, progress: freshProgress() }
    : { caves: {}, progress: freshProgress() }
  base.talents ??= []
  base.body ??= null
  base.gates ??= {}
  base.npcs ??= {}
  base.felled ??= {}
  base.leaps ??= {}
  if (!base.v6) {
    if (base.progress.mapDepth >= 8) base.progress.mapDepth += 3
    base.v6 = true
  }
  return base
}

export function npcRecordFor(save, mapName) {
  const r = save.npcs?.[mapName]
  return { dead: [...(r?.dead ?? [])], hostile: !!r?.hostile }
}

// dead = every declared spawn id with no living npc entity behind it.
export function recordNpcState(save, mapName, spawnIds, entities, wrath) {
  const alive = new Set(entities.filter(e => e.type === 'npc').map(e => e.id))
  save.npcs[mapName] = { dead: spawnIds.filter(id => !alive.has(id)), hostile: !!wrath }
}

// Groundhog Day: the player's death forgets every map's dead and wrath.
export function resetNpcs(save) {
  save.npcs = {}
}
