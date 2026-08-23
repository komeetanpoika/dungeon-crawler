// Multi-tile composite samples for the asset review server.
//
// Each item shows the composition the generators currently stamp, followed by
// candidate assemblies (mostly per Kenney's Tiny Town Sample.png). Cells are
// 'ow_*' (extracted tile in renderer/assets/tiles), 'tt:N' (Tiny Town source
// tile N, served straight from the downloaded pack), or null (ground shows).
export const ITEMS = [
  {
    id: 'gateway-gargoyle-fountains', title: 'Gargoyle gateway with fountain basins — refinement of #6', ground: 'ow_grass_0',
    note: 'Bottom row of candidate 6 with the dungeon fountain pairing added: gargoyle walls (tile_0019 dry / tile_0020 flowing) over their basins (tile_0031 empty / tile_0032 full), as prop_gargoyle_* + prop_fountain_* pair in dungeon levels.',
    options: [
      { label: 'A dungeon pairing: dry left, flowing right', grid: [
        ['tile_0019', 'ow_cave_arch_0', 'ow_cave_arch_1', 'tile_0020'],
        ['ow_fountain_basin_empty', null, null, 'ow_fountain_basin_full'],
      ] },
      { label: 'B both flowing', grid: [
        ['tile_0020', 'ow_cave_arch_0', 'ow_cave_arch_1', 'tile_0020'],
        ['ow_fountain_basin_full', null, null, 'ow_fountain_basin_full'],
      ] },
      { label: 'C both dry', grid: [
        ['tile_0019', 'ow_cave_arch_0', 'ow_cave_arch_1', 'tile_0019'],
        ['ow_fountain_basin_empty', null, null, 'ow_fountain_basin_empty'],
      ] },
      { label: 'D both flowing + rock ridge top (4x3)', grid: [
        ['ow_rock_gray_moss_1', 'ow_rock_gray_2', 'ow_rock_gray_1', 'ow_rock_gray_moss_2'],
        ['tile_0020', 'ow_cave_arch_0', 'ow_cave_arch_1', 'tile_0020'],
        ['ow_fountain_basin_full', null, null, 'ow_fountain_basin_full'],
      ] },
    ],
  },
  {
    id: 'gateway-decorated', title: 'Decorated dungeon gateway — 4x2 candidates', ground: 'ow_grass_0',
    note: 'Six 4-wide, 2-tall gateway assemblies around the 2-wide cave arch. Mixes Tiny Town overworld pieces with Tiny Dungeon masonry/props (same Kenney 16px style).',
    options: [
      { label: '1 mossy crag (natural ridge)', grid: [
        ['ow_rock_gray_moss_0', 'ow_rock_gray_2', 'ow_rock_gray_moss_2', 'ow_rock_gray_1'],
        ['ow_rock_gray_moss_1', 'ow_cave_arch_0', 'ow_cave_arch_1', 'ow_rock_gray_moss_0'],
      ] },
      { label: '2 vined arch + dead trees', grid: [
        [null, 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2', null],
        ['ow_deadtree_0', 'ow_cave_gate_l', 'ow_cave_gate_r', 'ow_deadtree_1'],
      ] },
      { label: '3 dwarven brickwork face', grid: [
        ['tile_0014', 'tile_0014', 'tile_0014', 'tile_0014'],
        ['tile_0014', 'ow_cave_arch_0', 'ow_cave_arch_1', 'tile_0014'],
      ] },
      { label: '4 torch-lit brick flanks', grid: [
        [null, 'tile_0014', 'tile_0014', null],
        [['tile_0014', 'tile_0107'], 'ow_cave_arch_0', 'ow_cave_arch_1', ['tile_0014', 'tile_0107']],
      ] },
      { label: '5 ancient sandstone portal', grid: [
        [null, 'ow_ruin_crack_0', 'ow_ruin_crack_1', null],
        ['ow_ruin_pillar', 'ow_cave_arch_0', 'ow_cave_arch_1', 'ow_ruin_pillar_2'],
      ] },
      { label: '6 carved sentinel faces', grid: [
        ['ow_rock_gray_moss_1', 'ow_rock_gray_2', 'ow_rock_gray_1', 'ow_rock_gray_moss_2'],
        ['tile_0019', 'ow_cave_arch_0', 'ow_cave_arch_1', 'tile_0020'],
      ] },
    ],
  },
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
    id: 'dungeon-entrance-l1', title: 'Dungeon entrance — level 1 (forest-1-clearings)', ground: 'ow_grass_0',
    note: 'Both level-1 entrances bake only ow_cave_arch_1 (tile 114, RIGHT half of the 2-wide arch); the left half (113) at the POI cell is missing. Cells below are the real map neighborhoods (cave 2 at 108,50 / cave 1 at 12,66).',
    options: [
      { label: 'BROKEN in-game: cave 2 (109,50)', grid: [
        [null, null, ['ow_dirt_0'], null, null, 'ow_tree_pine_trunk', 'ow_tree_small'],
        [null, 'ow_rock_gray_moss_0', ['ow_dirt_0'], 'ow_rock_gray_moss_1', null, 'ow_bush_round', 'ow_tree_small'],
        ['ow_rock_gray_moss_1', 'ow_rock_gray_moss_0', ['ow_dirt_0'], ['ow_grass_2', 'ow_cave_arch_1'], 'ow_rock_gray_moss_2', null, null],
        [null, 'ow_rock_gray_moss_0', null, null, null, null, null],
        [['ow_dirt_0'], null, null, null, null, 'ow_bush_1', 'ow_mushroom'],
      ] },
      { label: 'FIXED: arch_0 at POI cell (108,50)', grid: [
        [null, null, ['ow_dirt_0'], null, null, 'ow_tree_pine_trunk', 'ow_tree_small'],
        [null, 'ow_rock_gray_moss_0', ['ow_dirt_0'], 'ow_rock_gray_moss_1', null, 'ow_bush_round', 'ow_tree_small'],
        ['ow_rock_gray_moss_1', 'ow_rock_gray_moss_0', ['ow_dirt_0', 'ow_cave_arch_0'], ['ow_grass_2', 'ow_cave_arch_1'], 'ow_rock_gray_moss_2', null, null],
        [null, 'ow_rock_gray_moss_0', null, null, null, null, null],
        [['ow_dirt_0'], null, null, null, null, 'ow_bush_1', 'ow_mushroom'],
      ] },
      { label: 'BROKEN in-game: cave 1 (13,66)', grid: [
        [null, null, null, null, null, 'ow_bush_round', null],
        [['ow_dirt_0'], ['ow_dirt_0'], ['ow_dirt_0'], ['ow_grass_1', 'ow_rock_gray_moss_0'], null, 'ow_tree_pine_top', null],
        ['ow_rock_gray_moss_1', 'ow_rock_gray_moss_1', ['ow_dirt_0'], 'ow_cave_arch_1', 'ow_rock_gray_moss_1', ['ow_grass_2'], null],
        [null, 'ow_rock_gray_moss_0', null, null, null, null, null],
        [null, null, null, null, null, null, null],
      ] },
      { label: 'FIXED: arch_0 at POI cell (12,66)', grid: [
        [null, null, null, null, null, 'ow_bush_round', null],
        [['ow_dirt_0'], ['ow_dirt_0'], ['ow_dirt_0'], ['ow_grass_1', 'ow_rock_gray_moss_0'], null, 'ow_tree_pine_top', null],
        ['ow_rock_gray_moss_1', 'ow_rock_gray_moss_1', ['ow_dirt_0', 'ow_cave_arch_0'], 'ow_cave_arch_1', 'ow_rock_gray_moss_1', ['ow_grass_2'], null],
        [null, 'ow_rock_gray_moss_0', null, null, null, null, null],
        [null, null, null, null, null, null, null],
      ] },
    ],
  },
  {
    id: 'cave-mouth', title: 'Cave mouth pieces (isolated)', ground: 'ow_grass_0',
    note: 'The extracted pieces: 2-wide arch = ow_cave_arch_0 (113) + ow_cave_arch_1 (114); vined pair = ow_cave_gate_l/r (111/112); door = ow_cave_door (125).',
    options: [
      { label: 'current: ow_cave_arch_1 alone', grid: [['ow_cave_arch_1']] },
      { label: 'current: ow_cave_arch_0 alone', grid: [['ow_cave_arch_0']] },
      { label: '2-wide arch (arch_0 + arch_1)', grid: [['ow_cave_arch_0', 'ow_cave_arch_1']] },
      { label: '2-wide vined (gate_l + gate_r)', grid: [['ow_cave_gate_l', 'ow_cave_gate_r']] },
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
