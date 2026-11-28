// Para, the witch's errand-thing: a ball of yarn on three legs that robs.
// It never wounds.
//
// It waits at home until it sees the hero within `notice` tiles (or is
// struck). Then it runs at him at its own speed (the def's, faster than a
// walk and slower than a sprint), weaving `zig` radians to either side of
// the straight line. Within `snatch` tiles (`snatchFrog` of a hero who is a
// frog) it takes one unit of the first kind in WANTS that his sack holds:
// nothing else, ever, and never more than that one. With nothing to take it
// blows a raspberry. Either way it then runs home at `goSpeed` and cowers
// there. Home is its witch while she lives (`e.madeBy`, her id: a knitted
// one), else `e.home` (tiles: the camp's fire, where the Wilds dealt it or
// where its witch made it), else where it first stood.
//
// What it took rides on its back as `e.loot`, a floating item's contents:
// game.js lays that where it dies (systems/drops.js carriedDrop), so killing
// it anywhere gives the thing back, and following it home finds the coven.
// One that came away with nothing tries again after `retry` seconds. It
// gives up a hero who dies, rides off, or gets `leash` tiles away.
//
// Hook-driven (`behavior.driver: 'hook'`): it owns its movement, and walks
// by the game's own steering (systems/act.js: a charge along its weaving
// line while he is in sight, the flow field round walls, a path home). Open
// to spells all the while (`spellOpen`). Pure: no browser imports.
//
//   e.para      { state: 'wait' | 'come' | 'go' | 'cower', t, rest, rasp, stuck, side, den }
//   e.loot      what it carries
//   e.channels  { carry, cower, raspberry } for its rig
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { act } from '../act.js'
import { removeItem, contentsFromItem } from '../inventory.js'
import { isFrog } from '../hex.js'
import { addFloat } from '../feedback.js'
import { sfx } from '../sfx.js'

const S = 32
const RASP_SHOW = 0.7        // s the tongue stays out
const STUCK_AFTER = 3        // s with no way home before it cowers where it is
const FOLLOW = 2.5           // tiles its home (a witch) must move before a cowering one gets up to follow

// What it will take, most wanted first: one unit, of a stack.
export const WANTS = ['cooked_meat', 'potion', 'meat', 'herring', 'mushroom', 'lumber']

export const TUNING_SCHEMA = [
  { key: 'notice', label: 'Notices from', group: 'thief', type: 'range', min: 2, max: 16, step: 0.5, default: 8, hint: 'tiles, in sight' },
  { key: 'snatch', label: 'Snatches within', group: 'thief', type: 'range', min: 0.4, max: 2, step: 0.05, default: 0.8, hint: 'tiles' },
  { key: 'snatchFrog', label: 'From a frog within', group: 'thief', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.5, hint: 'tiles' },
  { key: 'leash', label: 'Gives up beyond', group: 'thief', type: 'range', min: 6, max: 30, step: 1, default: 14, hint: 'tiles from the hero' },
  { key: 'retry', label: 'Tries again after', group: 'thief', type: 'range', min: 1, max: 30, step: 0.5, default: 6, hint: 'seconds at home, empty-handed' },
  { key: 'zig', label: 'Zigzag', group: 'run', type: 'range', min: 0, max: 1.2, step: 0.05, default: 0.5, hint: 'radians to either side' },
  { key: 'zigFreq', label: 'Zigzag speed', group: 'run', type: 'range', min: 2, max: 20, step: 0.5, default: 9, hint: 'radians a second' },
  { key: 'goSpeed', label: 'Speed going home', group: 'run', type: 'range', min: 60, max: 240, step: 5, default: 150, hint: 'px/s (a sprint is 186)' },
  { key: 'homeR', label: 'Home is within', group: 'run', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.5, hint: 'tiles of the spot' },
]

function ensure(e) {
  if (e.para) return e.para
  const def = getMonsterDef(e.type)
  e.spellOpen = true
  e.aiHalf = def?.stats.half ?? 6
  e.home ??= { x: e.x, y: e.y }
  e.channels = { carry: e.loot ? 1 : 0, cower: 0, raspberry: 0 }
  return e.para = { state: 'wait', t: 0, rest: 0, rasp: 0, stuck: 0, side: (e.x + e.y) % 2 ? 1 : -1, den: null }
}

// Where home is now: its witch, while she lives; else the spot it was given.
function homeOf(e, state) {
  if (e.madeBy != null) {
    const w = state.entities?.find(o => o.id === e.madeBy && o.hp > 0 && !(o.dying > 0))
    if (w) return { x: w.x, y: w.y }
  }
  return e.home
}

// One unit of the first thing it wants. Returns what it took (and now
// carries), or null with a raspberry.
export function snatch(e, state) {
  const { player } = state
  for (const kind of WANTS) {
    const i = (player.inventory ?? []).findIndex(it => it.kind === kind && it.stackable && !it.quest && (it.count ?? 1) > 0)
    if (i === -1) continue
    const one = removeItem(player, i)
    e.loot = contentsFromItem(one)
    addFloat(state.feedback, { px: player.px, py: player.py - 12, text: `-1 ${one.name}`, kind: 'note' })
    sfx(state, 'para-skitter', { px: e.px, py: e.py })
    return e.loot
  }
  e.para.rasp = RASP_SHOW
  sfx(state, 'raspberry', { px: e.px, py: e.py })
  return null
}

function goHome(e, m) {
  m.state = 'go'; m.stuck = 0
  if (e.ai) { e.ai.path = undefined; e.ai.pathTarget = null }
}

export function update(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player, map } = state
  const ok = !!player && player.hp > 0 && !player.riding
  const d = ok ? Math.hypot(player.px - e.px, player.py - e.py) : Infinity
  m.t += delta
  m.rasp = Math.max(0, m.rasp - delta)
  e.channels.raspberry = m.rasp > 0 ? 1 : 0
  e.channels.carry = e.loot ? 1 : 0
  e.channels.cower = m.state === 'cower' ? 1 : 0

  if (m.state === 'wait') {
    m.rest = Math.max(0, m.rest - delta)
    if (e.loot) { m.state = 'cower'; return }
    if (m.rest <= 0 && ok && d <= T.notice * S && (e.inCombat || hasLineOfSight(map, e.y, e.x, player.y, player.x))) {
      m.state = 'come'; m.t = 0
      e.inCombat = true
      sfx(state, 'para-skitter', { px: e.px, py: e.py })
    }
    return
  }

  if (m.state === 'come') {
    if (!ok || d > T.leash * S) { goHome(e, m); return }
    if (d <= (isFrog(player) ? T.snatchFrog : T.snatch) * S) { snatch(e, state); goHome(e, m); return }
    // at him, weaving; round whatever is in the way by the flow field
    const speed = getMonsterDef(e.type)?.stats.speed ?? 135
    const weave = Math.cos(m.t * T.zigFreq) * m.side * T.zig * Math.min(1, d / (3 * S))
    const angle = Math.atan2(player.py - e.py, player.px - e.px) + weave
    const seen = hasLineOfSight(map, e.y, e.x, player.y, player.x)
    if (!(seen && act(e, state, delta, { mode: 'charge', angle, speed }))) act(e, state, delta, { mode: 'approach', speed })
    return
  }

  const home = homeOf(e, state)

  if (m.state === 'go') {
    const done = Array.isArray(e.ai?.path) && e.ai.path.length === 0 && e.ai.pathTarget?.x === home.x && e.ai.pathTarget?.y === home.y
    m.stuck = e.ai?.path === null ? m.stuck + delta : 0
    const off = Math.hypot(home.x - e.x, home.y - e.y)
    if (off <= T.homeR || done || m.stuck >= STUCK_AFTER) {
      m.state = 'cower'; m.rest = T.retry; m.den = { x: home.x, y: home.y }
      e.inCombat = false
      return
    }
    act(e, state, delta, { mode: 'approach', target: { x: home.x, y: home.y }, speed: T.goSpeed })
    return
  }

  // cower: home, shut-eyed. Its witch may walk off: it keeps to her skirts.
  if (!m.den) m.den = { x: home.x, y: home.y }
  if (Math.hypot(home.x - m.den.x, home.y - m.den.y) > FOLLOW) { goHome(e, m); return }
  if (!e.loot && (m.rest -= delta) <= 0) m.state = 'wait'
}

export function debugState(e) {
  const m = e.para
  return m ? `${m.state}${e.loot ? ' carrying ' + e.loot.type : ''} rest ${m.rest.toFixed(1)}` : '-'
}
// Bench overlay: how far it notices, and how near it snatches.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type)
  for (const [r, colour] of [[T.notice, '#7ad7ff'], [T.snatch, '#ff5a3a'], [T.snatchFrog, '#63c048']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.para = update
