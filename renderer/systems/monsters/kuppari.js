// Kuppari, the coven's cupping-woman: she mends her sisters and harms
// nobody. The enemy brain walks her (she stays well back: the def's
// kiteBand); this hook is the supplement that runs after it, so "pinned"
// means undoing the frame's movement.
//
// When a witch, another kuppari or Syöjätär within `reach` tiles of her is
// hurt and her horn is rested, she cups her: the worst hurt first. For
// `channel` seconds she stands pinned with the horn held out (pose.cup) and
// a red line runs between them (drawFx); then the sister is mended `mend`
// (Syöjätär `mendBoss`), never above her full health, and the horn rests
// `every` seconds. A blow on the kuppari breaks the cupping off, nothing
// mended, and costs her `struck` seconds more. It ends too if the sister
// dies or gets beyond a reach and a half. Paras and vipers she does not
// tend, nor herself.
//
// Pure: no browser imports.
//
//   e.kup       { state: 'idle' | 'cup', t, cd, target, at, anchor }
//                 target: her patient's id; at: where the patient stands (world px)
//   e.channels  { cup } for her rig
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef, entityPose } from '../monsters.js'
import { alliesOf, healAlly, roleOf, withId } from '../tribes.js'
import { shatterBonus } from '../status.js'
import { startKnockback } from '../knockback.js'
import { sfx } from '../sfx.js'

const S = 32
const TENDS = new Set(['warlock', 'healer', 'boss'])
const BLOOD = ['#d8202c', '#8a1420', '#f06a6a']

export const TUNING_SCHEMA = [
  { key: 'reach', label: 'Cups within', group: 'cupping', type: 'range', min: 1, max: 10, step: 0.5, default: 5, hint: 'tiles' },
  { key: 'channel', label: 'Cups for', group: 'cupping', type: 'range', min: 0.3, max: 5, step: 0.1, default: 1.5, hint: 'seconds, pinned' },
  { key: 'mend', label: 'Mends', group: 'cupping', type: 'range', min: 0, max: 10, step: 1, default: 3 },
  { key: 'mendBoss', label: 'Mends Syöjätär', group: 'cupping', type: 'range', min: 0, max: 10, step: 1, default: 2 },
  { key: 'every', label: 'Horn rests', group: 'cupping', type: 'range', min: 0.5, max: 20, step: 0.5, default: 4, hint: 'seconds between cuppings' },
  { key: 'struck', label: 'A blow costs her', group: 'cupping', type: 'range', min: 0, max: 10, step: 0.5, default: 2, hint: 'seconds more' },
  { key: 'first', label: 'First cupping after', group: 'cupping', type: 'range', min: 0, max: 10, step: 0.5, default: 1, hint: 'seconds' },
]

function ensure(e, T) {
  if (e.kup) return e.kup
  e.channels = { ...(e.channels ?? null), cup: 0 }
  return e.kup = { state: 'idle', t: 0, cd: T.first, target: null, at: null, anchor: null }
}
function pin(e, m) {
  if (!m.anchor || e.knockback) m.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
  else Object.assign(e, m.anchor)
}
function stop(e, m, cd) {
  m.state = 'idle'; m.t = 0; m.cd = cd; m.target = null; m.at = null; m.anchor = null
  e.channels.cup = 0
}
const far = (a, b) => Math.hypot(a.px - b.px, a.py - b.py)

// The sister who needs her most: the least whole of those she tends, in reach.
function patient(e, state, T) {
  let best = null, least = 1
  for (const o of alliesOf(e, state, T.reach)) {
    if (!TENDS.has(roleOf(o)) || !Number.isFinite(o.maxHp) || !(o.hp < o.maxHp)) continue
    const whole = o.hp / o.maxHp
    if (whole < least) { best = o; least = whole }
  }
  return best
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e, T)

  if (m.state === 'cup') {
    // (found again by her id every frame: a blade's blow makes a new object of an enemy)
    const sister = state.entities.find(o => o.id === m.target)
    if (!sister || !(sister.hp > 0) || sister.dying > 0 || far(e, sister) > T.reach * 1.5 * S) { stop(e, m, T.every / 2); return }
    pin(e, m)
    if (e.pose) e.pose.facing = Math.atan2(sister.py - e.py, sister.px - e.px)
    m.at = { px: sister.px, py: sister.py }
    m.t += delta
    if (m.t < T.channel) return
    healAlly(state, sister, roleOf(sister) === 'boss' ? T.mendBoss : T.mend)
    stop(e, m, T.every)
    return
  }

  // idle: the brain has moved her this frame
  m.cd = Math.max(0, m.cd - delta)
  if (m.cd > 0) return
  const sister = patient(e, state, T)
  if (!sister) return
  m.state = 'cup'; m.t = 0; m.target = withId(sister).id; m.at = { px: sister.px, py: sister.py }; m.anchor = null
  pin(e, m)
  e.channels.cup = 1
  sfx(state, 'cup', { px: e.px, py: e.py })
}

// A blow lands like any other (a blade shoves her, a rimed one shatters) and
// breaks off what she was at.
export function hit(e, state, dmg, opts = {}) {
  const T = tuningOf(e.type), m = ensure(e, T)
  e.hp -= dmg + shatterBonus(e); e.inCombat = true
  if (m.state === 'cup') stop(e, m, T.every + T.struck)
  if (opts.knockback > 0 && state.player) startKnockback(e, e.px - state.player.px, e.py - state.player.py, opts.knockback)
  return { entity: e, absorbed: false, cue: 'melee-hit' }
}

// The red line from her sister to the horn's mouth: beads of blood drawn
// along it, running her way. ctx sits at the kuppari's screen centre.
export function drawFx(ctx, e, S) {
  const m = e.kup
  if (!m || m.state !== 'cup' || !m.at || e.hp <= 0) return
  const k = S / 32, u = Math.max(1, Math.round(2 * k))
  const d = getMonsterDef(e.type)
  const horn = typeof d?.rig.anchor === 'function' ? d.rig.anchor(d.params, entityPose(e), S, 'horn') : { x: 0, y: 0 }
  // (to her sister's chest, not her feet)
  const tx = (m.at.px - e.px) * k, ty = (m.at.py - e.py) * k - 10 * k
  const len = Math.hypot(tx - horn.x, ty - horn.y)
  if (len < 1) return
  const dx = (tx - horn.x) / len, dy = (ty - horn.y) / len
  const step = 2 * u, run = (m.t * 50 * k) % (3 * step)
  ctx.save()
  for (let s = len - run % step, i = 0; s > 0; s -= step, i++) {
    // a slack line: it sags in the middle
    const sag = Math.sin(s / len * Math.PI) * 5 * k
    const bead = (i + Math.floor(run / step)) % 3 === 0
    ctx.fillStyle = BLOOD[bead ? 2 : i % 2]
    const w = bead ? 2 * u : u
    ctx.fillRect(Math.round(horn.x + dx * s - w / 2), Math.round(horn.y + dy * s + sag - w / 2), w, w)
  }
  ctx.restore()
}

export function debugState(e) {
  const m = e.kup
  return m ? `${m.state} t ${m.t.toFixed(1)} rest ${m.cd.toFixed(1)}${m.target ? ' on ' + m.target : ''}` : '-'
}
// Bench overlay: how far her horn reaches.
export function debugDraw(ctx, e, S) {
  ctx.strokeStyle = '#d8202c'
  ctx.beginPath(); ctx.arc(0, 0, tuningOf(e.type).reach * S, 0, Math.PI * 2); ctx.stroke()
}

CREATURE_UPDATE.kuppari = update
CREATURE_HIT.kuppari = hit
