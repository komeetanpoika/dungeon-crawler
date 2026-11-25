// Kalevanlinna laid as game cells: the whole 160 x 160 city built once per
// world (a pure function of the seed) and kept, so each of its four pieces
// can take its quarter (piece.js). In city tiles throughout:
//
//   City = { seed, cells: Cell[160][160], doors, signs, lamps: {x,y}[],
//            chimneys: { x, y, door }[], windows: { x, y, door }[],
//            spots: { [id]: { x, y } }, inn: { door, doorstep, cart }, spawns,
//            yards: { x0, y0, x1, y1 }[] (the back yards and courtyards),
//            coach: { x, y } (the coach stop: wilds/coach.js),
//            streets: the street graph (streets.js) }
//
// A Cell is piece.js cellOf(ground, prop, walkable) with `deco` where a sign
// or a banner hangs over another tile, and `ward: true` on every walkable
// cell inside the walls (the gate arches included): enemies keep out.
// `over: true` marks a cell whose art is drawn over whoever stands there.
// A door's and a chimney's `door` is the door's label.
import { cellOf } from '../piece.js'
import { openTops } from '../over.js'
import { insideWalls } from './plan.js'
import { makeGrid, makeRecord, stoneUnderMasonry } from './stamps.js'
import { terrainUnder, layTerrain, layOutskirts, layRoads, clearRound, layFarms, finishLand } from './build-land.js'
import { layFixed, layDressing } from './build-fixed.js'
import { layBlocks } from './build-blocks.js'
import { buildStreetGraph } from './streets.js'
import { APPROACHES } from './build-land.js'
import { PROPS } from './kit.js'
import { TILE } from '../../systems/entities.js'

const N = 160

export function buildCity(seed) {
  const land = terrainUnder(seed)
  const G = makeGrid()
  const rec = makeRecord()
  layTerrain(G, land)
  layOutskirts(G, land)
  layFixed(G, rec)
  layBlocks(G, rec, seed)
  layDressing(G, rec)
  layRoads(G, land, rec)
  clearRound(G)
  layFarms(G, land, rec)
  finishLand(G, land)
  stoneUnderMasonry(G)

  const cells = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const c = cellOf(G.ground(x, y), G.prop(x, y), G.walkable(x, y))
    const deco = G.decoAt(x, y)
    if (deco) c.deco = deco
    if (G.walkable(x, y) && insideWalls(x, y)) c.ward = true
    return c
  }))
  // the top row of every building and wall, and the gate arches, are walked
  // under (over.js); inside the walls, and where the way under is from
  // inside (the south wall's walk), they are warded like any street
  openTops(cells, { ward: (x, y) => insideWalls(x, y) || !!cells[y - 1][x].ward })
  const coach = layCityStop(cells, rec.inn.cart, rec.doors)
  const city = {
    seed, cells, doors: rec.doors, signs: rec.signs, lamps: rec.lamps, chimneys: rec.chimneys, windows: rec.windows,
    spots: rec.spots, inn: rec.inn, spawns: rec.spawns, yards: rec.yards, coach,
  }
  city.streets = buildStreetGraph(city)
  cache = city
  return city
}

// ---- the coach stop (wilds/coach.js) ------------------------------------------------
// A trigger on a cell already walkable beside the inn's cart (build-fixed.js):
// south of the horse, then south of the cart, north of each, west of the horse,
// east of the cart; one that has a walkable cell beside it to arrive on, not
// under a roof and not a doorway. Null if there is none.
const STEPS = [[0, 1], [1, 0], [-1, 0], [0, -1]]
export function coachStopOf(cells, cart, doors = []) {
  const ok = (x, y) => { const c = cells[y]?.[x]; return !!c && c.tile === TILE.FLOOR && !c.over && !doors.some(d => d.x === x && d.y === y) }
  const around = [[cart.x, cart.y + 1], [cart.x + 1, cart.y + 1], [cart.x, cart.y - 1], [cart.x + 1, cart.y - 1], [cart.x - 1, cart.y], [cart.x + 2, cart.y]]
  for (const [x, y] of around) if (ok(x, y) && STEPS.some(([dx, dy]) => ok(x + dx, y + dy))) return { x, y }
  return null
}
// The stop: beside the inn's cart, or where that has no room, on the north
// gate's approach outside the walls: a horse and cart of its own laid east of
// the approach road (APPROACHES.N), the stop north of the horse, beside the
// approach and the ring road. Returns the stop.
export function layCityStop(cells, cart, doors = []) {
  const stop = coachStopOf(cells, cart, doors)
  if (stop) return stop
  const [, y0, x1] = APPROACHES.N
  const at = { x: x1 + 1, y: y0 + 1 }
  PROPS.cart.forEach((skin, i) => { cells[at.y][at.x + i] = cellOf(cells[at.y][at.x + i].skin, skin, false) })
  cells[y0][at.x] = cellOf(cells[y0][at.x].skin, null, true)
  return { x: at.x, y: y0 }
}

// The city of a world, built the first time it is asked for. One is kept:
// a game has one world at a time.
let cache = null
export function cityFor(seed) {
  return cache?.seed === seed ? cache : buildCity(seed)
}
