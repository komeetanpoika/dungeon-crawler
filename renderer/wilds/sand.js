// Loose sand: the ground the desert's burrowers swim in and hide under
// (systems/monsters/hiekkamato.js, skorpioni.js). Judged by the cell alone,
// so it needs no knowledge of the world: a walkable cell, not one walked
// under (wilds/over.js), whose ground skin is the desert's rippled sand, a
// dune's shading, slip face or crest (wilds/desert-art.js), or a trail over
// sand (terrain.js SAND_PATH). Hardpan, a road, a village's paving, grass,
// rock and water are not. A floor with no outdoor skin at all (a dungeon,
// the monster bench's arena) counts as loose, so the creatures can be tried
// anywhere. DOM-free and pure.
import { isWalkable } from '../systems/entities.js'

const LOOSE = ['ow_sand_ripple_', 'ow_sand_shade_', 'ow_sand_slip_', 'ow_dune_', 'ow_path_sand_']
export const isLooseSkin = n => typeof n === 'string' && LOOSE.some(p => n.startsWith(p))

export function looseSand(map, x, y) {
  const c = map?.[y]?.[x]
  if (!c || c.over || !isWalkable(c.tile, c)) return false
  return typeof c.skin === 'string' && c.skin.startsWith('ow_') ? isLooseSkin(c.skin) : true
}

// Deep sand: loose, and loose on all eight sides. Where a burrower comes up:
// never on a cell beside hard ground, so a road is safe across its width.
export function deepSand(map, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!looseSand(map, x + dx, y + dy)) return false
  return true
}
