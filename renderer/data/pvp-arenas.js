// Hand-authored PvP arenas (4b spec §1). buildArena makes the walled room,
// its `columns` and interior `walls`; the sim reads `spawns` and `pickups`
// itself; the client decorates the map with the arena's `theme` (the shape
// of a DEPTH_THEMES entry). Matches rotate through PVP_ARENA_ORDER.
const rect = (x, y, w, h) => {
  const cells = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy })
  return cells
}

// Today's depth-0 look (DEPTH_THEMES' depths [0, 5] entry): no ruleset.
// The outdoors ruleset's floor is the sand tile; the glade lays the Adventure
// maps' grass over it (skinFloors in systems/decorate.js), flowers rarest.
const GRASS = [{ skin: 'ow_grass_0', weight: 6 }, { skin: 'ow_grass_1', weight: 3 }, { skin: 'ow_grass_2', weight: 1 }]
const PILLARS_THEME = { floorTile: 'floor', bgColor: '#0a0406', tint: 'rgba(60,10,0,0.35)', fogAlpha: 0.80 }

const PICKUP_KIND = { F: 'flask', Q: 'quiver', R: 'rune' }

// A grid of equal-length strings → the arena shape. Legend: # wall (the
// border must be walls), o column, . floor, S spawn, F flask, Q quiver,
// R rune. Spawns and pickups are listed in reading order.
export function parseArena(id, rows, theme) {
  const h = rows.length, w = rows[0]?.length ?? 0
  if (!h || rows.some(r => r.length !== w)) throw new Error(`arena ${id}: rows must be equal-length strings`)
  const columns = [], walls = [], spawns = [], pickups = []
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
    if (ch === '#') { if (!edge) walls.push({ x, y }); return }
    if (edge) throw new Error(`arena ${id}: border cell ${x},${y} must be a wall`)
    if (ch === 'o') columns.push({ x, y })
    else if (ch === 'S') spawns.push({ x, y })
    else if (PICKUP_KIND[ch]) pickups.push({ kind: PICKUP_KIND[ch], x, y })
    else if (ch !== '.') throw new Error(`arena ${id}: unknown cell '${ch}' at ${x},${y}`)
  }))
  return { id, size: { w, h }, columns, walls, spawns, pickups, theme }
}

// Glade (30×22): two broken rings of trees around the rune and thickets
// by the walls — short sightlines, melee-friendly.
const GLADE = [
  '##############################',
  '#.............##.............#',
  '#.S...........##...........S.#',
  '#...##..................##...#',
  '#...##..oooo......oooo..##...#',
  '#.............F..............#',
  '#.....o................o.....#',
  '#.....o....ooo..ooo....o.....#',
  '#.....o....o......o....o..Q..#',
  '#............................#',
  '#.##....S.....R...........##.#',
  '#.##.................S....##.#',
  '#.....o....o......o....o.....#',
  '#..Q..o....ooo..ooo....o.....#',
  '#.....o................o.....#',
  '#..............F.............#',
  '#.......oooo......oooo.......#',
  '#...##..................##...#',
  '#...##..................##...#',
  '#.S...........##...........S.#',
  '#.............##.............#',
  '##############################',
]
// Tunnels (34×24): six small chambers in solid rock, joined by corridors two
// tiles wide, and a hall with the rune in the middle — chokepoints and blink.
const TUNNELS = [
  '##################################',
  '##################################',
  '##S.....######.....S######......##',
  '##...o..######...o..######.....S##',
  '##..........................o...##',
  '##..............................##',
  '##.....Q######......######......##',
  '##......######......######......##',
  '####..##########..##########..####',
  '####..##########..##########..####',
  '####..#######........#######..####',
  '####............R............F####',
  '####F.........................####',
  '####..#######........#######..####',
  '####..##########..##########..####',
  '####..##########..##########..####',
  '##......######......######......##',
  '##......######......######Q.....##',
  '##..............................##',
  '##..o...........................##',
  '##S.....######..o...######...o..##',
  '##......######S.....######.....S##',
  '##################################',
  '##################################',
]
// Ruins (36×26): open sand with scattered columns and a few broken walls;
// long clear lanes on rows 5-7, 12-13 and 18-20 — archer-friendly.
const RUINS = [
  '####################################',
  '#..................................#',
  '#.S..............................S.#',
  '#.....o..........o......o..........#',
  '#...........o................o.....#',
  '#..................................#',
  '#................Q.................#',
  '#..................................#',
  '#........###............###........#',
  '#...o..........o....o..........o...#',
  '#.........o.....#........o.........#',
  '#...............#..................#',
  '#.................R..............S.#',
  '#.S......F................F........#',
  '#..................#...............#',
  '#..................#...............#',
  '#......o.....o........o.....o......#',
  '#........###............###........#',
  '#..................................#',
  '#.................Q................#',
  '#..................................#',
  '#..........o...................o...#',
  '#...o.............o.....o..........#',
  '#.S..............................S.#',
  '#..................................#',
  '####################################',
]

// The grids as written, for the invariant tests.
export const ARENA_ROWS = { glade: GLADE, tunnels: TUNNELS, ruins: RUINS }

export const PVP_ARENAS = {
  // Four corner pillars, wall segments on each side for cover, four posts
  // ringing the exposed centre where the rune sits. 32×24 tiles: interior
  // x 1..30, y 1..22.
  pillars: {
    id: 'pillars',
    size: { w: 32, h: 24 },
    columns: [
      ...rect(6, 5, 2, 2), ...rect(24, 5, 2, 2), ...rect(6, 17, 2, 2), ...rect(24, 17, 2, 2),
      ...rect(13, 4, 6, 1), ...rect(13, 19, 6, 1),
      ...rect(4, 9, 1, 6), ...rect(27, 9, 1, 6),
      ...rect(11, 9, 2, 1), ...rect(19, 9, 2, 1), ...rect(11, 14, 2, 1), ...rect(19, 14, 2, 1),
      ...rect(9, 11, 1, 2), ...rect(22, 11, 1, 2),
    ],
    walls: [],
    spawns: [{ x: 2, y: 2 }, { x: 29, y: 2 }, { x: 2, y: 21 }, { x: 29, y: 21 }, { x: 15, y: 2 }, { x: 16, y: 21 }],
    pickups: [
      { kind: 'flask', x: 7, y: 12 }, { kind: 'flask', x: 24, y: 11 },
      { kind: 'quiver', x: 15, y: 6 }, { kind: 'quiver', x: 16, y: 17 },
      { kind: 'rune', x: 16, y: 12 },
    ],
    theme: PILLARS_THEME,
  },
  glade: parseArena('glade', GLADE, { ruleset: 'outdoors', floorTile: 'floor', floorSkins: GRASS, bgColor: '#0a1208', tint: null, fogAlpha: 0.65 }),
  tunnels: parseArena('tunnels', TUNNELS, { ruleset: 'catacombs', floorTile: 'floor', bgColor: '#07070f', tint: 'rgba(0,0,20,0.35)', fogAlpha: 0.80 }),
  ruins: parseArena('ruins', RUINS, { floorTile: 'sand', bgColor: '#1a1206', tint: 'rgba(40,20,0,0.2)', fogAlpha: 0.65 }),
}

export const PVP_ARENA_ORDER = ['pillars', 'glade', 'tunnels', 'ruins']

// The rotation: the arena at a (wrapping) index, and the index after it.
const N_ARENAS = PVP_ARENA_ORDER.length
export const arenaAt = i => PVP_ARENAS[PVP_ARENA_ORDER[((i % N_ARENAS) + N_ARENAS) % N_ARENAS]]
export const nextArenaIndex = i => (i + 1) % N_ARENAS
