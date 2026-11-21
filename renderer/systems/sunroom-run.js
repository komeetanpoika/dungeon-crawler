// Playing Päivölä's mirrors (renderer/interior/sunroom.js lays the puzzle in
// the house's cells). Walking into a mirror turns it — once per push, not once
// per frame — and so does the interact key facing one. When the beam reaches
// the seed the hall is solved: solveSun opens the alcove and the caller
// (game.js) puts the reward in it and remembers the house solved.
import { traceBeam, findSun, solveSun } from '../interior/sunroom.js'
import { MISC } from '../interior/kit.js'
import { GLASSMAKER } from '../interior/versions.js'
import { markTileDirty } from './tile-dirty.js'
import { TILE_SIZE as S, PLAYER_HALF as HALF } from './movement.js'

// How close the player's edge must be to a mirror's cell for a push to count:
// walking stops a step (about 2 px a frame) short of a solid cell.
const TOUCH = 4
const FACING = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

// intent: { vx, vy } the way the player is pushing this frame, interact: the
// interact key was pressed. Returns null, 'turned' or 'solved'. Caches the
// puzzle on state.cave.sun (null for a house without one), with `beam` kept
// current for drawing.
export function tickSunroom(state, { vx = 0, vy = 0, interact = false } = {}) {
  const cave = state.cave
  if (!cave) return null
  if (cave.sun === undefined) {
    cave.sun = findSun(state.map)
    if (cave.sun) { cave.sun.beam = traceBeam(state.map, cave.sun.start); cave.sun.solved = !!cave.sun.beam.hit }
  }
  const sun = cave.sun
  if (!sun) return null
  const { map, player: p } = state
  const isMirror = at => !!(at && map[at[1]]?.[at[0]]?.mirror)
  let at = null
  if (vx > 0 && p.px + HALF >= (p.x + 1) * S - TOUCH) at = [p.x + 1, p.y]
  else if (vx < 0 && p.px - HALF <= p.x * S + TOUCH) at = [p.x - 1, p.y]
  if (!isMirror(at)) at = null
  if (!at && vy > 0 && p.py + HALF >= (p.y + 1) * S - TOUCH) at = [p.x, p.y + 1]
  else if (!at && vy < 0 && p.py - HALF <= p.y * S + TOUCH) at = [p.x, p.y - 1]
  if (!isMirror(at)) at = null
  if (!at && interact) { const f = FACING[p.facing] ?? [0, 1]; at = [p.x + f[0], p.y + f[1]]; if (!isMirror(at)) at = null }
  if (!at) { sun.latch = null; return null }
  const k = `${at[0]},${at[1]}`
  if (sun.latch === k && !interact) return null
  sun.latch = k
  if (sun.solved) return null   // a lit hall keeps its mirrors as they are
  const c = map[at[1]][at[0]]
  c.mirror = c.mirror === '/' ? '\\' : '/'
  c.overlay = MISC.mirror[c.mirror]
  markTileDirty(map, at[0], at[1])
  sun.beam = traceBeam(map, sun.start)
  if (!sun.beam.hit) return 'turned'
  sun.solved = true
  for (const ch of solveSun(map, sun)) markTileDirty(map, ch.x, ch.y)
  sun.beam = traceBeam(map, sun.start)
  for (const e of state.entities ?? []) if (e.role === 'glassmaker') e.lines = GLASSMAKER.solved
  return 'solved'
}
