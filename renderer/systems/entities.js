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
}

export const ALERT = {
  UNAWARE: 'unaware',
  CURIOUS: 'curious',
  SEARCHING: 'searching',
  ALERTED: 'alerted',
}

export const DRAGON_STATE = {
  SLEEPING: 'sleeping',
  STIRRING: 'stirring',
  AWAKE: 'awake',
}

export const WEAPON_TYPES = {
  dagger:   { name: 'Dagger',   damage: 1 },
  sword:    { name: 'Sword',    damage: 2 },
  longsword:{ name: 'Longsword',damage: 3 },
  axe:      { name: 'Axe',      damage: 4 },
}

export function isWalkable(tileId) {
  return tileId !== TILE.WALL && tileId !== TILE.COLUMN
}

export function makePlayer(x, y, bonuses = []) {
  const quietSteps = bonuses.filter(b => b === 'quiet_step').length
  const extraSlots = bonuses.filter(b => b === 'extra_slot').length
  return {
    type: 'player',
    x, y,
    hp: 10,
    maxHp: 10,
    inventory: [],
    maxInventory: 5 + extraSlots,
    noiseFootprint: Math.max(0, 2 - quietSteps),
    bonuses,
    weapon: null,
  }
}

export function makeGuard(x, y, patrol = []) {
  return {
    type: 'guard', x, y,
    facing: 'south', fovAngle: 90, fovRange: 5,
    patrol, patrolIndex: 0,
    alertState: ALERT.UNAWARE,
    hearingRadius: 4, hp: 4,
    moveCooldown: 2, moveTimer: 0,
  }
}

const MONSTER_VARIANTS = {
  weak:   { hp: 1, damage: 0 },
  medium: { hp: 2, damage: 1 },
  strong: { hp: 3, damage: 1 },
  boss:   { hp: 5, damage: 2 },
}

export function makeMonster(x, y, variant = 'weak') {
  const stats = MONSTER_VARIANTS[variant] ?? MONSTER_VARIANTS.weak
  return {
    type: 'monster', x, y, variant,
    wanderRadius: 3,
    alertState: ALERT.UNAWARE,
    hearingRadius: 3,
    hp: stats.hp,
    damage: stats.damage,
  }
}

export function makeTrap(x, y, trapType = 'pressure_plate') {
  return { type: 'trap', x, y, trapType, triggered: false, noiseBurst: 8 }
}

export function makePuzzle(x, y, puzzleType = 'lever') {
  return { type: 'puzzle', x, y, puzzleType, solved: false, reward: null }
}

export function makeDragon(x, y, roomId) {
  return { type: 'dragon', x, y, sleepMeter: 0, dragonState: DRAGON_STATE.SLEEPING, roomId, moveTimer: 0 }
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
