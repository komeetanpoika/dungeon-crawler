// What worn pieces do. Headwear, armor, boots and a ring sit in the played
// character's gear (systems/inventory.js holds the rules for putting them on;
// entities.js WORN_TYPES the table), and everything here is read off the
// character being played: switch character and it all switches with him.
//
// Armor points: a piece's `armor` adds to the character's armor, which takes
// a blow before hp does (systems/player-damage.js) and mends by itself once
// the hero has gone ARMOR.mendDelay without one. What armor has taken is one
// number on the hero, `dents`, and the armor showing is the played
// character's own less the dents: so a change of character mends nothing and
// throws no mended point away.
//
// Pure and DOM-free; reads `player.gear` without creating it, so a bare
// `{ hp }` hero (a test's, a creature's) simply has no armor.
import { WORN_SLOTS } from './entities.js'

export const ARMOR = { mendDelay: 6, mendEvery: 2.5 }
const STANCES = ['melee', 'ranged', 'magic']
const active = player => player.attackMode ?? 'melee'

// the pieces a character has on, in slot order
function pieces(player, stance = active(player)) {
  const g = player?.gear?.[stance]
  return g ? WORN_SLOTS.map(slot => g[slot]).filter(Boolean) : []
}

export const armorMax = (player, stance = active(player)) =>
  pieces(player, stance).reduce((sum, p) => sum + (p.armor ?? 0), 0)

export const armorNow = player => Math.max(0, armorMax(player) - (player.dents ?? 0))

// A blow of `amount` on the armor: what it took and what is left for hp. Any
// blow, held or not, starts the wait for mending again.
export function absorbHit(player, amount) {
  const soaked = Math.max(0, Math.min(amount, armorNow(player)))
  if (soaked > 0) player.dents = (player.dents ?? 0) + soaked
  player.armorRestT = 0
  return { soaked, left: amount - soaked }
}

// Once a frame: after the delay, a dent comes out every `mendEvery` seconds
// (half that with the Smith's Ring on the character being played).
export function tickArmor(player, dt) {
  if (!(player.dents > 0)) return
  const every = ARMOR.mendEvery * (wornPower(player, 'smith') ? 0.5 : 1)
  player.armorRestT = (player.armorRestT ?? 0) + dt
  while (player.dents > 0 && player.armorRestT >= ARMOR.mendDelay + every) {
    player.dents -= 1
    player.armorRestT -= every
  }
}

// After pieces change hands: dents never outnumber the most armor any of the
// three characters has left.
export function settleDents(player) {
  if (!(player.dents > 0)) return
  player.dents = Math.min(player.dents, Math.max(...STANCES.map(s => armorMax(player, s))))
}

// What the played character's pieces do to the sprint's stamina cost: mail
// and plate weigh, the elk's hide runs like weather.
export const wornSprintMul = player => pieces(player).reduce((mul, p) => mul * (p.sprintMul ?? 1), 1)

// Does the character being played wear a piece with this power?
export const wornPower = (player, power) => pieces(player).some(p => p.power === power)

// ---- the powers that are a number ----------------------------------------------
// (the Horned Helm's ram is systems/ram.js; the Desert Headcloth is read in
// wilds/heat.js; the Smith's Ring in tickArmor above)

// The Ring of Breath: stamina comes back this much faster (systems/stamina.js).
export const BREATH_REGAIN = 1.3
export const breathMul = player => wornPower(player, 'breath') ? BREATH_REGAIN : 1

// The Miser's Ring: a purse that falls holds this much more (game.js, on the drop).
export const MISER_PURSE = 1.5
export const purseMul = player => wornPower(player, 'miser') ? MISER_PURSE : 1

// The Wayfarer's Boots: a walk, not a sprint, is this much quicker (game.js).
export const WAYFARER_WALK = 1.12
export const walkMul = player => wornPower(player, 'wayfarer') ? WAYFARER_WALK : 1

// The Ring of Mending: one hitpoint back every MENDING_EVERY seconds while
// the hero is hurt. The count starts at the wound: no time is banked while
// he is whole. Returns the hitpoints mended this frame (0 or 1).
export const MENDING_EVERY = 40
export function tickMending(player, dt) {
  const max = player.maxHp ?? 10
  if (!wornPower(player, 'mending') || !(player.hp > 0) || player.hp >= max) { player.mendT = 0; return 0 }
  player.mendT = (player.mendT ?? 0) + dt
  if (player.mendT < MENDING_EVERY) return 0
  player.mendT -= MENDING_EVERY
  player.hp = Math.min(max, player.hp + 1)
  return 1
}
