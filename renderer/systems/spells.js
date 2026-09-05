// The spell roster: a data table over four primitives (bolt, cone, zone,
// self) plus one bespoke module (Call Lightning). A wand in the magic hand
// picks the row; wandless casting stays Gust of Wind. Everything is priced
// in stamina — the one tank — and gated by the same charge tiers the gust
// already used, so a wand is a different shape of the same cast.
//
// Pure logic: no DOM, no game.js. Primitives return what game.js needs to
// spawn and show the cast (projectile specs, the caught count, the new
// zone, the blink trail) and nothing more. Call Lightning is injected as
// `modules.lightning` rather than imported, so this file never depends on
// the one spell that reaches into the weather layer.
import { WAND_TYPES, isWalkable } from './entities.js'
import { castCone, GUST, GUST_TIERS } from './magic.js'
import { FIREBALL_RANGE_TILES } from './fire.js'
import { hasTalent } from './talents.js'
import { affordableTier, GUST_COSTS, spendStamina } from './stamina.js'
import { makeBrambleZone } from './zones.js'

const TILE_SIZE = 32
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

export const CHAIN_RANGE = 96          // 3 tiles: how far a spark arcs onward
const RIME_HALF_ANGLE = Math.PI * 55 / 180
const BRAMBLE_AHEAD = 3                // tiles in front of the caster
const BLINK_TILES = 4
const BLINK_INVULN = 0.5

// Every row: { id, name, primitive, cooldown, cost: {tap,full,over},
// tiers: {tap,full,over} }. Tier objects are the primitive's parameters —
// bolts carry projectile fields, cones the wedge and its effects, zones the
// patch's shape and timings, self the blink's extras.
export const SPELLS = {
  // The wandless cast keeps its own tables so existing callers (and the
  // charge UI) see exactly what they always did.
  gust: { id: 'gust', name: 'Gust of Wind', primitive: 'cone',
    cooldown: GUST.cooldown, cost: GUST_COSTS, tiers: GUST_TIERS },

  // Cheap and fast: the caster's jab. Higher tiers don't hit harder, they
  // arc to more enemies.
  spark: { id: 'spark', name: 'Spark', primitive: 'bolt', cooldown: 0.5,
    cost: { tap: 8, full: 14, over: 22 },
    tiers: {
      tap:  { damage: 2, speed: 340, shape: 'spark', color: '#22d3ee' },
      full: { damage: 2, speed: 340, shape: 'spark', color: '#22d3ee', chain: 2 },
      over: { damage: 2, speed: 340, shape: 'spark', color: '#22d3ee', chain: 4 },
    } },

  // The gust's cold cousin: no damage, but it takes the legs off a pack.
  // The cone stays the same width at every tier and only reaches further —
  // the tier upgrade is the chill, not the sweep.
  rime: { id: 'rime', name: 'Rime', primitive: 'cone', cooldown: 3,
    cost: { tap: 12, full: 18, over: 30 },
    tiers: {
      tap:  { mul: 1,    reach: 80,  halfAngle: RIME_HALF_ANGLE, slow: { mul: 0.4, dur: 3 } },
      full: { mul: 1.25, reach: 100, halfAngle: RIME_HALF_ANGLE, slow: { mul: 0.4, dur: 4 } },
      over: { mul: 1.5,  reach: 120, halfAngle: RIME_HALF_ANGLE, freeze: 2 },
    } },

  // The old fireball, unchanged in flight; the tiers widen the blast the
  // detonation floods out (game.js passes blastTiles to computeBlastTiles).
  fireball: { id: 'fireball', name: 'Fireball', primitive: 'bolt', cooldown: 1.0,
    cost: { tap: 18, full: 26, over: 40 },
    tiers: {
      tap:  { damage: 4, speed: 280, shape: 'bolt', color: '#f97316', explodes: true, blastTiles: 16 },
      full: { damage: 4, speed: 280, shape: 'bolt', color: '#f97316', explodes: true, blastTiles: 24 },
      over: { damage: 4, speed: 280, shape: 'bolt', color: '#f97316', explodes: true, blastTiles: 32 },
    } },

  // Area denial: thorns ahead of the caster that hold whatever walks in.
  bramble: { id: 'bramble', name: 'Bramble', primitive: 'zone', cooldown: 4,
    cost: { tap: 14, full: 20, over: 32 },
    tiers: {
      tap:  { radius: 1, dur: 6,  root: 2, dps: 1 },
      full: { radius: 1, dur: 8,  root: 3, dps: 1 },
      over: { radius: 2, dur: 10, root: 3, dps: 1 },
    } },

  // The escape: a short hop through anything living, stopped only by walls.
  blink: { id: 'blink', name: 'Blink', primitive: 'self', cooldown: 2.5,
    cost: { tap: 12, full: 18, over: 30 },
    tiers: {
      tap:  { tiles: BLINK_TILES },
      full: { tiles: BLINK_TILES, invuln: BLINK_INVULN },
      over: { tiles: BLINK_TILES, invuln: BLINK_INVULN, gustBack: true },
    } },

  // Bespoke: marks, the strike, water conduction and the weather flash all
  // live in systems/lightning.js, injected as modules.lightning.
  lightning: { id: 'lightning', name: 'Call Lightning', primitive: 'module', cooldown: 4,
    cost: { tap: 20, full: 30, over: 50 },
    tiers: {
      tap:  { marks: [3] },
      full: { marks: [6] },
      over: { marks: [4, 6, 8] },
    } },
}

// Which spell the player casts right now: the held wand's, or the wandless
// gust when the hand is empty (or holds something the table doesn't know).
export function spellFor(player) {
  const spell = SPELLS[WAND_TYPES[player?.wand?.weaponType]?.spell]
  return spell ?? SPELLS.gust
}

export { affordableTier }

// --- primitives -------------------------------------------------------

// bolt: one projectile from the caster along their facing, shaped for
// systems/projectiles.js. game.js pushes the specs onto state.projectiles.
function castBolt(state, t) {
  const p = state.player
  const [dx, dy] = DIRS[p.facing] ?? DIRS.east
  const spec = {
    px: p.px, py: p.py, dx: dx * t.speed, dy: dy * t.speed,
    damage: t.damage, color: t.color, shape: t.shape, friendly: true,
  }
  if (t.chain) spec.chain = { left: t.chain, range: CHAIN_RANGE }
  if (t.explodes) {
    spec.explodes = true
    spec.blastTiles = t.blastTiles
    spec.maxDist = FIREBALL_RANGE_TILES * TILE_SIZE
    spec.distTraveled = 0
    spec.lastPx = p.px; spec.lastPy = p.py   // last walkable spot, for wall detonations
  }
  return { projectiles: [spec] }
}

// zone: a patch of thorns a few tiles ahead, trimmed to walkable ground.
function castZone(state, t) {
  const p = state.player
  const [dx, dy] = DIRS[p.facing] ?? DIRS.east
  const cx = Math.floor(p.px / TILE_SIZE) + dx * BRAMBLE_AHEAD
  const cy = Math.floor(p.py / TILE_SIZE) + dy * BRAMBLE_AHEAD
  const zone = makeBrambleZone(state.map, cx, cy, t.radius, t.dur, t.root, t.dps)
  state.zones = state.zones ?? []
  state.zones.push(zone)
  return { zone }
}

// self: the blink. Walks tile by tile along the facing and stops at the last
// walkable cell — enemies are passed straight over (that's the point), only
// walls end the hop. Returns the two ends so game.js can draw the trail.
function castSelf(state, t) {
  const p = state.player
  const [dx, dy] = DIRS[p.facing] ?? DIRS.east
  const from = { px: p.px, py: p.py }
  let tx = Math.floor(p.px / TILE_SIZE)
  let ty = Math.floor(p.py / TILE_SIZE)
  for (let i = 0; i < t.tiles; i++) {
    const nx = tx + dx, ny = ty + dy
    const cell = state.map?.[ny]?.[nx]
    if (!cell || !isWalkable(cell.tile, cell)) break
    tx = nx; ty = ny
  }
  p.px = tx * TILE_SIZE + TILE_SIZE / 2
  p.py = ty * TILE_SIZE + TILE_SIZE / 2
  p.x = tx; p.y = ty
  if (t.invuln) p.invulnTimer = Math.max(p.invulnTimer ?? 0, t.invuln)
  const result = { from, to: { px: p.px, py: p.py } }
  // The parting shot is a real gust from the origin, so game.js casts it
  // (it owns the feedback and SFX for a cone) rather than this primitive.
  if (t.gustBack) result.gustBack = true
  return result
}

// Cast `spellId` at `tier`. Gates in order — talent, cooldown, stamina
// (degrading the tier before refusing) — then spends, starts the cooldown
// and dispatches on the primitive. `modules` carries the bespoke spells;
// game.js injects { lightning }.
export function tryCast(state, spellId, tier = 'tap', { modules } = {}) {
  const p = state.player
  const spell = SPELLS[spellId] ?? SPELLS.gust
  if (!hasTalent(p, 'magic_stance')) return { ok: false, reason: 'not_learned' }
  if ((p.magicCooldown ?? 0) > 0) return { ok: false, reason: 'cooldown' }
  // An un-wired bespoke spell refuses like an unlearned one — better than
  // charging the tank for a cast that would do nothing.
  const module = spell.primitive === 'module' ? modules?.[spell.id] : null
  if (spell.primitive === 'module' && !module) return { ok: false, reason: 'not_learned' }
  const paid = affordableTier(p.stamina ?? 0, spell.cost, tier)
  if (!paid) return { ok: false, reason: 'stamina' }
  spendStamina(p, spell.cost[paid])
  p.magicCooldown = spell.cooldown
  const t = spell.tiers[paid]
  let result
  switch (spell.primitive) {
    case 'bolt': result = castBolt(state, t); break
    case 'cone': result = castCone(state, t); break
    case 'zone': result = castZone(state, t); break
    case 'self': result = castSelf(state, t); break
    default:     result = module(state, paid); break
  }
  return { ok: true, spell, tier: paid, ...result }
}
