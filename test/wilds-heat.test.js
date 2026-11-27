// The day's heat in the Wilds' desert (wilds/heat.js): when it is on, what
// cools (shade, water, a storm, a village, Kalevanlinna, a drink), what it
// does to the stamina, the drink, the hero's one line a day, and the
// shimmer it leaves for the weather pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HEAT, heatOn, nearCool, tickHeat } from '../renderer/wilds/heat.js'
import { tickStamina } from '../renderer/systems/stamina.js'
import { weatherLook } from '../renderer/systems/weather.js'
import { buildCaveState, restoreSurface } from '../renderer/systems/cave.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makeFeedback, think, tickFeedback } from '../renderer/systems/feedback.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const NOON = 0.5 * DAY_LENGTH
const S = 32
// open sand out of a village at noon, nothing near
const OPEN = { desert: true, frac: 0.5, storm: 0, village: false, city: false, cool: false, cooledUntil: -Infinity, now: 100 }
const DESERT = { desert: true, village: false, city: false }

// A 40 x 20 stretch of open sand; `put` lays a name on a cell's overlay
// (wells and palms stand there) or its skin (water lies there).
function sandMap() {
  const map = createMap(40, 20)
  for (const row of map) for (const c of row) { c.tile = TILE.FLOOR; c.skin = 'ow_sand_0' }
  return map
}
const putOver = (map, x, y, name) => { map[y][x].overlay = name; map[y][x].tile = TILE.WALL }
const putSkin = (map, x, y, name) => { map[y][x].skin = name; map[y][x].tile = TILE.WALL }
function heroAt(state, x, y) {
  Object.assign(state.player, { x, y, px: x * S + S / 2, py: y * S + S / 2 })
}
const freshState = (map = sandMap(), x = 30, y = 10) => {
  const state = { map, player: { x: 0, y: 0, px: 0, py: 0 }, entities: [], sfx: makeSfx(), feedback: makeFeedback() }
  heroAt(state, x, y)
  return state
}
const freshWorld = () => ({ seed: 7, day: 3, playtime: 1000 })
// `secs` of frames at `dt` with the clock held at `clock`.
function frames(state, world, secs, { clock = NOON, dt = 0.1, ...land } = {}) {
  for (let t = 0; t < secs - 1e-9; t += dt) {
    world.playtime += dt
    tickHeat(state, world, { clock, delta: dt, ...DESERT, ...land })
  }
}
const drinks = state => state.sfx.cues.filter(c => c.name === 'drink').length

test('heat by day on open sand', () => {
  assert.equal(heatOn(OPEN), true)
  assert.equal(heatOn({ ...OPEN, frac: 0.25 }), false)
  assert.equal(heatOn({ ...OPEN, frac: 0.75 }), false)
  // its edges: from 0.30, gone by 0.70
  assert.equal(heatOn({ ...OPEN, frac: HEAT.from }), true)
  assert.equal(heatOn({ ...OPEN, frac: HEAT.to }), false)
  // off the desert's own country there is none
  assert.equal(heatOn({ ...OPEN, desert: false }), false)
})

test('shade, water, storms and villages cool', () => {
  assert.equal(heatOn({ ...OPEN, cool: true }), false)
  assert.equal(heatOn({ ...OPEN, storm: 0.3 }), false)
  assert.equal(heatOn({ ...OPEN, village: true }), false)
  assert.equal(heatOn({ ...OPEN, cooledUntil: 150 }), false)
  // nor inside Kalevanlinna, whose walls hold patches of desert country on some seeds
  assert.equal(heatOn({ ...OPEN, city: true }), false)
  // a drink worn off is no drink
  assert.equal(heatOn({ ...OPEN, cooledUntil: 99 }), true)
})

test('stamina regains at half rate in the heat', () => {
  const regained = scale => {
    // past the delay after the last spend, with room to fill
    const player = { stamina: 10, maxStamina: 100, staminaRegenT: 5, ...(scale !== undefined && { regenScale: scale }) }
    tickStamina(player, 1)
    return player.stamina - 10
  }
  const cool = regained(1), hot = regained(HEAT.factor)
  assert.ok(cool > 0)
  assert.ok(Math.abs(hot - cool / 2) < 1e-9, `${hot} in the heat against ${cool}`)
  // a player that never had a scale (the PvP arena's heroes, Dungeon Rush) regains in full
  assert.ok(Math.abs(regained(undefined) - cool) < 1e-9)
})

test('nearCool finds a well and a palm', () => {
  const map = sandMap()
  // a well: its foot and the top above it
  putOver(map, 5, 10, 'ow_well'); putOver(map, 5, 9, 'ow_well_top')
  assert.equal(nearCool(map, 8, 10), true, '3 tiles east of the well')
  assert.equal(nearCool(map, 9, 10), false, '4 tiles east')
  assert.equal(nearCool(map, 8, 13), true, 'three each way is within three (Chebyshev)')
  assert.equal(nearCool(map, 5, 14), false, '4 below the foot')
  // a two-cell palm: its foot is the trunk, not the crown above it
  putOver(map, 20, 10, 'ow_tree_palm'); putOver(map, 20, 9, 'ow_tree_palm_top')
  assert.equal(nearCool(map, 23, 10), true, '3 tiles from the trunk')
  assert.equal(nearCool(map, 24, 10), false, '4 tiles from the trunk')
  assert.equal(nearCool(map, 20, 6), false, '3 above the crown, 4 above the trunk')
  // the one-cell date palm is its own foot
  putOver(map, 30, 3, 'ow_tree_palm_small')
  assert.equal(nearCool(map, 33, 3), true)
  assert.equal(nearCool(map, 34, 3), false)
  // an oasis's water: open water and its banks
  putSkin(map, 30, 16, 'ow_water_0'); putSkin(map, 29, 16, 'ow_pond_01')
  assert.equal(nearCool(map, 26, 16), true, '3 from the bank')
  assert.equal(nearCool(map, 25, 16), false, '4 from the bank')
  assert.equal(nearCool(map, 33, 16), true, '3 from the open water')
  // nothing else cools: a cactus, a dead tree
  const bare = sandMap()
  putOver(bare, 10, 10, 'ow_cactus'); putOver(bare, 11, 10, 'ow_deadtree_0')
  assert.equal(nearCool(bare, 10, 11), false)
})

test('every palm cools: a blocked cell with palm in its overlay\'s name, never its crown or a walkable cell', () => {
  const map = sandMap()
  // a landmark palm a later task adds
  putOver(map, 10, 10, 'ow_landmark_palm_0')
  assert.equal(nearCool(map, 13, 10), true, '3 tiles from the landmark palm')
  assert.equal(nearCool(map, 14, 10), false, '4 tiles from it')
  // a palm name on a cell one walks on does not cool
  const flat = sandMap()
  flat[10][10].overlay = 'ow_landmark_palm_0'
  assert.equal(flat[10][10].tile, TILE.FLOOR)
  assert.equal(nearCool(flat, 11, 10), false)
  // a crown alone is no foot: it is blocked, but its name ends in _top
  const crown = sandMap()
  putOver(crown, 10, 10, 'ow_tree_palm_top')
  assert.equal(nearCool(crown, 11, 10), false)
})

test('tickHeat halves the regain on open sand at noon, and nowhere cool', () => {
  const scaleWith = (setup, opts = {}) => {
    const state = freshState(), world = freshWorld()
    setup?.(state, world)
    tickHeat(state, world, { clock: NOON, delta: 0.1, ...DESERT, ...opts })
    return state.player.regenScale
  }
  assert.equal(scaleWith(), HEAT.factor, 'open sand at noon')
  assert.equal(scaleWith(null, { clock: 0.25 * DAY_LENGTH }), 1, 'dawn')
  assert.equal(scaleWith(null, { clock: 0.75 * DAY_LENGTH }), 1, 'dusk')
  assert.equal(scaleWith(null, { desert: false }), 1, 'off the desert')
  assert.equal(scaleWith(null, { village: true }), 1, 'in a village')
  assert.equal(scaleWith(null, { city: true }), 1, 'in Kalevanlinna')
  assert.equal(scaleWith(s => { s.storm = 0.4 }), 1, 'in a storm')
  assert.equal(scaleWith(s => putOver(s.map, 33, 10, 'ow_tree_palm_small')), 1, 'by a palm')
  assert.equal(scaleWith(s => putSkin(s.map, 30, 13, 'ow_water_1')), 1, 'by water')
  assert.equal(scaleWith((s, w) => { s.player.cooledUntil = w.playtime + 30 }), 1, 'after a drink')
  assert.equal(scaleWith(s => { s.player.riding = true }), 1, 'on the coach')
  // carried indoors mid-heat, the house's state gets 1; out again, the sun is back
  const state = freshState(), world = freshWorld()
  frames(state, world, 2)
  assert.equal(state.player.regenScale, HEAT.factor)
  const house = buildCaveState(state, { x: 30, y: 10, caveDepth: 19, label: 'house:wilds:1,1' },
    { map: createMap(6, 6), entities: [], playerSpawn: { x: 2, y: 2 }, theme: null, exit: { x: 2, y: 3 } })
  assert.equal(house.player.regenScale, HEAT.factor, 'the player is copied in as he was')
  tickHeat(house, world, { clock: NOON, delta: 0.1, ...DESERT })
  assert.equal(house.player.regenScale, 1)
  assert.equal(house.heat, 0, 'no shimmer indoors')
  const out = restoreSurface(house)
  tickHeat(out, world, { clock: NOON, delta: 0.1, ...DESERT })
  assert.equal(out.player.regenScale, HEAT.factor)
})

test('a drink keeps the heat off for 90 s', () => {
  const state = freshState(), world = freshWorld()
  putOver(state.map, 5, 10, 'ow_well'); putOver(state.map, 5, 9, 'ow_well_top')
  heroAt(state, 6, 10)   // beside the well
  frames(state, world, HEAT.drinkAfter + 0.05)
  assert.equal(drinks(state), 1)
  const drankAt = world.playtime
  assert.ok(Math.abs(state.player.cooledUntil - (drankAt + HEAT.drinkFor)) < 0.2)
  // out onto open sand, far from the well and any shade
  heroAt(state, 30, 10)
  world.playtime = state.player.cooledUntil - 1   // +89 s
  tickHeat(state, world, { clock: NOON, delta: 0.1, ...DESERT })
  assert.equal(state.player.regenScale, 1, 'still cool at +89 s')
  world.playtime = state.player.cooledUntil + 1   // +91 s
  tickHeat(state, world, { clock: NOON, delta: 0.1, ...DESERT })
  assert.equal(state.player.regenScale, HEAT.factor, 'hot again at +91 s')
})

test('one drink per approach', () => {
  const state = freshState(), world = freshWorld()
  putSkin(state.map, 10, 10, 'ow_water_0')
  heroAt(state, 11, 11)   // diagonally beside the water
  frames(state, world, HEAT.drinkAfter - 0.2)
  assert.equal(drinks(state), 0, 'not yet a second')
  // along the bank, still beside the water: the time runs on
  heroAt(state, 11, 10)
  frames(state, world, 0.3)
  assert.equal(drinks(state), 1, 'a second beside the water is a drink')
  frames(state, world, 5)
  assert.equal(drinks(state), 1, 'waiting by it is no second drink')
  // away (two cells off is not beside) and back
  heroAt(state, 12, 10)
  frames(state, world, 0.2)
  heroAt(state, 11, 10)
  frames(state, world, HEAT.drinkAfter + 0.05)
  assert.equal(drinks(state), 2, 'back again, another')
  // stepping away before the second is up gives none
  heroAt(state, 13, 10)
  frames(state, world, 0.2)
  heroAt(state, 11, 10)
  frames(state, world, 0.5)
  heroAt(state, 13, 10)
  frames(state, world, 0.2)
  heroAt(state, 11, 10)
  frames(state, world, 0.5)
  assert.equal(drinks(state), 2, 'two half seconds are no drink')
})

test('the line once a day', () => {
  const state = freshState(), world = freshWorld()
  putOver(state.map, 20, 10, 'ow_tree_palm_small')
  const lines = []
  // a second of frames, noting each line as it is said and clearing the bubble after it
  const step = (clock, secs = 1) => {
    for (let t = 0; t < secs - 1e-9; t += 0.1) {
      world.playtime += 0.1
      tickHeat(state, world, { clock, delta: 0.1, ...DESERT })
      if (state.feedback.bubble) lines.push(state.feedback.bubble.text)
      state.feedback.bubble = null
    }
  }
  step(NOON)
  assert.deepEqual(lines, [HEAT.line], 'said as the heat comes on')
  // into the palm's shade and out again: the heat comes on a second time that day, unsaid
  heroAt(state, 21, 10)
  step(NOON)
  assert.equal(state.player.regenScale, 1, 'cool in the shade')
  heroAt(state, 30, 10)
  step(NOON)
  assert.equal(state.player.regenScale, HEAT.factor, 'the heat is back on')
  assert.deepEqual(lines, [HEAT.line], 'said once that day')
  // the next day, again
  world.day += 1
  step(0.75 * DAY_LENGTH)
  step(NOON)
  assert.deepEqual(lines, [HEAT.line, HEAT.line])
})

test('the line waits for a busy bubble, then is said once', () => {
  const state = freshState(), world = freshWorld()
  const tick = () => {
    world.playtime += 0.1
    tickHeat(state, world, { clock: NOON, delta: 0.1, ...DESERT })
    tickFeedback(state.feedback, 0.1)
  }
  // a tale's remark is up as the heat comes on: it is not talked over
  think(state, 'Something stirs by the water.')
  const remark = state.feedback.bubble
  for (let i = 0; i < 15; i++) { tick(); assert.ok(state.feedback.bubble === remark, `talked over after ${i + 1} frames`) }
  // once it is over the line is said, in the bubble the remarks use
  for (let i = 0; i < 10 && state.feedback.bubble?.text !== HEAT.line; i++) tick()
  assert.equal(state.feedback.bubble?.text, HEAT.line)
  assert.equal(state.feedback.bubble.kind, 'thought')
  // and only once
  let again = 0
  for (let i = 0; i < 100; i++) { const was = state.feedback.bubble; tick(); const b = state.feedback.bubble; if (b && b !== was && b.text === HEAT.line) again++ }
  assert.equal(again, 0)
  // a line that never found the bubble free is not counted as said: busy the
  // whole time the heat is on, it is said at the next onset that day
  const s2 = freshState(), w2 = freshWorld()
  for (let i = 0; i < 20; i++) { w2.playtime += 0.1; s2.feedback.bubble = { text: 'busy', kind: 'speech', t: 0 }; tickHeat(s2, w2, { clock: NOON, delta: 0.1, ...DESERT }) }
  assert.equal(s2.feedback.bubble.text, 'busy')
  s2.feedback.bubble = null
  tickHeat(s2, w2, { clock: 0.75 * DAY_LENGTH, delta: 0.1, ...DESERT })
  assert.equal(s2.feedback.bubble, null, 'not at dusk')
  tickHeat(s2, w2, { clock: NOON, delta: 0.1, ...DESERT })
  assert.equal(s2.feedback.bubble?.text, HEAT.line)
})

test('the shimmer fades in and out over about a second, and goes at once indoors', () => {
  const state = freshState(), world = freshWorld()
  frames(state, world, 0.5)
  assert.ok(state.heat > 0.3 && state.heat < 0.7, `half a second in: ${state.heat}`)
  frames(state, world, 0.6)
  assert.equal(state.heat, 1)
  frames(state, world, 0.5, { clock: 0.75 * DAY_LENGTH })
  assert.ok(state.heat > 0.3 && state.heat < 0.7, `half a second after: ${state.heat}`)
  frames(state, world, 0.6, { clock: 0.75 * DAY_LENGTH })
  assert.equal(state.heat, 0)
  // the look carries it while it is on, and only then
  state.weather = { dayCycle: true, t: 0, lightningT: 0, fog: null }
  assert.equal(weatherLook(state, { clock: 0.75 * DAY_LENGTH }).heat, 0)
  frames(state, world, 2)
  assert.equal(weatherLook(state, { clock: NOON }).heat, 1)
  // on the coach it is gone at once
  state.player.riding = true
  tickHeat(state, world, { clock: NOON, delta: 0.1, ...DESERT })
  assert.equal(state.heat, 0)
})
