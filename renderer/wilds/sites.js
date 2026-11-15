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
])]

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
  function house(dx, dy, tier, { w = 3, roof = rng() < 0.5 ? 'red' : 'blue', wall = rng() < 0.5 ? 'stone' : 'wood', storeys = 1 } = {}) {
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
    c.door(dx, dy, tier)
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
  function village(cx, cy) {
    cobble(cx, cy, 14)
    put(cx, cy - 1, 'ow_well_top'); put(cx, cy, 'ow_well')
    put(cx - 2, cy + 1, 'ow_sign')
    const big = rng() < 0.5
    house(cx - 7, cy - 3, 'safe', { w: 4 + (rng() < 0.5 ? 1 : 0) })
    house(cx + 6, cy - 4, 'safe', { w: 5, storeys: big ? 2 : 1 })
    house(cx - 7, cy + 5, 'safe', { w: 3 })
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

  return { house, village, hut, ruin, camp, lair, nest, stones, cave, statue, lilies, flowers }
}
