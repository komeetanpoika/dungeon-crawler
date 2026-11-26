// One Wilds piece, ready for the game: terrain plus features, as game cells
// and spawn lists. A pure function of (seed, wx, wy, deal).
import { PIECE, pieceKey, tierAt, pieceBiome, lootDepthFor } from './layout.js'
import { makeTerrain } from './terrain.js'
import { placeFeatures } from './features.js'
import { TILE } from '../systems/entities.js'
import { LOS_CLEAR_PREFIXES, LOS_SOFT_PREFIXES, LOS_TALL_PREFIXES } from '../systems/openmap.js'
import { openTops } from './over.js'
import { pieceClass } from './roads.js'
import { DUNE_PREFIX, BEACON_PREFIX } from './desert.js'

const startsWithAny = (s, prefixes) => prefixes.some(p => s.startsWith(p))
// Low things a sight line passes over, like open water: the site dressing
// of sites.js. Kept here, not in openmap.js, so the hand-made maps see as before.
const LOW_PREFIXES = ['ow_prop_', 'ow_fence_', 'ow_lily_']

// The same cell the hand-made open maps use (systems/openmap.js): ground art
// as the skin, anything standing on it as the overlay, and for a blocking
// cell the sight class of whatever blocks. A walkable dune crest blocks sight
// to what lies behind it (`losDune`); a landmark is seen over crests and from
// afar (`losBeacon`): systems/entities.js hasLineOfSight.
export function cellOf(ground, prop, walkable) {
  const c = { tile: walkable ? TILE.FLOOR : TILE.WALL, dirty: true, roomId: null, visible: false, explored: false, skin: ground, locked: true }
  if (prop) c.overlay = prop
  if (walkable && ground?.startsWith(DUNE_PREFIX)) c.losDune = true
  if (!walkable && prop?.startsWith(BEACON_PREFIX)) c.losBeacon = true
  if (!walkable) {
    const blocker = prop ?? ground
    if (startsWithAny(blocker, LOS_CLEAR_PREFIXES) || startsWithAny(blocker, LOW_PREFIXES)) c.losClear = true
    else if (startsWithAny(blocker, LOS_SOFT_PREFIXES)) c.losSoft = true
    else if (startsWithAny(blocker, LOS_TALL_PREFIXES)) c.losTall = true
  }
  return c
}

function reachable(cells, from) {
  const seen = new Uint8Array(PIECE * PIECE)
  if (cells[from.y]?.[from.x]?.tile !== TILE.FLOOR) return seen
  const stack = [from.y * PIECE + from.x]
  seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop(), x = i % PIECE, y = (i / PIECE) | 0
    if (x > 0 && !seen[i - 1] && cells[y][x - 1].tile === TILE.FLOOR) { seen[i - 1] = 1; stack.push(i - 1) }
    if (x < PIECE - 1 && !seen[i + 1] && cells[y][x + 1].tile === TILE.FLOOR) { seen[i + 1] = 1; stack.push(i + 1) }
    if (y > 0 && !seen[i - PIECE] && cells[y - 1][x].tile === TILE.FLOOR) { seen[i - PIECE] = 1; stack.push(i - PIECE) }
    if (y < PIECE - 1 && !seen[i + PIECE] && cells[y + 1][x].tile === TILE.FLOOR) { seen[i + PIECE] = 1; stack.push(i + PIECE) }
  }
  return seen
}

export function generatePiece(seed, wx, wy, deal = 0, tale = null, villageTale = null) {
  const t = makeTerrain(seed, wx, wy, deal)
  const tier = tierAt(wx, wy)
  // cls: what the roads make of the piece (roads.js pieceClass); road: its road
  // sides and where its roads meet, or null for a piece with no road edge (features.js);
  // coach: a village's coach stop { x, y, town } (coach.js), else null
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy), cls: pieceClass(seed, wx, wy), road: null, coach: null,
    main: null, small: [], packs: [], tale, points: [], villageTale, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  t.finish()

  const cells = piece.cells = Array.from({ length: PIECE }, (_, y) =>
    Array.from({ length: PIECE }, (_, x) => {
      const c = cellOf(t.groundAt(x, y), t.propAt(x, y), t.walkable(x, y))
      // (art only: a road's verge, road-art.js)
      const deco = t.decoAt(x, y)
      if (deco) c.deco = deco
      return c
    }))
  // Doors and cave mouths are walk-onto triggers: the art stays, the cell opens.
  for (const d of [...piece.doors, ...piece.caves]) {
    const c = cells[d.y][d.x]
    c.tile = TILE.FLOOR
    delete c.losClear; delete c.losSoft; delete c.losTall
  }

  // Everything the piece offers must be reachable from where its paths meet.
  // A thing that is not (it should not happen) is dropped rather than left
  // as a chest in a wall of trees.
  if (cells[piece.spawnPoint.y][piece.spawnPoint.x].tile !== TILE.FLOOR) {
    let best = null
    for (let r = 1; r < 12 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = piece.main.x + dx, y = piece.main.y + dy
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && cells[y]?.[x]?.tile === TILE.FLOOR) { best = { x, y }; break }
    }
    if (best) piece.spawnPoint = best
  }
  const seen = reachable(cells, piece.spawnPoint)
  const ok = p => seen[p.y * PIECE + p.x] === 1
  // (`sealed`: behind water or rock on purpose, until its tale opens the way)
  piece.spawns = piece.spawns.filter(s => s.sealed || ok(s))
  // a pack whose every foe was cut off is no pack
  piece.packs = piece.packs.filter(k => piece.spawns.some(s => s.kind !== 'chest' && Math.hypot(s.x - k.x, s.y - k.y) <= 3))
  piece.doors = piece.doors.filter(ok)
  piece.caves = piece.caves.filter(ok)
  for (const [side, g] of Object.entries(piece.gates))
    if (!ok(g)) console.warn(`wilds: gate ${side} of piece ${piece.key} (deal ${deal}) is cut off`)
  // Last, when everything is placed: the top row of each building is walked
  // under (over.js). It joins no two places, so what was reachable still is
  // and nothing else has become so.
  openTops(cells)
  return piece
}
