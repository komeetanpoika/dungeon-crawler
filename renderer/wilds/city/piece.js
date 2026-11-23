// One of Kalevanlinna's four pieces, ready for the game: its quarter of the
// city (build.js), in the shape generatePiece returns. The city is never
// re-dealt (deal 0) and nothing hostile is dealt into it; its edge crossings
// are the ones the neighbours lay (gateAt), and the townsfolk come later from
// a runtime of their own. Only farm animals in the outskirts are spawns.
import { cityFor } from './build.js'
import { CITY } from './geometry.js'
import { PIECE, pieceKey, tierAt, pieceBiome, lootDepthFor, gateAt } from '../layout.js'
import { TILE } from '../../systems/entities.js'

// A street cell to arrive on in each piece but the inn's (city tiles).
const ARRIVE = { '1,2': { x: 110, y: 66 }, '0,3': { x: 79, y: 95 }, '1,3': { x: 96, y: 110 } }

export function generateCityPiece(seed, wx, wy) {
  const city = cityFor(seed)
  const key = pieceKey(wx, wy)
  const ox = (wx - CITY.wx0) * PIECE, oy = (wy - CITY.wy0) * PIECE
  const mine = p => p.x >= ox && p.x < ox + PIECE && p.y >= oy && p.y < oy + PIECE
  const local = p => ({ ...p, x: p.x - ox, y: p.y - oy })
  const cells = new Array(PIECE)
  for (let y = 0; y < PIECE; y++) {
    const src = city.cells[y + oy], row = cells[y] = new Array(PIECE)
    for (let x = 0; x < PIECE; x++) row[x] = { ...src[x + ox] }
  }
  const walk = p => cells[p.y]?.[p.x]?.tile === TILE.FLOOR
  let village = null, spawnPoint
  if (mine(city.inn.doorstep)) {
    spawnPoint = local(city.inn.doorstep)
    village = { name: CITY.name, x: spawnPoint.x, y: spawnPoint.y, city: true }
  } else {
    const at = local(ARRIVE[key])
    spawnPoint = walk(at) ? at : nearestWalkable(cells, at)
  }
  const gate = side => gateAt(seed, wx, wy, side)
  return {
    key, wx, wy, deal: 0, tier: tierAt(wx, wy), biome: pieceBiome(seed, wx, wy), city: true,
    main: { kind: 'city', x: spawnPoint.x, y: spawnPoint.y },
    small: [], packs: [], tale: null, points: [], villageTale: null, villagePoints: [],
    cells,
    spawns: city.spawns.filter(mine).map(local),
    caves: [],
    doors: city.doors.filter(mine).map(local),
    signs: city.signs.filter(mine).map(local),
    village, spawnPoint,
    gates: { N: { x: gate('N'), y: 0 }, E: { x: PIECE - 1, y: gate('E') }, S: { x: gate('S'), y: PIECE - 1 }, W: { x: 0, y: gate('W') } },
    lootDepth: lootDepthFor(tierAt(wx, wy)),
  }
}

function nearestWalkable(cells, at) {
  for (let r = 1; r < PIECE; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    if (cells[at.y + dy]?.[at.x + dx]?.tile === TILE.FLOOR) return { x: at.x + dx, y: at.y + dy }
  }
  return at
}
