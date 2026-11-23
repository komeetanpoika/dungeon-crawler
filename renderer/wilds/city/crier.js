// The town crier's news (spec "The crier's news"): what Heikki calls from his
// box on the square, in rotation. Pure in (world, seed, day): the same day of
// the same world is the same news, and the next day's differs.
//
//   crierNews(world, seed, day) -> string[]
//     the market of the day, the weather, something about a townsperson (all
//     rolled from the seed and the day), then what the player has done: every
//     finished tale (world.tales, one item per kind, in the tale's own words:
//     its newsWord, else its landWord; none, no item), Päivölä solved
//     (world.solved), and the day after the stocks (world.stocksDay, set by
//     law.js seat) the ruffian who sat in them.
//   datedNews(world, day) -> string[]
//     the items good for that day only (the stocks): the crier's first calls
//     of the day, before the round goes on
//
// The crier scene (scenes.js) calls the next item at each call, a call every
// 20 s while he is at his box; the round carries on from day to day. From
// project 3 on the questline adds items.
import { hash, hashInt } from '../rand.js'
import { TALES, TALE_IDS } from '../../data/tales.js'
import { rollTownsfolk } from './folk.js'
import { cityFor } from './build.js'

const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

// ---- the market -------------------------------------------------------------------

const GOODS = ['rye bread', 'salt herring', 'cabbages', 'onions', 'honey', 'wool', 'pine tar', 'lingonberries', 'candles', 'new nets', 'cheese', 'dried peas', 'barley', 'smoked mutton']
const FISH = ['herring', 'perch', 'pike', 'whitefish', 'smoked eel']
const MARKET = [
  g => `Hear ye! Market on the square today! ${cap(g[0])} and ${g[1]}. And turnips.`,
  g => `Hear ye! Market on the square today! ${cap(g[0])}, ${g[1]} and ${g[2]}.`,
  (g, f) => `Hear ye! Market today! ${cap(g[0])} at the stalls, ${f} at the fish market.`,
  g => `Hear ye! Market on the square today! ${cap(g[0])} from the north, and ${g[1]} from who knows where.`,
]
function market(seed, day) {
  const g = []
  for (let i = 0; g.length < 3; i++) {
    const x = GOODS[hashInt(seed, day, i, 971) % GOODS.length]
    if (!g.includes(x)) g.push(x)
  }
  return MARKET[hashInt(seed, day, 0, 972) % MARKET.length](g, FISH[hashInt(seed, day, 0, 973) % FISH.length])
}

// ---- the weather (talk only: the game has no rain) --------------------------------

const WEATHER = [
  'Hear ye! Wind from the west today, and rain by evening, the fishers say.',
  'Hear ye! Fair skies today. Make the most of them.',
  'Hear ye! A cold night coming. Bring the goats in.',
  'Hear ye! Fine and dry today, they say. They said that yesterday.',
  'Hear ye! Wind from the east. Hold on to your hats.',
  'Hear ye! Fog on the water at dawn. The boats will be late, and so will the herring.',
  'Hear ye! Rain later, or not. The vicar\'s knee cannot decide.',
]
const weather = (seed, day) => WEATHER[hashInt(seed, day, 0, 974) % WEATHER.length]

// ---- a townsperson ----------------------------------------------------------------

const WHO = {
  stallholder: 'the stallholder', baker: 'the baker', butcher: 'the butcher', fisher: 'the fisher', 'net-mender': 'the net mender',
  sailor: 'the sailor', porter: 'the porter', apprentice: 'the smith\'s apprentice', weaver: 'the weaver', dyer: 'the dyer',
  tanner: 'the tanner', miller: 'the miller', carter: 'the carter', washer: 'the washer', lamplighter: 'the lamplighter',
  'bell-ringer': 'the bell-ringer', server: 'from the Golden Pike',
}
const who = p => p.job === 'elder' ? `old ${p.name}` : `${p.name} ${WHO[p.job]}`
const FOLK = [
  p => `Hear ye! ${cap(who(p))} has lost a goat. It answers to nothing.`,
  p => `Hear ye! Whoever borrowed ${p.name}'s ladder, ${p.name} would like it back.`,
  p => `Hear ye! ${cap(who(p))} has a birthday today. Do not ask which.`,
  p => `Hear ye! ${cap(who(p))} found a coin in a herring. Nobody else has.`,
  p => `Hear ye! ${cap(who(p))} is to be wed at the bell tomorrow. Bring your own bench.`,
  p => `Hear ye! ${cap(who(p))} has kittens to give away. Five of them. Ask soon.`,
  p => `Hear ye! ${cap(who(p))} says the well water tastes of iron. Seppo says that is the point.`,
]
// the townsfolk the crier may speak of: grown-ups with a trade or a bench (not the beggars, not the children)
const folkCache = new WeakMap()
function aboutWhom(seed) {
  const city = cityFor(seed)
  let list = folkCache.get(city)
  if (!list) folkCache.set(city, list = rollTownsfolk(seed, city).filter(p => p.job === 'elder' || WHO[p.job]))
  return list
}
function townsperson(seed, day) {
  const list = aboutWhom(seed)
  const p = list[Math.floor(hash(seed, day, 0, 975) * list.length)]
  return FOLK[hashInt(seed, day, 1, 975) % FOLK.length](p)
}

// ---- what the player did ----------------------------------------------------------

// a tale's place in the news: its own word for it (newsWord), else the land it lies in
const taleWord = tale => tale?.newsWord ?? tale?.landWord ?? null
const taleNews = word => `Hear ye! ${cap(word)} is safe again, they say, thanks to a stranger.`
export const SUN_NEWS = 'Hear ye! The sun is back in Päivölä, they say, thanks to a stranger.'
export const STOCKS_NEWS = 'A ruffian sat in the stocks yesterday! Mind your manners in Kalevanlinna.'

export const datedNews = (world, day) => Number.isInteger(world.stocksDay) && day - world.stocksDay === 1 ? [STOCKS_NEWS] : []

export function crierNews(world, seed, day) {
  const out = [market(seed, day), weather(seed, day), townsperson(seed, day)]
  const done = new Set()
  for (const t of world.tales?.values() ?? []) if (t.done) done.add(t.id)
  for (const id of TALE_IDS) {
    const word = done.has(id) ? taleWord(TALES[id]) : null
    if (word) out.push(taleNews(word))
  }
  if (world.solved?.size) out.push(SUN_NEWS)
  out.push(...datedNews(world, day))
  return out
}
