// Registry + loader for generated monsters (rig-drawn, JSON-defined).
// Generated monsters are normal enemies: they run the brain, take the normal
// strike path, and are NEVER added to CREATURE_TYPES (membership would divert
// brain/strike/draw — see the design spec). Their optional hook modules
// register into CREATURE_HIT/UPDATE/ALPHA keyed by monster name; game.js
// dispatches those explicitly for registry types.
import { clampParams } from '../render/monster-rigs/schema.js'
import { registerMonsterAI } from '../data/enemy-ai.js'
import { creatureAlpha, CREATURE_TYPES } from './creatures.js'

const REGISTRY = Object.create(null)
const NAME_RE = /^[a-z0-9_]+$/
const HIT_FLASH = 0.18

// Names a generated monster may NEVER take: built-in entity/enemy kinds.
// registerMonsterAI(name, ...) writes BASE[name] in renderer/data/enemy-ai.js
// — for a built-in name (e.g. 'monster', the universal fallback row BASE.monster
// consulted by getAIConfig) that overwrites core AI tuning. getMonsterDef(name)
// also hijacks the buildEntities/canvas draw dispatch for that kind wherever a
// caller checks it before the built-in switch (renderer/systems/map.js
// buildArena). Sources: enemy-ai.js BASE keys + map.js buildArena's
// ENEMY_KINDS (guard, monster, dragon, crab, wizard, cyclops, npc,
// dragon_boss, dragon_boss_pixel), the other non-enemy entity kinds
// game.js buildEntities switches on (trap, puzzle, weapon, ranged, potion,
// door, exit_door, chest, prop, dungeon_entrance, fountain_wall,
// fountain_basin, talent_trigger, wild_mushroom, floating_pickup, echo,
// creature), and CREATURE_TYPES (the leap-episode creatures, which route
// through their own hit/update/draw hooks instead of the generic path).
const RESERVED_NAMES = new Set([
  'guard', 'monster', 'dragon', 'crab', 'wizard', 'cyclops', 'npc',
  'dragon_boss', 'dragon_boss_pixel',
  'trap', 'puzzle', 'weapon', 'ranged', 'potion', 'door', 'exit_door', 'chest',
  'prop', 'dungeon_entrance', 'fountain_wall', 'fountain_basin', 'talent_trigger',
  'wild_mushroom', 'floating_pickup', 'echo', 'creature',
  ...CREATURE_TYPES,
])

const defaultLoadRig = id => import(`../render/monster-rigs/${id}.js`)
const defaultLoadHooks = name => import(`./monsters/${name}.js`)

export async function registerMonsters(defs, opts = {}) {
  const { loadRig = defaultLoadRig, loadHooks = defaultLoadHooks, warn = console.warn } = opts
  let loaded = 0
  for (const raw of defs ?? []) {
    if (!raw || typeof raw.name !== 'string' || !NAME_RE.test(raw.name)) {
      warn(`monsters: bad name "${raw?.name}" — skipped`); continue
    }
    if (RESERVED_NAMES.has(raw.name)) {
      warn(`monsters: name "${raw.name}" is reserved for a built-in type — skipped`); continue
    }
    let rig
    try {
      rig = await loadRig(raw.rig)
      if (typeof rig.drawMonster !== 'function' || !Array.isArray(rig.PARAM_SCHEMA)) throw new Error('not a rig')
    } catch {
      warn(`monsters: ${raw.name}: rig "${raw.rig}" missing or invalid — skipped`); continue
    }
    const params = clampParams(rig.PARAM_SCHEMA, raw.params ?? {}, m => warn(`monsters: ${raw.name}: ${m}`))
    const stats = { hp: 10, dmg: 1, speed: 70, half: 8, ...(raw.stats ?? {}) }
    REGISTRY[raw.name] = { name: raw.name, rigId: raw.rig, rig, params, stats,
                          behavior: raw.behavior ?? {}, spawn: raw.spawn ?? null }
    registerMonsterAI(raw.name, { speed: stats.speed, half: stats.half, ...(raw.behavior ?? {}) })
    if (raw.hooks) {
      try { await loadHooks(raw.name) }
      catch (err) { warn(`monsters: ${raw.name}: hooks failed (${err.message}) — default behavior`) }
    }
    loaded++
  }
  return loaded
}

export function clearMonsters() { for (const k of Object.keys(REGISTRY)) delete REGISTRY[k] }
export function getMonsterDef(name) { return REGISTRY[name] ?? null }
export function monsterNames() { return Object.keys(REGISTRY) }

export function monstersForDepth(depth) {
  return Object.values(REGISTRY)
    .filter(d => Array.isArray(d.spawn?.depths) && depth >= d.spawn.depths[0] && depth <= d.spawn.depths[1])
    .map(d => ({ name: d.name, weight: d.spawn.weight ?? 1 }))
}

export function makeMonsterFromDef(name, x, y) {
  const d = REGISTRY[name]
  if (!d) return null
  return { type: name, x, y, hp: d.stats.hp, maxHp: d.stats.hp, damage: d.stats.dmg, inCombat: false }
}

// Per-frame pose bookkeeping, stored on the entity. Called from the enemy
// update loop after brain+act so px/py deltas reflect this frame's movement.
export function updateMonsterPose(e, delta) {
  const p = e.pose ?? (e.pose = {
    t: 0, state: 'idle', stateT: 0, facing: 0, speed01: 0,
    seed: (((e.x ?? 0) * 31 + (e.y ?? 0) * 17) & 1023),
    prevPx: e.px, prevPy: e.py, hpSeen: e.hp, hitT: 0,
  })
  p.t += delta
  const dx = e.px - p.prevPx, dy = e.py - p.prevPy
  p.prevPx = e.px; p.prevPy = e.py
  const speed = delta > 0 ? Math.hypot(dx, dy) / delta : 0
  const max = REGISTRY[e.type]?.stats.speed || 70
  p.speed01 = Math.max(0, Math.min(1, speed / max))
  if (speed > max * 0.05) p.facing = Math.atan2(dy, dx)
  if (e.hp < p.hpSeen) p.hitT = HIT_FLASH
  p.hpSeen = e.hp
  if (p.hitT > 0) p.hitT -= delta
  const next = e.hp <= 0 ? 'death'
    : p.hitT > 0 ? 'hit'
    : e.attack ? 'attack'
    : p.speed01 > 0.05 ? 'walk' : 'idle'
  if (next !== p.state) { p.state = next; p.stateT = 0 } else p.stateT += delta
}

export function entityPose(e) {
  const p = e.pose ?? { t: 0, state: 'idle', stateT: 0, facing: 0, speed01: 0, seed: 0 }
  return { t: p.t, state: p.state, stateT: p.stateT, facing: p.facing, speed01: p.speed01, seed: p.seed }
}

// Draw dispatch for the canvas entity loop: translate to the entity's screen
// centre and hand off to the rig. creatureAlpha honors any registered
// CREATURE_ALPHA hook (defaults to 1 for unhooked types).
export function drawGeneratedMonster(ctx, e, cx, cy, S, state) {
  const d = REGISTRY[e.type]
  if (!d) return
  const alpha = creatureAlpha(e, state)
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  d.rig.drawMonster(ctx, d.params, entityPose(e), S)
  ctx.restore()
}
