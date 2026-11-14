// Moving the running game when the window re-centres: every position the
// state holds, in tiles or in pixels, shifts by the same amount so nothing
// in the game notices that the map under it was swapped.
//
// Positions are found by shape rather than from a list of entity types:
// an object with numeric `x` and `y` holds a tile, one with `px` and `py` a
// pixel position, plus a few pixel pairs under other names. That covers
// entities, their AI state (paths, patrol points, last-seen and home tiles),
// projectiles, ground zones and effects without each system registering.
const TILE_SIZE = 32
const PIXEL_PAIRS = [['px', 'py'], ['startPx', 'startPy'], ['targetPx', 'targetPy'], ['x0', 'y0'], ['x1', 'y1'], ['cx', 'cy']]
const num = v => typeof v === 'number' && Number.isFinite(v)
const plain = v => v !== null && typeof v === 'object' && !ArrayBuffer.isView(v) && !(v instanceof Map) && !(v instanceof Set)

export function shiftDeep(value, dxTiles, dyTiles, seen = new Set()) {
  if (!plain(value) || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) shiftDeep(item, dxTiles, dyTiles, seen)
    return
  }
  if (num(value.x) && num(value.y)) { value.x += dxTiles; value.y += dyTiles }
  for (const [kx, ky] of PIXEL_PAIRS) {
    if (num(value[kx]) && num(value[ky])) { value[kx] += dxTiles * TILE_SIZE; value[ky] += dyTiles * TILE_SIZE }
  }
  for (const key of Object.keys(value)) {
    // private caches (FOV lists, nav scratch) hold no positions of their own
    if (key.charCodeAt(0) === 95) continue
    const v = value[key]
    if (plain(v)) shiftDeep(v, dxTiles, dyTiles, seen)
  }
}

const LISTS = ['entities', 'projectiles', 'zones', 'fireZones', 'lightning', 'strikes', 'shockwaves', 'arcs',
  'hitEffects', 'caveEntrances', 'houseDoors', 'signs']
const SINGLES = ['player', 'blinkTrail', 'lastBossTile', 'tripPull', 'rite']

export function shiftState(state, dxTiles, dyTiles) {
  const seen = new Set()
  for (const key of SINGLES) shiftDeep(state[key], dxTiles, dyTiles, seen)
  for (const key of LISTS) shiftDeep(state[key], dxTiles, dyTiles, seen)
  shiftDeep(state.feedback?.floats, dxTiles, dyTiles, seen)
  // caches keyed to the old map or the old tiles
  delete state._flowFields
  if (state.player) { state.player._fovMap = null; state.player._fovLitMap = null }
}
