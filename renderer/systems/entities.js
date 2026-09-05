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
  // `chop` is the damage a swing deals a tree (systems/lumber.js); blades
  // without it can't fell anything.
  hatchet:   { name: 'Hatchet',   damage: 1, chop: 1 },
  dagger:    { name: 'Dagger',    damage: 1 },
  sword:     { name: 'Sword',     damage: 2 },
  longsword: { name: 'Longsword', damage: 3, heavy: true },
  axe:       { name: 'Axe',       damage: 4, heavy: true, chop: 2 },
  // The most powerful sword in the game (cheat-only for now: type "mauno" in
  // a run). On-hit crimson shockwave lives in systems/shockwave.js.
  maunonmiekka: { name: 'Maunonmiekka', damage: 10 },
  // Leap-episode tool: chops like a hatchet and mines rock (systems/leap.js
  // episode modules, Tasks 12-14).
  pick:      { name: 'Pick',      damage: 2, chop: 1, mine: 1 },
}

// The melee-weapon payload every chest, drop and hand slot carries.
export function weaponContents(weaponType) {
  const wt = WEAPON_TYPES[weaponType] ? weaponType : 'dagger'
  const def = WEAPON_TYPES[wt]
  return { weaponType: wt, name: def.name, damage: def.damage,
    ...(def.heavy && { heavy: true }), ...(def.chop && { chop: def.chop }), ...(def.mine && { mine: def.mine }) }
}

// Bows, the crossbow and the sling — looted from chests, never a starting
// item. They no longer carry their own ammo: every bow draws from the
// shared `player.ammo` pool by `ammoKind` (see AMMO_KINDS/AMMO_CAPS below),
// and a pickup's `bundle` is how much of that ammo kind it brings along.
// `kind` drives projectile rendering (bow arrows vs. the crossbow bolt vs.
// the sling stone).
export const RANGED_WEAPON_TYPES = {
  shortbow:  { name: 'Shortbow',    damage: 2, cooldown: 0.6, color: '#facc15', kind: 'bow',      ammoKind: 'arrow', bundle: 12 },
  // Fast and weak — the short cooldown, not the ammo, is the point: hold
  // Space and it streams.
  hunterbow: { name: "Hunter's Bow", damage: 1, cooldown: 0.3, color: '#facc15', kind: 'bow',      ammoKind: 'arrow', bundle: 20 },
  // Hold-to-draw tiers live in ranged.js (DRAW_CHARGE/resolveDrawTier); this
  // flag just marks the weapon as chargeable.
  longbow:   { name: 'Longbow',     damage: 3, cooldown: 0.7, color: '#facc15', kind: 'bow',      ammoKind: 'arrow', bundle: 10, draw: true },
  splitbow:  { name: 'Splitbow',    damage: 2, cooldown: 0.8, color: '#facc15', kind: 'bow',      ammoKind: 'arrow', bundle: 10,
    fork: { after: 32, count: 3, spread: Math.PI / 9 } },
  crossbow:  { name: 'Crossbow',    damage: 5, cooldown: 1.2, color: '#e5e7eb', kind: 'crossbow', ammoKind: 'bolt',  bundle: 8,
    heavy: true, knockback: 45, piercesShield: true },
  sling:     { name: 'Sling',       damage: 1, cooldown: 0.5, color: '#a8a29e', kind: 'sling',    ammoKind: 'stone', bundle: 20, stun: 0.5 },
}

// Flags that ride through unchanged from a RANGED_WEAPON_TYPES row onto the
// contents object, only when the row actually sets them.
const RANGED_FLAG_KEYS = ['draw', 'fork', 'heavy', 'knockback', 'piercesShield', 'stun']

export function makeRangedContents(weaponType = 'shortbow') {
  const wt = RANGED_WEAPON_TYPES[weaponType] ? weaponType : 'shortbow'
  const def = RANGED_WEAPON_TYPES[wt]
  const flags = {}
  for (const key of RANGED_FLAG_KEYS) if (def[key] !== undefined) flags[key] = def[key]
  return {
    type: 'ranged', weaponType: wt, name: def.name, damage: def.damage,
    cooldown: def.cooldown, color: def.color, kind: def.kind,
    ammoKind: def.ammoKind, bundle: def.bundle,
    ...flags,
  }
}

// Wands — the magic-stance hand slot. A wand has no ammo of its own; it
// gates its spell on stamina (systems/spells.js, Task 3+) rather than a
// depleting count.
export const WAND_TYPES = {
  sparkwand:   { name: 'Spark Wand',   spell: 'spark',     color: '#22d3ee' },
  frostwand:   { name: 'Frost Wand',   spell: 'rime',      color: '#93c5fd' },
  firewand:    { name: 'Fireball Wand', spell: 'fireball', color: '#f97316' },
  bramblewand: { name: 'Bramble Wand', spell: 'bramble',   color: '#65a30d' },
  blinkwand:   { name: 'Blink Wand',   spell: 'blink',     color: '#c084fc' },
  stormwand:   { name: 'Storm Wand',   spell: 'lightning', color: '#a78bfa' },
}

export function makeWandContents(weaponType = 'sparkwand') {
  const wt = WAND_TYPES[weaponType] ? weaponType : 'sparkwand'
  const def = WAND_TYPES[wt]
  return { type: 'wand', weaponType: wt, name: def.name, spell: def.spell, color: def.color }
}

// The quiver/pouch: one shared pool per ammo kind, independent of which bow
// is currently held. Caps match the spec (arrow 40 / bolt 24 / stone 60).
export const AMMO_KINDS = ['arrow', 'bolt', 'stone']
export const AMMO_CAPS = { arrow: 40, bolt: 24, stone: 60 }

export function emptyAmmo() {
  return { arrow: 0, bolt: 0, stone: 0 }
}

export function isWalkable(tileId, tileObj = null) {
  if (tileObj?.voidZone) return false
  return tileId !== TILE.WALL && tileId !== TILE.COLUMN
}

// The Echo is a spectral guide only the player sees — it has live x,y like
// any other entity, but it never physically occupies a tile. Cell-occupancy
// searches (campfire placement, gift drops, hearth relighting) should filter
// it out before treating an entity as a blocker.
export const occupiesCell = e => e.type !== 'echo'

// A sight line may pass through this many foliage cells (losSoft) before it
// is blocked; cells flagged losClear (open water) never block; a line whose
// target is itself losTall (a mountain) may cross other losTall cells — the
// peaks behind peaks are seen, the ground behind them is not. All three flags
// are stamped by buildOpenMap — dungeon tiles carry none, so dungeon LOS is
// unchanged.
export const LOS_TREE_BUDGET = 2

export function hasLineOfSight(map, y1, x1, y2, x2) {
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  if (steps === 0) return true
  const toTall = !!map[y2]?.[x2]?.losTall
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
    if (t.losTall && toTall) continue                   // mountain: seen through mountain
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
    // Three hands (melee / bow / wand) and one shared quiver — a run can be
    // swordsman, archer and wizard at once.
    bonuses, weapon: null, ranged: null, wand: null, ammo: emptyAmmo(),
    attackMode: 'melee', talents: [],
    stamina: 100, maxStamina: 100, staminaRegenT: 0,
    magicCooldown: 0,   // gust unlocks via the magic_stance talent
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
  return { type: 'weapon', x, y, ...weaponContents(weaponType) }
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
