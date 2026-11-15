// Which tale a village has, and where its place may appear. Pure in the seed
// (and, for the appearing, in the world record). DOM-free.
//
// A village's reach is the 7x7 pieces round it. A kind fits a village when
// enough of its home land lies in that reach; the village's tale is one
// fitting kind, picked by hash. Koivula's is always the elk.
import { TALES, TALE_IDS } from '../data/tales.js'
import { villageAt, villagesNear, pieceBiome, pieceKey } from './layout.js'
import { hash, hashInt } from './rand.js'

export const REACH = 3       // pieces (Chebyshev) from the village
export const SPACING = 3     // pieces between any two places: never two in one window
export const MIN_LAND = 3    // home-land pieces in reach for a kind to fit
export const HOME_TRIO = ['0,0', '1,0', '0,-1']
export const SIDE_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

const isHome = v => v.wx === 0 && v.wy === 0

export function reachOf(seed, v) {
  const out = []
  for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) {
    const wx = v.wx + dx, wy = v.wy + dy
    if (HOME_TRIO.includes(pieceKey(wx, wy)) || villageAt(seed, wx, wy)) continue
    out.push({ wx, wy })
  }
  return out
}

// fitsOf walks up to 48 pieces' country: remembered per (seed, village).
const fitsCache = new Map()
export function fitsOf(seed, v) {
  const key = `${seed}:${v.wx},${v.wy}`
  let fits = fitsCache.get(key)
  if (fits) return fits
  fits = Object.fromEntries(TALE_IDS.map(id => [id, []]))
  for (const p of reachOf(seed, v)) {
    const land = pieceBiome(seed, p.wx, p.wy)
    for (const id of TALE_IDS) if (TALES[id].land.includes(land)) fits[id].push(p)
  }
  if (fitsCache.size > 400) fitsCache.clear()
  fitsCache.set(key, fits)
  return fits
}

export function taleOf(seed, v) {
  if (isHome(v)) return 'elk'
  const fits = fitsOf(seed, v)
  const fitting = TALE_IDS.filter(id => fits[id].length >= MIN_LAND)
  return fitting.length ? fitting[hashInt(seed, v.wx, v.wy, 710) % fitting.length] : null
}

// The compass octant of a piece from the village: 0 north, clockwise.
export function sideOfPiece(v, wx, wy) {
  const turn = Math.round(Math.atan2(wx - v.wx, -(wy - v.wy)) / (Math.PI / 4))
  return ((turn % 8) + 8) % 8
}

// A well-known story's side: where its land lies, two pieces of it if any
// side has that much.
export function sideOf(seed, v, taleId) {
  if (TALES[taleId]?.kind !== 'story') return null
  const count = new Array(8).fill(0)
  for (const p of fitsOf(seed, v)[taleId]) count[sideOfPiece(v, p.wx, p.wy)]++
  const sides = n => count.map((c, i) => c >= n ? i : -1).filter(i => i >= 0)
  const pool = sides(2).length ? sides(2) : sides(1)
  return pool.length ? pool[hashInt(seed, v.wx, v.wy, 711) % pool.length] : null
}

const WALKS = ['a short walk', 'a good walk', 'a long walk']
export function wherePhrase(v, piece) {
  const d = Math.max(Math.abs(piece.wx - v.wx), Math.abs(piece.wy - v.wy))
  return `${WALKS[Math.max(1, Math.min(3, d)) - 1]} ${SIDE_NAMES[sideOfPiece(v, piece.wx, piece.wy)]}`
}

// ---- a place appears -----------------------------------------------------------
// Odds for the next eligible piece, by how many were rolled before it.
const OLD = [0.2, 0.35, 0.5, 0.75, 1]
const STORY_SIDE = [0.5, 1]
const STORY_OFF = [0.15, 0.25, 0.4, 0.6, 1]

const parseKey = key => { const [wx, wy] = key.split(',').map(Number); return { wx, wy } }
const cheb = (a, b) => Math.max(Math.abs(a.wx - b.wx), Math.abs(a.wy - b.wy))

// The record of a village's tale, made on first need; null for a village without one.
export function taleRecord(world, v) {
  const id = taleOf(world.seed, v)
  if (!id) return null
  const key = pieceKey(v.wx, v.wy)
  let rec = world.tales.get(key)
  if (!rec) world.tales.set(key, rec = { id, flags: {}, place: null, n: 0, nSide: 0, done: false })
  return rec
}

// May this piece become the place of village v's tale? New land (no record),
// the tale's home land within reach, and far enough from every other place
// that no two are ever in one window.
export function eligible(world, v, id, wx, wy) {
  const key = pieceKey(wx, wy)
  if (world.records.has(key) || world.places.has(key)) return false
  if (!fitsOf(world.seed, v)[id].some(p => p.wx === wx && p.wy === wy)) return false
  for (const other of world.places.keys()) if (cheb(parseKey(other), { wx, wy }) < SPACING) return false
  return true
}

// `pieces` are about to enter the window; call before their records are
// made. Each open tale within reach gets its chance at them: an immediate
// need simply takes the eligible piece nearest its village once the village
// is near; the others roll each eligible piece once, with rising odds.
// Returns the keys that became places.
export function admit(world, pieces) {
  const seed = world.seed
  const entering = new Set(pieces.map(p => pieceKey(p.wx, p.wy)))
  const villages = new Map()
  for (const p of pieces) for (const v of villagesNear(seed, p.wx, p.wy, REACH)) villages.set(pieceKey(v.wx, v.wy), { wx: v.wx, wy: v.wy })
  const hits = []
  const take = (v, vKey, id, p) => {
    const rec = taleRecord(world, v)
    const key = pieceKey(p.wx, p.wy)
    rec.place = key
    world.places.set(key, { id, village: vKey, done: false })
    world.pieces.delete(key)   // generated out of sight as ordinary land: make it anew
    hits.push(key)
  }
  for (const vKey of [...villages.keys()].sort()) {
    const v = villages.get(vKey)
    const id = taleOf(seed, v)
    if (!id) continue
    const known = world.tales.get(vKey)
    if (known?.place || known?.done) continue
    const fits = fitsOf(seed, v)[id]
    if (TALES[id].kind === 'need') {
      if (!entering.has(vKey) && !world.records.has(vKey)) continue
      const far = p => Math.hypot(p.wx - v.wx, p.wy - v.wy)
      const open = fits.filter(p => eligible(world, v, id, p.wx, p.wy))
        .sort((a, b) => far(a) - far(b) || (pieceKey(a.wx, a.wy) < pieceKey(b.wx, b.wy) ? -1 : 1))
      if (open.length) take(v, vKey, id, open[0])
      continue
    }
    const side = sideOf(seed, v, id)
    const onSide = p => side !== null && sideOfPiece(v, p.wx, p.wy) === side
    const tried = new Set()
    const candidates = pieces.filter(p => eligible(world, v, id, p.wx, p.wy))
      .sort((a, b) => (onSide(b) - onSide(a)) || (pieceKey(a.wx, a.wy) < pieceKey(b.wx, b.wy) ? -1 : 1))
    for (const p of candidates) {
      if (!eligible(world, v, id, p.wx, p.wy)) continue   // another tale's place came too close meanwhile
      const rec = taleRecord(world, v)
      const table = TALES[id].kind === 'old' ? OLD : onSide(p) ? STORY_SIDE : STORY_OFF
      const i = onSide(p) ? rec.nSide : rec.n
      const left = fits.filter(q => !tried.has(pieceKey(q.wx, q.wy)) && eligible(world, v, id, q.wx, q.wy)).length
      const chance = left <= 1 ? 1 : table[Math.min(i, table.length - 1)]
      if (onSide(p)) rec.nSide++; else rec.n++
      tried.add(pieceKey(p.wx, p.wy))
      if (hash(seed, p.wx, p.wy, 700 + i) < chance) { take(v, vKey, id, p); break }
    }
  }
  return hits
}
