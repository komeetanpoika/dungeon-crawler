// The window: the 3x3 block of pieces around the player, laid out as one
// ordinary map so every game system keeps seeing a fixed map[y][x] grid with
// a (0, 0) corner. When the player walks into a neighbouring piece the window
// re-centres on it (session.js) and every position shifts by a piece.
import { PIECE } from './layout.js'

export const WIN = 3
export const WIN_TILES = WIN * PIECE

// pieces[row][col] -> a WIN_TILES x WIN_TILES map whose rows hold the pieces'
// own cell objects: what happens to a cell happens to its piece.
export function assemble(pieces) {
  const map = new Array(WIN_TILES)
  for (let r = 0; r < WIN; r++) for (let y = 0; y < PIECE; y++) {
    const row = new Array(WIN_TILES)
    for (let c = 0; c < WIN; c++) {
      const src = pieces[r][c].cells[y]
      for (let x = 0; x < PIECE; x++) row[c * PIECE + x] = src[x]
    }
    map[r * PIECE + y] = row
  }
  return map
}

// `origin` is the window's top-left piece { wx, wy }.
export const toWindow = (origin, X, Y) => ({ x: X - origin.wx * PIECE, y: Y - origin.wy * PIECE })
export const toWorld = (origin, x, y) => ({ X: x + origin.wx * PIECE, Y: y + origin.wy * PIECE })

// Which way the window should step for a player at window tile (px, py):
// only once they are `margin` tiles into a neighbouring piece, so standing
// or fighting on a boundary never flips the window back and forth.
export function recentreStep(px, py, margin = 8) {
  const step = p => p < PIECE - margin ? -1 : p >= 2 * PIECE + margin ? 1 : 0
  return { dx: step(px), dy: step(py) }
}
