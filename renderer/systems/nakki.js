// The Näkki — a stationary, unkillable water creature that waits beside the
// leap-1 pier (systems.md §3.1). It never has hp/maxHp: any hit just sinks
// it. Surfaced, standing on its pier-end POI drags the player toward the
// water on a timer; feeding it cooked meat (not raw) sinks it for good.
// Pure — no browser/Electron imports.

import { damagePlayer } from './player-damage.js'
import { sfx } from './sfx.js'
import { startKnockback } from './knockback.js'
import { removeItem } from './inventory.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_MAKE, CREATURE_ALPHA } from './creatures.js'

const S = 32
const DRAG_DISTANCE = 24

export const SUBMERGE_TIME = 4
export const DRAG_INTERVAL = 2

export function makeNakki(x, y) {
  return {
    type: 'nakki', x, y, px: x * S + 16, py: y * S + 16,
    state: 'surfaced', timer: 0, dragCooldown: 0, pierEnd: null,
  }
}

export function sinkNakki(e) {
  e.state = 'submerged'
  e.timer = SUBMERGE_TIME
}

export function updateNakki(e, state, delta) {
  const { player } = state

  if (e.state === 'submerged') {
    e.timer = Math.max(0, e.timer - delta)
    if (e.timer <= 0) e.state = 'surfaced'
    return
  }

  if (!e.pierEnd || player.x !== e.pierEnd.x || player.y !== e.pierEnd.y) return

  e.dragCooldown -= delta
  if (e.dragCooldown <= 0) {
    if (damagePlayer(state, 1, 'hit', 'The lake pulls at you!')) {
      sfx(state, 'drag', { px: player.px, py: player.py })
      startKnockback(player, player.px - e.px, player.py - e.py, DRAG_DISTANCE)
    }
    e.dragCooldown = DRAG_INTERVAL
  }
}

export function feedNakki(e, player) {
  if (e.state !== 'surfaced') return false
  const idx = player.inventory.findIndex(i => i.kind === 'cooked_meat')
  if (idx === -1) return false
  removeItem(player, idx)
  sinkNakki(e)
  return true
}

CREATURE_MAKE.nakki = makeNakki
CREATURE_UPDATE.nakki = updateNakki
CREATURE_HIT.nakki = (e) => {
  const entity = { ...e }
  sinkNakki(entity)
  return { entity, absorbed: true, cue: 'drag' }
}
CREATURE_ALPHA.nakki = e => e.state === 'surfaced' ? 1 : 0
