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
  longsword: { name: 'Longsword', damage: 3, heavy: true },
  axe:       { name: 'Axe',       damage: 4, heavy: true },
  // The most powerful sword in the game (cheat-only for now: type "mauno" in
  // a run). On-hit crimson shockwave lives in systems/shockwave.js.
  maunonmiekka: { name: 'Maunonmiekka', damage: 10 },
}

// Projectile weapons — looted from chests, never a starting item. `ammo`
// depletes per shot and is only refilled by picking up a new weapon.
// `kind` drives projectile rendering (arrows are elongated, wand bolts square).
export const RANGED_WEAPON_TYPES = {
  shortbow:  { name: 'Shortbow',   damage: 2, maxAmmo: 12, cooldown: 0.6,  color: '#facc15', kind: 'bow' },
  longbow:   { name: 'Longbow',    damage: 3, maxAmmo: 10, cooldown: 0.7,  color: '#facc15', kind: 'bow' },
  sparkwand: { name: 'Spark Wand', damage: 2, maxAmmo: 16, cooldown: 0.45, color: '#22d3ee', kind: 'wand' },
  stormwand: { name: 'Storm Wand', damage: 5, maxAmmo: 6,  cooldown: 0.8,  color: '#a78bfa', kind: 'wand' },
  firewand:  { name: 'Fireball Wand', damage: 4, maxAmmo: 5,  cooldown: 1.0,  color: '#f97316', kind: 'wand', explodes: true },
}

export function makeRangedContents(weaponType = 'shortbow') {
  const wt = RANGED_WEAPON_TYPES[weaponType] ? weaponType : 'shortbow'
  const def = RANGED_WEAPON_TYPES[wt]
  return {
    type: 'ranged', weaponType: wt, name: def.name, damage: def.damage,
    ammo: def.maxAmmo, maxAmmo: def.maxAmmo, cooldown: def.cooldown,
    color: def.color, kind: def.kind,
    ...(def.explodes ? { explodes: true } : {}),
  }
}

export function isWalkable(tileId, tileObj = null) {
  if (tileObj?.voidZone) return false
  return tileId !== TILE.WALL && tileId !== TILE.COLUMN
}

// A sight line may pass through this many foliage cells (losSoft) before it
// is blocked; cells flagged losClear (open water) never block. Both flags are
// stamped by buildOpenMap — dungeon tiles carry neither, so dungeon LOS is
// unchanged.
export const LOS_TREE_BUDGET = 2

export function hasLineOfSight(map, y1, x1, y2, x2) {
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  if (steps === 0) return true
  let soft = 0
  for (let i = 1; i <= steps; i++) {
    const y = Math.round(y1 + (dy * i) / steps)
    const x = Math.round(x1 + (dx * i) / steps)
    if (y === y2 && x === x2) break
    const t = map[y]?.[x]
    if (!t) return false
    if (isWalkable(t.tile, t)) continue
    if (t.losClear) continue                            // open water: see across
    if (t.losSoft && ++soft <= LOS_TREE_BUDGET) continue // foliage: shallow only
    return false
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
    inventory: [], maxInventory: 10 + extraSlots,
    noiseFootprint: Math.max(0, 2 - quietSteps),
    bonuses, weapon: null, ranged: null, attackMode: 'melee', talents: [],
    mana: 4, manaRegenT: 0, magicCooldown: 0,   // gust unlocks via the magic_stance talent
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
  return { type: 'weapon', x, y, weaponType, name: def.name, damage: def.damage, ...(def.heavy && { heavy: true }) }
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
