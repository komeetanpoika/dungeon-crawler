// The taproom: eating and drinking for coin, with no limit but the purse
// (the fare is data/coin.js FARE; an innkeeper's trade menu serves it,
// game.js openTrade). Two numbers ride on the player and are never saved:
//
//   drunk  every drink adds to it and it fades by one in DRINK_FADE seconds.
//          From TIPSY_AT the hero's walk wanders (stagger) and the view sways;
//          from HIC_AT he hiccups; at PASS_OUT he is under the table, wakes
//          with a thick head and pays the innkeeper for the mopping.
//   full   every dish adds to it and it fades by one in FOOD_FADE seconds.
//          From STUFFED_AT he walks slower, from BURSTING_AT slower still.
//
// Nothing stops the next order: a full hero may eat and a reeling one drink
// until the purse is empty. Food mends as it always does. Pure and DOM-free.
import { coinsOf, spend } from './coin.js'

export const DRINK_FADE = 40    // s for one drink to wear off
export const FOOD_FADE = 30     // s for one helping to go down
export const TIPSY_AT = 1
export const HIC_AT = 2
export const PASS_OUT = 8
export const HANGOVER = 1.5     // what is left of it on waking
export const STUFFED_AT = 5
export const BURSTING_AT = 9
export const MOP_FEE = 5        // what the innkeeper takes from a hero he had to mop round
const HIC_EVERY = [4, 9]        // s between hiccups

export const drunkOf = player => Math.max(0, player?.drunk ?? 0)
export const fullOf = player => Math.max(0, player?.full ?? 0)

// What a serving costs: its price, or for the round so much a head (`guests`
// in the room), never under its floor.
export function fareCost(fare, guests = 0) {
  return fare.round ? Math.max(fare.min ?? 0, (fare.each ?? 0) * guests) : fare.price
}

// The hero orders. Null, and nothing changed, when the purse is short. Else
// the price is paid and the serving is in him:
//   { cost, healed, passedOut, remark }
// `remark` is what he thinks of it when it took him over a line, else null.
export function order(player, fare, guests = 0) {
  const cost = fareCost(fare, guests)
  if (!spend(player, cost)) return null
  const d0 = drunkOf(player), f0 = fullOf(player)
  player.drunk = d0 + (fare.drink ?? 0)
  player.full = f0 + (fare.food ?? 0)
  const healed = Math.max(0, Math.min((player.maxHp ?? 0) - (player.hp ?? 0), fare.heal ?? 0))
  player.hp = (player.hp ?? 0) + healed
  return { cost, healed, passedOut: player.drunk >= PASS_OUT, remark: remarkOn(d0, player.drunk, f0, player.full, coinsOf(player)) }
}

const DRUNK_REMARKS = [[2, 'That went down easy.'], [4, 'The floor is moving. Slowly.'], [6, 'One more. Jusht the one.']]
const FULL_REMARKS = [[STUFFED_AT, 'I could not eat another bite.'], [BURSTING_AT, 'I ate another bite.']]
function remarkOn(d0, d1, f0, f1, coins) {
  const crossed = (rows, a, b) => rows.filter(([at]) => a < at && b >= at).at(-1)?.[1] ?? null
  return crossed(DRUNK_REMARKS, d0, d1) ?? crossed(FULL_REMARKS, f0, f1) ?? (coins === 0 ? 'That was the last of my coin.' : null)
}

// He wakes under the table: most of it slept off, and the innkeeper has
// taken MOP_FEE out of the purse, or what was left of it. Returns the fee.
export function sleepItOff(player) {
  player.drunk = HANGOVER
  player.hicT = 0
  const fee = Math.min(MOP_FEE, coinsOf(player))
  spend(player, fee)
  return fee
}

// Every frame: both fade. Returns 'hic' on the frame a hiccup is due.
export function tickTavern(player, delta, rng = Math.random) {
  if (!player) return null
  if (player.full > 0) player.full = Math.max(0, player.full - delta / FOOD_FADE)
  if (!(player.drunk > 0)) return null
  player.drunk = Math.max(0, player.drunk - delta / DRINK_FADE)
  if (player.drunk < HIC_AT) { player.hicT = 0; return null }
  player.hicT = (player.hicT || HIC_EVERY[0] + rng() * (HIC_EVERY[1] - HIC_EVERY[0])) - delta
  if (player.hicT > 0) return null
  player.hicT = 0
  return 'hic'
}

// How fast a full hero walks.
export const tavernSpeedMul = player => fullOf(player) >= BURSTING_AT ? 0.65 : fullOf(player) >= STUFFED_AT ? 0.8 : 1

// How far (radians) a tipsy hero's step turns from where he means to go at
// time `t` (s): a slow wander that grows with every drink.
export function stagger(player, t) {
  const d = drunkOf(player)
  if (d < TIPSY_AT) return 0
  return Math.min(0.9, 0.13 * d) * Math.sin(t * 1.9 + 1.3 * Math.sin(t * 0.7))
}

// How far (px) the view drifts for him at time `t`.
export function sway(player, t) {
  const d = drunkOf(player)
  if (d < TIPSY_AT) return { dx: 0, dy: 0 }
  const amp = Math.min(10, 1.6 * d)
  return { dx: Math.round(amp * Math.sin(t * 1.1)), dy: Math.round(amp * 0.6 * Math.sin(t * 0.83 + 1)) }
}
