import { TILE } from '../systems/entities.js'

// Single source of truth for template character → meaning. Consumed by
// placeTemplate (game) and the editor's Build-tab palette. Adding a new symbol
// here is all that's needed for both sides to pick it up.
//   kind 'tile'  → sets map cell tile (walls get no roomId; everything else does)
//   kind 'spawn' → cell becomes FLOOR + roomId; pushes a spawn.
//     roomScoped: include roomId on the spawn (monsters yes; items/doors no)
//     single:     place at most one (the dragon boss)
// color/icon drive the editor palette + canvas; the game ignores them.
export const TEMPLATE_LEGEND = {
  '#': { label: 'Wall',     kind: 'tile',  tile: TILE.WALL,     color: '#3a3a44' },
  '.': { label: 'Floor',    kind: 'tile',  tile: TILE.FLOOR,    color: '#23232f' },
  'C': { label: 'Column',   kind: 'tile',  tile: TILE.COLUMN,   color: '#5a5a6a' },
  'T': { label: 'Treasure', kind: 'tile',  tile: TILE.TREASURE, color: '#b89030', icon: '◆' },
  'S': { label: 'Shrine',   kind: 'tile',  tile: TILE.SHRINE,   color: '#3a6a8a', icon: '⛨' },
  'X': { label: 'Snare',    kind: 'tile',  tile: TILE.SNARE,    color: '#7a3a3a', icon: '※' },
  'L': { label: 'Door',     kind: 'spawn', spawn: 'door',        roomScoped: false, color: '#8a6a3a', icon: '⌷' },
  'W': { label: 'Weapon',   kind: 'spawn', spawn: 'weapon',      roomScoped: false, color: '#3a8a6a', icon: '⚔' },
  'P': { label: 'Potion',   kind: 'spawn', spawn: 'potion',      roomScoped: false, color: '#8a3a8a', icon: '⚗' },
  'D': { label: 'Dragon',   kind: 'spawn', spawn: 'dragon',      roomScoped: true,  color: '#a33333', icon: '🐉' },
  'B': { label: 'Boss',     kind: 'spawn', spawn: 'dragon_boss', roomScoped: true, single: true, color: '#cc2222', icon: '🐲' },
}

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
      '##.....................#',
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
  GREAT_LAIR: {
    tiles: [
      '##########################',
      '##......................##',
      '#........................#',
      '#..........TT............#',
      '#..........BB............#',
      '#..........BB............#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '#........................#',
      '##......................##',
      '##########################',
    ],
    width: 26, height: 16,
  },
}

export const LEVEL_CONFIG = [
  { depth: 1, staircaseWidth: 1, guardCount:  2, monsterDensity: 0,     trapDensity: 0.03, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'ARMORY',     weapons: ['dagger'] },
  { depth: 2, staircaseWidth: 1, guardCount:  3, monsterDensity: 0,     trapDensity: 0.04, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'GATEHOUSE',  weapons: ['dagger'],               crabCount: 1 },
  { depth: 3, staircaseWidth: 1, guardCount:  4, monsterDensity: 0,     trapDensity: 0.05, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['dagger'],               wizardCount: 1, crabCount: 1 },
  { depth: 4, staircaseWidth: 1, guardCount:  5, monsterDensity: 0,     trapDensity: 0.06, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'INFIRMARY',  weapons: ['dagger', 'sword'],      wizardCount: 1, crabCount: 2 },
  { depth: 5, staircaseWidth: 1, guardCount:  6, monsterDensity: 0.005, trapDensity: 0.07, puzzleDensity: 0.02, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'VAULT',      weapons: ['dagger', 'sword'],      wizardCount: 2 },
  { depth: 6, staircaseWidth: 2, guardCount:  7, monsterDensity: 0.007, trapDensity: 0.08, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['sword', 'longsword'],   cyclopsArena: true },
  { depth: 7, staircaseWidth: 1, guardCount:  8, monsterDensity: 0.010, trapDensity: 0.09, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'SHRINE',     weapons: ['sword', 'longsword', 'axe'] },
  { depth: 8, staircaseWidth: 1, guardCount:  9, monsterDensity: 0.012, trapDensity: 0.10, puzzleDensity: 0.03, weaponDensity: 0.01, potionDensity: 0.005, landmark: null,         weapons: ['longsword', 'axe'] },
  { depth: 9, staircaseWidth: 3, guardCount: 10, monsterDensity: 0.015, trapDensity: 0.11, puzzleDensity: 0.04, weaponDensity: 0.01, potionDensity: 0.005, landmark: 'DRAGON_LAIR', weapons: ['longsword', 'axe'] },
  { depth: 10, staircaseWidth: 1, guardCount:  3, monsterDensity: 0.004, trapDensity: 0.05, puzzleDensity: 0.01, weaponDensity: 0.01, potionDensity: 0.01, landmark: 'GREAT_LAIR', weapons: ['longsword', 'axe'] },
]

export const DEPTH_THEMES = [
  {
    depths: [1, 2, 3],
    floorTile: 'floor',
    ruleset: 'catacombs',
    bgColor:  '#12121e',
    tint:     null,
    fogAlpha: 0.65,
    props: {
      room: ['prop_table', 'prop_chair', 'prop_anvil', 'prop_barrel'],
    },
  },
  {
    depths: [4, 5, 6],
    floorTile: 'sand',
    bgColor:  '#1a1206',
    tint:     'rgba(40,20,0,0.2)',
    fogAlpha: 0.65,
    props: {
      room: ['prop_gravestone', 'prop_anvil'],
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
  {
    depths: [10],
    floorTile: 'floor',
    bgColor:  '#0a0406',
    tint:     'rgba(60,10,0,0.35)',
    fogAlpha: 0.80,
    props: {
      room: ['prop_gravestone', 'prop_grave'],
    },
  },
]

export const FINAL_DEPTH = 10
