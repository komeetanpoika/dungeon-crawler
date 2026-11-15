// Which tale a village has, and where its place may appear. Pure in the seed
// (and, for the appearing, in the world record). DOM-free.
//
// A village's reach is the 7x7 pieces round it. A kind fits a village when
// enough of its home land lies in that reach; the village's tale is one
// fitting kind, picked by hash. Koivula's is always the elk.
import { TALES, TALE_IDS } from '../data/tales.js'
import { villageAt, pieceBiome, pieceKey } from './layout.js'
import { hashInt } from './rand.js'

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
