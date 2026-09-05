// Ground zones: patches of ground a spell leaves behind (today only the
// Bramble Wand's thorns). Pure logic — game.js ticks them next to the
// fireball's fire zones and owns the drawing; damage goes out through an
// injected hurt hook so this module never reaches into game.js's entity
// bookkeeping. state.fireZones stays its own thing (see systems/fire.js).
import { isWalkable } from './entities.js'
import { isStoryCreature } from './monsters.js'
import { applyRoot } from './status.js'

const TILE_SIZE = 32
const TICK_INTERVAL = 1.0     // seconds between dps ticks, like fire zones

// Thorns only take hold on ground something could walk on: walls, columns
// and void cells stay clear, so a patch thrown at a wall is simply smaller.
export function makeBrambleZone(map, cx, cy, radius, dur, root, dps) {
  const tiles = []
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const cell = map?.[y]?.[x]
      if (cell && isWalkable(cell.tile, cell)) tiles.push({ x, y })
    }
  }
  return { kind: 'bramble', tiles, age: 0, dur, root, dps, tickT: 0, inside: new Set() }
}

// Zones track who is standing in them by entity id so the root fires once on
// entry rather than every frame (which would pin an enemy forever). Entities
// spawned without an id get one here — cheap, and only zone code reads it.
let nextId = 1
const idOf = e => (e.id ??= `zt${nextId++}`)

const affected = e =>
  e.hp > 0 && e.type !== 'player' && e.px !== undefined && !isStoryCreature(e)

const tileOf = e => ({ x: Math.floor(e.px / TILE_SIZE), y: Math.floor(e.py / TILE_SIZE) })

// Advance every zone by `delta`: root what just walked in, bleed dps once a
// second into whatever is still standing there, and drop patches past their
// duration. Returns the surviving zones (also written back to state.zones).
export function tickZones(state, delta, hooks = {}) {
  const zones = state.zones ?? []
  if (!zones.length) return zones
  const enemies = (state.entities ?? []).filter(affected)
  const live = []
  for (const zone of zones) {
    zone.age += delta
    zone.tickT += delta
    const keys = new Set(zone.tiles.map(t => `${t.x},${t.y}`))
    const standing = enemies.filter(e => {
      const t = tileOf(e)
      return keys.has(`${t.x},${t.y}`)
    })
    const here = new Set()
    for (const e of standing) {
      const id = idOf(e)
      here.add(id)
      // Entry only; and never shorten a longer root already running.
      if (!zone.inside.has(id) && !((e.rootTimer ?? 0) > zone.root)) applyRoot(e, zone.root)
    }
    zone.inside = here
    while (zone.tickT >= TICK_INTERVAL) {
      zone.tickT -= TICK_INTERVAL
      if (zone.dps > 0) for (const e of standing) hooks.hurt?.(e, zone.dps)
    }
    if (zone.age < zone.dur) live.push(zone)
  }
  state.zones = live
  return live
}
