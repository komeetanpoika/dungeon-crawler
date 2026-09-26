// Client-side prediction for your own hero (spec §2): the same moveHero the
// server runs, applied at once to every input you send, then corrected
// against each snapshot by replaying what the server has not acknowledged.
// Damage (and every other in-flight effect: projectiles, casts, knockback)
// is never predicted; the cooldown and stamina a swing/cast pays are, so a
// replayed tap swing or charge release leaves the tank exactly where the
// server would, and predictCosmetics's tap-swing animation is purely
// cosmetic on top. Pure.
import { moveHero, tickHeroStatus } from '../pvp/hero.js'
import { hydrateHero } from './protocol.js'
import { getAttack, isChargeWeapon, shouldAutoRelease, resolveCharge } from '../systems/melee.js'
import { shouldAutoReleaseGust, resolveGustTier } from '../systems/magic.js'
import { spellFor, castCost } from '../systems/spells.js'
import { swingCost, comboCooldown } from '../pvp/attacks.js'
import { isComboWeapon, beginHold, holdGesture, classify, SECTOR_FACING } from '../pvp/combos.js'
import { spendStamina } from '../systems/stamina.js'
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
// release. It keeps the predicted walk exact (a wind-up slows you), and a
// release now pays the same cooldown and stamina the server's swing()/
// tryCast() would (via the shared swingCost/castCost helpers) — effects
// excluded (no damage, no projectile, no cast) — so a re-press inside that
// cooldown is refused locally exactly as the server refuses it, instead of
// predicting a second wind-up (and its move-speed penalty) the server never
// grants.
function predictCharge(h, input, dt) {
  const wt = h.weapon?.weaponType
  const kind = h.attackMode === 'magic' ? 'spell' : h.attackMode === 'melee' && isChargeWeapon(wt) ? 'melee' : null
  if (!kind) return
  if (h.charging) {
    const over = kind === 'spell' ? shouldAutoReleaseGust(h.charging.t) : shouldAutoRelease(wt, h.charging.t)
    if (input.attack && !over) { h.charging.t += dt; return }
    const held = h.charging.t
    h.charging = null
    h.needRelease = true
    if (kind === 'spell') {
      const resolved = castCost(h, spellFor(h).id, resolveGustTier(held))
      if (resolved) { spendStamina(h, resolved.stamina); h.magicCooldown = resolved.cooldown }
    } else {
      const { stamina, cooldown } = swingCost(h, resolveCharge(wt, held))
      spendStamina(h, stamina)
      h.meleeCooldown = cooldown
    }
  } else if (input.attack && !h.needRelease && !h.blocking &&
             (kind === 'spell' ? h.magicCooldown <= 0 : h.meleeCooldown <= 0)) {
    h.charging = kind === 'spell' ? { t: 0, kind: 'spell' } : { t: 0 }
  }
}

// tickMelee's non-charge branch, effects excluded (no damage/knockback/sfx):
// a tap weapon swings the instant it is held and off cooldown, paying
// swingCost's stamina and starting its meleeCooldown right away — mirrored
// here (not only in predictCosmetics) because reconcile's replay drives
// predictStep alone, and a replayed tap swing must spend the same stamina
// the server's did or a later sprint check (stamina > 0) reads a tank the
// server already emptied.
function predictSwing(h, attacking) {
  const wt = h.weapon?.weaponType
  if (h.attackMode !== 'melee' || !wt || isChargeWeapon(wt) || isComboWeapon(wt)) return
  if (h.charging && !h.charging.kind) h.charging = null
  if (!attacking || h.meleeCooldown > 0) return
  const { stamina, cooldown } = swingCost(h, resolveCharge(wt, 0))
  spendStamina(h, stamina)
  h.meleeCooldown = cooldown
}

// The Warrior's hold, as hero.js's tickMelee runs it for a combo weapon,
// effects excluded: the press begins the hold, each held tick reads the
// stick through the same holdGesture (so a move pays the same 25 stamina),
// and the release turns the hero, pays the swing's stamina and cooldown or
// the combo's cooldown. The combo effect itself (the lunge's dash, the
// thrusts, the whirl) is the server's; it reconciles like knockback.
// Returns the classified combo on the release tick, else null.
function predictCombo(h, input, attacking) {
  const wt = h.weapon?.weaponType
  if (h.attackMode !== 'melee' || !isComboWeapon(wt)) return null
  if (h.charging && !h.charging.kind) h.charging = null
  if (!h.combo) {
    if (attacking && h.meleeCooldown <= 0) beginHold(h, input.move)
    return null
  }
  if (input.attack) { holdGesture(h, input.move); return null }
  const combo = classify(h.combo.moves)
  h.combo = null
  if (combo.dir) h.facing = SECTOR_FACING[combo.dir]
  if (combo.kind === 'swing') {
    const { stamina, cooldown } = swingCost(h, resolveCharge(wt, 0))
    spendStamina(h, stamina)
    h.meleeCooldown = cooldown
  } else h.meleeCooldown = comboCooldown(wt, combo.kind)
  return combo
}

// One predicted tick. Returns { released }: the combo a Warrior's release
// fired this tick (for predictCosmetics' local swing), else null.
export function predictStep(pred, input, dt = PVP.tick) {
  const h = pred.hero
  if (h.dead) return { released: null }
  tickHeroStatus(h, dt)
  const { stunned, blocking } = moveHero({ map: pred.map }, h, input, dt)
  if (stunned) { h.charging = null; return { released: null } }
  predictCharge(h, input, dt)
  const attacking = !!input.attack && !h.needRelease && !blocking
  const released = predictCombo(h, input, attacking)
  predictSwing(h, attacking)
  return { released }
}

// The local swing starts drawing at once: for the sword (a combo weapon)
// on the release that fired a plain swing — `released`, what the live
// predictStep just returned — and for any other light blade the moment the
// key goes down. Its own cooldown lives on the predictor (not the hero's
// meleeCooldown, which predictStep owns), so a snapshot that has not seen
// the swing yet cannot restart it. Animation only — no stamina or cooldown
// write here; predictStep pays those, on both the live path and
// reconcile's replay. Combos draw from the server's hero.move instead.
export function predictCosmetics(pred, input, dt = PVP.tick, released = null) {
  pred.swingCooldown = Math.max(0, pred.swingCooldown - dt)
  if (pred.swing) { pred.swing.t += dt; if (pred.swing.t >= pred.swing.dur) pred.swing = null }
  const h = pred.hero
  const wt = h.weapon?.weaponType
  if (h.dead || h.attackMode !== 'melee' || !wt || isChargeWeapon(wt) || h.blocking || h.stunTimer > 0) return
  const pressed = isComboWeapon(wt) ? released?.kind === 'swing' : !!input.attack
  if (!pressed || pred.swingCooldown > 0) return
  const atk = getAttack(wt)
  pred.swing = { t: 0, dur: atk.duration, style: atk.style, facing: h.facing }
  pred.swingCooldown = atk.cooldown * resolveCharge(wt, 0).cooldownMul
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
