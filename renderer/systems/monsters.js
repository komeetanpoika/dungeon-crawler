// Registry + loader for generated monsters (rig-drawn, JSON-defined).
// Generated monsters are normal enemies by default: they run the brain and
// take the normal strike path. Their optional hook modules register into
// CREATURE_HIT/UPDATE/ALPHA keyed by monster name; game.js dispatches those
// explicitly for registry types. A def with behavior.driver 'hook' (the
// leap-episode story creatures) hands its whole per-frame update to that
// module instead — see isStoryCreature below.
import { clampParams } from '../render/monster-rigs/schema.js'
import { TILE_ART_PX, snapFacing, palette } from '../render/monster-rigs/pixel.js'
import { registerMonsterAI } from '../data/enemy-ai.js'
import { creatureAlpha } from './creatures.js'
import { dyingAlpha } from './dying.js'

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
// fountain_basin, talent_trigger, wild_mushroom, floating_pickup, echo).
const RESERVED_NAMES = new Set([
  'guard', 'monster', 'dragon', 'crab', 'wizard', 'cyclops', 'npc',
  'dragon_boss', 'dragon_boss_pixel',
  'trap', 'puzzle', 'weapon', 'ranged', 'potion', 'door', 'exit_door', 'chest',
  'prop', 'dungeon_entrance', 'fountain_wall', 'fountain_basin', 'talent_trigger',
  'wild_mushroom', 'floating_pickup', 'echo', 'creature',
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
    // A rig that knows its drawn extent owns the hitbox: collision and nav
    // clearance track the visuals, and the def's stats.half is a fallback
    // for rigs without hitHalf.
    if (typeof rig.hitHalf === 'function') stats.half = rig.hitHalf(params)
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

// A registry monster whose hook module owns its movement (behavior.driver
// 'hook'): the enemy loop skips brain/act for it, gust/slam ignore it, and
// it is updated even when it is not an enemy (the passive Näkki) — unless
// the entity itself hands control back with `brainDriven`, which is how the
// Elk of Hiisi's final stand becomes an ordinary fight: the brain moves it,
// the enemy-attack pass reaches it, and spells stop sparing it.
export function isStoryCreature(e) {
  return !e.brainDriven && getMonsterDef(e.type)?.behavior?.driver === 'hook'
}
export function monsterNames() { return Object.keys(REGISTRY) }

export function monstersForDepth(depth) {
  return Object.values(REGISTRY)
    .filter(d => Array.isArray(d.spawn?.depths) && depth >= d.spawn.depths[0] && depth <= d.spawn.depths[1])
    .map(d => ({ name: d.name, weight: d.spawn.weight ?? 1 }))
}

// Open-map outskirts roster for a depth: monsters whose spawn.openMaps
// range covers it, with their per-map counts. The three leap story maps
// (depths 8-10, see systems/leap.js) never take random outskirts monsters —
// the episodes own their creature casts.
export function monstersForOpenMap(depth) {
  if (depth >= 8 && depth <= 10) return []
  return Object.values(REGISTRY)
    .filter(d => Array.isArray(d.spawn?.openMaps?.depths) &&
                 depth >= d.spawn.openMaps.depths[0] && depth <= d.spawn.openMaps.depths[1])
    .map(d => ({ name: d.name, count: d.spawn.openMaps.count ?? 1 }))
}

// A melee-capable registry monster names its weapon on the def as
// behavior.weapon (an enemy-attack.js WEAPONS id — 'maul' for the hook
// beasts); makeMonsterFromDef stamps it as the entity's weaponId, the same
// rule npc.js applies to a species' `weapon`, so no hook module has to
// remember to arm what it drives. A def without one cannot melee at all
// (enemy-attack.js's getEnemyWeapon falls back to ENEMY_MELEE[type], which
// has no registry rows) — boarhound and rappeluu are in that state today,
// deliberately unarmed until someone decides they bite.
export function makeMonsterFromDef(name, x, y) {
  const d = REGISTRY[name]
  if (!d) return null
  return { type: name, x, y, hp: d.stats.hp, maxHp: d.stats.hp, damage: d.stats.dmg, inCombat: false,
    ...(d.behavior?.weapon ? { weaponId: d.behavior.weapon } : {}) }
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
  return { t: p.t, state: p.state, stateT: p.stateT, facing: p.facing, speed01: p.speed01, seed: p.seed,
           headAim: p.headAim, eyeGlow: p.eyeGlow ?? 0,
           // hook-written channels live on the entity (a hook may run before
           // the first pose update): how far it has sunk, burned, flickers
           sink: e.sink ?? 0, burn: e.burn ?? 0, flicker: e.flicker ?? 0 }
}

// Draw dispatch for the canvas entity loop: translate to the entity's screen
// centre and hand off to the rig. creatureAlpha honors any registered
// CREATURE_ALPHA hook (defaults to 1 for unhooked types).
export function drawGeneratedMonster(ctx, e, cx, cy, S, state) {
  const d = REGISTRY[e.type]
  if (!d) return
  const alpha = creatureAlpha(e, state) * dyingAlpha(e)
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  d.rig.drawMonster(ctx, d.params, entityPose(e), S)
  drawLasers(ctx, e, d, S)
  drawTentacles(ctx, e, d, S)
  ctx.restore()
}

// The Kivihiisi's tentacles (systems/monsters/kivihiisi.js writes `e.lash`):
// four short stubs writhe around a rooted body (bunching up as the eyes
// charge), and the lashing tentacle runs out along the locked aim to the
// hook's tip — a chunky segmented line in the hide colour over a dark
// outline, a slow sine wobble that dies out toward the pale gripping tip so
// the tip lands where the hook tests. Screen space, like the lasers; a few
// dozen small rects. ctx is already at the entity centre.
const STUBS = 4
function tentacle(ctx, pal, k, x0, y0, ang, len, t, phase, taper = 1) {
  const step = 3 * k
  const dx = Math.cos(ang), dy = Math.sin(ang)
  const nx = -dy, ny = dx
  for (let s = step; s <= len; s += step) {
    const f = s / len
    const wob = Math.sin(s / (14 * k) - t * 6 + phase) * 3 * k * (1 - f) * taper
    const w = Math.max(2, Math.round((4 - 2 * f) * k))
    const x = x0 + dx * s + nx * wob, y = y0 + dy * s + ny * wob
    ctx.fillStyle = pal.outline
    ctx.fillRect(Math.round(x - w / 2 - k), Math.round(y - w / 2 - k), w + 2 * k, w + 2 * k)
    ctx.fillStyle = pal.base
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w)
  }
  const tw = Math.max(2, Math.round(3 * k))
  ctx.fillStyle = pal.light
  ctx.fillRect(Math.round(x0 + dx * len - tw / 2), Math.round(y0 + dy * len - tw / 2), tw, tw)
}
function drawTentacles(ctx, e, d, S) {
  const l = e.lash
  if (!l || !(e.stones > 0)) return
  const k = S / TILE_ART_PX
  const pose = entityPose(e)
  const pal = palette(d.params.hideColor ?? '#6e6a63')
  const t = pose.t
  const charge = l.state === 'windup' ? (pose.eyeGlow ?? 0) : 0
  const r0 = 5 * k
  for (let i = 0; i < STUBS; i++) {
    const ang = (i + 0.5) * (Math.PI * 2 / STUBS) + Math.sin(t * 1.7 + i) * 0.4
    const len = (9 + 3 * Math.sin(t * 2.3 + i * 2)) * k * (1 - 0.5 * charge)
    tentacle(ctx, pal, k, Math.cos(ang) * r0, Math.sin(ang) * r0, ang, len, t, i * 1.9)
  }
  if ((l.state === 'extend' || l.state === 'retract') && l.len > 0)
    tentacle(ctx, pal, k, 0, 0, l.aim, l.len * (S / 32), t, 0, 0.6)
}

// Beams live outside the rig's pixel stage (they run far past it), so they
// render here in screen space: chunky segmented rects from the rig's eye
// anchors, flickering white / eye colour. ctx is already at the entity
// centre. Beam angles are world angles set by the hook (e.laser.beams).
function drawLasers(ctx, e, d, S) {
  const l = e.laser
  if (!l || l.state !== 'fire' || !l.beams?.length) return
  const k = S / TILE_ART_PX
  const pose = entityPose(e)
  const body = snapFacing(pose.facing + Math.PI / 2)
  const head = snapFacing(pose.headAim ?? 0)
  const anchors = typeof d.rig.eyeAnchors === 'function' ? d.rig.eyeAnchors(d.params) : null
  const pal = palette(d.params.eyeColor ?? '#ff4040')
  const hot = Math.floor(pose.t * 20) % 2 === 0
  const origins = anchors
    ? anchors.eyes.map(eye => {
        const rx = eye.x * Math.cos(head) - eye.y * Math.sin(head) + anchors.pivot.x
        const ry = eye.x * Math.sin(head) + eye.y * Math.cos(head) + anchors.pivot.y
        return { x: (rx * Math.cos(body) - ry * Math.sin(body)) * k,
                 y: (rx * Math.sin(body) + ry * Math.cos(body)) * k }
      })
    : [{ x: 0, y: 0 }]
  const len = 320 * (S / 32)
  const step = 4 * k
  const w = Math.max(2, Math.round(2 * k))
  for (const b of l.beams) {
    const dx = Math.cos(b.ang), dy = Math.sin(b.ang)
    for (const o of origins) {
      for (let s = step; s < len; s += step) {
        ctx.fillStyle = hot === (Math.floor(s / step) % 2 === 0) ? '#ffffff' : pal.light
        ctx.fillRect(Math.round(o.x + dx * s - w / 2), Math.round(o.y + dy * s - w / 2), w, w)
      }
    }
  }
}
