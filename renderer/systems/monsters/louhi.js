// Louhi of Pohjola as the great eagle, on the keep's battlements with the
// Sampo (wilds/city/sampo-end.js). She cannot be reached aloft: she circles,
// hangs a moment over where the player stands, stoops on that spot, and then
// sits winded where she landed, which is when she can be struck. Walls mean
// nothing to her; she keeps inside the floor's edge. `e.sink` is her height
// and `e.flicker` her stoop, for the rig (render/monster-rigs/eagle.js). Pure:
// no browser imports.
//
//   e.wing = { state: 'aloft' | 'stoop' | 'dive' | 'down', t, a, aim: { px, py }, hit }
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { sfx } from '../sfx.js'

const S = 32
export const EAGLE = {
  aloft: 2.4, stoop: 0.7, dive: 0.6, down: 2.8,   // seconds in each
  drift: 90, speed: 420,                          // px a second circling, and stooping
  standoff: 4.5,                                  // tiles she circles from the player
  strike: 2, reach: 22, shove: 36,                // her stoop: hearts, px it carries, px it throws
}

export function ensureEagle(e) {
  if (e.wing) return e.wing
  e.sink = 1
  return e.wing = { state: 'aloft', t: EAGLE.aloft, a: 0, aim: null, hit: false }
}

function move(e, state, tx, ty, step) {
  const dx = tx - e.px, dy = ty - e.py, d = Math.hypot(dx, dy)
  const k = d <= step || d === 0 ? 1 : step / d
  const w = (state.map?.[0]?.length ?? 0) * S, h = (state.map?.length ?? 0) * S
  e.px = Math.max(1.5 * S, Math.min(Math.max(1.5 * S, w - 1.5 * S), e.px + dx * k))
  e.py = Math.max(3.5 * S, Math.min(Math.max(3.5 * S, h - 1.5 * S), e.py + dy * k))
  e.x = Math.floor(e.px / S); e.y = Math.floor(e.py / S)
  if (e.pose && dx) e.pose.facing = dx < 0 ? Math.PI : 0
  return d <= step
}
const ease = (v, to, rate) => v + Math.max(-rate, Math.min(rate, to - v))

export function updateEagle(e, state, delta) {
  const W = ensureEagle(e), { player } = state
  W.t -= delta
  e.flicker = W.state === 'dive' ? 1 : 0   // the rig's stoop frame
  if (W.state === 'aloft') {
    e.sink = ease(e.sink, 1, delta * 2.5)
    W.a += delta * 0.9
    move(e, state, player.px + Math.cos(W.a) * EAGLE.standoff * S, player.py + Math.sin(W.a) * EAGLE.standoff * S, EAGLE.drift * delta)
    if (W.t <= 0) { W.state = 'stoop'; W.t = EAGLE.stoop; W.aim = { px: player.px, py: player.py } }
  } else if (W.state === 'stoop') {
    // she hangs, marking the spot: time to be somewhere else
    e.sink = ease(e.sink, 0.7, delta)
    if (e.pose) e.pose.facing = W.aim.px < e.px ? Math.PI : 0
    if (W.t <= 0) { W.state = 'dive'; W.t = EAGLE.dive; W.hit = false; sfx(state, 'melee-swing', { px: e.px, py: e.py }) }
  } else if (W.state === 'dive') {
    e.sink = ease(e.sink, 0.15, delta * 3)
    const there = move(e, state, W.aim.px, W.aim.py, EAGLE.speed * delta)
    if (!W.hit && Math.hypot(player.px - e.px, player.py - e.py) <= EAGLE.reach) {
      W.hit = true
      if (damagePlayer(state, EAGLE.strike, 'hit', { px: e.px, py: e.py })) startKnockback(player, player.px - e.px || 1, player.py - e.py, EAGLE.shove)
    }
    if (there || W.t <= 0) { W.state = 'down'; W.t = EAGLE.down }
  } else {
    e.sink = ease(e.sink, 0, delta * 4)
    if (W.t <= 0) { W.state = 'aloft'; W.t = EAGLE.aloft }
  }
}

CREATURE_UPDATE.louhi = updateEagle
// out of reach until she has landed
CREATURE_HIT.louhi = (e, state, dmg) => {
  const W = ensureEagle(e)
  if (W.state !== 'down') return { entity: e, absorbed: true, cue: null }
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}
