// The fixed big picture of a Wilds world: which country lies where, how
// tough each piece is, where the villages are and where neighbouring pieces
// join. Every function is pure in (seed, coordinates) — none of it changes
// when a piece is re-dealt, which is what lets the player keep their
// bearings while the land between places shifts.
//
// Coordinates: a piece is PIECE x PIECE tiles at integer (wx, wy), home is
// (0, 0), north is negative wy. A world tile is (X, Y) = (wx * PIECE + x, …).
import { hash, hashInt, noise2 } from './rand.js'

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
function pocket(seed, X, Y, wobble) {
  const cx0 = Math.floor(X / POCKET_CELL), cy0 = Math.floor(Y / POCKET_CELL)
  for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
    const px = (cx + 0.2 + 0.6 * hash(seed, cx, cy, 331)) * POCKET_CELL
    const py = (cy + 0.2 + 0.6 * hash(seed, cx, cy, 332)) * POCKET_CELL
    const radius = (0.75 + 0.6 * hash(seed, cx, cy, 333)) * PIECE
    if (Math.hypot(X - px, Y - py) / radius + (wobble - 0.5) * 0.7 < 1)
      return { kind: hashInt(seed, cx, cy, 334) % BIOMES.length, cx, cy }
  }
  return null
}

// The country at a world tile. Forest around home; beyond it a country per
// compass direction with the boundaries bent by noise, and pockets of other
// country where a slow field runs high.
export function biomeAt(seed, X, Y) {
  const dx = X - HOME, dy = Y - HOME
  const r = Math.hypot(dx, dy) / PIECE
  const wobble = noise2(seed + 1, X, Y, { freq: 1 / (1.5 * PIECE), octaves: 3 })
  if (r < 1.7 + wobble * 0.8) return 'forest'
  const ang = Math.atan2(dy, dx) * 180 / Math.PI + (wobble - 0.5) * 50
  const main = ang > -135 && ang <= -45 ? 'mountain'
    : ang > -45 && ang <= 45 ? 'desert'
    : ang > 45 && ang <= 135 ? 'sea'
    : noise2(seed + 2, X, Y, { freq: 1 / (2.5 * PIECE), octaves: 2 }) > 0.5 ? 'autumn' : 'marsh'
  const p = pocket(seed, X, Y, noise2(seed + 3, X, Y, { freq: 1 / 40, octaves: 2 }))
  if (!p) return main
  // a pocket is always a change of scene: one that would repeat its host is
  // the next country in the list
  const b = BIOMES[p.kind]
  return b === main ? BIOMES[(p.kind + 1) % BIOMES.length] : b
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

function villageName(seed, wx, wy) {
  if (wx === 0 && wy === 0) return 'Koivula'
  const stem = STEMS[hashInt(seed, wx, wy, 311) % STEMS.length]
  let end = ENDS[hashInt(seed, wx, wy, 312) % ENDS.length]
  // vowel harmony, roughly: a front-vowel stem takes the front ending
  if (/[äöy]/.test(stem)) end = end.replace('la', 'lä').replace('ranta', 'ranta').replace('salo', 'salo')
  const name = stem + end
  return name === 'Koivula' ? 'Koivuniemi' : name
}

// The one village of the 4x4 block of pieces (bx, by).
function blockVillage(seed, bx, by) {
  if (bx === 0 && by === 0) return { wx: 0, wy: 0 }
  let i = hashInt(seed, bx, by, 310) % 16
  for (let n = 0; n < 16; n++, i = (i + 1) % 16) {
    const wx = bx * 4 + (i % 4), wy = by * 4 + (i >> 2)
    if (!fixedMain(wx, wy)) return { wx, wy }
  }
  return null
}

export function villageAt(seed, wx, wy) {
  const v = blockVillage(seed, Math.floor(wx / 4), Math.floor(wy / 4))
  return v && v.wx === wx && v.wy === wy ? { name: villageName(seed, wx, wy) } : null
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

// Pieces that are never forgotten: villages and the ring around home.
export function isPermanent(seed, wx, wy) {
  return Math.max(Math.abs(wx), Math.abs(wy)) <= 1 || !!villageAt(seed, wx, wy)
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
