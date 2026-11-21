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
import { mulberry32, hashInt } from '../rand.js'
import { PAVE, PROPS } from './kit.js'
import { TAG, lay, pave, alley, house } from './stamps.js'

const PLASTER = ['white', 'ochre', 'rose', 'green']
const KIND = { house: 'home', cottage: 'home', shop: 'shop', workshop: 'workshop' }
const FLOWERS = ['ow_deco_flower_0', 'ow_deco_flower_1', 'ow_deco_flower_2', 'ow_deco_flower_3']
const GRASS = (x, y) => ['ow_grass_0', 'ow_grass_0', 'ow_grass_1'][hashInt(0, x, y, 7) % 3]
const DIRT = (x, y) => ['ow_dirt_0', 'ow_dirt_1', 'ow_dirt_2'][hashInt(0, x, y, 8) % 3]
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

// How each lot of a row looks: the row's roof, fronts that differ from their neighbours.
function lookOfRows(lots, seed) {
  const look = new Map()
  for (const row of rowsOf(lots)) {
    const first = row[0]
    const h = hashInt(seed, first.x0, first.y0, 77)
    const roof = first.wall === 'wood' && h % 3 === 0 ? 'brown' : { red: 'red', blue: 'blue', slate: 'dark' }[first.roof]
    let prev = null, turn = h % PLASTER.length
    for (const l of row) {
      let wall
      if (l.kind === 'cottage') wall = 'wood'
      else if (l.wall === 'stone') wall = 'stone'
      else if (l.wall === 'wood') wall = l.kind === 'workshop' ? 'wood' : 'timber'
      else { wall = PLASTER[turn++ % PLASTER.length]; if (wall === prev) wall = PLASTER[turn++ % PLASTER.length] }
      look.set(l.id, { wall, roof: l.kind === 'cottage' ? (roof === 'red' ? 'red' : 'blue') : roof })
      prev = wall
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
  for (const y of yards) layYard(G, y, rng)
  for (const g of gardens) layGarden(G, g, rng)
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
  rect(l, (x, y) => { if (y < h0 || y > h1) pave(G, x, y, l.district === 'gardens' ? GRASS(x, y) : DIRT(x, y)) })
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
  if (yard.length >= 4) {
    const ys = [...new Set(yard.map(c => c[1]))]
    const y = ys[Math.floor(rng() * ys.length)]
    if (l.district === 'gardens' && width >= 4 && rng() < 0.6) { lay(G, l.x0 + 1, y, PROPS.washing[0]); lay(G, l.x0 + 2, y, PROPS.washing[1]) }
    else { const [x, yy] = yard[Math.floor(rng() * yard.length)]; lay(G, x, yy, l.district === 'harbour' ? PROPS.barrels[0] : 'ow_prop_woodpile') }
  }
}

// A yard behind the houses: trodden earth, a washing line, a woodpile, barrels.
function layYard(G, r, rng) {
  rect(r, (x, y) => pave(G, x, y, DIRT(x, y)))
  const w = r.x1 - r.x0 + 1, hgt = r.y1 - r.y0 + 1
  if (w >= 4 && rng() < 0.7) { lay(G, r.x0 + 1, r.y0, PROPS.washing[0]); lay(G, r.x0 + 2, r.y0, PROPS.washing[1]) }
  const n = Math.floor(w * hgt / 12)
  const things = ['ow_prop_woodpile', PROPS.barrels[0], PROPS.barrels[1], PROPS.crates[0], PROPS.crates[2], 'ow_prop_stump_axe', 'ow_prop_sack_0']
  for (let i = 0; i < n; i++) {
    const x = r.x0 + Math.floor(rng() * w), y = r.y0 + Math.floor(rng() * hgt)
    if (!G.prop(x, y) && (x === r.x0 || x === r.x1 || y === r.y1)) lay(G, x, y, things[Math.floor(rng() * things.length)])
  }
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
