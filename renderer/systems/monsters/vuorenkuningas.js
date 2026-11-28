// Vuorenkuningas, the Mountain King: the mountain trolls' boss (tribe
// `peikot`), in his hall with a drummer and a Lump. The enemy brain walks him
// at the hero and his fist is his weapon (the def's `fists`, 3). This hook is
// his moves, in the manner of the cyclops: each a wind-up that can be read,
// with the King pinned and his fists stilled while it lasts.
//
// Boulder. With the hero `boulderMin` to `boulderMax` tiles off and in sight,
// every `boulderEvery` seconds: he lifts a boulder for `lift` seconds, turning
// with the hero until `aimLock` seconds before it leaves his hands, then
// rolls it at `boulderSpeed` px/s along that line, `boulderRange` tiles or to
// the first thing it cannot roll over. The hero it reaches takes `boulderDmg`
// and is thrown along its way, once (a raised shield that faces it takes it);
// every troll it rolls over takes as much, once each, never the King.
//
// Stomp. With the hero within `stompNear` tiles, every `stompEvery` seconds:
// he rears for `rear` seconds, then the ground jumps `stompReach` tiles round
// him: `stompDmg` and a throw outward (from the ground: no shield stops it),
// and `marks` rockfall marks in a ring round the hero wherever he is
// (systems/tribes/rockfall.js).
//
// The hall answers. Once, at `callAt` of his health or less and with the hero
// alive: he bellows for `bellow` seconds, then `callLumps` Lumps and
// `callDrummers` drummers climb out of the rock `callMin` to `callMax` tiles
// off (tribes.js summonNear: free walkable cells, his own loot depth and home).
//
// Accelerando. The rest after a boulder and after a stomp shortens as he
// weakens: times `frenzy` at the end of his health.
//
// A hero who dies or rides off ends any wind-up with nothing done (the hall's
// answer is kept for the next one). He is never shoved. The blow that fells
// him grants Kivinahka (systems/talents.js: once per player), and what he
// leaves is the def's (`behavior.drops`).
//
// A supplement: the update runs after brain and act, so "pinned" means
// undoing the frame's movement, as Podeboo does. Pure: no browser imports.
//
//   e.king      { state: 'walk' | 'lift' | 'rear' | 'bellow', t, anchor, aim: { dx, dy }, boulderCd, stompCd, called, n }
//   e.boulder   null | { px, py, dx, dy, left, turn, heroDone, over: [trolls it has rolled over] }
//   e.quake     null | { t }            the stomp's ring, while it is drawn
//   e.bursts    [{ px, py, t }]         dust: where the boulder broke, where his trolls climbed out
//   e.stones    his marks (rockfall.js)
//   e.channels  { lift, rear, bellow, stirred, side }   for his rig (render/monster-rigs/troll.js)
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { canMoveTo, PLAYER_HALF } from '../movement.js'
import { stormReach } from '../brain.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { summonNear } from '../tribes.js'
import { grantTalent } from '../talents.js'
import { STONE_TUNING, dropStones, tickStones, drawStones, trollStruck, trollLook, hurtTroll, kin } from '../tribes/rockfall.js'
import { sfx } from '../sfx.js'

const S = 32
const BOULDER_HALF = 8       // px: what must be free for it to roll on
const BOULDER_DRAWN = 22     // px: its radius as drawn at 32-px tiles
const BOULDER_START = 22     // px ahead of his middle it is set rolling
const TOSS = { run: 44, height: 60 }   // px: it comes down out of his hands over its first `run` (the look only)
const RING_SHOW = 0.4        // s the stomp's ring runs out
const BURST_SHOW = 0.45      // s a burst of dust lasts
const MOUTH_TIME = 0.15      // s his mouth takes to open

export const TUNING_SCHEMA = [
  { key: 'first', label: 'First move after', group: 'pace', type: 'range', min: 0, max: 10, step: 0.1, default: 2, hint: 'seconds from when he is first up' },
  { key: 'frenzy', label: 'Rests at the end', group: 'pace', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.6, hint: 'times his rests as his health runs out' },
  { key: 'boulderMin', label: 'Boulder from', group: 'boulder', type: 'range', min: 1, max: 8, step: 0.5, default: 3, hint: 'tiles' },
  { key: 'boulderMax', label: 'Boulder to', group: 'boulder', type: 'range', min: 4, max: 14, step: 0.5, default: 9, hint: 'tiles, in sight' },
  { key: 'boulderEvery', label: 'Boulder every', group: 'boulder', type: 'range', min: 1, max: 20, step: 0.5, default: 6, hint: 'seconds' },
  { key: 'lift', label: 'Lift', group: 'boulder', type: 'range', min: 0.2, max: 3, step: 0.05, default: 0.9, hint: 'seconds of tell, pinned' },
  { key: 'aimLock', label: 'Line fixed before the throw', group: 'boulder', type: 'range', min: 0, max: 2, step: 0.05, default: 0.35, hint: 'seconds: he stops turning with the hero' },
  { key: 'boulderSpeed', label: 'Boulder speed', group: 'boulder', type: 'range', min: 60, max: 400, step: 10, default: 170, hint: 'px/s (a walk is 120)' },
  { key: 'boulderRange', label: 'Boulder rolls', group: 'boulder', type: 'range', min: 3, max: 20, step: 0.5, default: 11, hint: 'tiles at most' },
  { key: 'boulderR', label: 'Boulder reach', group: 'boulder', type: 'range', min: 0.3, max: 1.5, step: 0.05, default: 0.6, hint: 'tiles from its middle' },
  { key: 'boulderDmg', label: 'Boulder damage', group: 'boulder', type: 'range', min: 0, max: 8, step: 1, default: 3, hint: 'to the hero, and to a troll in its way' },
  { key: 'boulderThrow', label: 'Boulder throw', group: 'boulder', type: 'range', min: 0, max: 128, step: 4, default: 56, hint: 'px along its way' },
  { key: 'stompNear', label: 'Stomps at a hero within', group: 'stomp', type: 'range', min: 1, max: 5, step: 0.1, default: 2.5, hint: 'tiles' },
  { key: 'stompEvery', label: 'Stomp every', group: 'stomp', type: 'range', min: 1, max: 20, step: 0.5, default: 7, hint: 'seconds' },
  { key: 'rear', label: 'Rears for', group: 'stomp', type: 'range', min: 0.2, max: 3, step: 0.05, default: 0.8, hint: 'seconds of tell, pinned' },
  { key: 'stompReach', label: 'Ring reaches', group: 'stomp', type: 'range', min: 1, max: 6, step: 0.1, default: 3, hint: 'tiles from his middle' },
  { key: 'stompDmg', label: 'Stomp damage', group: 'stomp', type: 'range', min: 0, max: 6, step: 1, default: 2, hint: 'no shield stops it' },
  { key: 'stompThrow', label: 'Stomp throw', group: 'stomp', type: 'range', min: 0, max: 128, step: 4, default: 64, hint: 'px outward' },
  { key: 'marks', label: 'Rockfall marks', group: 'stomp', type: 'range', min: 0, max: 8, step: 1, default: 4, hint: 'round the hero after a stomp' },
  { key: 'markRing', label: 'Marks off by', group: 'stomp', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.3, hint: 'tiles from the hero' },
  { key: 'callAt', label: 'Hall answers at', group: 'hall', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'of his health' },
  { key: 'bellow', label: 'Bellow', group: 'hall', type: 'range', min: 0.2, max: 4, step: 0.1, default: 1.2, hint: 'seconds, pinned' },
  { key: 'callLumps', label: 'Lumps called', group: 'hall', type: 'range', min: 0, max: 4, step: 1, default: 2 },
  { key: 'callDrummers', label: 'Drummers called', group: 'hall', type: 'range', min: 0, max: 2, step: 1, default: 1 },
  { key: 'callMin', label: 'They come up from', group: 'hall', type: 'range', min: 1, max: 8, step: 0.5, default: 5, hint: 'tiles off' },
  { key: 'callMax', label: 'They come up to', group: 'hall', type: 'range', min: 2, max: 10, step: 0.5, default: 7, hint: 'tiles off' },
  ...STONE_TUNING,
]

export function ensure(e) {
  if (e.king) return e.king
  const T = tuningOf(e.type)
  e.boulder = null; e.quake = null; e.bursts = []; e.stones ??= []
  e.channels = { ...(e.channels ?? null), lift: 0, rear: 0, bellow: 0, stirred: 0 }
  return e.king = { state: 'walk', t: 0, anchor: null, aim: null, boulderCd: T.first ?? 0, stompCd: T.first ?? 0, called: false, n: (e.x + e.y) & 3 }
}

// How long his rests are just now, as a share of the tuned ones: 1 whole,
// down to `frenzy` as his health runs out.
export function pace(e, T) {
  const left = Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)))
  return 1 - (1 - T.frenzy) * (1 - left)
}

const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
const face = (e, dx, dy) => { if (e.pose && (dx || dy)) e.pose.facing = Math.atan2(dy, dx) }
function pin(e, m) {
  if (!m.anchor) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  Object.assign(e, m.anchor)
}
function begin(e, m, name) {
  m.state = name; m.t = 0; m.anchor = null; m.aim = null
  pin(e, m)
}
// back on his feet and in the brain's hands
function settle(e, m) {
  m.state = 'walk'; m.t = 0; m.anchor = null; m.aim = null
  glow(e, 0)
  Object.assign(e.channels, { lift: 0, rear: 0, bellow: 0 })
}
const burst = (e, px, py) => e.bursts.push({ px, py, t: 0 })

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player, map } = state
  const c = e.channels
  trollLook(e)
  tickStones(state, e, delta, T)
  rollBoulder(e, state, delta, T)
  if (e.quake && (e.quake.t += delta) >= RING_SHOW) e.quake = null
  if (e.bursts.length) { for (const b of e.bursts) b.t += delta; e.bursts = e.bursts.filter(b => b.t < BURST_SHOW) }
  m.boulderCd = Math.max(0, m.boulderCd - delta)
  m.stompCd = Math.max(0, m.stompCd - delta)

  const ok = !!player && player.hp > 0 && !player.riding
  const dx = ok ? player.px - e.px : 0, dy = ok ? player.py - e.py : 0
  const d = Math.hypot(dx, dy)

  if (m.state !== 'walk') {
    // a wind-up: he stands where he began it, and no fist falls
    pin(e, m)
    e.damageCooldown = Math.max(e.damageCooldown ?? 0, 0.3)
    if (!ok) { settle(e, m); return }
    m.t += delta
    if (m.state === 'lift') {
      const f = Math.min(1, m.t / T.lift)
      c.lift = f
      glow(e, f)
      if (!m.aim || m.t < T.lift - T.aimLock) m.aim = d > 0.5 ? { dx: dx / d, dy: dy / d } : { dx: 0, dy: 1 }
      face(e, m.aim.dx, m.aim.dy)
      if (m.t < T.lift) return
      e.boulder = { px: e.px + m.aim.dx * BOULDER_START, py: e.py + m.aim.dy * BOULDER_START, dx: m.aim.dx, dy: m.aim.dy,
        left: T.boulderRange * S, turn: 0, heroDone: false, over: [] }
      sfx(state, 'boulder', { px: e.px, py: e.py })
      m.boulderCd = T.boulderEvery * pace(e, T)
      settle(e, m)
    } else if (m.state === 'rear') {
      const f = Math.min(1, m.t / T.rear)
      c.rear = f
      glow(e, f)
      face(e, dx, dy)
      if (m.t < T.rear) return
      stomp(e, m, state, T, dx, dy, d)
      m.stompCd = T.stompEvery * pace(e, T)
      settle(e, m)
    } else {
      c.bellow = Math.min(1, m.t / MOUTH_TIME)
      glow(e, 1)
      face(e, dx, dy)
      if (m.t < T.bellow) return
      m.called = true
      call(e, state, T)
      settle(e, m)
    }
    return
  }

  // on his feet: the brain has moved him this frame
  if (!ok) return
  if (!m.called && e.hp > 0 && e.hp <= e.maxHp * T.callAt) {
    begin(e, m, 'bellow')
    sfx(state, 'troll-bellow', { px: e.px, py: e.py })
    return
  }
  if (m.stompCd <= 0 && d <= T.stompNear * S) { begin(e, m, 'rear'); return }
  // (a sandstorm blinds him as it blinds the brain)
  if (m.boulderCd <= 0 && !e.boulder && d >= T.boulderMin * S && d <= Math.min(T.boulderMax * S, stormReach(state)) &&
      hasLineOfSight(map, e.y, e.x, player.y, player.x)) begin(e, m, 'lift')
}

// The foot comes down: the ring, and the marks round the hero.
function stomp(e, m, state, T, dx, dy, d) {
  const hero = state.player
  sfx(state, 'stomp', { px: e.px, py: e.py })
  e.quake = { t: 0 }
  state.shake = Math.max(state.shake ?? 0, 6)
  if (d <= T.stompReach * S && damagePlayer(state, T.stompDmg, 'hit'))
    startKnockback(hero, d > 0.5 ? dx : 0, d > 0.5 ? dy : 1, T.stompThrow)
  // (the ring of marks is turned a little further each time)
  const n = Math.round(T.marks), turn = m.n++ * 0.9
  dropStones(state, e, Array.from({ length: n }, (_, i) => {
    const a = turn + i / n * Math.PI * 2
    return { px: hero.px + Math.cos(a) * T.markRing * S, py: hero.py + Math.sin(a) * T.markRing * S }
  }), T)
}

// His hall answers: Lumps and a drummer out of the rock.
function call(e, state, T) {
  const extra = e.home ? { home: { ...e.home } } : {}
  const names = [...Array(Math.round(T.callLumps)).fill('mohkale'), ...Array(Math.round(T.callDrummers)).fill('rumpali')]
  let came = false
  for (const name of names) {
    const o = summonNear(state, e, name, { min: Math.min(T.callMin, T.callMax), max: Math.max(T.callMin, T.callMax), extra })
    if (!o) continue
    came = true
    burst(e, o.px, o.py)
  }
  if (came) sfx(state, 'rockfall', { px: e.px, py: e.py })
}

// The boulder rolls on: until its run is out or the way is not free, over
// the hero once and over each troll once.
function rollBoulder(e, state, delta, T) {
  const b = e.boulder
  if (!b) return
  let go = Math.min(T.boulderSpeed * delta, b.left)
  while (go > 0) {
    const step = Math.min(go, 8)
    const nx = b.px + b.dx * step, ny = b.py + b.dy * step
    if (!canMoveTo(state.map, nx, ny, BOULDER_HALF)) { breakUp(e, state, b); return }
    b.px = nx; b.py = ny; b.left -= step; b.turn += step; go -= step
    roll(e, state, b, T)
  }
  if (b.left <= 0) breakUp(e, state, b)
}
function breakUp(e, state, b) {
  burst(e, b.px, b.py)
  sfx(state, 'rockfall', { px: b.px, py: b.py })
  e.boulder = null
}
function roll(e, state, b, T) {
  const reach = T.boulderR * S, hero = state.player
  const near = (o, half) => Math.hypot(o.px - b.px, o.py - b.py) <= reach + half
  if (!b.heroDone && hero && hero.hp > 0 && !hero.riding && near(hero, PLAYER_HALF)) {
    b.heroDone = true
    if (damagePlayer(state, T.boulderDmg, 'hit', { px: b.px - b.dx * reach, py: b.py - b.dy * reach }))
      startKnockback(hero, b.dx, b.dy, T.boulderThrow)
  }
  for (const o of kin(state, e)) {
    if (b.over.includes(o) || !near(o, getMonsterDef(o.type)?.stats.half ?? 8)) continue
    b.over.push(o)
    hurtTroll(state, o, T.boulderDmg, 'boulder')
  }
}

// A blow lands whole and does not move him. The one that fells him grants
// the talent, and what he had in the air goes with him.
export function hit(e, state, dmg, opts = {}) {
  const m = ensure(e)
  const r = trollStruck(e, state, dmg, opts, { shove: false })
  if (e.hp <= 0) {
    settle(e, m)
    e.boulder = null; e.quake = null; e.stones = []; e.bursts = []
    grantTalent(state, 'kivinahka')
  }
  return r
}

const ROCK = '#9a9da6', ROCK_LIGHT = '#d2d4da', ROCK_DARK = '#4c4e56', MOSS = '#5c9a3c', DUST = '#ebe7dc', SHADE = '#16181c'

// Over the hero: his marks, the rolling boulder, the stomp's ring and the
// dust. ctx sits at the King's screen centre.
export function drawFx(ctx, e, S) {
  const m = e.king
  if (!m) return
  const k = S / 32, u = Math.max(2, Math.round(2 * k))
  const snap = v => Math.round(v / u) * u
  const rect = (x, y, w, h) => ctx.fillRect(snap(x), snap(y), Math.max(u, snap(w)), Math.max(u, snap(h)))
  drawStones(ctx, e, S)
  ctx.save()
  if (e.quake) {
    // the ring: broken ground running out from his feet
    const T = tuningOf(e.type), f = Math.min(1, e.quake.t / RING_SHOW), r = T.stompReach * S * (0.25 + 0.75 * f)
    ctx.globalAlpha = 1 - f * 0.7
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2
      // a crack in the ground behind the front, then the front itself: clods thrown up, dust
      ctx.fillStyle = SHADE
      rect(Math.cos(a) * r * 0.82 - u, Math.sin(a) * r * 0.82 - u / 2, 2 * u, u)
      ctx.fillStyle = i % 2 ? DUST : ROCK_DARK
      rect(Math.cos(a) * r - 1.5 * u, Math.sin(a) * r - 1.5 * u - (i % 2 ? (1 - f) * 8 * k : 0), 3 * u, 3 * u)
    }
    ctx.globalAlpha = 1
  }
  for (const b of e.bursts ?? []) {
    const f = b.t / BURST_SHOW, x = (b.px - e.px) * k, y = (b.py - e.py) * k, r = (8 + 18 * f) * k
    ctx.globalAlpha = 1 - f
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + 0.3
      ctx.fillStyle = i % 3 ? DUST : ROCK
      rect(x + Math.cos(a) * r - u, y + Math.sin(a) * r * 0.7 - u - f * 8 * k, 2 * u, 2 * u)
    }
    ctx.globalAlpha = 1
  }
  if (e.boulder) {
    const b = e.boulder, x = (b.px - e.px) * k, r = BOULDER_DRAWN * k
    // (thrown down out of his hands: in the air for the first of its run)
    const air = Math.max(0, 1 - b.turn / TOSS.run), gy = (b.py - e.py) * k, y = gy - air * air * TOSS.height * k
    // its shadow, the dust it kicks up behind once it rolls
    ctx.globalAlpha = 0.3
    ctx.fillStyle = SHADE
    rect(x - r * (1 - air * 0.4), gy + r * 0.5, 2 * r * (1 - air * 0.4), r * 0.6)
    ctx.globalAlpha = 0.8
    ctx.fillStyle = DUST
    for (let i = 0; i < 4 && air <= 0; i++) {
      const back = r * (1.1 + 0.35 * i), side = ((i * 7 + Math.floor(b.turn / 10)) % 5 - 2) * 3 * k
      rect(x - b.dx * back - b.dy * side - u, y - b.dy * back + b.dx * side + r * 0.5 - i * 2 * k - u, 2 * u, 2 * u)
    }
    ctx.globalAlpha = 1
    // the rock: an eight-sided lump
    ctx.fillStyle = ROCK_DARK
    rect(x - r - u, y - r * 0.5, 2 * r + 2 * u, r); rect(x - r * 0.5, y - r - u, r, 2 * r + 2 * u); rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7)
    ctx.fillStyle = ROCK
    rect(x - r, y - r * 0.5, 2 * r, r); rect(x - r * 0.5, y - r, r, 2 * r); rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6)
    ctx.fillStyle = ROCK_LIGHT
    rect(x - r * 0.5, y - r * 0.85, r * 0.8, u); rect(x - r * 0.8, y - r * 0.45, u, r * 0.5)
    // what turns with it: a crack, a chip, a patch of moss, a quarter turn at a time
    const q = Math.floor(b.turn / (r * 1.2 / k)) % 4
    const spin = (px, py) => [[px, py], [-py, px], [-px, -py], [py, -px]][q]
    const mark = (px, py, w, h, colour) => { const [sx, sy] = spin(px, py); ctx.fillStyle = colour; rect(x + sx * r - w / 2, y + sy * r - h / 2, w, h) }
    mark(0.35, -0.2, 3 * u, u, ROCK_DARK); mark(0.2, 0.1, u, 3 * u, ROCK_DARK); mark(-0.4, 0.35, 2 * u, u, ROCK_DARK)
    mark(-0.3, -0.45, 3 * u, 2 * u, MOSS); mark(0.5, 0.45, 2 * u, u, MOSS)
  }
  ctx.restore()
}

export function debugState(e) {
  const m = e.king
  if (!m) return '-'
  return `${m.state}${m.state === 'walk' ? '' : ` ${m.t.toFixed(2)}`} boulder ${m.boulderCd.toFixed(1)} stomp ${m.stompCd.toFixed(1)}` +
    `${m.called ? ' called' : ''}${e.boulder ? ' rolling' : ''} stones ${e.stones?.length ?? 0}`
}
// Bench overlay: where he stomps and how far it reaches, and the band a boulder is thrown in.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.stompNear, '#ff5a3a'], [T.stompReach, '#ffb02a'], [T.boulderMin, '#7ad7ff'], [T.boulderMax, '#7ad7ff']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.vuorenkuningas = update
CREATURE_HIT.vuorenkuningas = hit
