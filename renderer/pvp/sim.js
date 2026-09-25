// The PvP match: N heroes stepped from input intents at a fixed tick, with
// projectiles, lightning, the hammer's shocks, knockback, deaths, kill
// credit, respawns, pickups and the match clock. Pure and DOM-free — the
// local harness runs it in the page and the server (sub-project 3) will run
// it under Node. Spec: docs/superpowers/specs/2026-09-25-pvp-multi-hero-core-design.md
import { buildArena } from '../systems/map.js'
import { makeFeedback, tickFeedback, addFloat } from '../systems/feedback.js'
import { sfx } from '../systems/sfx.js'
import { stepProjectiles } from '../systems/projectiles.js'
import { tickLightning } from '../systems/spells/lightning.js'
import { tickShock, tickArcs } from '../systems/hammer.js'
import { stepKnockback } from '../systems/knockback.js'
import { canMoveTo, PLAYER_HALF, TILE_SIZE } from '../systems/movement.js'
import { PVP, KITS } from '../data/pvp.js'
import { PVP_ARENAS } from '../data/pvp-arenas.js'
import { makeHero, placeHero, applyKit, tickHero, tickHeroStatus, NEUTRAL_INPUT } from './hero.js'
import { heroById, hurtHero, refreshTargets } from './combat.js'
import { makePickups, tickPickups, tickRunes, endRune } from './pickups.js'

export function makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx: sfxQueue = null } = {}) {
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > arena.spawns.length)
    throw new Error(`pvp: roster must hold 1-${arena.spawns.length} heroes`)
  if (new Set(roster.map(r => r.id)).size !== roster.length) throw new Error('pvp: duplicate hero id')
  const { map } = buildArena({ size: arena.size, columns: arena.columns, enemies: [], chests: [] }, () => {})
  const match = {
    map, arena, heroes: [], entities: [], projectiles: [], lightning: [], strikes: [], arcs: [],
    shockwaves: [], zones: [], fireZones: [], feedback: makeFeedback(), sfx: sfxQueue,
    pickups: makePickups(arena), clock: 0, acc: 0, ended: false, events: [], inputs: {}, standings: null,
  }
  roster.forEach((r, i) => {
    const h = makeHero(r)
    placeHero(h, arena.spawns[i])
    match.heroes.push(h)
  })
  refreshTargets(match)
  return match
}

export function stepMatch(match, inputs = {}, dt = PVP.tick) {
  if (match.ended) return []
  match.inputs = inputs
  match.acc += Math.min(dt, PVP.maxFrame)
  while (match.acc >= PVP.tick - 1e-9 && !match.ended) {
    match.acc -= PVP.tick
    tick(match)
  }
  const events = match.events
  match.events = []
  return events
}

export function setClass(match, heroId, cls) {
  if (!KITS[cls]) throw new Error(`pvp: unknown class "${cls}"`)
  const h = heroById(match, heroId)
  if (h) h.pendingCls = cls
}

export function standings(match) {
  const rows = match.heroes
    .map(h => ({ id: h.id, name: h.name, cls: h.cls, kills: h.kills, deaths: h.deaths }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    r.rank = prev && prev.kills === r.kills && prev.deaths === r.deaths ? prev.rank : i + 1
  })
  return rows
}

export function farthestSpawn(match) {
  const living = match.heroes.filter(h => !h.dead)
  let best = match.arena.spawns[0], bestD = -1
  for (const s of match.arena.spawns) {
    const cx = s.x * TILE_SIZE + TILE_SIZE / 2, cy = s.y * TILE_SIZE + TILE_SIZE / 2
    const d = living.length ? Math.min(...living.map(h => Math.hypot(h.px - cx, h.py - cy))) : 0
    if (d > bestD) { bestD = d; best = s }
  }
  return best
}

const projectileHooks = match => ({
  isHittable: e => e.type === 'hero' && !e.dead && !(e.spawnProtect > 0),
  hurt: (target, damage, p) => {
    hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py } })
    return target
  },
  detonate: () => {},        // no PvP kit fires an exploding projectile
  damagePlayer: () => false, // no enemy projectiles in a match
  cull: entities => entities,
})

const CC_FIELDS = ['stunTimer', 'slowTimer', 'rootTimer']
const ccSnapshot = h => CC_FIELDS.map(f => Math.max(0, h[f] ?? 0))
// Whatever crowd control landed this tick, from any source, lasts PVP.ccMul
// of its single-player length on a hero.
function scaleNewCC(h, before) {
  CC_FIELDS.forEach((f, i) => {
    const now = h[f] ?? 0
    if (now > before[i]) h[f] = before[i] + (now - before[i]) * PVP.ccMul
  })
}

function tick(match) {
  const dt = PVP.tick
  match.clock += dt

  const before = new Map()
  for (const h of match.heroes) {
    if (h.dead) continue
    tickHeroStatus(h, dt)
    before.set(h, ccSnapshot(h))
  }
  refreshTargets(match)
  for (const h of match.heroes) {
    tickHero(match, h, match.inputs[h.id] ?? NEUTRAL_INPUT, dt)
    refreshTargets(match)
  }

  stepProjectiles(match, dt, projectileHooks(match))
  tickLightning(match, dt, {
    hurt: (e, d, info) => { hurtHero(match, e, d, { kind: 'lightning', by: heroById(match, info?.owner) }) },
  })
  for (const h of match.heroes) {
    if (h.dead || !h.shock) continue
    tickShock(h, dt, { hurt: (e, d) => { hurtHero(match, e, d, { kind: 'lightning', by: heroById(match, e.shock?.owner) }) } })
  }
  for (const h of match.heroes) {
    if (!h.dead) stepKnockback(h, dt, (px, py) => canMoveTo(match.map, px, py, PLAYER_HALF))
  }
  tickArcs(match, dt)
  for (const s of match.shockwaves) s.t += dt
  match.shockwaves = match.shockwaves.filter(s => s.t < s.dur)
  tickFeedback(match.feedback, dt)
  for (const [h, b] of before) scaleNewCC(h, b)

  tickRunes(match, dt)
  resolveDeaths(match)
  tickRespawns(match, dt)
  tickPickups(match, dt)
  refreshTargets(match)

  if (match.clock >= PVP.matchLength - 1e-9) {
    match.ended = true
    match.standings = standings(match)
    match.events.push({ type: 'matchEnd', standings: match.standings })
  }
}

// Every hero at 0 hp dies together, so two heroes trading killing blows in
// one tick both score.
function resolveDeaths(match) {
  const dying = match.heroes.filter(h => !h.dead && h.hp <= 0)
  for (const h of dying) {
    if (h.rune) endRune(match, h)
    const c = h.lastHitBy
    const killer = c && match.clock - c.t <= PVP.creditWindow ? heroById(match, c.id) : null
    if (killer && killer !== h) {
      killer.kills++
      addFloat(match.feedback, { px: killer.px, py: killer.py - 16, text: '+1', kind: 'heal' })
    } else {
      h.kills--
    }
    h.deaths++
    match.events.push({ type: 'kill', victim: h.id, killer: killer && killer !== h ? killer.id : null })
    sfx(match, 'enemy-death', { px: h.px, py: h.py })
  }
  for (const h of dying) {
    h.dead = true
    h.respawnT = PVP.respawnDelay
    h.lastHitBy = null
    h.charging = null
    h.knockback = null
    h.shock = undefined
    h.blocking = false
  }
}

function tickRespawns(match, dt) {
  for (const h of match.heroes) {
    if (!h.dead) continue
    h.respawnT -= dt
    if (h.respawnT > 0) continue
    applyKit(h, h.pendingCls ?? h.cls)
    h.pendingCls = null
    placeHero(h, farthestSpawn(match))
    h.dead = false
    h.spawnProtect = PVP.spawnProtect
    match.events.push({ type: 'respawn', hero: h.id })
  }
}
