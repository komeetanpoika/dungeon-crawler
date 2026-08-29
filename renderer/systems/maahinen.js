// The Maahinen — a burrowing 2x2 melee brute (leap-2, systems.md §3.2). It
// glides underground toward the player invisible and invulnerable, erupts
// with a telegraphed dust ring, fights on the surface with the enemy brain
// and a maul, then dives back under at half and quarter HP to resurface a
// few tiles from the player. Pure — no browser/Electron imports.

import { isWalkable } from './entities.js'
import { tryStartEnemyAttack } from './enemy-attack.js'
import { updateBrain } from './brain.js'
import { act } from './act.js'
import { sfx } from './sfx.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_MAKE, CREATURE_ALPHA } from './creatures.js'

const S = 32

export const BURROW_SPEED = 60
export const ERUPT_DIST = 48
export const ERUPT_TIME = 0.6
export const RESURFACE_DELAY = 2
export const SUBMERGE_TIME = 0.4

export function makeMaahinen(x, y) {
  return {
    type: 'maahinen', x, y, px: x * S + S / 2, py: y * S + S / 2,
    hp: 24, maxHp: 24, state: 'submerged', timer: 0,
    weaponId: 'maul', damageCooldown: 0, inCombat: false,
    aiHalf: 28, facing: 'east', home: { x, y },
  }
}

// Deterministic ring search around (cx, cy) in tile coords: nearest ring
// first, row-major within a ring, first walkable tile wins. `minR`/`maxR`
// bound the Chebyshev radius searched (inclusive).
function ringSearch(map, cx, cy, minR, maxR) {
  for (let r = minR; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const tx = cx + dx, ty = cy + dy
        const cell = map[ty]?.[tx]
        if (cell && isWalkable(cell.tile, cell)) return { x: tx, y: ty }
      }
    }
  }
  return null
}

function submergedTick(e, state, delta) {
  const { player, map } = state
  e.timer = Math.max(0, e.timer - delta)

  const dx = player.px - e.px, dy = player.py - e.py
  const dist = Math.hypot(dx, dy)
  if (dist > 1e-6) {
    const step = Math.min(dist, BURROW_SPEED * delta)
    e.px += (dx / dist) * step
    e.py += (dy / dist) * step
    e.x = Math.floor(e.px / S)
    e.y = Math.floor(e.py / S)
  }

  const newDist = Math.hypot(player.px - e.px, player.py - e.py)
  if (newDist <= ERUPT_DIST && e.timer <= 0) {
    const tile = ringSearch(map, e.x, e.y, 0, 20) ?? { x: e.x, y: e.y }
    e.x = tile.x; e.y = tile.y
    e.px = tile.x * S + S / 2; e.py = tile.y * S + S / 2
    e.state = 'erupting'
    e.timer = ERUPT_TIME
    sfx(state, 'erupt', { px: e.px, py: e.py })
  }
}

function eruptingTick(e, delta) {
  e.timer = Math.max(0, e.timer - delta)
  if (e.timer <= 0) e.state = 'surfaced'
}

function surfacedTick(e, state, delta) {
  const prevPx = e.px
  act(e, state, delta, updateBrain(e, state, delta))
  if (Math.abs(e.px - prevPx) > 0.1) e.facing = e.px - prevPx > 0 ? 'east' : 'west'
  tryStartEnemyAttack(e, state)

  if (!e.dived && e.hp <= e.maxHp / 2) {
    e.state = 'submerging'; e.timer = SUBMERGE_TIME; e.dived = true
  } else if (e.dived && !e.dived2 && e.hp <= e.maxHp / 4) {
    e.state = 'submerging'; e.timer = SUBMERGE_TIME; e.dived2 = true
  }
}

function submergingTick(e, state, delta) {
  const { player, map } = state
  e.timer = Math.max(0, e.timer - delta)
  if (e.timer <= 0) {
    const tile = ringSearch(map, player.x, player.y, 4, 6)
    if (tile) {
      e.x = tile.x; e.y = tile.y
      e.px = tile.x * S + S / 2; e.py = tile.y * S + S / 2
    }
    e.state = 'submerged'
    e.timer = RESURFACE_DELAY
  }
}

export function updateMaahinen(e, state, delta) {
  if (e.state === 'submerged') return submergedTick(e, state, delta)
  if (e.state === 'erupting') return eruptingTick(e, delta)
  if (e.state === 'surfaced') return surfacedTick(e, state, delta)
  if (e.state === 'submerging') return submergingTick(e, state, delta)
}

CREATURE_MAKE.maahinen = makeMaahinen
CREATURE_UPDATE.maahinen = updateMaahinen
CREATURE_HIT.maahinen = (e, state, dmg) => {
  if (e.state === 'submerged' || e.state === 'submerging') {
    return { entity: { ...e }, absorbed: true, cue: null }
  }
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}
CREATURE_ALPHA.maahinen = e => e.state === 'submerged' ? 0 : e.state === 'submerging' ? 0.4 : 1
