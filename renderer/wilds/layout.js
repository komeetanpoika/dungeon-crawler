// The fixed big picture of a Wilds world: which country lies where, how
// tough each piece is, where the villages are and where neighbouring pieces
// join. Every function is pure in (seed, coordinates) — none of it changes
// when a piece is re-dealt, which is what lets the player keep their
// bearings while the land between places shifts.
//
// Coordinates: a piece is PIECE x PIECE tiles at integer (wx, wy), home is
// (0, 0), north is negative wy. A world tile is (X, Y) = (wx * PIECE + x, …).
import { hash, hashInt, noise2 } from './rand.js'
import { isCityPiece, inBay } from './city/geometry.js'

export const PIECE = 80
// The outer FRAME tiles of a piece never depend on its deal; terrain blends
// to the dealt interior over the next BLEND tiles. A piece is generated with
// MARGIN tiles of its neighbours around it so rims and two-tile trees meet.
export const FRAME = 6, BLEND = 8, MARGIN = 4

export const BIOMES = ['forest', 'autumn', 'mountain', 'desert', 'sea', 'marsh']
export const BIOME_NAMES = {
  forest: 'forest', autumn: 'autumn woods', mountain: 'mountains', desert: 'desert', sea: 'the sea', marsh: 'marsh',
}

export const pieceKey = (wx, wy) => `${wx},${wy}`
export const pieceOf = (X, Y) => ({ wx: Math.floor(X / PIECE), wy: Math.floor(Y / PIECE) })

const HOME = PIECE / 2   // the middle of the home piece, the world's centre

// Pockets of other country. Each POCKET_CELL x POCKET_CELL block of tiles
// holds one blob with a hashed centre, size and kind, so no stretch of any
// country goes long without a change of scene. Returns the blob's kind when
// (X, Y) lies inside one, else null.
const POCKET_CELL = 3 * PIECE
const BLOB_REACH = 1.35   // a blob's bent outline never passes this many radii
function blobOf(seed, cx, cy) {
  return {
    px: (cx + 0.2 + 0.6 * hash(seed, cx, cy, 331)) * POCKET_CELL,
    py: (cy + 0.2 + 0.6 * hash(seed, cx, cy, 332)) * POCKET_CELL,
    radius: (0.75 + 0.6 * hash(seed, cx, cy, 333)) * PIECE,
    kind: hashInt(seed, cx, cy, 334) % BIOMES.length,
  }
}
// Every blob that can reach into a rectangle of world tiles, in a fixed
// (row-major cell) order so overlapping blobs resolve the same everywhere.
function blobsFor(seed, x0, y0, x1, y1) {
  const out = []
  for (let cy = Math.floor(y0 / POCKET_CELL) - 1; cy <= Math.floor(y1 / POCKET_CELL) + 1; cy++)
    for (let cx = Math.floor(x0 / POCKET_CELL) - 1; cx <= Math.floor(x1 / POCKET_CELL) + 1; cx++) {
      const blob = blobOf(seed, cx, cy)
      const reach = blob.radius * BLOB_REACH
      if (blob.px + reach < x0 || blob.px - reach > x1 || blob.py + reach < y0 || blob.py - reach > y1) continue
      out.push(blob)
    }
  return out
}

function countryAt(seed, X, Y, blobs) {
  if (inBay(X, Y, 1.4)) return 'sea'   // the bay, with sandy shores round it
  const dx = X - HOME, dy = Y - HOME
  const r = Math.hypot(dx, dy) / PIECE
  // far from home the forest test cannot pass and the bend is only needed
  // within 25 degrees of a sector boundary
  let wobble = -1
  const bend = () => wobble < 0 ? (wobble = noise2(seed + 1, X, Y, { freq: 1 / (1.5 * PIECE), octaves: 3 })) : wobble
  if (r < 2.5 && r < 1.7 + bend() * 0.8) return 'forest'
  const raw = Math.atan2(dy, dx) * 180 / Math.PI
  const near = Math.abs(((raw + 45) % 90 + 90) % 90 - 45)   // degrees from the nearest sector centre: 45 = on a boundary
  const ang = near > 19 ? raw + (bend() - 0.5) * 50 : raw
  const main = ang > -135 && ang <= -45 ? 'mountain'
    : ang > -45 && ang <= 45 ? 'desert'
    : ang > 45 && ang <= 135 ? 'sea'
    : noise2(seed + 2, X, Y, { freq: 1 / (2.5 * PIECE), octaves: 2 }) > 0.5 ? 'autumn' : 'marsh'
  for (const blob of blobs) {
    const d = Math.hypot(X - blob.px, Y - blob.py) / blob.radius
    if (d >= BLOB_REACH) continue
    if (d < 0.65 || d + (noise2(seed + 3, X, Y, { freq: 1 / 40, octaves: 2 }) - 0.5) * 0.7 < 1) {
      // a pocket is always a change of scene: one that would repeat its host
      // is the next country in the list
      const b = BIOMES[blob.kind]
      return b === main ? BIOMES[(blob.kind + 1) % BIOMES.length] : b
    }
  }
  return main
}

// The country at a world tile. Forest around home; beyond it a country per
// compass direction with the boundaries bent by noise, and pockets of other
// country in blobs.
export function biomeAt(seed, X, Y) {
  return countryAt(seed, X, Y, blobsFor(seed, X, Y, X, Y))
}

// biomeAt for many tiles of one rectangle (inclusive world-tile bounds):
// the blobs are looked up once. Same answers as biomeAt.
export function biomeSampler(seed, x0, y0, x1, y1) {
  const blobs = blobsFor(seed, x0, y0, x1, y1)
  return (X, Y) => countryAt(seed, X, Y, blobs)
}

// The country a piece mostly is: the majority of a 3x3 sample, the centre
// winning ties.
export function pieceBiome(seed, wx, wy) {
  const counts = {}
  const at = [13, 40, 67]
  for (const y of at) for (const x of at) {
    const b = biomeAt(seed, wx * PIECE + x, wy * PIECE + y)
    counts[b] = (counts[b] ?? 0) + (x === 40 && y === 40 ? 1.5 : 1)
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

// Toughness 1-4 from the distance from home in pieces.
export function tierAt(wx, wy) {
  const d = Math.hypot(wx, wy)
  return d < 3 ? 1 : d < 6 ? 2 : d < 9 ? 3 : 4
}

// The depth whose loot rung (data/levels.js LOOT_TIERS) matches a toughness.
export const lootDepthFor = tier => [1, 3, 4, 5][tier - 1]

// The home trio never moves and is never anything else.
export function fixedMain(wx, wy) {
  if (wx === 0 && wy === 0) return 'village'
  if (wx === 1 && wy === 0) return 'ring'
  if (wx === 0 && wy === -1) return 'cave'
  return null
}

// Dungeon depth behind a cave mouth: the first cave is the gentlest; beyond
// it a toughness offers its own depth or the next (capped at 5).
export function caveDepthFor(seed, wx, wy) {
  if (wx === 0 && wy === -1) return 1
  const tier = tierAt(wx, wy)
  return Math.min(5, tier + (hash(seed, wx, wy, 301) < 0.5 ? 0 : 1))
}

const STEMS = ['Koivu', 'Hauki', 'Kuusi', 'Mänty', 'Karhu', 'Suo', 'Kivi', 'Meri', 'Hiekka', 'Ruska', 'Kaisla', 'Louhi',
  'Honka', 'Lehto', 'Vaara', 'Salo', 'Kuura', 'Sammal', 'Terva', 'Ahma']
const ENDS = ['la', 'niemi', 'koski', 'ranta', 'mäki', 'järvi', 'salo', 'kylä']

// No two villages within NAME_REACH blocks of each other share a name. Every
// village has a base name and a priority; it keeps its base name unless a
// village of higher priority in reach ends up with the same one, and then takes
// the first free name of its own sequence of candidates. Pure in the seed.
export const NAME_REACH = 2

function makeName(stem, end) {
  // vowel harmony, roughly: a front-vowel stem takes the front ending
  if (/[äöy]/.test(stem)) end = end.replace('la', 'lä')
  return stem + end
}

// The names a village may take, in order: its base name, then its stem with
// each of the other endings, then the following stems with its ending first.
function nameCandidates(seed, wx, wy) {
  const s0 = hashInt(seed, wx, wy, 311) % STEMS.length
  const e0 = hashInt(seed, wx, wy, 312) % ENDS.length
  const out = []
  for (let ds = 0; ds < STEMS.length; ds++) for (let j = 0; j < ENDS.length; j++) {
    const name = makeName(STEMS[(s0 + ds) % STEMS.length], ENDS[(e0 + j) % ENDS.length])
    if (name !== 'Koivula') out.push(name)
  }
  return out
}

const priorityOf = (seed, wx, wy) => wx === 0 && wy === 0 ? Infinity : hashInt(seed, wx, wy, 313)
const outranks = (seed, a, b) => {
  const pa = priorityOf(seed, a.wx, a.wy), pb = priorityOf(seed, b.wx, b.wy)
  return pa !== pb ? pa > pb : a.wx !== b.wx ? a.wx > b.wx : a.wy > b.wy
}

const nameMemo = new Map()
export function clearNameMemo() { nameMemo.clear() }

export function villageName(seed, wx, wy) {
  if (wx === 0 && wy === 0) return 'Koivula'
  const key = `${seed},${wx},${wy}`
  let name = nameMemo.get(key)
  if (name) return name
  const me = { wx, wy }
  const bx = Math.floor(wx / 4), by = Math.floor(wy / 4)
  const taken = new Set()
  for (let y = by - NAME_REACH; y <= by + NAME_REACH; y++) for (let x = bx - NAME_REACH; x <= bx + NAME_REACH; x++) {
    const v = blockVillage(seed, x, y)
    if (v && !(v.wx === wx && v.wy === wy) && outranks(seed, v, me)) taken.add(villageName(seed, v.wx, v.wy))
  }
  name = nameCandidates(seed, wx, wy).find(n => !taken.has(n))
  if (nameMemo.size > 2000) nameMemo.clear()
  nameMemo.set(key, name)
  return name
}

// The one village of the 4x4 block of pieces (bx, by).
export function blockVillage(seed, bx, by) {
  if (bx === 0 && by === 0) return { wx: 0, wy: 0 }
  let i = hashInt(seed, bx, by, 310) % 16
  for (let n = 0; n < 16; n++, i = (i + 1) % 16) {
    const wx = bx * 4 + (i % 4), wy = by * 4 + (i >> 2)
    if (!fixedMain(wx, wy) && !isCityPiece(wx, wy)) return { wx, wy }
  }
  return null
}

export function villageAt(seed, wx, wy) {
  const v = blockVillage(seed, Math.floor(wx / 4), Math.floor(wy / 4))
  // the name is worked out on first use: villageAt is asked far more often than the name
  return v && v.wx === wx && v.wy === wy ? { get name() { return villageName(seed, wx, wy) } } : null
}

// Villages within Chebyshev r pieces of (wx, wy), nearest first.
export function villagesNear(seed, wx, wy, r) {
  const out = []
  for (let by = Math.floor((wy - r) / 4); by <= Math.floor((wy + r) / 4); by++)
    for (let bx = Math.floor((wx - r) / 4); bx <= Math.floor((wx + r) / 4); bx++) {
      const v = blockVillage(seed, bx, by)
      if (!v || Math.max(Math.abs(v.wx - wx), Math.abs(v.wy - wy)) > r) continue
      out.push({ ...v, name: villageName(seed, v.wx, v.wy) })
    }
  const d = v => Math.hypot(v.wx - wx, v.wy - wy)
  return out.sort((a, b) => d(a) - d(b))
}

// Pieces that are never forgotten: villages, the ring around home and the city.
export function isPermanent(seed, wx, wy) {
  return Math.max(Math.abs(wx), Math.abs(wy)) <= 1 || isCityPiece(wx, wy) || !!villageAt(seed, wx, wy)
}

// Where the path crosses a piece edge, as an offset along that edge. It is a
// property of the edge, so the two pieces that share it always agree.
export function gateAt(seed, wx, wy, side) {
  const [ex, ey, salt] =
    side === 'E' ? [wx, wy, 321] :
    side === 'W' ? [wx - 1, wy, 321] :
    side === 'S' ? [wx, wy, 322] :
                   [wx, wy - 1, 322]
  return 20 + hashInt(seed, ex, ey, salt) % 40
}
