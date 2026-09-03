// Friendly creatures: villagers and animals that go about their business.
// A species carries an ordered list of goal names; every frame the first goal
// whose `when` holds runs and returns a movement intent for act(). Hostile
// NPCs hand the decision to the enemy brain, so they chase and fight like a
// guard. Pure logic — no DOM.
import { NPC_SPECIES } from '../data/npcs.js'
import { getAIConfig } from '../data/enemy-ai.js'
import { hasLineOfSight } from './entities.js'
import { buildNavGrid, passable } from './nav.js'
import { act } from './act.js'
import { updateBrain } from './brain.js'
import { tryStartEnemyAttack } from './enemy-attack.js'
import { speakFrom } from './feedback.js'
import { sfx } from './sfx.js'
import { hurtCreature } from './creatures.js'

const S = 32
export const FLEE_TIME = 3          // s a hit `flee` species keeps running
export const STARTLE_TIME = 2       // s a startled animal keeps running
export const REACT_TIME = 0.5       // s an animal's interact hop/bounce lasts
export const WANDER_DWELL = [1, 4]  // s paused at each wander point
export const VILLAGER_DWELL_MAX = 6 // villagers linger longer
const THREAT_RANGE = 240            // px inside which a hurt NPC bothers fleeing
const GIVE_UP_TIME = 3              // s stuck against an unpathable target before giving up
export const HUNT_RANGE = 8 * S     // px a `prey` species will chase a target within
export const BITE_REACH = 30        // px within which hunt_prey stops closing and bites
export const BITE_INTERVAL = 0.8    // s between bites once in reach
export const BITE_DMG = 2           // damage per bite, via hurtCreature

export function makeNpc({ species, id, x, y, hostile = undefined, role = null }) {
  const def = NPC_SPECIES[species]
  if (!def) { console.warn(`npc: unknown species "${species}"`); return null }
  return {
    type: 'npc', species, id, faction: def.faction,
    ...(role ? { role } : {}),
    x, y, px: x * S + S / 2, py: y * S + S / 2,
    hp: def.hp, maxHp: def.hp, hostile: hostile === undefined ? !!def.hostile : !!hostile,
    home: { x, y }, objective: null, facing: 'east', inCombat: false,
    damageCooldown: 0, aiHalf: 4,
    ...(def.weapon ? { weaponId: def.weapon } : {}),
    ai: { current: null, goals: {}, fleeTimer: 0, startleTimer: 0, reactTimer: 0 },
  }
}

export function buildCtx(e, state, delta) {
  const { player, map } = state
  const def = NPC_SPECIES[e.species]
  return {
    state, delta, def, cfg: getAIConfig(e),
    playerDist: Math.hypot(player.px - e.px, player.py - e.py),
    canSeePlayer: hasLineOfSight(map, e.y, e.x, player.y, player.x),
    hpFrac: e.maxHp ? e.hp / e.maxHp : 1,
  }
}

const atTile = (e, t) => Math.hypot(t.x * S + S / 2 - e.px, t.y * S + S / 2 - e.py) < S * 0.6
const rand = (lo, hi) => lo + Math.random() * (hi - lo)
// act() leaves ai.path === null when its cached A* target is unpathable.
const isStuckOn = (e, target) => e.ai.path === null && e.ai.pathTarget &&
  e.ai.pathTarget.x === target.x && e.ai.pathTarget.y === target.y

// The tiles a wander may target: within `roam` chebyshev of home and reachable
// from home without stepping outside that box. One bounded 4-neighbour BFS,
// cached on the NPC and keyed by the nav grid object (a new map builds a new
// grid, which invalidates it), replaces a fistful of A* searches per repick.
function wanderReach(e, nav, roam) {
  const goals = e.ai.goals ?? (e.ai.goals = {})
  const w = goals.wander ?? (goals.wander = {})
  if (w.reach && w.nav === nav) return w.reach
  const { x: hx, y: hy } = e.home
  const inBox = (x, y) => Math.abs(x - hx) <= roam && Math.abs(y - hy) <= roam
  const reach = []
  if (passable(nav, hx, hy, 1)) {
    const seen = new Set([`${hx},${hy}`])
    reach.push({ x: hx, y: hy })
    for (let i = 0; i < reach.length; i++) {
      const t = reach[i]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = t.x + dx, y = t.y + dy, k = `${x},${y}`
        if (seen.has(k) || !inBox(x, y) || !passable(nav, x, y, 1)) continue
        seen.add(k)
        reach.push({ x, y })
      }
    }
  }
  w.nav = nav; w.reach = reach
  return reach
}

// Pick a wander point: one random draw from the reach set, never the tile the
// NPC already stands on. An NPC that has strayed outside its box (after a
// flee) simply walks back toward a box tile — act()'s patrol plus the
// isStuckOn give-up in wander handle a route that does not work out.
function pickWanderPoint(e, ctx) {
  const nav = buildNavGrid(ctx.state.map)
  const reach = wanderReach(e, nav, ctx.def.roam)
  if (!reach.length) return null
  let i = Math.floor(Math.random() * reach.length)
  if (reach[i].x === e.x && reach[i].y === e.y) i = (i + 1) % reach.length
  const t = reach[i]
  return (t.x === e.x && t.y === e.y) ? null : { x: t.x, y: t.y }
}

// A species with `prey` hunts the nearest surfaced, living prey entity it
// can see within HUNT_RANGE — the fold's wolves versus the Maahinen.
export function findPrey(e, ctx) {
  const prey = ctx.def.prey
  if (!prey) return null
  let best = null, bestD = HUNT_RANGE
  for (const p of ctx.state.entities) {
    if (!prey.includes(p.type) || p.state !== 'surfaced' || p.dying > 0 || !(p.hp > 0)) continue
    const d = Math.hypot(p.px - e.px, p.py - e.py)
    if (d > bestD || !hasLineOfSight(ctx.state.map, e.y, e.x, p.y, p.x)) continue
    best = p; bestD = d
  }
  return best
}

export const GOALS = {
  flee_hurt: {
    when: (e, ctx) => e.ai.fleeTimer > 0 ||
      (e.hp < e.maxHp && ctx.hpFrac <= ctx.def.fleeHp && ctx.playerDist < THREAT_RANGE),
    enter: e => { e.ai.fleeTimer = Math.max(e.ai.fleeTimer, FLEE_TIME) },
    run: (e, ctx, dt) => { e.ai.fleeTimer = Math.max(0, e.ai.fleeTimer - dt); return { mode: 'flee', speed: ctx.cfg.speed } },
  },
  hunt_prey: {
    when: (e, ctx) => !!findPrey(e, ctx),
    enter: e => { e.ai.biteT = 0 },
    run: (e, ctx, dt) => {
      const prey = findPrey(e, ctx)
      if (!prey) return { mode: 'hold' }
      e.ai.biteT = Math.max(0, (e.ai.biteT ?? 0) - dt)
      if (Math.hypot(prey.px - e.px, prey.py - e.py) > BITE_REACH)
        return { mode: 'patrol', target: { x: prey.x, y: prey.y }, speed: ctx.cfg.speed }
      e.facing = prey.px < e.px ? 'west' : 'east'
      if (e.ai.biteT <= 0) {
        e.ai.biteT = BITE_INTERVAL
        const r = hurtCreature(ctx.state, prey, BITE_DMG, { source: 'wolf' })
        if (r.cue) sfx(ctx.state, r.cue, { px: prey.px, py: prey.py })
      }
      return { mode: 'hold' }
    },
  },
  attack_hostile: {
    when: e => e.hostile,
    run: (e, ctx) => {
      const intent = updateBrain(e, ctx.state, ctx.delta)
      tryStartEnemyAttack(e, ctx.state)
      return intent
    },
  },
  startle: {
    when: (e, ctx) => !!ctx.def.startle && (e.ai.startleTimer > 0 || ctx.playerDist < ctx.def.startle),
    enter: e => { e.ai.startleTimer = Math.max(e.ai.startleTimer, STARTLE_TIME) },
    run: (e, ctx, dt) => { e.ai.startleTimer = Math.max(0, e.ai.startleTimer - dt); return { mode: 'flee', speed: ctx.cfg.speed } },
  },
  go_to: {
    when: e => !!e.objective,
    enter: e => { e.ai.giveUp = 0 },
    run: (e, ctx) => {
      if (atTile(e, e.objective)) { e.objective = null; return { mode: 'hold' } }
      // give up on a target that stays unpathable for a while; a single stray
      // frame in which the path does come back resets the counter to zero
      if (isStuckOn(e, e.objective)) {
        e.ai.giveUp = (e.ai.giveUp ?? 0) + ctx.delta
        if (e.ai.giveUp >= GIVE_UP_TIME) { e.ai.giveUp = 0; e.objective = null; return { mode: 'hold' } }
      } else {
        e.ai.giveUp = 0
      }
      return { mode: 'patrol', target: e.objective, speed: ctx.cfg.speed }
    },
  },
  wander: {
    when: () => true,
    enter: e => { e.ai.wanderPt = null; e.ai.dwell = 0 },
    run: (e, ctx, dt) => {
      const ai = e.ai
      if (ai.dwell > 0) { ai.dwell = Math.max(0, ai.dwell - dt); return { mode: 'hold' } }
      if (!ai.wanderPt) {
        ai.wanderPt = pickWanderPoint(e, ctx)
        if (!ai.wanderPt) { ai.dwell = WANDER_DWELL[0]; return { mode: 'hold' } }
      }
      if (atTile(e, ai.wanderPt) || isStuckOn(e, ai.wanderPt)) {
        ai.wanderPt = null
        const max = ctx.def.walker ? VILLAGER_DWELL_MAX : WANDER_DWELL[1]
        ai.dwell = rand(WANDER_DWELL[0], max)
        return { mode: 'hold' }
      }
      return { mode: 'patrol', target: ai.wanderPt, speed: ctx.cfg.wanderSpeed }
    },
  },
}

// First goal in the species list whose `when` holds. Runs `enter` on a change.
export function selectGoal(e, ctx) {
  const def = ctx.def
  let chosen = 'wander'
  for (const name of def.priorities) {
    const g = GOALS[name]
    if (g && g.when(e, ctx)) { chosen = name; break }
  }
  if (e.ai.current !== chosen) {
    e.ai.current = chosen
    GOALS[chosen].enter?.(e, ctx)
  }
  return chosen
}

export function updateNpc(e, state, delta) {
  if (!NPC_SPECIES[e.species]) return
  e.damageCooldown = Math.max(0, (e.damageCooldown ?? 0) - delta)
  e.ai.reactTimer = Math.max(0, (e.ai.reactTimer ?? 0) - delta)
  if (e.stunTimer > 0) { e.stunTimer -= delta; return }
  const ctx = buildCtx(e, state, delta)
  const name = selectGoal(e, ctx)
  const intent = GOALS[name].run(e, ctx, delta)
  const prevPx = e.px
  if (intent) act(e, state, delta, intent)
  const movedX = e.px - prevPx
  if (Math.abs(movedX) > 0.1) e.facing = movedX > 0 ? 'east' : 'west'
}

// Called by every damage site right after an NPC's hp drops. Flee species run;
// fight species turn hostile; any blow on a villager rouses the village.
export function onNpcHit(e, state) {
  const def = NPC_SPECIES[e.species]
  if (!def) return { hostile: false, wrath: false }
  e.inCombat = true
  if (def.onHit === 'fight') e.hostile = true
  else e.ai.fleeTimer = Math.max(e.ai.fleeTimer ?? 0, FLEE_TIME)
  let wrath = false
  if (def.faction === 'village') {
    for (const o of state.entities) {
      if (o.type !== 'npc' || o.faction !== 'village') continue
      if (NPC_SPECIES[o.species]?.onHit === 'fight') o.hostile = true
    }
    if (!state.npcWrath) { state.npcWrath = true; wrath = true }
  }
  return { hostile: e.hostile, wrath }
}

// What a dead NPC leaves behind: meat, with the species' chance. Villagers
// (no `drop`) never yield anything. Returns chest-style contents or null.
export function rollNpcDrop(e, rng = Math.random) {
  const chance = NPC_SPECIES[e.species]?.drop ?? 0
  return chance > 0 && rng() < chance ? { type: 'meat' } : null
}

// Villagers rotate faces by their spawn index so a village is not clones.
// The returned local is the exception: they get one fixed face of their own,
// so the person who walks back in is visibly not a neighbour.
export function spriteKeyFor(e) {
  const def = NPC_SPECIES[e.species]
  if (!def) return null
  if (e.role === 'missing') return 'npc_villager_3'
  if (e.species !== 'villager') return def.sprite
  const idx = Number(e.id?.split(':').at(-1)) || 0
  return ['npc_villager', 'npc_villager_2', 'npc_villager_3'][idx % 3]
}

export function nearestPeacefulNpc(state, maxPx = 48) {
  const { player } = state
  let best = null, bestD = maxPx
  for (const e of state.entities) {
    if (e.type !== 'npc' || e.hostile) continue
    const d = Math.hypot(e.px - player.px, e.py - player.py)
    if (d < bestD) { best = e; bestD = d }
  }
  return best
}

// The interact button on a peaceful NPC. Villagers turn, linger and speak;
// animals do their species reaction with a cue. Hostile NPCs ignore it.
export function interactNpc(state, e, rng = Math.random) {
  const def = NPC_SPECIES[e.species]
  if (!def || e.hostile) return null
  const { player } = state
  const lines = state.villagerLines?.[e.species] ?? def.lines
  if (lines) {
    e.facing = player.px < e.px ? 'west' : 'east'
    e.ai.wanderPt = null
    e.ai.dwell = Math.max(e.ai.dwell ?? 0, 3)
    const text = lines[Math.floor(rng() * lines.length)]
    speakFrom(state, e, text)
    return { kind: 'speech', text }
  }
  sfx(state, `npc-${e.species}`, { px: e.px, py: e.py })
  if (def.react === 'hop') e.ai.reactTimer = REACT_TIME
  else e.ai.startleTimer = Math.max(e.ai.startleTimer, def.react === 'bolt' ? STARTLE_TIME : 1)
  return { kind: 'react', react: def.react }
}
