// The desert's numbers and the tests every desert system shares: what
// counts as desert, the gentle ring round home where the desert stays easy,
// and how far the hero sees. DOM-free and pure.
//
// Sight in the Wilds (systems/entities.js `los: 'dunes'`): a dune crest is
// a walkable cell whose ground skin starts with DUNE_PREFIX (piece.js flags
// it `losDune`); it blocks sight to what lies behind it, but never itself:
// a line running on along crest cells to a crest target reaches it, so a
// slanted brink in view is seen whole, and the crest the viewer stands on
// (every crest cell joined to his, within his sight) neither blocks nor
// hides, so from a ridge he sees along it and down both flanks of his dune.
// A landmark is a blocked cell whose overlay starts with BEACON_PREFIX
// (`losBeacon`): seen over crests, and out to BEACON_RANGE.
import { PIECE, biomeAt } from './layout.js'

export const DUNE_PREFIX = 'ow_dune_'
export const BEACON_PREFIX = 'ow_landmark_'
// The desert's tall things to steer by (features.js stands one to three in
// every desert piece; tools/make-wilds-desert-tiles.mjs draws them): a
// sandstone spire two cells tall, its top over its foot, and a cairn of one.
export const SPIRE = [`${BEACON_PREFIX}spire_top`, `${BEACON_PREFIX}spire`]
export const CAIRN = `${BEACON_PREFIX}cairn`
export const DESERT_LANDMARKS = [...SPIRE, CAIRN]

// What the main thing of a desert piece looks like when it is a landmark
// (features.js dressDesertLandmark; the tool draws them): an oasis ringed with
// palms (PALM, two cells tall: the crown over its foot) and reeds by its
// water; or standing stones of sandstone, a rock arch or the bones of
// something huge, each a picture cut in cells (`cells`, rows from the north,
// null where the picture has nothing) whose cell `at` stands where the
// oasis's pond would have been. The arch's cell `open`, under its span, is
// walked into; every other cell is a landmark (blocked, seen from afar).
// The standing stones (PILLAR): a tall pillar three cells high in the middle
// column, a shorter one two cells high in the west column, a broken stump in
// the east column's bottom row; each stone keeps to its own column, so the
// middle column laid alone (LONE_PILLAR) is the tall pillar whole, the
// landmark of last resort where nothing bigger finds room.
export const PALM = [`${BEACON_PREFIX}palm_top`, `${BEACON_PREFIX}palm`]
const cut = (name, w, h, empty = []) => Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => empty.includes(`${c}${r}`) ? null : `${BEACON_PREFIX}${name}_${c}${r}`))
export const PILLAR = { cells: cut('pillar', 3, 3, ['00', '20', '21']), at: [1, 2] }
export const LONE_PILLAR = { cells: PILLAR.cells.map(row => [row[1]]), at: [0, 2] }
export const ARCH = { cells: cut('arch', 3, 2), at: [1, 1], open: [1, 1] }
export const BONES = { cells: cut('bones', 4, 3, ['00', '10', '30', '32']), at: [2, 1] }
export const REEDS = ['ow_deco_reeds_0', 'ow_deco_reeds_1', 'ow_deco_reeds_2']
export const MAIN_LANDMARK_SKINS = [...PALM, ...[PILLAR, ARCH, BONES].flatMap(s => s.cells.flat().filter(Boolean))]

// The hero's sight radius in tiles: `base` anywhere out of doors, `desert`
// in desert country, and in a full sandstorm `storm`, or `stormVillage`
// among a village's houses.
export const SIGHT = { base: 14, desert: 20, storm: 4, stormVillage: 8 }
// How far a landmark is seen, beyond the sight radius: about half the screen.
export const BEACON_RANGE = 32

// What counts as desert, for every system: the tile's own country.
export const isDesert = (seed, X, Y) => biomeAt(seed, X, Y) === 'desert'

// The pieces round home (piece coordinates): the first minutes of play stay
// gentle there (features.js PACKS[0]; no dunes, no storms).
export const inGentleRing = (wx, wy) => Math.max(Math.abs(wx), Math.abs(wy)) <= 1

// How deep into the wild world tile (X, Y) lies, 0..1, by its distance d from
// the middle of the home piece in pieces: 0 up to DEEP.from, 1 from DEEP.to,
// rising smoothly between. The desert's dunes close in with it (desert-art.js
// DUNE.deep): open dune country near home, a desert to get lost in far out.
// Pure in the world tile.
export const DEEP = { from: 3, to: 7 }
export function deep(X, Y) {
  const dx = (X - PIECE / 2) / PIECE, dy = (Y - PIECE / 2) / PIECE, d2 = dx * dx + dy * dy
  if (d2 <= DEEP.from * DEEP.from) return 0
  if (d2 >= DEEP.to * DEEP.to) return 1
  const t = (Math.sqrt(d2) - DEEP.from) / (DEEP.to - DEEP.from)
  return t * t * (3 - 2 * t)
}
// deep() over the w x h rectangle of world tiles at (x0, y0): its least and
// its greatest (at the tiles nearest and farthest from the home piece's middle).
const nearest = (a, n) => Math.max(a, Math.min(a + n - 1, PIECE / 2))
const farthest = (a, n) => (Math.abs(a - PIECE / 2) > Math.abs(a + n - 1 - PIECE / 2) ? a : a + n - 1)
export const leastDeep = (x0, y0, w, h) => deep(nearest(x0, w), nearest(y0, h))
export const mostDeep = (x0, y0, w, h) => deep(farthest(x0, w), farthest(y0, h))

// The hero's sight radius: from the open-country or desert radius down to
// the storm's, by the storm's strength 0..1.
export function heroSight({ desert, storm = 0, village = false }) {
  const clear = desert ? SIGHT.desert : SIGHT.base
  const blind = village ? SIGHT.stormVillage : SIGHT.storm
  const s = Math.min(1, Math.max(0, storm))
  return Math.round(clear + (blind - clear) * s)
}
