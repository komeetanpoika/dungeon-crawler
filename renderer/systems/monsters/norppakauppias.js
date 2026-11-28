// Norppaväen kauppias, the seal folk's trader: it sits on its mat by three
// wares laid on the sand. The wares, their prices and what it says about
// them are not its business (systems/trade.js, data/tribes.js); nor is its
// greeting (systems/tribes.js). All it does itself is sit where it was dealt
// and turn to a hero who comes within `turn` tiles.
//
// Wronged (its tribe's wrath, systems/tribes.js) it hands itself to the
// enemy brain (`e.brainDriven`), whose rout is all it knows: the def's
// `fleeHp: 1` makes every trader "badly hurt", so the brain runs it from the
// hero and never at him. It has no weapon. When the grudge is over it takes
// itself back and gallumphs home to its mat at `homeSpeed`.
//
// The manners every seal shares are kept here too (the singer, the guard and
// the walrus import them): where its post is, how it goes back there, how
// it turns. Pure: no browser imports.
//
//   e.post    { px, py, stuck }   where it was dealt: the middle of the tile
//                                 its hook first saw it on
//   e.side    1 | -1              the side it is drawn facing (keepSide)
//   e.trade   { state: 'sit' | 'home' | 'away' }
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef } from '../monsters.js'
import { act } from '../act.js'
import { tribeOf, wrathOf } from '../tribes.js'

const S = 32
const AT_POST = 10          // px: this near the middle of its tile it is home (act.js stops a path there)
const STUCK = 3             // s without getting anywhere before it calls where it stands home
const SIDEWAYS = 0.25       // how far a heading must lean left or right (its cosine) to turn the drawing

export const TUNING_SCHEMA = [
  { key: 'turn', label: 'Turns to the hero within', group: 'peace', type: 'range', min: 0, max: 12, step: 0.5, default: 5, hint: 'tiles' },
  { key: 'homeSpeed', label: 'Speed home', group: 'peace', type: 'range', min: 10, max: 160, step: 5, default: 55, hint: 'px/s back to its mat when the grudge is over' },
]

// ---- the manners of the seal folk -------------------------------------------------

export const heroOk = p => !!p && p.hp > 0 && !p.riding
export const wronged = (e, state) => wrathOf(state, tribeOf(e)) > 0
export const tilesTo = (e, at) => Math.hypot(at.px - e.px, at.py - e.py) / S
export const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
// It is drawn turned left or right, never round: it faces whatever is to one side of it.
export function turnTo(e, px) { if (e.pose && Math.abs(px - e.px) > 4) e.pose.facing = px < e.px ? Math.PI : 0 }
// Which side it is drawn facing (`e.side`, handed to the rig as the channel
// `side`): the side its heading leans to, kept while it goes straight up or
// down the screen, so a seal gallumphing north does not flap left and right.
// Every seal's hook ends its frame with this.
export function keepSide(e) {
  const lean = Math.cos(e.pose?.facing ?? 0)
  if (Math.abs(lean) > SIDEWAYS) e.side = lean < 0 ? -1 : 1
  ;(e.channels ??= {}).side = e.side ?? 1
}
const centre = v => Math.floor(v / S) * S + S / 2
export function postOf(e) { return e.post ?? (e.post = { px: centre(e.px), py: centre(e.py), stuck: 0 }) }

// One frame of gallumphing towards the middle of the tile at `at` ({ px, py })
// by the game's own paths (act.js). True once it is there.
export function walkTo(e, state, delta, at, speed) {
  const to = { px: centre(at.px), py: centre(at.py) }
  if (Math.hypot(to.px - e.px, to.py - e.py) <= AT_POST) return true
  e.aiHalf ??= getMonsterDef(e.type)?.stats.half ?? 8
  act(e, state, delta, { mode: 'approach', target: { x: Math.floor(to.px / S), y: Math.floor(to.py / S) }, speed })
  return false
}
// The same towards its post. One that cannot get there (walled off since it
// left) gives up after a while and makes its post where it stands.
export function goHome(e, state, delta, speed) {
  const post = postOf(e)
  const was = { px: e.px, py: e.py }
  if (walkTo(e, state, delta, post, speed)) { post.stuck = 0; return true }
  post.stuck = Math.hypot(e.px - was.px, e.py - was.py) > speed * delta * 0.2 ? 0 : post.stuck + delta
  if (post.stuck >= STUCK) Object.assign(post, { px: centre(e.px), py: centre(e.py), stuck: 0 })
  return false
}

// A seal with nothing to fight with: the brain runs it while its tribe is
// wronged, and it comes home when that is over. What it is doing:
// 'away' | 'home' (on its way back) | 'sit' (at its post).
export function keepPost(e, state, delta, speed) {
  postOf(e)
  if (wronged(e, state)) { e.brainDriven = true; return 'away' }
  e.brainDriven = false
  return goHome(e, state, delta, speed) ? 'sit' : 'home'
}

// ---- the trader -----------------------------------------------------------------

export function update(e, state, delta) {
  const T = tuningOf(e.type)
  const m = e.trade ?? (e.trade = { state: 'sit' })
  m.state = keepPost(e, state, delta, T.homeSpeed)
  e.quiet = m.state !== 'sit'
  const { player } = state
  if (m.state === 'sit' && heroOk(player) && tilesTo(e, player) <= T.turn) turnTo(e, player.px)
  keepSide(e)
}

export function debugState(e) { return e.trade?.state ?? '-' }

CREATURE_UPDATE.norppakauppias = update
