// Extract the overworld tile palette from the downloaded Kenney packs
// (CC0: Tiny Town, Roguelike/RPG pack) into renderer/assets/tiles/ under an
// ow_ prefix. Tiny Town ships loose 16x16 PNGs (copied + renamed); the RPG
// pack is a 57x31 spritesheet at 17px stride (sliced in chromium).
import { runPixels } from './px.mjs'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRATCH = process.env.SCRATCH
const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer/assets/tiles')

// --- RPG sheet slices: name -> [col, row] ---
export const RPG = {
  // water + shore
  ow_water_0: [0, 0], ow_water_1: [1, 0], ow_water_2: [0, 2], ow_water_3: [0, 1],
  ow_rock_water_brown_0: [54, 23], ow_rock_water_brown_1: [55, 23], ow_rock_water_brown_2: [56, 23],
  ow_rock_water_gray_0: [54, 24], ow_rock_water_gray_1: [55, 24], ow_rock_water_gray_2: [56, 24],
  ow_boat: [53, 18],
  ow_pier_post: [51, 23], ow_pier_log: [52, 23],
  // rocks
  ow_rock_brown_0: [54, 19], ow_rock_brown_1: [55, 19], ow_rock_brown_2: [56, 19],
  ow_rock_brown_moss_0: [54, 20], ow_rock_brown_moss_1: [55, 20], ow_rock_brown_moss_2: [56, 20],
  ow_rock_gray_0: [54, 21], ow_rock_gray_1: [55, 21], ow_rock_gray_2: [56, 21],
  ow_rock_gray_moss_0: [54, 22], ow_rock_gray_moss_1: [55, 22], ow_rock_gray_moss_2: [56, 22],
  // desert ground
  ow_sand_0: [8, 22], ow_sand_1: [7, 22], ow_sand_2: [8, 21], ow_sand_3: [7, 21],
  ow_sand_flat: [7, 26],
  ow_hardpan_0: [3, 19], ow_hardpan_1: [2, 19],
  ow_stone_ground_0: [8, 17],
  // rpg grass + oasis pond (3x3, sandy rim on grass)
  ow_grass_rpg_0: [5, 0], ow_grass_rpg_1: [5, 1],
  ow_pond_00: [2, 0], ow_pond_10: [3, 0], ow_pond_20: [4, 0],
  ow_pond_01: [2, 1], ow_pond_11: [3, 1], ow_pond_21: [4, 1],
  ow_pond_02: [2, 2], ow_pond_12: [3, 2], ow_pond_22: [4, 2],
  // flora
  ow_cactus: [22, 9], ow_shrub_0: [22, 10], ow_shrub_1: [22, 11],
  ow_deadtree_0: [27, 9], ow_deadtree_1: [27, 11],
  ow_bush_0: [24, 9], ow_bush_1: [25, 9], ow_bush_berry: [26, 10],
  ow_tree_apple: [23, 9],
  // sandstone ruins
  ow_ruin_wall_0: [13, 17], ow_ruin_wall_1: [14, 17], ow_ruin_wall_2: [17, 16],
  ow_ruin_gate: [17, 17], ow_ruin_gate_r: [18, 17],
  ow_ruin_pillar: [13, 19], ow_ruin_pillar_2: [14, 19], ow_ruin_rubble: [13, 18],
  ow_ruin_crack_0: [17, 19], ow_ruin_crack_1: [16, 19], ow_ruin_crack_2: [18, 19],
  // camp
  ow_tent_00: [46, 10], ow_tent_10: [47, 10], ow_tent_01: [46, 11], ow_tent_11: [47, 11],
}

// --- Tiny Town copies: name -> tile number ---
// Tiny Town composes multi-tile items (asset review, 2026-08-19): trees are
// top+trunk pairs, houses are roof-top + eaves + edged-wall rows, cave arches
// are l+r pairs (113+114 open, 111+112 gated), the well has a roof tile.
export const TT = {
  ow_grass_0: 0, ow_grass_1: 1, ow_grass_2: 2,
  // trees: 2-tall pairs + complete 1-tile trees; 5 reads as a bush
  ow_tree_pine_top: 4, ow_tree_pine_trunk: 16,
  ow_tree_autumn_top: 3, ow_tree_autumn_trunk: 15,
  ow_tree_small: 28, ow_tree_small_autumn: 27, ow_bush_round: 5,
  ow_mushroom: 29, ow_sign: 83, ow_well: 104, ow_well_top: 92, ow_beehive: 94,
  ow_dirt_0: 40, ow_dirt_1: 41, ow_dirt_2: 39, ow_dirt_3: 42,
  ow_cobble_green: 43,
  // house walls: l/m/r edged sets per material, doors matched to material
  ow_house_wall_l: 48, ow_house_wall: 49, ow_house_wall_r: 50, ow_house_wall_win: 51,
  ow_house_door: 85, ow_house_door_2: 89, ow_house_door_gray: 90,
  ow_house_wall_brown_l: 72, ow_house_wall_brown: 73, ow_house_wall_brown_r: 75, ow_house_arch_brown: 74,
  ow_house_wall_stone_l: 76, ow_house_wall_stone: 77, ow_house_wall_stone_r: 79, ow_house_arch_stone: 78,
  // roofs: top row + eaves row per colour, gables, slate rows
  ow_roof_red_l: 52, ow_roof_red_m: 53, ow_roof_red_r: 54,
  ow_roof_red_el: 64, ow_roof_red_em: 65, ow_roof_red_er: 66,
  ow_roof_gable_gray: 63, ow_roof_gable_red: 67,
  ow_roof_gray_l: 96, ow_roof_gray_m: 97, ow_roof_gray_r: 98,
  ow_roof_slate_l: 120, ow_roof_slate_m: 121, ow_roof_slate_r: 122,
  ow_roof_slate2_l: 108, ow_roof_slate2_m: 109, ow_roof_slate2_r: 110,
  ow_fence_l: 44, ow_fence_m: 45, ow_fence_r: 46, ow_fence_post: 47, ow_fence_v: 59,
  ow_cave_arch_0: 113, ow_cave_arch_1: 114,
  ow_cave_gate_l: 111, ow_cave_gate_r: 112,
  ow_cave_door: 125, ow_brick: 126,
}

const pad = n => String(n).padStart(4, '0')
for (const [name, n] of Object.entries(TT)) {
  fs.copyFileSync(path.join(SCRATCH, 'tiny-town-x/Tiles', `tile_${pad(n)}.png`), path.join(TILES, `${name}.png`))
}

const sheet = path.join(SCRATCH, 'rpg-x/Spritesheet/roguelikeSheet_transparent.png')
await runPixels({ sheet }, (images, slices) => {
  const files = {}
  for (const [name, [col, row]] of Object.entries(slices)) {
    const c = document.createElement('canvas')
    c.width = 16; c.height = 16
    const g = c.getContext('2d')
    g.imageSmoothingEnabled = false
    g.drawImage(images.sheet, col * 17, row * 17, 16, 16, 0, 0, 16, 16)
    files[name + '.png'] = c.toDataURL()
  }
  return { files }
}, RPG, TILES)

console.log(`extracted ${Object.keys(TT).length} tiny-town + ${Object.keys(RPG).length} rpg tiles -> ${TILES}`)
