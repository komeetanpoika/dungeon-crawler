// The interior tile kit: every picture a house's inside is laid from, by
// name. The pictures are cut from Kenney's Roguelike/RPG pack (CC0, the same
// pack the Wilds takes its outdoor art from) by tools/interiors/extract-tiles.mjs,
// which also draws the few pieces the pack lacks. Names only: nothing here
// knows where a picture came from.
//
// Walls are seen the way the pack draws them: a wall top (the thickness of
// the wall, from above) and, below a wall that faces south into a room, two
// rows of wall face. Tall furniture stands on the face rows, so it takes no
// floor.

export const PALETTES = ['plaster', 'grey', 'pale', 'wood']

// Wall-top neighbour mask: N=1, E=2, S=4, W=8 (a neighbour that is also a wall top).
export const N = 1, E = 2, S = 4, W = 8

const wallSet = p => ({
  top: Array.from({ length: 16 }, (_, m) => `in_wall_${p}_${m}`),
  // the face's upper row (a lit band at the top) and lower row (a baseboard);
  // l/r are the ends where the face meets a wall or a doorway
  faceU: { l: `in_faceu_${p}_l`, m: `in_faceu_${p}_m`, r: `in_faceu_${p}_r` },
  faceL: { l: `in_facel_${p}_l`, m: `in_facel_${p}_m`, r: `in_facel_${p}_r`, lr: `in_facel_${p}_lr` },
})
export const WALLS = Object.fromEntries(PALETTES.map(p => [p, wallSet(p)]))

// Floors: each has a worn twin for houses nobody keeps.
export const FLOORS = {
  planks: ['in_floor_planks', 'in_floor_planks_worn'],
  boards: ['in_floor_boards', 'in_floor_boards_worn'],
  flags: ['in_floor_flags', 'in_floor_flags_worn'],
  greyflags: ['in_floor_greyflags', 'in_floor_greyflags_worn'],
  cream: ['in_floor_cream', 'in_floor_cream_worn'],
  earth: ['in_floor_earth', 'in_floor_earth_worn'],
}

// Bordered rugs, 3x3: rows top/middle/bottom, columns left/middle/right. A
// bigger rug repeats the middle row and column.
const rug = c => ['t', 'm', 'b'].map(v => ['l', 'm', 'r'].map(h => `in_rug_${c}_${v}${h}`))
export const RUGS = { green: rug('green'), orange: rug('orange'), red: rug('red'), blue: rug('blue') }

// Furniture and wall dressing. `on`:
//   face       stands on both face rows of a north wall (two rows of tiles)
//   faceUpper  hangs on the upper face row (a window, a painting)
//   faceLower  stands against the wall on the lower face row (a dresser, a stove)
//   floor      stands on the floor; `block` (default true) makes the cell solid
// `tiles` are rows of names, top row first. `dusty`: has `_d` twins for
// abandoned houses (every name in tiles + '_d'). A name may serve more than
// one item (the bar is shelves and worktops); it then belongs to the first
// item listed (interior/versions.js dress).
const it = (on, tiles, extra = {}) => ({ on, tiles, ...extra })
export const ITEMS = {
  // ---- on the face, two rows
  wardrobe: it('face', [['in_wardrobe_t'], ['in_wardrobe_b']], { dusty: true }),
  wardrobe2: it('face', [['in_wardrobe2_t'], ['in_wardrobe2_b']], { dusty: true }),
  vanity: it('face', [['in_vanity_t'], ['in_vanity_b']], { dusty: true }),
  tallmirror: it('face', [['in_tallmirror_t'], ['in_tallmirror_b']], { dusty: true }),
  bookcase: it('face', [['in_books_1'], ['in_books_2']], { dusty: true }),
  bookcase2: it('face', [['in_books_3'], ['in_books_4']], { dusty: true }),
  shelves: it('face', [['in_shelf_empty'], ['in_books_5']], { dusty: true }),
  hearth: it('face', [['in_hearth_t'], ['in_hearth_b']]),
  hearth_cold: it('face', [['in_hearth_t_cold'], ['in_hearth_b_cold']]),
  window_tall: it('face', [['in_window_tall_t'], ['in_window_tall_b']]),
  window_tall_orange: it('face', [['in_window_orange_t'], ['in_window_orange_b']]),
  window_tall_green: it('face', [['in_window_green_t'], ['in_window_green_b']]),
  window_tall_teal: it('face', [['in_window_teal_t'], ['in_window_teal_b']]),
  // ---- upper face row
  window: it('faceUpper', [['in_window']]),
  window_white: it('faceUpper', [['in_window_white']]),
  window_curtain: it('faceUpper', [['in_window_curtain']]),
  window_round: it('faceUpper', [['in_window_round']]),
  window_broken: it('faceUpper', [['in_window_broken']]),
  painting_green: it('faceUpper', [['in_painting_green']], { dusty: true }),
  painting_orange: it('faceUpper', [['in_painting_orange']], { dusty: true }),
  painting_teal: it('faceUpper', [['in_painting_teal']], { dusty: true }),
  portrait: it('faceUpper', [['in_portrait']], { dusty: true }),
  mirror: it('faceUpper', [['in_mirror_round']], { dusty: true }),
  clock: it('faceUpper', [['in_clock']], { dusty: true }),
  plateshelf: it('faceUpper', [['in_plateshelf']], { dusty: true }),
  potshelf: it('faceUpper', [['in_potshelf']], { dusty: true }),
  bottleshelf: it('faceUpper', [['in_bottleshelf']], { dusty: true }),
  hanging_pots: it('faceUpper', [['in_hanging_pots']]),
  antlers: it('faceUpper', [['in_antlers']]),
  banner_orange: it('faceUpper', [['in_banner_orange']]),
  banner_teal: it('faceUpper', [['in_banner_teal']]),
  banner_green: it('faceUpper', [['in_banner_green']]),
  torch: it('faceUpper', [['in_torch']]),
  net: it('faceUpper', [['in_net_l', 'in_net_m', 'in_net_r']]),
  web_wall: it('faceUpper', [['in_web_wall']]),
  // ---- lower face row
  dresser: it('faceLower', [['in_dresser']], { dusty: true }),
  nightstand: it('faceLower', [['in_nightstand']], { dusty: true }),
  cupboard: it('faceLower', [['in_cupboard']], { dusty: true }),
  drawers: it('faceLower', [['in_drawers']], { dusty: true }),
  stove: it('faceLower', [['in_stove']]),
  oven: it('faceLower', [['in_oven']]),
  oven_cold: it('faceLower', [['in_oven_cold']]),
  sink: it('faceLower', [['in_sink']], { dusty: true }),
  dishes: it('faceLower', [['in_dishes']], { dusty: true }),
  jars: it('faceLower', [['in_jars']], { dusty: true }),
  worktop: it('faceLower', [['in_worktop']], { dusty: true }),
  wallchest: it('faceLower', [['in_chest']], { dusty: true }),
  // ---- on the face, two rows, from pieces above
  // the taproom's bar: a counter three cells long, bottles on the shelf
  // above it (the pack has no counter: kitchen worktops and shelves)
  bar: it('face', [['in_bottleshelf', 'in_plateshelf', 'in_bottleshelf'], ['in_worktop', 'in_worktop', 'in_worktop']], { dusty: true }),
  // ---- floor
  bed_v: it('floor', [['in_bed_v_t'], ['in_bed_v_b']], { dusty: true }),
  bed_v2: it('floor', [['in_bed_v2_t'], ['in_bed_v2_b']], { dusty: true }),
  bed_v3: it('floor', [['in_bed_v3_t'], ['in_bed_v3_b']], { dusty: true }),
  bed_unmade: it('floor', [['in_bed_v4_t'], ['in_bed_v4_b']], { dusty: true }),
  bedroll: it('floor', [['in_bedroll']], { block: false }),
  bedroll2: it('floor', [['in_bedroll2']], { block: false }),
  table: it('floor', [['in_table_l', 'in_table_r']], { dusty: true }),
  table_food: it('floor', [['in_table_food_l', 'in_table_food_r']]),
  table_cards: it('floor', [['in_table_cards_l', 'in_table_cards_r']]),
  table_small: it('floor', [['in_table_small']], { dusty: true }),
  table_candle: it('floor', [['in_table_candle']], { dusty: true }),
  table_books: it('floor', [['in_table_books']], { dusty: true }),
  table_broken: it('floor', [['in_table_broken']]),
  chair_s: it('floor', [['in_chair_s']], { dusty: true, block: false }),
  chair_n: it('floor', [['in_chair_n']], { dusty: true, block: false }),
  chair_e: it('floor', [['in_chair_e']], { dusty: true, block: false }),
  chair_w: it('floor', [['in_chair_w']], { dusty: true, block: false }),
  chair_down: it('floor', [['in_chair_down']], { block: false }),
  stool: it('floor', [['in_stool']], { dusty: true, block: false }),
  armchair: it('floor', [['in_armchair']], { dusty: true }),
  bench: it('floor', [['in_bench']], { dusty: true }),
  // a bench along a taproom table, sat on and walked over like a chair
  bench_seat: it('floor', [['in_bench', 'in_bench']], { dusty: true, block: false }),
  barrel: it('floor', [['in_barrel']], { dusty: true }),
  barrel2: it('floor', [['in_barrel2']], { dusty: true }),
  barrel3: it('floor', [['in_barrel3']], { dusty: true }),
  crate: it('floor', [['in_crate']], { dusty: true }),
  crate_bread: it('floor', [['in_crate_bread']]),
  crate_cheese: it('floor', [['in_crate_cheese']]),
  crate_greens: it('floor', [['in_crate_greens']]),
  sack: it('floor', [['in_sack']], { dusty: true }),
  sack2: it('floor', [['in_sack2']], { dusty: true }),
  grain: it('floor', [['in_grain']]),
  chest: it('floor', [['in_floorchest']], { dusty: true }),
  anvil: it('floor', [['in_anvil']]),
  logs: it('floor', [['in_logs']]),
  candelabra: it('floor', [['in_candelabra']]),
  plant: it('floor', [['in_plant_a']]),
  plant2: it('floor', [['in_plant_b']]),
  plant3: it('floor', [['in_plant_c']]),
  plant_dead: it('floor', [['in_plant_dead']]),
  statue: it('floor', [['in_statue_t'], ['in_statue_b']]),
  column: it('floor', [['in_column']]),
  gravestone: it('floor', [['in_gravestone']]),
  // flat things lying on the floor: walked over
  rubble: it('floor', [['in_rubble']], { block: false }),
  bones: it('floor', [['in_bones']], { block: false }),
  skull: it('floor', [['in_skull']], { block: false }),
  web: it('floor', [['in_web_floor']], { block: false }),
  web_tl: it('floor', [['in_web_tl']], { block: false }),
  web_tr: it('floor', [['in_web_tr']], { block: false }),
  books_floor: it('floor', [['in_books_floor']], { block: false }),
  puddle: it('floor', [['in_puddle']], { block: false }),
  eggs: it('floor', [['in_eggs']], { block: false }),
}

// Single pictures with a job of their own.
export const MISC = {
  void: 'in_void',            // outside the house: nothing drawn
  doormat: 'in_doormat',
  flowers: ['in_flower_a', 'in_flower_b', 'in_flower_c', 'in_flower_d'],
  // the puzzle house (interior/sunroom.js)
  mirror: { '/': 'in_sunmirror_a', '\\': 'in_sunmirror_b' },
  seed: 'in_sunseed', bloom: 'in_sunbloom',
  panel: 'in_panel', nicheTop: 'in_niche_top', nicheFloor: 'in_niche_floor', chestOpen: 'tile_0091',
}

const itemNames = Object.values(ITEMS).flatMap(i => {
  const names = i.tiles.flat()
  return i.dusty ? [...names, ...names.map(n => `${n}_d`)] : names
})

// Every name above, once: what the game must load before a house is drawn.
export const INTERIOR_SKINS = [...new Set([
  ...PALETTES.flatMap(p => [...WALLS[p].top, ...Object.values(WALLS[p].faceU), ...Object.values(WALLS[p].faceL)]),
  ...Object.values(FLOORS).flat(),
  ...Object.values(RUGS).flatMap(r => r.flat()),
  ...itemNames,
  MISC.void, MISC.doormat, ...MISC.flowers, MISC.mirror['/'], MISC.mirror['\\'], MISC.seed, MISC.bloom,
  MISC.panel, MISC.nicheTop, MISC.nicheFloor, MISC.chestOpen,
])]

// The dusty twin of an item tile, when there is one.
export const dusty = name => `${name}_d`
