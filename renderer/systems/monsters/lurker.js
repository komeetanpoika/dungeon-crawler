// The lurkers of the Sampo's story (wilds/city/sampo-places.js): creatures of
// the water that cannot be reached until they rise. Iku-Turso (the sea
// piece) hunts whoever walks his pier: he rises beside them, bites, and can
// be struck while he is up. The great pike (the marsh piece) rises only for
// meat held out at the pier's end, takes it, and goes down at the first blow.
// Both ride the serpent rig (pose.sink plays the dive). Pure: no browser imports.
//
//   e.lurk       { state: 'under' | 'rising' | 'up' | 'sinking', t, taken, biteT }
//   e.lurkSpots  [{ x, y }] water cells it may rise at (window tiles; the place's runner keeps them)
//   e.lurkPier   { x, y } the pier's end (the pike's feeding place)
import { CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA } from '../creatures.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { removeItem } from '../inventory.js'
import { stepFade } from '../fade.js'
import { sfx } from '../sfx.js'
import { addFloat } from '../feedback.js'

const S = 32
export const SINK_TIME = 0.6
export const LURKERS = {
  // rise/up/down: seconds rising, up and under; wake: tiles (Chebyshev) from a
  // lair cell at which he comes; reach: tiles his bite carries (two steps
  // back along the planks is out of it); biteAfter: seconds up before the
  // first bite (time to step back or raise a shield); diveAt: what he takes
  // in one rising before he goes down again
  ikuturso: { rise: 0.7, up: 3.2, down: 2.2, wake: 2, reach: 1.8, bite: 1, biteAfter: 0.6, biteEvery: 1.6, shove: 28, diveAt: 4, bait: null, oneHit: false },
  hauki: { rise: 0.5, up: 2.6, down: 1.5, wake: 0, reach: 0, bite: 0, biteAfter: 0, biteEvery: 0, shove: 0, diveAt: 0, bait: 'meat', oneHit: true },
}

export function ensureLurker(e) {
  if (e.lurk) return e.lurk
  e.sink = 1; e.fadeA = 0
  return e.lurk = { state: 'under', t: 1, taken: 0, biteT: 0 }
}
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
function dive(e) {
  const L = e.lurk
  if (L.state === 'sinking' || L.state === 'under') return
  L.state = 'sinking'; L.t = SINK_TIME
}

// Does it come up now? Turso for anyone near a lair cell; the pike for meat
// held at the pier's end, which it takes.
function wants(e, state, cfg) {
  const { player } = state
  if (!e.lurkSpots?.length) return false
  if (!cfg.bait) return e.lurkSpots.some(c => cheb(c, player) <= cfg.wake)
  if (!e.lurkPier || cheb(e.lurkPier, player) > 0) return false
  const ix = player.inventory?.findIndex(i => i.kind === cfg.bait) ?? -1
  if (ix === -1) return false
  removeItem(player, ix)
  addFloat(state.feedback, { px: player.px, py: player.py - 12, text: 'snap', kind: 'note' })
  return true
}

export function updateLurker(e, state, delta) {
  const cfg = LURKERS[e.type], L = ensureLurker(e)
  const { player } = state
  if (e.pose) e.pose.facing = player.px < e.px ? Math.PI : 0
  L.t = Math.max(0, L.t - delta)
  if (L.state === 'under') {
    e.sink = 1
    if (L.t <= 0 && wants(e, state, cfg)) {
      const at = [...e.lurkSpots].sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0]
      Object.assign(e, { x: at.x, y: at.y, px: at.x * S + S / 2, py: at.y * S + S / 2 })
      L.state = 'rising'; L.t = cfg.rise
      sfx(state, 'sink', { px: e.px, py: e.py })
    }
  } else if (L.state === 'rising') {
    e.sink = L.t / cfg.rise
    if (L.t <= 0) { L.state = 'up'; L.t = cfg.up; L.taken = 0; L.biteT = cfg.biteAfter }
  } else if (L.state === 'up') {
    e.sink = 0
    if (cfg.bite) {
      L.biteT -= delta
      if (L.biteT <= 0 && Math.hypot(player.px - e.px, player.py - e.py) <= cfg.reach * S) {
        if (damagePlayer(state, cfg.bite, 'hit', { px: e.px, py: e.py })) {
          sfx(state, 'drag', { px: player.px, py: player.py })
          startKnockback(player, player.px - e.px, player.py - e.py, cfg.shove)
        }
        L.biteT = cfg.biteEvery
      }
    }
    if (L.t <= 0) dive(e)
  } else {
    e.sink = 1 - L.t / SINK_TIME
    if (L.t <= 0) { L.state = 'under'; L.t = cfg.down }
  }
  stepFade(e, L.state === 'under' ? 0 : 1, delta, { inTime: 0.1, outTime: 0.1 })
}

// Under water there is nothing to hit. Up, a blow lands: the pike takes one
// (whatever the blade) and is gone again; Turso takes it whole and goes down
// once he has had enough for one rising.
export function hitLurker(e, state, dmg) {
  const cfg = LURKERS[e.type], L = ensureLurker(e)
  if (L.state !== 'up') return { entity: e, absorbed: true, cue: L.state === 'under' ? null : 'sink' }
  const take = cfg.oneHit ? 1 : dmg
  e.hp -= take; e.inCombat = true
  L.taken += take
  if (e.hp > 0 && (cfg.oneHit || L.taken >= cfg.diveAt)) dive(e)
  return { entity: e, absorbed: false, cue: 'melee-hit' }
}

for (const type of Object.keys(LURKERS)) {
  CREATURE_UPDATE[type] = updateLurker
  CREATURE_HIT[type] = hitLurker
  CREATURE_ALPHA[type] = e => e.fadeA ?? 0
}
