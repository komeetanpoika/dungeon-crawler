// What the things of a Wilds piece look like: houses of several sizes, a
// village with a field and a stall, the farms of farmland, the wayside places
// and milestones of the roads, a ruined keep, camps dressed for whoever camps
// there, a cave mouth in an outcrop. Stamps
// only: features.js decides what goes where, opens the ground and lays the
// paths first.
//
// Three kinds of tile art, by name:
//   ow_prop_*, ow_fence_*   low things: they block the way, a sight line passes over
//   ow_deco_*               flat things: walked on
//   everything else         solid, and hides what is behind it
//
// The house kit is Tiny Town's: two rows of roof (a chimney up top, a gable
// over the door), then one or two rows of wall with windows and the door.
// A village in the desert is built from the desert kit instead
// (tools/make-wilds-desert-tiles.mjs draws it): flat-roofed mud-brick houses
// of the same rows, a roof hatch or a vent pot where the chimney would be and
// a stepped parapet over the door where the gable would be.
// The crossroads inn and its stable are Kalevanlinna's (inn.js), and in the
// desert a caravanserai of the desert kit with a pen for its horses.
import { INN_PLANS, INN_PAD, INN_SHIFT, INN_SKINS, innFootprint, innMirrored, makeInnStamps, awnings } from './inn.js'
import { PAVE_SKINS, PAVE_VARIANTS, paveSkin, paveEdgeSkin, isPaveSkin } from './desert-art.js'

const ROOF = {
  red: { top: ['ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r'], low: ['ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er'], chim: 'ow_roof_red_chim', gable: 'ow_roof_gable_red' },
  blue: { top: ['ow_roof_blue_l', 'ow_roof_blue_m', 'ow_roof_blue_r'], low: ['ow_roof_blue_el', 'ow_roof_blue_em', 'ow_roof_blue_er'], chim: 'ow_roof_blue_chim', gable: 'ow_roof_gable_gray' },
}
const WALL = {
  stone: { l: 'ow_house_wall_stone_l', m: 'ow_house_wall_stone', r: 'ow_house_wall_stone_r', win: 'ow_house_win_stone', door: 'ow_house_door_2', dbl: ['ow_house_dbl_stone_l', 'ow_house_dbl_stone_r'] },
  wood: { l: 'ow_house_wall_brown_l', m: 'ow_house_wall_brown', r: 'ow_house_wall_brown_r', win: 'ow_house_win_brown', door: 'ow_house_door', dbl: ['ow_house_dbl_brown_l', 'ow_house_dbl_brown_r'] },
}
// The desert kit, by the same draws: the roof's draw picks what stands on the
// flat roof where a chimney would (a wooden hatch, a clay vent pot), the
// wall's the colour of the woodwork (painted blue, bare wood). Every roof
// has a parapet round it, and a stepped one over the door. An upper storey
// (`up`) has the ends of its floor beams along its foot. The crossroads inn
// (inn.js) is built of it too, with a plain upper storey (`up.m`) and its
// gateway: the arch rising through the upper storey (`up.arch`) over the
// tall gate that is its door (`gate`).
const ADOBE_ROOF = { top: ['ow_roof_adobe_l', 'ow_roof_adobe_m', 'ow_roof_adobe_r'], low: ['ow_roof_adobe_el', 'ow_roof_adobe_em', 'ow_roof_adobe_er'], gable: 'ow_roof_adobe_step' }
ROOF.adobe = { red: { ...ADOBE_ROOF, chim: 'ow_roof_adobe_hatch' }, blue: { ...ADOBE_ROOF, chim: 'ow_roof_adobe_pot' } }
const adobeWall = trim => ({
  l: 'ow_house_adobe_wall_l', m: 'ow_house_adobe_wall', r: 'ow_house_adobe_wall_r',
  win: `ow_house_adobe_win${trim}`, door: `ow_house_adobe_door${trim}`, dbl: [`ow_house_adobe_dbl${trim}_l`, `ow_house_adobe_dbl${trim}_r`],
  up: { l: 'ow_house_adobe_up_l', win: `ow_house_adobe_up_win${trim}`, r: 'ow_house_adobe_up_r', m: 'ow_house_adobe_up', arch: 'ow_house_adobe_up_arch' },
  gate: `ow_house_adobe_gate${trim}`,
})
WALL.adobe = { stone: adobeWall('_blue'), wood: adobeWall('') }
const KIT_ROOFS = [ROOF.red, ROOF.blue, ...Object.values(ROOF.adobe)]
const KIT_WALLS = [WALL.stone, WALL.wood, ...Object.values(WALL.adobe)]
const GRAVES = ['ow_prop_grave_0', 'ow_prop_grave_1', 'ow_prop_grave_2', 'ow_prop_grave_3', 'ow_prop_cross_0', 'ow_prop_cross_1']
const FLOWERS = ['ow_deco_flower_0', 'ow_deco_flower_1', 'ow_deco_flower_2', 'ow_deco_flower_3']
const OLD_STONES = ['ow_ruin_stub_0', 'ow_ruin_stub_1', 'ow_ruin_col_base_0', 'ow_ruin_col_base_1']
const SAND_STONES = ['ow_ruin_pillar', 'ow_ruin_pillar_2', 'ow_ruin_rubble', 'ow_ruin_wall_2']
const SAND_FLOOR = ['ow_ruin_crack_0', 'ow_ruin_crack_1', 'ow_ruin_crack_2']
const DEAD = ['ow_deadtree_0', 'ow_deadtree_1']
const LALLI_HOUSE = "Lalli's house"
const VILLAGE_PAD = 12   // the ground a village is built on (features.js PAD.village)

// ---- the farms of farmland (features.js FARMS) -------------------------------------
// Drawn by tools/make-wilds-farm-tiles.mjs: hay, peat, nets, the windmill, the
// date palm and the desert's mud-brick wall.
const HAY = ['ow_prop_hay_0', 'ow_prop_hay_1']
const PEAT = ['ow_prop_peat_0', 'ow_prop_peat_1']
const NETS = ['ow_prop_nets_l', 'ow_prop_nets_r'], RACK = ['ow_prop_fishrack_l', 'ow_prop_fishrack_r']
const PALM = 'ow_tree_palm_small', MUD_WALL = 'ow_prop_wall_sand', CUT_PEAT = 'ow_deco_peat'
const CUT_STONE = ['ow_ruin_stub_0', 'ow_ruin_stub_1']   // the old stones' blocks (OLD_STONES), here newly cut
// The windmill, row by row from the tips of its sails: two rows of roof (its
// cap and sails) over two of tower, its door in the middle of the lowest.
const WINDMILL = [
  ['ow_roof_mill_l', 'ow_roof_mill_m', 'ow_roof_mill_r'],
  ['ow_roof_mill_el', 'ow_roof_mill_em', 'ow_roof_mill_er'],
  ['ow_house_mill_l', 'ow_house_mill_m', 'ow_house_mill_r'],
  ['ow_house_mill_wl', 'ow_house_door_mill', 'ow_house_mill_wr'],
]
const FARM_SKINS = [...HAY, ...PEAT, ...NETS, PALM, MUD_WALL, CUT_PEAT, ...WINDMILL.flat()]
// ---- the desert village (village(…, desert)) -----------------------------------------
// Drawn by tools/make-wilds-desert-tiles.mjs: the stall's shade awning, its
// cloth in one of two colours by the stall's draw (`top` over the stall, a
// tile a cell; `front` its scalloped edge on its poles, west to east); the
// desert flowers scattered where a green village scatters meadow flowers,
// which become palms once everything else of the piece has its place
// (finishVillage); the young date palms of the date garden.
const AWNINGS = [0, 1].map(c => ({ top: `ow_stall_awning_${c}`, front: ['l', 'm', 'r'].map(s => `ow_stall_awning_${c}_front_${s}`) }))
// The date garden's mud wall where a fence would have its corners and side
// rails: the wall turning a corner, and running north and south (MUD_WALL
// runs east and west). The farms keep MUD_WALL all round.
const MUD_PIECES = {
  ow_fence_l: 'ow_prop_wall_sand_tl', ow_fence_r: 'ow_prop_wall_sand_tr', ow_fence_bl: 'ow_prop_wall_sand_bl', ow_fence_br: 'ow_prop_wall_sand_br',
  ow_fence_side_l: 'ow_prop_wall_sand_v', ow_fence_side_r: 'ow_prop_wall_sand_v',
}
const BLOOMS = ['ow_deco_bloom_0', 'ow_deco_bloom_1']
const SPROUTS = ['ow_deco_sprout_0', 'ow_deco_sprout_1']
const PALM_TALL = ['ow_tree_palm_top', 'ow_tree_palm']   // terrain.js PALMS.tall: the crown over its trunk
const DESERT_VILLAGE_SKINS = [...AWNINGS.flatMap(a => [a.top, ...a.front]), ...new Set(Object.values(MUD_PIECES)), ...BLOOMS, ...SPROUTS, ...PALM_TALL, ...PAVE_SKINS]
// The wild places in the desert (tools/make-wilds-desert-tiles.mjs draws
// what is new): a camp pitches tents of striped canvas, a ruin's or a watchtower's yard is
// strewn last of all with rubble (solid, as the ruin's other fallen stones)
// and broken pots (walked over), and a cave opens in a sandstone outcrop, its
// mouth the outcrop's face (terrain.js rims the rock round it as running on
// into it).
const DESERT_TENT = 'ow_tent_stripe'   // striped canvas: the tan tent is lost on the sand
const RUBBLE = 'ow_ruin_rubble'
const POTS = ['ow_deco_pottery_0', 'ow_deco_pottery_1']
const CAVE_MOUTH = ['ow_cave_arch_0', 'ow_cave_arch_1']
export const SAND_MOUTH = ['ow_cave_arch_sand_0', 'ow_cave_arch_sand_1']
// How many of each are strewn in a desert yard: `least` plus up to `more`, by a hash.
const STREWN = { rubble: { least: 2, more: 2 }, pots: { least: 2, more: 3 }, reach: 7 }
// The wayside places by a desert road, on a pad of sand: a rest pitches the
// striped tent and has a palm beside its fire (laid last of all, as a
// village's palms), a shrine's statue is a stele of carved sandstone (its
// top over its foot) on sand paving with desert flowers about it, the
// crossroads inn is a caravanserai with awnings along its front and a pen
// for its horses (inn.js), and the walled well's palms grow two cells tall
// where they have room (the date garden).
const STELE = ['ow_prop_stele_top', 'ow_prop_stele']
// How far from a rest's fire its palm may stand (the nearer ring first).
const FIRE_PALM = [1, 2]
// A village's square and the streets in it: green cobbles, or the desert's sand paving.
export const isVillageStreet = n => n === 'ow_cobble_green' || isPaveSkin(n)

// Each farm's plans, in cells from the middle of its yard, where the trail
// from the roads ends (features.js holds that cell clear); as drawn, nothing
// stands on it or its four neighbours, and everything within the farm's pad
// (features.js PAD). A plan is laid as drawn or mirrored east to west, and
// may be moved a cell or two to keep off the paths (makeSites lay).
//   ['house', dx, dy, w, storeys, wall, dcol]   its door at (dx, dy), dcol cells in from its west wall
//   ['mill', dx, dy]                            the windmill, its door at (dx, dy)
//   ['fence', x0, y0, x1, y1, gx, gy]           a fenced box, its gate at (gx, gy) if given
//   ['wall', x0, y0, x1, y1, gx, gy]            the same in mud brick
//   ['field', x0, y0, x1, y1]   ['flat', x0, y0, x1, y1, skin]   ground, walked on
//   ['low', x, y, skin]   ['pair', x, y, west, east]   ['put', x, y, skin]   ['rock', x, y]   ['well', x, y]
//   ['spare', x, y, skin]   a low thing that gives way to a trail even where the plan must stand whole (lay)
//   ['beast', x, y, species]   ['herd', x, y, species, n]   ['folk', x, y, species]
const trees = (xs, ys, skin) => xs.flatMap(x => ys.map(y => ['put', x, y, skin]))
const FARM_PLANS = {
  // a house, a fenced field, a pen of sheep and a goat, hay, hens
  farmstead: [[
    ['house', -4, -3, 5, 2, 'wood'], ['low', -7, -3, 'ow_prop_woodpile'], ['low', -1, -3, 'ow_prop_barrel_0'],
    ['fence', 2, -7, 7, -2, 4, -2], ['field', 3, -6, 6, -3], ['low', 1, -5, 'ow_prop_pitchfork'],
    ['fence', -8, 2, -4, 6, -6, 2], ['beast', -6, 4, 'sheep'], ['beast', -5, 3, 'sheep'], ['beast', -7, 5, 'goat'],
    ['low', 3, 3, HAY[0]], ['low', 4, 3, HAY[1]], ['low', 3, 4, HAY[0]], ['low', 6, 1, 'ow_prop_cart'],
    ['herd', 2, 2, 'chicken', 2],
    ['folk', -4, -1, 'villager'], ['folk', 4, 0, 'villager'], ['folk', -2, 2, 'elder'],
  ], [
    ['house', 5, -3, 4, 1, 'stone', 1], ['low', 8, -3, 'ow_prop_woodpile'], ['low', 3, -3, 'ow_prop_sack_0'],
    ['fence', -8, -6, -3, -1, -5, -1], ['field', -7, -5, -4, -2], ['low', -2, -4, 'ow_prop_pitchfork'],
    ['fence', 2, 3, 6, 7, 4, 3], ['beast', 3, 5, 'sheep'], ['beast', 5, 4, 'sheep'], ['beast', 4, 6, 'goat'],
    ['low', -4, 3, HAY[0]], ['low', -3, 3, HAY[1]], ['low', -6, 2, 'ow_prop_cart'],
    ['herd', -2, 2, 'chicken', 2],
    ['folk', 5, -1, 'villager'], ['folk', -5, 1, 'villager'], ['folk', 1, 3, 'elder'],
  ]],
  // rows of apple trees, a cottage, a bee yard
  orchard: [[
    ['house', -4, -3, 3, 1, 'wood'], ['low', -2, -3, 'ow_prop_crate_1'], ['low', -6, -3, 'ow_prop_sack_1'],
    ...trees([2, 4, 6], [-5, -3, -1, 1], 'ow_tree_apple'),
    ['fence', -6, 2, -3, 4], ['low', -5, 3, 'ow_beehive'], ['low', -4, 3, 'ow_beehive'], ['low', 1, 3, 'ow_prop_bucket'],
    ['folk', -4, -1, 'villager'], ['folk', 3, 0, 'villager'], ['folk', -1, 2, 'elder'],
  ], [
    ...trees([-5, -3, -1, 1, 3, 5], [-6, -4], 'ow_tree_apple'),
    ['house', 4, 4, 3, 1, 'wood'], ['low', 2, 4, 'ow_prop_crate_1'], ['low', 6, 4, 'ow_prop_barrel_1'],
    ['fence', -6, 1, -3, 3], ['low', -5, 2, 'ow_beehive'], ['low', -4, 2, 'ow_beehive'],
    ['folk', 4, 6, 'villager'], ['folk', -2, -2, 'villager'], ['folk', -1, 4, 'elder'],
  ]],
  // the windmill, sacks of flour, two strips of grain
  mill: [[
    ['mill', 0, -3], ['low', 2, -3, 'ow_prop_sack_0'], ['low', 3, -3, 'ow_prop_sack_1'], ['low', -2, -3, 'ow_prop_sack_1'],
    ['low', 4, -1, 'ow_prop_cart'], ['low', -4, -1, 'ow_prop_crate_0'],
    ['field', -5, 2, -3, 4], ['field', 3, 2, 5, 4],
    ['folk', 2, -1, 'villager'], ['folk', -4, 1, 'villager'], ['folk', 1, 3, 'elder'],
  ], [
    ['mill', 3, -2], ['low', 5, -2, 'ow_prop_sack_0'], ['low', 1, -2, 'ow_prop_sack_1'],
    ['field', -6, -3, -3, -1], ['field', -4, 2, -1, 4],
    ['low', 3, 3, 'ow_prop_cart'], ['low', 4, 2, 'ow_prop_crate_0'],
    ['folk', 3, 1, 'villager'], ['folk', -5, 1, 'villager'], ['folk', 1, 3, 'elder'],
  ]],
  // the cutter's hut, stacks of drying peat, the cut face
  peat: [[
    ['house', -3, -3, 3, 1, 'wood'], ['low', -5, -3, 'ow_prop_woodpile'], ['low', -1, -3, 'ow_prop_barrel_0'],
    ['low', 2, -4, PEAT[0]], ['low', 3, -4, PEAT[1]], ['low', 4, -4, PEAT[0]], ['low', 2, -2, PEAT[1]], ['low', 3, -2, PEAT[0]],
    ['flat', 1, 2, 4, 4, CUT_PEAT], ['low', 5, 1, 'ow_prop_pitchfork'],
    ['folk', -3, -1, 'villager'], ['folk', 3, 1, 'villager'], ['folk', -2, 2, 'elder'],
  ], [
    ['house', -3, 4, 3, 1, 'wood'], ['low', -5, 4, 'ow_prop_woodpile'],
    ['low', 1, -5, PEAT[0]], ['low', 2, -5, PEAT[1]], ['low', 3, -5, PEAT[0]], ['low', 2, -3, PEAT[1]], ['low', 3, -3, PEAT[0]],
    ['flat', -5, -4, -2, -2, CUT_PEAT], ['low', 4, 1, 'ow_prop_pitchfork'],
    ['folk', -2, 6, 'villager'], ['folk', 3, -1, 'villager'], ['folk', 1, 3, 'elder'],
  ]],
  // the fisher's hut, nets and racks drying (the jetty and boat: fisher())
  fisher: [[
    ['house', -4, -3, 3, 1, 'wood'], ['low', -2, -3, 'ow_prop_barrel_1'], ['low', -6, -3, 'ow_prop_bucket'],
    ['pair', 1, -5, ...NETS], ['pair', 4, -4, ...NETS], ['pair', 1, -3, ...RACK], ['low', -3, 2, 'ow_prop_crate_2'],
    ['folk', -4, -1, 'villager'], ['folk', 3, -1, 'villager'], ['folk', -2, 2, 'elder'],
  ], [
    ['house', -4, 5, 3, 1, 'wood'], ['low', -6, 5, 'ow_prop_barrel_1'], ['low', -2, 5, 'ow_prop_crate_2'],
    ['pair', -2, -5, ...NETS], ['pair', 1, -5, ...RACK], ['low', 4, -3, 'ow_prop_bucket'],
    ['folk', -1, 6, 'villager'], ['folk', 3, -2, 'villager'], ['folk', 2, 3, 'elder'],
  ]],
  // the shepherd's hut and his fold of sheep, goats about, hay
  fold: [[
    ['house', -3, -3, 3, 1, 'stone'], ['low', -5, -3, 'ow_prop_woodpile'],
    ['fence', 1, -5, 4, -1, 2, -1], ['beast', 2, -4, 'sheep'], ['beast', 3, -3, 'sheep'], ['beast', 2, -2, 'sheep'],
    ['low', 5, 1, HAY[1]], ['low', 5, 2, HAY[0]], ['low', -1, 3, 'ow_prop_bucket_water'],
    ['herd', -3, 3, 'goat', 2],
    ['folk', 3, 1, 'villager'], ['folk', -3, -1, 'elder'], ['folk', -4, 1, 'villager'],
  ], [
    ['house', 3, -3, 3, 1, 'stone'], ['low', 5, -3, 'ow_prop_woodpile'],
    ['fence', -2, 2, 2, 6, 0, 2], ['beast', -1, 4, 'sheep'], ['beast', 1, 3, 'sheep'], ['beast', 0, 5, 'sheep'],
    ['low', -4, -2, HAY[0]], ['low', -3, -2, HAY[1]],
    ['herd', -4, 1, 'goat', 2],
    ['folk', 3, -1, 'villager'], ['folk', -3, 1, 'villager'], ['folk', 4, 2, 'elder'],
  ]],
  // a hut by an arc of rock to mine, blocks of cut stone waiting for the cart
  quarry: [[
    ['house', -3, -3, 3, 1, 'stone'], ['low', -1, -3, 'ow_prop_bucket'],
    ['rock', 2, -5], ['rock', 3, -5], ['rock', 4, -4], ['rock', 5, -3], ['rock', 5, -2], ['rock', 3, -3], ['rock', 6, -1],
    ['low', 2, 1, 'ow_prop_cart'], ['low', 4, 1, CUT_STONE[0]], ['low', 5, 1, CUT_STONE[1]], ['low', 4, 2, CUT_STONE[1]],
    ['folk', 2, -1, 'villager'], ['folk', -3, -1, 'villager'], ['folk', -2, 2, 'elder'],
  ], [
    ['house', 3, -3, 3, 1, 'stone'], ['low', 5, -3, 'ow_prop_bucket'],
    ['rock', -3, 4], ['rock', -2, 5], ['rock', -1, 5], ['rock', 1, 5], ['rock', 2, 4], ['rock', -4, 3], ['rock', 0, 6],
    ['low', -4, -1, 'ow_prop_cart'], ['low', -5, -2, CUT_STONE[0]], ['low', -4, -2, CUT_STONE[1]], ['low', -5, -1, CUT_STONE[1]],
    ['folk', 3, -1, 'villager'], ['folk', 0, 3, 'villager'], ['folk', -3, 1, 'elder'],
  ]],
  // a well and date palms in a mud-brick wall, the keeper's house inside (on grass: well())
  well: [[
    ['wall', -4, -4, 4, 4, 0, 4], ['house', -2, -1, 3, 1, 'stone'], ['well', 2, -2],
    ['put', 3, 1, PALM], ['put', 2, 3, PALM], ['put', -2, 3, PALM], ['put', -3, 1, PALM],
    ['folk', 1, -1, 'villager'], ['folk', -1, 2, 'elder'], ['folk', 2, 1, 'villager'],
  ], [
    ['wall', -4, -4, 4, 4, 0, 4], ['house', 2, -1, 3, 1, 'stone'], ['well', -2, 2],
    ['put', -3, -2, PALM], ['put', -1, -3, PALM], ['put', 3, 2, PALM], ['put', 1, 3, PALM],
    ['folk', -1, -1, 'villager'], ['folk', 2, 2, 'elder'], ['folk', -3, 0, 'villager'],
  ]],
  // where no farm of the country finds room: a fenced field and a hut
  field: [[
    ['house', -3, -2, 3, 1, 'wood'], ['low', -5, -2, 'ow_prop_woodpile'],
    ['fence', 1, -4, 4, 0, 2, 0], ['field', 2, -3, 3, -1],
    ['folk', -3, 0, 'villager'], ['folk', 2, 2, 'villager'], ['folk', -1, 2, 'elder'],
  ], [
    ['house', -2, 4, 3, 1, 'wood'], ['low', 0, 4, 'ow_prop_woodpile'],
    ['fence', 1, -4, 4, 0, 2, 0], ['field', 2, -3, 3, -1],
    ['folk', -3, 1, 'villager'], ['folk', 3, 2, 'villager'], ['folk', -1, -2, 'elder'],
  ]],
}
// ---- the wayside places of the roadside (features.js ROADSIDE) ---------------------
// Laid as a farm is (lay below), from plans in cells from the place's middle;
// features.js leads a trail from the junction to the edge of the place
// nearest it. Besides a farm's items they use
//   ['tent', x, y, kind]   a tent two by two, its north-west cell at (x, y)
//   ['fire', x, y]         an eternal campfire (the game builds one from every campfire spawn)
//   ['statue', x, y]       the tended statue, its base at (x, y)
//   ['tower', dx, dy]      the ruined keep's tower, its door at (dx, dy) (ruinTower)
//   ['cobble', x, y, r2]   cobbles out to r² round (x, y)
// The cart of the inn's yard, and of a village's coach, is the city's (city/kit.js PROPS.cart: horse west, cart east).
const CART = ['ow_prop_city_cart_horse', 'ow_prop_city_cart']
const WAYSIDE_PLANS = {
  // a tent, the fire, a log to sit on, the traveller's things
  rest: [[
    ['tent', -3, -3, 'ow_tent'], ['fire', 0, 0], ['low', 2, 0, 'ow_prop_log'], ['low', -1, -2, 'ow_prop_sack_0'],
    ['low', 2, -2, 'ow_prop_woodpile'], ['low', -2, 1, 'ow_prop_bedroll_0'],
    ['folk', 1, 1, 'villager'],
  ], [
    ['tent', 1, 1, 'ow_tent_tan'], ['fire', -1, -1], ['low', -3, -1, 'ow_prop_log'], ['low', 3, 0, 'ow_prop_sack_1'],
    ['low', -2, -3, 'ow_prop_woodpile'], ['low', 0, -3, 'ow_prop_bedroll_1'],
    ['folk', -2, 0, 'villager'],
  ]],
  // the statue on its cobbles, a torch at each corner, a pot of offerings (flowers and the chest: shrine())
  shrine: [[
    ['cobble', 0, 0, 6], ['statue', 0, 0], ['low', 1, 0, 'ow_prop_pot'],
    ['low', -2, -2, 'ow_prop_torch'], ['low', 2, -2, 'ow_prop_torch'], ['low', -2, 2, 'ow_prop_torch'], ['low', 2, 2, 'ow_prop_torch'],
  ]],
  // the smaller inn, where the roads leave no room for the big one (inn.js):
  // a house five wide and two storeys, a fenced stable yard with the cart, the
  // stable hand by it (the innkeeper is inside)
  inn: [[
    ['house', 0, -2, 5, 2, 'wood'], ['low', -3, -2, 'ow_prop_woodpile'], ['low', -2, 1, 'ow_prop_barrel_1'], ['low', 2, 1, 'ow_prop_crate_0'],
    ['fence', 4, -4, 8, 1, 4, 0], ['pair', 5, -2, ...CART], ['low', 7, 0, HAY[0]], ['low', 5, 0, 'ow_prop_bucket_water'],
    ['folk', -1, 0, 'villager'],
  ], [
    ['house', 0, -3, 5, 2, 'stone'], ['low', -3, -3, 'ow_prop_woodpile'], ['low', 3, -3, 'ow_prop_barrel_0'], ['low', 4, -3, 'ow_prop_barrel_1'],
    ['fence', -3, 2, 3, 6, 0, 2], ['pair', -2, 4, ...CART], ['low', 2, 5, HAY[1]], ['low', 2, 3, 'ow_prop_bucket_water'],
    ['folk', 1, -1, 'villager'],
  ]],
  // the tower alone: its broken walls are laid round wherever it settles (tower())
  tower: [[['tower', 0, 0]]],
}
// A milestone (tools/make-wilds-road-tiles.mjs), beside the road (features.js milestones).
const MILESTONE = 'ow_prop_milestone'

// a house's door column when the plan does not give it, as house() deals it for widths 3 and 5
const doorCol = (w, dcol) => dcol ?? (w === 4 ? 1 : (w - 1) >> 1)
// The plan item moved by (sx, sy).
function shifted([kind, ...a], sx, sy) {
  if (kind === 'fence' || kind === 'wall') return [kind, a[0] + sx, a[1] + sy, a[2] + sx, a[3] + sy, a[4] === undefined ? undefined : a[4] + sx, a[5] === undefined ? undefined : a[5] + sy]
  if (kind === 'field' || kind === 'flat') return [kind, a[0] + sx, a[1] + sy, a[2] + sx, a[3] + sy, ...a.slice(4)]
  return [kind, a[0] + sx, a[1] + sy, ...a.slice(2)]
}
// The plan item mirrored east to west.
function mirrored([kind, ...a]) {
  if (kind === 'inn' || kind === 'stable') return innMirrored([kind, ...a])
  if (kind === 'house') { const [dx, dy, w, storeys, wall, dcol] = a; return [kind, -dx, dy, w, storeys, wall, w - 1 - doorCol(w, dcol)] }
  if (kind === 'fence' || kind === 'wall') return [kind, -a[2], a[1], -a[0], a[3], a[4] === undefined ? undefined : -a[4], a[5]]
  if (kind === 'field' || kind === 'flat') return [kind, -a[2], a[1], -a[0], ...a.slice(3)]
  if (kind === 'pair' || kind === 'tent') return [kind, -a[0] - 1, ...a.slice(1)]
  return [kind, -a[0], ...a.slice(1)]
}
// The cells a plan item builds on: `solid` stands, `low` is dressing, `rail`
// a fence or wall (a gap where a path passes), `flat` is walked on, `step` a doorstep.
function footprint([kind, ...a]) {
  if (kind === 'inn' || kind === 'stable') return innFootprint([kind, ...a])
  const out = [], add = (x, y, what) => out.push({ x, y, what })
  if (kind === 'house' || kind === 'mill' || kind === 'tower') {
    const [dx, dy] = a, w = kind === 'house' ? a[2] : 3, storeys = kind === 'house' ? a[3] : 2, dcol = kind === 'house' ? doorCol(w, a[5]) : 1
    for (let i = 0; i < w; i++) for (let y = dy - 1 - storeys; y <= dy; y++) add(dx - dcol + i, y, 'solid')
    // (the tower keeps two rows clear in front of its arch)
    for (let j = 1; j <= (kind === 'tower' ? 2 : 1); j++) for (let i = -1; i <= 1; i++) add(dx + i, dy + j, 'step')
  } else if (kind === 'tent') {
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) add(a[0] + i, a[1] + j, 'solid')
  } else if (kind === 'cobble') {
    const [x0, y0, r2] = a
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy < r2) add(x0 + dx, y0 + dy, 'flat')
  } else if (kind === 'fire') add(a[0], a[1], 'low')
  else if (kind === 'fence' || kind === 'wall') {
    const [x0, y0, x1, y1, gx, gy] = a
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if ((x === x0 || x === x1 || y === y0 || y === y1) && !(x === gx && y === gy)) add(x, y, 'rail')
  } else if (kind === 'field' || kind === 'flat') {
    for (let y = a[1]; y <= a[3]; y++) for (let x = a[0]; x <= a[2]; x++) add(x, y, 'flat')
  } else if (kind === 'pair') { add(a[0], a[1], 'low'); add(a[0] + 1, a[1], 'low') }
  else if (kind === 'low') add(a[0], a[1], 'low')
  else if (kind === 'spare') add(a[0], a[1], 'spare')
  else if (kind === 'put' || kind === 'rock') add(a[0], a[1], 'solid')
  else if (kind === 'well' || kind === 'statue') { add(a[0], a[1] - 1, 'solid'); add(a[0], a[1], 'solid') }
  return out
}
// What a plan item costs for each cell of it on a path; on a road, a cell
// already taken or outside the piece's inside, any item costs RULED_OUT. A
// plan may be moved up to FARM_SHIFT cells either way, at SHIFT_COST a cell
// moved and OFF_PAD_COST for each cell it then builds beyond the farm's pad.
const PATH_COST = { solid: 20, low: 3, spare: 3, rail: 1, flat: 2, step: 0 }
const RULED_OUT = 1000, FARM_SHIFT = 2, SHIFT_COST = 0.5, OFF_PAD_COST = 3
// Where a house, the windmill or a well may go instead when a path runs where
// its plan puts it: up to MOVE_REACH cells off, the nearest first.
const MOVE_REACH = 7
const MOVES = []
for (let oy = -MOVE_REACH; oy <= MOVE_REACH; oy++) for (let ox = -MOVE_REACH; ox <= MOVE_REACH; ox++) MOVES.push([ox, oy])
MOVES.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]))

export const SITE_SKINS = [...new Set([
  ...KIT_ROOFS.flatMap(r => [...r.top, ...r.low, r.chim, r.gable]),
  ...KIT_WALLS.flatMap(w => [w.l, w.m, w.r, w.win, w.door, ...w.dbl, ...(w.up ? Object.values(w.up) : []), ...(w.gate ? [w.gate] : [])]),
  ...DESERT_VILLAGE_SKINS,
  ...GRAVES, ...FLOWERS, ...OLD_STONES, ...SAND_STONES, ...SAND_FLOOR, ...DEAD,
  'ow_cobble_green', 'ow_well', 'ow_well_top', 'ow_sign', 'ow_beehive',
  'ow_fence_l', 'ow_fence_m', 'ow_fence_r', 'ow_fence_side_l', 'ow_fence_side_r', 'ow_fence_bl', 'ow_fence_br', 'ow_fence_end_l', 'ow_fence_end_r',
  'ow_patch_tl', 'ow_patch_t', 'ow_patch_tr', 'ow_patch_l', 'ow_patch_m', 'ow_patch_r', 'ow_patch_bl', 'ow_patch_b', 'ow_patch_br',
  'ow_deco_crop_0', 'ow_deco_crop_1', 'ow_deco_skull',
  'ow_stall_top', 'ow_stall_front', 'ow_stall_top_green', 'ow_stall_front_green',
  'ow_prop_counter_0', 'ow_prop_counter_1', 'ow_prop_counter_2',
  'ow_prop_woodpile', 'ow_prop_stump_0', 'ow_prop_stump_1', 'ow_prop_stump_axe', 'ow_prop_log',
  'ow_prop_barrel_0', 'ow_prop_barrel_1', 'ow_prop_crate_0', 'ow_prop_crate_1', 'ow_prop_crate_2', 'ow_prop_sack_0', 'ow_prop_sack_1', 'ow_prop_pot',
  'ow_prop_cart', 'ow_prop_torch', 'ow_prop_bucket', 'ow_prop_bucket_water', 'ow_prop_pitchfork', 'ow_prop_target',
  'ow_prop_bedroll_0', 'ow_prop_bedroll_1', 'ow_prop_mound', 'ow_prop_campfire_cold',
  'ow_tent_00', 'ow_tent_10', 'ow_tent_01', 'ow_tent_11', 'ow_tent_tan_00', 'ow_tent_tan_10', 'ow_tent_tan_01', 'ow_tent_tan_11',
  ...['00', '10', '01', '11'].map(c => `${DESERT_TENT}_${c}`),
  'ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r', 'ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r',
  'ow_brick', 'ow_castle_parapet_l', 'ow_castle_parapet_m', 'ow_castle_parapet_r', 'ow_house_arch_stone',
  ...CAVE_MOUTH, ...SAND_MOUTH, 'ow_statue_top', 'ow_statue', ...STELE, 'ow_lily_0', 'ow_lily_1', 'ow_lily_2',
  'ow_deco_firepit', 'ow_kiln_cold', 'ow_mtn_rock_cap', 'ow_prop_fishrack_l', 'ow_prop_fishrack_r', 'ow_pier_log', 'ow_stone_ground_0',
  'ow_prop_bell', 'ow_tree_apple', 'ow_tree_small', 'ow_greytree_0', 'ow_greytree_1',
  // the Lalli tale: his pine (not in the lumber table) and the tale's people
  'ow_lalli_pine_top', 'ow_lalli_pine_trunk', 'npc_lalli', 'npc_lalli_tree', 'npc_piper', 'npc_kerttu',
  // the farms of farmland, and what stands beside the roads (the inn's cart is the city's: city/kit.js)
  ...FARM_SKINS, MILESTONE,
  // the crossroads inn's stable (inn.js; its house and the rest are the city's)
  ...INN_SKINS,
])]

// ---- the places of the tales (data/tales.js) --------------------------------------
// Where a tale's place puts its parts, worked out before anything is stamped
// so the piece's roads, small things and packs can keep clear of them.
//   hub    where the roads from the gates meet
//   keep   circles nothing else of the piece is dealt into
//   ways   cells opened as an unmarked way through the trees; nothing is built on them
export const TALE_PAD = { elk: 7, tar: 15, kivihiisi: 9, nakki: 16, fold: 8, flame: 9, lalli: 8,
  // the Sampo's three pieces (city/sampo.js PIECES): Turso's bay, the copper mountain's bowl, the pike's pond
  sampo_sea: 14, sampo_mountain: 10, sampo_marsh: 9 }
// The cells of a one-wide walkable line, each a step along x or y from the last.
export function wayCells(x0, y0, x1, y1) {
  const out = [{ x: x0, y: y0 }]
  let x = x0, y = y0
  while (x !== x1 || y !== y1) {
    const dx = x1 - x, dy = y1 - y
    if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy)
    out.push({ x, y })
  }
  return out
}
export function layoutTale(tale, rng, gateInner = null) {
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  if (tale === 'elk') {
    const cx = ri(30, 49), cy = ri(30, 49)
    // three of the four quarters, in turn, so each wallow is a long run from the last
    const quarters = [[1, -1], [1, 1], [-1, 1], [-1, -1]]
    const first = ri(0, 3)
    const wallows = [0, 1, 2].map(i => {
      const [sx, sy] = quarters[(first + i) % 4]
      return { x: cx + sx * ri(17, 19), y: cy + sy * ri(17, 19), away: sy }
    })
    const hub = { x: cx, y: cy + 1 }
    const ways = [hub, ...wallows].slice(0, -1).flatMap((from, i) => wayCells(from.x, from.y, wallows[i].x, wallows[i].y))
    return { cx, cy, hub, wallows, ways, keep: wallows.map(w => ({ x: w.x, y: w.y, r: 6 })) }
  }
  if (tale === 'tar') {
    const cx = ri(32, 53), cy = ri(24, 55)
    return { cx, cy, hub: { x: cx - 14, y: cy }, keep: [{ x: cx - 17, y: cy + 2, r: 7 }] }
  }
  if (tale === 'fold') {
    const cx = ri(26, 44), cy = ri(34, 52)
    const burrow = { x: cx + ri(13, 16), y: cy - ri(8, 11) }
    // the wood the village burns: four bands along the longest road in, the one from the farthest gate
    const far = ['N', 'E', 'S', 'W'].map(side => gateInner(side)).sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy))[0]
    const burns = [0.2, 0.38, 0.56, 0.74].map(f => ({ x: Math.round(far.x + (cx - far.x) * f), y: Math.round(far.y + (cy - far.y) * f) }))
    const hub = { x: cx, y: cy + 2 }
    // a sure way from the den to the burrow's mouth, whatever grows between
    const ways = wayCells(hub.x, hub.y, burrow.x, burrow.y + 1)
    return { cx, cy, hub, burrow, burns, ways, keep: [{ x: burrow.x, y: burrow.y - 2, r: 8 }, ...burns.map(b => ({ x: b.x, y: b.y, r: 4 }))] }
  }
  if (tale === 'flame') {
    const cx = ri(26, 50), cy = ri(28, 50)
    return { cx, cy, hub: { x: cx, y: cy + 5 }, keep: [{ x: cx + 7, y: cy + 4, r: 6 }] }
  }
  if (tale === 'lalli') {
    // the pine in the middle, the pond a short walk east, the piper's camp south-west
    const cx = ri(28, 48), cy = ri(28, 50)
    const pond = { x: cx + 12, y: cy + 1 }, camp = { x: cx - 10, y: cy + 5 }
    const hub = { x: cx, y: cy + 4 }, bank = { x: pond.x - 6, y: pond.y }
    const ways = [...wayCells(hub.x, hub.y, bank.x, bank.y), ...wayCells(hub.x, hub.y, camp.x + 2, camp.y)]
    return { cx, cy, hub, pond, camp, bank, ways, keep: [{ x: pond.x, y: pond.y, r: 7 }, { x: camp.x, y: camp.y, r: 5 }] }
  }
  if (tale === 'sampo_sea' || tale === 'sampo_marsh') {
    // water in the middle, the bank and the pier's foot a walk west of it
    const cx = ri(36, 52), cy = ri(28, 50), r = tale === 'sampo_sea' ? 12 : 7
    return { cx, cy, r, hub: { x: cx - r - 3, y: cy }, keep: [{ x: cx - r - 4, y: cy, r: 4 }] }
  }
  if (tale === 'sampo_mountain') {
    const cx = ri(28, 50), cy = ri(28, 48)
    return { cx, cy, hub: { x: cx, y: cy + 9 }, keep: [] }
  }
  if (tale === 'nakki') {
    const cx = ri(36, 52), cy = ri(26, 50)
    return { cx, cy, hub: { x: cx - 15, y: cy }, keep: [{ x: cx - 19, y: cy + 2, r: 7 }, { x: cx - 6, y: cy + 14, r: 5 }] }
  }
  const cx = ri(26, 52), cy = ri(26, 53)
  return { cx, cy, hub: { x: cx, y: cy + 4 }, keep: [{ x: cx + 11, y: cy + 3, r: 6 }] }
}

// c: { t, rng, pick, ri, hold, spawn, place, freeSpot, door, npc, hash, taken, rocks, sandy }
// (door returns the record it made)
export function makeSites(c) {
  const { t, rng, pick, ri, hold } = c
  // Lay one piece of art, on ground cleared for it.
  const put = (x, y, skin, opts) => { t.clear(x, y); t.setProp(x, y, skin, opts); hold(x, y) }
  // Dressing: laid the same way and remembered, because it gives way. Where
  // a barrel or a fallen column turns out to stand in the one way a path had
  // left, features.js takes it up again.
  const dressing = []
  const low = (x, y, skin) => { put(x, y, skin); dressing.push({ x, y }) }
  const flat = (x, y, skin) => { if (t.free(x, y) && !c.taken(x, y)) { t.setProp(x, y, skin, { walkable: true }); hold(x, y) } }
  const row = (x, y, skins) => skins.forEach((s, i) => { if (s) put(x + i, y, s) })
  // (`ok`: where a spot is wanted; a spot it refuses is left bare; `laid`
  // collects the spots laid)
  const scatter = (cx, cy, rMin, rMax, n, skins, solid = false, ok = null, laid = null) => {
    for (let i = 0; i < n; i++) {
      const at = c.freeSpot(cx, cy, rMin, rMax)
      if (!at) return
      if (ok && !ok(at.x, at.y)) continue
      if (solid) low(at.x, at.y, pick(skins)); else flat(at.x, at.y, pick(skins))
      laid?.push(at)
    }
  }
  const offPaths = (x, y) => !t.onPath(x, y)
  // the crossroads inn's house and stable, in Kalevanlinna's style
  const innStamps = makeInnStamps({ t, put, hold, door: c.door, rng, adobe: c.desert ? { roof: ROOF.adobe, wall: WALL.adobe } : null })

  // A house whose door is at (dx, dy), `dcol` cells in from its west wall
  // (dealt when not given); `lived`: someone is always at home (the interior
  // is never an abandoned one: renderer/interior/versions.js). Returns its box
  // and its door record.
  // `kit`: 'kenney' (Tiny Town's) or 'adobe' (the desert's), by the same draws;
  // an adobe house's door record says so (`look.wall`), unless `kept` keeps
  // the wall the draws gave (the smaller inn: its record is the inn's either way).
  function house(dx, dy, tier, { w = 3, roof = rng() < 0.5 ? 'red' : 'blue', wall = rng() < 0.5 ? 'stone' : 'wood', storeys = 1, story = null, kind = null, dcol: atCol = null, lived = false, kit = 'kenney', kept = false } = {}) {
    const adobe = kit === 'adobe'
    const R = adobe ? ROOF.adobe[roof] : ROOF[roof], W = adobe ? WALL.adobe[wall] : WALL[wall], U = W.up ?? W
    const dbl = w === 5 && rng() < 0.35
    const dcol = atCol ?? (w === 3 ? 1 : w === 4 ? (rng() < 0.5 ? 1 : 2) : 2)
    const x0 = dx - dcol, top = dy - 1 - storeys
    const ends = (kit, mid, i) => i === 0 ? kit[0] : i === w - 1 ? kit[2] : mid ?? kit[1]
    const chim = w === 3 ? (rng() < 0.5 ? 1 : -1) : 1 + Math.floor(rng() * (w - 2))
    for (let i = 0; i < w; i++) {
      put(x0 + i, top, ends(R.top, i === chim ? R.chim : null, i))
      put(x0 + i, top + 1, ends(R.low, i === dcol ? R.gable : null, i))
      if (storeys === 2) put(x0 + i, top + 2, i === 0 ? U.l : i === w - 1 ? U.r : U.win)
      let skin = i === 0 ? W.l : i === w - 1 ? W.r : W.m
      if (i === dcol) skin = dbl ? W.dbl[0] : W.door
      else if (dbl && i === dcol + 1) skin = W.dbl[1]
      else if (i > 0 && i < w - 1) skin = W.win
      put(x0 + i, dy, skin)
    }
    // the doorstep stays clear
    for (let i = -1; i <= 1; i++) { t.clear(dx + i, dy + 1); hold(dx + i, dy + 1) }
    const door = c.door(dx, dy, tier, story, { look: { w, storeys, wall: adobe && !kept ? 'adobe' : wall }, ...(kind ? { kind } : {}), ...(lived ? { lived: true } : {}) })
    return { x0, x1: x0 + w - 1, top, w, door }
  }

  // A fenced rectangle with a gate gap in its top or bottom run. A path
  // through it makes a gap of its own, unless the fence is `whole`: then it
  // stands across a trail, and whoever asks for it leaves a way round. A
  // road is never blocked: where one passes, even a whole fence has a gap.
  // `mud`: the same, as a low wall of mud brick (the farms' MUD_WALL along
  // its top and bottom runs, MUD_PIECES at its corners and down its sides).
  function fence(x0, y0, x1, y1, gate = null, whole = false, mud = false) {
    const skinOf = skin => mud ? MUD_PIECES[skin] ?? MUD_WALL : skin
    const rail = whole ? (x, y, skin) => put(x, y, skinOf(skin)) : (x, y, skin) => low(x, y, skinOf(skin))
    const open = (x, y) => (whole ? t.onRoad(x, y) : t.onPath(x, y)) || (gate && gate.y === y && x === gate.x)
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) {
      const top = y === y0
      let skin = x === x0 ? (top ? 'ow_fence_l' : 'ow_fence_bl') : x === x1 ? (top ? 'ow_fence_r' : 'ow_fence_br') : 'ow_fence_m'
      const gap = gx => gx >= x0 && gx <= x1 && open(gx, y)
      if (gap(x)) { t.clear(x, y); hold(x, y); continue }
      if (gap(x + 1) && x > x0) skin = 'ow_fence_end_r'
      if (gap(x - 1) && x < x1) skin = 'ow_fence_end_l'
      rail(x, y, skin)
    }
    for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) if (!open(x, y)) rail(x, y, x === x0 ? 'ow_fence_side_l' : 'ow_fence_side_r')
  }
  // Tilled ground with its own grass edge, and a crop on every cell.
  function field(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = y === y0 ? 't' : y === y1 ? 'b' : '', h = x === x0 ? 'l' : x === x1 ? 'r' : ''
      t.clear(x, y)
      t.setGround(x, y, `ow_patch_${v + h || 'm'}`)
      t.setProp(x, y, (y - y0) % 2 ? 'ow_deco_crop_1' : 'ow_deco_crop_0', { walkable: true })
      hold(x, y)
    }
  }
  // Young date palms on sand in a box, where a green village tills its field.
  function dateGarden(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      t.clear(x, y)
      t.setGround(x, y, t.sandSkin(x, y))
      t.setProp(x, y, SPROUTS[(y - y0) % 2], { walkable: true })
      hold(x, y)
    }
  }
  const cobble = (cx, cy, r2, skin = 'ow_cobble_green') => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy < r2) { t.clear(cx + dx, cy + dy); t.setGround(cx + dx, cy + dy, skin) }
  }
  // The sand paving within r of (cx, cy) as it ends up: a paving cell beside
  // anything that is not paving takes its edge (the shape of the sides and
  // corners that are not), every other one a flagstone variant by a hash.
  const edgePaving = (cx, cy, r) => {
    const paved = (x, y) => isPaveSkin(t.groundAt(x, y))
    const writes = []
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!paved(x, y)) continue
      const M = (paved(x, y - 1) ? 0 : 1) | (paved(x + 1, y) ? 0 : 2) | (paved(x, y + 1) ? 0 : 4) | (paved(x - 1, y) ? 0 : 8)
      let D = 0
      if (!(M & 3) && !paved(x + 1, y - 1)) D |= 1
      if (!(M & 6) && !paved(x + 1, y + 1)) D |= 2
      if (!(M & 12) && !paved(x - 1, y + 1)) D |= 4
      if (!(M & 9) && !paved(x - 1, y - 1)) D |= 8
      writes.push([x, y, M || D ? paveEdgeSkin(M, D) : paveSkin(Math.floor(c.hash(x, y, 7140) * PAVE_VARIANTS))])
    }
    for (const [x, y, skin] of writes) t.setGround(x, y, skin)
  }
  // A walkable ring just outside a box of rock, so a road that runs into the
  // rock still leads round it.
  const walkRound = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if (x === x0 || x === x1 || y === y0 || y === y1) { t.clear(x, y); hold(x, y) }
  }
  // The box such rock is heaped in is the site's own ground, ring and all:
  // claimed before the rock is laid, so the rock may stand on a path there.
  const claimBox = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t.claim(x, y) }
  // The desert's sand (terrain.js sandSkin: the wind-swept sand of that world
  // tile) as the ground of the disc of radius r round (cx, cy), wherever it
  // is land and not a path, a trail or a road; ground only. The art passes
  // after the features (terrain.js finish) fray the land beyond into it.
  const sandPad = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (dx * dx + dy * dy > r * r || t.onPath(x, y) || t.kind(x, y) !== 'land') continue
      t.setGround(x, y, t.sandSkin(x, y))
    }
  }
  const tent = (x, y, kind = 'ow_tent') => { put(x, y, `${kind}_00`); put(x + 1, y, `${kind}_10`); put(x, y + 1, `${kind}_01`); put(x + 1, y + 1, `${kind}_11`) }
  const fire = (x, y) => { t.clear(x, y); c.spawn({ kind: 'campfire', x, y }) }

  // ---- the village ------------------------------------------------------------
  // Four to six houses round a cobbled well, no two rows of them touching;
  // everything stays within 11 tiles of the centre, inside the opened pad.
  // Its roads come in as streets along the square's four axes, where no
  // house stands (features.js lays them): what of them lies in the village
  // is cobbled, and nothing lying about is dropped on them.
  // `sunroom`: the big house is the glassmaker's, Päivölä (renderer/interior/sunroom.js)
  // `desert`: built from the desert kit, by the same draws and on the same
  // cells: adobe houses, sand paving for the cobbles, an awning over the
  // stall, a date garden walled in mud brick for the fenced field, palms for
  // the flowers and no bee yard. What would make the land walked or the
  // ground free other than a green village's waits for finishVillage, once
  // everything else of the piece has its place: until then the flowers'
  // spots hold desert flowers and the bee yard stands, so every spot dealt
  // after the village is dealt as in a green one.
  let desertVillage = null
  function village(cx, cy, tale = null, sunroom = false, desert = false) {
    const street = desert ? paveSkin(0) : 'ow_cobble_green', kit = desert ? 'adobe' : 'kenney'
    // a desert village stands on sand: the pad's ground, wherever it is not a
    // path, a road or water, whatever the land had there (hardpan, grass on a
    // border); ground only. The art passes after the features (terrain.js
    // finish) fray the land beyond into it: the hardpan's edges, the sand's
    // edge into grass, the mountain floor's edge.
    if (desert) sandPad(cx, cy, VILLAGE_PAD)
    cobble(cx, cy, 14, street)
    for (let dy = -VILLAGE_PAD; dy <= VILLAGE_PAD; dy++) for (let dx = -VILLAGE_PAD; dx <= VILLAGE_PAD; dx++) {
      const x = cx + dx, y = cy + dy
      if (dx * dx + dy * dy > VILLAGE_PAD * VILLAGE_PAD || !t.onRoad(x, y) || t.kind(x, y) === 'water') continue
      t.setGround(x, y, street); hold(x, y)
    }
    if (desert) edgePaving(cx, cy, VILLAGE_PAD)
    const lying = (x, y, skin) => { if (!t.onRoad(x, y)) low(x, y, skin) }
    put(cx, cy - 1, 'ow_well_top'); put(cx, cy, 'ow_well')
    put(cx - 2, cy + 1, 'ow_sign')
    const big = rng() < 0.5
    house(cx - 7, cy - 3, 'safe', { w: 4 + (rng() < 0.5 ? 1 : 0), kit })
    house(cx + 6, cy - 4, 'safe', { w: 5, storeys: big ? 2 : 1, kind: sunroom ? 'sunroom' : null, kit })
    // in a Lalli village the house by the field is his: its larder holds the tale's pint
    house(cx - 7, cy + 5, 'safe', { w: 3, story: tale === 'lalli' ? LALLI_HOUSE : null, kit })
    house(cx + 7, cy + 4, 'safe', { w: 3 + (rng() < 0.5 ? 1 : 0), kit })
    if (rng() < 0.5) house(cx - 3, cy - 8, 'safe', { w: 3, kit })
    if (rng() < 0.4) house(cx + 4, cy + 9, 'safe', { w: 3 + (rng() < 0.5 ? 1 : 0), kit })

    const later = desert ? { palms: [], garden: [], bees: [] } : null
    // the field, with its gate towards the houses; in the desert the date
    // garden, its two end rows of seedlings to be palms
    fence(cx - 9, cy + 7, cx - 4, cy + 10, { x: cx - 7, y: cy + 7 }, false, desert)
    if (desert) {
      dateGarden(cx - 8, cy + 8, cx - 5, cy + 9)
      for (const x of [cx - 8, cx - 5]) later.garden.push({ x, y: cy + 9 })
    } else field(cx - 8, cy + 8, cx - 5, cy + 9)
    low(cx - 3, cy + 8, 'ow_prop_pitchfork')
    // the bee yard, unless a road comes in where it would stand (too small to keep with a gap in it)
    let road = false
    for (let y = cy - 11; y <= cy - 9; y++) for (let x = cx + 3; x <= cx + 6; x++) if (t.onPath(x, y)) road = true
    if (!road) {
      fence(cx + 3, cy - 11, cx + 6, cy - 9)
      low(cx + 4, cy - 10, 'ow_beehive'); low(cx + 5, cy - 10, 'ow_beehive')
      if (desert) for (let y = cy - 11; y <= cy - 9; y++) for (let x = cx + 3; x <= cx + 6; x++) later.bees.push({ x, y })
    }
    // a market stall on the square
    if (rng() < 0.65) {
      const g = rng() < 0.5 ? '_green' : ''
      const awning = AWNINGS[g ? 1 : 0]
      for (let i = 0; i < 3; i++) {
        if (desert) { put(cx - 4 + i, cy + 4, awning.top); put(cx - 4 + i, cy + 5, awning.front[i]) }
        else { put(cx - 4 + i, cy + 4, `ow_stall_top${g}`); put(cx - 4 + i, cy + 5, `ow_stall_front${g}`) }
      }
      row(cx - 4, cy + 6, ['ow_prop_counter_0', 'ow_prop_counter_1', 'ow_prop_counter_2'])
    }
    // things lying about
    lying(cx - 4, cy - 3, 'ow_prop_woodpile'); lying(cx - 3, cy - 4, 'ow_prop_stump_axe')
    lying(cx + 3, cy - 4, 'ow_prop_barrel_1'); lying(cx + 9, cy - 4, 'ow_prop_crate_0')
    lying(cx + 4, cy + 4, pick(['ow_prop_sack_0', 'ow_prop_sack_1'])); lying(cx + 10, cy + 4, 'ow_prop_pot')
    lying(cx + 4, cy, 'ow_prop_cart'); lying(cx + 1, cy - 1, 'ow_prop_bucket_water')
    lying(cx - 3, cy - 3, 'ow_prop_torch'); lying(cx + 3, cy + 3, 'ow_prop_torch')
    lying(cx + 9, cy + 7, 'ow_prop_target'); lying(cx - 10, cy, 'ow_prop_log')
    if (desert) scatter(cx, cy, 4, 11, 8, BLOOMS, false, null, later.palms)
    else scatter(cx, cy, 4, 11, 8, FLOWERS)
    desertVillage = later
  }

  // What a desert village lays last (features.js, when everything else of
  // the piece has its place): the bee yard's footprint goes back to the
  // village's ground, and a palm stands on each of the flowers' spots and
  // the garden's two end rows. A palm takes the cell above its foot for its
  // crown where that is free (else it is the one-cell date palm), never
  // stands on a path, beside a cell in `clear` (the coach's boarding cell),
  // or where it would part the walkable cells round it; where it cannot, the
  // flower or the seedling stays. No draw of the piece's rng is spent.
  function finishVillage(clear = []) {
    const v = desertVillage
    desertVillage = null
    if (!v) return
    for (const { x, y } of v.bees) {
      const p = t.propAt(x, y)
      if (p === 'ow_beehive' || p?.startsWith('ow_fence_')) t.clear(x, y)
    }
    const byClear = (x, y) => clear.some(q => Math.abs(q.x - x) + Math.abs(q.y - y) <= 1)
    const stands = (x, y) => !t.onPath(x, y) && !byClear(x, y) && parts(x, y) <= 1
    const plant = (x, y, was) => {
      if (!was.includes(t.propAt(x, y)) || !stands(x, y)) return
      t.setProp(x, y, PALM)
      if (t.free(x, y - 1) && !c.taken(x, y - 1) && stands(x, y - 1)) { t.setProp(x, y, PALM_TALL[1]); t.setProp(x, y - 1, PALM_TALL[0]); hold(x, y - 1) }
    }
    for (const { x, y } of v.palms) plant(x, y, BLOOMS)
    // a garden palm's crown is the seedling above it
    for (const { x, y } of v.garden) {
      if (!SPROUTS.includes(t.propAt(x, y)) || !SPROUTS.includes(t.propAt(x, y - 1)) || !stands(x, y)) continue
      t.setProp(x, y, PALM)
      if (stands(x, y - 1)) { t.setProp(x, y, PALM_TALL[1]); t.setProp(x, y - 1, PALM_TALL[0]) }
    }
  }
  // What a desert ruin's or watchtower's yard is strewn with last of all
  // (features.js, when everything else of the piece has its place): within
  // STREWN.reach of its tower's door, a few lumps of rubble and a few broken
  // pots half-buried in the sand, on cells nothing holds, off the paths and
  // off `spot` (the piece's spawn point), the lowest hash first; a lump of
  // rubble only where it parts nothing. No draw of the piece's rng is spent.
  function finishDesert(spot) {
    finishWayside(spot)
    for (const { x: cx, y: cy } of desertYards) {
      const R = STREWN.reach, cells = []
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, y = cy + dy
        if (dx * dx + dy * dy > R * R || !t.free(x, y) || c.taken(x, y) || t.onPath(x, y) || (x === spot.x && y === spot.y)) continue
        cells.push({ x, y, h: c.hash(x, y, 7200) })
      }
      cells.sort((p, q) => p.h - q.h)
      let rubble = STREWN.rubble.least + Math.floor(c.hash(cx, cy, 7210) * (STREWN.rubble.more + 1))
      let pots = STREWN.pots.least + Math.floor(c.hash(cx, cy, 7220) * (STREWN.pots.more + 1))
      for (const { x, y, h } of cells) {
        if (!rubble && !pots) break
        if (!t.free(x, y)) continue
        // a cell is the rubble's or the pots' by its hash's later digits, and the other's once one has all it wants
        if (rubble > 0 && (pots === 0 || (h * 1e4) % 1 < 0.5) && parts(x, y) <= 1) { t.setProp(x, y, RUBBLE); hold(x, y); rubble-- }
        else if (pots > 0) { t.setProp(x, y, POTS[Math.floor(c.hash(x, y, 7230) * POTS.length)], { walkable: true }); hold(x, y); pots-- }
      }
    }
    desertYards.length = 0
  }
  // What a desert's wayside place lays last (finishDesert), on cells nothing
  // holds, off the paths and off `spot`, parting no walkable ground, the
  // lowest hash first; no draw of the piece's rng is spent:
  //   a rest's fire     a palm beside it (FIRE_PALM away, the nearer ring
  //                     first), two cells tall where its crown has room above
  //                     its foot, else the one-cell date palm, else none
  //   a date palm       of the walled well: two cells tall where the cell
  //                     above it takes its crown
  //   the big inn       its awnings (inn.js awnings)
  function finishWayside(spot) {
    const open = (x, y) => t.free(x, y) && !c.taken(x, y) && !t.onPath(x, y) && !(x === spot.x && y === spot.y)
    for (const f of desertLater.fires) {
      const spots = []
      for (const ring of FIRE_PALM) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) spots.push({ x: f.x + dx, y: f.y + dy, ring, h: c.hash(f.x + dx, f.y + dy, 7240) })
      spots.sort((p, q) => p.ring - q.ring || p.h - q.h)
      let lone = null, tall = false
      for (const { x, y } of spots) {
        if (!open(x, y) || parts(x, y) > 1) continue
        lone ??= { x, y }
        if (!open(x, y - 1)) continue
        t.setProp(x, y, PALM_TALL[1])
        if (parts(x, y - 1) > 1) { t.clear(x, y); continue }
        t.setProp(x, y - 1, PALM_TALL[0])
        hold(x, y); hold(x, y - 1)
        tall = true
        break
      }
      if (!tall && lone) { t.setProp(lone.x, lone.y, PALM); hold(lone.x, lone.y) }
    }
    for (const { x, y } of desertLater.palms) {
      if (t.propAt(x, y) !== PALM || !open(x, y - 1) || parts(x, y - 1) > 1) continue
      t.setProp(x, y, PALM_TALL[1]); t.setProp(x, y - 1, PALM_TALL[0]); hold(x, y - 1)
    }
    for (const h of desertLater.inns) awnings(t, h, { held: c.taken, hold, parts, spot })
    for (const list of Object.values(desertLater)) list.length = 0
  }
  // How many runs the walkable cells round (x, y) fall into, going round its
  // eight neighbours: one or none, and a thing standing there parts nothing.
  const RING8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
  const parts = (x, y) => {
    const open = RING8.map(([dx, dy]) => t.walkable(x + dx, y + dy))
    let runs = 0
    for (let k = 0; k < 8; k += 2) if (open[k] && !(open[(k + 6) % 8] && open[(k + 7) % 8])) runs++
    return runs
  }

  // ---- a hut out in the wild ---------------------------------------------------
  function hut(x, y) {
    const h = house(x, y, 'hut', { w: 3 + (rng() < 0.4 ? 1 : 0) })
    low(h.x0 - 1, y, 'ow_prop_woodpile')
    low(h.x1 + 1, y, pick(['ow_prop_barrel_0', 'ow_prop_barrel_1', 'ow_prop_sack_0']))
    low(h.x1 + 2, y + 2, pick(['ow_prop_stump_axe', 'ow_prop_stump_0']))
    if (rng() < 0.5) for (let i = 0; i < 3; i++) flat(h.x0 - 1 + i, y + 3, 'ow_deco_crop_0')
  }

  // ---- farms ---------------------------------------------------------------------
  // The main thing of farmland (features.js). A farm is laid from one of its
  // plans (FARM_PLANS), as drawn or mirrored, moved a cell or two if that
  // keeps it off the paths; whichever costs least (PATH_COST), ties going to
  // the first from a dealt start. Nothing of a farm stands on a road or a
  // trail: a house, the windmill or a well that a path runs under moves to the
  // nearest free ground a few cells off (MOVES), and stays where its plan puts
  // it only if there is none and no road runs there; everything else gives
  // way. Its houses are lived in (tier safe, `lived`). Each returns { doors,
  // people }: the door records it made and spots for one to three people
  // ({ x, y, species }), whom features.js puts there with their lines. The
  // wayside places of the roadside are laid the same way (WAYSIDE_PLANS), a
  // tent, the statue or the tower moving as a house does; so is the big inn
  // (inn.js), but only `whole`.
  //
  // What the cells of a plan (its footprint) cost moved by (sx, sy):
  function costOf(cx, cy, cells, sx, sy, r) {
    let cost = (Math.abs(sx) + Math.abs(sy)) * SHIFT_COST
    for (const { x: px, y: py, what } of cells) {
      const x = px + sx, y = py + sy, X = cx + x, Y = cy + y
      if (!t.inside(X, Y) || c.taken(X, Y) || t.onRoad(X, Y)) cost += RULED_OUT
      else if (t.onPath(X, Y)) cost += PATH_COST[what]
      if (what !== 'flat' && x * x + y * y > r * r) cost += OFF_PAD_COST
    }
    return cost
  }
  // What the plan's cells moved by (sx, sy) cost (as costOf) if they all stand
  // as drawn: inside the piece, on nothing taken, off every road and what
  // `avoid` keeps, and nothing on a trail but a doorstep, flat ground or a
  // spare thing (which gives way there); else Infinity. `seen` keeps what each
  // cell is (a lay tries hundreds of ways over the same few hundred cells).
  const OPEN = 1, TRAIL = 2, SHUT = 3
  const wholeCost = (cx, cy, cells, sx, sy, r, avoid, seen) => {
    let cost = (Math.abs(sx) + Math.abs(sy)) * SHIFT_COST
    for (const { x: px, y: py, what } of cells) {
      const x = px + sx, y = py + sy, X = cx + x, Y = cy + y, k = Y * 4096 + X
      let s = seen.get(k)
      if (s === undefined) {
        s = !t.inside(X, Y) || c.taken(X, Y) || t.onRoad(X, Y) || avoid?.(X, Y) ? SHUT : t.onPath(X, Y) ? TRAIL : OPEN
        seen.set(k, s)
      }
      if (s === SHUT || (s === TRAIL && what !== 'step' && what !== 'flat' && what !== 'spare')) return Infinity
      if (s === TRAIL) cost += PATH_COST[what]
      if (what !== 'flat' && x * x + y * y > r * r) cost += OFF_PAD_COST
    }
    return cost
  }
  // `r`: the farm's pad; what a moved plan builds beyond it costs a little more.
  // `whole`: lay it only where some way of it stands whole (wholeCost, moved
  // up to `shift` either way), so nothing of it moves or is left out; where
  // none does, lay nothing and return null. Its ground, the pad, goes with
  // it: opened round where it was laid, but for the trails, what is taken and
  // what `avoid` keeps.
  // `kit`: what its houses are built of (house()); 'adobe' keeps their door
  // records as the draws made them, and its fences are walls of mud brick.
  // In the desert (`c.desert`) a tent is of striped canvas, the statue a
  // stele on sand paving, and what stands there is noted to be finished last
  // of all (finishDesert): a wayside fire's palm, a date palm's crown, the
  // big inn's awnings.
  function lay(cx, cy, plans, r, { whole = false, shift = FARM_SHIFT, avoid = null, kit = 'kenney' } = {}) {
    const drawn = plans.flatMap(p => [p, p.map(mirrored)])
    const start = Math.floor(rng() * drawn.length)
    const seen = whole ? new Map() : null
    let chosen = null, least = Infinity
    for (let i = 0; i < drawn.length; i++) {
      const plan = drawn[(start + i) % drawn.length], cells = plan.flatMap(footprint)
      for (let sy = -shift; sy <= shift; sy++) for (let sx = -shift; sx <= shift; sx++) {
        const cost = whole ? wholeCost(cx, cy, cells, sx, sy, r, avoid, seen) : costOf(cx, cy, cells, sx, sy, r)
        if (cost < least) { chosen = { plan, sx, sy }; least = cost }
      }
    }
    if (!chosen) return null
    const best = chosen.sx || chosen.sy ? chosen.plan.map(item => shifted(item, chosen.sx, chosen.sy)) : chosen.plan
    const doors = [], folk = [], fires = []
    const offWay = (x, y) => !t.onPath(x, y)
    if (whole) {
      const mx = cx + chosen.sx, my = cy + chosen.sy
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = mx + dx, y = my + dy
        if (dx * dx + dy * dy > r * r || !t.inside(x, y) || c.taken(x, y) || t.onPath(x, y) || avoid?.(x, y)) continue
        t.claim(x, y); t.clear(x, y)
      }
    }
    // A farm house may stand at the edge of its pad: the ground right round it
    // is opened too, made ground where it was water (what the farm has
    // already built there stays, and a path is walked already), so no pocket
    // among the trees or on the shore touches its roof and the walk-behind
    // pass (over.js) opens the roof's top row as on any house.
    const around = ({ x0, x1, top }, y1) => {
      for (let y = top - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
        if ((x >= x0 && x <= x1 && y >= top && y <= y1) || !t.inside(x, y) || c.taken(x, y) || t.onPath(x, y)) continue
        t.claim(x, y); t.clear(x, y)
      }
    }
    // Where a building may stand: inside the piece, on nothing the farm has
    // built, off every path and road and within reach of the yard, its
    // doorstep free (a trail or a road may pass it).
    const reach = (r + 3) * (r + 3)
    const fits = item => footprint(item).every(({ x, y, what }) => {
      const X = cx + x, Y = cy + y
      if (!t.inside(X, Y) || c.taken(X, Y)) return false
      return what === 'step' || (!t.onPath(X, Y) && x * x + y * y <= reach)
    })
    const settle = item => {
      for (const [ox, oy] of MOVES) { const moved = ox || oy ? shifted(item, ox, oy) : item; if (fits(moved)) return moved }
      return footprint(item).some(({ x, y, what }) => what !== 'step' && t.onRoad(cx + x, cy + y)) ? null : item
    }
    const BUILDINGS = new Set(['house', 'inn', 'stable', 'mill', 'well', 'tower', 'statue', 'tent'])
    const free = (x, y) => !t.onPath(x, y) && !c.taken(x, y)
    // ground first, then what is fenced in, the buildings, and what stands about
    const ORDER = ['field', 'flat', 'cobble', 'fence', 'wall', 'house', 'inn', 'stable', 'mill', 'well', 'tower', 'statue', 'tent', 'put', 'rock', 'pair', 'low', 'spare', 'fire', 'beast', 'herd', 'folk']
    // (a plan laid `whole` has every cell checked where it stands: its buildings stay there)
    for (const step of ORDER) for (const item of best) {
      if (item[0] !== step) continue
      const [kind, ...a] = (BUILDINGS.has(step) && !whole ? settle(item) : item) ?? []
      if (!kind) continue   // a building with nowhere to go but a road is left out
      const X = cx + a[0], Y = cy + a[1]
      if (kind === 'field') {
        // tilled ground with its own grass edge and a crop on every cell; a trail keeps its way through
        for (let y = a[1]; y <= a[3]; y++) for (let x = a[0]; x <= a[2]; x++) {
          if (!offWay(cx + x, cy + y)) continue
          const v = y === a[1] ? 't' : y === a[3] ? 'b' : '', h = x === a[0] ? 'l' : x === a[2] ? 'r' : ''
          t.clear(cx + x, cy + y)
          t.setGround(cx + x, cy + y, `ow_patch_${v + h || 'm'}`)
          t.setProp(cx + x, cy + y, (y - a[1]) % 2 ? 'ow_deco_crop_1' : 'ow_deco_crop_0', { walkable: true })
          hold(cx + x, cy + y)
        }
      } else if (kind === 'flat') {
        for (let y = a[1]; y <= a[3]; y++) for (let x = a[0]; x <= a[2]; x++) if (offWay(cx + x, cy + y)) flat(cx + x, cy + y, a[4])
      } else if (kind === 'fence') {
        fence(cx + a[0], cy + a[1], cx + a[2], cy + a[3], a[4] === undefined ? null : { x: cx + a[4], y: cy + a[5] }, false, kit === 'adobe')
      } else if (kind === 'wall') {
        // a gap at the gate and wherever a path passes
        for (let y = a[1]; y <= a[3]; y++) for (let x = a[0]; x <= a[2]; x++) {
          if (!(x === a[0] || x === a[2] || y === a[1] || y === a[3])) continue
          if ((x === a[4] && y === a[5]) || !offWay(cx + x, cy + y)) { t.clear(cx + x, cy + y); hold(cx + x, cy + y) } else low(cx + x, cy + y, MUD_WALL)
        }
      } else if (kind === 'house') {
        const h = house(X, Y, 'safe', { w: a[2], storeys: a[3], wall: a[4], dcol: doorCol(a[2], a[5]), lived: true, kit, kept: true })
        around(h, Y)
        doors.push(h.door)
      } else if (kind === 'inn') {
        const h = innStamps.inn(X, Y)
        around(h, Y)
        doors.push(h.door)
        if (c.desert) desertLater.inns.push(h)
      } else if (kind === 'stable') {
        around(innStamps.stable(X, Y, a[2]), Y)
      } else if (kind === 'mill') {
        WINDMILL.forEach((skins, i) => row(X - 1, Y - 3 + i, skins))
        for (let i = -1; i <= 1; i++) { t.clear(X + i, Y + 1); hold(X + i, Y + 1) }
        around({ x0: X - 1, x1: X + 1, top: Y - 3 }, Y)
        doors.push(c.door(X, Y, 'safe', null, { look: { w: 3, storeys: 2, wall: 'stone' }, lived: true }))
      } else if (kind === 'well') {
        put(X, Y - 1, 'ow_well_top'); put(X, Y, 'ow_well')
      } else if (kind === 'statue') {
        const [top, foot] = c.desert ? STELE : ['ow_statue_top', 'ow_statue']
        put(X, Y - 1, top); put(X, Y, foot)
      } else if (kind === 'tent') {
        tent(X, Y, c.desert ? DESERT_TENT : a[2])
      } else if (kind === 'tower') {
        doors.push(ruinTower(X, Y))
      } else if (kind === 'cobble') {
        // a trail keeps its own ground across them; in the desert, sand paving with its edges
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++)
          if (dx * dx + dy * dy < a[2] && offWay(X + dx, Y + dy)) { t.clear(X + dx, Y + dy); t.setGround(X + dx, Y + dy, c.desert ? paveSkin(0) : 'ow_cobble_green') }
        if (c.desert) edgePaving(X, Y, 4)
      } else if (kind === 'fire') {
        const at = free(X, Y) && t.free(X, Y) ? { x: X, y: Y } : c.freeSpot(X, Y, 1, 2, (x, y) => free(x, y))
        if (at) { fire(at.x, at.y); fires.push(at) }
      } else if (kind === 'put') {
        if (free(X, Y)) {
          put(X, Y, a[2])
          if (c.desert && a[2] === PALM) desertLater.palms.push({ x: X, y: Y })
        }
      } else if (kind === 'rock') {
        if (free(X, Y)) low(X, Y, pick(c.rocks))
      } else if (kind === 'pair') {
        if (free(X, Y) && free(X + 1, Y)) { low(X, Y, a[2]); low(X + 1, Y, a[3]) }
      } else if (kind === 'low' || kind === 'spare') {
        if (free(X, Y)) low(X, Y, a[2])
      } else if (kind === 'beast') {
        const at = t.free(X, Y) && !c.taken(X, Y) ? { x: X, y: Y } : c.freeSpot(X, Y, 0, 2)
        if (at) c.npc(a[2], at.x, at.y)
      } else if (kind === 'herd') {
        for (let i = 0; i < a[3]; i++) { const at = c.freeSpot(X, Y, 0, 2); if (at) c.npc(a[2], at.x, at.y) }
      } else folk.push({ x: X, y: Y, species: a[2] })
    }
    const people = []
    for (const f of folk.slice(0, 1 + Math.floor(rng() * 3))) {
      const at = c.freeSpot(f.x, f.y, 0, 2)
      if (at) { hold(at.x, at.y); people.push({ x: at.x, y: at.y, species: f.species }) }
    }
    // `at`: the plan's middle where it was laid; `fires`: where its campfires are
    return { doors, people, at: { x: cx + chosen.sx, y: cy + chosen.sy }, fires }
  }
  // Grass over a disc, a trail keeping its own ground: a dry rise in the
  // marsh, an oasis in the desert.
  const turf = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r && !t.onPath(cx + dx, cy + dy) && t.kind(cx + dx, cy + dy) === 'land') t.setGround(cx + dx, cy + dy, t.grassSkin(cx + dx, cy + dy))
  }
  // The fisher's jetty, on whichever side of the yard it fits best: out over
  // the nearest open water, a walk cleared to it over the land between; with
  // none in reach, over a pond dug at the edge of the yard. A boat is moored
  // beside its end. Nothing wet is laid on a path, nor anything on a road.
  function jetty(cx, cy, r) {
    let best = null
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const P = (k, s = 0) => ({ x: cx + ux * k - uy * s, y: cy + uy * k + ux * s })
      let reach = null
      for (let k = r - 2; k <= r + 6 && reach === null; k++) { const p = P(k); if (t.inside(p.x, p.y) && t.kind(p.x, p.y) === 'water') reach = k }
      const walk = [], deck = [], pond = []
      let boat
      if (reach !== null) {
        for (let k = 3; k < reach; k++) walk.push(P(k))
        for (let k = reach; k <= reach + 2; k++) deck.push(P(k))
        boat = P(reach + 1, 1)
      } else {
        const m = P(r - 2)
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 5) pond.push({ x: m.x + dx, y: m.y + dy })
        for (let k = r - 5; k <= r - 2; k++) deck.push(P(k))
        boat = P(r - 1, 1)
      }
      // the open water is better than a dug pond; a cell already taken or on a path is a hole in the pond
      let cost = reach !== null ? 0 : 5
      for (const p of [...walk, ...deck, boat]) if (!t.inside(p.x, p.y) || t.onRoad(p.x, p.y) || c.taken(p.x, p.y)) cost = Infinity
      if (t.onPath(boat.x, boat.y)) cost = Infinity
      // nor does it come beside another bridge, which it would touch at a corner nobody can step across
      const own = new Set(deck.map(p => `${p.x},${p.y}`))
      for (const p of deck) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (!own.has(`${p.x + dx},${p.y + dy}`) && (t.propAt(p.x + dx, p.y + dy) ?? '').startsWith('ow_pier')) cost = Infinity
      for (const p of deck) if (t.onPath(p.x, p.y)) cost += 2
      for (const p of pond) if (!t.inside(p.x, p.y) || t.onRoad(p.x, p.y)) cost = Infinity; else if (t.onPath(p.x, p.y) || c.taken(p.x, p.y)) cost += 3
      if (cost < (best?.cost ?? Infinity)) best = { cost, walk, deck, pond, boat, along: ux !== 0 }
    }
    if (!best) {
      // nowhere for it: the boat is drawn up on the shore of the yard
      const at = c.freeSpot(cx, cy, 2, r - 2)
      if (at) put(at.x, at.y, 'ow_boat')
      return
    }
    for (const p of best.walk) { t.claim(p.x, p.y); t.clear(p.x, p.y); hold(p.x, p.y) }
    for (const p of best.pond) if (!t.onPath(p.x, p.y) && !c.taken(p.x, p.y)) { t.claim(p.x, p.y); t.setWater(p.x, p.y); hold(p.x, p.y) }
    for (const p of best.deck) { t.claim(p.x, p.y); t.setWater(p.x, p.y); t.setProp(p.x, p.y, best.along ? 'ow_pier_log' : 'ow_pier_log_v', { walkable: true }); hold(p.x, p.y) }
    const b = best.boat
    t.claim(b.x, b.y); t.setWater(b.x, b.y); t.setProp(b.x, b.y, 'ow_boat'); hold(b.x, b.y)
  }
  // (each takes its own pad: features.js PAD)
  const farms = {
    farmstead: (cx, cy) => { if (t.biome(cx, cy) === 'marsh') turf(cx, cy, 10); return lay(cx, cy, FARM_PLANS.farmstead, 10) },
    orchard: (cx, cy) => lay(cx, cy, FARM_PLANS.orchard, 8),
    mill: (cx, cy) => lay(cx, cy, FARM_PLANS.mill, 7),
    peat: (cx, cy) => lay(cx, cy, FARM_PLANS.peat, 7),
    fisher: (cx, cy) => { const made = lay(cx, cy, FARM_PLANS.fisher, 8); jetty(cx, cy, 8); return made },
    fold: (cx, cy) => lay(cx, cy, FARM_PLANS.fold, 7),
    quarry: (cx, cy) => lay(cx, cy, FARM_PLANS.quarry, 7),
    well: (cx, cy) => { turf(cx, cy, 5); return lay(cx, cy, FARM_PLANS.well, 6) },
    field: (cx, cy) => lay(cx, cy, FARM_PLANS.field, 6),
  }

  // ---- a ruined keep -----------------------------------------------------------
  // The tower still stands and its door leads in; of the wall round the yard
  // only runs are left, never across a road.
  // In the desert (`c.desert`) its pad (`c.pad`) is sand, and its yard is
  // strewn with rubble and broken pots once the piece is done (finishDesert).
  function ruin(cx, cy) {
    if (c.desert) sandPad(cx, cy, c.pad)
    ruinTower(cx, cy)
    ruinYard(cx, cy)
  }
  // The tower, its door (returned) at (cx, cy) and two rows clear before it.
  function ruinTower(cx, cy) {
    row(cx - 1, cy - 3, ['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'])
    row(cx - 1, cy - 2, ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'])
    row(cx - 1, cy - 1, ['ow_brick', 'ow_brick', 'ow_brick'])
    row(cx - 1, cy, ['ow_house_wall_stone_l', 'ow_house_arch_stone', 'ow_house_wall_stone_r'])
    const door = c.door(cx, cy, 'ruin', null, { look: { w: 3, storeys: 2, wall: 'stone' } })
    for (let i = -1; i <= 1; i++) for (let j = 1; j <= 2; j++) { t.clear(cx + i, cy + j); hold(cx + i, cy + j) }
    return door
  }
  // What is left of the wall round the tower at (cx, cy), and its yard.
  // `offWay`: no fallen stone or bone on a trail either (the watchtower).
  function ruinYard(cx, cy, offWay = false) {
    const wall = (x, y, skin) => { if (!t.onPath(x, y) && !c.taken(x, y)) put(x, y, skin) }
    // north wall: parapet over brick, in runs
    let run = 0
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (run <= 0 && rng() < 0.45) run = -ri(1, 2)          // a gap
      else if (run <= 0) run = ri(2, 4)
      if (run > 0) { wall(x, cy - 6, x === cx - 6 ? 'ow_castle_parapet_l' : x === cx + 6 ? 'ow_castle_parapet_r' : 'ow_castle_parapet_m'); wall(x, cy - 5, 'ow_brick'); run-- } else run++
    }
    for (const x of [cx - 6, cx + 6]) for (let y = cy - 4; y <= cy + 4; y++) if (rng() < 0.55) wall(x, y, 'ow_brick')
    for (let x = cx - 6; x <= cx + 6; x++) if (Math.abs(x - cx) >= 3 && rng() < 0.4) wall(x, cy + 5, 'ow_brick')
    // the yard: worn flagstones, fallen columns, bones
    for (let dy = -4; dy <= 4; dy++) for (let dx = -5; dx <= 5; dx++)
      if (t.free(cx + dx, cy + dy) && !t.onPath(cx + dx, cy + dy) && rng() < 0.3) t.setGround(cx + dx, cy + dy, c.sandy ? pick(SAND_FLOOR) : 'ow_cobble_green')
    const stones = c.sandy ? SAND_STONES : OLD_STONES
    const ok = offWay ? offPaths : null
    scatter(cx, cy, 3, 5, 6, stones, true, ok)
    scatter(cx, cy, 2, 5, 3, ['ow_deco_skull'], false, ok)
    if (c.desert) desertYards.push({ x: cx, y: cy })
  }
  // The desert's yards (ruinYard), strewn last of all (finishDesert).
  const desertYards = []
  // What the desert's wayside places finish last of all (finishDesert): the
  // fires of rests (a palm beside each), the walled well's date palms (a
  // crown on each) and the big inn's house (its awnings).
  const desertLater = { fires: [], palms: [], inns: [] }
  // An inn's yard in the desert: sand within r of `at`, and no dune on it.
  const yardOfSand = (at, r) => { sandPad(at.x, at.y, r); t.keepOpen(at.x, at.y, r) }

  // ---- the wayside places (WAYSIDE_PLANS) ---------------------------------------
  // Each returns what lay does ({ doors, people, at }); features.js gives the
  // people their lines and puts the chests down. In the desert (`c.desert`)
  // each stands on a pad of sand (the rest's and the shrine's `c.pad`, the
  // inn's yard round where it was laid), kept clear of dunes.
  const wayside = {
    rest: (cx, cy) => {
      if (c.desert) sandPad(cx, cy, c.pad)
      const made = lay(cx, cy, WAYSIDE_PLANS.rest, 5)
      if (c.desert) desertLater.fires.push(...made.fires)
      return made
    },
    shrine: (cx, cy) => {
      if (c.desert) sandPad(cx, cy, c.pad)
      const made = lay(cx, cy, WAYSIDE_PLANS.shrine, 5)
      scatter(made.at.x, made.at.y, 3, 5, 8, c.desert ? BLOOMS : FLOWERS, false, offPaths)
      return made
    },
    // the big inn and its stable where one of its plans stands whole, else the smaller inn
    // (`avoid`: ground it must leave alone, the small things' that are stamped after it)
    // (`small` says it was the smaller one, which has no stable; in the desert
    // its house is of mud brick and its yard walled with it)
    inn: (cx, cy, avoid = null) => {
      const big = lay(cx, cy, INN_PLANS, INN_PAD, { whole: true, shift: INN_SHIFT, avoid })
      if (big) { if (c.desert) yardOfSand(big.at, INN_PAD); return big }
      const small = lay(cx, cy, WAYSIDE_PLANS.inn, 9, { kit: c.desert ? 'adobe' : 'kenney' })
      if (small && c.desert) yardOfSand(small.at, 9)
      return small && { ...small, small: true }
    },
    // the ruin kit: the tower moved off the trails as a farm's house is, its broken walls round it
    tower: (cx, cy) => {
      if (c.desert) sandPad(cx, cy, c.pad)
      const made = lay(cx, cy, WAYSIDE_PLANS.tower, 8)
      if (made.doors.length) ruinYard(made.doors[0].x, made.doors[0].y, true)
      return made
    },
  }
  // A stone beside the road; it gives way like any dressing.
  const milestone = (x, y) => low(x, y, MILESTONE)
  // A village's coach (features.js, wilds/coach.js): the inn's horse and cart,
  // the horse at (x, y) and the cart east of it. It stays where it is put: it
  // is no dressing, and nothing takes it up.
  const coach = (x, y) => { put(x, y, CART[0]); put(x + 1, y, CART[1]) }

  // ---- camps -------------------------------------------------------------------
  // look: 'bandits' (tents round a fire), 'graves', 'den' (rocks and bones),
  // 'nest' (mounds, dead trees, bones). In the desert its pad is sand and
  // both tents are of striped canvas.
  function camp(cx, cy, look) {
    if (c.desert) sandPad(cx, cy, c.pad)
    if (look === 'bandits') {
      fire(cx, cy)
      tent(cx - 4, cy - 4, c.desert ? DESERT_TENT : 'ow_tent'); tent(cx + 2, cy - 4, c.desert ? DESERT_TENT : 'ow_tent_tan')
      low(cx - 2, cy + 1, 'ow_prop_bedroll_0'); low(cx + 2, cy + 1, 'ow_prop_bedroll_1')
      low(cx + 4, cy - 1, 'ow_prop_barrel_1'); low(cx + 4, cy, 'ow_prop_crate_2'); low(cx - 4, cy, 'ow_prop_sack_1')
      low(cx - 1, cy + 3, 'ow_prop_log')
    } else if (look === 'graves') {
      for (const gy of [cy - 3, cy - 1, cy + 2]) for (const gx of [cx - 4, cx - 2, cx + 2, cx + 4]) if (rng() < 0.75) low(gx, gy, pick(GRAVES))
      low(cx - 5, cy + 1, DEAD[0]); low(cx + 5, cy - 2, DEAD[1])
      low(cx, cy - 4, 'ow_prop_cross_1')
      scatter(cx, cy, 1, 5, 4, ['ow_deco_skull'])
    } else if (look === 'den') {
      // a horseshoe of rock open to the south, the pack in its lap
      const rock = (dx, dy) => { if (c.sandy) put(cx + dx, cy + dy, pick(c.rocks)); else { t.setMass(cx + dx, cy + dy); hold(cx + dx, cy + dy) } }
      claimBox(cx - 5, cy - 7, cx + 5, cy - 2)
      if (!c.sandy) for (let dy = -7; dy <= -2; dy++) for (let dx = -5; dx <= 5; dx++) if (!((dy === -7 || dy === -2) && Math.abs(dx) === 5)) t.setFloor(cx + dx, cy + dy)
      for (let dx = -1; dx <= 1; dx++) rock(dx, -6)
      for (let dx = -3; dx <= 3; dx++) rock(dx, -5)
      for (let dx = -4; dx <= 4; dx++) rock(dx, -4)
      for (const dx of [-4, -3, 3, 4]) rock(dx, -3)
      walkRound(cx - 5, cy - 7, cx + 5, cy - 2)
      low(cx - 3, cy + 2, 'ow_prop_log'); low(cx + 3, cy + 3, 'ow_prop_stump_1')
      scatter(cx, cy, 1, 5, 5, ['ow_deco_skull'])
    } else {
      for (const [dx, dy] of [[-3, -2], [2, -3], [4, 1], [-2, 3], [-4, 1], [0, -4]]) low(cx + dx, cy + dy, 'ow_prop_mound')
      low(cx - 5, cy - 1, DEAD[0]); low(cx + 1, cy + 4, DEAD[1]); low(cx + 5, cy - 3, DEAD[0])
      scatter(cx, cy, 1, 5, 5, ['ow_deco_skull'])
    }
  }
  // Whatever lives here is big: a fire, what it took, what it ate.
  function lair(cx, cy) {
    fire(cx, cy)
    low(cx - 3, cy - 2, 'ow_prop_crate_1'); low(cx - 4, cy - 2, 'ow_prop_barrel_0'); low(cx - 3, cy - 3, 'ow_prop_sack_1')
    low(cx + 3, cy + 2, 'ow_prop_log')
    scatter(cx, cy, 1, 5, 6, ['ow_deco_skull'])
  }

  // ---- small guarded things ------------------------------------------------------
  function nest(x, y) {
    low(x - 1, y - 1, 'ow_prop_mound'); low(x + 1, y - 1, 'ow_prop_mound')
    flat(x - 1, y + 1, 'ow_deco_skull'); flat(x + 2, y, 'ow_deco_skull')
    low(x + 2, y - 2, pick(DEAD))
  }
  function stones(x, y) {
    const set = c.sandy ? SAND_STONES : OLD_STONES
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 - Math.PI / 2
      low(x + Math.round(Math.cos(a) * 2), y + Math.round(Math.sin(a) * 2), pick(set))
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rng() < 0.6) t.setGround(x + dx, y + dy, c.sandy ? pick(SAND_FLOOR) : 'ow_cobble_green')
    flat(x + 1, y + 1, 'ow_deco_skull')
  }

  // ---- a cave mouth in an outcrop -------------------------------------------------
  // The arch is the pair (x, y), (x + 1, y); rock is heaped behind and beside it.
  function cave(x, y) {
    // a hill of mountain rock, on a patch of its stony ground; on sand,
    // where the mountain art has no edge to sit on, a heap of boulders; in
    // the desert an outcrop of its sandstone, the mouth in its face (the
    // boulder each cell would have been is still drawn, so the piece's
    // draws stay as they were)
    const hill = !c.sandy
    const rock = (dx, dy) => {
      if (hill) { t.setMass(x + dx, y + dy); hold(x + dx, y + dy) }
      else if (c.desert) { pick(c.rocks); t.setOutcrop(x + dx, y + dy); hold(x + dx, y + dy) }
      else put(x + dx, y + dy, pick(c.rocks))
    }
    claimBox(x - 4, y - 4, x + 5, y + 1)
    if (hill) for (let dy = -4; dy <= 1; dy++) for (let dx = -4; dx <= 5; dx++) if (!((dy === -4 || dy === 1) && (dx === -4 || dx === 5))) t.setFloor(x + dx, y + dy)
    for (let dx = -1 + (rng() < 0.5 ? 1 : 0); dx <= 2 - (rng() < 0.5 ? 1 : 0); dx++) rock(dx, -3)
    for (let dx = -2; dx <= 3; dx++) rock(dx, -2)
    for (let dx = -3; dx <= 4; dx++) rock(dx, -1)
    for (const dx of [-3, -2, -1, 2, 3, 4]) rock(dx, 0)
    walkRound(x - 4, y - 4, x + 5, y + 1)
    for (const dx of [0, 1]) { t.clear(x + dx, y); t.clear(x + dx, y + 1); hold(x + dx, y); hold(x + dx, y + 1) }
    const mouth = c.desert ? SAND_MOUTH : CAVE_MOUTH
    t.setProp(x, y, mouth[0], { walkable: true }); t.setProp(x + 1, y, mouth[1], { walkable: true })
  }

  // ---- landmarks -------------------------------------------------------------------
  function statue(cx, cy) {
    cobble(cx, cy, 6)
    put(cx, cy - 1, 'ow_statue_top'); put(cx, cy, 'ow_statue')
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) low(cx + dx, cy + dy, 'ow_prop_torch')
    scatter(cx, cy, 3, 6, 8, FLOWERS)
  }
  // Lily pads on a pond already dug.
  function lilies(cx, cy, r, n) {
    const open = []
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
      if (t.kind(x, y) === 'water' && !t.propAt(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => t.kind(x + dx, y + dy) === 'water')) open.push({ x, y })
    for (; n > 0 && open.length; n--) {
      const at = open.splice(Math.floor(rng() * open.length), 1)[0]
      t.setProp(at.x, at.y, pick(['ow_lily_0', 'ow_lily_1', 'ow_lily_2']))
    }
  }
  const flowers = (cx, cy, rMin, rMax, n) => scatter(cx, cy, rMin, rMax, n, FLOWERS)

  // ---- tale places: each returns its named points ---------------------------------
  const wob = (x, y, salt) => (c.hash(x, y, salt) - 0.5) * 1.6

  // The elk's wood: a tended shrine, and three wallows a long run apart.
  function elkWood(g) {
    const { cx, cy } = g
    // ways through the trees first (they would dry a pool dug before them)
    for (const c of g.ways) t.clear(c.x, c.y)
    // nothing solid or wet goes on a way: it is the one sure road to each
    // wallow; nor on a path, which the wood grows right up to
    const ways = new Set(g.ways.map(c => `${c.x},${c.y}`))
    const offWay = (x, y) => !ways.has(`${x},${y}`) && !t.onPath(x, y)
    cobble(cx, cy, 10)
    put(cx, cy - 1, 'ow_statue_top'); put(cx, cy, 'ow_statue')
    low(cx - 2, cy, 'ow_prop_pot'); low(cx + 2, cy, 'ow_prop_sack_0')
    low(cx - 2, cy - 2, 'ow_prop_torch'); low(cx + 2, cy - 2, 'ow_prop_torch')
    low(cx - 3, cy + 2, 'ow_prop_grave_2'); low(cx + 3, cy + 2, 'ow_prop_grave_3')
    hold(g.hub.x, g.hub.y)
    scatter(cx, cy, 2, 5, 6, FLOWERS)
    for (const w of g.wallows) {
      // churned ground, then the pool on the side away from the shrine
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 14) {
        t.clear(w.x + dx, w.y + dy); t.setGround(w.x + dx, w.y + dy, t.dirtSkin(w.x + dx, w.y + dy)); hold(w.x + dx, w.y + dy)
      }
      for (const [dx, dy] of [[-1, 1], [0, 1], [1, 1], [-1, 2], [0, 2], [1, 2], [0, 3], [-2, 2], [2, 2], [1, 3]])
        if (offWay(w.x + dx, w.y + dy * w.away)) t.setWater(w.x + dx, w.y + dy * w.away)
      for (const [dx, dy, skin] of [[-3, 0, 'ow_prop_stump_0'], [3, -1, 'ow_prop_stump_1'], [2, -2, 'ow_prop_stump_0']])
        if (offWay(w.x + dx, w.y + dy * w.away)) low(w.x + dx, w.y + dy * w.away, skin)
    }
    return [{ label: 'forest shrine', ...g.hub }, ...g.wallows.map((w, i) => ({ label: `wallow ${i + 1}`, x: w.x, y: w.y }))]
  }

  // The broken causeway: a lake with a fishing islet, a deck out to it whose
  // middle the quest breaks, and the tar pit and the crew's hut on the bank.
  function causeway(g) {
    const { cx, cy } = g
    for (let dy = -13; dy <= 13; dy++) for (let dx = -13; dx <= 13; dx++) {
      const d = Math.hypot(dx, dy)
      if (d <= 3) { t.clear(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
      else if (d + wob(cx + dx, cy + dy, 520) <= 12) { t.setWater(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
    }
    // the deck runs west from the islet until it meets the bank
    // ten cells of deck from the islet to the bank at cx - 14 (the hub), over
    // water wherever the lake's edge wobbles
    const deck = Array.from({ length: 10 }, (_, i) => cx - 4 - i)
    for (const x of deck) { t.setWater(x, cy); t.setProp(x, cy, 'ow_pier_log', { walkable: true }); hold(x, cy) }
    const mid = deck[Math.floor(deck.length / 2)]
    // the islet: racks, a barrel, what the village cannot reach
    put(cx - 1, cy - 2, 'ow_prop_fishrack_l'); put(cx, cy - 2, 'ow_prop_fishrack_r'); low(cx + 1, cy - 2, 'ow_prop_barrel_1')
    c.spawn({ kind: 'chest', x: cx + 1, y: cy })
    // the bank: the pit, its kiln and wood, the crew's hut
    const bx = deck[deck.length - 1] - 1
    // made ground: by the sea the bank would otherwise be open water
    for (let dy = -5; dy <= 7; dy++) for (let dx = -8; dx <= 0; dx++) t.clear(bx + dx, cy + dy)
    const pit = { x: bx - 1, y: cy - 2 }
    t.setProp(pit.x, pit.y, 'ow_deco_firepit', { walkable: true }); hold(pit.x, pit.y)
    put(pit.x - 1, pit.y - 1, 'ow_kiln_cold')
    low(pit.x + 1, pit.y - 1, 'ow_prop_woodpile'); low(pit.x - 2, pit.y, 'ow_prop_woodpile'); low(pit.x - 2, pit.y + 1, 'ow_prop_woodpile')
    low(pit.x - 1, pit.y + 1, 'ow_prop_barrel_0'); low(pit.x + 1, pit.y - 2, 'ow_prop_stump_axe')
    const h = house(bx - 4, cy + 4, 'hut', { w: 3 })
    low(h.x1 + 1, cy + 4, 'ow_prop_barrel_1')
    return [
      { label: 'tar pit', ...pit }, { label: 'lumber camp', x: bx - 4, y: cy + 5 },
      ...[-1, 0, 1].map((d, i) => ({ label: `bridge gap ${i + 1}`, x: mid + d, y: cy })),
    ]
  }

  // The giant's oven: a bare bowl on stony ground with the capstone in its
  // middle, standing stones round the rim, and the hermit's hut to one side.
  function oven(g) {
    const { cx, cy } = g
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 > 64) continue
      if (d2 <= 50) t.clear(cx + dx, cy + dy)
      // stony all over, the roads into it too: the bowl is one scorched floor
      t.setFloor(cx + dx, cy + dy, { roads: true })
      // a built hearth of flagstones under and round the capstone
      if (d2 <= 2) t.setGround(cx + dx, cy + dy, 'ow_stone_ground_0')
    }
    t.setProp(cx, cy, 'ow_mtn_rock_cap'); hold(cx, cy)
    // the six cells the quest raises its stones on stay bare
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [3, 3], [-3, -3], [3, -3]]) hold(cx + dx, cy + dy)
    scatter(cx, cy, 2, 6, 7, ['ow_deco_skull'])
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + 0.3
      const x = cx + Math.round(Math.cos(a) * 8), y = cy + Math.round(Math.sin(a) * 8)
      if (!t.onPath(x, y) && !(Math.abs(x - g.hub.x) <= 1 && y > cy)) put(x, y, pick(OLD_STONES))
    }
    // the hermit's hut, and a way from it to the bowl
    const door = { x: cx + 11, y: cy + 3 }
    t.clearLine(door.x, door.y + 1, cx + 6, cy + 2)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) t.clear(door.x + dx, door.y + dy)
    const h = house(door.x, door.y, 'hut', { w: 3, wall: 'stone' })
    low(h.x0 - 1, door.y, 'ow_prop_woodpile'); low(h.x1 + 1, door.y + 1, 'ow_prop_stump_axe')
    c.npc('hermit', door.x + 1, door.y + 1)
    return [{ label: 'hiidenkiuas', x: cx, y: cy }, { label: 'hermit hut', ...door }]
  }

  // The bell lake (the Näkki): a pier that stops four planks short of an
  // orchard island, the silent bell at its end, an islet with the clapper on
  // a spit of land, and the ferryman's hut on the bank.
  function bellLake(g) {
    const { cx, cy } = g
    const islet = { x: cx - 6, y: cy + 9 }
    for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
      const d = Math.hypot(dx, dy)
      if (d <= 4) { t.clear(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
      else if (d + wob(cx + dx, cy + dy, 530) <= 13) { t.setWater(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
    }
    // the pier: five standing planks from the bank at cx - 14, then four gone
    const standing = [cx - 13, cx - 12, cx - 11, cx - 10, cx - 9], gone = [cx - 8, cx - 7, cx - 6, cx - 5]
    for (const x of [...standing, ...gone]) { t.setWater(x, cy); hold(x, cy) }
    for (const x of standing) t.setProp(x, cy, 'ow_pier_log', { walkable: true })
    const end = { x: cx - 9, y: cy }
    t.setWater(end.x, cy - 1); t.setProp(end.x, cy - 1, 'ow_prop_bell'); hold(end.x, cy - 1)
    // the islet and the spit that joins it to the south bank
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 4) { t.clear(islet.x + dx, islet.y + dy); hold(islet.x + dx, islet.y + dy) }
    for (let y = islet.y + 2; y <= cy + 15; y++) { t.clear(islet.x, y); hold(islet.x, y) }
    put(islet.x - 1, islet.y - 1, pick(DEAD))
    c.spawn({ kind: 'floating_pickup', contents: { type: 'clapper' }, x: islet.x, y: islet.y })
    // the orchard nobody can reach
    for (const [dx, dy] of [[-2, -2], [0, -3], [2, -2], [-3, 1], [3, 1], [-1, 2]]) put(cx + dx, cy + dy, 'ow_tree_apple')
    c.spawn({ kind: 'chest', x: cx + 1, y: cy + 1, sealed: true })
    scatter(cx, cy, 0, 3, 4, FLOWERS)
    // the bank: Toivo's hut, his racks, what he fed the lake from
    const bx = cx - 14
    for (let dy = -5; dy <= 7; dy++) for (let dx = -8; dx <= 0; dx++) t.clear(bx + dx, cy + dy)
    const h = house(bx - 4, cy + 4, 'hut', { w: 3, wall: 'wood', story: "Toivo's hut" })
    put(bx - 2, cy - 2, 'ow_prop_fishrack_l'); put(bx - 1, cy - 2, 'ow_prop_fishrack_r')
    low(h.x1 + 1, cy + 4, 'ow_prop_barrel_1'); low(bx - 6, cy - 2, 'ow_prop_bucket')
    t.setProp(bx - 3, cy - 1, 'ow_deco_firepit', { walkable: true }); hold(bx - 3, cy - 1)
    return [
      { label: 'bell', ...end }, { label: 'pier end', ...end }, { label: 'nakki', x: gone[0], y: cy },
      ...gone.map((x, i) => ({ label: `pier gap ${i + 1}`, x, y: cy })),
      { label: 'orchard', x: cx, y: cy }, { label: 'islet cache', ...islet }, { label: "Toivo's hut", x: bx - 4, y: cy + 4 },
    ]
  }

  // The ridge (the fold): the wolves' den, the burrow the lambs went into,
  // sealed with rock a pick can open, and the wood the village burns a band at a time.
  function ridge(g) {
    const { cx, cy, burrow: B } = g
    for (const w of g.ways) { t.clear(w.x, w.y); hold(w.x, w.y) }
    camp(cx, cy, 'den')
    for (const [dx, dy] of [[-2, 0], [1, -1], [2, 1]]) { t.clear(cx + dx, cy + dy); c.npc('wolf', cx + dx, cy + dy, { hostile: false }) }
    for (let dy = -5; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) t.setFloor(B.x + dx, B.y + dy, { roads: true })
    for (let dy = -4; dy <= 0; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = B.x + dx, y = B.y + dy
      if (Math.abs(dx) <= 1 && (dy === -1 || dy === -2)) { t.clear(x, y); hold(x, y) }         // the hollow
      else if (Math.abs(dx) <= 1 && dy === 0) put(x, y, pick(c.rocks))                        // its mouth, walled up
      else { t.setMass(x, y); hold(x, y) }
    }
    walkRound(B.x - 4, B.y - 5, B.x + 4, B.y + 1)
    c.spawn({ kind: 'floating_pickup', contents: { type: 'fleece' }, x: B.x, y: B.y + 1 })
    // a prospector's leavings
    low(B.x + 3, B.y + 2, 'ow_prop_crate_2'); low(B.x - 3, B.y + 2, 'ow_prop_bucket'); low(B.x + 2, B.y + 3, 'ow_prop_sack_1')
    flat(B.x - 1, B.y + 2, 'ow_deco_skull')
    for (const b of g.burns) for (let i = 0; i < 7; i++) { const at = c.freeSpot(b.x, b.y, 1, 4); if (at && !t.onPath(at.x, at.y)) put(at.x, at.y, 'ow_tree_small') }
    return [
      { label: 'den', x: cx, y: cy }, ...g.burns.map((b, i) => ({ label: `burn ${i + 1}`, ...b })),
      { label: 'burrow', ...B }, { label: 'lair', x: B.x, y: B.y - 2 }, { label: 'fleece cache', x: B.x, y: B.y + 1 },
    ]
  }

  // The knoll (the flame-thief): a rise of stony ground where grey trees
  // stand that grow nowhere else, and the silent hermit's hut beside it.
  function knoll(g) {
    const { cx, cy } = g
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dy * dy <= 64) {
      t.clear(cx + dx, cy + dy)
      if (dx * dx + dy * dy <= 49) t.setFloor(cx + dx, cy + dy, { roads: true })
    }
    hold(g.hub.x, g.hub.y)
    // the stand: one tree on every other cell of a loose ring and its heart, never on a road
    let grown = 0
    for (let i = 0; i < 300 && grown < 16; i++) {
      const a = rng() * Math.PI * 2, r = 1.5 + rng() * 4.5
      const x = cx + Math.round(Math.cos(a) * r), y = cy + Math.round(Math.sin(a) * r)
      if (!t.free(x, y) || c.taken(x, y) || t.onPath(x, y)) continue
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (t.propAt(x + dx, y + dy) ?? '').startsWith('ow_greytree_'))) continue
      put(x, y, pick(['ow_greytree_0', 'ow_greytree_1'])); grown++
    }
    const door = { x: cx + 7, y: cy + 4 }
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) t.clear(door.x + dx, door.y + dy)
    const h = house(door.x, door.y, 'hut', { w: 3, wall: 'stone', roof: 'blue', story: 'hermit hut' })
    const hearth = { x: h.x0 - 2, y: door.y + 1 }
    t.setProp(hearth.x, hearth.y, 'ow_deco_firepit', { walkable: true }); hold(hearth.x, hearth.y)
    low(h.x1 + 1, door.y, 'ow_prop_woodpile')
    c.npc('hermit', door.x + 1, door.y + 1)
    return [{ label: 'knoll', x: cx, y: cy }, { label: 'hermit hut', ...door }, { label: 'hearth', ...hearth }]
  }

  // Lalli's pine (the Lalli tale): one tall pine no axe fells, alone on open
  // ground; a pond with a pier out to its middle; the piper's camp. Lalli,
  // the mice and the piper are the tale's own to put there (wilds/tale-lalli.js).
  function lalliTree(g) {
    const { cx, cy, pond: P, camp: C, bank } = g
    for (const w of g.ways) { t.clear(w.x, w.y); hold(w.x, w.y) }
    for (let dy = -4; dy <= 5; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 20) { t.clear(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
    put(cx, cy - 1, 'ow_lalli_pine_top'); put(cx, cy, 'ow_lalli_pine_trunk')
    // the pond, with a shore to walk all the way round
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      const d = Math.hypot(dx, dy)
      if (d + wob(P.x + dx, P.y + dy, 540) <= 4.6) { t.setWater(P.x + dx, P.y + dy); hold(P.x + dx, P.y + dy) }
      else if (d <= 6.6) { t.clear(P.x + dx, P.y + dy); hold(P.x + dx, P.y + dy) }
    }
    // five planks from the bank to within a step of the pond's middle
    for (let x = bank.x + 1; x <= P.x - 1; x++) { t.setWater(x, P.y); t.setProp(x, P.y, 'ow_pier_log', { walkable: true }); hold(x, P.y) }
    // the camp: a tent, a fire, a bedroll, and a barrel with nothing left in it
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { t.clear(C.x + dx, C.y + dy); hold(C.x + dx, C.y + dy) }
    tent(C.x - 2, C.y - 2, 'ow_tent_tan')
    fire(C.x + 1, C.y + 1)
    low(C.x - 2, C.y + 1, 'ow_prop_barrel_0'); low(C.x + 2, C.y - 2, 'ow_prop_log'); low(C.x, C.y - 2, 'ow_prop_bedroll_0')
    return [
      { label: 'lalli tree', x: cx, y: cy - 1 }, { label: 'tree foot', x: cx, y: cy + 1 },
      { label: 'pond', ...P }, { label: 'pier end', x: P.x - 1, y: P.y }, { label: 'pier bank', ...bank }, { label: 'piper camp', ...C },
    ]
  }

  // What a village's own tale leaves standing in it. Laid where the village
  // keeps no house, door or road end. Returns the village's named points.
  function villageTrouble(tale, cx, cy) {
    // Lalli's house is the one by the field (village() marks its door); Kerttu
    // waits beside the doorstep. She is the tale's own to put there.
    if (tale === 'lalli') return [{ label: LALLI_HOUSE, x: cx - 7, y: cy + 5 }, { label: 'kerttu', x: cx - 6, y: cy + 6 }]
    if (tale === 'nakki') {
      // up to two fish racks standing empty since the pier was given up,
      // north of the west street's lanes and off any trail (a rack is two
      // cells wide and goes whole or not at all)
      let racks = 0
      for (const y of [cy - 3, cy - 2, cy - 4]) if (racks < 2 && !t.onPath(cx - 11, y) && !t.onPath(cx - 10, y)) { put(cx - 11, y, 'ow_prop_fishrack_l'); put(cx - 10, y, 'ow_prop_fishrack_r'); racks++ }
    }
    if (tale === 'fold') {
      // the fold the lambs go missing from, south-east of the square; the
      // ground east and south of it is opened so a road that ran there goes round
      claimBox(cx + 6, cy + 7, cx + 12, cy + 12)
      fence(cx + 7, cy + 8, cx + 11, cy + 11, { x: cx + 8, y: cy + 8 }, true)
      for (let dy = 9; dy <= 10; dy++) for (let dx = 8; dx <= 10; dx++) { t.clear(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
      for (let d = 7; d <= 12; d++) t.clear(cx + d, cy + 12)
      for (let d = 8; d <= 12; d++) t.clear(cx + 12, cy + d)
      for (let d = 8; d <= 12; d++) { t.clear(cx + d, cy + 7); hold(cx + d, cy + 7) }   // and north of it, the way in from the square
      for (const [dx, dy] of [[8, 10], [9, 9], [10, 10]]) c.npc('sheep', cx + dx, cy + dy)
    }
    if (tale === 'flame') {
      // three hearths on the square, lit at dusk and cold by midnight
      const hearths = [[-2, -2], [2, -2], [0, 3]].map(([dx, dy], i) => ({ label: `hearth ${i + 1}`, x: cx + dx, y: cy + dy }))
      for (const h of hearths) put(h.x, h.y, 'prop_hearth_cold')
      return hearths
    }
    return []
  }

  // ---- the Sampo's three pieces (city/sampo.js, city/sampo-places.js) ---------------
  // Water with a pier out from the west bank: Iku-Turso's bay (the sea piece)
  // and the great pike's pond (the marsh piece). The guardian rises at a
  // `lair` cell, each a step off the planks; the piece is laid at the pier's end.
  function pierWater(g, salt, dress) {
    const { cx, cy, r } = g
    for (let dy = -r - 3; dy <= r + 3; dy++) for (let dx = -r - 3; dx <= r + 3; dx++) {
      const d = Math.hypot(dx, dy)
      if (d + wob(cx + dx, cy + dy, salt) <= r) { t.setWater(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
      else if (d <= r + 2.6) { t.clear(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
    }
    const bank = { x: cx - r - 2, y: cy }, end = { x: cx - 2, y: cy }
    // made ground at the pier's foot: by the sea the bank would otherwise be open water
    for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 0; dx++) { t.clear(bank.x + dx, cy + dy); hold(bank.x + dx, cy + dy) }
    for (let x = bank.x + 1; x <= end.x; x++) { t.setWater(x, cy); t.setProp(x, cy, 'ow_pier_log', { walkable: true }); hold(x, cy) }
    // open water round the planks, whatever the shore's wobble did
    const lairs = [[1, 0], [-1, -1], [-1, 1], [-4, -1], [-4, 1]].map(([dx, dy]) => ({ x: end.x + dx, y: cy + dy })).filter(c => c.x > bank.x + 2)
    for (const c of lairs) { t.setWater(c.x, c.y); hold(c.x, c.y) }
    dress(bank)
    return [{ label: 'pier end', ...end }, { label: 'pier bank', ...bank }, ...lairs.map((c, i) => ({ label: `lair ${i + 1}`, ...c }))]
  }
  const tursoBay = g => pierWater(g, 560, bank => {
    put(bank.x - 3, bank.y - 2, 'ow_prop_fishrack_l'); put(bank.x - 2, bank.y - 2, 'ow_prop_fishrack_r')
    low(bank.x - 3, bank.y + 2, 'ow_prop_barrel_1'); low(bank.x - 1, bank.y + 2, 'ow_prop_bucket')
  })
  const pikePond = g => {
    const points = pierWater(g, 570, bank => { low(bank.x - 2, bank.y - 2, 'ow_prop_stump_0'); low(bank.x - 3, bank.y + 2, 'ow_prop_log') })
    lilies(g.cx + 2, g.cy, g.r - 2, 6)
    return points
  }
  // The copper mountain's foot: a bare bowl of scorched stone ringed with old
  // stones, three cold braziers in it, and the vault's place in the middle.
  function copperBowl(g) {
    const { cx, cy } = g
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 > 81) continue
      if (d2 <= 68) t.clear(cx + dx, cy + dy)
      t.setFloor(cx + dx, cy + dy, { roads: true })
    }
    const braziers = [[0, -5], [-5, 3], [5, 3]].map(([dx, dy], i) => ({ label: `brazier ${i + 1}`, x: cx + dx, y: cy + dy }))
    for (const b of braziers) { put(b.x, b.y, 'prop_brazier_cold'); hold(b.x, b.y) }
    for (const [dx, dy] of [[0, 0], [0, -2], [1, 1], [-1, 1]]) hold(cx + dx, cy + dy)
    scatter(cx, cy, 2, 7, 6, ['ow_deco_skull'])
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2 + 0.2
      const x = cx + Math.round(Math.cos(a) * 9), y = cy + Math.round(Math.sin(a) * 9)
      if (!t.onPath(x, y) && !(Math.abs(x - g.hub.x) <= 1 && y > cy)) put(x, y, pick(OLD_STONES))
    }
    return [{ label: 'vault', x: cx, y: cy }, { label: 'den', x: cx, y: cy - 2 }, ...braziers]
  }

  const tales = { elk: elkWood, tar: causeway, kivihiisi: oven, nakki: bellLake, fold: ridge, flame: knoll, lalli: lalliTree,
    sampo_sea: tursoBay, sampo_mountain: copperBowl, sampo_marsh: pikePond }
  return { house, village, finishVillage, finishDesert, hut, ruin, camp, lair, nest, stones, cave, statue, lilies, flowers, tales, villageTrouble, dressing, milestone, coach, ...farms, ...wayside }
}
