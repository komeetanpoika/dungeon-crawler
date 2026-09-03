// The Maahinen — a burrowing 2x2 melee brute (leap-2, docs/superpowers/
// specs/2026-08-29-leap-episodes-design.md §3.2). It
// glides underground toward the player invisible and invulnerable, erupts
// with a telegraphed dust ring, fights on the surface with the enemy brain
// and a maul, then dives back under at half and quarter HP to resurface a
// few tiles from the player. Pure — no browser/Electron imports.

import { isWalkable } from '../entities.js'
import { tryStartEnemyAttack } from '../enemy-attack.js'
import { updateBrain } from '../brain.js'
import { act } from '../act.js'
import { sfx } from '../sfx.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA } from '../creatures.js'
import { stepFade } from '../fade.js'

const S = 32

export const BURROW_SPEED = 60
export const ERUPT_DIST = 48
export const ERUPT_TIME = 0.6
export const RESURFACE_DELAY = 2
// How far the player may stray from the Maahinen's lair before it loses
// interest: past this it burrows home instead of hunting, and never erupts.
// Without it the burrower ignores walls and follows the player across the
// whole map, erupting on the village.
export const LEASH_TILES = 24
export const SUBMERGE_TIME = 0.4
// How long the final rise from submerged to surfaced takes, once erupting's
// timer counts down into its last stretch — drives e.sink back to 0.
const RISE_TIME = 0.3

// Lazy init: a registry spawn arrives with only type/x/y/px/py/hp, so the
// first touch stamps the burrower state on it. Idempotent — the `burrow`
// flag is the "already stamped" marker. A real spawn never carries a
// `state`, so it stamps in submerged and invisible as before; a caller that
// already declared a state (e.g. a synthetic already-surfaced entity in a
// unit test) has that respected, fully visible, rather than clobbered back
// to submerged on its first hit.
export function ensureMaahinen(e) {
  if (e.burrow) return e
  const surfaced = e.state != null && e.state !== 'submerged'
  Object.assign(e, {
    burrow: true, state: e.state ?? 'submerged', timer: 0, weaponId: 'maul',
    damageCooldown: 0, inCombat: false, facing: 'east', home: { x: e.x, y: e.y },
    hp: e.hp ?? 36, maxHp: e.maxHp ?? 36,
    // Spawns submerged and invisible: fully sunk, fully faded — unless
    // already declared otherwise.
    sink: surfaced ? 0 : 1, fadeA: surfaced ? 1 : 0,
  })
  return e
}

export function makeMaahinen(x, y) {
  return ensureMaahinen({ type: 'maahinen', x, y, px: x * S + S / 2, py: y * S + S / 2 })
}

// Deterministic ring search around (cx, cy) in tile coords: nearest ring
// first, row-major within a ring, first walkable tile wins. `minR`/`maxR`
// bound the Chebyshev radius searched (inclusive).
function ringSearch(map, cx, cy, minR, maxR, exclude = null) {
  for (let r = minR; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const tx = cx + dx, ty = cy + dy
        if (exclude && tx === exclude.x && ty === exclude.y) continue
        const cell = map[ty]?.[tx]
        if (cell && isWalkable(cell.tile, cell)) return { x: tx, y: ty }
      }
    }
  }
  return null
}

// True while the player is farther than LEASH_TILES (Chebyshev, in px) from
// the Maahinen's home — the same tile-radius idiom the rest of the episode
// uses.
function outsideLeash(e, player) {
  const home = e.home ?? { x: e.x, y: e.y }
  const hx = home.x * S + S / 2, hy = home.y * S + S / 2
  return Math.max(Math.abs(player.px - hx), Math.abs(player.py - hy)) > LEASH_TILES * S
}

function submergedTick(e, state, delta) {
  const { player, map } = state
  e.timer = Math.max(0, e.timer - delta)

  // Outside the leash it burrows back to its lair and stays down; inside, it
  // hunts the player as before.
  const leashed = outsideLeash(e, player)
  const home = e.home ?? { x: e.x, y: e.y }
  const tx = leashed ? home.x * S + S / 2 : player.px
  const ty = leashed ? home.y * S + S / 2 : player.py

  const dx = tx - e.px, dy = ty - e.py
  const dist = Math.hypot(dx, dy)
  if (dist > 1e-6) {
    const step = Math.min(dist, BURROW_SPEED * delta)
    e.px += (dx / dist) * step
    e.py += (dy / dist) * step
    e.x = Math.floor(e.px / S)
    e.y = Math.floor(e.py / S)
  }
  if (leashed) return

  const newDist = Math.hypot(player.px - e.px, player.py - e.py)
  if (newDist <= ERUPT_DIST && e.timer <= 0) {
    const tile = ringSearch(map, e.x, e.y, 0, 20, { x: player.x, y: player.y }) ?? { x: e.x, y: e.y }
    e.x = tile.x; e.y = tile.y
    e.px = tile.x * S + S / 2; e.py = tile.y * S + S / 2
    e.state = 'erupting'
    e.timer = ERUPT_TIME
    sfx(state, 'erupt', { px: e.px, py: e.py })
  }
}

function eruptingTick(e, delta) {
  e.timer = Math.max(0, e.timer - delta)
  e.sink = Math.min(1, e.timer / RISE_TIME)
  if (e.timer <= 0) { e.state = 'surfaced'; e.sink = 0 }
}

function surfacedTick(e, state, delta) {
  e.damageCooldown = Math.max(0, (e.damageCooldown ?? 0) - delta)
  const prevPx = e.px
  act(e, state, delta, updateBrain(e, state, delta))
  if (Math.abs(e.px - prevPx) > 0.1) e.facing = e.px - prevPx > 0 ? 'east' : 'west'
  tryStartEnemyAttack(e, state)

  if (!e.dived && e.hp <= e.maxHp / 2) {
    dive(e); e.dived = true
  } else if (e.dived && !e.dived2 && e.hp <= e.maxHp / 4) {
    dive(e); e.dived2 = true
  }
}

function submergingTick(e, state, delta) {
  const { player, map } = state
  e.timer = Math.max(0, e.timer - delta)
  e.sink = 1 - e.timer / SUBMERGE_TIME
  if (e.timer <= 0) {
    const tile = ringSearch(map, player.x, player.y, 4, 6)
    if (tile) {
      e.x = tile.x; e.y = tile.y
      e.px = tile.x * S + S / 2; e.py = tile.y * S + S / 2
    }
    e.state = 'submerged'
    e.sink = 1
    e.timer = RESURFACE_DELAY
  }
}

export function updateMaahinen(e, state, delta) {
  ensureMaahinen(e)
  if (e.state === 'submerged') submergedTick(e, state, delta)
  else if (e.state === 'erupting') eruptingTick(e, delta)
  else if (e.state === 'surfaced') surfacedTick(e, state, delta)
  else if (e.state === 'submerging') submergingTick(e, state, delta)
  stepFade(e, e.state === 'submerged' ? 0 : 1, delta, { inTime: 0.1, outTime: 0.25 })
}

CREATURE_UPDATE.maahinen = updateMaahinen

// Diving out of a fight: shared by a wound-triggered dive (surfacedTick's HP
// thresholds) and a player-hit-triggered dive (CREATURE_HIT below). Clears
// any pending swing so no attack sprite plays over an invisible body.
// Continues from the current sink (rather than resetting to 0) so a dive
// forced mid-eruption doesn't pop the sink value back up for a frame before
// re-shrinking; a normal `surfaced` dive has sink 0, so that case is
// unaffected. Also marks any HP threshold already crossed, so a forced dive
// that happens to cross a dive threshold doesn't leave surfacedTick's own
// threshold check to fire again right after resurfacing.
const dive = e => {
  e.state = 'submerging'
  e.timer = SUBMERGE_TIME * (1 - Math.max(0, Math.min(1, e.sink ?? 0)))
  e.attack = null
  if (e.hp <= e.maxHp / 2) e.dived = true
  if (e.hp <= e.maxHp / 4) e.dived2 = true
}

CREATURE_HIT.maahinen = (e, state, dmg, { source = 'player' } = {}) => {
  ensureMaahinen(e)
  if (e.state === 'submerged' || e.state === 'submerging') {
    return { entity: { ...e }, absorbed: true, cue: null }
  }
  const entity = { ...e, hp: e.hp - dmg, inCombat: true }
  // A player blow forces an immediate dive (unless it's the kill) — a wolf
  // bite just wounds it and leaves it fighting.
  if (source === 'player' && entity.hp > 0) {
    dive(entity)
    return { entity, absorbed: false, cue: 'melee-hit', think: 'It just dives.' }
  }
  return { entity, absorbed: false, cue: 'melee-hit' }
}
CREATURE_ALPHA.maahinen = e => e.fadeA ?? 1
