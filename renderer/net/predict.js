// Client-side prediction for your own hero (spec §2): the same moveHero the
// server runs, applied at once to every input you send, then corrected
// against each snapshot by replaying what the server has not acknowledged.
// Damage is never predicted; the tap swing's animation and the charge
// wind-up are. Pure.
import { moveHero, tickHeroStatus } from '../pvp/hero.js'
import { hydrateHero, heroSnap } from './protocol.js'
import { getAttack, isChargeWeapon, shouldAutoRelease } from '../systems/melee.js'
import { shouldAutoReleaseGust } from '../systems/magic.js'
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

export function makePredictor({ map, heroSnap: s }) {
  // from/alpha: the hero is drawn between where it was before the last live
  // step (`from`) and where it is now, `alpha` of the way — the sim moves in
  // 33 ms steps, the screen in 16 ms frames. client.js sets both.
  return { map, hero: hydrateHero(null, s), pending: [], corr: { x: 0, y: 0, age: 0 }, swing: null, swingCooldown: 0,
    from: null, alpha: 1 }
}

// The charge half of tickMelee/tickMagic without its effects: start, hold,
// release. It keeps the predicted walk exact (a wind-up slows you) — the
// cast or blow itself arrives from the server.
function predictCharge(h, input, dt) {
  const wt = h.weapon?.weaponType
  const kind = h.attackMode === 'magic' ? 'spell' : h.attackMode === 'melee' && isChargeWeapon(wt) ? 'melee' : null
  if (!kind) return
  if (h.charging) {
    const over = kind === 'spell' ? shouldAutoReleaseGust(h.charging.t) : shouldAutoRelease(wt, h.charging.t)
    if (input.attack && !over) h.charging.t += dt
    else { h.charging = null; h.needRelease = true }
  } else if (input.attack && !h.needRelease && !h.blocking &&
             (kind === 'spell' ? h.magicCooldown <= 0 : h.meleeCooldown <= 0)) {
    h.charging = kind === 'spell' ? { t: 0, kind: 'spell' } : { t: 0 }
  }
}

export function predictStep(pred, input, dt = PVP.tick) {
  const h = pred.hero
  if (h.dead) return
  tickHeroStatus(h, dt)
  const { stunned } = moveHero({ map: pred.map }, h, input, dt)
  if (stunned) { h.charging = null; return }
  predictCharge(h, input, dt)
}

// The tap swing starts drawing the moment the key goes down. Its own
// cooldown lives on the predictor, so a snapshot that has not seen the swing
// yet cannot restart it.
export function predictCosmetics(pred, input, dt = PVP.tick) {
  pred.swingCooldown = Math.max(0, pred.swingCooldown - dt)
  if (pred.swing) { pred.swing.t += dt; if (pred.swing.t >= pred.swing.dur) pred.swing = null }
  const h = pred.hero
  const wt = h.weapon?.weaponType
  if (h.dead || h.attackMode !== 'melee' || !wt || isChargeWeapon(wt) || h.blocking || h.stunTimer > 0) return
  if (!input.attack || pred.swingCooldown > 0) return
  const atk = getAttack(wt)
  pred.swing = { t: 0, dur: atk.duration, style: atk.style, facing: h.facing }
  pred.swingCooldown = atk.cooldown
}

export function drawnPos(pred) {
  const k = Math.max(0, 1 - pred.corr.age / NET.correctionMs)
  const h = pred.hero, f = pred.from ?? { x: h.px, y: h.py }, a = pred.alpha ?? 1
  return { x: f.x + (h.px - f.x) * a + pred.corr.x * k, y: f.y + (h.py - f.y) * a + pred.corr.y * k }
}

export function tickCorrection(pred, dtMs) {
  pred.corr.age = Math.min(NET.correctionMs, pred.corr.age + dtMs)
}

export function reconcile(pred, snapHero, ack) {
  const before = drawnPos(pred)
  const old = { x: pred.hero.px, y: pred.hero.py }
  hydrateHero(pred.hero, snapHero)
  pred.pending = pred.pending.filter(p => p.seq > ack)
  for (const p of pred.pending) predictStep(pred, p.input)
  // Carry the sub-tick segment along with the corrected hero, so the
  // smoothing keeps its shape and only the correction below is new.
  if (pred.from) { pred.from.x += pred.hero.px - old.x; pred.from.y += pred.hero.py - old.y }
  pred.corr = { x: 0, y: 0, age: 0 }
  const after = drawnPos(pred)
  const ex = before.x - after.x, ey = before.y - after.y
  const err = Math.hypot(ex, ey)
  if (err >= NET.snapPx && err <= NET.bigSnapPx) pred.corr = { x: ex, y: ey, age: 0 }
}

export { heroSnap }
