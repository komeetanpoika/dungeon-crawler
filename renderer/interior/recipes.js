// What each kind of room holds. Data only: interior/furnish.js reads it.
//
// A role:
//   floor    floor names (kit FLOORS keys), one picked per room
//   face     things on the north wall's face, in order: { items, n, must, at }
//            n: a count or [lo, hi]; must: placed before anything else;
//            at: 'mid' (near the middle of the run) | 'spread' (spaced out) | 'any'
//   centre   a group in the middle of the floor (see GROUPS), or null
//   wall     things along the walls: { items, n, at }
//            at: 'north' (under the face) | 'side' (west/east walls) |
//                'south' | 'corner' | 'edge' (any of those) | 'any'
//   rug      rug colours to pick from when the centre group wants one
//
// Items are kit ITEMS ids; a list means one is picked per placement.

const WINDOWS = ['window', 'window_curtain', 'window_white', 'window_round']
const PAINTINGS = ['painting_green', 'painting_orange', 'painting_teal', 'portrait', 'mirror']
const BEDS = ['bed_v', 'bed_v2', 'bed_v3']
const BARRELS = ['barrel', 'barrel2', 'barrel3']
const SACKS = ['sack', 'sack2', 'grain']
const PLANTS = ['plant', 'plant2', 'plant3']
const FOOD = ['crate_bread', 'crate_cheese', 'crate_greens']
const BOOKS = ['bookcase', 'bookcase2', 'shelves']
const RUGS_ALL = ['green', 'orange', 'red', 'blue']

export const HOME = {
  hall: {
    floor: ['planks', 'boards', 'flags'],
    face: [
      { items: ['hearth'], n: 1, must: true, at: 'mid' },
      { items: WINDOWS, n: [1, 2], at: 'spread' },
      { items: PAINTINGS, n: [0, 2] },
      { items: ['clock', 'plateshelf'], n: [0, 1] },
      { items: ['dresser', 'cupboard', 'drawers'], n: [0, 1] },
    ],
    centre: 'dining', rug: RUGS_ALL,
    wall: [
      { items: ['armchair', 'bench'], n: [0, 1], at: 'north' },
      { items: [...BARRELS, 'crate'], n: [1, 2], at: 'corner' },
      { items: PLANTS, n: [0, 2], at: 'edge' },
    ],
  },
  bedroom: {
    floor: ['planks', 'boards'],
    face: [
      { items: ['wardrobe', 'wardrobe2'], n: 1, must: true },
      { items: WINDOWS, n: 1, at: 'spread' },
      { items: ['vanity', 'tallmirror'], n: [0, 1] },
      { items: ['nightstand', 'drawers'], n: [0, 1] },
      { items: PAINTINGS, n: [0, 1] },
    ],
    centre: 'rug', rug: RUGS_ALL,
    wall: [
      { items: BEDS, n: [1, 2], at: 'north', must: true },
      { items: ['chest'], n: [0, 1], at: 'edge' },
      { items: PLANTS, n: [0, 1], at: 'corner' },
    ],
  },
  kitchen: {
    floor: ['greyflags', 'cream', 'flags'],
    face: [
      { items: ['oven', 'stove'], n: 1, must: true },
      { items: ['sink', 'dishes', 'jars', 'worktop'], n: [1, 2] },
      { items: ['plateshelf', 'potshelf', 'hanging_pots', 'bottleshelf'], n: [1, 2] },
      { items: WINDOWS, n: [0, 1], at: 'spread' },
    ],
    centre: 'kitchen_table',
    wall: [
      { items: BARRELS, n: [1, 2], at: 'corner' },
      { items: [...SACKS, ...FOOD], n: [1, 2], at: 'edge' },
    ],
  },
  larder: {
    floor: ['flags', 'earth', 'greyflags'],
    face: [
      { items: ['shelves'], n: [0, 1] },
      { items: ['jars', 'cupboard'], n: 1, must: true },
      { items: ['potshelf', 'hanging_pots'], n: [0, 1] },
    ],
    centre: null,
    wall: [
      { items: [...BARRELS, 'crate', ...SACKS, ...FOOD], n: [3, 6], at: 'edge', must: true },
    ],
  },
  study: {
    floor: ['boards', 'planks'],
    face: [
      { items: BOOKS, n: [2, 3], must: true },
      { items: WINDOWS, n: [0, 1], at: 'spread' },
      { items: ['clock', 'portrait'], n: [0, 1] },
    ],
    centre: 'desk', rug: RUGS_ALL,
    wall: [
      { items: ['candelabra'], n: [0, 1], at: 'corner' },
      { items: ['chest', ...PLANTS], n: [0, 2], at: 'edge' },
      { items: ['books_floor'], n: [0, 1], at: 'any' },
    ],
  },
  // the work room of a household's trade; `trade` picks the variant
  workshop: {
    floor: ['greyflags', 'flags'],
    face: [{ items: ['shelves', 'cupboard'], n: [0, 1] }, { items: WINDOWS, n: [0, 1], at: 'spread' }],
    centre: null,
    wall: [{ items: BARRELS, n: [0, 1], at: 'corner' }],
  },
  woodshed: {
    floor: ['earth', 'flags'],
    face: [{ items: ['shelves'], n: [0, 1] }, { items: ['torch'], n: [0, 1] }],
    centre: null,
    wall: [{ items: ['logs'], n: [2, 4], at: 'edge', must: true }, { items: BARRELS, n: [0, 1], at: 'corner' }],
  },
  // a house of one room: hall, kitchen and bedroom at once
  cottage: {
    floor: ['planks', 'boards'],
    face: [
      { items: ['hearth'], n: 1, must: true, at: 'mid' },
      { items: WINDOWS, n: 1, at: 'spread' },
      { items: ['wardrobe', 'cupboard', 'potshelf', 'plateshelf'], n: [1, 2] },
    ],
    centre: 'dining_small', rug: RUGS_ALL,
    wall: [
      { items: BEDS, n: 1, at: 'north', must: true },
      { items: [...BARRELS, 'chest'], n: [1, 2], at: 'corner' },
    ],
  },
}

// What a trade adds: to the hall, and to a workshop when the house has one.
export const TRADES = {
  farmer: { hall: [{ items: SACKS, n: [1, 2], at: 'edge' }], workshop: [{ items: [...SACKS, ...FOOD], n: [3, 5], at: 'edge', must: true }] },
  hunter: { hallFace: [{ items: ['antlers'], n: 1, must: true }], workshop: [{ items: ['logs', 'crate', 'bedroll'], n: [2, 3], at: 'edge', must: true }], workshopFace: [{ items: ['antlers'], n: [1, 2], must: true }] },
  fisher: { hallFace: [{ items: ['net'], n: 1 }], workshop: [{ items: [...BARRELS, 'puddle'], n: [2, 4], at: 'edge', must: true }], workshopFace: [{ items: ['net'], n: 1, must: true }] },
  smith: { workshop: [{ items: ['anvil'], n: 1, at: 'any', must: true }, { items: ['logs', 'barrel3'], n: [1, 2], at: 'corner' }], workshopFace: [{ items: ['torch'], n: [1, 2], must: true }] },
  baker: { hall: [{ items: ['crate_bread'], n: 1, at: 'edge' }], workshop: [{ items: ['grain', 'sack', 'crate_bread'], n: [2, 4], at: 'edge', must: true }], workshopFace: [{ items: ['oven'], n: [1, 2], must: true }] },
  scholar: { hallFace: [{ items: BOOKS, n: 1, must: true }], workshopRole: 'study' },
  weaver: { hall: [{ items: ['sack2'], n: 1, at: 'edge' }], workshop: [{ items: ['sack2', 'sack', 'chest'], n: [2, 3], at: 'edge', must: true }, { items: ['table_small'], n: 1, at: 'any' }], workshopFace: [{ items: PAINTINGS, n: [1, 2], must: true }] },
}

// Bandits: a den with cards on the table and beds on the floor, and a stash.
export const HIDEOUT = {
  den: {
    floor: ['earth', 'boards', 'flags'],
    face: [
      { items: ['torch'], n: [1, 2], must: true, at: 'spread' },
      { items: ['hearth_cold', 'oven_cold'], n: [0, 1], at: 'mid' },
      { items: ['banner_orange', 'banner_teal', 'window_broken'], n: [0, 1] },
      { items: ['bottleshelf', 'cupboard', 'plateshelf'], n: [0, 1] },
    ],
    centre: 'cards',
    wall: [
      { items: ['bedroll', 'bedroll2'], n: [1, 2], at: 'edge', must: true },
      { items: [...BARRELS, 'crate'], n: [1, 3], at: 'corner' },
      { items: ['bones', 'rubble'], n: [0, 1], at: 'any' },
    ],
  },
  stash: {
    floor: ['earth', 'flags'],
    face: [{ items: ['torch'], n: [0, 1] }, { items: ['potshelf', 'cupboard'], n: [0, 1] }],
    centre: null,
    wall: [
      { items: ['crate', 'chest', ...BARRELS, ...SACKS], n: [3, 6], at: 'edge', must: true },
      { items: ['bedroll', 'bedroll2'], n: [0, 2], at: 'any' },
    ],
  },
}

// The keep's tower: grey stone, columns, what fell.
export const RUIN = {
  ruin_hall: {
    floor: ['greyflags'],
    face: [
      { items: ['banner_teal', 'banner_orange', 'torch', 'web_wall'], n: [1, 2], at: 'spread' },
      { items: ['hearth_cold'], n: [0, 1], at: 'mid' },
    ],
    centre: 'statue',
    wall: [
      { items: ['column'], n: [2, 4], at: 'edge', must: true },
      { items: ['rubble', 'bones', 'skull'], n: [2, 4], at: 'any' },
      { items: ['gravestone'], n: [0, 1], at: 'edge' },
    ],
  },
  ruin_room: {
    floor: ['greyflags'],
    face: [{ items: ['web_wall', 'torch', 'shelves'], n: [0, 2] }],
    centre: null,
    wall: [
      { items: ['column', 'chest', 'barrel3'], n: [1, 3], at: 'edge', must: true },
      { items: ['rubble', 'bones', 'skull', 'web'], n: [1, 3], at: 'any' },
    ],
  },
}

// The centre groups. A dining table: two cells of table, chairs round it,
// a rug under the lot.
export const GROUPS = {
  dining: { table: ['table'], chairs: [2, 4], rug: true },
  dining_small: { table: ['table_small', 'table_candle'], chairs: [1, 2], rug: true },
  kitchen_table: { table: ['table_small'], chairs: [0, 2], stools: true },
  desk: { table: ['table_books', 'table_candle'], chairs: [1, 1], rug: true },
  cards: { table: ['table_cards'], chairs: [2, 4] },
  statue: { single: 'statue' },
  rug: { rugOnly: true },
}

// Filling a big room: after its recipe, a room takes more of these until it
// holds about one floor thing per FILL_CELLS cells of floor and something on
// every other column of its wall face. `floor` things go along the walls,
// `flat` things (walked over) anywhere.
export const FILL_CELLS = 7
export const FILL = {
  hall: { floor: [...PLANTS, ...BARRELS, 'crate', 'sack', 'chest', 'candelabra', 'bench'], face: [...WINDOWS, ...PAINTINGS, 'clock', 'dresser', 'cupboard', 'plateshelf'] },
  bedroom: { floor: ['chest', ...PLANTS, 'table_candle', 'armchair', ...BEDS], face: [...WINDOWS, ...PAINTINGS, 'nightstand', 'dresser', 'drawers'] },
  kitchen: { floor: [...BARRELS, ...SACKS, ...FOOD, 'crate'], face: ['plateshelf', 'potshelf', 'hanging_pots', 'bottleshelf', 'jars', 'worktop', 'dishes'] },
  larder: { floor: [...BARRELS, ...SACKS, ...FOOD, 'crate'], face: ['potshelf', 'hanging_pots', 'jars', 'cupboard'] },
  study: { floor: ['candelabra', ...PLANTS, 'chest', 'table_books'], flat: ['books_floor'], face: [...BOOKS, ...PAINTINGS, 'clock'] },
  workshop: { floor: [...BARRELS, 'crate', 'sack', 'logs'], face: ['shelves', 'cupboard', 'torch', ...WINDOWS] },
  woodshed: { floor: ['logs', 'barrel3', 'crate'], face: ['torch', 'shelves'] },
  cottage: { floor: [...PLANTS, ...BARRELS, 'sack', 'chest'], face: [...WINDOWS, ...PAINTINGS, 'potshelf', 'plateshelf'] },
  sunhall: { floor: [...PLANTS, 'candelabra'], face: ['window_tall_teal', 'window_tall_green', 'bookcase', 'clock', ...PAINTINGS] },
  den: { floor: [...BARRELS, 'crate', 'sack'], flat: ['bedroll', 'bedroll2', 'bones'], face: ['torch', 'bottleshelf', 'window_broken', 'antlers'] },
  stash: { floor: ['crate', 'chest', ...BARRELS, ...SACKS], flat: ['bedroll'], face: ['torch', 'potshelf'] },
  ruin_hall: { floor: ['column', 'barrel3'], flat: ['rubble', 'bones', 'skull', 'web'], face: ['web_wall', 'torch', 'banner_teal'] },
  ruin_room: { floor: ['column', 'chest'], flat: ['rubble', 'bones', 'web'], face: ['web_wall', 'shelves'] },
}
