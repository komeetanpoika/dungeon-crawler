// The PvP match: N heroes stepped from input intents at a fixed tick, with
// projectiles, lightning, the hammer's shocks, knockback, deaths, kill
// credit, respawns, pickups and the match clock. Pure and DOM-free — the
// local harness runs it in the page and the server (sub-project 3) will run
// it under Node. Spec: docs/superpowers/specs/2026-09-25-pvp-multi-hero-core-design.md
import { buildArena } from '../systems/map.js'
import { TILE } from '../systems/entities.js'
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

// The arena's tiles. The player spawn is pinned to the first hero spawn, a
// floor cell, so buildArena never skips a column or wall for standing on its
// default spawn; a sand-floored theme swaps FLOOR for SAND (still walkable),
// as generateLevel does for the sand depth.
export function arenaMap(arena = PVP_ARENAS.pillars) {
  const { map } = buildArena({ size: arena.size, columns: arena.columns, walls: arena.walls, player: arena.spawns[0],
    enemies: [], chests: [] }, () => {})
  if (arena.theme?.floorTile === 'sand')
    for (const row of map) for (const c of row) if (c.tile === TILE.FLOOR) c.tile = TILE.SAND
  return map
}

export function makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx: sfxQueue = null, matchLength = PVP.matchLength } = {}) {
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > arena.spawns.length)
    throw new Error(`pvp: roster must hold 1-${arena.spawns.length} heroes`)
  if (new Set(roster.map(r => r.id)).size !== roster.length) throw new Error('pvp: duplicate hero id')
  const match = {
    map: arenaMap(arena), arena, heroes: [], entities: [], projectiles: [], lightning: [], strikes: [], arcs: [],
    shockwaves: [], zones: [], fireZones: [], feedback: makeFeedback(), sfx: sfxQueue,
    pickups: makePickups(arena), clock: 0, tick: 0, acc: 0, ended: false, events: [], inputs: {}, standings: null,
    matchLength, waiting: roster.length < PVP.minHeroes,
  }
  roster.forEach((r, i) => {
    const h = makeHero(r)
    placeHero(h, arena.spawns[i])
    match.heroes.push(h)
  })
  refreshTargets(match)
  return match
}

// Drop-in: a hero joining a running match arrives at the spawn farthest from
// everyone, protected, with kills and deaths at zero.
export function addHero(match, { id, name, cls }) {
  if (heroById(match, id)) throw new Error(`pvp: duplicate hero id "${id}"`)
  if (match.heroes.length >= match.arena.spawns.length) throw new Error('pvp: arena is full')
  const h = makeHero({ id, name, cls })
  placeHero(h, farthestSpawn(match))
  h.spawnProtect = PVP.spawnProtect
  match.heroes.push(h)
  refreshTargets(match)
  match.events.push({ type: 'join', hero: id })
  return h
}

// A hero leaving mid-match; a rune it held goes straight back on its pedestal.
export function removeHero(match, id) {
  const i = match.heroes.findIndex(h => h.id === id)
  if (i === -1) return false
  if (match.heroes[i].rune) {
    const rune = match.pickups.find(p => p.kind === 'rune')
    if (rune) { rune.up = true; rune.t = 0 }
  }
  match.heroes.splice(i, 1)
  refreshTargets(match)
  match.events.push({ type: 'leave', hero: id })
  return true
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
    const landed = hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py } })
    // A blocked or i-framed hit still consumes the projectile (no pierce/
    // chain onto it), but must not also apply its onHit (knockback/stun) —
    // that would push or lock down a hero who took zero damage.
    if (!landed) delete p.onHit
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
    // Sources use max/overwrite semantics, not "add an increase" — so any
    // change this tick (a fresh application, or one that refreshes/shortens
    // a running timer) is rescaled from scratch: the new application lasts
    // now * ccMul, floored so it never cuts short what was already running
    // (bounded above by `now`, the unscaled value).
    if (now !== before[i]) h[f] = Math.max(now * PVP.ccMul, Math.min(before[i], now))
  })
}

function tick(match) {
  const dt = PVP.tick
  match.tick++
  // Fewer than PVP.minHeroes heroes: everything runs but the clock, so a
  // lone player can warm up and the match never ends on them.
  match.waiting = match.heroes.length < PVP.minHeroes
  if (!match.waiting) match.clock += dt

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

  if (!match.waiting && match.clock >= match.matchLength - 1e-9) {
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
    h.hp = 0
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
    // applyKit resets needRelease to false; force it back on so a Space held
    // through death doesn't read as a fresh attack on tick 1 and drop spawn
    // protection instantly. Game.js clears keys[' '] for the local hero on a
    // death instead; a bot or a remote hero has no such hook, so the sim
    // must not assume the input released.
    h.needRelease = true
    match.events.push({ type: 'respawn', hero: h.id })
  }
}
