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
import { makeSampo, loadSampo, exportSampo, SAMPO_PLACES } from './city/sampo.js'
import { loadMap, exportMap, forgetMap } from './map.js'
import { generatePiece } from './piece.js'
import { generateCityPiece } from './city/piece.js'
import { pieceKey, isPermanent, villageAt } from './layout.js'
import { isCityPiece } from './city/geometry.js'
import { kindOf } from './tales.js'
import { TALE_IDS } from '../data/tales.js'

// Bump when the generator's output changes: spawn indices and the ground
// itself in an older save no longer match, so its records are dropped.
export const GEN = 10
export const FORGET_PIECES = 5      // Chebyshev pieces from the player
export const FORGET_SECONDS = 1200  // of play since the piece was last in the window
export const CACHE_MAX = 49

const isInt = Number.isInteger
const isPieceRef = v => v && isInt(v.wx) && isInt(v.wy)
const parseKey = key => { const [wx, wy] = key.split(',').map(Number); return { wx, wy } }

export function makeWorld(saved = null, { seed = 1 } = {}) {
  const ok = saved && typeof saved === 'object' && !Array.isArray(saved) && isInt(saved.seed)
  const world = {
    seed: ok ? saved.seed : seed, gen: GEN, playtime: 0, day: 0, origin: null,
    pieces: new Map(), records: new Map(), deals: new Map(),
    // key -> spawn indices alive in the window while their home piece is out
    // of it (session.js); never saved — a load puts everyone back at home
    strays: new Map(),
    // tales (tales.js): villageKey -> { id, flags, place, n, nSide, done, special? };
    // places: pieceKey -> { id, village, done }; paid: kinds whose special reward is spent
    tales: new Map(), places: new Map(), paid: new Set(),
    // Päivölä (renderer/interior/sunroom.js): door labels of puzzle houses
    // solved, and of those whose reward was taken
    solved: new Set(), looted: new Set(),
    // Kalevanlinna (city/law.js seat): the day the player last sat in the
    // stocks, for the crier's news the day after (city/crier.js); null never
    stocksDay: null,
    // the Sampo of Kalevanlinna (city/sampo.js): the city's long story
    sampo: makeSampo(),
    // the map (map.js): a small picture of every piece seen, its version for
    // whoever draws it (never saved), and the tale places the player has found
    map: new Map(), mapVer: new Map(), found: new Set(),
    lastVillage: { wx: 0, wy: 0 }, visited: ['0,0'], pos: null,
  }
  if (!ok) return world
  if (Number.isFinite(saved.playtime) && saved.playtime >= 0) world.playtime = saved.playtime
  if (isInt(saved.day) && saved.day >= 0) world.day = saved.day
  if (isPieceRef(saved.lastVillage)) world.lastVillage = { wx: saved.lastVillage.wx, wy: saved.lastVillage.wy }
  if (Array.isArray(saved.visited)) world.visited = [...new Set(['0,0', ...saved.visited.filter(k => typeof k === 'string')])]
  for (const [key, n] of Object.entries(saved.deals ?? {})) if (isInt(n) && n > 0) world.deals.set(key, n)
  // Tales, their places and the rewards already had outlive a generator
  // change (records of chests and trees do not): a tale half played stays so.
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
  for (const [key, t] of Object.entries(isObj(saved.tales) ? saved.tales : {})) {
    if (!isObj(t) || !TALE_IDS.includes(t.id) || !isObj(t.flags) || !(t.place === null || typeof t.place === 'string') || !isInt(t.n) || !isInt(t.nSide)) continue
    world.tales.set(key, { id: t.id, flags: { ...t.flags }, place: t.place, n: t.n, nSide: t.nSide, done: t.done === true,
      ...(typeof t.special === 'boolean' && { special: t.special }) })
  }
  for (const [key, p] of Object.entries(isObj(saved.places) ? saved.places : {})) {
    if (!isObj(p) || !(TALE_IDS.includes(p.id) || SAMPO_PLACES.includes(p.id)) || typeof p.village !== 'string') continue
    world.places.set(key, { id: p.id, village: p.village, done: p.done === true })
  }
  // a saved place on a city piece (R2) is released; its tale keeps its flags
  for (const key of [...world.places.keys()]) {
    const { wx, wy } = parseKey(key)
    if (!isCityPiece(wx, wy)) continue
    world.places.delete(key)
    for (const t of world.tales.values()) if (t.place === key) t.place = null
  }
  if (Array.isArray(saved.paid)) for (const id of saved.paid) if (TALE_IDS.includes(id)) world.paid.add(id)
  // a solved house stays solved, as a told tale stays told
  for (const k of ['solved', 'looted']) if (Array.isArray(saved[k])) for (const label of saved[k]) if (typeof label === 'string') world[k].add(label)
  if (isInt(saved.stocksDay) && saved.stocksDay >= 0) world.stocksDay = saved.stocksDay
  // the long story stays told across a generator change, as the tales do
  world.sampo = loadSampo(saved.sampo)
  // a found place stays marked while its place stands; the pictures of the
  // land itself go with the generator that drew it
  if (Array.isArray(saved.found)) for (const key of saved.found) if (world.places.has(key)) world.found.add(key)
  if (saved.gen !== GEN) return world
  loadMap(world, saved.map)
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
  // Kalevanlinna's four pieces are cut from the city, built once per world
  if (isCityPiece(wx, wy)) {
    piece = generateCityPiece(world.seed, wx, wy)
    world.pieces.set(key, piece)
    if (world.pieces.size > CACHE_MAX) evict(world)
    return piece
  }
  // a village is built for the tale it carries, a tale's place for its tale
  const village = (wx === 0 && wy === 0) || villageAt(world.seed, wx, wy)
  piece = generatePiece(world.seed, wx, wy, world.deals.get(key) ?? 0, world.places.get(key)?.id ?? null,
    village ? kindOf(world, { wx, wy }) : null)
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
    // a tale's place stays until its tale is done; after that it is land like any other
    if (world.places.has(key) && !world.places.get(key).done) continue
    forgotten.push(key)
  }
  for (const key of forgotten) {
    world.records.delete(key)
    world.places.delete(key)
    forgetMap(world, key)   // land that will be dealt anew leaves the map
    world.deals.set(key, (world.deals.get(key) ?? 0) + 1)
    world.pieces.delete(key)
  }
  return forgotten
}

export function exportWorld(world) {
  const records = {}
  for (const [key, rec] of world.records) records[key] = { gone: [...rec.gone], felled: [...rec.felled], lastSeen: rec.lastSeen }
  return {
    seed: world.seed, gen: GEN, playtime: world.playtime, day: world.day,
    pos: world.pos ? { ...world.pos } : null,
    lastVillage: { ...world.lastVillage }, visited: [...world.visited],
    records, deals: Object.fromEntries(world.deals),
    tales: Object.fromEntries([...world.tales].map(([key, t]) => [key, { ...t, flags: { ...t.flags } }])),
    places: Object.fromEntries([...world.places].map(([key, p]) => [key, { ...p }])),
    paid: [...world.paid],
    solved: [...world.solved], looted: [...world.looted],
    stocksDay: world.stocksDay,
    sampo: exportSampo(world.sampo),
    map: exportMap(world), found: [...world.found],
  }
}
