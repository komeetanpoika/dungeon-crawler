// The generated blocks of Kalevanlinna laid as houses: every lot from
// cutBlocks a townhouse, shop, workshop or cottage facing its street, the
// alleys between them, the yards and gardens behind. Pure in the seed.
//
// A row of lots on one street line (terraced) is built as one: it shares a
// roof colour, and its plastered fronts take the plaster colours in turn so
// no two neighbours match. A lot deeper than its house keeps a back yard.
//
// The view is from above and to the south, so a house is seen as kit.js
// draws it: roof over front. A lot whose front is on a street to its south
// shows that front with its door; one whose front faces north shows its
// back to the viewer and its roof to the street, the door let into the
// roof's edge; one whose front faces east or west is seen from the side,
// its ground floor along the lot's south edge and its door at the street end.
import { cutBlocks } from './blocks.js'
import { PLAN, districtAt, streetCells } from './plan.js'
import { mulberry32, hashInt } from '../rand.js'
import { PAVE, PROPS } from './kit.js'
import { TAG, lay, pave, alley, flag, house } from './stamps.js'

const PLASTER = ['white', 'ochre', 'rose', 'green']
const KIND = { house: 'home', cottage: 'home', shop: 'shop', workshop: 'workshop' }
const FLOWERS = ['ow_deco_flower_0', 'ow_deco_flower_1', 'ow_deco_flower_2', 'ow_deco_flower_3']
const GRASS = (x, y) => ['ow_grass_0', 'ow_grass_0', 'ow_grass_1'][hashInt(0, x, y, 7) % 3]
const rect = (r, fn) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) fn(x, y) }

// Lots in rows: one front, one street line, touching along it.
function rowsOf(lots) {
  const groups = new Map()
  for (const l of lots) {
    const line = l.front === 'S' ? l.y1 : l.front === 'N' ? l.y0 : l.front === 'E' ? l.x1 : l.x0
    const k = `${l.front}${line}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(l)
  }
  const rows = []
  for (const list of groups.values()) {
    const horiz = list[0].front === 'S' || list[0].front === 'N'
    list.sort((a, b) => horiz ? a.x0 - b.x0 : a.y0 - b.y0)
    let row = [list[0]]
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i]
      if ((horiz ? b.x0 - a.x1 : b.y0 - a.y1) === 1) row.push(b)
      else { rows.push(row); row = [b] }
    }
    rows.push(row)
  }
  return rows
}

// How each lot of a row looks. A row is built in terraces of three to five
// houses, each terrace under one roof colour (never its neighbour's), and
// its plastered fronts take the plaster colours in turn so no two
// neighbours match.
const ROOFS = ['red', 'blue', 'dark', 'brown']
function lookOfRows(lots, seed) {
  const look = new Map()
  for (const row of rowsOf(lots)) {
    const h = hashInt(seed, row[0].x0, row[0].y0, 77)
    let prevWall = null, turn = h % PLASTER.length, prevRoof = null, left = 0, roof = null, k = 0
    for (const l of row) {
      if (left === 0) {
        left = 3 + hashInt(seed, l.x0, l.y0, 78) % 3
        roof = l.wall === 'wood' && hashInt(seed, l.x0, l.y0, 79) % 3 === 0 ? 'brown' : { red: 'red', blue: 'blue', slate: 'dark' }[l.roof]
        if (roof === prevRoof) roof = ROOFS[(ROOFS.indexOf(roof) + 1 + hashInt(seed, l.x0, l.y0, 80) % 3) % 4]
        prevRoof = roof
      }
      left--; k++
      let wall
      if (l.kind === 'cottage') wall = 'wood'
      else if (l.wall === 'stone') wall = 'stone'
      else if (l.wall === 'wood') wall = l.kind === 'workshop' ? 'wood' : 'timber'
      else { wall = PLASTER[turn++ % PLASTER.length]; if (wall === prevWall) wall = PLASTER[turn++ % PLASTER.length] }
      look.set(l.id, { wall, roof: l.kind === 'cottage' ? (roof === 'red' || roof === 'brown' ? 'red' : 'blue') : roof })
      prevWall = wall
    }
  }
  return look
}

export function layBlocks(G, rec, seed) {
  const { lots, alleys, yards, gardens } = cutBlocks(seed)
  const rng = mulberry32(hashInt(seed, 0, 0, 9301))
  // alleys: packed earth, a stone gutter down the narrow ones
  for (const a of alleys) {
    const [[ax, ay], [bx, by]] = a.pts
    const horiz = ay === by
    const r = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx) + (horiz ? 0 : a.w - 1), y1: Math.max(ay, by) + (horiz ? a.w - 1 : 0) }
    rect(r, (x, y) => pave(G, x, y, a.w === 1 ? PAVE.gutter[horiz ? 'h' : 'v'] : alley(x, y)))
  }
  const looks = lookOfRows(lots, seed)
  for (const l of lots) layLot(G, rec, l, looks.get(l.id), rng)
  for (const y of yards) layYard(G, y, districtAt((y.x0 + y.x1) >> 1, (y.y0 + y.y1) >> 1) ?? 'market', rng)
  rec.yards.push(...yards.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })))   // where the town keeps its hens and goats
  for (const g of gardens) layGarden(G, g, rng)
  // the slivers no lot or yard took stay paved by the streets, and go to grass beside a garden
  const taken = new Uint8Array(160 * 160)
  for (const r of [...lots, ...yards, ...gardens]) rect(r, (x, y) => { taken[y * 160 + x] = 1 })
  for (const a of alleys) { const [[ax, ay], [bx, by]] = a.pts; rect({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx) + (ay === by ? 0 : a.w - 1), y1: Math.max(ay, by) + (ay === by ? a.w - 1 : 0) }, (x, y) => { taken[y * 160 + x] = 1 }) }
  const streets = streetCells(), sq = PLAN.places.square
  const street = (x, y) => streets.has(y * 160 + x) || (x >= sq.x0 && x <= sq.x1 && y >= sq.y0 && y <= sq.y1)
  const sliver = (x, y) => !taken[y * 160 + x] && !street(x, y) && districtAt(x, y) && G.walkable(x, y) && !G.prop(x, y) && G.ground(x, y)?.startsWith('ow_city_pave_flag')
  const grassy = (x, y) => G.ground(x, y)?.startsWith('ow_grass')
  const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let slivers = []
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) if (sliver(x, y) && !n4.some(([dx, dy]) => street(x + dx, y + dy))) slivers.push([x, y])
  for (let pass = 0; pass < 3 && slivers.length; pass++) slivers = slivers.filter(([x, y]) => {
    if (!n4.some(([dx, dy]) => grassy(x + dx, y + dy))) return true
    G.setGround(x, y, GRASS(x, y))
    return false
  })
}

function layLot(G, rec, l, { wall, roof }, rng) {
  const horiz = l.front === 'S' || l.front === 'N'
  const width = l.x1 - l.x0 + 1, depth = horiz ? l.y1 - l.y0 + 1 : width
  const frontage = horiz ? width : l.y1 - l.y0 + 1
  const most = Math.min(3, (horiz ? depth : frontage) - 2)
  let storeys = l.kind === 'cottage' ? 1 : Math.max(1, Math.min(l.storeys, most))
  if (l.kind === 'shop') storeys = Math.max(Math.min(2, most), storeys)
  const inner = x => Math.max(l.x0 + 1, Math.min(l.x1 - 1, x))
  let top = l.y1 - 1 - storeys, view = 'front', door
  if (l.front === 'S') door = { x: inner(l.door.x), y: l.y1 }
  else if (l.front === 'N') { top = l.y0; view = 'back'; door = { x: inner(l.door.x), y: l.y0 } }
  else door = { x: l.front === 'E' ? l.x1 : l.x0, y: l.y1 }
  // the house's rows, and the back yard if the lot is deeper
  const h0 = top, h1 = top + 1 + storeys
  rect(l, (x, y) => { if (y < h0 || y > h1) pave(G, x, y, l.district === 'crafts' ? flag(x, y) : GRASS(x, y)) })
  const chimCols = []
  for (let x = l.x0 + 1; x <= l.x1 - 1; x++) if (!(view === 'back' && x === door.x)) chimCols.push(x)
  const chim = chimCols.length && rng() < 0.85 ? chimCols[Math.floor(rng() * chimCols.length)] : null
  house(G, rec, {
    x0: l.x0, x1: l.x1, top, storeys, view, wall, roof, door, chim,
    shop: l.kind === 'shop' ? (hashInt(0, l.x0, l.y0, 5) % 2 ? 'red' : 'green') : null,
    sign: l.sign, flowers: l.district === 'gardens' && rng() < 0.5,
    info: { kind: KIND[l.kind], lot: l.id, look: { w: width, storeys, wall: l.wall } },
  })
  // what lies about in a back yard
  const yard = []
  rect(l, (x, y) => { if (y < h0 || y > h1) yard.push([x, y]) })
  if (yard.length >= 4 && rng() < 0.6) {
    const ys = [...new Set(yard.map(c => c[1]))]
    const y = ys[Math.floor(rng() * ys.length)]
    if (l.district === 'gardens' && width >= 4 && rng() < 0.3) { lay(G, l.x0 + 1, y, PROPS.washing[0]); lay(G, l.x0 + 2, y, PROPS.washing[1]) }
    else {
      const [x, yy] = yard[Math.floor(rng() * yard.length)]
      lay(G, x, yy, l.district === 'harbour' ? PROPS.barrels[0] : l.district === 'gardens' ? (rng() < 0.5 ? 'ow_tree_small' : PROPS.planter[0]) : 'ow_prop_woodpile')
    }
  }
}

// A yard behind the houses. A small one is trodden earth with a washing
// line, a woodpile, barrels; a big one is the block's shared courtyard:
// grass, vegetable plots, fruit trees round the edge and a well; a long
// thin one a grassy lane with a row of trees.
function layYard(G, r, district, rng) {
  const w = r.x1 - r.x0 + 1, hgt = r.y1 - r.y0 + 1, area = w * hgt
  const things = district === 'harbour' ? [PROPS.barrels[0], PROPS.barrels[1], PROPS.crates[0], 'ow_prop_sack_0', PROPS.netRack[0]]
    : district === 'crafts' ? ['ow_prop_log', 'ow_prop_woodpile', PROPS.crates[1], PROPS.crates[2], 'ow_prop_cart']
    : ['ow_prop_woodpile', PROPS.barrels[0], 'ow_prop_stump_axe', 'ow_prop_bucket_water', 'ow_prop_sack_1']
  const put = (x, y, n) => { if (!G.prop(x, y)) lay(G, x, y, n) }
  const edge = (x, y) => x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1
  if (Math.min(w, hgt) <= 3 && area > 24) {
    // a lane: grass, a tree every few tiles down the middle of its length
    rect(r, (x, y) => pave(G, x, y, GRASS(x, y)))
    const along = w >= hgt
    const mid = along ? (r.y0 + r.y1) >> 1 : (r.x0 + r.x1) >> 1
    for (let t = (along ? r.x0 : r.y0) + 1 + Math.floor(rng() * 3); t <= (along ? r.x1 : r.y1) - 1; t += 3 + Math.floor(rng() * 2)) {
      const [x, y] = along ? [t, mid] : [mid, t]
      if (Math.min(w, hgt) >= 3 || rng() < 0.6) put(x, y, rng() < 0.5 ? 'ow_tree_apple' : 'ow_tree_small')
    }
    return
  }
  if (area <= 30) {
    rect(r, (x, y) => pave(G, x, y, district === 'crafts' || district === 'harbour' ? flag(x, y) : GRASS(x, y)))
    if (w >= 4 && rng() < 0.4) { put(r.x0 + 1, r.y0, PROPS.washing[0]); put(r.x0 + 2, r.y0, PROPS.washing[1]) }
    for (let i = 0; i < Math.floor(area / 7); i++) {
      const x = r.x0 + Math.floor(rng() * w), y = r.y0 + Math.floor(rng() * hgt)
      if (edge(x, y)) put(x, y, things[Math.floor(rng() * things.length)])
    }
    return
  }
  // the courtyard
  rect(r, (x, y) => pave(G, x, y, GRASS(x, y)))
  // vegetable plots inside, a tile clear of the edge and of each other
  for (let y = r.y0 + 1; y + 3 <= r.y1 - 1; y += 4) for (let x = r.x0 + 1; x + 3 <= r.x1 - 1; x += 5) {
    if (rng() < 0.35) continue
    const pw = 3 + Math.floor(rng() * 2), x1 = Math.min(r.x1 - 1, x + pw - 1), y1 = y + 2
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) {
      const v = yy === y ? 't' : yy === y1 ? 'b' : '', hh = xx === x ? 'l' : xx === x1 ? 'r' : ''
      lay(G, xx, yy, (yy - y) % 2 ? 'ow_deco_crop_1' : 'ow_deco_crop_0', { walk: true, ground: `ow_patch_${v + hh || 'm'}` })
    }
  }
  // fruit trees and a few things round the edge, a well
  rect(r, (x, y) => {
    if (!edge(x, y) || G.prop(x, y)) return
    const roll = rng()
    if (roll < 0.12) put(x, y, rng() < 0.6 ? 'ow_tree_apple' : 'ow_tree_small')
    else if (roll < 0.17) put(x, y, things[Math.floor(rng() * things.length)])
  })
  if (w >= 6 && hgt >= 5) { const x = r.x0 + 1 + Math.floor(rng() * (w - 2)); if (!G.prop(x, r.y0) && !G.prop(x, r.y0 + 1)) { lay(G, x, r.y0, PROPS.well[0]); lay(G, x, r.y0 + 1, PROPS.well[1]) } }
  if (w >= 5) { put(r.x1 - 2, r.y1, PROPS.washing[0]); put(r.x1 - 1, r.y1, PROPS.washing[1]) }
}
// A garden: grass, a tree or two, planters and flowers.
function layGarden(G, r, rng) {
  rect(r, (x, y) => pave(G, x, y, GRASS(x, y)))
  const w = r.x1 - r.x0 + 1, hgt = r.y1 - r.y0 + 1
  const n = Math.max(1, Math.floor(w * hgt / 10))
  for (let i = 0; i < n; i++) {
    const x = r.x0 + Math.floor(rng() * w), y = r.y0 + Math.floor(rng() * hgt)
    if (G.prop(x, y)) continue
    const roll = rng()
    if (roll < 0.3) lay(G, x, y, rng() < 0.5 ? 'ow_tree_small' : 'ow_tree_apple')
    else if (roll < 0.45) lay(G, x, y, PROPS.planter[Math.floor(rng() * 2)])
    else { G.setProp(x, y, FLOWERS[Math.floor(rng() * 4)], true); G.setTag(x, y, TAG.CITY) }
  }
}
