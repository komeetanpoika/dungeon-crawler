// Shared map-generation helpers used by more than one gen-*.mjs generator.
// Moved out of gen-forest.mjs (leap-episodes Task 1) so gen-leap.mjs can
// reuse them without importing gen-forest.mjs itself — that file's bottom
// runs a generator loop on import, which would re-run and re-write the
// forest maps as a side effect of importing its helpers.
import { stampHouse3, plantTree, stampEdgeBand } from './lib.mjs'

export const GRASS = ['ow_grass_0', 'ow_grass_0', 'ow_grass_0', 'ow_grass_1', 'ow_grass_2']
// Tree kits (see plantTree): 2-tall pairs plus approved 1-tile trees;
// ow_bush_round reads as a bush, so it is a rare accent, not a tree.
export const PINES = { tall: [['ow_tree_pine_top', 'ow_tree_pine_trunk']], small: ['ow_tree_small', 'ow_tree_small', 'ow_bush_round'] }
export const AUTUMN = { tall: [['ow_tree_autumn_top', 'ow_tree_autumn_trunk']], small: ['ow_tree_small_autumn', 'ow_tree_autumn_top'] }
export const DIRT = ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2', 'ow_dirt_3']
export const ROCKS_MOSS = ['ow_rock_gray_moss_0', 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2']
export const pick = (rng, a) => a[Math.floor(rng() * a.length)]
export const isOpen = b => (x, y) => b.walkable(x, y) && b.prop[y][x] === -1
// Circular prop-clearing buffer around a POI. Every dungeon entrance needs
// one before stampCaveInRocks/stampHouse3 etc: the runtime gate stamp
// (openmap.js) always walls the two flank cells (x-1,y) and (x+2,y) beside
// the arch, so an entrance carved straight into un-cleared terrain can end
// up with only a single-tile-wide approach that the stamp then severs.
export function clearing(b, cx, cy, r) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) b.clearProp(cx + x, cy + y)
}

export function forestEdge(b, rng, kit) {
  stampEdgeBand(b, rng, (x, y) => {
    if (b.palette[b.ground[y][x]]?.startsWith('ow_water')) return
    plantTree(b, rng, x, y, kit)
  })
}

export function grassBase(b, rng) {
  // flower variants are loud — keep them rare accents
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++)
    b.g(x, y, rng() < 0.95 ? 'ow_grass_0' : pick(rng, ['ow_grass_1', 'ow_grass_2']))
}

export function stampVillage(b, rng, cx, cy) {
  // clear a plaza and lay cobble
  for (let y = -6; y <= 6; y++) for (let x = -8; x <= 8; x++)
    if (b.in(cx + x, cy + y)) { b.clearProp(cx + x, cy + y); if (x * x + y * y < 14) b.g(cx + x, cy + y, 'ow_cobble_green') }
  const spots = [[-6, -4], [3, -5], [-6, 3], [4, 3]]
  for (const [dx, dy] of spots) stampHouse3(b, rng, cx + dx, cy + dy, rng() < 0.5 ? 'red' : 'brown')
  b.p(cx, cy - 1, 'ow_well_top'); b.p(cx, cy, 'ow_well')
  b.p(cx - 2, cy + 1, 'ow_sign', { walkable: false })
  // fenced yard — l/m/r so the run has finished ends
  for (let x = -2; x <= 2; x++) b.p(cx + x, cy + 5, x === -2 ? 'ow_fence_l' : x === 2 ? 'ow_fence_r' : 'ow_fence_m')
}

export function stampCaveInRocks(b, rng, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++)
    if (Math.abs(dx) + Math.abs(dy) < 3 && rng() < 0.92) b.p(x + dx, y + dy, pick(rng, ROCKS_MOSS))
  // the arch is an l+r pair you can stand in; clear first — a rock planted
  // underneath would otherwise keep the cell blocked
  b.clearProp(x, y); b.clearProp(x + 1, y)
  b.clearProp(x, y + 1); b.clearProp(x + 1, y + 1)
  b.p(x, y, 'ow_cave_arch_0', { walkable: true }); b.p(x + 1, y, 'ow_cave_arch_1', { walkable: true })
}
