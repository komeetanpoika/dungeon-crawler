// Player melee: per-weapon swing timing and the hit region each swing covers.
//
// Hit regions live in "weapon space": the offset from the player to a target is
// rotated by −facingAngle, giving rx = distance in front of the player and
// ry = distance to the side. Every region is therefore written as if the player
// always faced east, and the same numbers hold for all four facings.

export const ATTACK_STYLES = {
  hatchet:      { style: 'arc',   duration: 0.18, cooldown: 0.38, knockback: 14 },
  dagger:       { style: 'snap',  duration: 0.12, cooldown: 0.30, knockback: 10 },
  sword:        { style: 'arc',   duration: 0.20, cooldown: 0.40, knockback: 18 },
  longsword:    { style: 'slash', duration: 0.22, cooldown: 0.50, knockback: 24 },
  axe:          { style: 'spin',  duration: 0.35, cooldown: 0.60, knockback: 34 },
  maunonmiekka: { style: 'arc',   duration: 0.20, cooldown: 0.40, knockback: 60 },
}

const DEFAULT_ATTACK = { style: 'arc', duration: 0.20, cooldown: 0.40, knockback: 18 }

export function getAttack(weaponType) {
  return ATTACK_STYLES[weaponType] ?? DEFAULT_ATTACK
}

// Weighty weapons charge: press-and-hold winds up, release swings. `full` and
// `over` are hold times (s) for the tier thresholds; `moveFactor` is how much
// of the walk speed survives while winding up — weapon-specific by design.
export const CHARGE = {
  longsword:    { full: 0.5, over: 1.1, moveFactor: 0.6 },
  axe:          { full: 0.6, over: 1.2, moveFactor: 0.35 },
  maunonmiekka: { full: 0.5, over: 1.1, moveFactor: 0.5 },
}

export const isChargeWeapon = weaponType => weaponType in CHARGE

export const chargeMoveFactor = weaponType => CHARGE[weaponType]?.moveFactor ?? 1

// Release tiers: a tap is light and quick to recover from; the full swing is
// the weapon's baseline; overcharging trades a long recovery for damage,
// reach and knockback. Non-charge weapons always swing at baseline.
const TIER_MODS = {
  tap:  { dmgMul: 0.7, reachMul: 1,    kbMul: 0.7, cooldownMul: 0.75 },
  full: { dmgMul: 1,   reachMul: 1,    kbMul: 1,   cooldownMul: 1 },
  over: { dmgMul: 1.6, reachMul: 1.25, kbMul: 1.6, cooldownMul: 1.5 },
}

const AUTO_RELEASE_GRACE = 0.5   // seconds past 'over' before the swing lets go

export const shouldAutoRelease = (weaponType, heldTime) => {
  const c = CHARGE[weaponType]
  return !!c && heldTime > c.over + AUTO_RELEASE_GRACE
}

export const tierMods = tier => ({ tier, ...TIER_MODS[tier] })

export function resolveCharge(weaponType, heldTime) {
  const c = CHARGE[weaponType]
  const tier = !c ? 'full' : heldTime >= c.over ? 'over' : heldTime >= c.full ? 'full' : 'tap'
  return { tier, ...TIER_MODS[tier] }
}

// Swing geometry — the single source of truth for both the hit test and the
// animation, so a swing always damages exactly the wedge it draws.
//   reach     — how far from the player's center the swing bites (px; a tile is 32)
//   halfAngle — half-width of that wedge either side of the facing direction
//               (radians); PI means the swing comes all the way round
//
// Every wedge is centred on the facing direction, so the damage always lands
// where the player is aiming. The axe is the deliberate exception: its whirl is
// the payoff for the slowest cooldown in the game.
export const SWING_ARCS = {
  snap:  { reach: 34, halfAngle: Math.PI * 50/180 },   // dagger: a fast point-blank poke
  arc:   { reach: 46, halfAngle: Math.PI * 70/180 },   // sword: a 140° side-to-side sweep
  slash: { reach: 58, halfAngle: Math.PI * 75/180 },   // longsword: the longest, widest cleave
  spin:  { reach: 40, halfAngle: Math.PI },            // axe: a full 360° whirl
}

export function getSwingArc(style) {
  return SWING_ARCS[style] ?? SWING_ARCS.arc
}

// True when a target at offset (dx, dy) from the player is inside the swing.
// The region is a wedge of `reach` radius centred on the facing direction, so
// the bulk of every swing lands in front of the player.
export function meleeHit(style, facingAngle, dx, dy) {
  const { reach, halfAngle } = getSwingArc(style)
  return inSwing(reach, halfAngle, facingAngle, dx, dy)
}

// The same test with the wedge given directly, for wielders whose reach is not
// one of the player's weapons — every enemy weapon carries its own `reach`.
export function inSwing(reach, halfAngle, facingAngle, dx, dy) {
  const dist = Math.hypot(dx, dy)
  if (dist > reach) return false
  if (halfAngle >= Math.PI) return true
  if (dist < 1) return true            // target standing on top of the swinger
  const c = Math.cos(-facingAngle), s = Math.sin(-facingAngle)
  const rx = dx * c - dy * s           // forward component
  const ry = dx * s + dy * c           // side component
  return Math.abs(Math.atan2(ry, rx)) <= halfAngle
}
