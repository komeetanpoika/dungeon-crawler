// A building of several floors joined by stairs. Pure: no DOM, no clock, no
// rng. A floor is a map with its own entities; the floors the player is not
// on keep theirs here, in the building, which lives on `state.cave.building`
// and is never saved (a save reads the surface state, a wake or a load
// rebuilds the state without `cave`).
import { isWalkable } from '../systems/entities.js'

const TILE_SIZE = 32
const LAND_RADIUS = 3

// floors: [{ id, map, entities, stairs, shut, spawn?, exit? }]
export function makeBuilding(floors, ground) {
  const byId = new Map()
  for (const f of floors) byId.set(f.id, { ...f, stairs: f.stairs ?? [], shut: f.shut ?? [] })
  return { floors: byId, ground, at: ground }
}

const here = building => building?.floors.get(building.at) ?? null

export function stairAt(building, x, y) {
  return here(building)?.stairs.find(s => s.x === x && s.y === y) ?? null
}

export function shutAt(building, x, y) {
  return here(building)?.shut.find(s => s.x === x && s.y === y) ?? null
}

// The guard's line while a living entity with the guard's id is on the floor.
// `entities` is the live list of the floor the player stands on (the game
// reassigns state.entities all the time, so the stored list is stale there).
export function blockedBy(building, stair, entities) {
  if (!stair?.guard) return null
  const alive = entities.some(e => e.id === stair.guard && (e.hp === undefined || e.hp > 0))
  return alive ? (stair.line ?? '') : null
}

const holdsLiving = (entities, x, y) =>
  entities.some(e => e.type !== 'echo' && e.x === x && e.y === y && (e.hp === undefined || e.hp > 0))

// The landing cell, or the nearest free walkable cell by rings up to 3 cells
// out (never a stair or a shut cell): a living thing on the landing must not
// have the player arrive inside it, nor on the stair that would carry them
// straight back.
function landingFor(floor, land) {
  const free = (x, y) => {
    const cell = floor.map[y]?.[x]
    if (!cell || !isWalkable(cell.tile, cell)) return false
    if (floor.stairs.some(s => s.x === x && s.y === y) || floor.shut.some(s => s.x === x && s.y === y)) return false
    return !holdsLiving(floor.entities, x, y)
  }
  for (let r = 0; r <= LAND_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (free(land.x + dx, land.y + dy)) return { x: land.x + dx, y: land.y + dy }
      }
    }
  }
  return { x: land.x, y: land.y }
}

export function travel(state, stair) {
  const building = state.cave.building
  const from = here(building)
  from.map = state.map
  from.entities = state.entities
  const to = building.floors.get(stair.to.floor)
  const arrival = to?.stairs.find(s => s.id === stair.to.stair)
  if (!arrival) throw new Error(`stair ${stair.id} leads to a missing floor or stair: ${stair.to.floor}/${stair.to.stair}`)
  building.at = to.id
  const at = landingFor(to, arrival.land)
  const onGround = to.id === building.ground
  const out = onGround ? (to.exit ?? to.spawn ?? { x: -1, y: -1 }) : { x: -1, y: -1 }
  const spawn = onGround ? (to.spawn ?? out) : { x: -1, y: -1 }
  return {
    ...state,
    map: to.map,
    entities: to.entities,
    projectiles: [], zones: [], fireZones: [], lightning: [], strikes: [], shockwaves: [], hitEffects: [],
    player: { ...state.player, x: at.x, y: at.y, px: at.x * TILE_SIZE + TILE_SIZE / 2, py: at.y * TILE_SIZE + TILE_SIZE / 2 },
    cave: { ...state.cave, stairs: { x: out.x, y: out.y }, spawn: { x: spawn.x, y: spawn.y }, offStairs: false, stairHold: true },
  }
}
