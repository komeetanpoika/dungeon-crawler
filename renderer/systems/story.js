// The map-agnostic half of the story engine: per-map story flags kept on a
// save sub-record, POI lookup, the module ctx and the delivery check. Both
// the leap episodes (systems/leap.js, save.leaps) and the Adventure quests
// (systems/quests.js, save.quests) ride this, so neither owns it. Pure — no
// browser/Electron imports.
import { removeItem } from './inventory.js'

export function storyFlags(record, mapName) {
  const rec = record[mapName] ??= { flags: {} }
  return rec.flags
}

export function setStoryFlag(record, mapName, flag, value = true) {
  storyFlags(record, mapName)[flag] = value
}

export function poiCell(mapData, label) {
  const p = mapData.pois.find(q => q.label === label)
  return p ? { x: p.x, y: p.y } : null
}

// The per-map ctx handed to a module's onArrive/tick. `state` is a live
// getter (not a captured value) so it always reflects the current
// module-level state object even after game.js swaps it wholesale on a cave
// dive/return (buildCaveState / restoreSurface) — a captured reference would
// go stale the moment `state` is reassigned, silently mutating a stashed
// surface object underground and reading a stale player afterward.
//
// `extra` carries the caller's own ctx fields (the episode ctx's `episode`)
// and is spread last. It must be a plain object: spreading an already-built
// ctx would evaluate the `state` getter once and freeze it, which is the
// exact bug the getter exists to prevent.
//
// `onFlag` fires after every `set`. The quest layer uses it to restage the
// villagers' lines, which is why `set` is the only sanctioned flag write.
export function makeCtx({ getState, save, record, mapData, extra = {},
                          persist, resolve, refreshInventory, spawn, onFlag }) {
  return {
    get state() { return getState() },
    save, mapData, flags: storyFlags(record, mapData.name),
    set: (f, v = true) => { setStoryFlag(record, mapData.name, f, v); onFlag?.(f, v) },
    persist, resolve, refreshInventory, spawn,
    ...extra,
  }
}

const carries = (player, kind) => player.inventory.findIndex(i => i.kind === kind)
const onCell = (player, c) => c && player.x === c.x && player.y === c.y
const besideNpc = (entities, player, species) => entities.some(e => e.type === 'npc' && e.species === species && !e.hostile
  && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1)

// One delivery per call: the first whose item is carried and whose target the
// player stands on (POI) or beside (NPC of the species). Removes one item,
// sets the flag, returns the delivery for the caller to cue.
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
