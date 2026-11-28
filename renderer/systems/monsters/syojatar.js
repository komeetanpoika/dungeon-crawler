// Syöjätär, mother of snakes: the marsh coven's boss, at her sabbath fire.
// The enemy brain walks her (she keeps off: the def's kiteBand) and she has
// no weapon of the game's; her three moves are this hook's, the supplement
// that runs after the brain, so "pinned" means undoing the frame's movement.
// One move at a time: the brood before the fan, the fan before the spit.
//
// Spit. With the hero in sight within `spitRange` tiles, every `spitEvery`
// seconds (the first after `spitFirst`): she rears back for `spitWind`
// seconds, pinned (pose.eyeGlow), and a gob flies `spitFlight` seconds to
// where he stood as it left her. A hero within `spitR` tiles of where it
// lands takes `spitDmg` (a raised shield facing her stops it). It leaves a
// pool `poolR` tiles in radius for `poolLife` seconds, `poolMax` at most
// (the oldest dries first). Whoever of the hero steps into a pool, or
// stands in one with no poison in him, is poisoned `poolTicks` bites' worth
// (systems/poison.js); the pool itself wounds nothing.
//
// Brood. The first time her health is at or under `broodAt` of the whole,
// and again at `broodAgain`, she screams for `broodWind` seconds, pinned
// (pose.scream), and `broodCount` vipers come out of her skirts
// (systems/tribes.js summonNear). Twice in her life, never more; a blow
// through both marks at once brings them one after the other.
//
// The fan. From `fanBelow` of her health down, every `fanEvery` seconds (the
// first after `fanFirst`) she points for `fanWind` seconds, pinned
// (pose.point), and three hexes fly, one at the hero and one `fanArc`
// radians to either side (systems/tribes/wisps.js).
//
// A hero who dies or rides off ends a spit or a fan with nothing thrown.
// Only the hero is hurt, poisoned or hexed. Dying she leaves a chest's worth
// (the def's `behavior.drops`) and teaches the talent Käärmeenkieli, once
// (systems/talents.js). Her pools, wisps and any gob in the air go with her.
// Pure: no browser imports.
//
//   e.syo       { state: 'idle' | 'spit' | 'fan' | 'scream', t, spitT, fanT, broods, anchor, snap,
//                 gob: { x0, y0, x1, y1, t } | null, splash: { px, py, t } | null }
//   e.pools     [{ px, py, t, in }]   world px, seconds old, the hero stood in it last frame
//   e.wisps     her hexes in flight
//   e.channels  { scream, point } for her rig
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef, entityPose } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { stormReach } from '../brain.js'
import { damagePlayer } from '../player-damage.js'
import { poisonPlayer, isPoisoned } from '../poison.js'
import { shatterBonus } from '../status.js'
import { grantTalent } from '../talents.js'
import { summonNear, withId } from '../tribes.js'
import { WISP_TUNING, castWisp, tickWisps, drawWisps } from '../tribes/wisps.js'
import { sfx } from '../sfx.js'

const S = 32
const SPLASH_SHOW = 0.3      // s the landing's splash is drawn
const SNAP_SHOW = 0.22       // s her head stays snapped forward after the spit
const ARC = 30               // px the gob rises at the top of its flight
const POOL = { dark: '#3d6b24', base: '#6fae2e', light: '#b4e05a', froth: '#e6f7a8' }

export const TUNING_SCHEMA = [
  { key: 'spitFirst', label: 'First spit after', group: 'spit', type: 'range', min: 0, max: 10, step: 0.5, default: 1.5, hint: 'seconds with the hero in sight' },
  { key: 'spitEvery', label: 'Spit every', group: 'spit', type: 'range', min: 1, max: 15, step: 0.5, default: 4.5, hint: 'seconds' },
  { key: 'spitRange', label: 'Spits within', group: 'spit', type: 'range', min: 3, max: 14, step: 0.5, default: 9, hint: 'tiles, in sight' },
  { key: 'spitWind', label: 'Rears for', group: 'spit', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.5, hint: 'seconds of tell' },
  { key: 'spitFlight', label: 'Flight', group: 'spit', type: 'range', min: 0.15, max: 1.5, step: 0.05, default: 0.5, hint: 'seconds in the air' },
  { key: 'spitR', label: 'Gob hits within', group: 'spit', type: 'range', min: 0.3, max: 2, step: 0.1, default: 0.7, hint: 'tiles of where it lands' },
  { key: 'spitDmg', label: 'Gob damage', group: 'spit', type: 'range', min: 0, max: 5, step: 1, default: 1 },
  { key: 'poolR', label: 'Pool radius', group: 'pool', type: 'range', min: 0.25, max: 1.5, step: 0.05, default: 0.55, hint: 'tiles (1.1 across)' },
  { key: 'poolLife', label: 'Pool lasts', group: 'pool', type: 'range', min: 1, max: 20, step: 0.5, default: 7, hint: 'seconds' },
  { key: 'poolMax', label: 'Pools at most', group: 'pool', type: 'range', min: 0, max: 8, step: 1, default: 4 },
  { key: 'poolTicks', label: 'Pool poison', group: 'pool', type: 'range', min: 0, max: 10, step: 1, default: 3, hint: 'bites, one hp each' },
  { key: 'broodAt', label: 'First brood at', group: 'brood', type: 'range', min: 0.1, max: 0.95, step: 0.01, default: 0.67, hint: 'of her health' },
  { key: 'broodAgain', label: 'Second brood at', group: 'brood', type: 'range', min: 0.05, max: 0.9, step: 0.01, default: 0.34, hint: 'of her health' },
  { key: 'broodWind', label: 'Screams for', group: 'brood', type: 'range', min: 0.2, max: 3, step: 0.1, default: 1, hint: 'seconds, pinned' },
  { key: 'broodCount', label: 'Vipers a brood', group: 'brood', type: 'range', min: 0, max: 6, step: 1, default: 3 },
  { key: 'fanBelow', label: 'Fans hexes below', group: 'hex', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.67, hint: 'of her health' },
  { key: 'fanFirst', label: 'First fan after', group: 'hex', type: 'range', min: 0, max: 15, step: 0.5, default: 2, hint: 'seconds' },
  { key: 'fanEvery', label: 'Fan every', group: 'hex', type: 'range', min: 2, max: 30, step: 0.5, default: 11, hint: 'seconds' },
  { key: 'fanWind', label: 'Points for', group: 'hex', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.6, hint: 'seconds of tell' },
  { key: 'fanArc', label: 'Fan spread', group: 'hex', type: 'range', min: 0.1, max: 1.2, step: 0.05, default: 0.35, hint: 'radians between two hexes' },
  ...WISP_TUNING,
]

function ensure(e, T) {
  if (e.syo) return e.syo
  e.channels = { ...(e.channels ?? null), scream: 0, point: 0 }
  e.pools ??= []
  return e.syo = { state: 'idle', t: 0, spitT: T.spitFirst, fanT: T.fanFirst, broods: 0, anchor: null, snap: 0, gob: null, splash: null }
}
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
const face = (e, to) => { if (e.pose) e.pose.facing = Math.atan2(to.py - e.py, to.px - e.px) }
function pin(e, m) {
  if (!m.anchor || e.knockback) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  else Object.assign(e, m.anchor)
}
function rest(e, m) {
  m.state = 'idle'; m.t = 0; m.anchor = null; m.snap = 0
  e.channels.scream = 0; e.channels.point = 0
  glow(e, 0)
}
function begin(e, m, state) {
  m.state = state; m.t = 0; m.anchor = null
  pin(e, m)
}
// Where a part of her is drawn, in world px (her rig says: render/monster-rigs/crone.js).
function partOf(e, part) {
  const d = getMonsterDef(e.type)
  const a = typeof d?.rig.anchor === 'function' ? d.rig.anchor(d.params, entityPose(e), S, part) : null
  return a ? { px: e.px + a.x, py: e.py + a.y } : { px: e.px, py: e.py }
}
const broodMark = (m, T) => [T.broodAt, T.broodAgain][m.broods]

// The pools: they age and dry, and poison the hero who steps into one, or
// who stands in one with no poison left in him.
function tickPools(e, state, delta, T, ok) {
  const { player } = state
  for (const p of e.pools) {
    p.t += delta
    const inside = ok && Math.hypot(player.px - p.px, player.py - p.py) <= T.poolR * S
    if (inside && (!p.in || !isPoisoned(player))) poisonPlayer(player, T.poolTicks)
    p.in = inside
  }
  if (e.pools.some(p => p.t >= T.poolLife)) e.pools = e.pools.filter(p => p.t < T.poolLife)
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e, T)
  const { player, map } = state
  const ok = !!player && player.hp > 0 && !player.riding
  const d = ok ? Math.hypot(player.px - e.px, player.py - e.py) : Infinity
  const seen = ok && d <= Math.min(T.spitRange * S, stormReach(state)) && hasLineOfSight(map, e.y, e.x, player.y, player.x)
  const low = e.hp <= e.maxHp * T.fanBelow

  // ---- what is already in the air or on the ground ------------------------------
  tickWisps(state, e, delta, T)
  if (m.splash && (m.splash.t += delta) >= SPLASH_SHOW) m.splash = null
  if (m.gob && (m.gob.t += delta) >= T.spitFlight) {
    const at = { px: m.gob.x1, py: m.gob.y1 }
    m.gob = null
    m.splash = { ...at, t: 0 }
    sfx(state, 'splat', at)
    if (ok && Math.hypot(player.px - at.px, player.py - at.py) <= T.spitR * S) damagePlayer(state, T.spitDmg, 'hit', { px: e.px, py: e.py })
    if (T.poolMax > 0) {
      e.pools.push({ ...at, t: 0, in: false })
      while (e.pools.length > T.poolMax) e.pools.shift()
    }
  }
  tickPools(e, state, delta, T, ok)

  // her clocks run while there is somebody to spit at, whatever she is at
  if (seen) {
    m.spitT = Math.max(0, m.spitT - delta)
    if (low) m.fanT = Math.max(0, m.fanT - delta)
  }

  if (m.state === 'scream') {
    pin(e, m)
    m.t += delta
    e.channels.scream = 1
    if (m.t < T.broodWind) return
    m.broods++
    rest(e, m)
    for (let i = 0; i < T.broodCount; i++)
      summonNear(state, e, 'kyy', { min: 1, max: 2.5, extra: { madeBy: withId(e).id, home: { x: e.x, y: e.y }, inCombat: true } })
    return
  }

  if (m.state === 'spit') {
    if (!ok) { rest(e, m); return }
    pin(e, m)
    face(e, player)
    m.t += delta
    glow(e, Math.min(0.95, m.t / T.spitWind))
    if (m.t < T.spitWind) return
    const from = partOf(e, 'mouth')
    m.gob = { x0: from.px, y0: from.py, x1: player.px, y1: player.py, t: 0 }
    m.spitT = T.spitEvery
    sfx(state, 'spit', { px: e.px, py: e.py })
    rest(e, m)
    m.snap = SNAP_SHOW
    return
  }

  if (m.state === 'fan') {
    if (!ok) { rest(e, m); return }
    pin(e, m)
    face(e, player)
    m.t += delta
    e.channels.point = Math.min(0.95, m.t / T.fanWind)
    if (m.t < T.fanWind) return
    const from = partOf(e, 'hand'), at = Math.atan2(player.py - from.py, player.px - from.px)
    for (const turn of [-1, 0, 1]) castWisp(e, from.px, from.py, at + turn * T.fanArc, T)
    m.fanT = T.fanEvery
    sfx(state, 'hex-cast', { px: e.px, py: e.py })
    rest(e, m)
    return
  }

  // idle: the brain has moved her this frame (her head still forward for a moment after a spit)
  m.snap = Math.max(0, m.snap - delta)
  glow(e, m.snap > 0 ? 1 : 0)
  if (seen) face(e, player)                          // her eyes on him, whichever way she backs off
  if (m.broods < 2 && e.hp <= e.maxHp * broodMark(m, T)) {
    begin(e, m, 'scream')
    e.channels.scream = 1
    e.inCombat = true
    sfx(state, 'hiss', { px: e.px, py: e.py })
    return
  }
  if (seen && low && m.fanT <= 0) { begin(e, m, 'fan'); e.channels.point = 0.05; face(e, player); return }
  if (seen && m.spitT <= 0) { begin(e, m, 'spit'); face(e, player) }
}

// A blow lands whole; nothing shoves her. The one that kills her teaches
// Käärmeenkieli, the first time.
export function hit(e, state, dmg) {
  ensure(e, tuningOf(e.type))
  e.hp -= dmg + shatterBonus(e); e.inCombat = true
  if (e.hp <= 0 && state.player) grantTalent(state, 'kaarmeenkieli')
  return { entity: e, absorbed: false, cue: 'melee-hit' }
}

// Her pools on the ground, the gob in flight and where it lands, and her
// hexes, over the hero. ctx sits at her screen centre.
export function drawFx(ctx, e, S) {
  const m = e.syo
  if (!m || e.hp <= 0) return
  const k = S / 32, T = tuningOf(e.type), u = Math.max(1, Math.round(2 * k))
  const R = Math.round
  ctx.save()
  for (const p of e.pools ?? []) {
    const x = (p.px - e.px) * k, y = (p.py - e.py) * k
    // it spreads as it lands and shrinks as it dries
    const grow = Math.min(1, p.t / 0.25), dry = Math.min(1, (T.poolLife - p.t) / 1.2)
    const r = T.poolR * S * k * grow * (0.6 + 0.4 * Math.max(0, dry))
    ctx.globalAlpha = 0.6 * Math.max(0.2, dry)
    for (const [col, f] of [[POOL.dark, 1], [POOL.base, 0.8], [POOL.light, 0.45]]) {
      ctx.fillStyle = col
      const rx = r * f, ry = r * f * 0.7
      ctx.fillRect(R(x - rx), R(y - ry * 0.55), R(2 * rx), R(ry * 1.1))
      ctx.fillRect(R(x - rx * 0.7), R(y - ry), R(1.4 * rx), R(2 * ry))
    }
    // bubbles that rise and burst
    ctx.globalAlpha = Math.max(0.2, dry)
    ctx.fillStyle = POOL.froth
    for (let i = 0; i < 3; i++) {
      const ph = (p.t * 1.3 + i * 0.37) % 1, a = i * 2.1 + Math.floor(p.t * 1.3 + i * 0.37) * 1.7
      if (ph < 0.6) ctx.fillRect(R(x + Math.cos(a) * r * 0.5), R(y + Math.sin(a) * r * 0.3 - ph * 3 * k), u, u)
    }
  }
  ctx.globalAlpha = 1
  if (m.gob) {
    const f = Math.min(1, m.gob.t / T.spitFlight)
    const x = (m.gob.x0 + (m.gob.x1 - m.gob.x0) * f - e.px) * k
    const y = (m.gob.y0 + (m.gob.y1 - m.gob.y0) * f - e.py) * k - Math.sin(f * Math.PI) * ARC * k
    ctx.globalAlpha = 0.3
    ctx.fillStyle = '#000000'
    ctx.fillRect(R(x - 2 * u), R((m.gob.y1 - e.py) * f * k - u / 2), 4 * u, u)     // its shadow on the ground
    ctx.globalAlpha = 1
    ctx.fillStyle = POOL.dark
    ctx.fillRect(R(x - 2 * u), R(y - 2 * u), 4 * u, 4 * u)
    ctx.fillStyle = POOL.light
    ctx.fillRect(R(x - 2 * u), R(y - 2 * u), 3 * u, 3 * u)
    ctx.fillStyle = POOL.froth
    ctx.fillRect(R(x - u), R(y - 2 * u), u, u)
    ctx.fillStyle = POOL.base                                                   // drops it sheds behind
    ctx.fillRect(R(x - (m.gob.x1 - m.gob.x0) * k * 0.06 - u / 2), R(y + 3 * u), u, u)
  }
  if (m.splash) {
    const f = m.splash.t / SPLASH_SHOW, r = T.poolR * S * k * (0.4 + 0.8 * f)
    const x = (m.splash.px - e.px) * k, y = (m.splash.py - e.py) * k
    ctx.globalAlpha = 1 - f
    ctx.fillStyle = POOL.light
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2
      ctx.fillRect(R(x + Math.cos(a) * r - u / 2), R(y + Math.sin(a) * r * 0.7 - u / 2 - Math.sin(f * Math.PI) * 6 * k), u, u)
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
  drawWisps(ctx, e, S)
}

export function debugState(e) {
  const m = e.syo
  return m ? `${m.state} spit ${m.spitT.toFixed(1)} fan ${m.fanT.toFixed(1)} broods ${m.broods} pools ${e.pools?.length ?? 0}${m.gob ? ' gob' : ''}` : '-'
}
// Bench overlay: how far she spits.
export function debugDraw(ctx, e, S) {
  ctx.strokeStyle = '#9be04a'
  ctx.beginPath(); ctx.arc(0, 0, tuningOf(e.type).spitRange * S, 0, Math.PI * 2); ctx.stroke()
}

CREATURE_UPDATE.syojatar = update
CREATURE_HIT.syojatar = hit
