// A Wilds world's memory: the pieces generated so far, what the player
// changed in the ones they walked through, and which pieces have been
// forgotten and must come back as a new deal. DOM-free.
//
//   pieces   live cache, key -> Piece (cells and all); bounded
//   records  key -> { gone, felled, lastSeen } for every piece that has been
//            in the window: spawn indices that are gone for good, local
//            "x,y" keys of felled trees and cleared rocks, and the play time
//            the piece was last in the window
//   deals    key -> how many times the piece has been forgotten
import { generatePiece } from './piece.js'
import { pieceKey, isPermanent } from './layout.js'

// Bump when the generator's output changes: spawn indices and the ground
// itself in an older save no longer match, so its records are dropped.
export const GEN = 1
export const FORGET_PIECES = 5      // Chebyshev pieces from the player
export const FORGET_SECONDS = 1200  // of play since the piece was last in the window
export const CACHE_MAX = 49

const isInt = Number.isInteger
const isPieceRef = v => v && isInt(v.wx) && isInt(v.wy)
const parseKey = key => { const [wx, wy] = key.split(',').map(Number); return { wx, wy } }

export function makeWorld(saved = null, { seed = 1 } = {}) {
  const ok = saved && typeof saved === 'object' && !Array.isArray(saved) && isInt(saved.seed)
  const world = {
    seed: ok ? saved.seed : seed, gen: GEN, playtime: 0, origin: null,
    pieces: new Map(), records: new Map(), deals: new Map(),
    // key -> spawn indices alive in the window while their home piece is out
    // of it (session.js); never saved — a load puts everyone back at home
    strays: new Map(),
    lastVillage: { wx: 0, wy: 0 }, visited: ['0,0'], pos: null,
  }
  if (!ok) return world
  if (Number.isFinite(saved.playtime) && saved.playtime >= 0) world.playtime = saved.playtime
  if (isPieceRef(saved.lastVillage)) world.lastVillage = { wx: saved.lastVillage.wx, wy: saved.lastVillage.wy }
  if (Array.isArray(saved.visited)) world.visited = [...new Set(['0,0', ...saved.visited.filter(k => typeof k === 'string')])]
  for (const [key, n] of Object.entries(saved.deals ?? {})) if (isInt(n) && n > 0) world.deals.set(key, n)
  if (saved.gen !== GEN) return world
  for (const [key, rec] of Object.entries(saved.records ?? {})) {
    if (!rec || typeof rec !== 'object') continue
    world.records.set(key, {
      gone: new Set((rec.gone ?? []).filter(isInt)),
      felled: new Set((rec.felled ?? []).filter(k => typeof k === 'string')),
      lastSeen: Number.isFinite(rec.lastSeen) ? rec.lastSeen : world.playtime,
    })
  }
  if (saved.pos && isInt(saved.pos.X) && isInt(saved.pos.Y)) world.pos = { X: saved.pos.X, Y: saved.pos.Y }
  return world
}

const inWindow = (world, wx, wy) => !!world.origin &&
  wx >= world.origin.wx && wx <= world.origin.wx + 2 && wy >= world.origin.wy && wy <= world.origin.wy + 2

// The piece at (wx, wy): from the cache, else generated at its current deal.
export function getPiece(world, wx, wy) {
  const key = pieceKey(wx, wy)
  let piece = world.pieces.get(key)
  if (piece) return piece
  piece = generatePiece(world.seed, wx, wy, world.deals.get(key) ?? 0)
  world.pieces.set(key, piece)
  if (world.pieces.size > CACHE_MAX) evict(world)
  return piece
}

// Drop the cached pieces farthest from the window's centre. Their records
// stay: a dropped piece is regenerated from its seed and deal and the record
// re-applied, so only its fog of war is lost.
function evict(world) {
  const cx = (world.origin?.wx ?? 0) + 1, cy = (world.origin?.wy ?? 0) + 1
  const far = [...world.pieces.values()]
    .filter(p => !inWindow(world, p.wx, p.wy))
    .sort((a, b) => Math.max(Math.abs(b.wx - cx), Math.abs(b.wy - cy)) - Math.max(Math.abs(a.wx - cx), Math.abs(a.wy - cy)))
  for (const p of far) {
    if (world.pieces.size <= CACHE_MAX) break
    world.pieces.delete(p.key)
  }
}

export function recordFor(world, key) {
  let rec = world.records.get(key)
  if (!rec) world.records.set(key, rec = { gone: new Set(), felled: new Set(), lastSeen: world.playtime })
  return rec
}

// The forgetting rule: a piece the player has been far from for a long time
// loses its record and comes back as a new deal. Villages and the ring
// around home never do. Returns the keys forgotten.
export function sweep(world, cwx, cwy) {
  const forgotten = []
  for (const [key, rec] of world.records) {
    const { wx, wy } = parseKey(key)
    if (Math.max(Math.abs(wx - cwx), Math.abs(wy - cwy)) <= FORGET_PIECES) continue
    if (world.playtime - rec.lastSeen <= FORGET_SECONDS) continue
    if (inWindow(world, wx, wy) || isPermanent(world.seed, wx, wy)) continue
    forgotten.push(key)
  }
  for (const key of forgotten) {
    world.records.delete(key)
    world.deals.set(key, (world.deals.get(key) ?? 0) + 1)
    world.pieces.delete(key)
  }
  return forgotten
}

export function exportWorld(world) {
  const records = {}
  for (const [key, rec] of world.records) records[key] = { gone: [...rec.gone], felled: [...rec.felled], lastSeen: rec.lastSeen }
  return {
    seed: world.seed, gen: GEN, playtime: world.playtime,
    pos: world.pos ? { ...world.pos } : null,
    lastVillage: { ...world.lastVillage }, visited: [...world.visited],
    records, deals: Object.fromEntries(world.deals),
  }
}
