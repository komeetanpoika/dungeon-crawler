// Coin: the hero's purse, what a vendor pays for gear out of the bag, and
// what a vendor sells (data/coin.js holds the tables). The purse is one
// number on the player, `coins`: absent until the first coin is had, so the
// HUD shows no purse to someone who has never met money.
//
// A vendor is an npc with a trade: `e.vendor` (a kind in VENDORS, set where
// the npc is built: a village householder, an innkeeper, a Kalevanlinna
// resident at home), or one of Kalevanlinna's people in the street while at
// work (cityVendor). The interact key on one opens the trade menu (game.js
// openTrade); with one within SELL_REACH the bag's Drop is Sell.
//
// Only gear is bought (weapons, bows, wands, shields, the Leather Coat):
// food, wood and the rest are what the seal folk barter in (systems/trade.js).
// Pure and DOM-free.
import { itemFromContents } from './inventory.js'
import { givesNothing } from './trade.js'
import { weaponContents, makeRangedContents, makeWandContents, makeShieldContents, makeOutfitContents } from './entities.js'
import { hashStr } from '../interior/rng.js'
import { VALUES, MARKUP, PAYS, SELL_REACH, VENDORS, CITY_VENDORS, CITY_STALLS, TRADING_ACTS, PURSES } from '../data/coin.js'

// ---- the purse ---------------------------------------------------------------

export const coinsOf = player => Math.max(0, Math.floor(player?.coins ?? 0))
// has this hero ever had coin? (the HUD and the bag show a purse only then)
export const hasPurse = player => Number.isFinite(player?.coins)

export function addCoins(player, n) {
  player.coins = coinsOf(player) + Math.max(0, Math.floor(n) || 0)
  return player.coins
}

// Takes `n` coin. False, and nothing taken, when the purse is short.
export function spend(player, n) {
  if (!Number.isInteger(n) || n < 0 || coinsOf(player) < n) return false
  player.coins = coinsOf(player) - n
  return true
}

// ---- selling -------------------------------------------------------------------

const keyOf = item => item?.kind === 'outfit' ? item.payload?.outfitType : item?.payload?.weaponType

// What a thing is worth, in full. 0: nobody buys it.
export function worth(item) {
  if (!item || item.stackable || item.quest || item.payload?.tale) return 0
  return VALUES[item.kind]?.[keyOf(item)] ?? 0
}

// What this kind of vendor pays for it: its worth times their share, never
// under one coin. 0: not bought.
export function offer(kind, item) {
  const v = VENDORS[kind], full = worth(item)
  if (!v || full <= 0) return 0
  return Math.max(1, Math.floor(full * (v.pays ?? PAYS)))
}

// Sells the bag's thing at `index` to a vendor of `kind`: it leaves the bag
// and its price joins the purse. Returns { ok, coins } (coins: what was paid).
export function sell(player, index, kind) {
  const item = player.inventory?.[index]
  const coins = offer(kind, item)
  if (coins <= 0) return { ok: false, coins: 0 }
  player.inventory.splice(index, 1)
  addCoins(player, coins)
  return { ok: true, coins, item }
}

// ---- buying --------------------------------------------------------------------

const MAKE = {
  weapon: key => ({ type: 'weapon', ...weaponContents(key) }),
  ranged: makeRangedContents, wand: makeWandContents, shield: makeShieldContents, outfit: makeOutfitContents,
}
const AMMO_NAMES = { arrow: 'Arrows', bolt: 'Bolts', stone: 'Sling stones' }

function rowOf(entry) {
  const contents = entry.gear ? MAKE[entry.gear[0]](entry.gear[1]) : { ...entry.contents }
  const price = entry.gear ? (VALUES[entry.gear[0]]?.[entry.gear[1]] ?? 0) * MARKUP : entry.price
  const n = contents.count ?? 1
  const name = contents.type === 'ammo' ? AMMO_NAMES[contents.ammoKind] : itemFromContents(contents)?.name
  return { id: entry.id, contents, price, label: n > 1 ? `${name} ×${n}` : name }
}

// What a vendor of this kind sells: [{ id, label, price, contents }].
export function stock(kind) {
  return (VENDORS[kind]?.goods ?? []).map(rowOf).filter(r => r.label && r.price > 0)
}

// The hero buys a row of a vendor's stock. `grant(contents)` is game.js's own
// pickup (false when the bag has no room). Returns what came of it:
//   'bought'   the price left the purse and the thing was granted
//   'short'    the purse is short: nothing changes hands
//   'nothing'  he could take nothing of it (a full quiver, a coat he owns, a
//              bow he carries: a second one only tops the quiver up)
//   'full'     no room in the bag: the price went back
const carriesBow = (player, c) => c.type === 'ranged' && (player.ranged?.weaponType === c.weaponType
  || (player.inventory ?? []).some(i => i.kind === 'ranged' && i.payload?.weaponType === c.weaponType))
export function buy(player, row, grant) {
  if (givesNothing(player, row.contents) || carriesBow(player, row.contents)) return 'nothing'
  if (!spend(player, row.price)) return 'short'
  if (grant({ ...row.contents })) return 'bought'
  addCoins(player, row.price)
  return 'full'
}

// ---- who trades ----------------------------------------------------------------

// One of Kalevanlinna's people as a vendor, or null: by their job, while at
// work in the street, or at home or in their shop (`indoors`); the innkeeper
// and the servers only in the inn. A stallholder keeps the same stall always.
export function cityVendor(person, { act = null, indoors = false, inn = false } = {}) {
  const kind = CITY_VENDORS[person?.job]
  if (!kind) return null
  if (kind === 'innkeeper') return indoors && inn ? kind : null
  if (!indoors && !TRADING_ACTS.includes(act)) return null
  return kind === 'stall' ? CITY_STALLS[hashStr(String(person.id)) % CITY_STALLS.length] : kind
}

// The trade of this npc, or null: a kind in VENDORS.
export function vendorOf(e) {
  if (!e || e.type !== 'npc' || e.hostile || !(e.hp > 0)) return null
  const kind = e.vendor ?? (e.city?.person ? cityVendor(e.city.person, { act: e.city.entry?.act }) : null)
  return VENDORS[kind] ? kind : null
}

export const vendorName = e => e?.vendorName ?? e?.city?.person?.name ?? VENDORS[vendorOf(e)]?.title ?? ''

// The nearest vendor within `reach` px of the hero, or null.
export function vendorNear(state, reach = SELL_REACH) {
  const { player } = state
  let best = null, bestD = reach
  for (const e of state.entities ?? []) {
    if (!vendorOf(e)) continue
    const d = Math.hypot(e.px - player.px, e.py - player.py)
    if (d <= bestD) { best = e; bestD = d }
  }
  return best
}

export function greeting(kind, rng = Math.random) {
  const lines = VENDORS[kind]?.greet ?? []
  return lines.length ? lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))] : ''
}

// ---- purses ----------------------------------------------------------------------

// What falls out of someone struck down, once: a count of coin, or 0.
export function purseOf(e, rng = Math.random) {
  const row = PURSES[e?.type]
  if (!row || e.pursed || !(e.hp <= 0)) return 0
  e.pursed = true
  const [lo, hi, odds] = row
  if (rng() >= odds) return 0
  return lo + Math.min(hi - lo, Math.floor(rng() * (hi - lo + 1)))
}
