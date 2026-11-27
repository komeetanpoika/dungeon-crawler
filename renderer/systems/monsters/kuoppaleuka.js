// Kuoppaleuka, the antlion: a funnel of sliding sand `radius` tiles across
// with jaws at the bottom. Rooted; the funnel is drawn by its rig and no
// cell of the map changes.
//
// The slope carries a hero inside it towards the middle, `pullRim` px/s at
// the rim rising to `pullCore` by the jaws: walking out works but is slow, a
// sprint is quick. Within `jawR` of the middle the jaws snap: `snapDmg` and
// a throw outward, at most every `snapEvery` seconds. At a hero beyond the
// rim (to `tossMax` tiles, with a line of sight) it throws sand: the head
// comes up for `windup` seconds, a gob flies `flight` seconds to where he
// stood, and within `splash` tiles of where it lands he is shoved towards
// the pit and walks slowed for `slow` seconds. No damage.
//
// Buried, it absorbs every blow. The head is up, and can be struck and
// reached by spells (`spellOpen`), for `upAfterSnap` seconds after a snap
// and from the wind-up of a throw to `upAfterToss` seconds after it.
// It hurts, throws and carries only the hero. What it leaves when it dies is
// the def's (`behavior.drops`, systems/drops.js).
//
// Hook-driven. Pure: no browser imports.
//
//   e.pit   { anchor, snapT, tossT, upT, wind, gob: { x0, y0, x1, y1, t } | null, splash: { px, py, t } | null }
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { canMoveTo } from '../movement.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { playerBound } from '../player-bind.js'
import { slowBySand } from '../sand-slow.js'
import { sfx } from '../sfx.js'

const S = 32
const HEAD_TIME = 0.15       // s the head takes to come up or go down
const SNAP_SHOW = 0.3        // s the jaws stay shut after a snap
const SPLASH_SHOW = 0.3      // s the landing's puff is drawn
const ARC = 26               // px the gob rises at the top of its flight

export const TUNING_SCHEMA = [
  { key: 'radius', label: 'Funnel radius', group: 'slope', type: 'range', min: 1.2, max: 4, step: 0.1, default: 2.6, hint: 'tiles (match the look\'s funnel)' },
  { key: 'pullRim', label: 'Pull at the rim', group: 'slope', type: 'range', min: 0, max: 110, step: 5, default: 50, hint: 'px/s (a walk is 120)' },
  { key: 'pullCore', label: 'Pull by the jaws', group: 'slope', type: 'range', min: 0, max: 115, step: 5, default: 85, hint: 'px/s' },
  { key: 'jawR', label: 'Jaws reach', group: 'jaws', type: 'range', min: 0.4, max: 2, step: 0.1, default: 0.9, hint: 'tiles from the middle' },
  { key: 'snapDmg', label: 'Snap damage', group: 'jaws', type: 'range', min: 0, max: 6, step: 1, default: 2 },
  { key: 'snapThrow', label: 'Snap throw', group: 'jaws', type: 'range', min: 0, max: 128, step: 4, default: 64, hint: 'px outward' },
  { key: 'snapEvery', label: 'Snap every', group: 'jaws', type: 'range', min: 0.4, max: 5, step: 0.1, default: 1.4, hint: 'seconds at most' },
  { key: 'upAfterSnap', label: 'Head up after a snap', group: 'jaws', type: 'range', min: 0, max: 4, step: 0.1, default: 1.1, hint: 'seconds it can be struck' },
  { key: 'tossMax', label: 'Throws as far as', group: 'sand', type: 'range', min: 3, max: 12, step: 0.5, default: 6, hint: 'tiles' },
  { key: 'tossEvery', label: 'Throw every', group: 'sand', type: 'range', min: 1, max: 10, step: 0.1, default: 3.2, hint: 'seconds' },
  { key: 'windup', label: 'Wind-up', group: 'sand', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.5, hint: 'seconds, head up' },
  { key: 'upAfterToss', label: 'Head up after a throw', group: 'sand', type: 'range', min: 0, max: 3, step: 0.1, default: 0.6, hint: 'seconds' },
  { key: 'flight', label: 'Flight', group: 'sand', type: 'range', min: 0.15, max: 1.5, step: 0.05, default: 0.45, hint: 'seconds in the air' },
  { key: 'splash', label: 'Splash', group: 'sand', type: 'range', min: 0.3, max: 3, step: 0.1, default: 1, hint: 'tiles round the landing' },
  { key: 'shove', label: 'Shove', group: 'sand', type: 'range', min: 0, max: 128, step: 4, default: 48, hint: 'px towards the pit' },
  { key: 'slow', label: 'Slow', group: 'sand', type: 'range', min: 0, max: 5, step: 0.1, default: 1.2, hint: 'seconds at half speed' },
]

function ensure(e) {
  if (e.pit) return e.pit
  e.sink = 1; e.burn = 0; e.flicker = 0; e.spellOpen = false
  return e.pit = { anchor: { px: e.px, py: e.py, x: e.x, y: e.y }, snapT: 0, tossT: null, upT: 0, wind: 0, gob: null, splash: null }
}
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player, map } = state
  Object.assign(e, m.anchor)
  e.knockback = null
  if (m.tossT === null) m.tossT = T.tossEvery
  m.snapT = Math.max(0, m.snapT - delta)
  e.flicker = Math.max(0, e.flicker - delta / SNAP_SHOW)
  if (m.splash && (m.splash.t += delta) >= SPLASH_SHOW) m.splash = null

  const ok = !!player && player.hp > 0 && !player.riding
  const dx = ok ? player.px - e.px : 0, dy = ok ? player.py - e.py : 0
  const d = Math.hypot(dx, dy)
  const R = T.radius * S

  // ---- the slope ---------------------------------------------------------------
  if (ok && d < R && d > 4 && !playerBound(player) && !player.knockback) {
    const pull = (T.pullRim + (T.pullCore - T.pullRim) * (1 - d / R)) * delta
    const step = Math.min(pull, d - 4)
    const nx = player.px - dx / d * step, ny = player.py - dy / d * step
    if (canMoveTo(map, nx, player.py)) player.px = nx
    if (canMoveTo(map, player.px, ny)) player.py = ny
    player.x = Math.floor(player.px / S); player.y = Math.floor(player.py / S)
  }

  // ---- the jaws ------------------------------------------------------------------
  if (ok && d <= T.jawR * S && m.snapT <= 0 && !(player.invulnTimer > 0)) {
    m.snapT = T.snapEvery
    m.upT = Math.max(m.upT, T.upAfterSnap)
    e.flicker = 1
    sfx(state, 'drag', { px: e.px, py: e.py })
    damagePlayer(state, T.snapDmg, 'hit', { px: e.px, py: e.py })
    startKnockback(player, d > 0.5 ? dx : 0, d > 0.5 ? dy : 1, T.snapThrow)
  }

  // ---- the sand ------------------------------------------------------------------
  if (m.wind > 0) {
    m.wind -= delta
    glow(e, Math.max(0, Math.min(1, 1 - m.wind / T.windup)))
    m.upT = Math.max(m.upT, T.upAfterToss)
    if (m.wind <= 0) {
      glow(e, 0)
      m.tossT = T.tossEvery
      // (to where he stands as it leaves; a hero who has died or ridden off since is thrown at where he was seen)
      m.gob = { x0: e.px, y0: e.py - 10, x1: ok ? player.px : m.gobAt.px, y1: ok ? player.py : m.gobAt.py, t: 0 }
      sfx(state, 'sand-toss', { px: e.px, py: e.py })
    }
  } else {
    m.tossT = Math.max(0, m.tossT - delta)
    if (ok && m.tossT <= 0 && d >= R && d <= T.tossMax * S && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
      m.wind = T.windup
      m.gobAt = { px: player.px, py: player.py }
      m.upT = Math.max(m.upT, T.windup + T.upAfterToss)
    }
  }
  if (m.gob && (m.gob.t += delta) >= T.flight) {
    const at = { px: m.gob.x1, py: m.gob.y1 }
    m.gob = null
    m.splash = { ...at, t: 0 }
    sfx(state, 'sand-land', at)
    if (ok && Math.hypot(player.px - at.px, player.py - at.py) <= T.splash * S) {
      startKnockback(player, e.px - player.px, e.py - player.py, T.shove)
      slowBySand(player, T.slow)
    }
  }

  // ---- the head ------------------------------------------------------------------
  m.upT = Math.max(0, m.upT - delta)
  const step = delta / HEAD_TIME
  e.sink = m.upT > 0 ? Math.max(0, e.sink - step) : Math.min(1, e.sink + step)
  e.spellOpen = e.sink < 0.5
}

// Buried there is nothing to hit; with the head up a blow lands.
export function hit(e, state, dmg) {
  ensure(e)
  if (!(e.sink < 0.5)) return { entity: e, absorbed: true, cue: 'sink' }
  e.hp -= dmg; e.inCombat = true
  return { entity: e, absorbed: false, cue: 'melee-hit' }
}

// The gob in flight and the puff where it lands, over the hero. ctx sits at
// the antlion's screen centre.
export function drawFx(ctx, e, S) {
  const m = e.pit
  if (!m) return
  const k = S / 32, T = tuningOf(e.type)
  if (m.gob) {
    const f = Math.min(1, m.gob.t / T.flight)
    const x = (m.gob.x0 + (m.gob.x1 - m.gob.x0) * f - e.px) * k, y = (m.gob.y0 + (m.gob.y1 - m.gob.y0) * f - e.py) * k
    const lift = Math.sin(f * Math.PI) * ARC * k
    const u = Math.max(2, Math.round(2 * k))
    ctx.globalAlpha = 0.3
    ctx.fillStyle = '#5e4c32'
    ctx.fillRect(Math.round(x - 2 * u), Math.round(y - u / 2), 4 * u, u)             // its shadow on the ground
    ctx.globalAlpha = 1
    ctx.fillStyle = '#b29b70'
    ctx.fillRect(Math.round(x - 2 * u), Math.round(y - lift - 2 * u), 4 * u, 4 * u)
    ctx.fillStyle = '#f3ead4'
    ctx.fillRect(Math.round(x - u), Math.round(y - lift - 2 * u), 2 * u, 2 * u)
  }
  if (m.splash) {
    const f = m.splash.t / SPLASH_SHOW, r = T.splash * S * (0.3 + 0.7 * f)
    const x = (m.splash.px - e.px) * k, y = (m.splash.py - e.py) * k
    const u = Math.max(2, Math.round(2 * k))
    ctx.globalAlpha = 1 - f
    ctx.fillStyle = '#f3ead4'
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2
      ctx.fillRect(Math.round(x + Math.cos(a) * r - u / 2), Math.round(y + Math.sin(a) * r * 0.7 - u / 2 - f * 6 * k), u, u)
    }
    ctx.globalAlpha = 1
  }
}

export function debugState(e) {
  const m = e.pit
  return m ? `${e.sink < 0.5 ? 'head up' : 'buried'} snap ${m.snapT.toFixed(1)} toss ${(m.tossT ?? 0).toFixed(1)}${m.wind > 0 ? ' winding' : ''}${m.gob ? ' gob' : ''}` : '-'
}
// Bench overlay: the funnel, the jaws and how far it throws.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.radius, '#7ad7ff'], [T.jawR, '#ff5a3a'], [T.tossMax, '#ffe14a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.kuoppaleuka = update
CREATURE_HIT.kuoppaleuka = hit
