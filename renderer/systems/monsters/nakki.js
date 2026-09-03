// The Näkki — a stationary, unkillable water creature that waits beside the
// leap-1 pier (docs/superpowers/specs/2026-08-29-leap-episodes-design.md §3.1). It never has hp/maxHp: any hit just sinks
// it. Surfaced, standing on its pier-end POI drags the player toward the
// water on a timer; feeding it cooked meat (not raw) sinks it for good.
// Pure — no browser/Electron imports.

import { damagePlayer } from '../player-damage.js'
import { sfx } from '../sfx.js'
import { startKnockback } from '../knockback.js'
import { removeItem } from '../inventory.js'
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA } from '../creatures.js'

const S = 32
const DRAG_DISTANCE = 24

export const SUBMERGE_TIME = 4
export const DRAG_INTERVAL = 2

// makeMonsterFromDef gives every registry monster hp/maxHp; the Näkki has
// neither (it never dies, and no hp bar must ever show), so the first
// touch strips them and stamps the lurker state. Idempotent.
export function ensureNakki(e) {
  if (e.lurk) return e
  delete e.hp; delete e.maxHp
  Object.assign(e, { lurk: true, state: 'surfaced', timer: 0, dragCooldown: 0, pierEnd: e.pierEnd ?? null })
  return e
}

export function makeNakki(x, y) {
  return ensureNakki({ type: 'nakki', x, y, px: x * S + 16, py: y * S + 16 })
}

export function sinkNakki(e) {
  e.state = 'submerged'
  e.timer = SUBMERGE_TIME
}

export function updateNakki(e, state, delta) {
  ensureNakki(e)
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

CREATURE_UPDATE.nakki = updateNakki
CREATURE_HIT.nakki = (e) => {
  const entity = { ...ensureNakki(e) }
  sinkNakki(entity)
  return { entity, absorbed: true, cue: 'drag' }
}
CREATURE_ALPHA.nakki = e => e.state === 'surfaced' ? 1 : 0
