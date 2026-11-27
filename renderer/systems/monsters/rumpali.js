// Rumpali, the mountain trolls' war drummer (tribe `peikot`): their bard and
// their healer. The enemy brain keeps him 5 to 8 tiles off the hero (the
// def's `kiteBand`); he is unarmed. This hook is his drum.
//
// He drums while the hero lives and is in sight within `hear` tiles, or a
// troll within `reach` tiles of him is at the hero (has him in sight, or is
// swinging): a beat every `beat` seconds, each a 'drum' cue, so a band is
// heard before it is seen. Each beat stirs every other troll within `reach`
// tiles for `stir` seconds (systems/status.js haste: `haste` times its speed)
// and takes `quicken` seconds off the rest after its swing. Every
// `mendEvery`th beat mends each of them by `mend`, but never the King. A blow
// silences him for `silence` seconds. Drop the drummer first.
//
// A supplement: the update runs after brain and act (and not while he is
// stunned: a frozen drummer is a silent one). Pure: no browser imports.
//
//   e.drummer    { t, n, mute, since, on }   t: seconds to the next beat;
//                n: beats so far; since: seconds since the last one
//   e.channels   { drum, stirred, side }   drum: 0 at rest, else 1 + which stick +
//                how far into the beat (render/monster-rigs/troll.js)
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { stormReach } from '../brain.js'
import { alliesOf, healAlly, roleOf } from '../tribes.js'
import { applyHaste } from '../status.js'
import { trollStruck, trollLook } from '../tribes/rockfall.js'
import { sfx } from '../sfx.js'

const S = 32
const NOTE_SHOW = 0.45       // s a beat's notes hang in the air

export const TUNING_SCHEMA = [
  { key: 'hear', label: 'Drums at a hero within', group: 'drum', type: 'range', min: 3, max: 16, step: 0.5, default: 9, hint: 'tiles, in sight' },
  { key: 'reach', label: 'Reach', group: 'drum', type: 'range', min: 1, max: 12, step: 0.5, default: 6, hint: 'tiles: the trolls a beat stirs' },
  { key: 'beat', label: 'Beat every', group: 'drum', type: 'range', min: 0.2, max: 2, step: 0.05, default: 0.55, hint: 'seconds' },
  { key: 'stir', label: 'Stirred for', group: 'stir', type: 'range', min: 0.2, max: 5, step: 0.1, default: 1.2, hint: 'seconds after a beat' },
  { key: 'haste', label: 'Haste', group: 'stir', type: 'range', min: 1, max: 2, step: 0.05, default: 1.3, hint: 'times a stirred troll\'s speed' },
  { key: 'quicken', label: 'Off the swing\'s rest', group: 'stir', type: 'range', min: 0, max: 0.5, step: 0.05, default: 0.1, hint: 'seconds a beat takes off a stirred troll\'s wait to swing again' },
  { key: 'mendEvery', label: 'Mends every', group: 'mend', type: 'range', min: 1, max: 20, step: 1, default: 6, hint: 'beats' },
  { key: 'mend', label: 'Mends by', group: 'mend', type: 'range', min: 0, max: 5, step: 1, default: 1, hint: 'hp to each stirred troll but the King' },
  { key: 'silence', label: 'Silenced for', group: 'drum', type: 'range', min: 0, max: 8, step: 0.1, default: 2, hint: 'seconds after a blow' },
]

function ensure(e) {
  if (e.drummer) return e.drummer
  e.channels = { ...(e.channels ?? null), drum: 0, stirred: 0 }
  return e.drummer = { t: 0, n: 0, mute: 0, since: Infinity, on: false }
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player, map } = state
  trollLook(e)
  m.since += delta
  m.mute = Math.max(0, m.mute - delta)

  const band = alliesOf(e, state, T.reach)
  const living = !!player && player.hp > 0
  const seen = living && !player.riding &&
    Math.hypot(player.px - e.px, player.py - e.py) <= Math.min(T.hear * S, stormReach(state)) &&
    hasLineOfSight(map, e.y, e.x, player.y, player.x)
  const on = living && m.mute <= 0 && (seen || band.some(o => o.attack || o.ai?.mode === 'chase'))
  if (!on) { m.on = false; e.channels.drum = 0; return }
  // (he lifts his sticks for half a beat before the first one falls)
  if (!m.on) { m.on = true; m.t = T.beat / 2 }

  m.t -= delta
  if (m.t <= 0) {
    m.t = Math.max(0.05, m.t + T.beat)
    m.n++; m.since = 0
    sfx(state, 'drum', { px: e.px, py: e.py })
    const mends = m.n % Math.max(1, Math.round(T.mendEvery)) === 0
    for (const o of band) {
      applyHaste(o, T.haste, T.stir)
      if (o.damageCooldown > 0) o.damageCooldown = Math.max(0, o.damageCooldown - T.quicken)
      if (mends && roleOf(o) !== 'boss') healAlly(state, o, T.mend)
    }
  }
  e.channels.drum = 1 + (m.n % 2) + Math.min(0.99, m.since / T.beat)
}

// A blow lands as on any monster, and the drum falls silent.
export function hit(e, state, dmg, opts = {}) {
  const m = ensure(e)
  m.mute = tuningOf(e.type).silence
  m.on = false
  e.channels.drum = 0
  return trollStruck(e, state, dmg, opts)
}

// Each beat: a ring of sound off the drum and two notes going up, over the
// hero. ctx sits at the drummer's screen centre.
export function drawFx(ctx, e, S) {
  const m = e.drummer
  if (!m || !(e.hp > 0) || !(m.since < NOTE_SHOW) || !(e.channels?.drum > 0)) return
  const k = S / 32, u = Math.max(2, Math.round(2 * k)), f = m.since / NOTE_SHOW
  const d = getMonsterDef(e.type)
  const head = d?.rig.anchor?.(d.params, e.pose ?? null, S, 'head') ?? { x: 0, y: -20 * k }
  const drum = d?.rig.anchor?.(d.params, e.pose ?? null, S, 'drum') ?? { x: 0, y: -12 * k }
  const rect = (x, y, w, h) => ctx.fillRect(Math.round(x), Math.round(y), w, h)
  ctx.save()
  ctx.globalAlpha = 1 - f
  // the ring
  ctx.fillStyle = '#f4e9c8'
  const r = (10 + 26 * f) * k
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * Math.PI * 2
    rect(drum.x + Math.cos(a) * r - u / 2, drum.y + Math.sin(a) * r * 0.6 - u / 2, u, u)
  }
  // the notes: a head and a stem each, one to either side, the side they lean changing with the beat
  const lean = m.n % 2 ? 1 : -1
  for (const side of [-1, 1]) {
    const x = head.x + side * (9 + 7 * f) * k + lean * 2 * k, y = head.y - (10 + 16 * f) * k - (side === lean ? 4 * k : 0)
    ctx.fillStyle = '#2a1c12'
    rect(x - u, y - u, 2 * u + u, 2 * u + u); rect(x + u - u / 2, y - 3 * u - u / 2, 2 * u, 3 * u)
    ctx.fillStyle = '#ffe9a8'
    rect(x - u / 2, y - u / 2, 2 * u, 2 * u); rect(x + u, y - 3 * u, u, 3 * u)
  }
  ctx.restore()
}

export function debugState(e) {
  const m = e.drummer
  return m ? `${m.mute > 0 ? `silenced ${m.mute.toFixed(1)}` : m.on ? `drumming, beat ${m.n}` : 'quiet'}` : '-'
}
// Bench overlay: whom a beat stirs, and how far off he starts to drum.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.reach, '#7ad7ff'], [T.hear, '#ffe14a']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.rumpali = update
CREATURE_HIT.rumpali = hit
