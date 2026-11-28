// Noita, the witch of the marsh coven: she carries no blade and wounds
// nobody. The enemy brain walks her (she keeps off: the def's kiteBand);
// this hook is the supplement that runs after it (game.js enemy loop), so
// "pinned" means undoing the frame's movement, as Podeboo does.
//
// The hex. With the hero in sight within `hexRange` tiles her clock runs:
// the first hex after `hexFirst` seconds, then one every `hexEvery`. She
// stops and points at him for `point` seconds (pose.eyeGlow: the arm, a
// green glow growing at the fingertip), then a wisp leaves her finger
// straight for where he stands (systems/tribes/wisps.js: it flies
// `wispSpeed` px/s for `wispLife` seconds; touching him it makes him a frog
// for `frog` seconds). A sidestep or a raised shield answers it.
//
// The para. In a fight (the hero alive within `knitRange` tiles, seen or
// having struck her), every `knitEvery` seconds (the first after
// `knitFirst`) she sits at her needles for `knit` seconds, pinned, and a
// para stands beside her (systems/tribes.js summonNear; it calls her home).
// Never more than `maxParas` of her own alive: at that many her needles rest.
//
// One thing at a time, the hex first. A hero who dies or rides off ends
// whichever she is at, with nothing cast and nothing made. Her wisps go out
// with her. Pure: no browser imports.
//
//   e.noita     { state: 'idle' | 'point' | 'knit', t, hexT, knitT, anchor, click }
//   e.wisps     her hexes in flight
//   e.channels  { knit } for her rig
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef, entityPose } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { stormReach } from '../brain.js'
import { summonNear, withId } from '../tribes.js'
import { WISP_TUNING, castWisp, tickWisps, drawWisps } from '../tribes/wisps.js'
import { sfx } from '../sfx.js'

const S = 32
const CLICK_EVERY = 0.4      // s between the needles' cues

export const TUNING_SCHEMA = [
  { key: 'hexFirst', label: 'First hex after', group: 'hex', type: 'range', min: 0, max: 10, step: 0.5, default: 2.5, hint: 'seconds with the hero in sight' },
  { key: 'hexEvery', label: 'Hex every', group: 'hex', type: 'range', min: 2, max: 20, step: 0.5, default: 7, hint: 'seconds' },
  { key: 'hexRange', label: 'Hexes within', group: 'hex', type: 'range', min: 3, max: 12, step: 0.5, default: 7, hint: 'tiles, in sight' },
  { key: 'point', label: 'Points for', group: 'hex', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.6, hint: 'seconds of tell' },
  ...WISP_TUNING,
  { key: 'knitFirst', label: 'First para after', group: 'para', type: 'range', min: 0, max: 20, step: 0.5, default: 4, hint: 'seconds of the fight' },
  { key: 'knitEvery', label: 'Knits every', group: 'para', type: 'range', min: 2, max: 30, step: 0.5, default: 9, hint: 'seconds' },
  { key: 'knit', label: 'Knits for', group: 'para', type: 'range', min: 0.2, max: 4, step: 0.1, default: 1.2, hint: 'seconds, pinned' },
  { key: 'maxParas', label: 'Paras of her own', group: 'para', type: 'range', min: 0, max: 5, step: 1, default: 2, hint: 'alive at once' },
  { key: 'knitRange', label: 'A fight is within', group: 'para', type: 'range', min: 3, max: 16, step: 0.5, default: 9, hint: 'tiles' },
]

function ensure(e, T) {
  if (e.noita) return e.noita
  e.channels = { ...(e.channels ?? null), knit: 0 }
  return e.noita = { state: 'idle', t: 0, hexT: T.hexFirst, knitT: T.knitFirst, anchor: null, click: 0 }
}
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
const face = (e, to) => { if (e.pose) e.pose.facing = Math.atan2(to.py - e.py, to.px - e.px) }
// Held where she stands: the brain's step this frame is undone (a blow's
// shove is let through, and she is held where it leaves her).
function pin(e, m) {
  if (!m.anchor || e.knockback) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  else Object.assign(e, m.anchor)
}
function rest(e, m) {
  m.state = 'idle'; m.t = 0; m.anchor = null
  e.channels.knit = 0
  glow(e, 0)
}
// Where a part of her is drawn, in world px (her rig says: render/monster-rigs/crone.js).
export function partOf(e, part) {
  const d = getMonsterDef(e.type)
  const a = typeof d?.rig.anchor === 'function' ? d.rig.anchor(d.params, entityPose(e), S, part) : null
  return a ? { px: e.px + a.x, py: e.py + a.y } : { px: e.px, py: e.py }
}
const ownParas = (state, e) => e.id == null ? 0
  : state.entities.filter(o => o.madeBy === e.id && o.type === 'para' && o.hp > 0 && !(o.dying > 0)).length

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e, T)
  const { player, map } = state
  tickWisps(state, e, delta, T)

  const ok = !!player && player.hp > 0 && !player.riding
  const d = ok ? Math.hypot(player.px - e.px, player.py - e.py) : Infinity
  const seen = ok && d <= Math.min(T.hexRange * S, stormReach(state)) && hasLineOfSight(map, e.y, e.x, player.y, player.x)
  const fight = ok && d <= T.knitRange * S && (seen || !!e.inCombat)
  // her clocks run while there is somebody to hex, whatever she is at
  m.hexT = seen ? Math.max(0, m.hexT - delta) : Math.max(m.hexT, T.hexFirst)
  if (fight) m.knitT = Math.max(0, m.knitT - delta)

  if (m.state === 'point') {
    if (!ok) { rest(e, m); return }
    pin(e, m)
    face(e, player)
    m.t += delta
    glow(e, Math.min(0.95, m.t / T.point))
    if (m.t < T.point) return
    // the wisp leaves her fingertip for where he stands now
    const from = partOf(e, 'hand')
    castWisp(e, from.px, from.py, Math.atan2(player.py - from.py, player.px - from.px), T)
    sfx(state, 'hex-cast', { px: e.px, py: e.py })
    m.hexT = T.hexEvery
    rest(e, m)
    return
  }

  if (m.state === 'knit') {
    if (!ok) { rest(e, m); return }
    pin(e, m)
    m.t += delta
    e.channels.knit = 1
    if ((m.click -= delta) <= 0) { m.click = CLICK_EVERY; sfx(state, 'knit', { px: e.px, py: e.py }) }
    if (m.t < T.knit) return
    m.knitT = T.knitEvery
    rest(e, m)
    // (counted again here: one may have been made, or have died, while she sat)
    if (ownParas(state, e) < T.maxParas)
      summonNear(state, e, 'para', { min: 1, max: 2, extra: { madeBy: withId(e).id, home: { x: e.x, y: e.y }, inCombat: true } })
    return
  }

  // idle: the brain has moved her this frame. She keeps her eyes on him,
  // whichever way she backs off.
  if (seen) face(e, player)
  if (seen && m.hexT <= 0) {
    m.state = 'point'; m.t = 0; m.anchor = null
    pin(e, m)
    face(e, player)
    return
  }
  if (fight && m.knitT <= 0 && ownParas(state, withId(e)) < T.maxParas) {
    m.state = 'knit'; m.t = 0; m.anchor = null; m.click = 0
    pin(e, m)
    e.channels.knit = 1
  }
}

// Her hexes in flight, over the hero.
export function drawFx(ctx, e, S) { drawWisps(ctx, e, S) }

export function debugState(e) {
  const m = e.noita
  return m ? `${m.state} hex ${m.hexT.toFixed(1)} knit ${m.knitT.toFixed(1)} wisps ${e.wisps?.length ?? 0}` : '-'
}
// Bench overlay: how far she hexes, and what she calls a fight.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.hexRange, '#63c048'], [T.knitRange, '#ff5a3a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.noita = update
