// Kalevanlinna laid as game cells: the whole 160 x 160 city built once per
// world (a pure function of the seed) and kept, so each of its four pieces
// can take its quarter (piece.js). In city tiles throughout:
//
//   City = { seed, cells: Cell[160][160], doors, signs, lamps: {x,y}[],
//            chimneys: { x, y, door }[], windows: { x, y, door }[],
//            spots: { [id]: { x, y } }, inn: { door, doorstep }, spawns }
//
// A Cell is piece.js cellOf(ground, prop, walkable) with `deco` where a sign
// or a banner hangs over another tile, and `ward: true` on every walkable
// cell inside the walls (the gate arches included): enemies keep out.
// A door's and a chimney's `door` is the door's label.
import { cellOf } from '../piece.js'
import { insideWalls } from './plan.js'
import { makeGrid, makeRecord } from './stamps.js'
import { terrainUnder, layTerrain, layOutskirts, layRoads, clearRound, layFarms, finishLand } from './build-land.js'
import { layFixed, layDressing } from './build-fixed.js'
import { layBlocks } from './build-blocks.js'

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

  const cells = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const c = cellOf(G.ground(x, y), G.prop(x, y), G.walkable(x, y))
    const deco = G.decoAt(x, y)
    if (deco) c.deco = deco
    if (G.walkable(x, y) && insideWalls(x, y)) c.ward = true
    return c
  }))
  const city = {
    seed, cells, doors: rec.doors, signs: rec.signs, lamps: rec.lamps, chimneys: rec.chimneys, windows: rec.windows,
    spots: rec.spots, inn: rec.inn, spawns: rec.spawns,
  }
  cache = city
  return city
}

// The city of a world, built the first time it is asked for. One is kept:
// a game has one world at a time.
let cache = null
export function cityFor(seed) {
  return cache?.seed === seed ? cache : buildCity(seed)
}
