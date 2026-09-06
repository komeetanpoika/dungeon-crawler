// House interiors: one of the five hand-drawn plans in data/house-layouts.js,
// stamped onto a fresh map, with the story prefab (if any) laid into the
// plan's slot and the tier's monsters, loot and dressing scattered over the
// floor. Replaces the BSP dungeon generator for houses — a cottage is a few
// rooms, not a 44x28 wing. Pure: no DOM, no state, injectable rand.
import { TILE, isWalkable, weaponContents } from './entities.js'
import { createMap, placeStructure, pickMonsterSpawn } from './map.js'
import { monstersForDepth } from './monsters.js'
import { HOUSE_LAYOUTS } from '../data/house-layouts.js'

// Spawns keep this Manhattan distance from the entry tile so nothing sits on
// the player the moment the door closes behind them.
const ENTRY_CLEARANCE = 3
// One prop per this many floor cells, clamped below.
const PROP_PER_CELLS = 14
const PROP_MIN = 1, PROP_MAX = 6

const rollCount = ([min, max] = [0, 0], rand) => min + Math.floor(rand() * (max - min + 1))
const shuffle = (arr, rand) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] }
  return arr
}

// Stamp a layout's glyphs; returns the entry tile.
function stampLayout(map, layout) {
  let spawn = null
  layout.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.' || ch === '@') { map[y][x].tile = TILE.FLOOR; map[y][x].roomId = 0 }
      if (ch === '@') spawn = { x, y }
    }
  })
  if (!spawn) throw new Error(`house layout "${layout.name}" has no entry tile`)
  return spawn
}

// cfg: an INTERIOR_CONFIG tier (systems/houses.js). Options:
//   structures — storyStructures() output: at most one prefab, laid into the
//                layout's slot (the first when several are passed)
//   layout     — force a plan (tests); default a random one
//   rand       — injectable RNG
// Returns { map, entitySpawns, playerSpawn, rooms: [], layout } in the shape
// game.js expects from generateLevel.
export function generateInterior(cfg, { structures = {}, layout = null, rand = Math.random } = {}) {
  const plan = layout ?? HOUSE_LAYOUTS[Math.floor(rand() * HOUSE_LAYOUTS.length)]
  const width = plan.rows[0].length, height = plan.rows.length
  const map = createMap(width, height)
  const entitySpawns = []
  const playerSpawn = stampLayout(map, plan)

  const prefab = Object.values(structures)[0]
  if (prefab) entitySpawns.push(...placeStructure(map, prefab, plan.slot.x, plan.slot.y, 1))

  const occupied = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
  occupied.add(`${playerSpawn.x},${playerSpawn.y}`)
  const floorTiles = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    if (isWalkable(map[y][x].tile)) floorTiles.push({ x, y })
  const free = t => !occupied.has(`${t.x},${t.y}`)
  const farTiles = shuffle(floorTiles.filter(t =>
    Math.abs(t.x - playerSpawn.x) + Math.abs(t.y - playerSpawn.y) > ENTRY_CLEARANCE && free(t)), rand)
  const take = () => { const t = farTiles.pop(); if (t) occupied.add(`${t.x},${t.y}`); return t }

  const guaranteed = cfg.guaranteed ?? []
  const monsterCount = Math.max(rollCount(cfg.monsters, rand), guaranteed.length)
  const genPool = monstersForDepth(cfg.depth)
  for (let i = 0; i < monsterCount; i++) {
    const t = take(); if (!t) break
    entitySpawns.push({ ...pickMonsterSpawn(cfg, cfg.depth, i, guaranteed, genPool, rand), ...t })
  }
  const potionCount = rollCount(cfg.potions, rand)
  for (let i = 0; i < potionCount; i++) {
    const t = take(); if (!t) break
    entitySpawns.push({ kind: 'floating_pickup', ...t, contents: { type: 'potion', amount: 4 } })
  }
  const weaponPool = cfg.weaponPool ?? []
  const weaponCount = weaponPool.length ? rollCount(cfg.weapons, rand) : 0
  for (let i = 0; i < weaponCount; i++) {
    const t = take(); if (!t) break
    const wt = weaponPool[Math.floor(rand() * weaponPool.length)]
    entitySpawns.push({ kind: 'floating_pickup', ...t, contents: { type: 'weapon', ...weaponContents(wt) } })
  }

  // Dressing: the tier's props on plain floor only — a story room brings its
  // own furniture, and props never block the entry's neighbours.
  const props = cfg.props ?? []
  if (props.length) {
    const propCount = Math.min(PROP_MAX, Math.max(PROP_MIN, Math.floor(floorTiles.length / PROP_PER_CELLS)))
    const spots = shuffle(floorTiles.filter(t => free(t) && !map[t.y][t.x].locked &&
      Math.abs(t.x - playerSpawn.x) + Math.abs(t.y - playerSpawn.y) > 1), rand)
    for (let i = 0; i < propCount && i < spots.length; i++) {
      const t = spots[i]
      occupied.add(`${t.x},${t.y}`)
      entitySpawns.push({ kind: 'prop', propType: props[Math.floor(rand() * props.length)], x: t.x, y: t.y })
    }
  }

  for (const row of map) for (const c of row) if (c.tile === TILE.FLOOR) c.tile = TILE.FLOOR_WOOD
  return { map, entitySpawns, playerSpawn, rooms: [], layout: plan.name }
}
