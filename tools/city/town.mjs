// The church, the townhouses, shop fronts, roofs and signs of Kalevanlinna's
// tile kit. Facades follow Tiny Town's walls (tiles 72-79): a 2-px outline
// at each end with a light corner post, the fill in a middle tone, specks.
import { Pic, T, hex, same } from './lib.mjs'
import { INK, NAVY, S1, S2, S3, S4, R1, R2, R3, W1, W2, W3, G3, RED, YEL, ORA, WHITE, shade, srcTile } from './common.mjs'
import { roofRow, cylinder } from './fort.mjs'
import { CHURCH, HOUSE_FRONT } from '../../renderer/wilds/city/kit.js'

// whitewash, tarred shingles
const CW = ['#f4f1e8', '#e3dccb', '#bfb5a0']
const TAR = ['#a88a72', '#86685a', '#6a5048', '#503a36', '#3a2a28']
const GLASS = '#3d6b9e'

// pixels outside a tile's outer outline, found by flooding in from the top
// and side edges over anything that is not the outline colour (not from the
// bottom: a door stands open to the ground there)
function background(p, outline = INK) {
  const seen = new Uint8Array(T * T), stack = []
  for (let i = 0; i < T; i++) stack.push([i, 0], [0, i], [T - 1, i])
  while (stack.length) {
    const [x, y] = stack.pop()
    if (x < 0 || y < 0 || x >= T || y >= T || seen[y * T + x]) continue
    const c = p.get(x, y)
    if (c && same(c, hex(outline))) continue
    seen[y * T + x] = 1
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  return (x, y) => !!seen[y * T + x]
}

// ==== plaster and timber facades =============================================
const PLASTER = {
  white: { L: '#f4f1e8', M: '#e3dccb', D: '#bfb5a0', sh: ['#5aa45e', '#2f6b3a'] },
  ochre: { L: '#fcd46a', M: '#eaae4a', D: '#b97f30', sh: ['#f4f1e8', '#bfb5a0'] },
  rose: { L: '#f8c6b8', M: '#e69a8e', D: '#b2685f', sh: ['#f4f1e8', '#bfb5a0'] },
  green: { L: '#bfe0cf', M: '#8fc2aa', D: '#5e8f7b', sh: [W2, W3] },
}
const TIMBER = { L: '#f4ecd8', M: '#e6dabf', D: '#c4b493', beam: W3, beamD: INK }

// a plaster wall cell: the fill with a few specks, Tiny Town's corner posts
function plasterWall(pal, { l = false, r = false } = {}) {
  const p = new Pic(T, T).rect(0, 0, T, T, pal.M)
  for (const [x, y, c] of [[3, 3, 'L'], [4, 3, 'L'], [11, 6, 'D'], [7, 9, 'L'], [13, 11, 'D'], [5, 12, 'D'], [9, 2, 'D']]) p.set(x, y, pal[c])
  // the floor's string course: a light ledge over its shadow
  p.hline(0, 15, 14, pal.L).hline(0, 15, 15, pal.D)
  if (l) for (let y = 0; y < T; y++) { p.set(0, y, INK); p.set(1, y, INK); p.set(2, y, pal.L); p.set(3, y, pal.L); p.set(4, y, y % 5 === 1 ? pal.D : pal.M) }
  if (r) for (let y = 0; y < T; y++) { p.set(15, y, INK); p.set(14, y, INK); p.set(13, y, pal.L); p.set(12, y, pal.L); p.set(11, y, pal.D) }
  return p
}
// a sash window between painted shutters
function shutteredWindow(p, pal, flowers = false) {
  p.rect(4, 2, 8, 11, INK)
  p.rect(5, 3, 6, 9, S1).rect(5, 8, 6, 4, S2).vline(7, 3, 11, W3).hline(5, 7, 7, W3).vline(8, 3, 11, W3)
  p.set(5, 3, WHITE).set(9, 4, WHITE)
  const [s1, s2] = pal.sh
  for (const x0 of [1, 12]) {
    p.rect(x0, 2, 3, 11, INK)
    p.vline(x0 + 1, 3, 11, s1)
    for (const y of [5, 9]) p.set(x0 + 1, y, s2)
  }
  p.hline(3, 12, 13, pal.L).hline(3, 12, 14, pal.D)
  if (flowers) addFlowerBox(p)
  return p
}
function addFlowerBox(p, y0 = 11) {
  p.map([
    '..rgyrrgygr.',
    '.ggrgggrggg.',
    'aaaaaaaaaaaa',
    'awwwwwwwwwWa',
    'aaaaaaaaaaaa',
  ], { a: INK, w: W2, W: W3, g: G3, r: RED, y: YEL }, 2, y0)
}
// a timber-frame cell: beams top and bottom, studs every eight pixels and a
// brace in each panel; `win` puts a window in, `door` a door
function timberWall({ l = false, r = false, win = false, flowers = false, door = false } = {}) {
  const t = TIMBER
  const p = new Pic(T, T).rect(0, 0, T, T, t.M)
  for (const [x, y] of [[4, 4], [12, 9], [10, 4], [5, 10]]) p.set(x, y, t.L)
  const beamH = y => { p.hline(0, 15, y, t.beam); p.hline(0, 15, y + 1, t.beamD) }
  const post = x => { p.vline(x, 0, 15, t.beam); p.vline(x + 1, 0, 15, t.beamD) }
  if (!win && !door) {
    post(0); post(8)
    // braces: / in the west panel, \ in the east
    for (let i = 0; i < 10; i++) { p.set(2 + Math.floor(i * 0.55), 12 - i, t.beam); p.set(3 + Math.floor(i * 0.55), 12 - i, t.beam); p.set(10 + Math.floor(i * 0.55), 3 + i, t.beam); p.set(11 + Math.floor(i * 0.55), 3 + i, t.beam) }
  } else if (win) {
    post(0); post(14)
    p.rect(3, 3, 10, 9, INK).rect(4, 4, 8, 7, S1).rect(4, 8, 8, 3, S2).vline(7, 4, 10, W3).vline(8, 4, 10, W3).hline(4, 11, 7, W3)
    p.set(4, 4, WHITE).set(9, 5, WHITE)
    p.hline(2, 13, 12, t.beam).hline(2, 13, 13, t.beamD)
    if (flowers) addFlowerBox(p, 10)
  } else {
    post(0); post(14)
    // a plank door under a lintel
    p.rect(3, 2, 10, 2, t.beam).hline(3, 12, 3, t.beamD)
    p.rect(4, 4, 8, 12, INK).rect(5, 5, 6, 11, W2)
    for (const x of [7, 9]) p.vline(x, 5, 15, W3)
    p.set(9, 10, S1).set(10, 10, INK)
  }
  beamH(0)
  beamH(14)
  if (l) { p.vline(0, 0, 15, INK); p.vline(1, 0, 15, INK); p.vline(2, 0, 15, t.beam); p.vline(3, 0, 15, t.beamD) }
  if (r) { p.vline(15, 0, 15, INK); p.vline(14, 0, 15, INK); p.vline(13, 0, 15, t.beam); p.vline(12, 0, 15, t.beamD) }
  return p
}
// Tiny Town's door (tile 85) set in another wall: its background becomes that wall
function doorIn(fill) {
  const d = srcTile('ow_house_door')
  const bg = background(d)
  const p = new Pic(T, T)
  const wall = fill
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) p.set(x, y, bg(x, y) ? wall.get(x, y) : d.get(x, y))
  // the door's arched frame in light stone instead of the wood
  p.each((c, x, y) => (!bg(x, y) && c && same(c, hex(W1))) ? S1 : (!bg(x, y) && c && same(c, hex(W2)) && (y < 3 || x < 3 || x > 12)) ? S2 : undefined)
  return p
}
// Tiny Town's window or wall with a flower box hung under it
function withFlowers(name) { const p = srcTile(name).clone(); addFlowerBox(p, 11); return p }

function drawFacades(put) {
  for (const [mat, pal] of Object.entries(PLASTER)) {
    const f = HOUSE_FRONT.walls[mat]
    put(f.l, plasterWall(pal, { l: true })); put(f.m, plasterWall(pal)); put(f.r, plasterWall(pal, { r: true }))
    put(f.win, shutteredWindow(plasterWall(pal), pal)); put(f.win2, shutteredWindow(plasterWall(pal), pal, true))
    const door = doorIn(plasterWall(pal))
    door.hline(0, 15, 14, null)
    put(f.door, door.each((c, x, y) => y >= 14 && !c ? (y === 14 ? pal.L : pal.D) : undefined))
  }
  const t = HOUSE_FRONT.walls.timber
  put(t.l, timberWall({ l: true })); put(t.m, timberWall()); put(t.r, timberWall({ r: true }))
  put(t.win, timberWall({ win: true })); put(t.win2, timberWall({ win: true, flowers: true })); put(t.door, timberWall({ door: true }))
  put(HOUSE_FRONT.walls.stone.win2, withFlowers('ow_house_win_stone'))
  put(HOUSE_FRONT.walls.wood.win2, withFlowers('ow_house_win_brown'))
}

// ==== shop fronts =============================================================
// The ground floor opened up: a striped awning over a painted shop front, a
// window of wares, the door.
const AWNING = { red: [RED, '#a8322a', WHITE, '#d9d2c4'], green: ['#5aa45e', '#2f6b3a', WHITE, '#d9d2c4'] }
function shopCell(kind, awn) {
  const [c1, c1d, c2, c2d] = AWNING[awn]
  const p = new Pic(T, T)
  // the front: green-black paintwork, a sill of stone
  p.rect(0, 0, T, T, W3)
  for (let y = 6; y < T; y++) { p.set(0, y, INK); p.set(15, y, INK) }
  if (kind === 'win') {
    p.rect(2, 7, 12, 7, INK).rect(3, 8, 10, 5, S2).rect(3, 8, 10, 2, S1)
    // wares on a shelf: loaves, pots, a bolt of cloth
    p.map(['.yy.rr.bb.', 'yoyrrrbbbw', 'aaaaaaaaaa'], { y: YEL, o: ORA, r: RED, b: GLASS, w: WHITE, a: W3 }, 3, 10)
    p.set(3, 8, WHITE).set(4, 8, WHITE).set(11, 9, WHITE)
    p.hline(1, 14, 14, S1).hline(1, 14, 15, S3)
  } else if (kind === 'door') {
    p.rect(4, 6, 8, 10, INK).rect(5, 7, 6, 9, W2).vline(8, 7, 15, W3).rect(5, 8, 6, 3, S1).vline(8, 8, 10, W3)
    p.set(10, 12, YEL)
  } else {
    // the ends: a carved pilaster
    const x0 = kind === 'l' ? 1 : 11
    p.rect(x0, 6, 4, 10, W2).vline(x0 + (kind === 'l' ? 0 : 3), 6, 15, W1).vline(x0 + (kind === 'l' ? 3 : 0), 6, 15, INK)
    p.rect(kind === 'l' ? 6 : 2, 7, 8, 7, INK).rect(kind === 'l' ? 7 : 3, 8, 6, 5, S2).rect(kind === 'l' ? 7 : 3, 8, 6, 2, S1)
    p.hline(1, 14, 14, S1).hline(1, 14, 15, S3)
    p.vline(kind === 'l' ? 0 : 15, 0, 15, INK)
  }
  // the awning: stripes three wide, a scalloped hem, its shadow
  for (let x = 0; x < T; x++) {
    const stripe = Math.floor(x / 3) % 2 === 0
    p.set(x, 0, INK)
    for (let y = 1; y <= 3; y++) p.set(x, y, stripe ? (y === 3 ? c1d : c1) : (y === 3 ? c2d : c2))
    p.set(x, 4, x % 3 === 1 ? (stripe ? c1d : c2d) : INK)
    p.set(x, 5, x % 3 === 1 ? INK : NAVY)
  }
  if (kind === 'l') for (let y = 0; y <= 5; y++) p.set(0, y, INK)
  if (kind === 'r') for (let y = 0; y <= 5; y++) p.set(15, y, INK)
  return p
}
function drawShops(put) {
  for (const awn of ['red', 'green']) for (const k of ['l', 'win', 'door', 'r']) put(HOUSE_FRONT.shop[awn][k], shopCell(k, awn))
}

// ==== roofs ===================================================================
// Tiny Town's red roof set (tiles 52-55, 64-67) in other colours: shingle
// browns and a dark slate. The stone ridge cap and the chimney stay.
const ROOF_COLOURS = {
  brown: ['#e0b07a', '#b8875a', '#8a5f3e'],
  dark: ['#9aa0bf', '#6a7092', '#4a4f6e'],
}
function drawRoofs(put) {
  const from = { l: 'ow_roof_red_l', m: 'ow_roof_red_m', r: 'ow_roof_red_r', chim: 'ow_roof_red_chim', el: 'ow_roof_red_el', em: 'ow_roof_red_em', er: 'ow_roof_red_er', gable: 'ow_roof_gable_red' }
  for (const [c, [hi, li, mid]] of Object.entries(ROOF_COLOURS)) {
    for (const [k, n] of Object.entries(from)) put(HOUSE_FRONT.roofs[c][k], srcTile(n).recolor([[R1, hi], [R2, li], [R3, mid]]))
  }
}

// ==== hanging signs ===========================================================
// An iron bracket from the wall at the top left, the sign's shape hung on two
// short chains below it, see-through round it.
const SIGNS = {
  baker: [['.aaa..aaa.', 'ayyya ayya', 'ayaoyayaoa', 'ayaayyaaya', '.ayyoyyya.', '..ayyoya..', '.ayaaaaya.', '.aya..aya.', '..a....a..'], { a: INK, y: YEL, o: ORA }],
  butcher: [['..........', '.aa...aaa.', 'appaaapppa', 'apppppppppa', 'aPpppppppPa', '.apppppppa.', '.aPaaaaaPa.', '.aa.....aa.'], { a: INK, p: R1, P: R2 }],
  cloth: [['.aaaaaaaa.', 'arrrrrrrra', 'aRRRRRRRRa', 'abbbbbbbba', 'aBBBBBBBBa', 'ayyyyyyyya', 'aooooooooa', '.aaaaaaaa.'], { a: INK, r: RED, R: '#a8322a', b: '#5a7fc4', B: '#3d5c99', y: YEL, o: ORA }],
  cooper: [['..aaaaaa..', '.asSSSSsa.', '.awwwwwwa.', 'aasSSSSsaa', 'awwwwwwwwa', 'aasSSSSsaa', '.awwwwwwa.', '.asSSSSsa.', '..aaaaaa..'], { a: INK, w: W2, s: S2, S: S3 }],
  apothecary: [['....aa....', '...awa....', '...aga....', '..aggga...', '.agggGga..', 'agwgggGga.', 'agggggGga.', '.aGGGGGa..', '..aaaaa...'], { a: INK, g: '#5ec47a', G: '#2f8a4f', w: WHITE }],
  inn: [['..........', '.....aaa..', 'a..aayyyaa', 'aaayyoyyyya', 'ayyyyyyyaya', 'aaayooyyyya', 'a..aayyyaa', '.....aaa..'], { a: INK, y: YEL, o: ORA }],
  smith: [['..........', 'aaaaaaaaa.', 'asssssssSa', '.aSssssSa.', '..aSSSSa..', '..asssSa..', '.asssssSa.', 'aaaaaaaaaa'], { a: INK, s: S2, S: S3 }],
}
function sign(kind) {
  const p = new Pic(T, T)
  // the bracket: a bar from the wall with a scroll under it
  p.hline(0, 13, 1, INK).hline(0, 12, 2, S3).set(0, 0, INK).set(0, 3, INK).set(1, 3, INK).set(2, 4, INK).set(3, 4, INK).set(4, 3, INK)
  const [rows, pal] = SIGNS[kind]
  const w = Math.max(...rows.map(r => r.length)), x0 = 3 + Math.floor((11 - w) / 2) + 1
  p.set(x0 + 1, 3, INK).set(x0 + w - 2, 3, INK)
  p.map(rows, pal, x0, 5 + (rows.length < 9 ? 1 : 0))
  return p
}
function drawSigns(put) { for (const k of Object.keys(SIGNS)) put(HOUSE_FRONT.signs[k], sign(k)) }

// ==== the church ==============================================================
// Whitewash with grey quoins, lancet windows of leaded glass, a door under a
// pointed arch, the tarred roof; the round apse to the east; the bell tower.
function whitewash(x, y) {
  const v = (x * 7 + y * 13) % 23
  return v === 0 ? CW[0] : v === 5 ? CW[2] : CW[1]
}
function churchWall({ lower = false, l = false, r = false } = {}) {
  const p = new Pic(T, T).each((_, x, y) => whitewash(x, y))
  if (lower) { p.hline(0, 15, 12, S1).hline(0, 15, 13, S4); for (let y = 14; y < T; y++) for (let x = 0; x < T; x++) p.set(x, y, x % 6 === 5 ? S4 : S2) }
  const quoin = east => {
    const X = x => east ? T - 1 - x : x
    for (let y = 0; y < (lower ? 12 : T); y++) {
      const block = Math.floor(y / 4), ry = y % 4, w = block % 2 ? 3 : 5
      p.set(X(0), y, INK)
      for (let x = 1; x <= w; x++) p.set(X(x), y, ry === 3 ? S3 : east ? S2 : S1)
      p.set(X(w + 1), y, S3)
    }
    if (lower) for (let y = 12; y < T; y++) p.set(X(0), y, INK)
  }
  if (l) quoin(false)
  if (r) quoin(true)
  return p
}
// the lancet window: the pointed head in the upper row, the foot in the lower
function lancet(p, lower) {
  const x0 = 5, x1 = 10
  for (let y = 0; y < T; y++) {
    if (!lower && y < 2) continue
    if (lower && y > 10) continue
    const yy = lower ? y + 16 : y
    let half = 3
    if (yy < 7) half = Math.max(0, Math.floor((yy - 2) * 0.62))
    const cx = 7.5
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      const d = Math.abs(x - cx)
      if (d > half + 1.5) continue
      if (d > half + 0.5) { p.set(x, y, S2); continue }
      // leaded lights: a diamond lattice, a little colour
      const lead = (x + yy) % 4 === 0 || (x - yy + 32) % 4 === 0
      p.set(x, y, lead ? S4 : ((x * 3 + yy * 5) % 11 === 0 ? RED : (x * 5 + yy) % 13 === 0 ? YEL : GLASS))
    }
  }
  if (!lower) p.set(7, 1, S2).set(8, 1, S2)
  if (lower) p.hline(4, 11, 11, S1).hline(4, 11, 12, S4)
  return p
}
function churchDoor() {
  const p = new Pic(2 * T, 2 * T)
  for (let y = 0; y < 2 * T; y++) for (let x = 0; x < 2 * T; x++) p.set(x, y, whitewash(x, y))
  p.hline(0, 31, 28, S1).hline(0, 31, 29, S4)
  for (let y = 30; y < 2 * T; y++) for (let x = 0; x < 2 * T; x++) p.set(x, y, x % 6 === 5 ? S4 : S2)
  // a pointed arch of grey stone in steps, the oak door under it
  const cx = 15.5
  for (let y = 6; y < 2 * T; y++) for (let x = 4; x <= 27; x++) {
    const d = Math.abs(x - cx)
    const lim = y < 18 ? (y - 6) * 1.0 + 0.5 : 12
    if (d > lim) continue
    const inner = y < 18 ? (y - 10) * 1.0 : 8
    if (d > inner || y < 10) p.set(x, y, (d > lim - 1.5) ? INK : ((x + y) % 4 === 0 ? S3 : S1))
    else p.set(x, y, (Math.round(x - cx + 0.5) % 3 === 0) ? W3 : (x < cx ? W2 : shade(hex(W2), 1)))
  }
  for (let y = 12; y < 2 * T; y++) { p.set(15, y, INK); p.set(16, y, W3) }
  for (const y of [18, 25]) { p.hline(8, 14, y, INK); p.hline(17, 23, y, INK) }
  p.set(13, 22, YEL).set(18, 22, YEL)
  p.hline(4, 27, 2 * T - 1, INK)
  return p
}
// the rounded east end, laid with its lower row beside the nave's lower row:
// a half-round wall whose foot and top rise as it turns away to the east,
// under a half cone of shingles lower than the nave's roof
function apse() {
  const W_ = 2 * T, Hh = 5 * T
  const p = new Pic(W_, Hh)
  const rise = x => Math.round(13 * (1 - Math.sqrt(Math.max(0, 1 - (x / 31.5) ** 2))))
  for (let x = 0; x < W_; x++) {
    const yb = Hh - 1 - rise(x), yt = Hh - 31 - rise(x)
    const k = x < 11 ? 0 : x < 21 ? 1 : x < 28 ? 2 : 3
    for (let y = yt; y <= yb; y++) {
      let c = y >= yb - 3 ? (y === yb - 3 ? S1 : y === yb ? INK : S2) : hex(whitewash(x, y))
      if (y < yb - 3) c = k === 0 ? c : hex(k === 1 ? CW[1] : k === 2 ? CW[2] : '#9a9080')
      else if (k > 1 && y > yb - 3 && y < yb) c = shade(hex(S2), k - 1)
      p.set(x, y, c)
    }
    p.set(x, yb, INK)
  }
  for (let y = Hh - 31 - rise(31); y <= Hh - 1 - rise(31); y++) p.set(31, y, INK)
  // a narrow lancet facing south
  const ly = Hh - 26
  for (let y = ly; y < ly + 15; y++) for (let x = 6; x <= 9; x++) p.set(x, y, (y === ly && (x === 6 || x === 9)) ? S2 : GLASS)
  p.vline(5, ly + 1, ly + 14, S2).vline(10, ly + 1, ly + 14, S3).hline(5, 10, ly + 15, S1).set(7, ly + 4, YEL).set(8, ly + 9, RED)
  // the half cone: from its tip against the nave's gable, down to an eave
  // that rises with the wall as it turns away
  const ay = T + 6
  for (let x = 0; x < W_; x++) {
    const ye = Hh - 32 - rise(x), ys = Math.round(ay + (ye - 3 - ay) * (x / 31.5) ** 1.6)
    const k = x < 11 ? 0 : x < 21 ? 1 : 2
    for (let y = ys; y <= ye + 1; y++) {
      const course = Math.floor((ye - y) / 3), ry = (ye - y) % 3
      const sx = (x + (course % 2) * 2) % 4
      let c = ry === 2 ? TAR[2] : (ry === 0 && (sx === 0 || sx === 3)) ? TAR[2] : TAR[0]
      c = TAR[Math.min(4, TAR.indexOf(c) + k)]
      if (y === ys) c = INK
      if (y === ye) c = TAR[0]
      if (y === ye + 1) c = INK
      p.set(x, y, c)
    }
  }
  for (let y = 0; y < Hh; y++) if (p.get(31, y) && y < Hh - 31 - rise(31)) p.set(31, y, INK)
  return p
}
// the bell tower: a shingled spire with a gilt cross, the bell in its opening,
// a whitewashed shaft with a rose window
function belltower() {
  const W_ = 3 * T, Hh = 7 * T   // spire 3 rows, belfry, body, rose, base
  const p = new Pic(W_, Hh)
  const cx = (W_ - 1) / 2
  // the shaft: rows 3..6
  for (let y = 3 * T; y < Hh; y++) for (let x = 1; x < W_ - 1; x++) p.set(x, y, whitewash(x, y))
  for (let y = 3 * T; y < Hh; y++) {
    const block = Math.floor(y / 4), ry = y % 4, w = block % 2 ? 3 : 5
    p.set(0, y, INK); p.set(W_ - 1, y, INK)
    for (let i = 1; i <= w; i++) { p.set(i, y, ry === 3 ? S3 : S1); p.set(W_ - 1 - i, y, ry === 3 ? S3 : S2) }
    p.set(w + 1, y, S3); p.set(W_ - 2 - w, y, S3)
    for (let x = Math.round(cx) + 6; x < W_ - 2 - w; x++) { const c = p.get(x, y); if (c && same(c, hex(CW[1]))) p.set(x, y, CW[2]) }
  }
  // the belfry's opening and its bell (row 3)
  const by = 3 * T
  for (let y = by + 2; y < by + T; y++) for (let x = 15; x <= 32; x++) {
    const d = Math.abs(x - cx), lim = y < by + 8 ? Math.sqrt(Math.max(0, 81 - (by + 8 - y) ** 2 * 1.6)) : 9
    if (d > lim + 1) continue
    p.set(x, y, d > lim ? S1 : NAVY)
  }
  p.map([
    '....aa....',
    '...ayya...',
    '..ayyoya..',
    '..ayyooa..',
    '.ayyyoooa.',
    'ayyyyyoooa',
    'aaaaaaaaaa',
    '....aa....',
  ], { a: INK, y: YEL, o: ORA }, Math.round(cx) - 5, by + 5)
  p.hline(14, 33, by + T - 1, S1)
  // the rose window (row 5)
  const ry0 = 5 * T + 8
  for (let y = ry0 - 7; y <= ry0 + 7; y++) for (let x = Math.round(cx) - 7; x <= Math.round(cx) + 7; x++) {
    const d = Math.hypot(x - cx, y - ry0)
    if (d > 7.2) continue
    if (d > 5.6) { p.set(x, y, d > 6.6 ? INK : S1); continue }
    const a = Math.atan2(y - ry0, x - cx), petal = Math.floor((a + Math.PI) / (Math.PI / 3)) % 2
    p.set(x, y, d < 1.6 ? YEL : (Math.abs(((a + Math.PI) / (Math.PI / 3)) % 1 - 0.5) > 0.42 ? S4 : petal ? RED : GLASS))
  }
  // the base (row 6): a plinth and a slit
  p.hline(1, W_ - 2, Hh - 5, S1).hline(1, W_ - 2, Hh - 4, S4)
  for (let y = Hh - 3; y < Hh; y++) for (let x = 1; x < W_ - 1; x++) p.set(x, y, x % 6 === 5 ? S4 : S2)
  // the spire (rows 0..2): eight-sided, three faces seen, courses of shingles,
  // narrower than the tower, a broach skirt flaring over its top
  const ay = 9, ey = 3 * T - 5, base = 15
  for (let y = ay; y <= ey; y++) {
    const t = (y - ay) / (ey - ay), half = 0.5 + t * (base - 0.5)
    for (let x = 0; x < W_; x++) {
      const u = (x - cx) / half
      if (Math.abs(u) > 1) continue
      const face = u < -0.4 ? 0 : u > 0.4 ? 2 : 1
      const course = Math.floor((ey - y) / 3), ryy = (ey - y) % 3
      const sx = Math.floor((u + 1) * (1.5 + t * 4) + (course % 2) * 0.5) % 2
      let c = ryy === 2 ? TAR[2] : (sx && ryy === 0) ? TAR[2] : TAR[0]
      c = TAR[Math.min(4, TAR.indexOf(c) + face)]
      p.set(x, y, c)
    }
  }
  for (let y = ay; y <= ey; y++) for (let x = 0; x < W_; x++) if (p.get(x, y) && (!p.get(x - 1, y) || !p.get(x + 1, y))) p.set(x, y, INK)
  // the broach: a low skirt of shingles over the tower's top, the full width
  for (let y = ey - 3; y <= 3 * T - 1; y++) for (let x = 0; x < W_; x++) {
    const d = Math.abs(x - cx), lim = base + (y - (ey - 3)) * 3.2
    if (d > Math.min(lim, W_ / 2)) continue
    const k = x < cx - base ? 0 : x > cx + base ? 2 : 1
    p.set(x, y, y === 3 * T - 1 ? INK : (y - ey) % 2 === 0 ? TAR[1 + k] : TAR[k])
  }
  for (let y = ey - 3; y <= 3 * T - 1; y++) for (let x = 0; x < W_; x++) if (p.get(x, y) && y < 3 * T - 1 && (!p.get(x, y - 1)) && Math.abs(x - cx) > base - 1) p.set(x, y, INK)
  // the gilt cross on its ball
  const tx = Math.round(cx)
  p.map([
    '..a..',
    '.aya.',
    'aayaa',
    'ayyya',
    'aayaa',
    '.aya.',
    '.aya.',
    'aaYaa',
    '.aYa.',
  ], { a: INK, y: YEL, Y: ORA }, tx - 2, 0)
  return p
}
function drawChurch({ put, putGrid, putRow }) {
  for (const part of ['ridge', 'slope', 'eave']) CHURCH.roof[part].forEach((n, i) => put(n, roofRow(part, ['l', 'm', 'r'][i], TAR, true)))
  put(CHURCH.upper.l, churchWall({ l: true })); put(CHURCH.upper.m, churchWall()); put(CHURCH.upper.r, churchWall({ r: true }))
  put(CHURCH.upper.win, lancet(churchWall(), false))
  put(CHURCH.lower.l, churchWall({ lower: true, l: true })); put(CHURCH.lower.m, churchWall({ lower: true })); put(CHURCH.lower.r, churchWall({ lower: true, r: true }))
  put(CHURCH.lower.win, lancet(churchWall({ lower: true }), true))
  const d = churchDoor()
  putRow(CHURCH.upper.doorTop, d.crop(0, 0, 2 * T, T)); putRow(CHURCH.lower.door, d.crop(0, T, 2 * T, T))
  const a = apse()
  ;['ridge', 'slope', 'eave', 'upper', 'lower'].forEach((part, row) => putRow(CHURCH.apse[part], a.crop(0, row * T, 2 * T, T)))
  const b = belltower()
  putGrid(CHURCH.tower.spire, b.crop(0, 0, 3 * T, 3 * T))
  putRow(CHURCH.tower.belfry, b.crop(0, 3 * T, 3 * T, T))
  putRow(CHURCH.tower.body, b.crop(0, 4 * T, 3 * T, T))
  putRow(CHURCH.tower.rose, b.crop(0, 5 * T, 3 * T, T))
  putRow(CHURCH.tower.base, b.crop(0, 6 * T, 3 * T, T))
}

export function draw(ctx) {
  drawFacades(ctx.put)
  drawShops(ctx.put)
  drawRoofs(ctx.put)
  drawSigns(ctx.put)
  drawChurch(ctx)
}
