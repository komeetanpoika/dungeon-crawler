// Multi-tile composite samples for the asset review server.
//
// Each item shows the composition the generators currently stamp, followed by
// candidate assemblies (mostly per Kenney's Tiny Town Sample.png). Cells are
// 'ow_*' (extracted tile in renderer/assets/tiles), 'tt:N' (Tiny Town source
// tile N, served straight from the downloaded pack), or null (ground shows).
export const ITEMS = [
  {
    id: 'tree-pine', title: 'Pine tree', ground: 'ow_grass_0',
    note: 'Generators scatter ow_tree_pine as a whole tree; in the pack it is the TOP half (tile 4), with tile 16 as its trunk half.',
    options: [
      { label: 'current: ow_tree_pine alone', grid: [['tt:4']] },
      { label: '2-tall: top 4 over trunk 16', grid: [['tt:4'], ['tt:16']] },
      { label: 'complete 1-tile pine (28)', grid: [['tt:28']] },
      { label: 'pine pair, 2-tall (6/18)', grid: [['tt:6'], ['tt:18']] },
      { label: 'slim pine, 2-tall (7/19)', grid: [['tt:7'], ['tt:19']] },
    ],
  },
  {
    id: 'tree-autumn', title: 'Autumn tree', ground: 'ow_grass_0',
    note: 'Same top/trunk split: ow_tree_pine_autumn is tile 3 (top), ow_tree_autumn is tile 15 (its trunk).',
    options: [
      { label: 'current: ow_tree_pine_autumn', grid: [['tt:3']] },
      { label: 'current: ow_tree_autumn', grid: [['tt:15']] },
      { label: '2-tall: top 3 over trunk 15', grid: [['tt:3'], ['tt:15']] },
      { label: 'complete 1-tile autumn (27)', grid: [['tt:27']] },
      { label: 'autumn pair, 2-tall (9/21)', grid: [['tt:9'], ['tt:21']] },
    ],
  },
  {
    id: 'tree-round', title: 'Round tree', ground: 'ow_grass_0',
    note: 'ow_tree_round is tile 16 — the pine TRUNK. ow_tree_big (5) and ow_tree_round2 (28) look complete.',
    options: [
      { label: 'current: ow_tree_round (trunk!)', grid: [['tt:16']] },
      { label: 'current: ow_tree_big', grid: [['tt:5']] },
      { label: 'current: ow_tree_round2', grid: [['tt:28']] },
    ],
  },
  {
    id: 'house-red', title: 'Red-roof house — round 2', ground: 'ow_grass_0',
    note: 'Per your notes: edged wall rows (48/50), window is 51 (55 was the chimney), and a gray-framed door (90) to match the gray walls.',
    options: [
      { label: 'current 2x2', grid: [['ow_roof_red_l', 'ow_roof_red_r'], ['ow_house_wall', 'ow_house_door']] },
      { label: '3-wide edged, gray door', grid: [['ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r'], ['ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er'], ['ow_house_wall_l', 'ow_house_door_gray', 'ow_house_wall_r']] },
      { label: '4-wide, window + gray door', grid: [['ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_m', 'ow_roof_red_r'], ['ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_em', 'ow_roof_red_er'], ['ow_house_wall_l', 'ow_house_wall_win', 'ow_house_door_gray', 'ow_house_wall_r']] },
      { label: '3-wide edged, orange door', grid: [['ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r'], ['ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er'], ['ow_house_wall_l', 'ow_house_door', 'ow_house_wall_r']] },
    ],
  },
  {
    id: 'house-gray', title: 'Gray-roof house — round 2', ground: 'ow_grass_0',
    note: 'Per your notes: edged brown wall rows (72/75) with the door between the edges; slate eaves row under the roof.',
    options: [
      { label: 'current 2x2 (brown walls)', grid: [['ow_roof_gray_l', 'ow_roof_gray_r'], ['ow_house_wall_brown', 'ow_house_door_2']] },
      { label: '3-wide edged + gable', grid: [['ow_roof_gray_l', 'ow_roof_gable_gray', 'ow_roof_gray_r'], ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'], ['ow_house_wall_brown_l', 'tt:86', 'ow_house_wall_brown_r']] },
      { label: '3-wide edged, plain roof', grid: [['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'], ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'], ['ow_house_wall_brown_l', 'tt:86', 'ow_house_wall_brown_r']] },
      { label: '3-wide, small door (87)', grid: [['ow_roof_gray_l', 'ow_roof_gable_gray', 'ow_roof_gray_r'], ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'], ['ow_house_wall_brown_l', 'tt:87', 'ow_house_wall_brown_r']] },
    ],
  },
  {
    id: 'house-stone', title: 'Stone house / lighthouse — round 2', ground: 'ow_grass_0',
    note: 'Per your notes: edged stone walls with the open arch (78) as the doorway.',
    options: [
      { label: 'current 1-wide', grid: [['ow_roof_gray_m'], ['ow_house_wall_stone']] },
      { label: '3-wide stone, arch door', grid: [['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'], ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'], ['ow_house_wall_stone_l', 'ow_house_arch_stone', 'ow_house_wall_stone_r']] },
      { label: '3-wide + gable, arch', grid: [['ow_roof_gray_l', 'ow_roof_gable_gray', 'ow_roof_gray_r'], ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'], ['ow_house_wall_stone_l', 'ow_house_arch_stone', 'ow_house_wall_stone_r']] },
      { label: 'slim tower (roof/wall/arch)', grid: [['ow_roof_gray_m'], ['ow_house_wall_stone'], ['ow_house_arch_stone']] },
    ],
  },
  {
    id: 'cave-mouth', title: 'Cave mouth', ground: 'ow_grass_0',
    note: 'Generators place single ow_cave_arch_1 (tile 114) — the RIGHT half of a 2-wide arch (113+114). 111/112 are a vined variant.',
    options: [
      { label: 'current: ow_cave_arch_1 alone', grid: [['ow_cave_arch_1']] },
      { label: 'current: ow_cave_arch_0 alone', grid: [['ow_cave_arch_0']] },
      { label: '2-wide arch (113+114)', grid: [['tt:113', 'tt:114']] },
      { label: '2-wide vined arch (111+112)', grid: [['tt:111', 'tt:112']] },
      { label: 'cave door tile (125)', grid: [['ow_cave_door']] },
    ],
  },
  {
    id: 'fence', title: 'Fence run', ground: 'ow_grass_0',
    note: 'Horizontal run l/m/r with post + vertical piece, as the forest village uses them.',
    options: [
      { label: 'current run', grid: [['ow_fence_l', 'ow_fence_m', 'ow_fence_m', 'ow_fence_r']] },
      { label: 'run with post', grid: [['ow_fence_l', 'ow_fence_m', 'ow_fence_post', 'ow_fence_m', 'ow_fence_r']] },
      { label: 'vertical run', grid: [['ow_fence_v'], ['ow_fence_v'], ['ow_fence_v']] },
    ],
  },
  {
    id: 'tent', title: 'Nomad tent (2x2, RPG pack)', ground: 'ow_sand_0',
    options: [
      { label: 'current 2x2', grid: [['ow_tent_00', 'ow_tent_10'], ['ow_tent_01', 'ow_tent_11']] },
    ],
  },
  {
    id: 'pond', title: 'Oasis pond (3x3, RPG pack)', ground: 'ow_sand_0',
    options: [
      { label: 'current 3x3', grid: [
        ['ow_pond_00', 'ow_pond_10', 'ow_pond_20'],
        ['ow_pond_01', 'ow_pond_11', 'ow_pond_21'],
        ['ow_pond_02', 'ow_pond_12', 'ow_pond_22'],
      ] },
    ],
  },
  {
    id: 'pier', title: 'Pier with boat (RPG pack)', ground: 'ow_water_0',
    options: [
      { label: 'current: log run + boat', grid: [
        ['ow_pier_log', 'ow_pier_log', 'ow_pier_log', 'ow_pier_log', null],
        [null, null, null, 'ow_boat', null],
      ] },
      { label: 'log run + posts', grid: [
        ['ow_pier_log', 'ow_pier_log', 'ow_pier_log', 'ow_pier_post'],
      ] },
    ],
  },
  {
    id: 'ruin', title: 'Sandstone ruin (RPG pack)', ground: 'ow_sand_0',
    options: [
      { label: 'wall run + gate', grid: [
        ['ow_ruin_wall_0', 'ow_ruin_gate', 'ow_ruin_gate_r', 'ow_ruin_wall_1'],
      ] },
      { label: 'pillars + rubble', grid: [
        ['ow_ruin_pillar', null, 'ow_ruin_pillar_2'],
        [null, 'ow_ruin_rubble', null],
      ] },
    ],
  },
  {
    id: 'village-props', title: 'Village props', ground: 'ow_grass_0',
    note: 'Well, sign and beehive as stamped between houses.',
    options: [
      { label: 'well', grid: [['ow_well']] },
      { label: 'sign', grid: [['ow_sign']] },
      { label: 'beehive', grid: [['ow_beehive']] },
      { label: 'mushroom', grid: [['ow_mushroom']] },
    ],
  },
]
