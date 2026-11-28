// Kyy, the viper: Syöjätär's children, and the marsh coven's only teeth.
// One blow kills it. The enemy brain brings it to the hero; it has no
// weapon of the game's (no swing): its bite is this hook's, the supplement
// that runs after the brain, so "pinned" means undoing the frame's movement.
//
// With the hero within `reach` tiles, in sight, and its bite ready, it
// coils for `coil` seconds, pinned and hissing (pose.eyeGlow: the S draws
// tight, the head comes back). Then it strikes out to `strike` tiles: a
// hero still that near takes `biteDmg` and, if the bite landed (no shield
// stopped it, no grace was on him), `poisonTicks` bites' worth of poison
// (systems/poison.js). `cooldown` seconds pass before it coils again. A step
// back in the coil's time dodges it; so does killing it.
//
// Pure: no browser imports.
//
//   e.kyy   { state: 'slither' | 'coil' | 'struck', t, cd, anchor }
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { damagePlayer } from '../player-damage.js'
import { poisonPlayer } from '../poison.js'
import { sfx } from '../sfx.js'

const S = 32
const STRUCK_TIME = 0.18     // s it stays struck out

export const TUNING_SCHEMA = [
  { key: 'reach', label: 'Coils within', group: 'bite', type: 'range', min: 0.4, max: 3, step: 0.05, default: 0.9, hint: 'tiles' },
  { key: 'coil', label: 'Coil time', group: 'bite', type: 'range', min: 0.1, max: 1.5, step: 0.05, default: 0.35, hint: 'seconds of tell before the strike' },
  { key: 'strike', label: 'Strikes as far as', group: 'bite', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.1, hint: 'tiles' },
  { key: 'biteDmg', label: 'Bite damage', group: 'bite', type: 'range', min: 0, max: 4, step: 1, default: 1 },
  { key: 'poisonTicks', label: 'Poison bites', group: 'bite', type: 'range', min: 0, max: 10, step: 1, default: 2, hint: 'one hp each, four seconds apart' },
  { key: 'cooldown', label: 'Bite cooldown', group: 'bite', type: 'range', min: 0.3, max: 8, step: 0.1, default: 1.6, hint: 'seconds' },
]

const ensure = e => e.kyy ?? (e.kyy = { state: 'slither', t: 0, cd: 0, anchor: null })
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
const heroNear = (e, player, tiles) => !!player && player.hp > 0 && !player.riding &&
  Math.hypot(player.px - e.px, player.py - e.py) <= tiles * S
function pin(e, m) {
  if (!m.anchor || e.knockback) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  else Object.assign(e, m.anchor)
}
function uncoil(e, m, cd) {
  m.state = 'slither'; m.t = 0; m.cd = cd; m.anchor = null
  glow(e, 0)
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player, map } = state

  if (m.state === 'coil' || m.state === 'struck') {
    if (!player || player.hp <= 0 || player.riding) { uncoil(e, m, T.cooldown); return }
    pin(e, m)
    m.t += delta
    if (m.state === 'coil') {
      if (e.pose) e.pose.facing = Math.atan2(player.py - e.py, player.px - e.px)
      glow(e, Math.min(0.95, m.t / T.coil))
      if (m.t < T.coil) return
      m.state = 'struck'; m.t = 0
      glow(e, 1)
      if (heroNear(e, player, T.strike) && damagePlayer(state, T.biteDmg, 'hit', { px: e.px, py: e.py }))
        poisonPlayer(player, T.poisonTicks)
    } else if (m.t >= STRUCK_TIME) uncoil(e, m, T.cooldown)
    return
  }

  // slither: the brain has moved it this frame
  m.cd = Math.max(0, m.cd - delta)
  if (m.cd <= 0 && heroNear(e, player, T.reach) && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
    m.state = 'coil'; m.t = 0; m.anchor = null
    pin(e, m)
    e.inCombat = true
    sfx(state, 'hiss', { px: e.px, py: e.py })
  }
}

export function debugState(e) {
  const m = e.kyy
  return m ? `${m.state} cd ${m.cd.toFixed(1)}` : '-'
}
// Bench overlay: where it coils, and how far it strikes.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.reach, '#ffe14a'], [T.strike, '#ff5a3a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.kyy = update
