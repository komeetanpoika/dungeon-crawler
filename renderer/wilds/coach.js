// The coach line: a horse and cart in every village and in Kalevanlinna that
// takes the player along a road to a town at its other end. DOM-free: the
// stops are laid by the generator (features.js for a village, city/build.js
// for the city: piece.coach), session.js gathers them into the window
// (state.coachStops) and holds a stop the player arrives on (state.coachHold);
// this module has the rules. game.js shows the menu; the ride itself is
// coach-ride.js, along the way coach-path.js finds.
//
//   piece.coach       { x, y, town }   the boarding cell in piece tiles, and the town's key
//   state.coachStops  { x, y, town }[] the window's stops, in window tiles
//   state.coachHold   the latch: set when a stop boards, on arriving by coach and on
//                     waking on a stop; cleared once the player stands on no stop
//
// One league is one piece. A ride costs nothing; the day goes on during it as
// it does on foot.
import { roadsFrom, townOf, SIDE_WORDS } from './roads.js'
import { hear, getPiece } from './world.js'
import { PIECE, pieceOf } from './layout.js'
import { fromCity } from './city/geometry.js'
import { cityFor } from './city/build.js'
import { isVillageStreet } from './sites.js'
import { TILE } from '../systems/entities.js'
import { playerBound } from '../systems/player-bind.js'
import { isEnemy } from '../systems/factions.js'

// tiles from the player within which a hostile that has noticed them stops the coach
export const HOSTILE_REACH = 12
export const REFUSAL_LINES = Object.freeze({
  wanted: 'Not with the watch after you.',
  chased: 'Not with that at your heels.',
  bound: 'Sit up first.',
})

// The towns a ride from `townKey` goes to, one road each (roads.js roadsFrom):
// { town, side, leagues, route }. Listing a town is hearing of it (world.js
// hear: the map pencils it in); the caller saves.
export function destinations(world, townKey) {
  const list = roadsFrom(world.seed, townKey).map(r => Object.freeze({ town: r.town, side: r.side, leagues: r.leagues, route: r.route }))
  hear(world, list.map(d => d.town.key))
  return Object.freeze(list)
}

// A destination's button in the coach's menu: "Kalevanlinna, south, 2 leagues"
// ("1 league" for one).
export const coachLabel = d => `${d.town.name}, ${SIDE_WORDS[d.side].toLowerCase()}, ${d.leagues} league${d.leagues === 1 ? '' : 's'}`

// Why the coachman will not drive now, or null: the watch is after the player
// in Kalevanlinna; a living hostile that has noticed them is within
// HOSTILE_REACH tiles; or they are frozen, held, in the stocks, or on a
// mushroom trip (its climb, its fade, the rite and the pull to the ring).
export function refusal(state) {
  if (state.cityRun?.crime?.level === 'wanted') return 'wanted'
  const p = state.player
  for (const e of state.entities ?? []) {
    if (!isEnemy(e) || !(e.hp > 0) || !noticed(e)) continue
    if (Math.hypot(e.x - p.x, e.y - p.y) <= HOSTILE_REACH) return 'chased'
  }
  if (playerBound(p) || p.trance > 0 || p.tranceFade > 0 || state.rite || state.tripPull) return 'bound'
  return null
}
// A foe after the player: where the enemy brain keeps watch (systems/brain.js
// ai.mode), chasing them or hunting where it saw them last; a foe with no
// brain, in a fight with them. (inCombat is set by a blow and never cleared:
// a brain that has since lost the player knows better.)
const noticed = e => (typeof e.ai?.mode === 'string'
  ? e.ai.mode === 'chase' || (e.ai.mode === 'hunt' && !!e.ai.lastSeen)
  : e.inCombat === true)

// Once a frame on the surface: the stop the player has just stepped onto, or
// null. A stop is latched in state.coachHold until the player stands on no
// stop, so standing on one boards once, and arriving on one (a load, a wake)
// boards not at all until the player steps off and on again. Nothing boards
// from the top of the coach (state.coachRide).
export function tickCoach(state) {
  if (state.cave || !state.wilds || !state.coachStops || state.coachRide) return null
  const p = state.player
  const stop = state.coachStops.find(s => s.x === p.x && s.y === p.y)
  if (!stop) { state.coachHold = false; return null }
  if (state.coachHold) return null
  state.coachHold = true
  return { town: stop.town }
}

// The piece that holds a town's stop: the village's own, or the city piece
// with the stop (city/build.js puts it by the inn's cart).
function stopPiece(seed, townKey) {
  if (townKey === 'city') {
    const c = cityFor(seed).coach
    const { X, Y } = fromCity(c.x, c.y)
    return pieceOf(X, Y)
  }
  const town = townOf(seed, townKey)
  return town ? { wx: town.wx, wy: town.wy } : null
}

// The world tile of a town's boarding cell (piece.coach), or null.
export function boardingTile(world, townKey) {
  const at = stopPiece(world.seed, townKey)
  const c = at && getPiece(world, at.wx, at.wy).coach
  return c ? { X: at.wx * PIECE + c.x, Y: at.wy * PIECE + c.y } : null
}

const SIDE_STEPS = [[0, 1], [1, 0], [-1, 0], [0, -1]]
// a road's cell by its art: the road's ground, its planks over water, the cobbles or the sand paving it wears in a village
export const isRoadCell = cell => (cell.skin ?? '').startsWith('ow_road_') || isVillageStreet(cell.skin) || (cell.overlay ?? '').startsWith('ow_pier')
// The world tile to arrive on at a town's stop: a walkable cell beside the
// boarding cell, not under a roof, not a doorway and not where the coachman
// stands; the first by S, E, W, N from which the road is reached without
// crossing the stop (the player is not to board again to leave it; the
// generator makes sure there is one). Null if the town has no stop.
export function stopTile(world, townKey) {
  const at = stopPiece(world.seed, townKey)
  if (!at) return null
  const piece = getPiece(world, at.wx, at.wy)
  const c = piece.coach
  if (!c) return null
  const opening = (x, y) => [...piece.doors, ...piece.caves].some(d => d.x === x && d.y === y)
  const walk = (x, y) => {
    const cell = piece.cells[y]?.[x]
    return !!cell && cell.tile === TILE.FLOOR && !cell.over && !opening(x, y) && !(x === c.x && y === c.y)
  }
  const man = piece.spawns.find(s => s.coachman)
  const cells = SIDE_STEPS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(({ x, y }) => walk(x, y) && !(man && man.x === x && man.y === y))
  const leadsOn = from => {
    const seen = new Uint8Array(PIECE * PIECE), queue = [from]
    seen[from.y * PIECE + from.x] = 1
    for (let q = 0; q < queue.length; q++) {
      const { x, y } = queue[q]
      if (isRoadCell(piece.cells[y][x])) return true
      for (const [dx, dy] of SIDE_STEPS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen[ny * PIECE + nx] || !walk(nx, ny)) continue
        seen[ny * PIECE + nx] = 1; queue.push({ x: nx, y: ny })
      }
    }
    return false
  }
  const there = cells.find(leadsOn) ?? cells[0]
  return there ? { X: piece.wx * PIECE + there.x, Y: piece.wy * PIECE + there.y } : null
}

// Arrive by coach at `dest` (an entry of destinations): the player steps down
// beside the stop (stopTile; the window has come along with the coach, so it
// holds the stop), held off it; the town is visited and is where the player
// wakes after a death (what standing inside the walls sets, for the city).
// The caller saves.
export function arrive(state, world, dest) {
  const town = dest.town
  const at = stopTile(world, town.key)
  if (at) {
    const p = state.player
    p.x = at.X - world.origin.wx * PIECE; p.y = at.Y - world.origin.wy * PIECE
    p.px = p.x * 32 + 16; p.py = p.y * 32 + 16
    p._fovMap = null; p._fovLitMap = null
  }
  state.coachHold = true
  visit(world, town)
  return town
}

// A town reached: visited, and where the player wakes.
export function visit(world, town) {
  if (!world.visited.includes(town.key)) world.visited.push(town.key)
  world.lastVillage = wakeOf(town)
}
export const wakeOf = town => (town.key === 'city' ? { wx: 0, wy: 2 } : { wx: town.wx, wy: town.wy })

