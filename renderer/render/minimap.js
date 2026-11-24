// The corner minimap: a small canvas of its own in the HUD, north up, the
// hero in the middle. It is redrawn only when the hero steps onto another
// tile or the map changes, never every frame: the game's own canvas is not
// touched (Electron here draws in software).
import { drawMap, mapStamp, pruneMapTiles } from './map-draw.js'

export const MINIMAP_PX = 160
export const MINIMAP_SCALE = 2   // pixels to a tile: 80 tiles across

let last = ''

// `hero`: { X, Y } in world tiles, or null to hide the minimap.
export function updateMinimap(world, hero, show) {
  const el = document.getElementById('minimap')
  if (!el) return
  const on = !!(show && world && hero)
  if (el.hidden === on) {
    el.hidden = !on
    document.body.classList.toggle('has-minimap', on)
    last = ''
  }
  if (!on) return
  const stamp = `${hero.X},${hero.Y},${mapStamp(world)}`
  if (stamp === last) return
  last = stamp
  if (el.width !== MINIMAP_PX) { el.width = MINIMAP_PX; el.height = MINIMAP_PX }
  pruneMapTiles(world)
  drawMap(el.getContext('2d'), world, { cx: hero.X + 0.5, cy: hero.Y + 0.5, scale: MINIMAP_SCALE, w: MINIMAP_PX, h: MINIMAP_PX, hero, edge: true })
}
