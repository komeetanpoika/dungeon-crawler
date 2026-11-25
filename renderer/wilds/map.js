// The map of the Wilds, as data. For every piece the player has seen the
// world keeps a small picture: MAP_N × MAP_N colour classes, one per block of
// 2×2 tiles, 0 where nothing has been seen. It is written from the cells the
// hero has explored, saved with the Wilds record, and thrown away when the
// world forgets the piece (world.js sweep): land that will be dealt anew
// must not stay on the map. Landmarks (villages, the city, the places of
// tales once stood in) are kept for good, and so are the towns heard of but
// not yet reached, pencilled in. DOM-free; render/minimap.js and
// ui/map-panel.js draw it.
import { PIECE, pieceKey, villageAt } from './layout.js'
import { CITY } from './city/geometry.js'
import { TALES } from '../data/tales.js'
import { TILE } from '../systems/entities.js'

export const BLOCK = 2
export const MAP_N = PIECE / BLOCK   // 40
export const SEE_RADIUS = 16         // tiles round the hero looked at each time
export const FOUND_REACH = 24        // tiles from a place's middle that count as having stood in it

// Colour classes, in the order they win a block: the higher beats the lower,
// so a one-tile path or stream still shows. A class's index is its letter in
// a save, so a new class goes at the end (the road, which then wins every
// block it is in: a walked road is a line on the map).
export const CLASSES = [
  ['unseen', null],
  ['grass', '#5f8f3f'], ['sand', '#d8c27c'], ['mtnground', '#8f8777'], ['marsh', '#5d6b3b'],
  ['wood', '#2f6d30'], ['pine', '#20563a'], ['autumn', '#b8692b'], ['deadwood', '#6d6358'],
  ['rock', '#75716a'], ['water', '#2f70b3'], ['path', '#b38d58'], ['pave', '#9d978b'],
  ['deck', '#7c5432'], ['building', '#aa462f'], ['wall', '#cbc7bc'], ['road', '#eee2c2'],
]
export const CLASS = Object.fromEntries(CLASSES.map(([name], i) => [name, i]))
export const MAP_COLOURS = CLASSES.map(([, colour]) => colour)

const OVERLAY = [
  [/^ow_(city_wall|city_tower|city_gate|castle)/, 'wall'],
  [/^ow_(roof|house|city_roof|city_house|city_church|city_shop|city_mill|city_harbour|stall|brick|ruin|well|statue)/, 'building'],
  [/^ow_(pier_deck|prop_fillet|city_quay|boat)/, 'deck'],
  [/^ow_(mtn|rock)/, 'rock'],
  [/^ow_tree_autumn/, 'autumn'],
  [/^ow_(tree_pine|lalli_pine)/, 'pine'],
  [/^ow_(deadtree|greytree)/, 'deadwood'],
  [/^ow_tree/, 'wood'],
]
const SKIN = [
  [/^ow_(water|pond)/, 'water'],
  [/^ow_road_/, 'road'],
  [/^ow_(dirt|path)/, 'path'],
  [/^ow_(city_pave|ruin_crack)/, 'pave'],
  [/^ow_(sand|hardpan)/, 'sand'],
  [/^ow_mtn/, 'mtnground'],
  [/^ow_mud/, 'marsh'],
]
const cache = new Map()
function byName(table, name) {
  if (!name) return 0
  let c = cache.get(name)
  if (c === undefined) {
    c = 0
    for (const [re, cls] of table) if (re.test(name)) { c = CLASS[cls]; break }
    cache.set(name, c)
  }
  return c
}

// The class of one cell: what stands on it, else what it is made of. A bank
// or shore is water where it cannot be walked and land where it can.
export function classOf(cell) {
  const over = byName(OVERLAY, cell.overlay)
  if (over) return over
  const skin = cell.skin ?? ''
  if (/^ow_(shore|bank)/.test(skin)) return cell.tile === TILE.FLOOR ? (skin.includes('grass') ? CLASS.grass : CLASS.sand) : CLASS.water
  return byName(SKIN, skin) || CLASS.grass
}

const blank = () => new Uint8Array(MAP_N * MAP_N)

// Look at the tiles (x0..x1, y0..y1) of a piece and write what has been
// explored into its picture. Returns true if the picture changed.
export function fold(world, piece, x0 = 0, y0 = 0, x1 = PIECE - 1, y1 = PIECE - 1) {
  const bx0 = Math.max(0, Math.floor(x0 / BLOCK)), by0 = Math.max(0, Math.floor(y0 / BLOCK))
  const bx1 = Math.min(MAP_N - 1, Math.floor(x1 / BLOCK)), by1 = Math.min(MAP_N - 1, Math.floor(y1 / BLOCK))
  let pic = world.map.get(piece.key), changed = false
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    let best = 0
    for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
      const cell = piece.cells[by * BLOCK + dy]?.[bx * BLOCK + dx]
      if (!cell?.explored) continue
      const c = classOf(cell)
      if (c > best) best = c
    }
    if (!best) continue
    if (!pic) { pic = blank(); world.map.set(piece.key, pic) }
    const i = by * MAP_N + bx
    if (pic[i] !== best) { pic[i] = best; changed = true }
  }
  if (changed) world.mapVer.set(piece.key, (world.mapVer.get(piece.key) ?? 0) + 1)
  return changed
}

// The hero stands at world tile (X, Y): take in what is explored around
// them, and note a tale's place they are standing in. Only pieces already in
// memory are read; nothing is generated for the map's sake.
export function noteSeen(world, X, Y, r = SEE_RADIUS) {
  let changed = false
  for (let wy = Math.floor((Y - r) / PIECE); wy <= Math.floor((Y + r) / PIECE); wy++)
    for (let wx = Math.floor((X - r) / PIECE); wx <= Math.floor((X + r) / PIECE); wx++) {
      const piece = world.pieces.get(pieceKey(wx, wy))
      if (!piece) continue
      const ox = wx * PIECE, oy = wy * PIECE
      if (fold(world, piece, X - r - ox, Y - r - oy, X + r - ox, Y + r - oy)) changed = true
    }
  const hx = Math.floor(X / PIECE), hy = Math.floor(Y / PIECE), key = pieceKey(hx, hy)
  if (world.places.has(key) && !world.found.has(key)
    && Math.max(Math.abs(X - hx * PIECE - PIECE / 2), Math.abs(Y - hy * PIECE - PIECE / 2)) <= FOUND_REACH) {
    world.found.add(key)
    changed = true
  }
  return changed
}

// A forgotten piece leaves the map; so does the mark of a place that went with it.
export function forgetMap(world, key) {
  world.map.delete(key)
  world.mapVer.delete(key)
  world.found.delete(key)
}

// ---- saving ---------------------------------------------------------------------------
// A picture as text: runs of one class, a letter for the class and the run's
// length when it is more than one ("a1600" is a piece never seen).
const A = 97
export function encodePic(pic) {
  let out = ''
  for (let i = 0; i < pic.length;) {
    let j = i + 1
    while (j < pic.length && pic[j] === pic[i]) j++
    out += String.fromCharCode(A + pic[i]) + (j - i > 1 ? j - i : '')
    i = j
  }
  return out
}
export function decodePic(text) {
  if (typeof text !== 'string' || text.length > MAP_N * MAP_N * 2) return null
  const pic = blank()
  let i = 0
  for (const m of text.matchAll(/([a-z])(\d*)/g)) {
    const c = m[1].charCodeAt(0) - A, n = m[2] ? Number(m[2]) : 1
    if (c >= CLASSES.length || n < 1 || i + n > pic.length) return null
    pic.fill(c, i, i + n)
    i += n
  }
  return i === pic.length ? pic : null
}

export function exportMap(world) {
  const out = {}
  for (const [key, pic] of world.map) out[key] = encodePic(pic)
  return out
}
export function loadMap(world, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
  for (const [key, text] of Object.entries(saved)) {
    if (!/^-?\d+,-?\d+$/.test(key)) continue
    const pic = decodePic(text)
    if (pic) { world.map.set(key, pic); world.mapVer.set(key, 1) }
  }
}

// ---- landmarks ------------------------------------------------------------------------
const TALE_TITLES = Object.fromEntries(Object.values(TALES).map(t => [t.id, t.title]))
const PLACE_NAMES = { sampo_sea: "Turso's bay", sampo_mountain: 'The copper mountain', sampo_marsh: "The pike's pond" }

const CITY_X = (CITY.wx0 + CITY.pieces / 2) * PIECE, CITY_Y = (CITY.wy0 + CITY.pieces / 2) * PIECE

// Everything the map marks for good, in world tiles: the villages the player
// has reached, the city, the places of tales they have stood in, and the
// towns they have heard of and not reached (kind 'heard', at the middle of
// the town's piece, or of the city).
export function landmarks(world) {
  const out = []
  for (const key of world.visited) {
    if (key === 'city') {
      out.push({ key, kind: 'city', name: CITY.name, X: CITY_X, Y: CITY_Y })
      continue
    }
    const [wx, wy] = key.split(',').map(Number)
    if (!Number.isInteger(wx) || !Number.isInteger(wy)) continue
    const v = wx === 0 && wy === 0 ? { name: 'Koivula' } : villageAt(world.seed, wx, wy)
    if (!v) continue
    const at = world.pieces.get(key)?.village
    out.push({ key, kind: 'village', name: v.name, X: wx * PIECE + (at?.x ?? PIECE / 2), Y: wy * PIECE + (at?.y ?? PIECE / 2) })
  }
  for (const key of world.found) {
    const place = world.places.get(key)
    if (!place) continue
    const [wx, wy] = key.split(',').map(Number)
    out.push({ key, kind: 'place', name: PLACE_NAMES[place.id] ?? TALE_TITLES[place.id] ?? 'A place of a tale', X: wx * PIECE + PIECE / 2, Y: wy * PIECE + PIECE / 2 })
  }
  for (const key of world.heard) {
    if (world.visited.includes(key)) continue
    if (key === 'city') { out.push({ key, kind: 'heard', name: CITY.name, X: CITY_X, Y: CITY_Y }); continue }
    const [wx, wy] = key.split(',').map(Number)
    const v = villageAt(world.seed, wx, wy)
    if (v) out.push({ key, kind: 'heard', name: v.name, X: wx * PIECE + PIECE / 2, Y: wy * PIECE + PIECE / 2 })
  }
  return out
}
