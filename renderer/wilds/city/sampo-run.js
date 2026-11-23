// The Sampo's story at play (sampo.js is the story): the tellings, the look
// under the lid's rim, and the smith's gift. Runs every frame of the Wilds,
// in the street and under a roof (game.js), and touches nothing unless the
// story has something to do.
//
//   startTelling(state, e, world) -> bool
//     the interact key on a peaceful npc: has `e` a telling now (sampo.js
//     tellingFor)? Then it begins (or goes on, if already theirs) and true
//     comes back: the everyday line is not said. Nobody tells a warned or
//     wanted player anything.
//   tickSampo(state, world, delta, hooks)
//     hooks: { spawn(spawns) -> entities, persist() }
//
// A telling (state.telling = { id, lines, sets, i, t, dur }, never saved) is
// spoken a line at a time over the teller's head, each up long enough to read
// (feedback.js sayDuration). Its flag is set as the last line begins: whoever
// has read that far has been told. It stops if the teller is gone or the
// player walks more than TELL_REACH tiles off, and begins anew at the next
// asking. A flag set saves the game and gives everyone their new lines: the
// street's people through the run's stage (runtime.js keepLines), those under
// this roof here (they were built with the old ones).
import { speakFrom, think, sayDuration, queueToast } from '../../systems/feedback.js'
import { isWalkable, weaponContents } from '../../systems/entities.js'
import { tellingFor, stageOf, LID_TILE, LID_REMARK, GIFT, GIFT_TOAST } from './sampo.js'
import { linesFor } from './lines.js'
import { moodOf } from './runtime.js'

export const TELL_REACH = 5   // tiles (Chebyshev) the player may stand from a teller

const runOf = state => state.cityRun ?? state.cave?.surface?.cityRun ?? null
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

export function startTelling(state, e, world) {
  if (!world?.sampo || !e || e.hostile) return false
  if (state.telling?.id === e.id) return true
  const run = runOf(state)
  if (run && run.crime.level !== 'calm') return false
  const t = tellingFor(e.id, world)
  if (!t) return false
  state.telling = { id: e.id, lines: t.lines, sets: t.sets, i: -1, t: 0, dur: 0 }
  return true
}

export function tickSampo(state, world, delta, hooks) {
  if (!world?.sampo) return
  tell(state, world, delta, hooks)
  lid(state, world, hooks)
  gift(state, world, hooks)
}

// ---- the tellings ---------------------------------------------------------------------

function setFlag(state, world, flag, hooks) {
  world.sampo.flags[flag] = true
  const run = runOf(state)
  if (run) run.quest = stageOf(world)
  relineIndoors(state, world, run)
  hooks.persist?.()
}

// the named under this roof (every floor of a building) say what the new stage has them say
function relineIndoors(state, world, run) {
  const cave = state.cave
  if (!cave || !run) return
  const mood = { ...moodOf(run), quest: stageOf(world) }
  const lists = [state.entities]
  if (cave.building) for (const [id, f] of cave.building.floors) if (id !== cave.building.at) lists.push(f.entities)
  for (const list of lists) for (const e of list) {
    if (e.type !== 'npc' || typeof e.id !== 'string' || !e.id.startsWith('named:')) continue
    const person = run.people.get(e.id)?.person
    if (person) e.lines = linesFor(person, mood)
  }
}

function stop(state, tl) {
  const b = state.feedback?.bubble
  if (b && b.anchorId === tl.id && tl.lines.includes(b.text)) state.feedback.bubble = null
  state.telling = null
}

function tell(state, world, delta, hooks) {
  const tl = state.telling
  if (!tl) return
  const e = state.entities.find(x => x.id === tl.id && x.type === 'npc')
  if (!e || e.hostile || !(e.hp > 0) || cheb(e, state.player) > TELL_REACH) { stop(state, tl); return }
  tl.t += delta
  if (tl.i >= 0 && tl.t < tl.dur) return
  tl.i += 1
  if (tl.i >= tl.lines.length) { state.telling = null; return }
  const text = tl.lines[tl.i]
  tl.t = 0
  tl.dur = sayDuration(text)
  speakFrom(state, e, text, tl.dur)
  // they turn to the player and stay for the line
  e.facing = state.player.px < e.px ? 'west' : 'east'
  if (e.ai) { e.ai.wanderPt = null; e.ai.dwell = Math.max(e.ai.dwell ?? 0, tl.dur + 0.5) }
  if (tl.i === tl.lines.length - 1) setFlag(state, world, tl.sets, hooks)
}

// ---- the lid --------------------------------------------------------------------------

// Where the lid stands on a floor (the keep's great hall), found once a map.
const LIDS = new WeakMap()
function lidOn(map) {
  let at = LIDS.get(map)
  if (at !== undefined) return at
  at = null
  for (let y = 0; y < map.length && !at; y++) for (let x = 0; x < map[y].length; x++) if (map[y][x]?.overlay === LID_TILE) { at = { x, y }; break }
  LIDS.set(map, at)
  return at
}

// Once the Count has said to look: standing square beside the lid (a step
// aside from the throne, not just before it) the player sees the mark.
function lid(state, world, hooks) {
  const f = world.sampo.flags
  if (!f.heard || f.mark || !state.cave?.building || state.telling || state.feedback?.bubble) return
  const at = lidOn(state.map)
  if (!at || Math.abs(at.x - state.player.x) + Math.abs(at.y - state.player.y) !== 1) return
  think(state, LID_REMARK, sayDuration(LID_REMARK))
  setFlag(state, world, 'mark', hooks)
}

// ---- the smith's gift -----------------------------------------------------------------

// When Seppo has said his last: a sword on the ground beside the player (the
// nearest free cell), and the three places on a toast.
function gift(state, world, hooks) {
  const f = world.sampo.flags
  if (!f.smith || f.gift || state.telling) return
  const { player, map } = state
  const taken = new Set(state.entities.map(e => `${e.x},${e.y}`))
  let spot = null
  for (let r = 1; r <= 3 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = player.x + dx, y = player.y + dy, cell = map[y]?.[x]
    if (cell && isWalkable(cell.tile, cell) && !taken.has(`${x},${y}`)) { spot = { x, y }; break }
  }
  if (!spot) return   // hemmed in: the next frame with room
  state.entities.push(...hooks.spawn([{ kind: 'floating_pickup', contents: { type: 'weapon', ...weaponContents(GIFT) }, ...spot }]))
  f.gift = true
  queueToast(state, GIFT_TOAST)
  hooks.persist?.()
}
