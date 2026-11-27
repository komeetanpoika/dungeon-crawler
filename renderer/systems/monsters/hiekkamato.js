// Hiekkamato, the sand worm: the desert's burrower.
//
// It feels footsteps and does not see: dunes and sandstorms do not hide the
// hero from it. A walking hero is felt within `feelWalk` tiles, a sprinting
// one within `feelSprint`, one standing still within `feelStill`. Under the
// sand it cannot be hurt and shows as a travelling mound with a furrow
// behind it. It swims only in loose sand (wilds/sand.js): hardpan, a road,
// paving, grass, rock and water stop it.
//
// The hunt: it swims (faster than any sprint) to where the hero will be in
// `lead` seconds if he keeps going, stops there, and the ground at that spot
// shakes for `tell` seconds. Then it erupts: anyone within `burstR` tiles of
// the spot takes `burstDmg` and is thrown; coming from below, no shield
// stops it. A change of direction at the tell dodges it. Up for `up`
// seconds it can be struck (and reached by spells: `spellOpen`) and bites
// whoever stands within `biteR`; after `diveAt` damage in one surfacing, or
// when its time is up, it dives, rests, and hunts again.
//
// It comes up only in deep sand (loose on all eight sides) and only where
// that puts the hero within the eruption: a hero on a road, or more than a
// tile into any hard ground, cannot be reached. It then waits under the
// sand's edge `waitEdge` seconds and goes home. It never follows further
// than `leash` tiles from where it was dealt.
//
// Hook-driven (`behavior.driver: 'hook'`): game.js calls update first thing,
// then the pose. Pure: no browser imports.
//
//   e.worm   { state: 'prowl' | 'hunt' | 'tell' | 'up' | 'dive' | 'rest', t, home, heard, quiet,
//              path, pathT, goal, spot, taken, biteT, wait, deaf, last, n }
//   e.trail  [{ px, py, a }] the furrow: world px, a = 1 fresh .. 0 gone
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { looseSand, deepSand } from '../../wilds/sand.js'
import { sfx } from '../sfx.js'

const S = 32
const RISE = 0.22            // s from the sand to full height
const DIVE = 0.4             // s back under
const BITE_SHOW = 0.25       // s the head stays dipped after a bite
const PATH_EVERY = 0.4       // s between searches for a way
const TRAIL_LIFE = 0.9       // s a furrow mark lasts
const TRAIL_STEP = 12        // px travelled between marks
const RUMBLE_EVERY = 0.55    // s between the travelling rumble's cues
const PROWL = { reach: 4, speed: 0.3, every: [3, 6] }   // tiles round home, share of its speed, s between strolls
const MOVING = 20, SPRINTING = 150   // px/s: slower than the first he stands still, faster than the second he sprints

export const TUNING_SCHEMA = [
  { key: 'feelWalk', label: 'Feels a walk', group: 'senses', type: 'range', min: 2, max: 20, step: 0.5, default: 8, hint: 'tiles' },
  { key: 'feelSprint', label: 'Feels a sprint', group: 'senses', type: 'range', min: 2, max: 24, step: 0.5, default: 12, hint: 'tiles' },
  { key: 'feelStill', label: 'Feels one standing', group: 'senses', type: 'range', min: 0, max: 8, step: 0.5, default: 2.5, hint: 'tiles' },
  { key: 'forget', label: 'Forgets after', group: 'senses', type: 'range', min: 1, max: 15, step: 0.5, default: 4, hint: 'seconds with nothing felt' },
  { key: 'leash', label: 'Leash', group: 'senses', type: 'range', min: 4, max: 30, step: 1, default: 12, hint: 'tiles from home' },
  { key: 'waitEdge', label: 'Waits at hard ground', group: 'senses', type: 'range', min: 1, max: 20, step: 0.5, default: 6, hint: 'seconds before going home' },
  { key: 'speed', label: 'Speed under sand', group: 'hunt', type: 'range', min: 60, max: 320, step: 5, default: 190, hint: 'px/s (a walk is 120, a sprint 186)' },
  { key: 'lead', label: 'Lead', group: 'hunt', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7, hint: 'seconds ahead of the hero it aims' },
  { key: 'tell', label: 'Tell', group: 'hunt', type: 'range', min: 0.2, max: 2, step: 0.05, default: 0.7, hint: 'seconds the ground shakes first' },
  { key: 'burstR', label: 'Eruption radius', group: 'hunt', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.2, hint: 'tiles' },
  { key: 'burstDmg', label: 'Eruption damage', group: 'hunt', type: 'range', min: 0, max: 6, step: 1, default: 2 },
  { key: 'throw', label: 'Throw', group: 'hunt', type: 'range', min: 0, max: 128, step: 4, default: 48, hint: 'px the hero is thrown' },
  { key: 'up', label: 'Time up', group: 'up', type: 'range', min: 0.5, max: 8, step: 0.1, default: 2.6, hint: 'seconds it can be struck' },
  { key: 'biteR', label: 'Bite reach', group: 'up', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.5, hint: 'tiles' },
  { key: 'biteDmg', label: 'Bite damage', group: 'up', type: 'range', min: 0, max: 4, step: 1, default: 1 },
  { key: 'biteEvery', label: 'Bite every', group: 'up', type: 'range', min: 0.3, max: 4, step: 0.1, default: 1.1, hint: 'seconds' },
  { key: 'diveAt', label: 'Dives after', group: 'up', type: 'range', min: 1, max: 20, step: 1, default: 3, hint: 'damage taken in one surfacing' },
  { key: 'rest', label: 'Rest under', group: 'up', type: 'range', min: 0, max: 6, step: 0.1, default: 1.5, hint: 'seconds before it hunts again' },
]

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const centre = c => ({ px: c.x * S + S / 2, py: c.y * S + S / 2 })
const tileOf = (px, py) => ({ x: Math.floor(px / S), y: Math.floor(py / S) })
const far = (a, b) => Math.hypot(a.px - b.px, a.py - b.py)

// The way under the sand from one cell to another: steps over loose cells
// within `box` tiles of the start, straight or (where both cells beside the
// step are loose too) diagonal. Ends at `to`, or at the
// reachable cell nearest it; empty when the start itself is not loose.
export function routeUnder(map, from, to, box = 20) {
  if (!looseSand(map, from.x, from.y)) return []
  const W = 2 * box + 1, x0 = from.x - box, y0 = from.y - box
  const prev = new Int32Array(W * W).fill(-1)
  const ix = (x, y) => (y - y0) * W + (x - x0)
  const start = ix(from.x, from.y)
  prev[start] = start
  const queue = [start]
  let best = start, bestD = Math.hypot(from.x - to.x, from.y - to.y)
  for (let q = 0; q < queue.length && bestD > 0; q++) {
    const i = queue[q], x = x0 + i % W, y = y0 + Math.floor(i / W)
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy
      if (Math.abs(nx - from.x) > box || Math.abs(ny - from.y) > box) continue
      const n = ix(nx, ny)
      if (prev[n] !== -1 || !looseSand(map, nx, ny)) continue
      if (dx && dy && !(looseSand(map, x + dx, y) && looseSand(map, x, y + dy))) continue
      prev[n] = i
      queue.push(n)
      const d = Math.hypot(nx - to.x, ny - to.y)
      if (d < bestD) { best = n; bestD = d }
    }
  }
  const path = []
  for (let i = best; i !== start; i = prev[i]) path.push({ x: x0 + i % W, y: y0 + Math.floor(i / W) })
  return path.reverse()
}

// Does it feel him? By how fast he moves and how far he is.
export function feels(e, player, speed, T) {
  if (!player || !(player.hp > 0) || player.riding) return false
  const reach = speed > SPRINTING ? T.feelSprint : speed > MOVING ? T.feelWalk : T.feelStill
  return far(e, player) <= reach * S
}

// Where it means to come up: the deep-sand cell at or beside the point the
// hero will reach in `lead` seconds, if that puts him inside the eruption.
// `wait` when there is no such cell (he is on hard ground): then `cell` is
// just the point's own cell, to swim towards. Null beyond the leash.
export function aimPoint(map, m, T) {
  const h = m.heard
  // (each worm leads by a little more or less than the next: a pair comes up one after the other along his way)
  const lead = T.lead * (m.leadMul ?? 1)
  const px = h.px + h.vx * lead, py = h.py + h.vy * lead
  const c = tileOf(px, py)
  if (Math.hypot(c.x - m.home.x, c.y - m.home.y) > T.leash) return null
  let best = null, bestD = T.burstR * S * 0.9
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = c.x + dx, y = c.y + dy
    if (!deepSand(map, x, y)) continue
    const d = Math.hypot(x * S + S / 2 - px, y * S + S / 2 - py)
    if (d < bestD) { best = { x, y }; bestD = d }
  }
  return best ? { cell: best, wait: false } : { cell: c, wait: true }
}

function ensure(e) {
  if (e.worm) return e.worm
  e.sink = 1; e.flicker = 0; e.spellOpen = false; e.trail = []
  const m = e.worm = {
    state: 'prowl', t: 0, home: { x: e.x, y: e.y }, heard: null, quiet: Infinity,
    path: [], pathT: 0, goal: null, spot: null, taken: 0, biteT: 0, wait: 0, deaf: 0,
    last: null, vx: 0, vy: 0, n: (e.x * 73 + e.y * 151) | 0, stroll: 1, rumble: 0, moved: 0, biteShow: 0, leadMul: 1,
  }
  m.leadMul = 0.75 + 0.5 * draw(m)
  return m
}
// a small repeatable draw (0..1) so a worm's strolls do not depend on Math.random
const draw = m => { m.n = (Math.imul(m.n, 1103515245) + 12345) & 0x7fffffff; return m.n / 0x7fffffff }

const place = (e, px, py) => { e.px = px; e.py = py; e.x = Math.floor(px / S); e.y = Math.floor(py / S) }

// Swim along the path towards `goal` (a cell) at `speed`; true once there.
function swim(e, m, map, goal, speed, delta) {
  const here = tileOf(e.px, e.py)
  m.pathT -= delta
  // a new way when the goal has moved and the old way is used up or stale
  const moved = !m.goal || m.goal.x !== goal.x || m.goal.y !== goal.y
  const arrived = here.x === goal.x && here.y === goal.y
  if ((moved && (m.pathT <= 0 || !m.path.length)) || (!m.path.length && !arrived && m.pathT <= 0)) {
    m.path = routeUnder(map, here, goal)
    m.pathT = PATH_EVERY
    m.goal = { ...goal }
  }
  let left = speed * delta
  while (left > 0 && m.path.length) {
    const next = centre(m.path[0]), d = Math.hypot(next.px - e.px, next.py - e.py)
    if (d <= left) { place(e, next.px, next.py); left -= d; m.path.shift(); m.moved += d }
    else { place(e, e.px + (next.px - e.px) / d * left, e.py + (next.py - e.py) / d * left); m.moved += left; left = 0 }
  }
  // the furrow
  if (m.moved >= TRAIL_STEP) { m.moved = 0; e.trail.push({ px: e.px, py: e.py, a: 1 }) }
  return arrived && !m.path.length && far(e, centre(goal)) < 2
}

// Is another worm telling or up within APART tiles of this cell?
const APART = 2.5
function crowded(state, e, cell) {
  return (state.entities ?? []).some(o => o !== e && o.type === e.type && o.worm?.spot &&
    (o.worm.state === 'tell' || o.worm.state === 'up') && Math.hypot(o.worm.spot.x - cell.x, o.worm.spot.y - cell.y) < APART)
}

function goHome(m, T) {
  m.state = 'prowl'; m.heard = null; m.wait = 0; m.deaf = T.forget; m.goal = null; m.path = []
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player, map } = state

  // the furrow fades
  if (e.trail.length) { for (const p of e.trail) p.a -= delta / TRAIL_LIFE; e.trail = e.trail.filter(p => p.a > 0) }
  // how fast the hero moves, from where he was last frame
  let speed = 0
  if (player && m.last && delta > 0) {
    m.vx = (player.px - m.last.px) / delta; m.vy = (player.py - m.last.py) / delta
    speed = Math.hypot(m.vx, m.vy)
    // a throw is no footstep, and a jump of the window (a re-centre) no speed at all
    if (player.knockback || speed > 600) { speed = 0; m.vx = 0; m.vy = 0 }
  }
  if (player) m.last = { px: player.px, py: player.py }
  m.deaf = Math.max(0, m.deaf - delta)
  if (m.deaf <= 0 && feels(e, player, speed, T)) { m.heard = { px: player.px, py: player.py, vx: m.vx, vy: m.vy }; m.quiet = 0 }
  else m.quiet += delta

  if (m.state === 'prowl') {
    e.sink = 1; e.flicker = 0; e.spellOpen = false
    if (m.heard && m.quiet <= T.forget && aimPoint(map, m, T)) { m.state = 'hunt'; m.wait = 0; m.rumble = 0; return }
    m.stroll -= delta
    if (m.stroll <= 0) {
      m.stroll = PROWL.every[0] + draw(m) * (PROWL.every[1] - PROWL.every[0])
      const x = m.home.x + Math.round((draw(m) * 2 - 1) * PROWL.reach), y = m.home.y + Math.round((draw(m) * 2 - 1) * PROWL.reach)
      m.strollTo = looseSand(map, x, y) ? { x, y } : null
    }
    if (m.strollTo && swim(e, m, map, m.strollTo, T.speed * PROWL.speed, delta)) m.strollTo = null
    return
  }

  if (m.state === 'hunt') {
    e.sink = 1
    const aim = m.heard && m.quiet <= T.forget ? aimPoint(map, m, T) : null
    if (!aim) { goHome(m, T); m.deaf = 0; return }
    if ((m.rumble -= delta) <= 0) { m.rumble = RUMBLE_EVERY; sfx(state, 'burrow', { px: e.px, py: e.py }) }
    const there = swim(e, m, map, aim.cell, T.speed, delta)
    if (aim.wait) {
      // he is on ground it cannot come up through: it waits under the sand's edge, then gives up
      if ((m.wait += delta) >= T.waitEdge) goHome(m, T)
      return
    }
    m.wait = 0
    // (not where another worm is coming up: it holds under the spot until that one is done)
    if (there && !crowded(state, e, aim.cell)) { m.state = 'tell'; m.t = T.tell; m.spot = { ...aim.cell }; m.path = []; m.goal = null }
    return
  }

  if (m.state === 'tell') {
    const at = centre(m.spot)
    place(e, at.px, at.py)
    m.t -= delta
    e.flicker = Math.max(0, Math.min(1, 1 - m.t / T.tell))
    if (m.t > 0) return
    // up it comes
    e.flicker = 0; e.spellOpen = true
    m.state = 'up'; m.t = T.up; m.taken = 0; m.biteT = T.biteEvery * 0.6; m.rise = RISE
    sfx(state, 'worm-erupt', { px: e.px, py: e.py })
    if (player && player.hp > 0 && far(e, player) <= T.burstR * S && damagePlayer(state, T.burstDmg, 'hit')) {
      const dx = player.px - e.px, dy = player.py - e.py
      startKnockback(player, dx || 0, dx || dy ? dy : 1, T.throw)
    }
    return
  }

  if (m.state === 'up') {
    const at = centre(m.spot)
    place(e, at.px, at.py)
    e.knockback = null                        // nothing shoves a worm out of its hole
    m.rise = Math.max(0, m.rise - delta)
    e.sink = m.rise / RISE
    m.biteShow = Math.max(0, m.biteShow - delta)
    if (e.pose) {
      if (player) e.pose.facing = Math.atan2(player.py - e.py, player.px - e.px)
      e.pose.eyeGlow = m.biteShow > 0 ? 1 : 0
    }
    m.biteT -= delta
    // (not into the moment's grace a hit gives him: the bite waits for it to pass)
    if (m.biteT <= 0 && player && player.hp > 0 && !player.riding && !(player.invulnTimer > 0) && far(e, player) <= T.biteR * S) {
      m.biteT = T.biteEvery; m.biteShow = BITE_SHOW
      damagePlayer(state, T.biteDmg, 'hit', { px: e.px, py: e.py })
    }
    m.t -= delta
    if (m.t <= 0 || m.taken >= T.diveAt) { m.state = 'dive'; m.t = DIVE; e.spellOpen = false; sfx(state, 'sink', { px: e.px, py: e.py }) }
    return
  }

  if (m.state === 'dive') {
    m.t -= delta
    e.sink = Math.min(1, 1 - m.t / DIVE)
    if (e.pose) e.pose.eyeGlow = 0
    if (m.t <= 0) { e.sink = 1; m.state = 'rest'; m.t = T.rest }
    return
  }

  // rest: under, where it went down
  e.sink = 1
  if ((m.t -= delta) <= 0) m.state = m.heard && m.quiet <= T.forget ? 'hunt' : 'prowl'
}

// Under the sand there is nothing to hit. Up, a blow lands.
export function hit(e, state, dmg) {
  const m = ensure(e)
  if (m.state !== 'up') return { entity: e, absorbed: true, cue: null }
  e.hp -= dmg; e.inCombat = true
  m.taken += dmg
  return { entity: e, absorbed: false, cue: 'melee-hit' }
}

export function debugState(e) {
  const m = e.worm
  return m ? `${m.state} t ${(m.t ?? 0).toFixed(1)} quiet ${Number.isFinite(m.quiet) ? m.quiet.toFixed(1) : '-'} wait ${m.wait.toFixed(1)}` : '-'
}
// Bench overlay: what it feels (walk, sprint), the eruption and the bite.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.feelWalk, '#7ad7ff'], [T.feelSprint, '#3a7bd5'], [T.burstR, '#ff5a3a'], [T.biteR, '#ffe14a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.hiekkamato = update
CREATURE_HIT.hiekkamato = hit
