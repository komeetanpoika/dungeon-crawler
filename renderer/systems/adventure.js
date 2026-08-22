// Adventure progression: nine open maps chained by depth (see open-maps.js).
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
// body (hands + sack). Migration is additive — missing fields default.
export function normalizeAdventureSave(raw) {
  const base = (raw && typeof raw === 'object' && raw.progress) ? { ...raw }
    : (raw && typeof raw === 'object' && !raw.caves) ? { caves: raw, progress: freshProgress() }
    : { caves: {}, progress: freshProgress() }
  base.talents ??= []
  base.body ??= null
  return base
}
