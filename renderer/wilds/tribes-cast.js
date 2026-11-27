// Where the three tribes live (data/tribes.js): the tables the Wilds' dealing
// (features.js) draws from on a tribe's country, beside the land's own
// wolves, bears and spiders. Judged at the spot, as the desert's cast is
// (desert-cast.js): the trolls hold the mountains, the coven the marsh, the
// seal folk the sea's shores. Nothing of a tribe is dealt on forest, autumn
// or desert country, nor in the ring round home. DOM-free and pure.
//
//   mohkale, louhija, rumpali     the trolls' Lump, Quarrier and drummer
//   vuorenkuningas                the Mountain King, in his hall
//   para, noita, kuppari, kyy     the coven's errand-thing, witch, cupping-woman and viper
//   syojatar                      the mother of snakes, at her sabbath
//   norppakauppias, norppalaulaja, norppavahti   the seals' trader, singer and guard
//   mursu, kumistin               the walrus and the gong of his court
//
// Everybody of a tribe is dealt with a `home` (piece tiles): the middle of
// its camp or seat, or where its pack was posted.
//
// The switch is for tests (the land deals as it did before with it off); it
// is on, as desert-cast.js setDesertCast is.
import { TRIBES, WARES, MEMBERS } from '../data/tribes.js'

let on = true
export const tribes = () => on
export const setTribes = v => { on = !!v }

// The tribe of a country (wilds/layout.js BIOMES), or null: for a country
// that has none, and for every country with the switch off.
const BY_COUNTRY = Object.fromEntries(Object.entries(TRIBES).map(([key, tribe]) => [tribe.country, key]))
export const tribeAt = biome => (on && BY_COUNTRY[biome]) || null

// The tribe a spawn kind belongs to, or null.
const BY_KIND = new Map(Object.entries(MEMBERS).flatMap(([tribe, names]) => names.map(name => [name, tribe])))
export const TRIBE_KINDS = new Set(BY_KIND.keys())
export const tribeOfKind = kind => BY_KIND.get(kind) ?? null

const lump = { kind: 'mohkale' }, quarrier = { kind: 'louhija' }, drummer = { kind: 'rumpali' }, king = { kind: 'vuorenkuningas' }
const para = { kind: 'para' }, witch = { kind: 'noita' }, cupper = { kind: 'kuppari' }, viper = { kind: 'kyy' }, mother = { kind: 'syojatar' }
const trader = { kind: 'norppakauppias' }, singer = { kind: 'norppalaulaja' }, guard = { kind: 'norppavahti' }
const walrus = { kind: 'mursu' }, gong = { kind: 'kumistin' }

// Roaming packs by toughness, added to the row the land's own table has
// (features.js PACKS). Row 0, the ring round home and farmland, is empty, and
// a village's gentle packs never hold a tribe. The seals keep to their camps.
// A tribe's pack is kept PACK_ODDS of the times the pick lands on it (else
// one of the land's own is dealt), so that a tribe is met on fewer than half
// of its country's pieces: a people, not the weather.
export const PACK_ODDS = 0.4
export const TRIBE_PACKS = {
  peikot: [
    [],
    [[lump]],
    [[lump, lump], [lump, quarrier]],
    [[lump, lump, drummer], [lump, quarrier, drummer]],
    [[lump, lump, lump, quarrier, drummer]],
  ],
  noidat: [
    [],
    [[para], [para, para]],
    [[para, para, para], [witch, para]],
    [[witch, cupper], [witch, para, para]],
    [[witch, witch, cupper]],
  ],
  norpat: [[], [], [], [], []],
}

// Camps by the lowest toughness they appear at, in features.js CAMPS' shape
// and with its looks. A tribe's camp is listed COPIES times (or its own
// `copies`) among the land's own for its toughness, so that about half the
// camps of its country are the tribe's: twice each for the trolls' two and
// the coven's two, six times for the seals' one, who have no packs to be met
// by. It holds its roster whole: each of `foes` once, the first `lead` of
// them nearest the fire.
//   lit       a fire burns in its middle (the bandits' look has its own)
//   friendly  a haven: no chest, and no pack is dealt near it
//   vendor    who sits there on a mat with three wares before him (pickWares)
export const COPIES = 2
export const TRIBE_CAMPS = {
  peikot: [
    { from: 1, name: 'trolls', tribe: 'peikot', look: 'den', lit: true, foes: [lump, lump, quarrier] },
    { from: 2, name: 'warband', tribe: 'peikot', look: 'den', lit: true, foes: [drummer, lump, lump, quarrier], lead: 1 },
  ],
  noidat: [
    { from: 1, name: 'paras', tribe: 'noidat', look: 'graves', lit: true, foes: [witch, para, para], lead: 1 },
    { from: 2, name: 'coven', tribe: 'noidat', look: 'graves', lit: true, foes: [witch, cupper, para, para, viper, viper], lead: 2 },
  ],
  norpat: [
    { from: 1, name: 'seals', tribe: 'norpat', look: 'bandits', copies: 6, friendly: true, vendor: trader, foes: [singer, guard, guard] },
  ],
}

// A tribe's seat: where an open-world boss is dealt on its country, `odds` of
// the times (else the ogre's lair, as anywhere).
//   site    what sites.js builds: 'hall', 'sabbath', 'court'
//   boss    who sits there, on the site's seat
//   foes    the retinue, each once; `more` joins it from a toughness on. A
//           court's stand outside its ring, the first of them (the singer)
//           by the tents
//   gong    the court's: what calls the walrus to a bout
//   vendor, friendly   as a camp's
export const TRIBE_SEATS = {
  peikot: { site: 'hall', odds: 0.6, boss: king, foes: [drummer, lump], more: [{ from: 3, foe: quarrier }] },
  noidat: { site: 'sabbath', odds: 0.6, boss: mother, foes: [cupper, witch] },
  norpat: { site: 'court', odds: 0.6, friendly: true, boss: walrus, gong, vendor: trader, foes: [singer, guard, guard, guard] },
}

// What a trader lays out: three different wares of data/tribes.js WARES, by
// three draws of the piece's rng.
export function pickWares(rng) {
  const left = [...WARES], out = []
  while (out.length < 3) out.push(left.splice(Math.floor(rng() * left.length), 1)[0])
  return out
}
// The spawn of one ware at (x, y) (game.js buildEntities, systems/trade.js).
export const wareSpawn = (tribe, ware, x, y) => ({
  kind: 'ware', tribe, price: { ...ware.price }, ...(ware.loot ? { loot: true } : { contents: { ...ware.contents } }), x, y,
})
