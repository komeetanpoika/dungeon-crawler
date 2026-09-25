// Hero movement against the map: the four-corner box test and the per-axis
// slide every walker uses. Lifted out of game.js so the PvP simulation
// (renderer/pvp/) steps heroes with the same rules. Pure: no DOM.
import { isWalkable } from './entities.js'
import { coreBlocks } from './capsules.js'

export const TILE_SIZE = 32
export const PLAYER_HALF = 6
export const PLAYER_SPEED = 120

export function canMoveTo(map, px, py, half = PLAYER_HALF) {
  const corners = [
    [px - half, py - half],
    [px + half, py - half],
    [px - half, py + half],
    [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const tile = map[Math.floor(cy / TILE_SIZE)]?.[Math.floor(cx / TILE_SIZE)]
    return tile && isWalkable(tile.tile, tile)
  })
}

export function moveEntity(e, dx, dy, map, half = PLAYER_HALF, boss = null) {
  const free = (px, py) => canMoveTo(map, px, py, half) && !(boss && coreBlocks(px, py, half, boss))
  if (dx !== 0 && free(e.px + dx, e.py)) e.px += dx
  if (dy !== 0 && free(e.px, e.py + dy)) e.py += dy
  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)
}
