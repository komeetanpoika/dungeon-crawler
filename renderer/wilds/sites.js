// What the things of a Wilds piece look like: houses of several sizes, a
// village with a field and a stall, a ruined keep, camps dressed for whoever
// camps there, a cave mouth in an outcrop. Stamps only: features.js decides
// what goes where, opens the ground and lays the paths first.
//
// Three kinds of tile art, by name:
//   ow_prop_*, ow_fence_*   low things: they block the way, a sight line passes over
//   ow_deco_*               flat things: walked on
//   everything else         solid, and hides what is behind it
//
// The house kit is Tiny Town's: two rows of roof (a chimney up top, a gable
// over the door), then one or two rows of wall with windows and the door.

const ROOF = {
  red: { top: ['ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r'], low: ['ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er'], chim: 'ow_roof_red_chim', gable: 'ow_roof_gable_red' },
  blue: { top: ['ow_roof_blue_l', 'ow_roof_blue_m', 'ow_roof_blue_r'], low: ['ow_roof_blue_el', 'ow_roof_blue_em', 'ow_roof_blue_er'], chim: 'ow_roof_blue_chim', gable: 'ow_roof_gable_gray' },
}
const WALL = {
  stone: { l: 'ow_house_wall_stone_l', m: 'ow_house_wall_stone', r: 'ow_house_wall_stone_r', win: 'ow_house_win_stone', door: 'ow_house_door_2', dbl: ['ow_house_dbl_stone_l', 'ow_house_dbl_stone_r'] },
  wood: { l: 'ow_house_wall_brown_l', m: 'ow_house_wall_brown', r: 'ow_house_wall_brown_r', win: 'ow_house_win_brown', door: 'ow_house_door', dbl: ['ow_house_dbl_brown_l', 'ow_house_dbl_brown_r'] },
}
const GRAVES = ['ow_prop_grave_0', 'ow_prop_grave_1', 'ow_prop_grave_2', 'ow_prop_grave_3', 'ow_prop_cross_0', 'ow_prop_cross_1']
const FLOWERS = ['ow_deco_flower_0', 'ow_deco_flower_1', 'ow_deco_flower_2', 'ow_deco_flower_3']
const OLD_STONES = ['ow_ruin_stub_0', 'ow_ruin_stub_1', 'ow_ruin_col_base_0', 'ow_ruin_col_base_1']
const SAND_STONES = ['ow_ruin_pillar', 'ow_ruin_pillar_2', 'ow_ruin_rubble', 'ow_ruin_wall_2']
const SAND_FLOOR = ['ow_ruin_crack_0', 'ow_ruin_crack_1', 'ow_ruin_crack_2']
const DEAD = ['ow_deadtree_0', 'ow_deadtree_1']
const LALLI_HOUSE = "Lalli's house"

export const SITE_SKINS = [...new Set([
  ...Object.values(ROOF).flatMap(r => [...r.top, ...r.low, r.chim, r.gable]),
  ...Object.values(WALL).flatMap(w => [w.l, w.m, w.r, w.win, w.door, ...w.dbl]),
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
  'ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r', 'ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r',
  'ow_brick', 'ow_castle_parapet_l', 'ow_castle_parapet_m', 'ow_castle_parapet_r', 'ow_house_arch_stone',
  'ow_cave_arch_0', 'ow_cave_arch_1', 'ow_statue_top', 'ow_statue', 'ow_lily_0', 'ow_lily_1', 'ow_lily_2',
  'ow_deco_firepit', 'ow_kiln_cold', 'ow_mtn_rock_cap', 'ow_prop_fishrack_l', 'ow_prop_fishrack_r', 'ow_pier_log', 'ow_stone_ground_0',
  'ow_prop_bell', 'ow_tree_apple', 'ow_tree_small', 'ow_greytree_0', 'ow_greytree_1',
  // the Lalli tale: his pine (not in the lumber table) and the tale's people
  'ow_lalli_pine_top', 'ow_lalli_pine_trunk', 'npc_lalli', 'npc_lalli_tree', 'npc_piper', 'npc_kerttu',
])]

// ---- the places of the tales (data/tales.js) --------------------------------------
// Where a tale's place puts its parts, worked out before anything is stamped
// so the piece's roads, small things and packs can keep clear of them.
//   hub    where the roads from the gates meet
//   keep   circles nothing else of the piece is dealt into
//   ways   cells opened as an unmarked way through the trees; nothing is built on them
export const TALE_PAD = { elk: 7, tar: 15, kivihiisi: 9, nakki: 16, fold: 8, flame: 9, lalli: 8 }
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
  if (tale === 'nakki') {
    const cx = ri(36, 52), cy = ri(26, 50)
    return { cx, cy, hub: { x: cx - 15, y: cy }, keep: [{ x: cx - 19, y: cy + 2, r: 7 }, { x: cx - 6, y: cy + 14, r: 5 }] }
  }
  const cx = ri(26, 52), cy = ri(26, 53)
  return { cx, cy, hub: { x: cx, y: cy + 4 }, keep: [{ x: cx + 11, y: cy + 3, r: 6 }] }
}

// c: { t, rng, pick, ri, hold, spawn, place, freeSpot, door, rocks, sandy }
export function makeSites(c) {
  const { t, rng, pick, ri, hold } = c
  // Lay one piece of art, on ground cleared for it.
  const put = (x, y, skin, opts) => { t.clear(x, y); t.setProp(x, y, skin, opts); hold(x, y) }
  const low = put
  const flat = (x, y, skin) => { if (t.free(x, y) && !c.taken(x, y)) { t.setProp(x, y, skin, { walkable: true }); hold(x, y) } }
  const row = (x, y, skins) => skins.forEach((s, i) => { if (s) put(x + i, y, s) })
  const scatter = (cx, cy, rMin, rMax, n, skins, solid = false) => {
    for (let i = 0; i < n; i++) {
      const at = c.freeSpot(cx, cy, rMin, rMax)
      if (!at) return
      if (solid) put(at.x, at.y, pick(skins)); else flat(at.x, at.y, pick(skins))
    }
  }

  // A house whose door is at (dx, dy). Returns its box.
  function house(dx, dy, tier, { w = 3, roof = rng() < 0.5 ? 'red' : 'blue', wall = rng() < 0.5 ? 'stone' : 'wood', storeys = 1, story = null } = {}) {
    const R = ROOF[roof], W = WALL[wall]
    const dbl = w === 5 && rng() < 0.35
    const dcol = w === 3 ? 1 : w === 4 ? (rng() < 0.5 ? 1 : 2) : 2
    const x0 = dx - dcol, top = dy - 1 - storeys
    const ends = (kit, mid, i) => i === 0 ? kit[0] : i === w - 1 ? kit[2] : mid ?? kit[1]
    const chim = w === 3 ? (rng() < 0.5 ? 1 : -1) : 1 + Math.floor(rng() * (w - 2))
    for (let i = 0; i < w; i++) {
      put(x0 + i, top, ends(R.top, i === chim ? R.chim : null, i))
      put(x0 + i, top + 1, ends(R.low, i === dcol ? R.gable : null, i))
      if (storeys === 2) put(x0 + i, top + 2, i === 0 ? W.l : i === w - 1 ? W.r : W.win)
      let skin = i === 0 ? W.l : i === w - 1 ? W.r : W.m
      if (i === dcol) skin = dbl ? W.dbl[0] : W.door
      else if (dbl && i === dcol + 1) skin = W.dbl[1]
      else if (i > 0 && i < w - 1) skin = W.win
      put(x0 + i, dy, skin)
    }
    // the doorstep stays clear
    for (let i = -1; i <= 1; i++) { t.clear(dx + i, dy + 1); hold(dx + i, dy + 1) }
    c.door(dx, dy, tier, story)
    return { x0, x1: x0 + w - 1, top, w }
  }

  // A fenced rectangle with a gate gap in its top or bottom run.
  function fence(x0, y0, x1, y1, gate = null) {
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) {
      const top = y === y0
      let skin = x === x0 ? (top ? 'ow_fence_l' : 'ow_fence_bl') : x === x1 ? (top ? 'ow_fence_r' : 'ow_fence_br') : 'ow_fence_m'
      if (gate && gate.y === y) {
        if (x === gate.x) { t.clear(x, y); hold(x, y); continue }
        if (x === gate.x - 1 && x > x0) skin = 'ow_fence_end_r'
        if (x === gate.x + 1 && x < x1) skin = 'ow_fence_end_l'
      }
      low(x, y, skin)
    }
    for (let y = y0 + 1; y < y1; y++) { low(x0, y, 'ow_fence_side_l'); low(x1, y, 'ow_fence_side_r') }
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
  const cobble = (cx, cy, r2) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy < r2) { t.clear(cx + dx, cy + dy); t.setGround(cx + dx, cy + dy, 'ow_cobble_green') }
  }
  // A walkable ring just outside a box of rock, so a road that runs into the
  // rock still leads round it.
  const walkRound = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if (x === x0 || x === x1 || y === y0 || y === y1) { t.clear(x, y); hold(x, y) }
  }
  const tent = (x, y, kind = 'ow_tent') => { put(x, y, `${kind}_00`); put(x + 1, y, `${kind}_10`); put(x, y + 1, `${kind}_01`); put(x + 1, y + 1, `${kind}_11`) }
  const fire = (x, y) => { t.clear(x, y); c.spawn({ kind: 'campfire', x, y }) }

  // ---- the village ------------------------------------------------------------
  // Four to six houses round a cobbled well, no two rows of them touching;
  // everything stays within 11 tiles of the centre, inside the opened pad.
  function village(cx, cy, tale = null) {
    cobble(cx, cy, 14)
    put(cx, cy - 1, 'ow_well_top'); put(cx, cy, 'ow_well')
    put(cx - 2, cy + 1, 'ow_sign')
    const big = rng() < 0.5
    house(cx - 7, cy - 3, 'safe', { w: 4 + (rng() < 0.5 ? 1 : 0) })
    house(cx + 6, cy - 4, 'safe', { w: 5, storeys: big ? 2 : 1 })
    // in a Lalli village the house by the field is his: its larder holds the tale's pint
    house(cx - 7, cy + 5, 'safe', { w: 3, story: tale === 'lalli' ? LALLI_HOUSE : null })
    house(cx + 7, cy + 4, 'safe', { w: 3 + (rng() < 0.5 ? 1 : 0) })
    if (rng() < 0.5) house(cx - 3, cy - 8, 'safe', { w: 3 })
    if (rng() < 0.4) house(cx + 4, cy + 9, 'safe', { w: 3 + (rng() < 0.5 ? 1 : 0) })

    // the field, with its gate towards the houses
    fence(cx - 9, cy + 7, cx - 4, cy + 10, { x: cx - 7, y: cy + 7 })
    field(cx - 8, cy + 8, cx - 5, cy + 9)
    low(cx - 3, cy + 8, 'ow_prop_pitchfork')
    // the bee yard
    fence(cx + 3, cy - 11, cx + 6, cy - 9)
    put(cx + 4, cy - 10, 'ow_beehive'); put(cx + 5, cy - 10, 'ow_beehive')
    // a market stall on the square
    if (rng() < 0.65) {
      const g = rng() < 0.5 ? '_green' : ''
      for (let i = 0; i < 3; i++) { put(cx - 4 + i, cy + 4, `ow_stall_top${g}`); put(cx - 4 + i, cy + 5, `ow_stall_front${g}`) }
      row(cx - 4, cy + 6, ['ow_prop_counter_0', 'ow_prop_counter_1', 'ow_prop_counter_2'])
    }
    // things lying about
    low(cx - 4, cy - 3, 'ow_prop_woodpile'); low(cx - 3, cy - 4, 'ow_prop_stump_axe')
    low(cx + 3, cy - 4, 'ow_prop_barrel_1'); low(cx + 9, cy - 4, 'ow_prop_crate_0')
    low(cx + 4, cy + 4, pick(['ow_prop_sack_0', 'ow_prop_sack_1'])); low(cx + 10, cy + 4, 'ow_prop_pot')
    low(cx + 4, cy, 'ow_prop_cart'); low(cx + 1, cy - 1, 'ow_prop_bucket_water')
    low(cx - 3, cy - 3, 'ow_prop_torch'); low(cx + 3, cy + 3, 'ow_prop_torch')
    low(cx + 9, cy + 7, 'ow_prop_target'); low(cx - 10, cy, 'ow_prop_log')
    scatter(cx, cy, 4, 11, 8, FLOWERS)
  }

  // ---- a hut out in the wild ---------------------------------------------------
  function hut(x, y) {
    const h = house(x, y, 'hut', { w: 3 + (rng() < 0.4 ? 1 : 0) })
    low(h.x0 - 1, y, 'ow_prop_woodpile')
    low(h.x1 + 1, y, pick(['ow_prop_barrel_0', 'ow_prop_barrel_1', 'ow_prop_sack_0']))
    low(h.x1 + 2, y + 2, pick(['ow_prop_stump_axe', 'ow_prop_stump_0']))
    if (rng() < 0.5) for (let i = 0; i < 3; i++) flat(h.x0 - 1 + i, y + 3, 'ow_deco_crop_0')
  }

  // ---- a ruined keep -----------------------------------------------------------
  // The tower still stands and its door leads in; of the wall round the yard
  // only runs are left, never across a road.
  function ruin(cx, cy) {
    row(cx - 1, cy - 3, ['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'])
    row(cx - 1, cy - 2, ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'])
    row(cx - 1, cy - 1, ['ow_brick', 'ow_brick', 'ow_brick'])
    row(cx - 1, cy, ['ow_house_wall_stone_l', 'ow_house_arch_stone', 'ow_house_wall_stone_r'])
    c.door(cx, cy, 'ruin')
    for (let i = -1; i <= 1; i++) for (let j = 1; j <= 2; j++) { t.clear(cx + i, cy + j); hold(cx + i, cy + j) }
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
    scatter(cx, cy, 3, 5, 6, stones, true)
    scatter(cx, cy, 2, 5, 3, ['ow_deco_skull'])
  }

  // ---- camps -------------------------------------------------------------------
  // look: 'bandits' (tents round a fire), 'graves', 'den' (rocks and bones),
  // 'nest' (mounds, dead trees, bones)
  function camp(cx, cy, look) {
    if (look === 'bandits') {
      fire(cx, cy)
      tent(cx - 4, cy - 4); tent(cx + 2, cy - 4, 'ow_tent_tan')
      low(cx - 2, cy + 1, 'ow_prop_bedroll_0'); low(cx + 2, cy + 1, 'ow_prop_bedroll_1')
      low(cx + 4, cy - 1, 'ow_prop_barrel_1'); low(cx + 4, cy, 'ow_prop_crate_2'); low(cx - 4, cy, 'ow_prop_sack_1')
      low(cx - 1, cy + 3, 'ow_prop_log')
    } else if (look === 'graves') {
      for (const gy of [cy - 3, cy - 1, cy + 2]) for (const gx of [cx - 4, cx - 2, cx + 2, cx + 4]) if (rng() < 0.75) low(gx, gy, pick(GRAVES))
      put(cx - 5, cy + 1, DEAD[0]); put(cx + 5, cy - 2, DEAD[1])
      low(cx, cy - 4, 'ow_prop_cross_1')
      scatter(cx, cy, 1, 5, 4, ['ow_deco_skull'])
    } else if (look === 'den') {
      // a horseshoe of rock open to the south, the pack in its lap
      const rock = (dx, dy) => { if (c.sandy) put(cx + dx, cy + dy, pick(c.rocks)); else { t.setMass(cx + dx, cy + dy); hold(cx + dx, cy + dy) } }
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
      put(cx - 5, cy - 1, DEAD[0]); put(cx + 1, cy + 4, DEAD[1]); put(cx + 5, cy - 3, DEAD[0])
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
    put(x + 2, y - 2, pick(DEAD))
  }
  function stones(x, y) {
    const set = c.sandy ? SAND_STONES : OLD_STONES
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 - Math.PI / 2
      put(x + Math.round(Math.cos(a) * 2), y + Math.round(Math.sin(a) * 2), pick(set))
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rng() < 0.6) t.setGround(x + dx, y + dy, c.sandy ? pick(SAND_FLOOR) : 'ow_cobble_green')
    flat(x + 1, y + 1, 'ow_deco_skull')
  }

  // ---- a cave mouth in an outcrop -------------------------------------------------
  // The arch is the pair (x, y), (x + 1, y); rock is heaped behind and beside it.
  function cave(x, y) {
    // a hill of mountain rock, on a patch of its stony ground; on sand,
    // where the mountain art has no edge to sit on, a heap of boulders
    const hill = !c.sandy
    const rock = (dx, dy) => { if (hill) { t.setMass(x + dx, y + dy); hold(x + dx, y + dy) } else put(x + dx, y + dy, pick(c.rocks)) }
    if (hill) for (let dy = -4; dy <= 1; dy++) for (let dx = -4; dx <= 5; dx++) if (!((dy === -4 || dy === 1) && (dx === -4 || dx === 5))) t.setFloor(x + dx, y + dy)
    for (let dx = -1 + (rng() < 0.5 ? 1 : 0); dx <= 2 - (rng() < 0.5 ? 1 : 0); dx++) rock(dx, -3)
    for (let dx = -2; dx <= 3; dx++) rock(dx, -2)
    for (let dx = -3; dx <= 4; dx++) rock(dx, -1)
    for (const dx of [-3, -2, -1, 2, 3, 4]) rock(dx, 0)
    walkRound(x - 4, y - 4, x + 5, y + 1)
    for (const dx of [0, 1]) { t.clear(x + dx, y); t.clear(x + dx, y + 1); hold(x + dx, y); hold(x + dx, y + 1) }
    t.setProp(x, y, 'ow_cave_arch_0', { walkable: true }); t.setProp(x + 1, y, 'ow_cave_arch_1', { walkable: true })
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
    // nothing solid or wet goes on a way: it is the one sure road to each wallow
    const ways = new Set(g.ways.map(c => `${c.x},${c.y}`))
    const offWay = (x, y) => !ways.has(`${x},${y}`)
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
      // fish racks standing empty since the pier was given up
      put(cx - 11, cy - 2, 'ow_prop_fishrack_l'); put(cx - 10, cy - 2, 'ow_prop_fishrack_r')
      put(cx - 11, cy - 1, 'ow_prop_fishrack_l'); put(cx - 10, cy - 1, 'ow_prop_fishrack_r')
    }
    if (tale === 'fold') {
      // the fold the lambs go missing from, south-east of the square; the
      // ground east and south of it is opened so a road that ran there goes round
      fence(cx + 7, cy + 8, cx + 11, cy + 11, { x: cx + 8, y: cy + 8 })
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

  const tales = { elk: elkWood, tar: causeway, kivihiisi: oven, nakki: bellLake, fold: ridge, flame: knoll, lalli: lalliTree }
  return { house, village, hut, ruin, camp, lair, nest, stones, cave, statue, lilies, flowers, tales, villageTrouble }
}
