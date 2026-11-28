// The day's heat in the desert: from HEAT.from to HEAT.to of the day, on
// the desert's own country (the tile's country, whatever lies on the cell:
// a road through the sand is hot too) out of a village and off
// Kalevanlinna's ground, the hero's stamina comes back at HEAT.factor of its
// rate (systems/stamina.js player.regenScale). Pure and DOM-free; game.js
// asks once a frame (tickHeat), beside the storm, and the weather pass draws
// a faint shimmer at the screen's edges from what it leaves on the state
// (state.heat, systems/weather.js look.heat, render/weather.js drawHeat).
//
// What cools:
// - shade and water: within `coolReach` tiles (each way, so a square) of a
//   well, water or a palm's foot (nearCool);
// - a storm, which hides the sun (wilds/storm.js state.storm);
// - a village pad, and Kalevanlinna;
// - a drink: being beside a well or water (the eight cells round the hero)
//   for `drinkAfter` seconds, in the desert's country, keeps the heat off
//   for `drinkFor` seconds of play and is heard (`drink`). No key and no
//   need to stand still; one drink each time he comes to it.
// Never indoors (house, cave, building) and never on top of the coach: the
// regain is whole there.
//
// The first time the heat is on in a day (world.day) the hero says `line`,
// in the thought bubble the tales' remarks use (wilds/tale-run.js remark)
// and, like them, only when it is free: a busy bubble puts it off until it
// is free while the heat is still on that day. world.heatSaid holds the day
// it was said; it is not saved, so a load may say it again.
import { DAY_LENGTH } from '../data/weather.js'
import { isWaterSkin } from '../terrain/lib.js'
import { think } from '../systems/feedback.js'
import { sfx } from '../systems/sfx.js'
import { TILE } from '../systems/entities.js'
import { wornPower } from '../systems/worn.js'

// `drinkAfter`: seconds beside the water that make a drink; `fade`: seconds
// the shimmer takes to come and go with the heat.
export const HEAT = { from: 0.30, to: 0.70, factor: 0.5, coolReach: 3, drinkFor: 90, line: 'The sun is merciless out here.', drinkAfter: 1, fade: 1 }

// What cools:
// - a well, by the names on a cell (its skin, deco or overlay): ow_well and
//   the ow_well_top above it (sites.js, city/kit.js);
// - water, by the same: what terrain/lib.js isWaterSkin calls water, open
//   water ow_water_* and the rims of its banks ow_pond_*, ow_shore_*,
//   ow_mud_* (shore-art.js names its banks' water cells in those families;
//   an oasis's pond is dug with setWater, features.js);
// - a palm's foot: a blocked cell whose overlay has `palm` in its name, so
//   every palm cools, those to come too (the landmark palms ow_landmark_palm*):
//   today the two-cell palm's trunk ow_tree_palm and the one-cell date palm
//   ow_tree_palm_small (terrain.js PALMS, sites.js PALM). A palm's crown is a
//   blocked cell too, above its foot; it is kept out by its name, which ends
//   in `_top` as an upper cell's does (ow_tree_palm_top).
// None of them moves: a palm is not in the lumber table (systems/lumber.js
// TREES) and nothing in the Wilds lays or drains water in the desert.
const isWell = n => typeof n === 'string' && n.startsWith('ow_well')
const drinkable = n => isWell(n) || isWaterSkin(n)
const hasName = (c, test) => test(c.skin) || test(c.deco) || test(c.overlay)
const isPalmFoot = c => c.tile === TILE.WALL && typeof c.overlay === 'string' && c.overlay.includes('palm') && !c.overlay.endsWith('_top')
const drinksAt = c => hasName(c, drinkable)
const coolsAt = c => drinksAt(c) || isPalmFoot(c)

// Whether a cell within `r` tiles of (x, y) each way passes `test`.
function within(map, x, y, r, test) {
  for (let dy = -r; dy <= r; dy++) {
    const row = map[y + dy]
    if (!row) continue
    for (let dx = -r; dx <= r; dx++) { const c = row[x + dx]; if (c && test(c)) return true }
  }
  return false
}

// In the cool: within coolReach of a well, water or a palm's foot.
export const nearCool = (map, x, y) => within(map, x, y, HEAT.coolReach, coolsAt)
// Where he drinks: beside a well or water (his own cell and the eight round it).
export const besideWater = (map, x, y) => within(map, x, y, 1, drinksAt)

// Whether the heat is on: by day (from <= frac < to) on the desert's country,
// out of a village and Kalevanlinna, not in the cool, no storm blowing, and
// no drink still keeping it off (`now` and `cooledUntil` in seconds of play).
export function heatOn({ desert, frac, storm = 0, village = false, city = false, cool = false, cooledUntil, now = 0 }) {
  if (!desert || village || city || cool || storm > 0) return false
  if (now < (cooledUntil ?? -Infinity)) return false
  return frac >= HEAT.from && frac < HEAT.to
}

// The cool and the water at the hero's cell, asked again only when he steps
// onto another cell or the map is another (a re-centre, a house).
let here = null
function cellAt(map, x, y) {
  if (here?.map !== map || here.x !== x || here.y !== y) here = { map, x, y, cool: nearCool(map, x, y), water: besideWater(map, x, y) }
  return here
}

// Once a frame in the Wilds, out of doors or in: the heat on the hero.
// Sets player.regenScale (HEAT.factor while the heat is on, else 1),
// player.cooledUntil on a drink, and state.heat (0..1, the shimmer: it
// follows the heat over HEAT.fade seconds, and is 0 at once indoors and on
// the coach). `desert`, `village` and `city` are where the hero stands
// (session.js landOf); `clock` is the day clock. Returns whether it is on.
export function tickHeat(state, world, { clock, delta = 0, desert = false, village = false, city = false }) {
  const { player } = state
  const outdoors = !state.cave && !player.riding
  const at = outdoors && state.map ? cellAt(state.map, player.x, player.y) : null
  const now = world.playtime
  // a drink: beside a well or water in the desert's country, once each time he comes to it
  if (at?.water && desert && !city) {
    if (!state.drank && (state.drinkT = (state.drinkT ?? 0) + delta) >= HEAT.drinkAfter) {
      state.drank = true
      player.cooledUntil = now + HEAT.drinkFor
      sfx(state, 'drink')
    }
  } else {
    state.drinkT = 0
    state.drank = false
  }
  const on = !!at && heatOn({
    desert, frac: clock / DAY_LENGTH, storm: state.storm ?? 0, village, city, cool: at.cool, cooledUntil: player.cooledUntil, now,
  })
  // (a Desert Headcloth keeps the sun off its wearer: the day is as hot, he is not)
  player.regenScale = on && !wornPower(player, 'cool') ? HEAT.factor : 1
  const was = state.heat ?? 0, step = delta / HEAT.fade
  state.heat = !outdoors ? 0 : on ? Math.min(1, was + step) : Math.max(0, was - step)
  // the line, once a day, when the bubble is free
  const day = world.day ?? 0
  if (on && world.heatSaid !== day && state.feedback && !state.feedback.bubble) {
    think(state, HEAT.line)
    world.heatSaid = day
  }
  return on
}
