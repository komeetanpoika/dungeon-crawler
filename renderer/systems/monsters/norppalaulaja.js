// Norppaväen laulaja, the seal folk's singer: the camp's healer.
//
// She listens. A hero who is hurt or poisoned (systems/poison.js) and stays
// within `reach` tiles of her for `wait` seconds is sung to: the poison is
// gone at once, and every `beat` seconds he is mended 1 hp (never above his
// health), up to `most` hp in one song. The song ends when she has given
// `most`, when he is whole, or when he walks out of reach; then she curls up
// and dozes for `doze` seconds and sings to nobody. A hero who dies, or is
// carried off on the coach, ends the song with no doze.
//
// She has no weapon. Wronged, she breaks off, wakes if she slept, and the
// enemy brain runs her from the hero (the def's `fleeHp: 1`: see
// norppakauppias.js, whose manners she shares); when the grudge is over she
// comes back to her place.
//
// Hook-driven. drawFx draws her notes over the hero. Pure: no browser imports.
//
//   e.song      { state: 'listen' | 'sing' | 'doze', t, near, given, beat, dx, dy }
//               (dx, dy: the hero from her, px, while she sings: where the notes go)
//   e.channels  { sing } | { doze }   for the rig (render/monster-rigs/seal.js)
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef, entityPose } from '../monsters.js'
import { curePoison, isPoisoned } from '../poison.js'
import { addFloat } from '../feedback.js'
import { sfx } from '../sfx.js'
import { heroOk, tilesTo, turnTo, keepPost, keepSide } from './norppakauppias.js'

export const TUNING_SCHEMA = [
  { key: 'reach', label: 'Reach', group: 'song', type: 'range', min: 1, max: 6, step: 0.1, default: 2.2, hint: 'tiles: a hero this near is heard' },
  { key: 'wait', label: 'Listens for', group: 'song', type: 'range', min: 0, max: 6, step: 0.1, default: 1.5, hint: 'seconds he must stay before she sings' },
  { key: 'beat', label: 'Mends every', group: 'song', type: 'range', min: 0.3, max: 5, step: 0.1, default: 1.2, hint: 'seconds for each hp' },
  { key: 'mend', label: 'Mends', group: 'song', type: 'range', min: 1, max: 4, step: 1, default: 1, hint: 'hp a beat' },
  { key: 'most', label: 'Mends at most', group: 'song', type: 'range', min: 1, max: 20, step: 1, default: 8, hint: 'hp in one song' },
  { key: 'doze', label: 'Dozes for', group: 'song', type: 'range', min: 0, max: 180, step: 5, default: 45, hint: 'seconds after a song' },
  { key: 'slack', label: 'Song holds to', group: 'song', type: 'range', min: 0, max: 2, step: 0.1, default: 0.3, hint: 'tiles past her reach he may drift before the song is lost' },
  { key: 'turn', label: 'Turns to the hero within', group: 'peace', type: 'range', min: 0, max: 12, step: 0.5, default: 5, hint: 'tiles' },
  { key: 'homeSpeed', label: 'Speed home', group: 'peace', type: 'range', min: 10, max: 160, step: 5, default: 55, hint: 'px/s back to her place when the grudge is over' },
]

const ensure = e => e.song ?? (e.song = { state: 'listen', t: 0, near: 0, given: 0, beat: 0, dx: 0, dy: 0 })
function to(e, m, state) {
  m.state = state; m.t = 0; m.near = 0
  e.channels = state === 'sing' ? { sing: 1 } : state === 'doze' ? { doze: 1 } : {}
}

// What a potion does for him (game.js useInventoryItem): hp, never past his
// health, a green float, the sound.
function mend(state, n) {
  const { player } = state
  const gain = Math.max(0, Math.min(n, (player.maxHp ?? 0) - player.hp))
  if (!(gain > 0)) return 0
  player.hp += gain
  addFloat(state.feedback, { px: player.px, py: player.py, text: `+${gain}`, kind: 'heal' })
  sfx(state, 'heal', { px: player.px, py: player.py })
  return gain
}
function cure(state) {
  const { player } = state
  if (isPoisoned(player) && curePoison(player)) addFloat(state.feedback, { px: player.px, py: player.py - 12, text: 'cured', kind: 'heal' })
}

export function update(e, state, delta) {
  step(e, state, delta)
  keepSide(e)
}

function step(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player } = state
  if (keepPost(e, state, delta, T.homeSpeed) !== 'sit') {
    // wronged, or on her way back: no song, no sleep
    if (m.state !== 'listen') to(e, m, 'listen')
    m.near = 0
    e.quiet = true
    return
  }
  const ok = heroOk(player)
  const d = ok ? tilesTo(e, player) : Infinity

  if (m.state === 'doze') {
    e.quiet = true
    if ((m.t += delta) >= T.doze) to(e, m, 'listen')
    return
  }
  if (m.state === 'sing') {
    e.quiet = true
    if (!ok) { to(e, m, 'listen'); return }             // he died, or rode off: nothing left hanging
    if (d > T.reach + T.slack) { to(e, m, 'doze'); return }
    m.t += delta
    m.dx = player.px - e.px; m.dy = player.py - e.py
    turnTo(e, player.px)
    cure(state)
    if ((m.beat -= delta) > 0) return
    m.beat += T.beat
    m.given += mend(state, Math.min(T.mend, T.most - m.given))
    sfx(state, 'seal-song', { px: e.px, py: e.py })
    if (m.given >= T.most || player.hp >= player.maxHp) to(e, m, 'doze')
    return
  }
  // listening
  e.quiet = false
  if (ok && d <= T.turn) turnTo(e, player.px)
  const needs = ok && d <= T.reach && (player.hp < player.maxHp || isPoisoned(player))
  m.near = needs ? m.near + delta : 0
  if (!needs || m.near < T.wait) return
  to(e, m, 'sing')
  m.given = 0; m.beat = T.beat
  m.dx = player.px - e.px; m.dy = player.py - e.py
  e.quiet = true
  cure(state)
  sfx(state, 'seal-song', { px: e.px, py: e.py })
}

// Her notes, over the hero: quavers that leave her mouth one after another,
// rise, and drift across to him. ctx sits at her screen centre.
const NOTES = 4
const INK = '#27314a', HEADS = ['#e0457b', '#2f7fd6', '#f5a524', '#3f9d5a']
export function drawFx(ctx, e, S) {
  const m = e.song
  if (!m || m.state !== 'sing' || !(e.hp > 0)) return
  const def = getMonsterDef(e.type)
  const k = S / 32, u = Math.max(1, Math.round(2 * k))
  const from = def?.rig.anchor?.(def.params, entityPose(e), S, 'mouth') ?? { x: 0, y: -8 * k }
  const tx = m.dx * k, ty = m.dy * k - 14 * k
  ctx.save()
  for (let i = 0; i < NOTES; i++) {
    const f = (m.t * 0.55 + i / NOTES) % 1
    const x = Math.round(from.x + (tx - from.x) * f + Math.sin(f * 7 + i * 2.1) * 5 * k)
    const y = Math.round(from.y + (ty - from.y) * f - Math.sin(f * Math.PI) * 16 * k)
    ctx.globalAlpha = Math.min(1, Math.sin(f * Math.PI) * 2.2)
    ctx.fillStyle = INK
    ctx.fillRect(x + u, y - 3 * u, Math.max(1, Math.round(u / 2)), 3 * u + 1)      // the stem
    ctx.fillRect(x + u, y - 3 * u, 2 * u, Math.max(1, Math.round(u * 0.75)))        // its flag
    ctx.fillRect(x - 1, y - 1, 2 * u + 1, u + 2)                                    // the head, edged
    ctx.fillStyle = HEADS[i % HEADS.length]
    ctx.fillRect(x, y, 2 * u - 1, u)
  }
  ctx.restore()
}

export function debugState(e) {
  const m = e.song
  return m ? `${m.state} t ${m.t.toFixed(1)} near ${m.near.toFixed(1)} given ${m.given}` : '-'
}
// Bench overlay: how near he must stand.
export function debugDraw(ctx, e, S) {
  ctx.strokeStyle = '#7ad7ff'
  ctx.beginPath(); ctx.arc(0, 0, tuningOf(e.type).reach * S, 0, Math.PI * 2); ctx.stroke()
}

CREATURE_UPDATE.norppalaulaja = update
