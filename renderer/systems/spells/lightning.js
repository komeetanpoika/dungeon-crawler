// Call Lightning — the one bespoke spell. The Storm Wand marks tiles ahead
// of the caster; a beat later the sky answers. Two things the shared spell
// primitives cannot do earn it its own module: the strike lights the whole
// weather layer for an instant, and it conducts through open water, so a
// bolt into the lake hits everything swimming in that body.
//
// Pure logic — no canvas, no game.js. game.js owns the wiring: it injects
// `castLightning` into the spell dispatcher (systems/spells.js never imports
// this file), calls `tickLightning` every frame with a `hurt` hook, decays
// `state.flash`, and canvas.js draws `state.lightning` / `state.strikes`.
import { isWalkable } from '../entities.js'
import { isStoryCreature } from '../monsters.js'
import { sfx } from '../sfx.js'
import { LOS_CLEAR_PREFIXES } from '../openmap.js'

const TILE_SIZE = 32

export const LIGHTNING = {
  delay: 0.6,        // seconds between the mark and the strike — time to step out
  damage: 5,
  stun: 1.0,
  flash: 0.12,       // seconds of the white full-screen flash
  lit: 0.25,         // seconds the weather layer is lit as day
  waterCap: 400,     // flood-fill ceiling, so a whole sea is never walked
  // Tiles ahead of the caster, per charge tier. Over drops three marks on
  // one line — same delay, so they land as a single sheet of lightning.
  dists: { tap: [3], full: [6], over: [4, 6, 8] },
}

// How long a strike stays in state.strikes for the renderer's bolt and lit
// 3×3. Not a tuning knob of the spell itself — purely how long the flash of
// geometry hangs around.
export const STRIKE_LIFE = 0.15

const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

const cellAt = (map, x, y) => map?.[y]?.[x] ?? null
const key = (x, y) => `${x},${y}`
// px/py is the live position; x/y is the tile the entity last settled on.
const tileOf = e => Number.isFinite(e.px)
  ? { x: Math.floor(e.px / TILE_SIZE), y: Math.floor(e.py / TILE_SIZE) }
  : { x: e.x, y: e.y }

// Water by ground art, the same palette test openmap.js uses for losClear.
// The pier is included for free: buildOpenMap keeps the water skin under the
// `ow_pier_log` prop, so a bolt onto the planks conducts into the lake —
// which is the point of standing out there with a storm wand.
export function isWaterCell(cell) {
  const skin = String(cell?.skin ?? '')
  return LOS_CLEAR_PREFIXES.some(p => skin.startsWith(p))
}

// The body of water joined to (x, y), 4-neighbour, capped at `cap` cells.
// Empty when the start is not water, so callers can flood unconditionally.
export function connectedWater(map, x, y, cap = LIGHTNING.waterCap) {
  const seen = new Set()
  if (!isWaterCell(cellAt(map, x, y))) return seen
  seen.add(key(x, y))
  const queue = [{ x, y }]
  while (queue.length && seen.size < cap) {
    const c = queue.shift()
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = c.x + dx, ny = c.y + dy
      const k = key(nx, ny)
      if (seen.has(k) || !isWaterCell(cellAt(map, nx, ny))) continue
      seen.add(k)
      if (seen.size >= cap) break
      queue.push({ x: nx, y: ny })
    }
  }
  return seen
}

const tileCentre = ({ x, y }) => ({ px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 })

// The last walkable cell up to `dist` tiles along the step, or null if the
// very first cell is already blocked. Walls stop the sky as surely as they
// stop an arrow — a mark never lands inside stone or off the map.
function clampAlong(map, x0, y0, [dx, dy], dist) {
  let last = null
  for (let i = 1; i <= dist; i++) {
    const x = x0 + dx * i, y = y0 + dy * i
    const cell = cellAt(map, x, y)
    if (!cell || !isWalkable(cell.tile, cell)) break
    last = { x, y }
  }
  return last
}

// Place this tier's marks ahead of the player. Duplicates are collapsed:
// three over-tier distances that all clamp against the same wall are one
// strike, not triple damage on one tile. Returns the marks it added.
export function castLightning(state, tier = 'tap') {
  const p = state.player
  const step = DIRS[p.facing] ?? DIRS.east
  const from = tileOf(p)
  const marks = []
  const taken = new Set()
  for (const dist of LIGHTNING.dists[tier] ?? LIGHTNING.dists.tap) {
    const hit = clampAlong(state.map, from.x, from.y, step, dist)
    if (!hit || taken.has(key(hit.x, hit.y))) continue
    taken.add(key(hit.x, hit.y))
    marks.push({ x: hit.x, y: hit.y, t: 0, delay: LIGHTNING.delay, struck: false })
    sfx(state, 'crackle', tileCentre(hit))
  }
  state.lightning = [...(state.lightning ?? []), ...marks]
  return { marks }
}

// Who the sky can hit. The player is never caught in their own storm, the
// Echo is a ghost, and villagers are left out of an area effect the way the
// gust leaves them out — nothing here should turn a rescue into a massacre.
const isTarget = e => e && e.type !== 'player' && e.type !== 'echo' && e.type !== 'npc'
  && Number.isFinite(e.hp) && e.hp > 0

// Bosses shrug the stun off (as they do the gust's), and a story creature
// runs its own state machine — a stunTimer on the Näkki would freeze a
// scripted beat. Both still take the hook's damage.
const stunnable = e => !e.isBoss && e.type !== 'dragon_boss' && !isStoryCreature(e)

// One mark's strike. Damage lands on the 3×3 around it, plus — when the mark
// itself is water — on everything in that whole body of water, story
// creatures included: `hooks.hurt` runs through hurtCreature, which is where
// a creature decides what a lightning source does to it (the Näkki's one
// real vulnerability). Returns the number of things hit.
function strike(state, mark, hooks) {
  const water = connectedWater(state.map, mark.x, mark.y, LIGHTNING.waterCap)
  let hit = 0
  for (const e of state.entities ?? []) {
    if (!isTarget(e)) continue
    const t = tileOf(e)
    const inBlast = Math.abs(t.x - mark.x) <= 1 && Math.abs(t.y - mark.y) <= 1
    // Story creatures are spared the plain 3×3 the way the gust spares them;
    // the water is the deliberate exception the spec carves out.
    const caught = (inBlast && !isStoryCreature(e)) || water.has(key(t.x, t.y))
    if (!caught) continue
    hit++
    hooks?.hurt?.(e, LIGHTNING.damage, { source: 'lightning' })
    if (stunnable(e)) e.stunTimer = Math.max(e.stunTimer ?? 0, LIGHTNING.stun)
  }
  state.flash = LIGHTNING.flash
  // The whole map reads as daylight for the quarter-second (weatherLook
  // returns dark 0 while this runs); harmless on a map without weather.
  if (state.weather) state.weather.lightningT = LIGHTNING.lit
  state.strikes = [...(state.strikes ?? []), { x: mark.x, y: mark.y, t: 0 }]
  sfx(state, 'thunder', tileCentre(mark))
  return hit
}

// Per-frame: age the marks, fire the ones that have waited out their delay,
// and age the strike records the renderer draws from. The lightning light on
// the weather layer counts down here too — weather.js is pure look-building
// with no tick of its own, and this is the system that lit it.
export function tickLightning(state, delta, hooks = {}) {
  const w = state.weather
  if (w?.lightningT > 0) w.lightningT = Math.max(0, w.lightningT - delta)

  if (state.strikes?.length) {
    for (const s of state.strikes) s.t += delta
    state.strikes = state.strikes.filter(s => s.t < STRIKE_LIFE)
  }

  let struck = 0
  if (state.lightning?.length) {
    const pending = []
    for (const m of state.lightning) {
      m.t += delta
      if (m.t < (m.delay ?? LIGHTNING.delay)) { pending.push(m); continue }
      m.struck = true          // spent: it becomes a strike record this frame
      struck += strike(state, m, hooks)
    }
    state.lightning = pending
  }
  return { struck }
}
