// Norppaväen vahti, the seal folk's guard: a harpooner at his post.
//
// At peace he keeps the camp: any enemy that is no seal, within `watch`
// tiles of him and in his sight, is thrown at. His arm goes back for `arm`
// seconds (`pose.eyeGlow`), then a harpoon flies for `dmg`, led by where the
// thing is going (`lead`), and he may throw again after `every` seconds. The
// harpoon is his tribe's own shot (systems/projectiles.js: `friendly` with
// `tribe`): it lands on enemies only, never on a seal, a villager or the
// hero, and wrongs nobody. He never leaves his post for it: a seal camp is a
// haven because a pack led into it is skewered where it stands.
//
// Wronged (his tribe's wrath, systems/tribes.js) the enemy brain drives him
// (`e.brainDriven`; the def's kiteBand keeps him 3 to 5 tiles off, inside his
// throw) and he throws at the hero instead: from `near` to `far` tiles with a
// line of sight, the same arm back, the same pace, pinned while he winds up.
// Nearer than `near` he has no room to wind up: run a harpooner down. That
// harpoon is an enemy's shot like the wizard's bolt, and a raised shield
// takes it. A hero who dies or rides off ends the wind-up. When the grudge is
// over he takes himself back and returns to his post.
//
// Runs first-thing for a guard at peace and after brain and act for a
// wronged one (game.js enemy loop), so "pinned" means undoing the frame's
// movement, as Podeboo does. Pure: no browser imports.
//
//   e.guard   { state: 'watch' | 'arm' | 'home', t, cd, flung, anchor, alert, wrath }
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { isEnemy } from '../factions.js'
import { tribeOf } from '../tribes.js'
import { sfx } from '../sfx.js'
import { heroOk, wronged, tilesTo, glow, turnTo, postOf, goHome, keepSide } from './norppakauppias.js'

const S = 32
const FLUNG = 0.18          // s the empty arm stays flung forward after a throw
const HAND = 6              // px above his centre the harpoon leaves from
const BONE = '#efe6cf'
const FASTEST = 260         // px/s: anything that seems to move faster has been moved (the Wilds' window), not walked

export const TUNING_SCHEMA = [
  { key: 'watch', label: 'Keeps watch to', group: 'peace', type: 'range', min: 2, max: 12, step: 0.5, default: 6, hint: 'tiles: an enemy this near, in sight, is thrown at' },
  { key: 'lead', label: 'Leads his mark', group: 'peace', type: 'range', min: 0, max: 1.5, step: 0.1, default: 1, hint: '0 throws where it is, 1 where it will be' },
  { key: 'turn', label: 'Turns to the hero within', group: 'peace', type: 'range', min: 0, max: 12, step: 0.5, default: 4, hint: 'tiles' },
  { key: 'homeSpeed', label: 'Speed home', group: 'peace', type: 'range', min: 10, max: 160, step: 5, default: 70, hint: 'px/s back to his post when the grudge is over' },
  { key: 'near', label: 'Wronged: throws from', group: 'wronged', type: 'range', min: 0, max: 6, step: 0.1, default: 1.5, hint: 'tiles: nearer than this he cannot wind up' },
  { key: 'far', label: 'Wronged: throws to', group: 'wronged', type: 'range', min: 2, max: 12, step: 0.5, default: 6, hint: 'tiles' },
  { key: 'dmg', label: 'Harpoon damage', group: 'harpoon', type: 'range', min: 0, max: 6, step: 1, default: 2 },
  { key: 'every', label: 'Throws every', group: 'harpoon', type: 'range', min: 0.5, max: 8, step: 0.1, default: 1.8, hint: 'seconds between two throws' },
  { key: 'arm', label: 'Arm back', group: 'harpoon', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.4, hint: 'seconds of tell before it flies' },
  { key: 'speed', label: 'Harpoon speed', group: 'harpoon', type: 'range', min: 100, max: 500, step: 10, default: 320, hint: 'px/s' },
  { key: 'range', label: 'Harpoon flies', group: 'harpoon', type: 'range', min: 3, max: 16, step: 0.5, default: 9, hint: 'tiles' },
]

const ensure = e => e.guard ?? (e.guard = { state: 'watch', t: 0, cd: 0, flung: 0, anchor: null, alert: false, wrath: false })

// Whom he would throw at, as { px, py, who }: wronged, the hero in his band
// and in sight; at peace, the nearest enemy that is no seal.
function markOf(e, state, T, wrath) {
  const { player, map } = state
  const sees = o => hasLineOfSight(map, e.y, e.x, o.y, o.x)
  if (wrath) {
    if (!heroOk(player)) return null
    const d = tilesTo(e, player)
    return d >= T.near && d <= T.far && sees(player) ? player : null
  }
  const tribe = tribeOf(e)
  let best = null, bestD = T.watch
  for (const o of state.entities ?? []) {
    if (o === e || !(o.hp > 0) || !isEnemy(o) || tribeOf(o) === tribe) continue
    const d = tilesTo(e, o)
    if (d <= bestD && sees(o)) { best = o; bestD = d }
  }
  return best
}

// How fast his mark is going, px/s, from where it was a frame ago. Kept off
// the entity: a frame's worth of memory that no save needs.
const SEEN = new WeakMap()
function speedOf(e, mark, delta) {
  const was = SEEN.get(e)
  SEEN.set(e, { who: mark, px: mark.px, py: mark.py })
  if (!was || was.who !== mark || !(delta > 0)) return { vx: 0, vy: 0 }
  const vx = (mark.px - was.px) / delta, vy = (mark.py - was.py) / delta
  return Math.hypot(vx, vy) > FASTEST ? { vx: 0, vy: 0 } : { vx, vy }
}

function hurl(e, state, mark, T, v, friendly) {
  const px = e.px, py = e.py - HAND
  const flight = Math.hypot(mark.px - px, mark.py - py) / T.speed
  const a = Math.atan2(mark.py + v.vy * flight * T.lead - py, mark.px + v.vx * flight * T.lead - px)
  ;(state.projectiles ??= []).push({
    px, py, dx: Math.cos(a) * T.speed, dy: Math.sin(a) * T.speed,
    damage: T.dmg, color: BONE, shape: 'arrow', maxDist: T.range * S, distTraveled: 0,
    ...(friendly ? { friendly: true, tribe: tribeOf(e), source: 'harpoon' } : { friendly: false }),
  })
  sfx(state, 'harpoon', { px: e.px, py: e.py })
}

function rest(e, m) { m.state = 'watch'; m.t = 0; m.anchor = null; glow(e, 0) }

export function update(e, state, delta) {
  step(e, state, delta)
  keepSide(e)
}

function step(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player } = state
  postOf(e)
  const wrath = wronged(e, state)
  m.cd = Math.max(0, m.cd - delta)
  if (m.flung > 0 && (m.flung -= delta) <= 0 && m.state !== 'arm') glow(e, 0)
  // peace made or broken in the middle of a throw: it is not finished
  if (m.wrath !== wrath) { m.wrath = wrath; m.alert = false; rest(e, m); m.flung = 0 }
  e.brainDriven = wrath

  const mark = markOf(e, state, T, wrath)
  const v = mark && !wrath ? speedOf(e, mark, delta) : { vx: 0, vy: 0 }

  if (m.state === 'arm') {
    Object.assign(e, m.anchor)
    e.knockback = null
    e.quiet = true
    if (!mark) { rest(e, m); return }                  // it fell, it fled, he died, he rode off
    m.t += delta
    turnTo(e, mark.px)
    glow(e, Math.min(0.95, m.t / T.arm))
    if (m.t < T.arm) return
    hurl(e, state, mark, T, v, !wrath)
    rest(e, m)
    m.cd = T.every; m.flung = FLUNG
    glow(e, 1)
    return
  }

  e.quiet = wrath || !!mark
  if (mark) {
    turnTo(e, mark.px)
    if (!m.alert) { m.alert = true; sfx(state, 'seal-bark', { px: e.px, py: e.py }) }
    if (m.cd <= 0) { m.state = 'arm'; m.t = 0; m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }; if (wrath) e.inCombat = true }
    return
  }
  m.alert = false
  if (wrath) return                                     // the brain has him
  m.state = goHome(e, state, delta, T.homeSpeed) ? 'watch' : 'home'
  if (m.state === 'home') e.quiet = true
  else if (heroOk(player) && tilesTo(e, player) <= T.turn) turnTo(e, player.px)
}

export function debugState(e) {
  const m = e.guard
  return m ? `${m.wrath ? 'wronged ' : ''}${m.state} cd ${m.cd.toFixed(1)}` : '-'
}
// Bench overlay: his watch, and the band he throws at the hero from.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.watch, '#7ad7ff'], [T.near, '#ff5a3a'], [T.far, '#ffe14a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.norppavahti = update
