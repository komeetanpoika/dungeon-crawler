// The scorpions of the desert: skorpioni, the small one, and the emperor
// (keisariskorpioni.js re-exports this module; the numbers differ per def).
//
// By day one that nobody has roused lies buried in loose sand
// (wilds/sand.js): a low mound, the sting's tip and two eyes. It neither
// moves nor looks. It bursts out when the hero comes within `wake` tiles,
// when it is struck (a blow on a buried one lands) and at dusk. Out, the
// enemy brain drives it (`e.brainDriven`) and its pincers are its weapon
// (the def's `claw`). With the hero in `reach` and the sting ready, the tail
// rears for `rear` seconds with the body pinned, then strikes: a hero still
// in reach takes `stingDmg` and is poisoned (systems/poison.js) unless a
// raised shield stops it. With the hero gone `rebury` seconds by day, it
// digs in again where it stands, if that is loose sand.
//
// The def is `driver: 'hook'` so that the buried one runs no brain; the
// update below is called first-thing for a buried one and after brain and
// act for one that is out (game.js enemy loop), so "pinned" means undoing
// the frame's movement, as Podeboo does. Pure: no browser imports.
//
//   e.scorp   { state: 'buried' | 'bursting' | 'out' | 'rearing' | 'struck' | 'digging', t, cd, lost, anchor }
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { damagePlayer } from '../player-damage.js'
import { poisonPlayer } from '../poison.js'
import { looseSand } from '../../wilds/sand.js'
import { sfx } from '../sfx.js'

const S = 32
const STRUCK_TIME = 0.2     // s the tail stays struck out
const DIG_TIME = 0.5        // s it takes to dig in
const LOST_AT = 8           // tiles: further than this the hero is gone

export const TUNING_SCHEMA = [
  { key: 'wake', label: 'Wake distance', group: 'buried', type: 'range', min: 0.5, max: 6, step: 0.1, default: 1.5, hint: 'tiles: a hero this near rouses a buried one' },
  { key: 'burst', label: 'Burst time', group: 'buried', type: 'range', min: 0.05, max: 1.5, step: 0.05, default: 0.3, hint: 'seconds from mound to out' },
  { key: 'rebury', label: 'Digs in after', group: 'buried', type: 'range', min: 1, max: 30, step: 0.5, default: 6, hint: 'seconds with the hero gone, by day' },
  { key: 'buryByDay', label: 'Buries by day', group: 'buried', type: 'toggle', default: true },
  { key: 'reach', label: 'Sting reach', group: 'sting', type: 'range', min: 0.8, max: 4, step: 0.1, default: 1.5, hint: 'tiles from its centre' },
  { key: 'rear', label: 'Rear time', group: 'sting', type: 'range', min: 0.1, max: 1.5, step: 0.05, default: 0.45, hint: 'seconds of tell before the strike' },
  { key: 'stingDmg', label: 'Sting damage', group: 'sting', type: 'range', min: 0, max: 6, step: 1, default: 1 },
  { key: 'poisonTicks', label: 'Poison bites', group: 'sting', type: 'range', min: 0, max: 10, step: 1, default: 3, hint: 'one hp each, four seconds apart' },
  { key: 'cooldown', label: 'Sting cooldown', group: 'sting', type: 'range', min: 0.5, max: 12, step: 0.5, default: 4, hint: 'seconds between stings' },
]

const dayNow = state => !state.night
const canBury = (e, state, T) => T.buryByDay && dayNow(state) && looseSand(state.map, e.x, e.y)
const heroNear = (e, player, tiles) => player && player.hp > 0 && !player.riding &&
  Math.hypot(player.px - e.px, player.py - e.py) <= tiles * S
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }

function ensure(e, state, T) {
  if (e.scorp) return e.scorp
  e.spellOpen = true
  const buried = canBury(e, state, T)
  e.sink = buried ? 1 : 0
  e.brainDriven = !buried
  return e.scorp = { state: buried ? 'buried' : 'out', t: 0, cd: 0, lost: 0, anchor: null }
}
function pin(e, m) {
  if (!m.anchor) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  Object.assign(e, m.anchor)
}
function rouse(e, m, state, T) {
  m.state = 'bursting'; m.t = T.burst
  e.inCombat = true
  sfx(state, 'sink', { px: e.px, py: e.py })
}
function comeOut(e, m) {
  m.state = 'out'; m.t = 0; m.lost = 0; m.anchor = null
  e.sink = 0; e.brainDriven = true
  glow(e, 0)
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e, state, T)
  const { player, map } = state
  m.cd = Math.max(0, m.cd - delta)

  if (m.state === 'buried') {
    e.sink = 1; e.brainDriven = false
    pin(e, m)
    // dusk, a hero too near, a shove: out it comes
    if (!dayNow(state) || heroNear(e, player, T.wake) || e.knockback) rouse(e, m, state, T)
    return
  }
  if (m.state === 'bursting') {
    pin(e, m)
    m.t -= delta
    e.sink = Math.max(0, m.t / T.burst)
    if (m.t <= 0) comeOut(e, m)
    return
  }
  if (m.state === 'digging') {
    pin(e, m)
    m.t -= delta
    e.sink = Math.min(1, 1 - m.t / DIG_TIME)
    if (heroNear(e, player, T.wake)) { rouse(e, m, state, T); return }
    if (m.t <= 0) { m.state = 'buried'; e.sink = 1 }
    return
  }
  if (m.state === 'rearing' || m.state === 'struck') {
    pin(e, m)
    e.damageCooldown = Math.max(e.damageCooldown ?? 0, 0.3)     // the pincers wait for the tail
    if (!player || player.hp <= 0 || player.riding) { m.cd = T.cooldown; comeOut(e, m); return }
    m.t += delta
    if (m.state === 'rearing') {
      if (e.pose) e.pose.facing = Math.atan2(player.py - e.py, player.px - e.px)
      glow(e, Math.min(0.95, m.t / T.rear))
      if (m.t < T.rear) return
      m.state = 'struck'; m.t = 0
      glow(e, 1)
      sfx(state, 'sting', { px: e.px, py: e.py })
      if (heroNear(e, player, T.reach) && damagePlayer(state, T.stingDmg, 'hit', { px: e.px, py: e.py }))
        poisonPlayer(player, T.poisonTicks)
    } else if (m.t >= STRUCK_TIME) { m.cd = T.cooldown; comeOut(e, m) }
    return
  }

  // out: the brain has moved it this frame
  e.sink = 0; e.brainDriven = true
  if (heroNear(e, player, T.reach) && m.cd <= 0 && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
    m.state = 'rearing'; m.t = 0; m.anchor = null
    pin(e, m)
    return
  }
  m.lost = heroNear(e, player, LOST_AT) ? 0 : m.lost + delta
  if (m.lost >= T.rebury && canBury(e, state, T) && !e.knockback) {
    m.state = 'digging'; m.t = DIG_TIME; m.anchor = null
    e.brainDriven = false; e.inCombat = false
    e.attack = null
  }
}

// A blow always lands; on a buried one it also rouses.
export function hit(e, state, dmg) {
  const T = tuningOf(e.type), m = ensure(e, state, T)
  e.hp -= dmg; e.inCombat = true
  if (m.state === 'buried' || m.state === 'digging') rouse(e, m, state, T)
  return { entity: e, absorbed: false, cue: 'melee-hit' }
}

export function debugState(e) {
  const m = e.scorp
  return m ? `${m.state} cd ${m.cd.toFixed(1)} lost ${m.lost.toFixed(1)}` : '-'
}
// Bench overlay: the wake ring and the sting's reach.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.wake, '#ffe14a'], [T.reach, '#ff5a3a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

for (const type of ['skorpioni', 'keisariskorpioni']) {
  CREATURE_UPDATE[type] = update
  CREATURE_HIT[type] = hit
}
