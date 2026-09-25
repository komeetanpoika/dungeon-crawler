// Ukonvasara, Ukko's hammer (systems/quests/pass.js's reward) — the one
// melee weapon that deals *lightning*. Pure logic: game.js wires the hooks
// (hurt / damagePlayer), plays the cues and draws `state.arcs`.
//
// Three release tiers (melee.js CHARGE.ukonvasara), each a flat 3 on the blow:
//   tap   — the blow alone.
//   full  — the blow plus a *shock*: three 1-damage strokes a second apart.
//   over  — no blow at all. A thunderclap shoves and slows everything near the player,
//           and a chain of lightning walks 4 / 3 / 2 / 1 from the struck enemy
//           to the nearest un-chained enemy within `chain.range` tiles of the
//           current node. When no enemy is left in reach the next node is the
//           hero, who takes that node's damage and ends the chain — one enemy
//           means 4 to it and 3 to the hero. A whiff with nothing in reach
//           deals nothing: the chain is empty and the hero wears a personal
//           rain cloud for `rain.dur` seconds that slows the walk.
//
// Every stroke and every node carries `{ source: 'lightning' }`, the damage
// type hurtCreature already keys on (the Näkki's one vulnerability).
// `lightningMods(player)` is the seam talents raise later: extra chain reach
// and extra damage per node ride `player.lightningBonus`.
import { isSpellTarget } from './factions.js'
import { startKnockback } from './knockback.js'
import { applySlow } from './status.js'
import { nearestPoint } from './hitbox.js'

const TILE = 32

export const HAMMER = {
  shock: { strokes: 3, interval: 1.0, damage: 1 },
  chain: { damage: [4, 3, 2, 1], range: 3 },        // range in tiles, node to node
  clap:  { radius: 80, knockback: 30, slow: { mul: 0.4, dur: 3 } },   // px; the slow is Gust's
  arcLife: 0.2,                                      // seconds an arc stays drawn
  rain:  { dur: 4, slowMul: 0.5 },                   // the whiff's cloud over the hero
}

export const lightningMods = player => ({
  range: HAMMER.chain.range + (player?.lightningBonus?.range ?? 0),
  damage: player?.lightningBonus?.damage ?? 0,
})

// --- shock: the full-tier DoT ------------------------------------------------

// Re-applying refreshes the remaining strokes; it never stacks.
export function applyShock(e) {
  e.shock = { left: HAMMER.shock.strokes, tickT: 0 }
}

// Per-frame. A stroke fires every `interval`; the last one clears the shock.
// A corpse (hp <= 0) stops ticking so a kill never keeps crackling. Returns
// how many strokes fired this frame so the caller can draw and sound them.
export function tickShock(e, delta, hooks = {}) {
  const s = e.shock
  if (!s) return { strokes: 0 }
  if (Number.isFinite(e.hp) && e.hp <= 0) { e.shock = undefined; return { strokes: 0 } }
  s.tickT += delta
  let strokes = 0
  while (s.left > 0 && s.tickT >= HAMMER.shock.interval) {
    s.tickT -= HAMMER.shock.interval
    s.left--
    strokes++
    hooks.hurt?.(e, HAMMER.shock.damage, { source: 'lightning' })
    if (Number.isFinite(e.hp) && e.hp <= 0) break
  }
  if (s.left <= 0 || (Number.isFinite(e.hp) && e.hp <= 0)) e.shock = undefined
  return { strokes }
}

// --- chain: the over-tier bolt ----------------------------------------------

const dist = (a, b) => Math.hypot(a.px - b.px, a.py - b.py)

const nearest = (from, candidates, taken, rangePx) => {
  let best = null, bestD = Infinity
  for (const e of candidates) {
    if (taken.has(e) || !isSpellTarget(e)) continue
    const d = dist(from, e)
    if (d <= rangePx && d < bestD) { best = e; bestD = d }
  }
  return best
}

// Plan the chain. `struck` is what the swing itself landed on (the first node
// is the struck enemy nearest the player); `candidates` is everything the
// bolt may seek (game.js passes state.entities — isSpellTarget filters here).
// Returns [{ e, damage }...], the last node `{ player: true, damage }` when
// the enemies ran out before the chain did — or [] when there was no first
// node at all (a whiff: nothing struck, nothing in reach of the player).
export function chainNodes(player, struck, candidates, mods = lightningMods(player)) {
  const rangePx = (mods.range ?? HAMMER.chain.range) * TILE
  const bonus = mods.damage ?? 0
  const nodes = []
  const taken = new Set()
  let from = player
  for (const base of HAMMER.chain.damage) {
    const damage = base + bonus
    const e = nodes.length === 0 && struck.length
      ? [...struck].filter(isSpellTarget).sort((a, b) => dist(player, a) - dist(player, b))[0] ?? null
      : nearest(from, candidates, taken, rangePx)
    if (!e) { if (nodes.length) nodes.push({ player: true, damage }); break }
    taken.add(e)
    nodes.push({ e, damage })
    from = e
  }
  return nodes
}

// Run a planned chain: hurt each enemy node through hooks.hurt, zap the hero
// through hooks.damagePlayer, and record one arc per hop on state.arcs for
// the renderer. Returns { enemies, hero } — nodes hit and damage the hero took.
export function applyChain(state, nodes, hooks = {}, p = state.player) {
  state.arcs = state.arcs ?? []
  let from = p, enemies = 0, hero = 0
  for (const n of nodes) {
    const to = n.player ? p : n.e
    state.arcs.push({ x0: from.px, y0: from.py, x1: to.px, y1: to.py, t: 0, dur: HAMMER.arcLife })
    if (n.player) {
      hooks.damagePlayer?.(n.damage)
      hero += n.damage
    } else {
      hooks.hurt?.(n.e, n.damage, { source: 'lightning' })
      enemies++
    }
    from = to
  }
  return { enemies, hero }
}

// The over-tier clap: no damage — a shove and a three-second slow on every
// spell target within the radius of the player. Returns how many were caught.
export function thunderclap(player, entities) {
  let n = 0
  for (const e of entities) {
    if (!isSpellTarget(e) || !Number.isFinite(e.px)) continue
    const rim = nearestPoint(e, player.px, player.py)   // the clap reaches a body by its rim (systems/hitbox.js)
    if (Math.hypot(rim.x - player.px, rim.y - player.py) > HAMMER.clap.radius) continue
    startKnockback(e, e.px - player.px, e.py - player.py, HAMMER.clap.knockback)
    applySlow(e, HAMMER.clap.slow.mul, HAMMER.clap.slow.dur)
    n++
  }
  return n
}

// --- rain: the whiff's cloud --------------------------------------------------

// A whiffed overcharge hangs a cloud over the hero: no damage, just a slowed
// walk and rain for `rain.dur` seconds. Re-whiffing restarts the timer.
export function applyRain(player) {
  player.rain = { t: 0, dur: HAMMER.rain.dur }
}

export function tickRain(player, delta) {
  if (!player.rain) return
  player.rain.t += delta
  if (player.rain.t >= player.rain.dur) player.rain = undefined
}

// The walk-speed multiplier the cloud imposes; 1 when dry.
export const rainSlow = player => player.rain ? HAMMER.rain.slowMul : 1

// Age the drawn arcs; drop the spent ones.
export function tickArcs(state, delta) {
  if (!state.arcs?.length) return
  for (const a of state.arcs) a.t += delta
  state.arcs = state.arcs.filter(a => a.t < a.dur)
}
