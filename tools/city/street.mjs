// Streets, squares and props of Kalevanlinna's tile kit: paving, lamps,
// benches, planters, the washing line, a blue stall, the stocks, the crier's
// box, a cart and horse, the windmill and its sails, turnips, a flower bed.
import { Pic, T, hex } from './lib.mjs'
import { INK, NAVY, S1, S2, S3, S4, W1, W2, W3, G1, G2, G3, RED, YEL, ORA, WHITE, CYAN, shade, srcTile } from './common.mjs'
import { PAVE, PROPS } from '../../renderer/wilds/city/kit.js'

const SAND = ['#efe5cc', '#e2d5b6', '#cdbd99', '#b4a78c']   // the square's limestone (the stalls' creams)
const WARM = '#b4a78c'
const DIRT = { a: '#eaa56c', e: '#cf8254', c: '#fec99c' }  // Tiny Town's path (ow_dirt_*)
const CW = ['#f4f1e8', '#e3dccb', '#bfb5a0']
const TAR = ['#a88a72', '#86685a', '#6a5048', '#503a36', '#3a2a28']

// ==== paving =================================================================
// Granite setts in courses of four pixels, the joints of each course fixed so
// every variant meets every other; the variants differ in their stones.
const JOINTS = [[3, 8, 13], [1, 6, 11], [4, 9, 14], [2, 7, 12]]
function setts(v) {
  const p = new Pic(T, T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const band = y >> 2, ry = y & 3, js = JOINTS[band]
    if (ry === 3 || js.includes(x)) { p.set(x, y, S4); continue }
    // which stone of the course: count joints to the left (wrapping)
    let start = x; while (!js.includes((start + T - 1) % T)) start = (start + T - 1) % T
    let end = x; while (!js.includes((end + 1) % T)) end = (end + 1) % T
    const id = (start * 7 + band * 5 + v * 11) % 13
    const base = id === 0 ? WARM : id === 4 || id === 9 ? S1 : S2
    let c = ry === 0 ? (x === end ? base : S1) : ry === 2 ? (x === start ? base : S3) : base
    if (ry === 0 && x === start) c = S4           // round the corners off
    if (ry === 2 && x === end) c = S4
    if (base === S1 && ry === 1) c = S1
    p.set(x, y, c)
  }
  if (v === 3) { p.rect(9, 5, 3, 2, DIRT.a).set(10, 5, G3).set(9, 6, DIRT.e) }      // a sett gone, earth and a weed in its place
  if (v === 2) { p.set(6, 9, S4).set(7, 10, S4) }                                    // a cracked one
  return p
}
function kerb(side) {
  const p = setts(0)
  for (let i = 0; i < T; i++) for (let d = 0; d < 4; d++) {
    const [x, y] = side === 'n' ? [i, d] : side === 's' ? [i, T - 1 - d] : side === 'w' ? [d, i] : [T - 1 - d, i]
    // from the outer edge in: the kerb stone's light top, its body, a joint, the gutter line
    const joint = i % 8 === 7
    p.set(x, y, d === 3 ? NAVY : joint ? S4 : d === 0 ? (side === 's' || side === 'e' ? S2 : S1) : d === 1 ? S1 : S2)
  }
  return p
}
// the square: limestone flags, eight to a side, a grey granite square in the
// middle of every 2x2 of tiles
function square(cx, cy) {
  const p = new Pic(T, T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const X = cx * T + x, Y = cy * T + y
    const fx = Math.floor(X / 8), fy = Math.floor(Y / 8), lx = X % 8, ly = Y % 8
    // one granite flag on the diagonal of every 2x2 of tiles: a quiet rhythm
    const grey = (fx === 1 && fy === 1) || (fx === 2 && fy === 2)
    const [hi, mid, lo, joint] = grey ? [S1, S2, S3, S4] : [SAND[0], SAND[1], SAND[2], SAND[3]]
    let c
    if (lx === 7 || ly === 7) c = joint
    else if (ly === 0 || lx === 0) c = hi
    else if (ly === 6 || lx === 6) c = lo
    else c = ((fx + fy) % 2 && !grey) ? hex(SAND[1]) : mid
    p.set(x, y, c)
  }
  // a fleck or two in the stone
  p.set((cx * 5 + 3) % 6 + 1, (cy * 3 + 2) % 6 + 1, SAND[2]).set((cx * 3 + 1) % 6 + 9, (cy * 5 + 4) % 6 + 9, SAND[2])
  return p
}
// plain flags: big light slabs with soft joints, so they read as ground and
// never as the wall's coursed brick
function flags(v) {
  const p = new Pic(T, T)
  const slabs = v ? [[0, 0, 7, 9], [8, 0, 15, 9], [0, 10, 3, 15], [4, 10, 11, 15], [12, 10, 15, 15]]
    : [[0, 0, 5, 6], [6, 0, 15, 6], [0, 7, 9, 15], [10, 7, 15, 15]]
  for (const [x0, y0, x1, y1] of slabs) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    p.set(x, y, x === x1 || y === y1 ? S2 : (x === x0 && y === y0) ? WHITE : S1)
  }
  for (const [x, y] of v ? [[3, 4], [10, 6], [7, 13]] : [[2, 3], [12, 2], [6, 11], [13, 12]]) p.set(x, y, S2)
  return p
}
function alley(v) {
  const p = new Pic(T, T).rect(0, 0, T, T, DIRT.a)
  const specks = v ? [[2, 3, 'e'], [9, 1, 'c'], [13, 7, 'e'], [5, 11, 'e'], [11, 13, 'c'], [1, 8, 'c']] : [[4, 2, 'e'], [12, 4, 'c'], [7, 9, 'e'], [2, 13, 'c'], [14, 12, 'e']]
  for (const [x, y, k] of specks) p.set(x, y, DIRT[k])
  // a pebble
  const [px, py] = v ? [10, 9] : [5, 6]
  p.set(px, py, S1).set(px + 1, py, S2).set(px, py + 1, S2).set(px + 1, py + 1, S3)
  return p
}
function gutter(dir) {
  const p = alley(dir === 'h' ? 0 : 1)
  for (let i = 0; i < T; i++) {
    const at = (d, c) => dir === 'h' ? p.set(i, 6 + d, c) : p.set(6 + d, i, c)
    at(0, i % 6 === 5 ? S3 : S1); at(1, NAVY); at(2, i % 5 === 2 ? CYAN : '#2d4a6e'); at(3, i % 6 === 2 ? S3 : S2)
  }
  return p
}
function drain() {
  const p = setts(1)
  p.rect(4, 4, 8, 8, INK).rect(5, 5, 6, 6, NAVY)
  for (const x of [6, 8, 10]) p.vline(x, 5, 10, S3)
  p.hline(4, 11, 4, S3).hline(4, 11, 11, S1)
  return p
}

// ==== props ==================================================================
const lampRows = lit => [
  '......aa........',
  '.....assa.......',
  '....aaaaaa......',
  '....agggga......',
  '....agGGga......',
  '....agGGga......',
  '....agggga......',
  '....aaaaaa......',
  '......aa........',
  '......ap........',
  '......ap........',
  '......ap........',
  '......ap........',
  '.....aaaa.......',
  '....assssa......',
  '....aaaaaa......',
].map(r => lit ? r : r.replace(/G/g, 'g'))
function lamp(lit) {
  const pal = lit ? { a: INK, s: S2, g: YEL, G: WHITE, p: NAVY } : { a: INK, s: S2, g: S2, G: S1, p: NAVY }
  const p = new Pic(T, T).map(lampRows(lit), pal, 3, 0)
  if (lit) {
    // a soft halo round the lantern
    for (let y = 0; y < 11; y++) for (let x = 3; x < 15; x++) {
      if (p.get(x, y)) continue
      const d = Math.hypot(x - 9.5, y - 5)
      if (d < 6) p.set(x, y, [253, 190, 83, Math.round(110 * (1 - d / 6))])
    }
  }
  return p
}
function bench() {
  return new Pic(T, T).map([
    '................',
    '................',
    '................',
    '................',
    '.aaaaaaaaaaaaaa.',
    '.awwwwwwwwwwwwa.',
    '.aWWWWWWWWWWWWa.',
    '.aaaaaaaaaaaaaa.',
    '.aa.........aa..',
    'aaaaaaaaaaaaaaaa',
    'abbbbbbbbbbbbbba',
    'awwwwwwwwwwwwwwa',
    'aaaaaaaaaaaaaaaa',
    '.aWa........aWa.',
    '.aWa........aWa.',
    '.aaa........aaa.',
  ], { a: INK, w: W2, W: W3, b: W1 })
}
function benchSide() {
  return new Pic(T, T).map([
    '................',
    '.......aaa......',
    '......abwWa.....',
    '......abwWa.....',
    '......abwWa.aa..',
    '......abwWaaWa..',
    '......abwWaaWa..',
    '......abwWaaWa..',
    '......abwWaaWa..',
    '......abwWaaWa..',
    '......abwWaaWa..',
    '......abwWaaWa..',
    '......aaaaaaaa..',
    '......aWa..aWa..',
    '......aWa..aWa..',
    '......aaa..aaa..',
  ], { a: INK, w: W2, W: W3, b: W1 })
}
function planter(v) {
  if (v === 0) return new Pic(T, T).map([
    '................',
    '................',
    '................',
    '....r..y..r.....',
    '...rYr.yy.rYr...',
    '..g.r.gyg.r.g...',
    '..ggggggggggg...',
    '.gGgggGgggGggg..',
    'aaaaaaaaaaaaaaaa',
    'abbbbbbbbbbbbbba',
    'awwwwwwwwwwwwwwa',
    'awWwwwwWwwwwwWwa',
    'awwwwwwwwwwwwwwa',
    'aWWWWWWWWWWWWWWa',
    'aaaaaaaaaaaaaaaa',
    '................',
  ], { a: INK, w: W2, W: W3, b: W1, g: G3, G: G2, r: RED, Y: YEL, y: YEL })
  return new Pic(T, T).map([
    '................',
    '.....gggg.......',
    '...ggGgggGg.....',
    '..gggggGgggg....',
    '..gGggggggGg....',
    '..ggggGggggg....',
    '...gGgggggg.....',
    '....aaaaaa......',
    '...assssssa.....',
    '..aaaaaaaaaa....',
    '...asssssSa.....',
    '....asssSa......',
    '....assSSa......',
    '...asssssSa.....',
    '...aaaaaaaa.....',
    '................',
  ], { a: INK, s: S1, S: S2, g: G1, G: G2 }).crop(0, 0, T, T)
}
// a washing line between two posts, the wash hung on it (or not: the line bare)
function washing(side, hung = true) {
  const p = new Pic(T, T)
  const postX = side === 'l' ? 1 : 13
  p.rect(postX, 1, 3, 15, INK).vline(postX + 1, 2, 14, W2).set(postX + 1, 2, W1)
  p.rect(postX - 1, 13, 5, 3, INK).hline(postX, postX + 2, 14, W3)
  // the line, sagging to the middle of the two cells
  const sag = x => side === 'l' ? 3 + Math.round(((x - 3) / 13) * 2) : 5 - Math.round(((x) / 13) * 2)
  for (let x = side === 'l' ? 4 : 0; x <= (side === 'l' ? 15 : 12); x++) p.set(x, sag(x), INK)
  if (!hung) {
    // a peg or two left on the line
    for (const x of side === 'l' ? [7, 12] : [3, 9]) p.set(x, sag(x) + 1, W1)
    return p
  }
  const shirt = (x0, col, dk) => p.map(['aaaaaaa', 'accccca', 'acccccaa'.slice(0, 7), 'aacccaa', '.accca.', '.adcda.', '.aaaaa.'], { a: INK, c: col, d: dk }, x0, sag(x0 + 3) + 1)
  if (side === 'l') {
    shirt(5, WHITE, CW[2])
    p.map(['aaaa', 'arra', 'arra', 'aRRa', 'aaaa'], { a: INK, r: RED, R: '#a8322a' }, 12, sag(13) + 1)
  } else {
    p.map(['aaaaaa', 'abbbba', 'abbbba', 'abaaba', 'abaaba', 'aBaaBa', 'aaaaaa'].map(r => r.replace(/aa(?=ba)/, 'a.')), { a: INK, b: '#5a7fc4', B: '#3d5c99' }, 2, sag(4) + 1)
    p.map(['aaaa', 'ayya', 'ayya', 'aOOa', 'aaaa'], { a: INK, y: YEL, O: ORA }, 8, sag(9) + 1)
  }
  return p
}
function stocks() {
  return new Pic(T, T).map([
    '................',
    '................',
    '..aaa......aaa..',
    '..awa......awa..',
    'aaaaaaaaaaaaaaaa',
    'abbbbbbbbbbbbbba',
    'abaabbbaabbbaaba',
    'aaNNaaaNNaaaNNaa',
    'awaawwwaawwwaawa',
    'awWwwwwwwwwwwWwa',
    'aaaaaaaaaaaaaaaa',
    '..awa......awa..',
    '..awa......awa..',
    '..aWa......aWa..',
    '.aaaaa....aaaaa.',
    '................',
  ], { a: INK, w: W2, W: W3, b: W1, N: NAVY })
}
function crierBox() {
  return new Pic(T, T).map([
    '................',
    '................',
    '................',
    '................',
    '..aaaaaaaaaaaa..',
    '..abbbbbbbbbba..',
    '..awwwwwwwwwwa..',
    '..abbbbbbbbbba..',
    '..awwwwwwwwwwa..',
    '..aaaaaaaaaaaa..',
    '..aWWWWWWWWWWa..',
    '..aWaWWWWWWaWa..',
    '..aWWWWWWWWWWa..',
    '..aaaaaaaaaaaa..',
    '................',
    '................',
  ], { a: INK, w: W2, W: W3, b: W1 })
}
// a cart and horse, side on, the horse to the west
function cartAndHorse() {
  const p = new Pic(2 * T, T)
  // the cart: a box on a big wheel, a load of sacks
  p.map([
    '.......ccc.cc...',
    '......cCCcccCc..',
    '.....cCCCCcCCCc.',
    '..aaaaaaaaaaaaaa',
    '..abbbbbbbbbbbba',
    '..awwwwwwwwwwwwa',
    '..awWwwwwWwwwwwa',
    '..aaaaaaaaaaaaaa',
    '.....aaaaa......',
    '....aWsWsWa.....',
    '...aWsaaasWa....',
    '...asaSSSasa....',
    '...aWsaaasWa....',
    '....aWsWsWa.....',
    '.....aaaaa......',
    '................',
  ], { a: INK, w: W2, W: W3, b: W1, s: W1, S: S2, c: '#bfb5a0', C: '#e3dccb' }, T, 0)
  // the shafts from the cart to the harness
  p.hline(9, T + 2, 6, INK).hline(9, T + 2, 7, W3)
  // the horse, a bay with a dark mane
  p.map([
    '................',
    '..aa............',
    '.annaa..........',
    'aannnhaa........',
    'ahhnhhhhaaaaaa..',
    'aahahhhhhhhhhhaa',
    '.aaahhhhhhhhhhhn',
    '...ahhhhHHHHhhan',
    '...ahHHHHHHHHhan',
    '...aaHHaaaaHHaan',
    '....aHa....aHa..',
    '....aHa....aHa..',
    '....aHa....aHa..',
    '....aaa....aaa..',
    '................',
    '................',
  ], { a: INK, h: W2, H: W3, n: INK }, 0, 1)
  p.set(2, 5, WHITE).set(3, 5, INK)   // its eye
  return p
}
// the post mill: a boarded house on a trestle, the sails on its front gable
const HUB = { x: 23.5, y: 21 }
function windmillBase() {
  const W_ = 3 * T, Hh = 3 * T
  const p = new Pic(W_, Hh)
  // the trestle: a centre post, two struts, low stone piers
  p.rect(22, 34, 4, 9, INK).rect(23, 34, 2, 9, W3)
  for (let i = 0; i < 9; i++) { p.set(21 - i, 36 + i, INK); p.set(20 - i, 36 + i, W3); p.set(26 + i, 36 + i, INK); p.set(27 + i, 36 + i, W3) }
  for (const x0 of [8, 20, 33]) p.rect(x0, 43, 7, 4, INK).rect(x0 + 1, 44, 5, 2, S2).hline(x0 + 1, x0 + 5, 44, S1)
  // the house: the front gable boarded in red-brown, the roof's tarred edge round it
  const hx0 = 12, hx1 = 35, wall0 = 16, wall1 = 35, peak = 5
  for (let y = peak; y <= wall1; y++) for (let x = hx0; x <= hx1; x++) {
    const inGable = y >= wall0 || Math.abs(x - 23.5) <= (y - peak) * 1.15
    if (!inGable) continue
    const plank = (x - hx0) % 4 === 3
    p.set(x, y, plank ? '#7a3328' : (x < 20 ? '#c0503a' : x > 29 ? '#8f3a2c' : '#a8442f'))
  }
  // the roof edge: a thick band along the gable's slopes, the ridge going back
  for (let y = peak - 3; y <= wall0 + 1; y++) for (let x = hx0 - 3; x <= hx1 + 3; x++) {
    const d = Math.abs(x - 23.5) - (y - peak) * 1.15
    if (d > 0.5 && d <= 3.5) p.set(x, y, d > 2.8 ? INK : d > 1.6 ? TAR[2] : TAR[0])
  }
  p.rect(21, peak - 5, 6, 4, TAR[1]).hline(21, 26, peak - 5, INK).vline(20, peak - 5, peak - 1, INK).vline(27, peak - 5, peak - 1, INK)
  for (let y = wall0; y <= wall1; y++) { p.set(hx0 - 1, y, INK); p.set(hx1 + 1, y, INK) }
  p.hline(hx0 - 1, hx1 + 1, wall1 + 1, INK)
  // a door at the foot, a window by it
  p.rect(26, 27, 6, 9, INK).rect(27, 28, 4, 8, W3).set(30, 31, YEL)
  p.rect(14, 26, 5, 5, INK).rect(15, 27, 3, 3, S2).set(15, 27, S1)
  // the hub the sails turn on
  p.rect(Math.round(HUB.x) - 2, HUB.y - 2, 4, 4, INK).rect(Math.round(HUB.x) - 1, HUB.y - 1, 2, 2, S2)
  return p
}
// four lattice sails on their stocks, turned a sixteenth of a turn a frame
// (the sails repeat every quarter turn, so four frames make a loop)
function sails(frame) {
  const W_ = 3 * T, Hh = 3 * T
  const p = new Pic(W_, Hh)
  const squash = 0.9, R0 = 5, R1_ = 22, half = 3.2
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W_; x++) {
    const dx = x - HUB.x, dy = (y - HUB.y) / squash
    const r = Math.hypot(dx, dy)
    if (r > R1_ + 0.5) continue
    for (let k = 0; k < 4; k++) {
      const a = frame * Math.PI / 8 + k * Math.PI / 2 + 0.3
      const ux = Math.cos(a), uy = Math.sin(a)
      const along = dx * ux + dy * uy, across = -dx * uy + dy * ux
      if (along < 0) continue
      // the stock: a beam down the middle of the arm
      if (Math.abs(across) < 0.9 && along <= R1_ + 0.5) { p.set(x, y, along < R0 ? INK : W3); break }
      // the sail on the trailing side: canvas on a lattice, outlined
      if (along >= R0 && along <= R1_ && across > 0.9 && across < 0.9 + 2 * half) {
        const edge = along > R1_ - 1 || along < R0 + 1 || across > 2 * half - 0.2
        const lat = Math.abs((along - R0) % 4) < 0.8 || Math.abs(across - 0.9 - half) < 0.5
        p.set(x, y, edge ? INK : lat ? W2 : (across < half ? CW[0] : CW[1]))
        break
      }
    }
  }
  // the hub over the stocks
  p.rect(Math.round(HUB.x) - 2, HUB.y - 2, 4, 4, INK).rect(Math.round(HUB.x) - 1, HUB.y - 1, 2, 2, S1)
  return p
}
function turnip() {
  return new Pic(T, T).map([
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......aa.aa....',
    '......aGgaGga...',
    '.......agGga....',
    '......aappa.....',
    '.....apwwppa....',
    '.....awwwppa....',
    '.....awwwwPa....',
    '......awwPa.....',
    '.......aaa......',
    '................',
    '................',
  ], { a: INK, g: G1, G: G2, p: '#b464b4', P: '#7a3a82', w: CW[0] })
}
function turnipCrate() {
  return new Pic(T, T).map([
    '................',
    '................',
    '...g.G..g.G.g...',
    '..gGgGgGgGgGgG..',
    '.apwpwpapwpwpa..',
    'aaaaaaaaaaaaaaaa',
    'abbbbbbbbbbbbbba',
    'awwwwwwwwwwwwwwa',
    'aWWWWWWWWWWWWWWa',
    'aaaaaaaaaaaaaaaa',
    'abbbbbbbbbbbbbba',
    'awwwwwwwwwwwwwwa',
    'aWWWWWWWWWWWWWWa',
    'aaaaaaaaaaaaaaaa',
    '................',
    '................',
  ], { a: INK, w: W2, W: W3, b: W1, g: G1, G: G2, p: '#b464b4' }).set(3, 4, CW[0]).set(9, 4, CW[0])
}
// a flower bed in a low stone kerb, a nine-slice: leaves thick with flowers
const BLOOM = [RED, YEL, WHITE, '#ff706d', '#b464b4']
function bed(row, col) {
  const p = new Pic(T, T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const v = (x * 7 + y * 11) % 9
    p.set(x, y, v < 2 ? '#7a4a32' : v < 5 ? G3 : G2)
  }
  // flowers on a staggered grid so the slices meet: three pixels each, a lighter heart
  for (let y = 1; y < T; y += 4) for (let x = (y % 8 === 1 ? 1 : 3); x < T; x += 4) {
    const c = BLOOM[((x >> 2) * 3 + (y >> 2) * 2 + (row === 'm' ? 1 : 0)) % BLOOM.length]
    p.set(x, y, c).set(x + 1, y, c).set(x, y + 1, c).set(x + 1, y + 1, shade(hex(c), 1)).set(x, y - 1 < 0 ? 0 : y - 1, p.get(x, y - 1 < 0 ? 0 : y - 1))
  }
  const edge = (side) => {
    for (let i = 0; i < T; i++) {
      const pts = side === 't' ? [[i, 0, INK], [i, 1, S1], [i, 2, S2]] : side === 'b' ? [[i, 12, INK], [i, 13, S1], [i, 14, S2], [i, 15, INK]]
        : side === 'l' ? [[0, i, INK], [1, i, S1], [2, i, S2]] : [[15, i, INK], [14, i, S1], [13, i, S3]]
      for (const [x, y, c] of pts) p.set(x, y, i % 6 === 5 && c !== INK ? S4 : c)
    }
  }
  if (row === 't') edge('t')
  if (row === 'b') edge('b')
  if (col === 'l') edge('l')
  if (col === 'r') edge('r')
  if (row === 'b') for (let x = 0; x < T; x++) p.set(x, 15, INK)
  if (row === 't' && col === 'l') p.set(0, 0, null)
  if (row === 't' && col === 'r') p.set(15, 0, null)
  return p
}

export function draw({ put, putGrid }) {
  PAVE.cobble.forEach((n, i) => put(n, setts(i)))
  for (const s of ['n', 'e', 's', 'w']) put(PAVE.kerb[s], kerb(s))
  PAVE.square.forEach((r, cy) => r.forEach((n, cx) => put(n, square(cx, cy))))
  PAVE.flag.forEach((n, i) => put(n, flags(i)))
  PAVE.alley.forEach((n, i) => put(n, alley(i)))
  put(PAVE.gutter.h, gutter('h')); put(PAVE.gutter.v, gutter('v'))
  put(PAVE.drain, drain())
  put(PROPS.lamp, lamp(false)); put(PROPS.lampLit, lamp(true))
  put(PROPS.bench, bench()); put(PROPS.benchSide, benchSide())
  PROPS.planter.forEach((n, i) => put(n, planter(i)))
  put(PROPS.washing[0], washing('l')); put(PROPS.washing[1], washing('r'))
  put(PROPS.line[0], washing('l', false)); put(PROPS.line[1], washing('r', false))
  const blue = [['#c66527', '#3f7fc4'], ['#b45c24', '#336fae'], ['#a35422', '#285890']]
  put(PROPS.stall.blue[0], srcTile('ow_stall_top').recolor(blue)); put(PROPS.stall.blue[1], srcTile('ow_stall_front').recolor(blue))
  put(PROPS.stocks, stocks())
  put(PROPS.crier, crierBox())
  const ch = cartAndHorse(); put(PROPS.cart[0], ch.cell(0, 0)); put(PROPS.cart[1], ch.cell(1, 0))
  putGrid(PROPS.windmill.base, windmillBase())
  PROPS.windmill.sails.forEach((f, i) => putGrid(f, sails(i)))
  put(PROPS.turnip, turnip()); put(PROPS.turnips, turnipCrate())
  PROPS.bed.forEach((r, ri) => r.forEach((n, ci) => put(n, bed('tmb'[ri], 'lcr'[ci]))))
}
