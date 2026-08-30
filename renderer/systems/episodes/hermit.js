// The Hermit's Fire — marsh-3-hermit episode (docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.3). Pure — no browser/Electron
// imports; game.js wires onArrive/tick through the epCtx.
import { poiCell } from '../leap.js'
import { makeCampfire } from '../campfire.js'
import { isWalkable } from '../entities.js'
import { sfx } from '../sfx.js'
import { think } from '../feedback.js'

const S = 32
export const SAMMUNUT_MIN_DIST = 20
const HEARTH_LABELS = ['hearth 1', 'hearth 2', 'hearth 3']

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

// The first interior walkable cell at least SAMMUNUT_MIN_DIST tiles
// (Chebyshev) from the player, scanning row-major from the map's far corner
// (bottom-right) inward — deterministic, no RNG involved.
export function sammunutSpot(map, player) {
  const h = map.length, w = map[0]?.length ?? 0
  for (let y = h - 2; y >= 1; y--) {
    for (let x = w - 2; x >= 1; x--) {
      if (cheb(x, y, player.x, player.y) < SAMMUNUT_MIN_DIST) continue
      const cell = map[y][x]
      if (isWalkable(cell.tile, cell)) return { x, y }
    }
  }
  return null
}

// Switches the three cold hearth props to lit — called once the wraith is
// dead, and re-derived on every later arrival while wraith_dead holds (the
// map is rebuilt from scratch on a cave dive/return or a fresh load).
export function lightHearths(map, mapData) {
  for (const label of HEARTH_LABELS) {
    const spot = poiCell(mapData, label)
    const cell = spot && map[spot.y]?.[spot.x]
    if (cell) cell.overlay = 'prop_hearth_lit'
  }
}

// A campfire entity within Chebyshev 1 of the hearth cell, or null.
export function hearthFireAt(entities, hearth) {
  if (!hearth) return null
  return entities.find(e => e.type === 'campfire' && cheb(e.x, e.y, hearth.x, hearth.y) <= 1) ?? null
}

function spawnWraith(ctx) {
  const { state, flags } = ctx
  const spot = sammunutSpot(state.map, state.player)
  if (!spot) { console.warn(`hermit: no spot ${SAMMUNUT_MIN_DIST}+ tiles from the player — the Sammunut cannot spawn`); return }
  ctx.spawn([{ kind: 'creature', creature: 'sammunut', x: spot.x, y: spot.y }])
  if (!flags.sammunut_spawned) { ctx.set('sammunut_spawned'); ctx.persist() }
}

// Fires are not saved: a hearth already lit re-derives its eternal campfire
// from the flag alone, unless one is already burning there (a second
// onArrive on the same session, or an arrival that hasn't rebuilt entities).
function relightHearth(ctx) {
  const { state, mapData, flags } = ctx
  if (!flags.hearth_lit) return
  const hearth = poiCell(mapData, 'hearth')
  if (!hearth) return
  const existing = hearthFireAt(state.entities, hearth)
  if (existing?.eternal) return
  state.entities.push(makeCampfire(hearth.x, hearth.y, { eternal: true }))
}

// Arrival — a fresh load or a waystone journey; a cave dive stashes the
// surface state whole and never re-runs this.
export function onArrive(ctx) {
  const { state, mapData, flags, episode } = ctx
  if (flags.wraith_dead) {
    lightHearths(state.map, mapData)
    state.villagerLines = episode.resolvedLines
    return
  }
  spawnWraith(ctx)
  relightHearth(ctx)
}

function tickHearth(ctx) {
  const { state, mapData, flags } = ctx
  if (flags.hearth_lit) return
  const hearth = poiCell(mapData, 'hearth')
  const fire = hearth && hearthFireAt(state.entities, hearth)
  if (!fire) return
  ctx.set('hearth_lit')
  fire.eternal = true
  const occupied = state.entities.some(e => e !== fire && e.x === hearth.x && e.y === hearth.y)
  if (!occupied) {
    fire.x = hearth.x
    fire.y = hearth.y
    fire.px = hearth.x * S + S / 2
    fire.py = hearth.y * S + S / 2
  }
  sfx(state, 'campfire-light', { px: fire.px, py: fire.py })
  think(state, 'His wood. It holds.')
  ctx.persist()
}

// Death is the explicit kill game.js records on state.creatureKills, never
// the creature's absence: a Sammunut that failed to find a spawn spot, or
// one not yet spawned, must not resolve the episode for free.
function tickWraith(ctx) {
  const { state, mapData, flags } = ctx
  if (!flags.sammunut_spawned || flags.wraith_dead) return
  if (!state.creatureKills?.sammunut) return
  ctx.set('wraith_dead')
  lightHearths(state.map, mapData)
  ctx.persist()
  ctx.resolve()
}

// delta is unused here — the Sammunut's own drift/touch timers run off the
// main creature-update loop (updateCreature), not this tick.
export function tick(ctx, delta) {
  tickHearth(ctx)
  tickWraith(ctx)
}
