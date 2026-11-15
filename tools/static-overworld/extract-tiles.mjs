// Extract the overworld tile palette from the downloaded Kenney packs
// (CC0: Tiny Town, Roguelike/RPG pack) into renderer/assets/tiles/ under an
// ow_ prefix. Tiny Town ships loose 16x16 PNGs (copied + renamed); the RPG
// pack is a 57x31 spritesheet at 17px stride (sliced in chromium).
//
// SCRATCH is a folder holding the two packs unzipped (both CC0, by Kenney):
//   $SCRATCH/tiny-town-x/  https://kenney.nl/assets/tiny-town
//   $SCRATCH/rpg-x/        https://kenney.nl/assets/roguelike-rpg-pack
//   SCRATCH=/path/to/packs node tools/static-overworld/extract-tiles.mjs
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
  ow_tent_tan_00: [48, 10], ow_tent_tan_10: [49, 10], ow_tent_tan_01: [48, 11], ow_tent_tan_11: [49, 11],
  // site dressing (the Wilds, 2026-11-15). ow_prop_* are low things a sight
  // line passes over (LOS_CLEAR_PREFIXES); ow_deco_* lie flat and are walked on.
  ow_prop_campfire_cold: [13, 8],
  ow_prop_stump_0: [53, 19], ow_prop_stump_1: [53, 20], ow_prop_stump_axe: [53, 21], ow_prop_woodpile: [53, 22],
  ow_prop_barrel_0: [22, 0], ow_prop_barrel_1: [23, 0], ow_prop_sack_0: [26, 2], ow_prop_sack_1: [27, 2],
  ow_prop_crate_0: [13, 7], ow_prop_crate_1: [14, 7], ow_prop_crate_2: [15, 7],
  ow_prop_grave_0: [51, 9], ow_prop_grave_1: [52, 9], ow_prop_grave_2: [51, 11], ow_prop_grave_3: [52, 11],
  ow_prop_cross_0: [53, 9], ow_prop_cross_1: [51, 10],
  ow_prop_mound: [41, 10], ow_prop_torch: [17, 7], ow_prop_signpost: [19, 0],
  ow_prop_bedroll_0: [12, 3], ow_prop_bedroll_1: [13, 3],
  ow_prop_counter_0: [11, 4], ow_prop_counter_1: [12, 4], ow_prop_counter_2: [13, 4],
  ow_stall_top: [10, 0], ow_stall_front: [10, 1], ow_stall_top_green: [11, 0], ow_stall_front_green: [11, 1],
  ow_statue_top: [50, 10], ow_statue: [50, 11],
  ow_deco_skull: [49, 9], ow_deco_crop_0: [22, 10], ow_deco_crop_1: [22, 11],
  ow_deco_flower_0: [28, 9], ow_deco_flower_1: [29, 9], ow_deco_flower_2: [30, 9], ow_deco_flower_3: [31, 9],
  ow_lily_0: [28, 10], ow_lily_1: [28, 11], ow_lily_2: [25, 11],
  // tale places (the Wilds, 2026-11-15)
  ow_deco_firepit: [13, 8], ow_kiln_cold: [12, 0], ow_mtn_rock_cap: [12, 0],
  ow_prop_fishrack_l: [51, 13], ow_prop_fishrack_r: [52, 13],
  // grey stone ruins
  ow_ruin_stub_0: [20, 18], ow_ruin_stub_1: [21, 18],
  ow_ruin_col_0: [20, 19], ow_ruin_col_1: [21, 19], ow_ruin_col_base_0: [20, 20], ow_ruin_col_base_1: [21, 20],
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
  ow_house_door: 85, ow_house_door_2: 89, ow_house_door_gray: 90, ow_house_door_brown: 86,
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
  // the house kit as Tiny Town means it (the Wilds, 2026-11-15): 48-50 and
  // 60-62 are the blue roof's two rows, not walls; 51/55 a chimney on roof;
  // 84/88 windows; 86+87 and 90+91 double doors
  ow_roof_blue_l: 48, ow_roof_blue_m: 49, ow_roof_blue_r: 50, ow_roof_blue_chim: 51,
  ow_roof_blue_el: 60, ow_roof_blue_em: 61, ow_roof_blue_er: 62,
  ow_roof_red_chim: 55,
  ow_house_win_brown: 84, ow_house_win_stone: 88,
  ow_house_dbl_brown_l: 86, ow_house_dbl_brown_r: 87, ow_house_dbl_stone_l: 90, ow_house_dbl_stone_r: 91,
  ow_castle_parapet_l: 99, ow_castle_parapet_m: 100, ow_castle_parapet_r: 101,
  // fence: 44/46 top corners (ow_fence_l/r), 45 run, 56/58 sides, 68/70
  // bottom corners, 69 and 80 the two ends beside a gate gap
  ow_fence_side_l: 56, ow_fence_side_r: 58, ow_fence_bl: 68, ow_fence_br: 70, ow_fence_end_r: 69, ow_fence_end_l: 80,
  ow_prop_cart: 57, ow_prop_target: 95, ow_prop_log: 106, ow_prop_pot: 107, ow_prop_bucket: 130, ow_prop_bucket_water: 131,
  ow_prop_pitchfork: 116,
  // a dirt patch with its own grass edge (field, yard)
  ow_patch_tl: 12, ow_patch_t: 13, ow_patch_tr: 14, ow_patch_l: 24, ow_patch_m: 25, ow_patch_r: 26,
  ow_patch_bl: 36, ow_patch_b: 37, ow_patch_br: 38,
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
