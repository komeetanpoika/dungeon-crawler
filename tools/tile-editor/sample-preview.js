// Renders a small fake dungeon patch using the *real* decoration engine, so
// what you see here is exactly what the game's pass will produce.
import { decorateMap } from '../../renderer/systems/decorate.js'
import { TILE } from '../../renderer/systems/entities.js'

const COLS = 12
const ROWS = 8

export function renderSample(canvas, ruleset, tileImages) {
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (!ruleset) return

  // Border of walls around floor, like a room.
  const map = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => ({
      tile: (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) ? TILE.WALL : TILE.FLOOR,
      skin: null,
    })))
  decorateMap(map, ruleset)

  const s = canvas.width / COLS
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const { tile, skin } = map[y][x]
    const img = skin && tileImages.get(skin)
    if (img) ctx.drawImage(img, x * s, y * s, s, s)
    else {
      ctx.fillStyle = tile === TILE.WALL ? '#33333d' : '#15151d'
      ctx.fillRect(x * s, y * s, s, s)
    }
  }
}
