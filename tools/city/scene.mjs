// Street scenes for the contact sheet: the kit laid as the builder would,
// beside the Wilds' own village houses. Each scene is a grid of cell stacks
// [ground, overlay...] like the game's cells.
import { WALL, TOWER, GATE, HARBOUR, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS } from '../../renderer/wilds/city/kit.js'

class Grid {
  constructor(w, h, ground) { this.w = w; this.h = h; this.c = Array.from({ length: h }, () => Array.from({ length: w }, () => [ground])) }
  ground(x, y, n) { if (this.c[y]?.[x]) this.c[y][x][0] = n }
  over(x, y, n) { if (this.c[y]?.[x]) this.c[y][x] = [this.c[y][x][0], n] }
  stack(x, y, ...n) { if (this.c[y]?.[x]) this.c[y][x] = [this.c[y][x][0], ...n] }
  rows(x0, y0, rows) { rows.forEach((r, j) => r.forEach((n, i) => { if (n) this.over(x0 + i, y0 + j, n) })) }
  fill(x0, y0, x1, y1, f) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.ground(x, y, f(x, y)) }
}
const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0
const cobble = (x, y) => PAVE.cobble[hash(x, y) % 4]
const tower = (t, extra = 0) => [...t.cap, ...Array(extra).fill(t.body), t.base]

// A ring of wall with towers and gates, laid as kit.js says: tops by mask on
// the wall line, faces under every top whose south side is open.
function fortress() {
  const g = new Grid(30, 19, 'ow_grass_0')
  const wall = new Set(), key = (x, y) => `${x},${y}`
  const X0 = 3, X1 = 26, Y0 = 3, Y1 = 15
  for (let x = X0; x <= X1; x++) { wall.add(key(x, Y0)); wall.add(key(x, Y1)) }
  for (let y = Y0; y <= Y1; y++) { wall.add(key(X0, y)); wall.add(key(X1, y)) }
  for (let y = Y0; y <= 9; y++) wall.add(key(18, y))            // an inner wall: a T on the north wall
  g.fill(X0 + 1, Y0 + 1, X1 - 1, Y1 - 1, (x, y) => (x === 11 || y === 8) ? cobble(x, y) : PAVE.flag[hash(x, y) % 2])
  const gateX = 11                                             // north gate, three wide at 10..12
  for (let d = -1; d <= 1; d++) wall.delete(key(gateX + d, Y0))
  const sideY = 9                                              // west gate, three down at 8..10
  for (let d = -1; d <= 1; d++) wall.delete(key(X0, sideY + d))
  const isW = (x, y) => wall.has(key(x, y))
  const solid = new Set()
  // towers 3x3 centred on the line: cap row above it, base row below
  const towers = [[X0, Y0, 'round3'], [X1, Y0, 'round3'], [X0, Y1, 'round3'], [X1, Y1, 'round3'], [gateX - 3, Y0, 'square3'], [gateX + 3, Y0, 'square3'],
    [X0, sideY - 3, 'square3'], [X0, sideY + 3, 'square3'], [18, Y1, 'round3']]
  for (const [tx, ty] of towers) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) solid.add(key(tx + dx, ty + dy))
  for (const k of wall) {
    if (solid.has(k)) continue
    const [x, y] = k.split(',').map(Number)
    // towers count as wall (plan.js wallCells holds their footprints)
    const w = (x2, y2) => isW(x2, y2) || solid.has(key(x2, y2))
    const m = (w(x, y - 1) ? 1 : 0) | (w(x + 1, y) ? 2 : 0) | (w(x, y + 1) ? 4 : 0) | (w(x - 1, y) ? 8 : 0)
    g.over(x, y, WALL.top[m])
  }
  // faces: one row under each top with no wall south of it
  for (const k of wall) {
    if (solid.has(k)) continue
    const [x, y] = k.split(',').map(Number)
    if (isW(x, y + 1) || solid.has(key(x, y + 1))) continue
    const face = x2 => isW(x2, y) && !isW(x2, y + 1) && !solid.has(key(x2, y)) && !solid.has(key(x2, y + 1))
    const l = !face(x - 1), r = !face(x + 1)
    const set = WALL.lower
    g.over(x, y + 1, l && r ? set.lr : l ? set.l : r ? set.r : (hash(x, y) % 5 === 0 ? set.m2 : set.m))
  }
  for (const [tx, ty, kind] of towers) g.rows(tx - 1, ty - 1, tower(TOWER[kind]))
  g.rows(gateX - 1, Y0, GATE.arch2)
  GATE.side.forEach((n, i) => g.over(X0, sideY - 1 + i, n))
  for (let d = -1; d <= 1; d++) { g.ground(gateX + d, Y0, cobble(gateX + d, Y0)); g.ground(gateX + d, Y0 + 1, cobble(gateX + d, Y0 + 1)); g.ground(X0, sideY + d, cobble(X0, sideY + d)) }
  for (let y = 0; y < Y0; y++) for (let d = -1; d <= 1; d++) g.ground(gateX + d, y, 'ow_dirt_0')
  for (let x = 0; x < X0; x++) for (let d = -1; d <= 1; d++) g.ground(x, sideY + d, 'ow_dirt_1')
  return g
}

// A townhouse as kit.js says to lay one: roof row, eave row, storeys, the
// ground floor last; door at column `d`.
function townhouse(g, x0, yGround, { w, storeys, wall, roof, d = 1, shop = null, chim = 1, flowers = false, sign = null }) {
  const W = HOUSE_FRONT.walls[wall], R = HOUSE_FRONT.roofs[roof]
  const top = yGround - storeys - 1
  for (let i = 0; i < w; i++) {
    const end = (l, m, r) => i === 0 ? l : i === w - 1 ? r : m
    g.over(x0 + i, top, end(R.l, i === chim ? R.chim : R.m, R.r))
    g.over(x0 + i, top + 1, end(R.el, i === d ? R.gable : R.em, R.er))
    for (let s = 1; s < storeys; s++) g.over(x0 + i, top + 1 + s, end(W.l, (flowers && i % 2) ? W.win2 : W.win, W.r))
    if (shop) g.over(x0 + i, yGround, i === 0 ? HOUSE_FRONT.shop[shop].l : i === w - 1 ? HOUSE_FRONT.shop[shop].r : i === d ? HOUSE_FRONT.shop[shop].door : HOUSE_FRONT.shop[shop].win)
    else g.over(x0 + i, yGround, end(W.l, i === d ? W.door : W.win, W.r))
  }
  // the sign hangs on the storey over the shop, by the door
  if (sign) { const c = g.c[yGround - 1][x0 + d + 1]; g.stack(x0 + d + 1, yGround - 1, c[1], HOUSE_FRONT.signs[sign]) }
}
function street() {
  const g = new Grid(31, 10, 'ow_grass_0')
  const yG = 5
  g.fill(0, yG + 1, 30, 9, (x, y) => y === yG + 1 ? PAVE.kerb.n : cobble(x, y))
  g.fill(0, 0, 26, yG, () => 'ow_city_pave_flag_0')
  townhouse(g, 0, yG, { w: 3, storeys: 3, wall: 'ochre', roof: 'red' })
  townhouse(g, 3, yG, { w: 4, storeys: 2, wall: 'white', roof: 'blue', shop: 'red', d: 2, chim: 2, sign: 'baker' })
  townhouse(g, 7, yG, { w: 3, storeys: 3, wall: 'timber', roof: 'brown', chim: 2 })
  townhouse(g, 10, yG, { w: 5, storeys: 2, wall: 'rose', roof: 'dark', d: 2, flowers: true, chim: 3 })
  townhouse(g, 15, yG, { w: 3, storeys: 2, wall: 'stone', roof: 'red' })
  townhouse(g, 18, yG, { w: 4, storeys: 3, wall: 'green', roof: 'red', shop: 'green', d: 1, sign: 'inn' })
  townhouse(g, 22, yG, { w: 3, storeys: 2, wall: 'timber', roof: 'red', flowers: true })
  // a Wilds village house beside them, on its own grass
  g.fill(26, 0, 30, yG, () => 'ow_grass_0')
  g.rows(27, yG - 2, [['ow_roof_red_l', 'ow_roof_red_chim', 'ow_roof_red_r'], ['ow_roof_red_el', 'ow_roof_gable_red', 'ow_roof_red_er'], ['ow_house_wall_brown_l', 'ow_house_door', 'ow_house_wall_brown_r']])
  // lamps, a bench, planters on the street
  for (const x of [2, 9, 16, 23]) g.over(x, yG + 1, PROPS.lamp)
  g.over(12, yG + 1, PROPS.bench); g.over(5, yG + 1, PROPS.planter[0]); g.over(20, yG + 1, PROPS.planter[1])
  g.over(14, 8, PROPS.turnip); g.ground(18, 8, PAVE.drain)
  g.rows(6, 7, [PROPS.cart])
  return g
}
function church() {
  const g = new Grid(20, 10, 'ow_grass_0')
  const x0 = 4, ridge = 2, yLow = 7, n = 11
  CHURCH.tower.spire.forEach((r, j) => r.forEach((nm, i) => g.over(i + 1, j, nm)))
  ;[CHURCH.tower.belfry, CHURCH.tower.body, CHURCH.tower.rose, CHURCH.tower.base].forEach((r, j) => r.forEach((nm, i) => g.over(i + 1, 3 + j, nm)))
  const roofRows = [CHURCH.roof.ridge, CHURCH.roof.slope, CHURCH.roof.slope, CHURCH.roof.eave]
  roofRows.forEach((r, j) => { for (let i = 0; i < n; i++) g.over(x0 + i, ridge + j, i === 0 ? r[0] : i === n - 1 ? r[2] : r[1]) })
  for (let i = 0; i < n; i++) {
    g.over(x0 + i, yLow - 1, i === 0 ? CHURCH.upper.l : i === n - 1 ? CHURCH.upper.r : [2, 5, 8].includes(i) ? CHURCH.upper.win : CHURCH.upper.m)
    g.over(x0 + i, yLow, i === 0 ? CHURCH.lower.l : i === n - 1 ? CHURCH.lower.r : [2, 5, 8].includes(i) ? CHURCH.lower.win : CHURCH.lower.m)
  }
  g.rows(x0 + 3, yLow - 1, [CHURCH.upper.doorTop, CHURCH.lower.door])
  const ap = CHURCH.apse; [ap.ridge, ap.slope, ap.eave, ap.upper, ap.lower].forEach((r, j) => g.rows(x0 + n, yLow - 4 + j, [r]))
  g.fill(x0 + 3, yLow + 1, x0 + 4, 9, () => PAVE.flag[0])
  for (const [x, y, k] of [[12, 9, 'ow_prop_grave_0'], [14, 9, 'ow_prop_cross_0'], [16, 9, 'ow_prop_grave_2'], [1, 8, 'ow_tree_small']]) g.over(x, y, k)
  return g
}
function harbour() {
  const g = new Grid(26, 14, 'ow_water_0')
  // the quay along the top, moles down the sides, the mouth with its towers and chain at the foot
  g.fill(0, 0, 25, 1, (x, y) => y === 0 ? PAVE.flag[x % 2] : HARBOUR.quay.s)
  for (let x = 0; x < 26; x++) g.over(x, 2, HARBOUR.face)
  for (let y = 1; y <= 10; y++) { g.ground(3, y, y === 1 ? HARBOUR.quay.s : HARBOUR.quay.e); g.ground(22, y, y === 1 ? HARBOUR.quay.s : HARBOUR.quay.w); for (const x of [0, 1, 2]) g.ground(x, y, HARBOUR.mole[(x + y) % 2]); for (const x of [23, 24, 25]) g.ground(x, y, HARBOUR.mole[(x + y) % 2]) }
  g.ground(3, 1, HARBOUR.quay.s); g.ground(22, 1, HARBOUR.quay.s)
  g.c[2][3] = [HARBOUR.quay.e]; g.c[2][22] = [HARBOUR.quay.w]
  g.rows(1, 10, [...HARBOUR.tower.head, HARBOUR.tower.base])
  g.rows(22, 10, [...HARBOUR.tower.head, HARBOUR.tower.base])
  for (let x = 4; x <= 21; x++) g.over(x, 12, x === 4 ? HARBOUR.chain.l : x === 21 ? HARBOUR.chain.r : x % 5 === 2 ? HARBOUR.chain.float : HARBOUR.chain.m)
  for (const x of [5, 12, 19]) g.over(x, 1, HARBOUR.bollard)
  // a pier and boats
  for (let y = 3; y <= 7; y++) g.over(12, y, 'ow_pier_deck_v_10')
  g.over(12, 8, 'ow_pier_deck_v_14')
  g.over(10, 5, 'ow_boat'); g.over(14, 4, 'ow_boat'); g.over(7, 3, 'ow_boat')
  g.rows(15, 0, [[PROPS.stall.blue[0]], [PROPS.stall.blue[1]]]); g.over(17, 0, 'ow_prop_fishrack_l'); g.over(18, 0, 'ow_prop_fishrack_r'); g.over(8, 0, 'ow_prop_barrel_0')
  return g
}
function square() {
  const g = new Grid(30, 15, 'ow_grass_0')
  g.fill(0, 6, 21, 14, (x, y) => PAVE.square[y % 2][x % 2])
  // the castle's keep and its corner towers, banners on them
  g.fill(0, 0, 21, 5, () => 'ow_grass_0')
  const kx = 3, kw = 12
  const roofRows = [CASTLE.roof.ridge, CASTLE.roof.slope, CASTLE.roof.eave]
  roofRows.forEach((r, j) => { for (let i = 0; i < kw; i++) g.over(kx + i, j, i === 0 ? r[0] : i === kw - 1 ? r[2] : r[1]) })
  for (let i = 0; i < kw; i++) {
    g.over(kx + i, 3, i === 0 ? CASTLE.upper.l : i === kw - 1 ? CASTLE.upper.r : i % 3 === 1 ? CASTLE.upper.win : CASTLE.upper.m)
    g.over(kx + i, 4, i === 0 ? CASTLE.lower.l : i === kw - 1 ? CASTLE.lower.r : i % 3 === 1 ? CASTLE.lower.win : CASTLE.lower.m)
  }
  g.rows(kx + 5, 4, [CASTLE.lower.door])
  for (const i of [2, 6, 9]) g.over(kx + i, 1, CASTLE.roof.dormer)
  for (const i of [4, 8]) g.over(kx + i, 0, CASTLE.roof.chim)
  g.stack(kx + 3, 3, CASTLE.upper.m, CASTLE.banner[0]); g.stack(kx + 8, 3, CASTLE.upper.m, CASTLE.banner[1])
  g.rows(0, 1, tower(TOWER.round3, 1)); g.rows(kx + kw, 1, tower(TOWER.round3, 1))
  g.stack(1, 1, TOWER.round3.cap[0][1], CASTLE.pennant[0]); g.stack(kx + kw + 1, 1, TOWER.round3.cap[0][1], CASTLE.pennant[1])
  g.fill(kx + 5, 5, kx + 6, 5, (x, y) => cobble(x, y))
  // the square: the dry fountain, stalls round it, the crier, the stocks, lamps, benches
  g.over(10, 10, PROPS.fountain.empty)
  g.rows(2, 8, [[PROPS.stall.red[0], null, PROPS.stall.blue[0], null, PROPS.stall.green[0]], [PROPS.stall.red[1], null, PROPS.stall.blue[1], null, PROPS.stall.green[1]]])
  g.over(3, 9, PROPS.produce[0]); g.over(5, 9, PROPS.produce[1]); g.over(7, 9, PROPS.turnips)
  g.stack(13, 9, g.c[9][13][0], PROPS.crier); g.over(16, 11, PROPS.stocks)
  for (const [x, y] of [[1, 7], [9, 7], [19, 7], [1, 13], [19, 13]]) g.over(x, y, PROPS.lamp)
  g.over(12, 13, PROPS.bench); g.over(8, 13, PROPS.bench); g.over(15, 7, PROPS.planter[0]); g.over(4, 13, PROPS.planter[1])
  g.rows(18, 9, [[PROPS.well[0]], [PROPS.well[1]]])
  // the windmill and a washing line off the square
  g.rows(24, 1, PROPS.windmill.base.map((r, y) => r.map((n, x) => [n, PROPS.windmill.sails[1][y][x]]).map(([a]) => a)))
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.stack(24 + x, 1 + y, PROPS.windmill.base[y][x], PROPS.windmill.sails[1][y][x])
  g.over(23, 7, PROPS.washing[0]); g.over(24, 7, PROPS.washing[1])
  PROPS.bed.forEach((r, j) => r.forEach((n, i) => g.over(24 + i, 10 + j, n)))
  return g
}

export function scene() {
  return [
    { title: 'scene: a stretch of wall (tops, one-row faces, towers, north and west gates)', cells: fortress().c, fill: true },
    { title: 'scene: a street of townhouses, a Wilds village house at the east end for comparison', cells: street().c, fill: true },
    { title: 'scene: the church', cells: church().c, fill: true },
    { title: 'scene: the harbour', cells: harbour().c, fill: true },
    { title: 'scene: the castle keep, the square, the windmill', cells: square().c, fill: true },
  ]
}
