export const TILE = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  STAIRS_UP: 4,
  TREASURE: 5,
  SHRINE: 6,
  FLOOR_WOOD: 7,
  COLUMN: 8,
  SNARE: 9,
}

export const DRAGON_STATE = { SLEEPING: 'sleeping', STIRRING: 'stirring', AWAKE: 'awake' }

export const WEAPON_TYPES = {
  dagger:    { name: 'Dagger',    damage: 1 },
  sword:     { name: 'Sword',     damage: 2 },
  longsword: { name: 'Longsword', damage: 3 },
  axe:       { name: 'Axe',       damage: 4 },
}

export function isWalkable(tileId) {
  return tileId !== TILE.WALL && tileId !== TILE.COLUMN
}

export function hasLineOfSight(map, y1, x1, y2, x2) {
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  if (steps === 0) return true
  for (let i = 1; i <= steps; i++) {
    const y = Math.round(y1 + (dy * i) / steps)
    const x = Math.round(x1 + (dx * i) / steps)
    if (y === y2 && x === x2) break
    if (!map[y]?.[x] || !isWalkable(map[y][x].tile)) return false
  }
  return true
}

export function computePlayerFOV(map, player, radius = 8) {
  for (const row of map) for (const tile of row) tile.visible = false
  const { x: px, y: py } = player
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = px + dx, ty = py + dy
      if (!map[ty]?.[tx]) continue
      if (hasLineOfSight(map, py, px, ty, tx)) {
        map[ty][tx].visible = true
        map[ty][tx].explored = true
      }
    }
  }
}

export function makePlayer(x, y, bonuses = []) {
  const quietSteps = bonuses.filter(b => b === 'quiet_step').length
  const extraSlots = bonuses.filter(b => b === 'extra_slot').length
  return {
    type: 'player', x, y,
    hp: 10, maxHp: 10,
    inventory: [], maxInventory: 5 + extraSlots,
    noiseFootprint: Math.max(0, 2 - quietSteps),
    bonuses, weapon: null,
  }
}

export function makeGuard(x, y) {
  return { type: 'guard', x, y, hp: 4, maxHp: 4, inCombat: false }
}

const MONSTER_VARIANTS = {
  weak:   { hp: 1, damage: 1 },
  medium: { hp: 2, damage: 1 },
  strong: { hp: 3, damage: 1 },
  boss:   { hp: 5, damage: 2 },
}

export function makeMonster(x, y, variant = 'weak') {
  const stats = MONSTER_VARIANTS[variant] ?? MONSTER_VARIANTS.weak
  return { type: 'monster', x, y, variant, hp: stats.hp, maxHp: stats.hp, damage: stats.damage, inCombat: false }
}

export function makeTrap(x, y) {
  return { type: 'trap', x, y, triggered: false, noiseBurst: 8 }
}

export function makePuzzle(x, y) {
  return { type: 'puzzle', x, y, solved: false, reward: null }
}

export function makeDragon(x, y, roomId) {
  return { type: 'dragon', x, y, roomId, hp: 12, maxHp: 12, inCombat: false }
}

export function makeWeapon(x, y, weaponType = 'dagger') {
  const def = WEAPON_TYPES[weaponType] ?? WEAPON_TYPES.dagger
  return { type: 'weapon', x, y, weaponType, name: def.name, damage: def.damage }
}

export function makePotion(x, y, amount = 4) {
  return { type: 'potion', x, y, amount }
}

export function makeChest(x, y, contents) {
  return { type: 'chest', x, y, contents, opening: false, frame: 0 }
}

export function makeDoor(x, y) {
  return { type: 'door', x, y, opening: false, frame: 0 }
}
