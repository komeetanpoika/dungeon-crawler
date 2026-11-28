// Coin: what gear is worth, who trades in what, what an inn serves and who
// carries a purse. The rules are systems/coin.js (the purse, selling and
// buying) and systems/tavern.js (what ale and a full belly do). Plain data.
//
// Coin is for the settled folk: a village's households, the crossroads inns
// and Kalevanlinna. The seal folk barter and want none of it (data/tribes.js).

// What a piece of gear fetches from a smith, by its table key. A thing not
// listed is not bought by anyone: a tale's flute and axe, a quest's reward
// (the elder's Elk-hide Boots among them), the three story outfits,
// whatever a cheat made.
export const VALUES = {
  weapon: { hatchet: 4, dagger: 4, pick: 6, sword: 8, longsword: 16, axe: 26 },
  ranged: { sling: 4, shortbow: 8, hunterbow: 12, longbow: 20, splitbow: 22, crossbow: 30 },
  wand: { sparkwand: 8, frostwand: 14, bramblewand: 22, firewand: 24, blinkwand: 30, stormwand: 34 },
  shield: { buckler: 8, kite: 22 },
  // worn pieces (entities.js WORN_TYPES), by slot
  head: { cap: 6, cloth: 8, helm: 18, horned: 20 },
  armor: { leather: 14, chain: 26, plate: 44 },
  boots: { ironshod: 16, wayfarer: 12 },
  ring: { breath: 30, miser: 28, mending: 34, smith: 36 },
}
// A vendor asks this many times a thing's worth for it...
export const MARKUP = 3
// ...and pays this share of it for one out of the hero's bag (a vendor's own
// `pays` overrides: a smith pays in full). Never less than one coin.
export const PAYS = 0.5

// How near (px) a vendor must stand for the bag's Drop to become Sell.
export const SELL_REACH = 80

const gear = (type, key) => ({ id: key, gear: [type, key] })
const good = (id, contents, price) => ({ id, contents, price })

const TURNIP = good('turnip', { type: 'turnip', count: 1 }, 1)
const BREAD = good('bread', { type: 'bread', count: 1 }, 3)
const HERRING = good('herring', { type: 'herring', count: 1 }, 3)
const MEAT = good('meat', { type: 'meat', count: 1 }, 2)
const COOKED = good('cooked_meat', { type: 'cooked_meat', count: 1 }, 6)
const POTION = good('potion', { type: 'potion', amount: 4 }, 10)
const MUSHROOM = good('mushroom', { type: 'mushroom', count: 1 }, 8)
const LUMBER = good('lumber', { type: 'lumber', count: 1 }, 2)
const ARROWS = good('arrows', { type: 'ammo', ammoKind: 'arrow', count: 10 }, 5)
const BOLTS = good('bolts', { type: 'ammo', ammoKind: 'bolt', count: 6 }, 6)
const STONES = good('stones', { type: 'ammo', ammoKind: 'stone', count: 15 }, 3)

// Tavern fare (systems/tavern.js): `drink` and `food` are how far a serving
// moves the hero toward tipsy and stuffed, `heal` what it mends. The round is
// priced by the head (`each`, never under `min`) and poured for the room.
export const FARE = [
  { id: 'ale', name: 'A mug of ale', price: 2, drink: 1 },
  { id: 'mead', name: 'A horn of mead', price: 5, drink: 2, heal: 1 },
  { id: 'stew', name: 'A bowl of stew', price: 4, food: 1, heal: 3 },
  { id: 'roast', name: 'The roast', price: 9, food: 2, heal: 6 },
  { id: 'feast', name: 'The whole table', price: 30, food: 4, drink: 2, heal: 99 },
  { id: 'round', name: 'A round for the house', each: 3, min: 6, drink: 1, round: true },
]

// Who trades in what, by kind. `title` heads the menu when the vendor has no
// name of their own, `greet` is said as it opens, `goods` are sold for coin
// (a `gear` row is priced from VALUES), `fare` is eaten and drunk on the spot.
// Everyone here buys gear out of the bag; `pays` is the share of its worth.
export const VENDORS = {
  smith: {
    title: 'The smith', pays: 1,
    greet: ['Iron I buy at what it is worth. Nobody else will.', 'Spare blades? I pay in full. Good ones cost more.'],
    goods: [gear('weapon', 'hatchet'), gear('weapon', 'sword'), gear('weapon', 'longsword'), gear('weapon', 'axe'), gear('shield', 'buckler'), gear('shield', 'kite'),
      gear('head', 'helm'), gear('armor', 'chain'), gear('armor', 'plate'), gear('boots', 'ironshod')],
  },
  hunter: {
    title: 'The hunter',
    greet: ['Meat, and what brings it down.', 'A good bow is half the hunt. The other half is patience.'],
    goods: [MEAT, COOKED, ARROWS, BOLTS, gear('ranged', 'shortbow'), gear('ranged', 'longbow'), gear('ranged', 'crossbow')],
  },
  fletcher: {
    title: 'The fletcher',
    greet: ['Straight shafts, dry strings.', 'Count your arrows before the wolves do.'],
    goods: [ARROWS, BOLTS, STONES, gear('ranged', 'shortbow'), gear('ranged', 'longbow'), gear('ranged', 'crossbow')],
  },
  charms: {
    title: 'The herb stall',
    greet: ['Something for what ails you. Or for what will.', 'The wands work. Mostly on the first try.'],
    goods: [POTION, MUSHROOM, gear('wand', 'sparkwand'), gear('wand', 'frostwand'), gear('wand', 'firewand'), gear('wand', 'stormwand')],
  },
  provisions: {
    title: 'The stall',
    greet: ['Turnips. Again.', 'Fresh this morning. Most of it.'],
    goods: [TURNIP, BREAD, POTION, LUMBER],
  },
  fisher: {
    title: 'The fisher',
    greet: ['Salted yesterday. It keeps.', 'Herring, and stones for the gulls.'],
    goods: [HERRING, STONES, gear('ranged', 'sling')],
  },
  baker: {
    title: 'The baker',
    greet: ['Rye, rye, or rye. Take your pick.', 'Warm from the oven. It was, at dawn.'],
    goods: [BREAD],
  },
  butcher: {
    title: 'The butcher',
    greet: ['Raw or roasted. The roasting is extra.', 'Nothing here walked in by itself.'],
    goods: [MEAT, COOKED],
  },
  weaver: {
    title: 'The weaver',
    greet: ['Stitched to turn a blade. A small one.', 'It will outlast you, if you let it.'],
    goods: [gear('armor', 'leather'), gear('head', 'cap'), gear('head', 'cloth'), gear('boots', 'wayfarer')],
  },
  farmer: {
    title: 'The farmer',
    greet: ['What the field gave. Mostly turnips.', 'Firewood is dear this year. Everything is.'],
    goods: [TURNIP, LUMBER, MUSHROOM],
  },
  scholar: {
    title: 'The scholar',
    greet: ['I collect what the old songs left behind. Some of it I part with.', 'Careful with that. It is older than the village.'],
    goods: [POTION, gear('wand', 'sparkwand'), gear('wand', 'frostwand'), gear('wand', 'bramblewand'), gear('wand', 'blinkwand'), gear('ring', 'breath')],
  },
  innkeeper: {
    title: 'The innkeeper',
    greet: ['Beds upstairs, beer down here.', 'Sit. Eat. Pay first.'],
    goods: [], fare: FARE,
  },
}

// What a vendor says back across the counter (game.js buyGood, serveFare).
export const SAID = {
  bought: 'Yours. Look after it.',
  short: 'Your purse says no.',
  nothing: 'You have all of that you can carry.',
  full: 'Your bag is full. Sell me something first.',
  noSale: 'Nothing in there I would give coin for.',
  noHands: 'Come back when you have hands.',
  served: 'There you are.',
  round: 'On the stranger! Drink up, all of you.',
}

// A village household's trade (interior/versions.js TRADE_LIST) is what the
// one who keeps the house sells.
export const HOME_VENDORS = { farmer: 'farmer', hunter: 'hunter', fisher: 'fisher', smith: 'smith', baker: 'baker', scholar: 'scholar', weaver: 'weaver' }

// Kalevanlinna (wilds/city/folk.js jobs). A stallholder keeps one of
// CITY_STALLS, the same one every day; the innkeeper and the servers pour
// only in the inn; everyone else trades while at work.
export const CITY_VENDORS = {
  smith: 'smith', baker: 'baker', butcher: 'butcher', weaver: 'weaver', stallholder: 'stall',
  herring: 'fisher', fisher: 'fisher', innkeeper: 'innkeeper', server: 'innkeeper',
}
export const CITY_STALLS = ['provisions', 'fletcher', 'charms', 'provisions']
// the schedule's acts (wilds/city/schedule.js) during which someone out of doors trades
export const TRADING_ACTS = ['work', 'stall', 'shop']

// Who carries a purse, and how much falls out when they are struck down in
// the Wilds: [least, most, odds]. Beasts carry none.
export const PURSES = {
  guard: [2, 5, 0.6], pullopete: [8, 14, 1],
  mohkale: [1, 4, 0.5], louhija: [1, 4, 0.5], rumpali: [1, 4, 0.5], vuorenkuningas: [25, 40, 1],
  noita: [2, 5, 0.5], kuppari: [2, 5, 0.5], syojatar: [20, 30, 1],
}
