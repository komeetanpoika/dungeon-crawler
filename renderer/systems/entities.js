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
  // Kivihiisi's reward (systems/quests/pass.js): Ukko's hammer. A charge
  // weapon whose tiers deal lightning — a shock DoT on a full swing, a
  // thunderclap and a chain of bolts on an overcharge (systems/hammer.js).
  ukonvasara:   { name: 'Ukonvasara',   damage: 3, heavy: true, lightning: true },
  // Leap-episode tool: chops like a hatchet and mines rock (systems/leap.js
  // episode modules, Tasks 12-14).
  pick:      { name: 'Pick',      damage: 2, chop: 1, mine: 1 },
  // The Lalli tale (wilds/tale-lalli.js). The flute strikes nothing: a swing
  // plays a tune instead (systems/tune.js). `tale`: had from the tale only,
  // never from a chest or the test arena's ring of weapons.
  flute:     { name: "Piper's Flute", damage: 0, tune: true, tale: true },
  lalli_axe: { name: "Lalli's Axe", damage: 3, chop: 2, tale: true },
}

// The melee-weapon payload every chest, drop and hand slot carries.
export function weaponContents(weaponType) {
  const wt = WEAPON_TYPES[weaponType] ? weaponType : 'dagger'
  const def = WEAPON_TYPES[wt]
  return { weaponType: wt, name: def.name, damage: def.damage,
    ...(def.heavy && { heavy: true }), ...(def.chop && { chop: def.chop }), ...(def.mine && { mine: def.mine }),
    ...(def.lightning && { lightning: def.lightning }), ...(def.tune && { tune: true }) }
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
  // No `heavy` flag: plate belongs to the Warrior now, and the archer can
  // never wear it — the coat alone is enough to draw the crossbow.
  crossbow:  { name: 'Crossbow',    damage: 5, cooldown: 1.2, color: '#e5e7eb', kind: 'crossbow', ammoKind: 'bolt',  bundle: 8,
    knockback: 45, piercesShield: true },
  sling:     { name: 'Sling',       damage: 1, cooldown: 0.5, color: '#a8a29e', kind: 'sling',    ammoKind: 'stone', bundle: 20, stun: 0.5 },
  // Tervahauta's reward (systems/quests/river.js): a longbow whose arrow
  // leaves a burning patch — `fire.tiles` is the fire zone's flood size.
  tervajousi: { name: 'Tervajousi', damage: 3, cooldown: 0.7, color: '#b45309', kind: 'bow', ammoKind: 'arrow', bundle: 10, draw: true, fire: { tiles: 3 } },
}

// Flags that ride through unchanged from a RANGED_WEAPON_TYPES row onto the
// contents object, only when the row actually sets them.
const RANGED_FLAG_KEYS = ['draw', 'fork', 'knockback', 'piercesShield', 'stun', 'fire']

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

// Shields — offhand only (inventory.js canEquipOffhand). Raised by holding Q
// (systems/shield.js); `blockCost` is the stamina each absorbed hit costs.
// The kite shield is heavy: it rides on the plate like a heavy blade does.
export const SHIELD_TYPES = {
  buckler: { name: 'Buckler',     blockCost: 8 },
  kite:    { name: 'Kite Shield', blockCost: 4, heavy: true },
}

export function makeShieldContents(weaponType = 'buckler') {
  const wt = SHIELD_TYPES[weaponType] ? weaponType : 'buckler'
  const def = SHIELD_TYPES[wt]
  return { type: 'shield', weaponType: wt, name: def.name, blockCost: def.blockCost, ...(def.heavy && { heavy: true }) }
}

// What fits in the offhand beside a main weapon: a light blade, damage 2 or
// less and never heavy. Derived from the table so a new dagger needs no list.
export const isSmallBlade = weaponType => {
  const d = WEAPON_TYPES[weaponType]
  return !!d && !d.heavy && !d.tune && d.damage <= 2
}

// Outfits — one per loadout slot (systems/inventory.js gearOf). An outfit
// says which ways are open to the hero and nothing else: the coat is the
// Archer, the robe is the Mage, and `heavy` on the Warrior's (the tabard the
// cyclops drops, key `plate` since it was the Plated Armor) is the gate for
// every heavy thing. What protects is worn in the armor slot (WORN_TYPES).
export const OUTFIT_TYPES = {
  ranger:  { name: "Ranger's Coat",   loadout: 'ranged' },
  robe:    { name: "Mage's Robe",     loadout: 'magic' },
  plate:   { name: "Knight's Tabard", loadout: 'melee', heavy: true },
}

// Null for a key the table does not know (the Leather Coat was an outfit
// once: systems/inventory.js itemFromContents turns an old one into armor).
export function makeOutfitContents(outfitType) {
  const def = OUTFIT_TYPES[outfitType]
  if (!def) return null
  return { type: 'outfit', outfitType, name: def.name, loadout: def.loadout, ...(def.heavy && { heavy: true }) }
}

// Worn pieces: headwear, armor, boots and a ring, one of each per character
// (gear[stance].head/armor/boots/ring). `armor` is the armor points a piece
// gives and `sprintMul` what it does to the sprint's stamina cost
// (systems/worn.js); `heavy` needs the tabard, like a heavy blade; `power`
// names what else it does, read where that thing happens; `tint` is the
// colour of a ring's one pixel on the hand (render/hero-look.js).
export const WORN_SLOTS = ['head', 'armor', 'boots', 'ring']
export const WORN_TYPES = {
  cap:      { slot: 'head',  name: 'Leather Cap',      armor: 1 },
  helm:     { slot: 'head',  name: 'Iron Helm',        armor: 2 },
  horned:   { slot: 'head',  name: 'Horned Helm',      armor: 1, power: 'ram' },
  cloth:    { slot: 'head',  name: 'Desert Headcloth', armor: 0, power: 'cool' },
  leather:  { slot: 'armor', name: 'Leather Jerkin',   armor: 2 },
  chain:    { slot: 'armor', name: 'Chain Shirt',      armor: 3, sprintMul: 1.5 },
  plate:    { slot: 'armor', name: 'Plate Cuirass',    armor: 5, sprintMul: 2, heavy: true },
  elk:      { slot: 'boots', name: 'Elk-hide Boots',   armor: 0, sprintMul: 0.6 },
  ironshod: { slot: 'boots', name: 'Iron-shod Boots',  armor: 1 },
  wayfarer: { slot: 'boots', name: "Wayfarer's Boots", armor: 0, power: 'wayfarer' },
  breath:   { slot: 'ring',  name: 'Ring of Breath',   armor: 0, power: 'breath',  tint: '#7dd3fc' },
  mending:  { slot: 'ring',  name: 'Ring of Mending',  armor: 0, power: 'mending', tint: '#4ade80' },
  miser:    { slot: 'ring',  name: "Miser's Ring",     armor: 0, power: 'miser',   tint: '#facc15' },
  smith:    { slot: 'ring',  name: "Smith's Ring",     armor: 0, power: 'smith',   tint: '#cbd5e1' },
}

// Floor/chest contents of a piece, typed by its slot. Null for an unknown key.
export function makeWornContents(gearType) {
  const def = WORN_TYPES[gearType]
  if (!def) return null
  const { slot, ...rest } = def
  return { type: slot, gearType, ...rest }
}

// Per-loadout gear beside the three main hands (see makePlayer). Every
// offhand starts pointed at the potion stack so Q heals from the first step,
// exactly as quick-use did before the offhand existed.
export function defaultGear() {
  const slot = () => ({ off: { kind: 'consumable', item: 'potion' }, outfit: null, head: null, armor: null, boots: null, ring: null })
  return { melee: slot(), ranged: slot(), magic: slot() }
}

// The quiver/pouch: one shared pool per ammo kind, independent of which bow
// is currently held. Caps match the spec (arrow 40 / bolt 24 / stone 60).
export const AMMO_KINDS = ['arrow', 'bolt', 'stone']
export const AMMO_CAPS = { arrow: 40, bolt: 24, stone: 60 }

export function emptyAmmo() {
  return { arrow: 0, bolt: 0, stone: 0 }
}

// The two facing tables, shared rather than re-declared: DIRS is the unit
// tile step per facing (walk, blink, bramble placement, arrows), FACING_ANGLE
// the same direction in radians (cone sweeps and the rings that draw them).
// Screen space, so `south` is +y and its angle is +PI/2. Callers still guard
// an unknown facing themselves (`DIRS[f] ?? DIRS.east`).
export const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
export const FACING_ANGLE = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }

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
//
// The Wilds' desert adds two more (wilds/piece.js cellOf). A dune crest
// (losDune) is walked over but hides what lies behind it: you see the next
// crest whole, and little beyond. A crest on the line does not block
// - while every cell so far, the viewer's own included, is crest: a line that
//   starts on a crest sees along it and down both sides;
// - when every cell from it to the target is crest: a line that runs along the
//   crest it looks at reaches it, so a crest in view is seen whole and sight
//   across a crest's edge is mutual;
// - when the target is a landmark (losBeacon): it is seen over crests.
// Any other crest blocks; the target itself never does. A map with neither
// flag sees exactly as before.
export const LOS_TREE_BUDGET = 2
// Rays computePlayerFOV has cast, added up for tests and timing (reset at will).
export const FOV_STATS = { rays: 0 }

export function hasLineOfSight(map, y1, x1, y2, x2) {
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  if (steps === 0) return true
  const to = map[y2]?.[x2]
  const toTall = !!to?.losTall
  const overDunes = !!to?.losBeacon
  const toDune = !!to?.losDune
  let onCrest = !!map[y1]?.[x1]?.losDune
  let alongTarget = false   // on a crest that must run on unbroken to the target
  let soft = 0
  for (let i = 1; i <= steps; i++) {
    const y = Math.round(y1 + (dy * i) / steps)
    const x = Math.round(x1 + (dx * i) / steps)
    if (y === y2 && x === x2) break
    const t = map[y]?.[x]
    if (!t) return false
    if (t.losDune) {                                    // dune crest: see the rules above
      if (onCrest || overDunes) continue
      if (!toDune) return false
      alongTarget = true
      continue
    }
    if (alongTarget) return false                       // that crest did not run on to the target
    onCrest = false
    if (isWalkable(t.tile, t)) continue
    if (t.losClear) continue                            // open water: see across
    if (t.losSoft && ++soft <= LOS_TREE_BUDGET) continue // foliage: shallow only
    if (t.losTall && toTall) continue                   // mountain: seen through mountain
    return false
  }
  return true
}

// The dune rule of hasLineOfSight alone, for the hero's `los: 'dunes'` sight:
// every other cell is see-through, as the radius-only surface sight is.
// `own` is the crest the viewer stands on (crestJoined), null off a crest:
// its cells never block, wherever along the line they come, also after the
// line has left that crest and comes back onto it, so from a ridge he sees
// both flanks of his own dune. Any other crest is judged as from a hollow.
// (This takes the place of hasLineOfSight's `onCrest`: the cells a line
// meets before it first leaves the viewer's crest are all his own.)
function duneLine(map, y1, x1, y2, x2, own) {
  const to = map[y2][x2]
  if (to.losBeacon) return true
  const toDune = !!to.losDune
  let alongTarget = false
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  for (let i = 1; i < steps; i++) {                     // the target (i === steps) never blocks
    const t = map[Math.round(y1 + (dy * i) / steps)]?.[Math.round(x1 + (dx * i) / steps)]
    if (!t) return false
    if (t.losDune && !own?.has(t)) {
      if (!toDune) return false
      alongTarget = true
    } else if (alongTarget) return false
  }
  return true
}

// Whether a dune crest lies within the radius: with none, the dune rule can
// hide nothing and no ray is cast.
function duneWithin(map, px, py, radius) {
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    const row = map[py + dy]
    if (!row) continue
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2 && row[px + dx]?.losDune) return true
    }
  }
  return false
}

// The crest the viewer stands on, at (px, py): every crest cell joined to it
// by a chain of 8-neighbour crest cells, within the radius, as a map from the
// cell to its [x, y]. He sees all of it (a ray alone stops where a slanted
// brink steps aside and back), and none of it blocks his sight (duneLine).
function crestJoined(map, px, py, r2) {
  const own = new Map([[map[py][px], [px, py]]])
  const todo = [px, py]
  while (todo.length) {
    const y = todo.pop(), x = todo.pop()
    for (let dy = -1; dy <= 1; dy++) {
      const row = map[y + dy]
      if (!row) continue
      for (let dx = -1; dx <= 1; dx++) {
        const t = row[x + dx]
        if (!t?.losDune || own.has(t)) continue
        const ox = x + dx - px, oy = y + dy - py
        if (ox * ox + oy * oy > r2) continue
        own.set(t, [x + dx, y + dy])
        todo.push(x + dx, y + dy)
      }
    }
  }
  return own
}

// `los` is the sight rule. `true` keeps line of sight: dungeons, caves and
// interiors. `false` lights the whole radius with no ray test: the open maps
// (Adventure, Timewarp) show everything around the player. `'dunes'` is the
// Wilds out of doors: the whole radius but the cells behind a dune crest, and
// with no crest within the radius no ray test at all. Standing on a crest,
// the player sees the whole of that crest within the radius and over it, down
// both flanks of his dune (crestJoined, duneLine). A cell the dune rule hides
// inside the radius is `guessed` (render/tiles.js guessSkin draws it as
// plain desert under the fog), unless it is already explored: it is
// remembered as it is. Like `explored`, the flag is never cleared, lives on
// the cells only (no save holds it), and no other rule sets it. `far`
// (beyond the radius; only the Wilds pass it) lights and explores the
// landmarks (losBeacon) out to that range: a line to a landmark passes over
// every crest (duneLine), so no ray is cast for them. The eight cells round
// the player are always lit.
export function computePlayerFOV(map, player, radius = 8, { los = true, far = 0 } = {}) {
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
  const light = (t, tx, ty) => {
    t.visible = true
    t.explored = true
    lit.push(t)
    // a house's lower wall face lights the face row and wall top above it,
    // which no ray reaches past it (renderer/interior/walls.js)
    for (let k = 1; k <= (t.seeUp ?? 0); k++) {
      const a = map[ty - k]?.[tx]
      if (a && !a.visible) { a.visible = true; a.explored = true; lit.push(a) }
    }
  }
  const r2 = radius * radius
  const dunes = los === 'dunes' && duneWithin(map, px, py, radius)
  const own = dunes && map[py]?.[px]?.losDune ? crestJoined(map, px, py, r2) : null
  const ray = los === true ? (ty, tx) => hasLineOfSight(map, py, px, ty, tx)
    : dunes ? (ty, tx) => duneLine(map, py, px, ty, tx, own)
    : null
  const hidden = dunes ? [] : null   // what the dune rule hid inside the radius
  let rays = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = px + dx, ty = py + dy
      const t = map[ty]?.[tx]
      if (!t) continue
      if (ray) { rays++; if (!ray(ty, tx)) { hidden?.push(t); continue } }
      light(t, tx, ty)
    }
  }
  if (own) for (const [t, [tx, ty]] of own) if (!t.visible) light(t, tx, ty)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = map[py + dy]?.[px + dx]
      if (t && !t.visible) light(t, px + dx, py + dy)
    }
  }
  // (after the crest and the eight round the player, which light some of them)
  if (hidden) for (const t of hidden) if (!t.explored) t.guessed = true
  if (far > radius) {
    // the ring between the radius and `far`, row by row: |dx| up to `outer`,
    // skipping the |dx| <= `inner` already in the radius (rows past the
    // radius skip nothing)
    const f2 = far * far
    for (let dy = -far; dy <= far; dy++) {
      const row = map[py + dy]
      if (!row) continue
      const outer = Math.floor(Math.sqrt(f2 - dy * dy))
      const inRadius = dy * dy <= r2
      const inner = inRadius ? Math.floor(Math.sqrt(r2 - dy * dy)) : 0
      for (let dx = -outer; dx <= outer; dx++) {
        if (inRadius && dx === -inner) { dx = inner; continue }
        const t = row[px + dx]
        if (!t?.losBeacon || t.visible) continue
        light(t, px + dx, py + dy)
      }
    }
  }
  FOV_STATS.rays += rays
  player._fovLitMap = map
  player._fovLit = lit
}

// FOV only changes when the player's *tile* (player.x/y), the map or the
// sight asked for (radius, rule, far) changes — not on every sub-tile pixel
// of movement. Cache the last inputs on the player and skip the full-map
// clear + raycast when nothing relevant has moved.
// Returns true if it recomputed, false if it reused the cached visibility.
export function maybeComputeFOV(map, player, radius = 8, opts = {}) {
  const los = opts.los ?? true
  const far = opts.far ?? 0
  if (player._fovMap === map && player._fovX === player.x && player._fovY === player.y && player._fovLos === los
    && player._fovRadius === radius && player._fovFar === far) {
    return false
  }
  computePlayerFOV(map, player, radius, { los, far })
  player._fovMap = map
  player._fovX = player.x
  player._fovY = player.y
  player._fovLos = los
  player._fovRadius = radius
  player._fovFar = far
  return true
}

// How many things the bag holds before any `extra_slot` bonus. It was 10
// until the bag was rebuilt (2026-11-23); adventure.js lifts older saves.
export const SACK_BASE = 24

export function makePlayer(x, y, bonuses = []) {
  const quietSteps = bonuses.filter(b => b === 'quiet_step').length
  const extraSlots = bonuses.filter(b => b === 'extra_slot').length
  return {
    type: 'player', x, y,
    hp: 10, maxHp: 10,
    inventory: [], maxInventory: SACK_BASE + extraSlots,
    noiseFootprint: Math.max(0, 2 - quietSteps),
    // Three loadouts of one body: the main hands live here (melee / bow /
    // wand — combat code reads them directly), each loadout's offhand and
    // outfit live one level down in `gear`, and `belt` is the one shared tool
    // slot. The Warrior is always open; the Archer and the Mage open when
    // their outfit is worn (inventory.js loadoutAvailable).
    bonuses, weapon: null, ranged: null, wand: null, ammo: emptyAmmo(),
    gear: defaultGear(), belt: null,
    attackMode: 'melee', talents: [],
    stamina: 100, maxStamina: 100, staminaRegenT: 0,
    magicCooldown: 0,   // gust unlocks with the Mage's Robe (inventory.js loadoutAvailable)
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
