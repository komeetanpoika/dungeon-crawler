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
  SAND: 10,
  STAIR: 11,
}

export const DRAGON_STATE = { SLEEPING: 'sleeping', STIRRING: 'stirring', AWAKE: 'awake' }

export const WEAPON_TYPES = {
  dagger:    { name: 'Dagger',    damage: 1 },
  sword:     { name: 'Sword',     damage: 2 },
  longsword: { name: 'Longsword', damage: 3 },
  axe:       { name: 'Axe',       damage: 4 },
}

export function isWalkable(tileId, tileObj = null) {
  if (tileObj?.voidZone) return false
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
    if (!map[y]?.[x] || !isWalkable(map[y][x].tile, map[y][x])) return false
  }
  return true
}

export function computePlayerFOV(map, player, radius = 8) {
  // Reset visibility before recomputing. Clearing the *whole* map is O(W×H),
  // which is fine for a dungeon room but dominates on large / open-world maps.
  // So on a repeat call for the SAME map we clear only the tiles we lit last
  // time (O(lit)); on a new map we do one full clear, since its tiles may carry
  // stale `visible` flags from a prior visit (the explored-but-not-in-sight
  // memory). Either way the lit set is rebuilt from scratch below.
  if (player._fovLitMap === map && player._fovLit) {
    for (const t of player._fovLit) t.visible = false
  } else {
    for (const row of map) for (const tile of row) tile.visible = false
  }
  const lit = []
  const { x: px, y: py } = player
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = px + dx, ty = py + dy
      const t = map[ty]?.[tx]
      if (!t) continue
      if (hasLineOfSight(map, py, px, ty, tx)) {
        t.visible = true
        t.explored = true
        lit.push(t)
      }
    }
  }
  player._fovLitMap = map
  player._fovLit = lit
}

// FOV only changes when the player's *tile* (player.x/y) or the map changes —
// not on every sub-tile pixel of movement. Cache the last inputs on the player
// and skip the full-map clear + raycast when nothing relevant has moved.
// Returns true if it recomputed, false if it reused the cached visibility.
export function maybeComputeFOV(map, player, radius = 8) {
  if (player._fovMap === map && player._fovX === player.x && player._fovY === player.y) {
    return false
  }
  computePlayerFOV(map, player, radius)
  player._fovMap = map
  player._fovX = player.x
  player._fovY = player.y
  return true
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

export function makeKey(x, y) {
  return { type: 'key', x, y }
}

// The level exit. A door entity (reuses the door_0..3 frames) flagged as the
// locked exit; it opens only when the player holds this level's key.
export function makeExitDoor(x, y) {
  return { type: 'door', x, y, opening: false, frame: 0, locked: true, isExit: true }
}

// Final-boss reward (placeholder: a gold-tinted weapon). Collecting it wins.
export function makeTreasure(x, y, weaponType) {
  return { type: 'treasure', x, y, weaponType }
}
