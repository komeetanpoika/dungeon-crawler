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
      { label: 'current: ow_tree_pine alone', grid: [['ow_tree_pine']] },
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
      { label: 'current: ow_tree_pine_autumn', grid: [['ow_tree_pine_autumn']] },
      { label: 'current: ow_tree_autumn', grid: [['ow_tree_autumn']] },
      { label: '2-tall: top 3 over trunk 15', grid: [['tt:3'], ['tt:15']] },
      { label: 'complete 1-tile autumn (27)', grid: [['tt:27']] },
      { label: 'autumn pair, 2-tall (9/21)', grid: [['tt:9'], ['tt:21']] },
    ],
  },
  {
    id: 'tree-round', title: 'Round tree', ground: 'ow_grass_0',
    note: 'ow_tree_round is tile 16 — the pine TRUNK. ow_tree_big (5) and ow_tree_round2 (28) look complete.',
    options: [
      { label: 'current: ow_tree_round (trunk!)', grid: [['ow_tree_round']] },
      { label: 'current: ow_tree_big', grid: [['ow_tree_big']] },
      { label: 'current: ow_tree_round2', grid: [['ow_tree_round2']] },
    ],
  },
  {
    id: 'house-red', title: 'Red-roof house', ground: 'ow_grass_0',
    note: 'Current 2x2 skips the roof eaves row (64-66) the pack expects between roof top (52-54) and walls.',
    options: [
      { label: 'current 2x2', grid: [['ow_roof_red_l', 'ow_roof_red_r'], ['ow_house_wall', 'ow_house_door']] },
      { label: '3-tall 2-wide + eaves', grid: [['tt:52', 'tt:54'], ['tt:64', 'tt:66'], ['tt:49', 'tt:85']] },
      { label: '3-tall 3-wide + window', grid: [['tt:52', 'tt:53', 'tt:54'], ['tt:64', 'tt:65', 'tt:66'], ['tt:49', 'tt:51', 'tt:85']] },
      { label: '3-wide, wall+win+door', grid: [['tt:52', 'tt:53', 'tt:54'], ['tt:64', 'tt:65', 'tt:66'], ['tt:48', 'tt:55', 'tt:85']] },
    ],
  },
  {
    id: 'house-gray', title: 'Gray-roof house', ground: 'ow_grass_0',
    note: 'Current pairs gray roof tops (96/98) directly with a wall row. Pack has slate rows (108-110 / 120-122) and gables (63).',
    options: [
      { label: 'current 2x2 (brown walls)', grid: [['ow_roof_gray_l', 'ow_roof_gray_r'], ['ow_house_wall_brown', 'ow_house_door_2']] },
      { label: '3-tall 2-wide + slate', grid: [['tt:96', 'tt:98'], ['tt:120', 'tt:122'], ['tt:73', 'tt:86']] },
      { label: '3-tall 3-wide + gable', grid: [['tt:96', 'tt:63', 'tt:98'], ['tt:120', 'tt:121', 'tt:122'], ['tt:73', 'tt:75', 'tt:86']] },
      { label: 'slate top + eaves (108/120)', grid: [['tt:108', 'tt:110'], ['tt:120', 'tt:122'], ['tt:73', 'tt:86']] },
    ],
  },
  {
    id: 'house-stone', title: 'Stone house / lighthouse', ground: 'ow_grass_0',
    note: 'sea-2 stacks ow_roof_gray_m on ow_house_wall_stone for the lighthouse.',
    options: [
      { label: 'current 1-wide', grid: [['ow_roof_gray_m'], ['ow_house_wall_stone']] },
      { label: '3-tall 1-wide + slate', grid: [['tt:97'], ['tt:121'], ['tt:77']] },
      { label: 'stone arch base (78)', grid: [['tt:97'], ['tt:121'], ['tt:78']] },
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
