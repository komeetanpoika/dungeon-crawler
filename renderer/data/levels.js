export const TEMPLATES = {
  DRAGON_LAIR: {
    tiles: [
      '########################',
      '##.....##########.....##',
      '#.......########.......#',
      '##.....##########.....##',
      '###...####.....####...##',
      '######.####...####.#####',
      '#######.##.....##.######',
      '########.........#######',
      '#########.......########',
      '##########.#############',
      '######................##',
      '####..................##',
      '###...................##',
      '##.....D...............#',
      '##...C...X...C.........#',
      '##.....T...............#',
      '###...................##',
      '####................####',
      '#########......#########',
      '########################',
    ],
    width: 24, height: 20,
  },
  SHRINE: {
    tiles: [
      '#######',
      '#.....#',
      '#..S..#',
      '#.....#',
      '#######',
    ],
    width: 7, height: 5,
  },
  VAULT: {
    tiles: [
      '#########',
      '#.......#',
      '#.W.W.W.#',
      '#.......#',
      '#########',
    ],
    width: 9, height: 5,
  },
  ARMORY: {
    tiles: [
      '##########',
      '#..W..W..#',
      '#........#',
      '#..####..#',
      '#..W..W..#',
      '##########',
    ],
    width: 10, height: 6,
  },
  GATEHOUSE: {
    tiles: [
      '###########',
      '#.W.W...W.#',
      '#.........#',
      '#####L#####',
      '#.........#',
      '#.........#',
      '#.........#',
      '###########',
    ],
    width: 11, height: 8,
  },
  INFIRMARY: {
    tiles: [
      '#########',
      '#.......#',
      '#.P...P.#',
      '#.......#',
      '#.P...P.#',
      '#.......#',
      '#########',
    ],
    width: 9, height: 7,
  },
}

export const LEVEL_CONFIG = [
  { depth: 1, guardCount:  2, monsterDensity: 0,     trapDensity: 0.03, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'ARMORY',     weapons: ['dagger'] },
  { depth: 2, guardCount:  3, monsterDensity: 0,     trapDensity: 0.04, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'GATEHOUSE',  weapons: ['dagger'],               crabCount: 1 },
  { depth: 3, guardCount:  4, monsterDensity: 0,     trapDensity: 0.05, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['dagger'],               wizardCount: 1, crabCount: 1 },
  { depth: 4, guardCount:  5, monsterDensity: 0,     trapDensity: 0.06, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'INFIRMARY',  weapons: ['dagger', 'sword'],      wizardCount: 1, crabCount: 2 },
  { depth: 5, guardCount:  6, monsterDensity: 0.005, trapDensity: 0.07, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'VAULT',      weapons: ['dagger', 'sword'],      wizardCount: 2 },
  { depth: 6, guardCount:  7, monsterDensity: 0.007, trapDensity: 0.08, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['sword', 'longsword'],   cyclopsArena: true },
  { depth: 7, guardCount:  8, monsterDensity: 0.010, trapDensity: 0.09, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['sword', 'longsword', 'axe'] },
  { depth: 8, guardCount:  9, monsterDensity: 0.012, trapDensity: 0.10, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['longsword', 'axe'] },
  { depth: 9, guardCount: 10, monsterDensity: 0.015, trapDensity: 0.11, puzzleDensity: 0.04, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'DRAGON_LAIR', weapons: ['longsword', 'axe'] },
]

export const DEPTH_THEMES = [
  {
    depths: [1, 2, 3],
    floorTile: 'floor',
    bgColor:  '#12121e',
    tint:     null,
    fogAlpha: 0.65,
    props: {
      room: ['prop_table', 'prop_chair', 'prop_anvil', 'prop_barrel',
             'prop_pipe_flow', 'prop_gargoyle_flow', 'prop_fountain_full'],
    },
  },
  {
    depths: [4, 5, 6],
    floorTile: 'sand',
    bgColor:  '#1a1206',
    tint:     'rgba(40,20,0,0.2)',
    fogAlpha: 0.65,
    props: {
      room: ['prop_pipe_dry', 'prop_gargoyle_dry', 'prop_fountain_empty',
             'prop_gravestone', 'prop_anvil'],
    },
  },
  {
    depths: [7, 8, 9],
    floorTile: 'floor',
    bgColor:  '#07070f',
    tint:     'rgba(0,0,20,0.35)',
    fogAlpha: 0.80,
    props: {
      room: ['prop_gravestone', 'prop_grave'],
    },
  },
]

export const FINAL_DEPTH = 9
