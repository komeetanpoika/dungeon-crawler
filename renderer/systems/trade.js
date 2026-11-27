// Barter: a tribe's wares (data/tribes.js WARES; the seals' trader lays
// three on the sand). A ware is a floating item that lies still and carries
// `price` ({ item, count }: so many of one kind of stackable sack item) and
// `tribe` (game.js buildEntities, spawn kind `ware`). No key and no menu:
// stepping onto it with the price in the sack takes the price and grants the
// ware (tryBuy, called from game.js's pickup step). Without the price nothing
// is taken and the tribe's vendor, if one stands within VENDOR_REACH tiles,
// says what it costs; while the tribe holds a grudge (systems/tribes.js)
// nothing is sold at all. Pure and DOM-free.
import { makeItem, addItem, removeItem } from './inventory.js'
import { TRIBES } from '../data/tribes.js'
import { wrathOf, roleOf, isMember, withId } from './tribes.js'
import { speakFrom, sayDuration } from './feedback.js'

const S = 32
export const VENDOR_REACH = 8   // tiles from the ware within which its vendor speaks up
export const WARE_SAY_EVERY = 4 // s between two of the vendor's lines about a price

const itemOf = kind => { try { return makeItem(kind, 1) } catch { return null } }
const valid = price => !!price && Number.isInteger(price.count) && price.count > 0 && !!itemOf(price.item)
const carried = (player, kind) =>
  (player.inventory ?? []).reduce((n, i) => n + (i.kind === kind && i.stackable ? i.count ?? 1 : 0), 0)

export function canPay(player, price) {
  return valid(price) && carried(player, price.item) >= price.count
}

// Takes price.count of price.item from the sack. False, and nothing taken,
// when the sack is short of it.
export function pay(player, price) {
  if (!canPay(player, price)) return false
  for (let n = price.count; n > 0; n--) removeItem(player, player.inventory.findIndex(i => i.kind === price.item && i.stackable))
  return true
}

// What a price is paid in, as the vendor says it ("2 cooked meat").
export function priceName(price) {
  return (itemOf(price?.item)?.name ?? String(price?.item ?? '')).toLowerCase()
}

// The ware's vendor: the nearest living member of its tribe with the role
// `vendor`, within VENDOR_REACH of the ware. Null when there is none.
function vendorOf(state, ware) {
  let best = null, bestD = VENDOR_REACH * S
  for (const e of state.entities ?? []) {
    if (!isMember(e, ware.tribe) || roleOf(e) !== 'vendor' || !(e.hp > 0) || e.dying > 0) continue
    const d = Math.hypot(e.px - ware.px, e.py - ware.py)
    if (d <= bestD) { best = e; bestD = d }
  }
  return best
}

// (the throttle is game.js's own: it counts every state.msgCooldown key down)
function vendorSays(state, ware, text) {
  const cd = state.msgCooldown ?? (state.msgCooldown = {})
  if (!text || (cd.ware ?? 0) > 0) return
  const vendor = vendorOf(state, ware)
  if (!vendor) return
  cd.ware = WARE_SAY_EVERY
  speakFrom(state, withId(vendor), text, sayDuration(text))
}

// The hero stands on `ware`. `grant(contents)` is game.js's own pickup
// (false when the sack has no room). Returns what came of it:
//   'bought'  the price was taken, once, and the ware granted: remove it
//   'short'   the price is not in the sack: nothing taken
//   'grudge'  its tribe is wronged: nothing sold
//   'full'    no room for it: the price went back
export function tryBuy(state, ware, grant) {
  const { player } = state
  const tribe = TRIBES[ware.tribe]
  if (wrathOf(state, ware.tribe) > 0) { vendorSays(state, ware, tribe?.grudgeLine); return 'grudge' }
  if (!pay(player, ware.price)) {
    if (valid(ware.price)) vendorSays(state, ware, tribe?.priceLine?.(ware.price.count, priceName(ware.price)))
    return 'short'
  }
  if (grant(ware.contents)) return 'bought'
  addItem(player, makeItem(ware.price.item, ware.price.count))
  return 'full'
}
