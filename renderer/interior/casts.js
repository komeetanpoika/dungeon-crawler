// Marks the cells that receive a furniture shadow: the cell under a standing
// thing gets `castAbove`, the name of what stands above it, and drawOverlay
// (render/tiles.js) paints that thing's shadow part there. Pure in the map.
import { MISC, SHADE_KIND } from './kit.js'

export function markCasts(map) {
  map.forEach((row, y) => row.forEach((cell, x) => {
    delete cell.castAbove
    const above = map[y - 1]?.[x]?.overlay
    if (above && SHADE_KIND.get(above) === 'cast' && cell.skin !== MISC.void) cell.castAbove = above
  }))
  return map
}
