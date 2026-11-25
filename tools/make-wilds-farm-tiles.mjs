// Draws the farms' art that the Kenney packs lack into renderer/assets/tiles/
// (renderer/wilds/sites.js FARM_PLANS lays them):
//   ow_prop_hay_0/1          a bale and a stack of hay
//   ow_prop_peat_0/1         stacked sods of cut peat drying
//   ow_deco_peat             the cut face of a peat bank, walked on
//   ow_prop_nets_l/r         nets hung to dry between two posts (the fish rack's posts and line)
//   ow_tree_palm             a date palm
//   ow_prop_wall_sand        a block of mud-brick wall, the same tile all round a walled garden
//   the windmill, 3 x 4 tiles in the house kit's two rows of roof over wall:
//     ow_roof_mill_l/m/r, ow_roof_mill_el/em/er    its sails and cap
//     ow_house_mill_l/m/r, ow_house_mill_wl/wr      its tower
//     ow_house_door_mill                           its door
// Tiny Town's outline and colours (#3f2631; the roof reds, the wall greys) for
// what stands among its houses; the rack's browns for the nets. The small
// tiles are pixel maps; the windmill is drawn from shapes and cut into tiles.
//
//   node tools/make-wilds-farm-tiles.mjs
import { writePng } from './png-write.mjs'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const INK = '#3f2631'
const save = (name, rgba) => {
  const out = new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
  writePng(out, 16, 16, rgba)
  console.log(`wrote ${out}`)
}
function tile(name, rows, palette) {
  if (rows.length !== 16 || rows.some(r => r.length !== 16)) throw new Error(`${name}: not 16x16 (${rows.map(r => r.length)})`)
  const rgba = new Uint8Array(16 * 16 * 4)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    if (!palette[ch]) throw new Error(`${name}: no colour for "${ch}"`)
    rgba.set([...hex(palette[ch]), 255], (y * 16 + x) * 4)
  }))
  save(name, rgba)
}
const mirror = rows => rows.map(r => [...r].reverse().join(''))

// ---- hay: L light, Y straw, y strands, h shade, t twine ----
const HAY = { a: INK, L: '#fde68a', Y: '#fdbe53', y: '#e3a13a', h: '#c47a23', t: '#8f673f' }
tile('ow_prop_hay_0', [
  '................',
  '................',
  '................',
  '................',
  '...aaaaaaaaaa...',
  '..aLLLLLLLLLLa..',
  '..aLYYYLYYYLYa..',
  '..aYYyYYYyYYYa..',
  '..aYYYYYYYYYYa..',
  '..atttttttttta..',
  '..aYYyYYYYyYYa..',
  '..aYYYYYyYYYYa..',
  '..ahYYYhYYYhYa..',
  '..ahhhhhhhhhha..',
  '...aaaaaaaaaa...',
  '................',
], HAY)
tile('ow_prop_hay_1', [
  '................',
  '................',
  '.......aa.......',
  '.....aaLLaa.....',
  '....aLLYYLLa....',
  '...aLYYyYYYYa...',
  '...aYYYYYyYYa...',
  '..aYYyYYYYYYYa..',
  '..aYYYYYyYYyYa..',
  '.aYYYyYYYYYYYYa.',
  '.aYyYYYYYyYYYYa.',
  '.aYYYYyYYYYYyYa.',
  '.ahYYYYYYyYYYha.',
  '.ahhhYhhhhYhhha.',
  '..aaaaaaaaaaaa..',
  '................',
], HAY)

// ---- peat: q the sod's top, r fibre, P its face, p shade ----
const PEAT = { a: INK, q: '#9a6a48', r: '#b4835a', P: '#6e4630', p: '#4f3122' }
tile('ow_prop_peat_0', [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....aaaaaa.....',
  '....aqqrqqqa....',
  '....aPPPPPPa....',
  '....apPpppPa....',
  '..aaaaaaaaaaaa..',
  '.aqqrqqaaqqqrqa.',
  '.aPPPPPaaPPPPPa.',
  '.apPppPaapPpPpa.',
  '..aaaaa..aaaaa..',
  '................',
  '................',
], PEAT)
tile('ow_prop_peat_1', [
  '................',
  '................',
  '......aaaa......',
  '.....aqqrqa.....',
  '.....aPPPPa.....',
  '....aaapPpaa....',
  '...aqqqaaqqra...',
  '...aPPPaaPPPa...',
  '...apPpaapPpa...',
  '..aaaaaaaaaaaa..',
  '.aqrqqaqqqaqrqa.',
  '.aPPPPaPPPaPPPa.',
  '.apPppapPpapPpa.',
  '..aaaa.aaa.aaa..',
  '................',
  '................',
], PEAT)
// the bank where the sods were cut: dark slots in the ground, which shows between
tile('ow_deco_peat', [
  '................',
  '.pppppp..pppppp.',
  '.PPPPPP..PPPPPP.',
  '.qqqqqq..qqqqqq.',
  '................',
  '................',
  '....pppppp......',
  '....PPPPPP..ppp.',
  '....qqqqqq..PPP.',
  '............qqq.',
  '................',
  '.ppp...pppppp...',
  '.PPP...PPPPPP...',
  '.qqq...qqqqqq...',
  '................',
  '................',
], PEAT)

// ---- nets: the fish rack's post (a, e) and line (b, c, d), a net of n with knots k and cork floats f ----
const NETS = { a: '#8f673f', b: '#b4a78c', c: '#e0d1af', d: '#e6dabf', e: '#b98b5e', n: '#d3c39c', k: '#8a7a5a', f: '#c66527' }
const NETS_L = [
  '................',
  'aaab............',
  'bcbdbbbb........',
  'bdbbddddbbbbbbbb',
  'bcb.bbbbdddddddd',
  'aea.knknknknknkn',
  'aea.n.n.n.n.n.n.',
  'aea.knknknknknkn',
  'aea.n.n.n.n.n.n.',
  'aea.knknknknknkn',
  'aea..n.n.n.n.n.n',
  'aea..knknknknknk',
  'aea...f..f..f..f',
  'aea.............',
  'aea.............',
  'aea.............',
]
tile('ow_prop_nets_l', NETS_L, NETS)
tile('ow_prop_nets_r', mirror(NETS_L), NETS)

// ---- the date palm: G leaf, g its shade, k trunk, K its rings, o dates ----
tile('ow_tree_palm', [
  '................',
  '..aaaa....aaaa..',
  '.aGGGGa..aGGGGa.',
  'aGGggGGaaGGggGGa',
  'aGgaaaGGGGaaagGa',
  'aga..aGGGGa..aga',
  '.a..aGGggGGa..a.',
  '...aGGgaagGGa...',
  '..aGga.kk.agGa..',
  '..aga.okko.aga..',
  '...a..akKa..a...',
  '......aKka......',
  '......akKa......',
  '.....akkKa......',
  '.....aKkka......',
  '....aaaaaaa.....',
], { a: INK, G: '#84c669', g: '#479f4a', k: '#b48355', K: '#8f673f', o: '#c66527' })

// ---- mud brick: c cap, C its edge, m brick, M mortar, s the shadow at its foot ----
tile('ow_prop_wall_sand', [
  '................',
  '................',
  '................',
  '................',
  '................',
  'cccccccccccccccc',
  'CCCCCCCCCCCCCCCC',
  'mmmmmMmmmmmmmMmm',
  'mmmmmMmmmmmmmMmm',
  'MMMMMMMMMMMMMMMM',
  'mmMmmmmmmMmmmmmm',
  'mmMmmmmmmMmmmmmm',
  'MMMMMMMMMMMMMMMM',
  'mmmmmMmmmmmmmMmm',
  'mmmmmMmmmmmmmMmm',
  'ssssssssssssssss',
], { c: '#efe0b9', C: '#d9c08a', m: '#c9a46a', M: '#a8834e', s: '#8a6a3f' })

// ---- the windmill: 48 x 64 pixels, drawn in layers and cut into twelve tiles ----
const W = 48, H = 64
const layer = () => new Array(W * H).fill(null)
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H
const set = (L, x, y, col) => { if (inside(x, y)) L[y * W + x] = col }
const get = (L, x, y) => inside(x, y) ? L[y * W + x] : null
// a filled polygon, by the centre of each pixel
function poly(L, pts, colOf) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x + 0.5, py = y + 0.5
    let inPoly = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j]
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inPoly = !inPoly
    }
    if (inPoly) set(L, x, y, colOf(x, y))
  }
}
// a one-pixel ink line round everything a layer holds
function outlined(L) {
  const out = L.slice()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (get(L, x, y)) continue
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(L, x + dx, y + dy))) set(out, x, y, INK)
  }
  return out
}
const over = (base, top) => base.map((c, i) => top[i] ?? c)

const STONE = { hi: '#c0cbdc', mid: '#8b9bb4', lo: '#5a6988' }
const RED = { hi: '#fcbc8f', mid: '#f28462', lo: '#c34b35' }
const WOOD = { hi: '#eaa56c', mid: '#bd6c4a', lo: '#763b36' }
const CLOTH = { hi: '#f4f1e8', lo: '#d9d2c0' }

// the tower: a tapering stone drum, lit from the left, with courses of stone
const tower = layer()
const TOP = 22, BOT = 63
const towerHalf = y => 12 + (y - TOP) / (BOT - TOP) * 6   // 12 wide each side at the top, 18 at the foot
poly(tower, [[24 - 12, TOP], [24 + 12, TOP], [24 + 18, BOT + 1], [24 - 18, BOT + 1]], (x, y) => {
  const edge = (x + 0.5 - (24 - towerHalf(y))) / (2 * towerHalf(y))   // 0 at its left edge, 1 at its right
  const course = (y - TOP) % 6 === 5
  const joint = ((x + ((Math.floor((y - TOP) / 6) % 2) * 4)) % 8) === 0
  if (edge < 0.12) return STONE.hi
  if (edge > 0.85) return STONE.lo
  return course || (joint && (y - TOP) % 6 !== 0) ? STONE.lo : STONE.mid
})
// a window, and the door with its frame (the kit's door, narrowed to the tower)
for (let y = 38; y <= 42; y++) for (let x = 22; x <= 25; x++) set(tower, x, y, y === 38 || x === 22 || x === 25 ? INK : '#262b44')
for (let y = 49; y <= 63; y++) for (let x = 18; x <= 29; x++) {
  const frame = x <= 19 || x >= 28 || y <= 50
  const arch = y === 49 && (x === 18 || x === 29)
  if (arch) continue
  set(tower, x, y, frame ? INK : x === 20 || x === 27 || y === 51 || y === 63 ? WOOD.mid : y === 57 && x === 21 ? STONE.hi : WOOD.lo)
}
for (let y = 52; y <= 62; y++) for (let x = 21; x <= 26; x++) if ((x - 21) % 3 === 2) set(tower, x, y, WOOD.mid)

// the cap: a rounded hood of red roof over the top of the tower
const cap = layer()
poly(cap, [[10, 25], [12, 18], [16, 13], [21, 10], [27, 10], [32, 13], [36, 18], [38, 25]], (x, y) => {
  const shine = x < 20 && y < 18
  const band = y >= 23
  return band ? RED.lo : shine ? RED.hi : (x + y) % 5 === 0 ? RED.lo : RED.mid
})

// the sails: four arms on a hub, each a spar with a lattice of cloth on its trailing side
const sails = layer()
const HUB = [24, 19]
for (const turn of [0.25, 0.75, 1.25, 1.75]) {
  const a = turn * Math.PI, ux = Math.cos(a), uy = Math.sin(a)
  const vx = -uy, vy = ux                  // across the arm, to its trailing side
  const at = (along, across) => [HUB[0] + ux * along + vx * across, HUB[1] + uy * along + vy * across]
  poly(sails, [at(4, 1), at(21, 1), at(21, 6), at(4, 6)], (x, y) => {
    const along = (x + 0.5 - HUB[0]) * ux + (y + 0.5 - HUB[1]) * uy
    const across = (x + 0.5 - HUB[0]) * vx + (y + 0.5 - HUB[1]) * vy
    return Math.abs((along % 4) - 2) < 0.6 || Math.abs(across - 3.5) < 0.5 ? WOOD.mid : across < 3.5 ? CLOTH.hi : CLOTH.lo
  })
  poly(sails, [at(0, -1), at(22, -1), at(22, 1), at(0, 1)], () => WOOD.lo)
}
const hub = layer()
for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) set(hub, HUB[0] + x, HUB[1] + y, x * x + y * y <= 1 ? WOOD.hi : WOOD.mid)

const mill = [outlined(tower), outlined(cap), outlined(sails), outlined(hub)].reduce(over)
const NAMES = [
  ['ow_roof_mill_l', 'ow_roof_mill_m', 'ow_roof_mill_r'],
  ['ow_roof_mill_el', 'ow_roof_mill_em', 'ow_roof_mill_er'],
  ['ow_house_mill_l', 'ow_house_mill_m', 'ow_house_mill_r'],
  ['ow_house_mill_wl', 'ow_house_door_mill', 'ow_house_mill_wr'],
]
NAMES.forEach((row, ty) => row.forEach((name, tx) => {
  const rgba = new Uint8Array(16 * 16 * 4)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = mill[(ty * 16 + y) * W + tx * 16 + x]
    if (col) rgba.set([...hex(col), 255], (y * 16 + x) * 4)
  }
  save(name, rgba)
}))
