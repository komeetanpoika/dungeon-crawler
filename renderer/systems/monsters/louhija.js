// Louhija, "the Quarrier": the mountain trolls' mage (tribe `peikot`). The
// enemy brain keeps him 4 to 7 tiles off the hero (the def's `kiteBand`); he
// has no weapon. This hook is his rockfall.
//
// Every `every` seconds, with the hero in sight within `range` tiles, he
// raises his staff for `raise` seconds, pinned, and then three shadows grow
// on the ground (systems/tribes/rockfall.js): one where the hero stands, one
// where he will be in `lead` seconds if he keeps going, one `spread` tiles to
// one side of him, the side changing with every call. A second later stones
// land on them: the hero under one is hurt whatever he holds up, and so is
// any other troll. Keep moving; walk a Lump under his own shaman's stones.
//
// A hero who dies or rides off ends the wind-up with nothing called. His
// stones are gone when he is.
//
// A supplement: the update runs after brain and act, so "pinned" means
// undoing the frame's movement, as Podeboo does. Pure: no browser imports.
//
//   e.quarry     { cd, wind, anchor, last, vx, vy, n }
//   e.stones     his marks (rockfall.js)
//   e.channels   { stirred, side }
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { stormReach } from '../brain.js'
import { STONE_TUNING, dropStones, tickStones, drawStones, trollStruck, trollLook } from '../tribes/rockfall.js'

const S = 32

export const TUNING_SCHEMA = [
  { key: 'every', label: 'Calls every', group: 'call', type: 'range', min: 1, max: 15, step: 0.5, default: 5, hint: 'seconds' },
  { key: 'first', label: 'First call after', group: 'call', type: 'range', min: 0, max: 10, step: 0.1, default: 1.5, hint: 'seconds from when he is first up' },
  { key: 'range', label: 'Range', group: 'call', type: 'range', min: 3, max: 12, step: 0.5, default: 8, hint: 'tiles, with the hero in sight' },
  { key: 'raise', label: 'Staff up for', group: 'call', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.5, hint: 'seconds of tell, pinned' },
  { key: 'lead', label: 'Lead', group: 'call', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7, hint: 'seconds ahead of the hero the second stone is aimed' },
  { key: 'spread', label: 'Third stone off by', group: 'call', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.4, hint: 'tiles to one side of the hero' },
  ...STONE_TUNING,
]

function ensure(e, T) {
  if (e.quarry) return e.quarry
  e.stones ??= []
  return e.quarry = { cd: T.first, wind: 0, anchor: null, last: null, vx: 0, vy: 0, n: (e.x + e.y) & 1 }
}
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
function pin(e, m) {
  if (!m.anchor) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  Object.assign(e, m.anchor)
}
function rest(e, m) { m.wind = 0; m.anchor = null; glow(e, 0) }

// How fast the hero walks, from where he was last frame (a throw, or the
// world moving under him, is no walking).
function track(m, hero, delta) {
  if (hero && m.last && delta > 0) {
    const vx = (hero.px - m.last.px) / delta, vy = (hero.py - m.last.py) / delta
    const still = hero.knockback || Math.hypot(vx, vy) > 600
    m.vx = still ? 0 : vx; m.vy = still ? 0 : vy
  }
  m.last = hero ? { px: hero.px, py: hero.py } : null
}

// Under him, ahead of him, beside him.
function spots(e, m, hero, T) {
  const speed = Math.hypot(m.vx, m.vy), d = Math.hypot(hero.px - e.px, hero.py - e.py)
  // beside: across his way, or across the line from the troll if he stands
  const ux = speed > 10 ? m.vx / speed : d > 0 ? (hero.px - e.px) / d : 1
  const uy = speed > 10 ? m.vy / speed : d > 0 ? (hero.py - e.py) / d : 0
  const side = m.n++ % 2 ? 1 : -1, off = T.spread * S
  return [
    { px: hero.px, py: hero.py },
    { px: hero.px + m.vx * T.lead, py: hero.py + m.vy * T.lead },
    { px: hero.px - uy * side * off, py: hero.py + ux * side * off },
  ]
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e, T)
  const { player, map } = state
  trollLook(e)
  tickStones(state, e, delta, T)
  track(m, player, delta)
  const ok = !!player && player.hp > 0 && !player.riding

  if (m.wind > 0) {
    if (!ok) { rest(e, m); return }
    pin(e, m)
    m.wind -= delta
    if (e.pose) e.pose.facing = Math.atan2(player.py - e.py, player.px - e.px)
    glow(e, Math.max(0, Math.min(1, 1 - m.wind / T.raise)))
    if (m.wind > 0) return
    rest(e, m)
    m.cd = T.every
    dropStones(state, e, spots(e, m, player, T), T)
    return
  }

  m.cd = Math.max(0, m.cd - delta)
  if (!ok || m.cd > 0) return
  // (a sandstorm blinds him as it blinds the brain)
  if (Math.hypot(player.px - e.px, player.py - e.py) > Math.min(T.range * S, stormReach(state))) return
  if (!hasLineOfSight(map, e.y, e.x, player.y, player.x)) return
  m.wind = T.raise; m.anchor = null
  pin(e, m)
}

// He takes a blow as any monster does; the stones he had in the air go with him.
export function hit(e, state, dmg, opts = {}) {
  ensure(e, tuningOf(e.type))
  const r = trollStruck(e, state, dmg, opts)
  if (e.hp <= 0) { e.stones = []; rest(e, e.quarry) }
  return r
}

export function drawFx(ctx, e, S) { drawStones(ctx, e, S) }

export function debugState(e) {
  const m = e.quarry
  return m ? `${m.wind > 0 ? `raising ${m.wind.toFixed(2)}` : `rest ${m.cd.toFixed(1)}`} stones ${e.stones?.length ?? 0}` : '-'
}
// Bench overlay: how far he calls.
export function debugDraw(ctx, e, S) {
  ctx.strokeStyle = '#ffe14a'
  ctx.beginPath(); ctx.arc(0, 0, tuningOf(e.type).range * S, 0, Math.PI * 2); ctx.stroke()
}

CREATURE_UPDATE.louhija = update
CREATURE_HIT.louhija = hit
