// Adventure progression: twelve open maps chained by depth (see open-maps.js).
// A map's waystone leads onward only when every one of its dungeons has been
// finished — recorded here permanently, so the cave reset timer never
// re-locks a map and dying after a boss kill keeps the credit.
import { OPEN_MAPS } from '../data/open-maps.js'
import { ADVENTURE_DEPTH } from '../data/levels.js'
import { DAY_START } from '../data/weather.js'
import { WAND_TYPES, RANGED_WEAPON_TYPES, makeWandContents, makeRangedContents, emptyAmmo } from './entities.js'
import { itemFromContents } from './inventory.js'

// The traveling body's wands-and-bows redesign (Task 1): the ranged hand
// gains a `wand` sibling and ammo moves off the weapon into a shared
// `ammo` pool by kind. A pre-redesign body might still have `ranged` set to
// a wand (wands used to be ranged weapons) or a bow carrying its own
// `ammo`/`maxAmmo` — fold those into the new shape here rather than at every
// read site. Sack items follow the same rule for the wand case. Additive
// and idempotent: normalizing an already-current body is a no-op, and an
// unrecognised weaponType is dropped instead of crashing later.
export function normalizeBody(body) {
  if (body == null) return null
  const out = { ...body }
  out.wand ??= null
  out.ammo = { ...emptyAmmo(), ...(out.ammo ?? {}) }
  if (out.ranged) {
    const wt = out.ranged.weaponType
    if (WAND_TYPES[wt]) {
      out.wand = makeWandContents(wt)
      out.ranged = null
    } else if (RANGED_WEAPON_TYPES[wt]) {
      out.ammo[RANGED_WEAPON_TYPES[wt].ammoKind] += out.ranged.ammo ?? 0
      out.ranged = makeRangedContents(wt)
    } else {
      out.ranged = null   // unknown weapon type — drop rather than crash
    }
  }
  // Sack bows get the same treatment as the held one: a legacy payload kept
  // as-is would carry `ammo`/`maxAmmo` and no `ammoKind`, so equipping it
  // would leave tryFire reading player.ammo[undefined] forever. Rebuild the
  // payload from the table (via itemFromContents, the one place every pickup
  // is normalised) and bank the old on-weapon count into the pool once.
  out.inventory = (out.inventory ?? []).map(item => {
    if (item.kind !== 'ranged') return item
    const wt = item.payload?.weaponType
    if (WAND_TYPES[wt]) return itemFromContents(makeWandContents(wt))
    if (!RANGED_WEAPON_TYPES[wt]) return null   // unknown weapon type — drop
    out.ammo[RANGED_WEAPON_TYPES[wt].ammoKind] += item.payload.ammo ?? 0
    return itemFromContents(makeRangedContents(wt))
  }).filter(Boolean)
  return out
}

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

// The chain follows depth order but skips the leap maps — those belong to
// timewarp mode now; null past the last map or off the chain entirely.
export function nextMapDepth(depth) {
  const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b).filter(d => !OPEN_MAPS[d].leap)
  const i = depths.indexOf(Number(depth))
  return i >= 0 && i + 1 < depths.length ? depths[i + 1] : null
}

// Save-file shapes: v1 was the bare caves map ({mapName: {label: instance}});
// v2 added { caves, progress }; v3 adds learned talents and the traveling
// body (hands + sack); v4 adds npcs ({mapName: {dead, hostile}}) — wiped on
// player death; v5 adds felled ({mapName: ['x,y']}) — permanent, not wiped
// on death. v6 adds leaps ({mapName: {flags}}) and shifts pre-v6 mapDepth >= 8
// by +3 (three leap maps inserted at 8-10); save.v6 marks the shift done.
// v7 splits the modes: leap maps leave the adventure chain (a mapDepth of
// 8-10 moves to 11), progress.visited lists every map reached (seeded with
// the non-leap maps at or below mapDepth), and the leaps record is only kept
// for seeding the separate timewarp save.
// The weather clock (`clock`, seconds into the day) is additive with a default.
// Migration is additive — missing fields default.
export function normalizeAdventureSave(raw) {
  const base = (raw && typeof raw === 'object' && raw.progress) ? { ...raw }
    : (raw && typeof raw === 'object' && !raw.caves) ? { caves: raw, progress: freshProgress() }
    : { caves: {}, progress: freshProgress() }
  base.talents ??= []
  base.body = normalizeBody(base.body ?? null)
  base.gates ??= {}
  base.npcs ??= {}
  base.felled ??= {}
  base.leaps ??= {}
  base.clock ??= DAY_START   // seconds into the in-game day (systems/weather.js)
  if (!base.v6) {
    if (base.progress.mapDepth >= 8) base.progress.mapDepth += 3
    base.v6 = true
  }
  if (!base.v7) {
    if (base.progress.mapDepth >= 8 && base.progress.mapDepth <= 10) base.progress.mapDepth = 11
    base.v7 = true
  }
  base.progress.visited ??= Object.keys(OPEN_MAPS).map(Number)
    .filter(d => !OPEN_MAPS[d].leap && d <= base.progress.mapDepth)
    .sort((a, b) => a - b)
    .map(d => OPEN_MAPS[d].name)
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

export function recordVisit(progress, mapName) {
  progress.visited ??= []
  if (!progress.visited.includes(mapName)) progress.visited.push(mapName)
}

// The waystone's destination list: every visited (non-leap) map in depth
// order, plus the next chain map once the frontier — the deepest visited
// map — has all its dungeons finished. The gate rides on the frontier only;
// visited maps are always hoppable.
export function waystoneDestinations(save) {
  const visited = save.progress.visited ?? []
  const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b)
    .filter(d => !OPEN_MAPS[d].leap && visited.includes(OPEN_MAPS[d].name))
  const frontier = depths[depths.length - 1]
  const next = frontier != null ? nextMapDepth(frontier) : null
  if (next !== null && isMapComplete(save.progress, OPEN_MAPS[frontier])) depths.push(next)
  return depths.map(d => ({ depth: d, title: OPEN_MAPS[d].title }))
}
