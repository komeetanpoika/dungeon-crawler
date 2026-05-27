export const TEMPLATES = {
  DRAGON_LAIR: {
    tiles: [
      '############',
      '#..........#',
      '#....D.....#',
      '#..........#',
      '#..........#',
      '#....T.....#',
      '#..........#',
      '############',
    ],
    width: 12, height: 8,
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
  { depth: 2, guardCount:  3, monsterDensity: 0,     trapDensity: 0.04, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'GATEHOUSE',   weapons: ['dagger'] },
  { depth: 3, guardCount:  4, monsterDensity: 0,     trapDensity: 0.05, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',      weapons: ['dagger'] },
  { depth: 4, guardCount:  5, monsterDensity: 0,     trapDensity: 0.06, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'INFIRMARY',   weapons: ['dagger', 'sword'] },
  { depth: 5, guardCount:  6, monsterDensity: 0.005, trapDensity: 0.07, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'VAULT',       weapons: ['dagger', 'sword'] },
  { depth: 6, guardCount:  7, monsterDensity: 0.007, trapDensity: 0.08, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,          weapons: ['sword', 'longsword'] },
  { depth: 7, guardCount:  8, monsterDensity: 0.010, trapDensity: 0.09, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',      weapons: ['sword', 'longsword', 'axe'] },
  { depth: 8, guardCount:  9, monsterDensity: 0.012, trapDensity: 0.10, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,          weapons: ['longsword', 'axe'] },
  { depth: 9, guardCount: 10, monsterDensity: 0.015, trapDensity: 0.11, puzzleDensity: 0.04, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'DRAGON_LAIR', weapons: ['longsword', 'axe'] },
]

export const FINAL_DEPTH = 9
