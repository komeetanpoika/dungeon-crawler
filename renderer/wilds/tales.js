// Which tale a village has, and where its place may appear. Pure in the seed
// (and, for the appearing, in the world record). DOM-free.
//
// A village's reach is the 7x7 pieces round it. A kind fits a village when
// enough of its home land lies in that reach; the village's tale is one
// fitting kind, picked by hash. Koivula's is always the elk.
import { TALES, TALE_IDS } from '../data/tales.js'
import { villageAt, villagesNear, pieceBiome, pieceKey } from './layout.js'
import { hash, hashInt } from './rand.js'
import { isCityPiece } from './city/geometry.js'
import { pieceClass } from './roads.js'

export const REACH = 3       // pieces (Chebyshev) from the village
export const SPACING = 3     // pieces between two places of one kind: never two of a kind in one window
export const WIDEST = 5      // how far a tale may look once nothing nearer is left for it
export const MIN_LAND = 3    // home-land pieces in reach for a kind to fit
export const HOME_TRIO = ['0,0', '1,0', '0,-1']
export const SIDE_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

const isHome = v => v.wx === 0 && v.wy === 0

export function reachOf(seed, v, reach = REACH) {
  const out = []
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const wx = v.wx + dx, wy = v.wy + dy
    if (HOME_TRIO.includes(pieceKey(wx, wy)) || villageAt(seed, wx, wy)) continue
    out.push({ wx, wy })
  }
  return out
}

// fitsOf walks up to 48 pieces' country: remembered per (seed, village).
const fitsCache = new Map()
export function fitsOf(seed, v, reach = REACH) {
  const key = `${seed}:${v.wx},${v.wy}:${reach}`
  let fits = fitsCache.get(key)
  if (fits) return fits
  fits = Object.fromEntries(TALE_IDS.map(id => [id, []]))
  for (const p of reachOf(seed, v, reach)) {
    const land = pieceBiome(seed, p.wx, p.wy)
    for (const id of TALE_IDS) if (TALES[id].land.includes(land)) fits[id].push(p)
  }
  if (fitsCache.size > 400) fitsCache.clear()
  fitsCache.set(key, fits)
  return fits
}

// A village's tale by the table alone (a world's record outranks it: kindOf).
// A tale that plays out in the village itself is not given to two villages
// near enough to share a window: the one with the larger key takes its next
// fitting kind. Smaller keys are settled first, so this is well defined.
const taleCache = new Map()
export function taleOf(seed, v) {
  if (isHome(v)) return 'elk'
  if (isCityPiece(v.wx, v.wy)) return null   // the city is no village with a tale
  const key = `${seed}:${v.wx},${v.wy}`
  if (taleCache.has(key)) return taleCache.get(key)
  const fits = fitsOf(seed, v)
  const fitting = TALE_IDS.filter(id => fits[id].length >= MIN_LAND)
  let tale = null
  if (fitting.length) {
    const mine = pieceKey(v.wx, v.wy)
    const before = villagesNear(seed, v.wx, v.wy, 2).filter(o => pieceKey(o.wx, o.wy) < mine)
    const taken = id => TALES[id].villageBorne && before.some(o => taleOf(seed, o) === id)
    const start = hashInt(seed, v.wx, v.wy, 710) % fitting.length
    for (let i = 0; i < fitting.length && !tale; i++) {
      const id = fitting[(start + i) % fitting.length]
      if (!taken(id)) tale = id
    }
  }
  if (taleCache.size > 4000) taleCache.clear()
  taleCache.set(key, tale)
  return tale
}

// The kind of a village's tale in this world: what its record says, else the table.
export const kindOf = (world, v) => world.tales.get(pieceKey(v.wx, v.wy))?.id ?? taleOf(world.seed, v)

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
  // farmland is never a place (eligible()), so it does not make a side
  for (const p of fitsOf(seed, v)[taleId]) if (pieceClass(seed, p.wx, p.wy) !== 'farmland') count[sideOfPiece(v, p.wx, p.wy)]++
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
// the tale's home land within reach, not farmland (the first road piece out of
// a town holds a farm: roads.js pieceClass), and far enough from every other
// place of its kind that no two are ever in one window: the quest code finds
// its creature by type. Places of different kinds may be neighbours. A place
// already recorded stays wherever it is.
export function eligible(world, v, id, wx, wy, reach = REACH) {
  const key = pieceKey(wx, wy)
  if (world.records.has(key) || world.places.has(key)) return false
  if (!fitsOf(world.seed, v, reach)[id].some(p => p.wx === wx && p.wy === wy)) return false
  if (pieceClass(world.seed, wx, wy) === 'farmland') return false
  for (const [other, place] of world.places) if (place.id === id && cheb(parseKey(other), { wx, wy }) < SPACING) return false
  return true
}

// The pieces still open to a tale: those of its reach, or, once every one of
// them has been walked or taken, of the next ring out, up to WIDEST. A tale is
// never left with directions to a place that cannot come.
function openTo(world, v, id) {
  for (let reach = REACH; reach <= WIDEST; reach++) {
    const open = fitsOf(world.seed, v, reach)[id].filter(p => !isCityPiece(p.wx, p.wy) && eligible(world, v, id, p.wx, p.wy, reach))
    if (open.length) return open
  }
  return []
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
  // The village nearest the land coming in chooses first: at the start of a
  // new world that is Koivula, whose wood should be the one beside it.
  const near = v => Math.min(...pieces.map(p => Math.hypot(p.wx - v.wx, p.wy - v.wy)))
  // (a village in the same window is as near as Koivula: home still goes first)
  const order = [...villages.keys()].sort((a, b) => near(villages.get(a)) - near(villages.get(b))
    || (b === '0,0') - (a === '0,0') || (a < b ? -1 : 1))
  for (const vKey of order) {
    const v = villages.get(vKey)
    const id = kindOf(world, v)
    if (!id) continue
    const known = world.tales.get(vKey)
    if (known?.place || known?.done) continue
    if (TALES[id].kind === 'need') {
      if (!entering.has(vKey) && !world.records.has(vKey)) continue
      const far = p => Math.hypot(p.wx - v.wx, p.wy - v.wy)
      const open = openTo(world, v, id)
        .sort((a, b) => far(a) - far(b) || (pieceKey(a.wx, a.wy) < pieceKey(b.wx, b.wy) ? -1 : 1))
      if (open.length) take(v, vKey, id, open[0])
      continue
    }
    const side = sideOf(seed, v, id)
    const onSide = p => side !== null && sideOfPiece(v, p.wx, p.wy) === side
    const tried = new Set()
    const isOpen = p => openTo(world, v, id).some(q => q.wx === p.wx && q.wy === p.wy)
    const candidates = pieces.filter(isOpen)
      .sort((a, b) => (onSide(b) - onSide(a)) || (pieceKey(a.wx, a.wy) < pieceKey(b.wx, b.wy) ? -1 : 1))
    for (const p of candidates) {
      const open = openTo(world, v, id)
      if (!open.some(q => q.wx === p.wx && q.wy === p.wy)) continue   // another tale's place came too close meanwhile
      const rec = taleRecord(world, v)
      const table = TALES[id].kind === 'old' ? OLD : onSide(p) ? STORY_SIDE : STORY_OFF
      const i = onSide(p) ? rec.nSide : rec.n
      const left = open.filter(q => !tried.has(pieceKey(q.wx, q.wy))).length
      // Koivula's own tale does not gamble: the first fitting new land beside
      // home is its place, so the first elk a new player meets is the one
      // their own village tells of.
      const chance = left <= 1 || vKey === '0,0' ? 1 : table[Math.min(i, table.length - 1)]
      if (onSide(p)) rec.nSide++; else rec.n++
      tried.add(pieceKey(p.wx, p.wy))
      if (hash(seed, p.wx, p.wy, 700 + i) < chance) { take(v, vKey, id, p); break }
    }
  }
  return hits
}

// ---- what the village says ---------------------------------------------------------
// The lines of a village's tale at its current stage, placeholders filled.
// The side is the promised one until the place is chosen and the real one
// after, so the directions are never wrong for where the place is.
export function fillLines(world, villageKey) {
  const v = parseKey(villageKey)
  const rec = world.tales.get(villageKey)
  const id = rec?.id ?? taleOf(world.seed, v)
  if (!id) return null
  const tale = TALES[id]
  const stage = tale.lines.find(s => s.when(rec?.flags ?? {}))
  if (!stage) return null
  const place = rec?.place ? parseKey(rec.place) : null
  const promised = sideOf(world.seed, v, id)
  const words = {
    side: place ? SIDE_NAMES[sideOfPiece(v, place.wx, place.wy)] : promised !== null ? SIDE_NAMES[promised] : 'out',
    where: place ? wherePhrase(v, place) : 'not far',
    land: tale.landWord,
  }
  const fill = line => line.replace(/\{(\w+)\}/g, (whole, key) => words[key] ?? whole)
  return Object.fromEntries(Object.entries(stage.by).map(([species, lines]) => [species, lines.map(fill)]))
}
