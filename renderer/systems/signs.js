// Signpost lookup. Pure: the panel and pausing live in ui/ and game.js.
import { MAP_SIGNS } from '../data/signs.js'

export function signsForMap(name) {
  return (MAP_SIGNS[name] ?? []).map(s => ({ ...s }))
}

// The sign on or orthogonally adjacent to (x, y) — sign tiles are unwalkable,
// so in practice this means standing beside one. Null when there is none.
export function signNearby(signs, x, y) {
  return (signs ?? []).find(s => Math.abs(s.x - x) + Math.abs(s.y - y) <= 1) ?? null
}
