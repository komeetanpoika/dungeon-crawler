// Kalevanlinna's tile kit: every tile name the city builder lays, in groups,
// and the sprites drawn over the town (FX).
// Data only; the art is cut by tools/static-overworld/extract-tiles.mjs and
// drawn by tools/city/make-city-tiles.mjs (`--sheet <png>` draws them all).
//
// What a name means to the game (renderer/wilds/piece.js cellOf):
//   ow_city_pave_*   walkable ground: a cell's skin
//   ow_city_*        solid: blocks the way and the sight line
//   ow_prop_city_*   low things: block the way, a sight line passes over
//   ow_deco_city_*   flat things: walked on
// Names without `city` are tiles the Wilds already has, reused.
//
// The view is the game's: from above and to the south. A building is roof
// rows over face rows (like sites.js houses); a wall is its walk seen from
// above (the top) with its face below wherever its south side is open.
//
// Multi-cell pieces are given as rows, top row first, west to east. Unless a
// comment says otherwise every cell of a piece blocks. Pieces have no cells
// to leave out: where a shape does not fill its cells (a tower's cap, the
// spire, the apse's top rows, the windmill and its sails) the tile is
// see-through there, so the ground under it shows.
//
// Overlays: a sign, a banner or a pennant is drawn see-through to hang over
// another tile. Lay the tile behind it as the cell's `deco` and the overlay as
// its `overlay` (render/tiles.js draws deco, then overlay, over the skin).

const rowOf = (base, cols) => cols.map(c => `${base}${c}`)
const grid = (base, rows, cols) => rows.map(r => cols.map(c => `${base}${r}${c}`))

// ---- the curtain wall -----------------------------------------------------
// top[mask]: the wall walk, by which neighbours are wall too: N 1, E 2, S 4,
// W 8 (as interior/walls.js does for room walls). A tower's footprint counts
// as wall (plan.js wallCells holds it); a gate's arch and a face cell do not.
// A run between two towers is mask 10 (east-west) or 5 (north-south).
// Merlons stand along every side with no wall beyond it.
// Under every top cell whose south side is open lies its face, one row
// (lower alone) or two (upper over lower): `l`/`r` end a face run where its
// west/east neighbour is not face, `lr` is a face one cell wide, `m` is the
// run with `m2` and `slit` (an arrow slit) mixed in for variety.
export const WALL = {
  top: Array.from({ length: 16 }, (_, m) => `ow_city_wall_top_${m}`),
  upper: { l: 'ow_city_wall_upper_l', m: 'ow_city_wall_upper_m', r: 'ow_city_wall_upper_r', lr: 'ow_city_wall_upper_lr', m2: 'ow_city_wall_upper_m2', slit: 'ow_city_wall_upper_slit' },
  lower: { l: 'ow_city_wall_lower_l', m: 'ow_city_wall_lower_m', r: 'ow_city_wall_lower_r', lr: 'ow_city_wall_lower_lr', m2: 'ow_city_wall_lower_m2' },
  // a one-cell turret on a wall top (Tiny Town's): a lookout on a long run
  turret: 'ow_city_wall_turret',
}

// ---- towers ---------------------------------------------------------------
// Each tower: `cap` (two rows: the roof, its tip see-through round the
// point), then any number of `body` rows, then `base` (the foot, standing on
// the ground). A 3x3 footprint is cap + base, a 4x4 is cap + body + base; add
// body rows for a taller tower. Centred on the wall line, a 3x3's cap lower
// row is level with the wall walk and its base with a one-row face; beside a
// two-row face use cap + body + base. Round towers wear red cones, square
// ones dark slate hip roofs; the finial of a 3-wide tower stands at x 8 of its
// cap[0][1] (where CASTLE.pennant's pole is).
const tower = (kind, w) => {
  const cols = Array.from({ length: w }, (_, i) => i)
  return { cap: grid(`ow_city_tower_${kind}_c`, [0, 1], cols), body: rowOf(`ow_city_tower_${kind}_b`, cols), base: rowOf(`ow_city_tower_${kind}_f`, cols) }
}
export const TOWER = {
  round3: tower('round3', 3), round4: tower('round4', 4),
  square3: tower('square3', 3), square4: tower('square4', 4),
}

// ---- land gates ---------------------------------------------------------
// A gate in a wall running east-west is three cells wide between two towers
// and as tall as the wall: `arch2` for a wall of top + one face row, `arch3`
// for top + two (rows top first). Its top row stands in the wall-top row,
// merlons along its top edge; every cell is walkable: the opening is
// see-through (the street's paving shows), the vault dark above it.
// A gate in a wall running north-south (the west and east gates) is seen
// from above: `side` is its three cells north to south down the wall line,
// all walkable: the arches at either end as stone bands, between them a
// see-through shadow over the road (lay the road's paving as the skin).
export const GATE = {
  arch2: [rowOf('ow_city_gate_arch2_u', ['l', 'm', 'r']), rowOf('ow_city_gate_arch2_b', ['l', 'm', 'r'])],
  arch3: [rowOf('ow_city_gate_arch3_t', ['l', 'm', 'r']), rowOf('ow_city_gate_arch3_u', ['l', 'm', 'r']), rowOf('ow_city_gate_arch3_b', ['l', 'm', 'r'])],
  side: rowOf('ow_city_gate_side_', ['n', 'm', 's']),
}

// ---- the harbour ----------------------------------------------------------
// tower: the two towers at the harbour mouth, 3x3 like the wall's: `head`
// (two rows: an open battlemented top with a beacon basket), any `body`
// rows, `base` (its foot in the water, a ring for the chain on both sides).
// chain: across the mouth over open water (sight passes), `l` at the west
// tower, `r` at the east one, `m` between with a `float` every few cells.
// quay: walkable paving at the water's edge with the kerb on the side(s)
// named for the water (ne: water north and east, an outer corner); `face` is
// the quay wall seen from the south, laid on the water cell under a quay
// with water to its south (solid, see-through below the water line). mole:
// the stone breakwater's walkable top. bollard: a mooring post (low).
export const HARBOUR = {
  tower: { head: grid('ow_city_harbour_tower_h', [0, 1], [0, 1, 2]), body: rowOf('ow_city_harbour_tower_b', [0, 1, 2]), base: rowOf('ow_city_harbour_tower_f', [0, 1, 2]) },
  chain: { l: 'ow_prop_city_chain_l', m: 'ow_prop_city_chain_m', float: 'ow_prop_city_chain_float', r: 'ow_prop_city_chain_r' },
  quay: { n: 'ow_city_pave_quay_n', e: 'ow_city_pave_quay_e', s: 'ow_city_pave_quay_s', w: 'ow_city_pave_quay_w',
    ne: 'ow_city_pave_quay_ne', nw: 'ow_city_pave_quay_nw', se: 'ow_city_pave_quay_se', sw: 'ow_city_pave_quay_sw' },
  face: 'ow_city_quay_face',
  mole: ['ow_city_pave_mole_0', 'ow_city_pave_mole_1'],
  bollard: 'ow_prop_city_bollard',
}

// ---- the castle -----------------------------------------------------------
// The castle's own wall and towers are WALL and TOWER. Its keep and hall:
//   top     Tiny Town's battlemented roof as a 3x3 nine-slice (rows: north
//           edge, middle, south edge; columns west edge, middle, east edge);
//           the middle row and column repeat to any size
//   roof    a slate hall roof: ridge row, any slope rows, eave row; each
//           l, m, r (ends at west and east, m repeats); `chim` a chimney for
//           a ridge row cell, `dormer` a dormer window for a slope row cell
//   upper, lower  the keep's face rows (two, ashlar): `win` a tall window,
//           `door` the great door, two cells wide (lower row only)
//   gate2, gate3  the castle gate, three wide and as tall as its wall (as
//           GATE.arch2 and arch3): the portcullis let down, for it is shut;
//           solid
//   banner  two frames of a hanging banner, see-through (an overlay on a
//           face or a tower body); pennant: two frames of a flag on a pole,
//           the overlay for a 3-wide tower's cap[0][1]
export const CASTLE = {
  top: [['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'], ['ow_roof_slate2_l', 'ow_roof_slate2_m', 'ow_roof_slate2_r'], ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r']],
  roof: { ridge: rowOf('ow_city_castle_ridge_', ['l', 'm', 'r']), slope: rowOf('ow_city_castle_slope_', ['l', 'm', 'r']), eave: rowOf('ow_city_castle_eave_', ['l', 'm', 'r']),
    chim: 'ow_city_castle_chim', dormer: 'ow_city_castle_dormer' },
  upper: { l: 'ow_city_castle_upper_l', m: 'ow_city_castle_upper_m', r: 'ow_city_castle_upper_r', win: 'ow_city_castle_upper_win' },
  lower: { l: 'ow_city_castle_lower_l', m: 'ow_city_castle_lower_m', r: 'ow_city_castle_lower_r', win: 'ow_city_castle_lower_win', door: ['ow_city_castle_door_l', 'ow_city_castle_door_r'] },
  gate2: [rowOf('ow_city_castle_gate2_u', ['l', 'm', 'r']), rowOf('ow_city_castle_gate2_b', ['l', 'm', 'r'])],
  gate3: [rowOf('ow_city_castle_gate3_t', ['l', 'm', 'r']), rowOf('ow_city_castle_gate3_u', ['l', 'm', 'r']), rowOf('ow_city_castle_gate3_b', ['l', 'm', 'r'])],
  banner: ['ow_city_banner_a', 'ow_city_banner_b'],
  pennant: ['ow_city_pennant_a', 'ow_city_pennant_b'],
}

// ---- the church -----------------------------------------------------------
// Whitewashed stone under a tarred shingle roof, the nave running east-west.
//   roof    ridge row, any slope rows, eave row; l, m, r (m repeats)
//   upper, lower  the nave's south face, two rows: `win` a tall lancet window
//           (the upper and lower halves line up), `door` two cells wide in
//           the lower row under `doorTop`, its pointed arch, in the upper
//   apse    the rounded east end, two columns wide and five rows tall
//           (ridge, slope, eave, upper, lower), laid east of the nave's `r`
//           cells with its lower row beside the nave's lower row; its roof is
//           a half cone lower than the nave's, so its ridge row is see-through
//           (with more nave slope rows nothing more is laid above it)
//   tower   the bell tower at the west end, three wide: `spire` (three rows,
//           the top row see-through round the cross), `belfry` (the bell in
//           its opening), any `body` rows, `rose` (a round window; use it as
//           one of the body rows), `base`
export const CHURCH = {
  roof: { ridge: rowOf('ow_city_church_ridge_', ['l', 'm', 'r']), slope: rowOf('ow_city_church_slope_', ['l', 'm', 'r']), eave: rowOf('ow_city_church_eave_', ['l', 'm', 'r']) },
  upper: { l: 'ow_city_church_upper_l', m: 'ow_city_church_upper_m', r: 'ow_city_church_upper_r', win: 'ow_city_church_upper_win', doorTop: ['ow_city_church_doortop_l', 'ow_city_church_doortop_r'] },
  lower: { l: 'ow_city_church_lower_l', m: 'ow_city_church_lower_m', r: 'ow_city_church_lower_r', win: 'ow_city_church_lower_win', door: ['ow_city_church_door_l', 'ow_city_church_door_r'] },
  apse: { ridge: rowOf('ow_city_church_apse_ridge_', [0, 1]), slope: rowOf('ow_city_church_apse_slope_', [0, 1]), eave: rowOf('ow_city_church_apse_eave_', [0, 1]),
    upper: rowOf('ow_city_church_apse_upper_', [0, 1]), lower: rowOf('ow_city_church_apse_lower_', [0, 1]) },
  tower: {
    spire: grid('ow_city_church_spire_', [0, 1, 2], ['l', 'm', 'r']),
    belfry: rowOf('ow_city_church_belfry_', ['l', 'm', 'r']),
    body: rowOf('ow_city_church_tower_', ['l', 'm', 'r']),
    rose: rowOf('ow_city_church_rose_', ['l', 'm', 'r']),
    base: rowOf('ow_city_church_tbase_', ['l', 'm', 'r']),
  },
}

// ---- townhouses -----------------------------------------------------------
// A townhouse is laid as sites.js lays a house: a roof row (`l`, `m`, `r`
// with `chim` for a chimney), an eave row (`el`, `em`, `er` with `gable`
// over the door), then one wall row per storey, the ground floor last. Wall
// rows: `l`, `r` at the ends, `win`/`win2` (with a flower box) between, `m`
// a blank stretch, `door` in the ground floor. Terraced houses each keep
// their own ends. A shop's ground floor is `shop[awning]`: l, win, door, r.
//   walls   facade by material: timber (frame), white, ochre, rose, green
//           (plaster), stone (Tiny Town's, reused) and wood (reused)
//   roofs   red and blue (Tiny Town's), brown (shingle) and dark (slate)
//   signs   hanging signs on an iron bracket from the cell's west edge,
//           see-through overlays: hang one on the wall cell of the storey over
//           a shop front, at or beside the door's column (over the shop front
//           itself it would hide the awning)
const facade = mat => ({ l: `ow_city_house_${mat}_l`, m: `ow_city_house_${mat}_m`, r: `ow_city_house_${mat}_r`, win: `ow_city_house_${mat}_win`, win2: `ow_city_house_${mat}_win2`, door: `ow_city_house_${mat}_door` })
const roof = c => ({ l: `ow_city_roof_${c}_l`, m: `ow_city_roof_${c}_m`, r: `ow_city_roof_${c}_r`, chim: `ow_city_roof_${c}_chim`, el: `ow_city_roof_${c}_el`, em: `ow_city_roof_${c}_em`, er: `ow_city_roof_${c}_er`, gable: `ow_city_roof_${c}_gable` })
export const HOUSE_FRONT = {
  walls: {
    timber: facade('timber'), white: facade('white'), ochre: facade('ochre'), rose: facade('rose'), green: facade('green'),
    stone: { l: 'ow_house_wall_stone_l', m: 'ow_house_wall_stone', r: 'ow_house_wall_stone_r', win: 'ow_house_win_stone', win2: 'ow_city_house_stone_win2', door: 'ow_house_door_2' },
    wood: { l: 'ow_house_wall_brown_l', m: 'ow_house_wall_brown', r: 'ow_house_wall_brown_r', win: 'ow_house_win_brown', win2: 'ow_city_house_wood_win2', door: 'ow_house_door' },
  },
  shop: {
    red: { l: 'ow_city_shop_red_l', win: 'ow_city_shop_red_win', door: 'ow_city_shop_red_door', r: 'ow_city_shop_red_r' },
    green: { l: 'ow_city_shop_green_l', win: 'ow_city_shop_green_win', door: 'ow_city_shop_green_door', r: 'ow_city_shop_green_r' },
  },
  roofs: {
    red: { l: 'ow_roof_red_l', m: 'ow_roof_red_m', r: 'ow_roof_red_r', chim: 'ow_roof_red_chim', el: 'ow_roof_red_el', em: 'ow_roof_red_em', er: 'ow_roof_red_er', gable: 'ow_roof_gable_red' },
    blue: { l: 'ow_roof_blue_l', m: 'ow_roof_blue_m', r: 'ow_roof_blue_r', chim: 'ow_roof_blue_chim', el: 'ow_roof_blue_el', em: 'ow_roof_blue_em', er: 'ow_roof_blue_er', gable: 'ow_roof_gable_gray' },
    brown: roof('brown'), dark: roof('dark'),
  },
  signs: {
    baker: 'ow_city_sign_baker', butcher: 'ow_city_sign_butcher', cloth: 'ow_city_sign_cloth', cooper: 'ow_city_sign_cooper',
    apothecary: 'ow_city_sign_apothecary', inn: 'ow_city_sign_inn', smith: 'ow_city_sign_smith',
  },
}

// ---- streets and squares --------------------------------------------------
//   square  the square's flagstone pattern, a 2x2 repeat: square[y % 2][x % 2]
//   cobble  main streets, four variants to pick by a hash of the cell
//   kerb    cobble with a kerb stone along the named side (the street's edge)
//   flag    plain flags (the street along the wall, the quay's lanes)
//   alley   packed earth; gutter: the same with a stone gutter down it (h
//           runs east-west, v north-south); drain: a grate in the cobbles
export const PAVE = {
  square: [['ow_city_pave_square_00', 'ow_city_pave_square_10'], ['ow_city_pave_square_01', 'ow_city_pave_square_11']],
  cobble: ['ow_city_pave_cobble_0', 'ow_city_pave_cobble_1', 'ow_city_pave_cobble_2', 'ow_city_pave_cobble_3'],
  kerb: { n: 'ow_city_pave_kerb_n', e: 'ow_city_pave_kerb_e', s: 'ow_city_pave_kerb_s', w: 'ow_city_pave_kerb_w' },
  flag: ['ow_city_pave_flag_0', 'ow_city_pave_flag_1'],
  alley: ['ow_city_pave_alley_0', 'ow_city_pave_alley_1'],
  gutter: { h: 'ow_city_pave_gutter_h', v: 'ow_city_pave_gutter_v' },
  drain: 'ow_city_pave_drain',
}

// ---- props ----------------------------------------------------------------
//   lamp / lampLit   a street lamp, unlit and lit (swap at dusk and dawn);
//            the lantern hangs at about (10, 5) px in its cell
//   bench    facing south; benchSide: seen end-on (for a bench along a
//            north-south edge)
//   washing  a washing line, two cells: west post, east post, the wash hung
//            on it; line: the same line bare (the wash taken in)
//   stall    market stalls: [top, front] per awning colour (two cells, the
//            top north of the front; Tiny Town's red and green, a blue)
//   crier    the crier's box, flat (walked on: the crier stands on it)
//   cart     a cart and horse, two cells west to east: horse, cart
//   windmill a post mill, 3x3: `base` rows; `sails[f]` four frames of the
//            turning sails over the same 3x3 (see-through round the arms),
//            a sixteenth of a turn apart, so 0..3 loops; the hub is at
//            (23.5, 21) px of the 3x3
//   turnip   one turnip lying in the street (flat); turnips: a crate of them
//   bed      a flower bed, a 3x3 nine-slice (the Count's garden), low
//   produce  crates of greens, apples and roots for the stalls
//   netRack  a rack of nets or fish hung to dry, two cells west to east
export const PROPS = {
  lamp: 'ow_prop_city_lamp', lampLit: 'ow_prop_city_lamp_lit',
  bench: 'ow_prop_city_bench', benchSide: 'ow_prop_city_bench_side',
  planter: ['ow_prop_city_planter_0', 'ow_prop_city_planter_1'],
  washing: ['ow_prop_city_washing_l', 'ow_prop_city_washing_r'],
  line: ['ow_prop_city_line_l', 'ow_prop_city_line_r'],
  stall: { red: ['ow_stall_top', 'ow_stall_front'], green: ['ow_stall_top_green', 'ow_stall_front_green'], blue: ['ow_city_stall_top_blue', 'ow_city_stall_front_blue'] },
  stocks: 'ow_prop_city_stocks',
  crier: 'ow_deco_city_crier_box',
  cart: ['ow_prop_city_cart_horse', 'ow_prop_city_cart'],
  windmill: {
    base: grid('ow_city_windmill_', ['t', 'm', 'b'], ['l', 'c', 'r']),
    sails: [0, 1, 2, 3].map(f => ['t', 'm', 'b'].map(r => ['l', 'c', 'r'].map(c => `ow_city_mill_sails_${r}${c}_${f}`))),
  },
  barrels: ['ow_prop_barrel_0', 'ow_prop_barrel_1'],
  crates: ['ow_prop_crate_0', 'ow_prop_crate_1', 'ow_prop_crate_2'],
  well: ['ow_well_top', 'ow_well'],
  fountain: { empty: 'ow_fountain_basin_empty', full: 'ow_fountain_basin_full' },
  turnip: 'ow_deco_city_turnip', turnips: 'ow_prop_city_turnips',
  bed: grid('ow_prop_city_bed_', ['t', 'm', 'b'], ['l', 'c', 'r']),
  produce: ['ow_prop_city_produce_0', 'ow_prop_city_produce_1', 'ow_prop_city_produce_2'],
  netRack: ['ow_prop_fishrack_l', 'ow_prop_fishrack_r'],
  anvil: 'ow_prop_city_anvil', forge: 'ow_city_forge',
}

// ---- the town's small life ---------------------------------------------------
// Sprites render/city-fx.js draws over the town a frame at a time, never laid
// in a cell (fx_city_*):
//   smoke    a chimney's smoke: three puffs, small to large as it rises
//   steam    the smith's quench: two puffs
//   spark    a spark off the anvil
//   splat    a turnip burst on the ground
//   note     the busker's tune: one note, two notes
//   handbell the crier's bell
//   pigeonFly, gullFly  a bird in the air side on, wings up then down (the
//            perched birds are the townsfolk generator's tf_pigeon_a/_b and
//            tf_gull_a/_b: wings folded, wings raised)
//   cartN, cartS  the horse and cart going north and going south, two cells
//            top to bottom (horse over cart going north, cart over horse
//            going south); going east or west it is PROPS.cart (flipped east)
export const FX = {
  smoke: ['fx_city_smoke_0', 'fx_city_smoke_1', 'fx_city_smoke_2'],
  steam: ['fx_city_steam_0', 'fx_city_steam_1'],
  spark: 'fx_city_spark',
  splat: 'fx_city_splat',
  note: ['fx_city_note_0', 'fx_city_note_1'],
  handbell: 'fx_city_handbell',
  pigeonFly: ['fx_city_pigeon_fly_0', 'fx_city_pigeon_fly_1'],
  gullFly: ['fx_city_gull_fly_0', 'fx_city_gull_fly_1'],
  cartN: ['fx_city_cart_n_0', 'fx_city_cart_n_1'],
  cartS: ['fx_city_cart_s_0', 'fx_city_cart_s_1'],
}

const flat = v => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : Object.values(v).flatMap(flat)
export const CITY_SKINS = [...new Set([WALL, TOWER, GATE, HARBOUR, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS, FX].flatMap(flat))]
