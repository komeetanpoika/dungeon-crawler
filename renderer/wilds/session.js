// The glue between a Wilds world and the running game state: building the
// window, re-centring it as the player walks, remembering what changed in
// the pieces that leave, and saving. No DOM and no game.js import — game.js
// passes in its own buildEntities.
//
// Every entity built from a piece's spawn list is tagged with that piece's
// key and the spawn's index (wildsKey, wildsIx). A spawn whose entity is
// missing when its piece leaves the window is gone for good.
import { PIECE, pieceKey, pieceOf } from './layout.js'
import { assemble, toWindow, toWorld, recentreStep, WIN, WIN_TILES } from './window.js'
import { shiftState } from './shift.js'
import { getPiece, recordFor, sweep, exportWorld } from './world.js'
import { admit } from './tales.js'
import { noteSeen } from './map.js'
import { admitSampo } from './city/sampo-places.js'
import { arrivedRecord } from './coach-ride.js'
import { calmStorm } from './storm.js'
import { applyFelled, STUMP } from '../systems/lumber.js'
import { TILE } from '../systems/entities.js'
import { doorAt } from '../systems/houses.js'
import { isCityPiece, toCity } from './city/geometry.js'
import { insideWalls } from './city/plan.js'

// Things farther than this from the player neither think nor move.
export const ACTIVE_TILES = 34
// A tale's own creatures are the exception: the flame-thief has to come to
// its village from thirty tiles out, the elk has to finish its run.
// The city's people (cityKey) keep to their posts and rounds the same way.
export const asleep = (e, player) => e.taleKey === undefined && e.cityKey === undefined && Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y)) > ACTIVE_TILES

// The window re-centres only this far into a neighbouring piece: 8 in the
// open, 24 in the city, so the square (where four pieces meet) holds still.
export const CITY_MARGIN = 24
const SWEEP_EVERY = 10       // seconds between forgetting sweeps
const MAP_EVERY = 0.2       // seconds between looks at what the hero has seen, for the map
const PREGEN_EVERY = 0.25    // seconds between pieces generated ahead of the player
const VILLAGE_REACH = 10     // tiles from a village's centre that count as being in it
const TRANSIENT = ['projectiles', 'zones', 'fireZones', 'lightning', 'strikes', 'shockwaves', 'arcs', 'hitEffects']

const windowGrid = world => Array.from({ length: WIN }, (_, r) =>
  Array.from({ length: WIN }, (_, c) => getPiece(world, world.origin.wx + c, world.origin.wy + r)))
// The nine pieces of the window at `origin`: given to the tales before the
// window is built, so new land can become a tale's place (tales.js admit)
// or the place of one of the Sampo's pieces (city/sampo-places.js admitSampo).
const nineAt = origin => Array.from({ length: WIN * WIN }, (_, i) => ({ wx: origin.wx + i % WIN, wy: origin.wy + Math.floor(i / WIN) }))
const eachPiece = (grid, fn) => { for (let r = 0; r < WIN; r++) for (let c = 0; c < WIN; c++) fn(grid[r][c], c, r) }

// What changed in a piece: spawns with no entity left (or a chest standing
// open), and felled trees and cleared rocks. Felled keys only ever grow. One
// away from its post for a while (world.away: the coachman on the coach's
// bench) is not gone.
function record(world, piece, entities) {
  const rec = recordFor(world, piece.key)
  const present = new Set(world.away?.get(piece.key))
  for (const e of entities) if (e.wildsKey === piece.key && !(e.type === 'chest' && e.opening)) present.add(e.wildsIx)
  for (let ix = 0; ix < piece.spawns.length; ix++) if (!present.has(ix)) rec.gone.add(ix)
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    const c = piece.cells[y][x]
    if (c.overlay === STUMP || c.cleared === 'rock') rec.felled.add(`${x},${y}`)
  }
  rec.lastSeen = world.playtime
  return rec
}

// Build one spawn of a piece standing at window column c, row r.
function build(state, piece, ix, c, r, buildEntities) {
  const s = piece.spawns[ix]
  for (const e of buildEntities([{ ...s, x: s.x + c * PIECE, y: s.y + r * PIECE }], state.map, piece.lootDepth)) {
    e.wildsKey = piece.key
    e.wildsIx = ix
    state.entities.push(e)
  }
}

// Strays are things alive in the window while their home piece is out of it.
// One that is no longer among the living was killed out there: it is gone.
function settleStrays(world, entities, onlyKey = null) {
  for (const [key, set] of world.strays) {
    if (onlyKey !== null && key !== onlyKey) continue
    const alive = new Set()
    for (const e of entities) if (e.wildsKey === key) alive.add(e.wildsIx)
    for (const ix of set) if (!alive.has(ix)) { recordFor(world, key).gone.add(ix); set.delete(ix) }
    if (!set.size) world.strays.delete(key)
  }
}

// Bring a piece into the window at column c, row r: re-fell what was felled
// and build every spawn that is neither gone nor already walking about.
function join(state, world, piece, c, r, buildEntities) {
  settleStrays(world, state.entities, piece.key)
  world.strays.delete(piece.key)   // whoever of them lives is home again
  const rec = world.records.get(piece.key)
  const ox = c * PIECE, oy = r * PIECE
  if (rec?.felled.size) applyFelled(state.map, [...rec.felled].map(k => { const [x, y] = k.split(',').map(Number); return `${x + ox},${y + oy}` }))
  const present = new Set()
  for (const e of state.entities) if (e.wildsKey === piece.key) present.add(e.wildsIx)
  piece.spawns.forEach((s, ix) => {
    if (rec?.gone.has(ix) || present.has(ix)) return
    build(state, piece, ix, c, r, buildEntities)
  })
  world.away?.delete(piece.key)   // whoever was away is back at their post
}

// Unfinished caves never age out (only beaten ones reset), and each is a
// whole dungeon in the save. Keep every cleared instance — those go on their
// own timer — and only the newest few unfinished ones. Pure.
export function capInstances(instances, max = 4) {
  const entries = Object.entries(instances ?? {})
  let spare = entries.filter(([, inst]) => inst?.cleared !== true).length - max
  return Object.fromEntries(entries.filter(([, inst]) => inst?.cleared === true || spare-- <= 0))
}

// The walk-onto triggers and signs of the nine pieces, in window tiles; and
// the coach stops (coach.js), one in each town's piece.
function setTriggers(state, grid) {
  state.caveEntrances = []
  state.houseDoors = []
  state.signs = []
  state.coachStops = []
  eachPiece(grid, (piece, c, r) => {
    const at = t => ({ ...t, x: t.x + c * PIECE, y: t.y + r * PIECE })
    state.caveEntrances.push(...piece.caves.map(at))
    state.houseDoors.push(...piece.doors.map(at))
    state.signs.push(...piece.signs.map(at))
    if (piece.coach) state.coachStops.push(at(piece.coach))
  })
  state.gates = {}
  state.mapExit = null
}

const walkableAt = (map, x, y) => map[y]?.[x]?.tile === TILE.FLOOR
function nearestWalkable(map, x, y, maxR) {
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    if (walkableAt(map, x + dx, y + dy)) return { x: x + dx, y: y + dy }
  }
  return null
}
function putPlayer(state, x, y) {
  const p = state.player
  p.x = x; p.y = y
  p.px = x * 32 + 16; p.py = y * 32 + 16
  p._fovMap = null; p._fovLitMap = null
}

// Arrive somewhere in the world: `target` is a world tile { X, Y } or a
// piece { wx, wy } (its spawn point). Whatever window was up is recorded and
// dropped, and a new one is built around the target.
export function enterWilds(state, world, target, { buildEntities }) {
  if (world.origin && state.wilds && state.map?.length === WIN_TILES) {
    eachPiece(windowGrid(world), piece => record(world, piece, state.entities))
    settleStrays(world, state.entities)
  }
  world.strays.clear()   // everything is rebuilt at its post
  let goal = target
  if (goal.X === undefined) {
    const p = getPiece(world, goal.wx, goal.wy)
    goal = { X: goal.wx * PIECE + p.spawnPoint.x, Y: goal.wy * PIECE + p.spawnPoint.y }
  }
  const { wx: cwx, wy: cwy } = pieceOf(goal.X, goal.Y)
  world.origin = { wx: cwx - 1, wy: cwy - 1 }
  admit(world, nineAt(world.origin))
  admitSampo(world, nineAt(world.origin))
  const grid = windowGrid(world)
  state.map = assemble(grid)
  state.entities = []
  for (const key of TRANSIENT) state[key] = []
  state.blinkTrail = null
  state.lastBossTile = null
  delete state._flowFields
  state.wilds = true
  // nobody wakes blind: no storm for a while (wilds/storm.js)
  calmStorm(world)
  state.storm = 0
  state.sightCap = null
  eachPiece(grid, (piece, c, r) => { recordFor(world, piece.key).lastSeen = world.playtime; join(state, world, piece, c, r, buildEntities) })
  setTriggers(state, grid)
  const want = toWindow(world.origin, goal.X, goal.Y)
  const centre = grid[1][1]
  const at = nearestWalkable(state.map, want.x, want.y, 6)
    ?? { x: PIECE + centre.spawnPoint.x, y: PIECE + centre.spawnPoint.y }
  putPlayer(state, at.x, at.y)
  // Waking on a cave mouth or a doorstep (a save made underground puts you
  // there) must not walk you straight back in: hold until you step off. Nor
  // must waking on a coach stop start a ride (coach.js tickCoach).
  const on = t => t.x === at.x && t.y === at.y
  state.entranceHold = state.caveEntrances.some(on) || !!doorAt(state.houseDoors, at.x, at.y)
  state.coachHold = state.coachStops.some(on)
}

// Step the window by (dx, dy) pieces: record and drop what leaves, shift
// every position, assemble the new window and bring in what joins.
function recentre(state, world, dx, dy, buildEntities) {
  const old = world.origin
  const next = { wx: old.wx + dx, wy: old.wy + dy }
  const stays = (wx, wy) => wx >= next.wx && wx <= next.wx + 2 && wy >= next.wy && wy <= next.wy + 2
  const leaving = []
  eachPiece(windowGrid(world), piece => { if (!stays(piece.wx, piece.wy)) leaving.push(piece) })
  for (const piece of leaving) record(world, piece, state.entities)
  // Whatever stands in a leaving piece goes with it, whoever's it is. One
  // whose own piece stays is put back at its post below rather than lost;
  // one whose piece left while it lives on in a kept piece becomes a stray.
  const gone = new Set(leaving.map(p => p.key))
  const rehome = []
  state.entities = state.entities.filter(e => {
    const { X, Y } = toWorld(old, e.x, e.y)
    const tagged = e.wildsKey !== undefined
    if (!gone.has(pieceKey(Math.floor(X / PIECE), Math.floor(Y / PIECE)))) {
      if (tagged && gone.has(e.wildsKey)) {
        if (!world.strays.has(e.wildsKey)) world.strays.set(e.wildsKey, new Set())
        world.strays.get(e.wildsKey).add(e.wildsIx)
      }
      return true
    }
    if (tagged) {
      world.strays.get(e.wildsKey)?.delete(e.wildsIx)   // carried off alive: back at home when home returns
      const home = e.wildsKey.split(',').map(Number)
      if (stays(home[0], home[1])) rehome.push({ wx: home[0], wy: home[1], ix: e.wildsIx })
    }
    return false
  })
  shiftState(state, -dx * PIECE, -dy * PIECE)
  world.origin = next
  admit(world, nineAt(next))
  admitSampo(world, nineAt(next))
  const grid = windowGrid(world)
  state.map = assemble(grid)
  const wasIn = (wx, wy) => wx >= old.wx && wx <= old.wx + 2 && wy >= old.wy && wy <= old.wy + 2
  eachPiece(grid, (piece, c, r) => {
    recordFor(world, piece.key).lastSeen = world.playtime
    if (!wasIn(piece.wx, piece.wy)) join(state, world, piece, c, r, buildEntities)
  })
  for (const h of rehome) build(state, grid[h.wy - next.wy][h.wx - next.wx], h.ix, h.wx - next.wx, h.wy - next.wy, buildEntities)
  setTriggers(state, grid)
}

// Whether world tile (X, Y) is in a village: within VILLAGE_REACH of the
// middle of its piece's village (the piece is in memory wherever the hero is).
export function inVillage(world, X, Y) {
  const here = pieceOf(X, Y)
  const v = world.pieces.get(pieceKey(here.wx, here.wy))?.village
  return !!v && Math.max(Math.abs(X - here.wx * PIECE - v.x), Math.abs(Y - here.wy * PIECE - v.y)) <= VILLAGE_REACH
}

// Once per surface frame. Returns { recentred: {dx, dy} | null } so the
// caller can move its tile cache along. `sight` (optional) says how far the
// hero sees now ({ radius, far }, wilds/storm.js sightNow): the map takes in
// what is explored that far, and the landmarks out to `far`.
export function tickWilds(state, world, delta, { buildEntities, onVillage, sight } = {}) {
  if (state.cave || !world.origin) return { recentred: null }
  world.playtime += delta
  let recentred = null
  const at = toWorld(world.origin, state.player.x, state.player.y)
  const inCity = isCityPiece(Math.floor(at.X / PIECE), Math.floor(at.Y / PIECE))
  const step = recentreStep(state.player.x, state.player.y, inCity ? CITY_MARGIN : undefined)
  if (step.dx || step.dy) { recentre(state, world, step.dx, step.dy, buildEntities); recentred = step }

  // the village the player stands in becomes the place they wake
  const { X, Y } = toWorld(world.origin, state.player.x, state.player.y)
  const here = pieceOf(X, Y)
  const piece = world.pieces.get(pieceKey(here.wx, here.wy))
  if (isCityPiece(here.wx, here.wy)) {
    // inside the walls is the city's own village: the inn's doorstep is where you wake
    const c = toCity(X, Y)
    if (insideWalls(c.cx, c.cy)) {
      world.lastVillage = { wx: 0, wy: 2 }
      if (!world.visited.includes('city')) { world.visited.push('city'); onVillage?.({ name: 'Kalevanlinna' }) }
    }
  } else if (piece?.village && inVillage(world, X, Y)) {
    world.lastVillage = { wx: here.wx, wy: here.wy }
    if (!world.visited.includes(piece.key)) { world.visited.push(piece.key); onVillage?.(piece.village) }
  }

  // the map takes in what the hero has seen, a few times a second
  world._mapT = (world._mapT ?? MAP_EVERY) + delta
  if (world._mapT >= MAP_EVERY) {
    world._mapT = 0
    const seen = sight?.()
    noteSeen(world, X, Y, seen?.radius, seen?.far)
  }

  world._sweepT = (world._sweepT ?? 0) + delta
  if (world._sweepT >= SWEEP_EVERY) {
    world._sweepT = 0
    for (const key of sweep(world, here.wx, here.wy)) dropInstances(state, key)
  }

  // generate the ring beyond the window ahead of need, a piece at a time
  world._pregenT = (world._pregenT ?? PREGEN_EVERY) + delta
  if (!recentred && !state.coachRide && world._pregenT >= PREGEN_EVERY) {
    const cx = world.origin.wx + 1, cy = world.origin.wy + 1
    ring: for (let r = 2; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (world.pieces.has(pieceKey(cx + dx, cy + dy))) continue
      getPiece(world, cx + dx, cy + dy)
      world._pregenT = 0
      break ring
    }
  }
  return { recentred }
}

// A forgotten piece's cave and houses are forgotten with it.
function dropInstances(state, key) {
  const inst = state.caveInstances
  if (!inst) return
  delete inst[`cave:${key}`]
  for (const label of Object.keys(inst)) {
    const m = /^house:wilds:(-?\d+),(-?\d+)$/.exec(label)
    if (m && pieceKey(Math.floor(m[1] / PIECE), Math.floor(m[2] / PIECE)) === key) delete inst[label]
  }
}

// The save record. Read from the surface, so it is safe from inside a cave
// or a house.
export function snapshotWilds(state, world) {
  const surface = state.cave ? state.cave.surface : state
  if (world.origin && surface.map?.length === WIN_TILES) {
    eachPiece(windowGrid(world), piece => record(world, piece, surface.entities))
    settleStrays(world, surface.entities)
    world.pos = toWorld(world.origin, surface.player.x, surface.player.y)
  }
  const rec = exportWorld(world)
  // on the coach: saved as arrived at the far stop (coach-ride.js)
  return surface.coachRide ? arrivedRecord(rec, world, surface.coachRide) : rec
}

// Death: wake in the last village visited. Returns that village.
export function wildsRespawn(state, world, hooks) {
  const v = world.lastVillage
  enterWilds(state, world, { wx: v.wx, wy: v.wy }, hooks)
  return getPiece(world, v.wx, v.wy).village
}
