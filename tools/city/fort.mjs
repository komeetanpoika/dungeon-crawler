// Walls, towers, gates and the castle gate of Kalevanlinna's tile kit.
import { Pic, T, hex, same } from './lib.mjs'
import { INK, NAVY, S1, S2, S3, S4, W1, W2, W3, G1, G2, G3, RED, YEL, ORA, WHITE, CYAN, shade, RED_ROOF, DARK_ROOF, srcTile, tex, brickAt } from './common.mjs'
import { WALL, TOWER, GATE, CASTLE, HARBOUR } from '../../renderer/wilds/city/kit.js'

// ==== the curtain wall ========================================================
// The wall walk seen from above, after Tiny Town's parapet (tile 100): a band
// of merlons along each side with no wall beyond it, a light walk between.
const N = 1, E = 2, S = 4, Wb = 8
const cren = x => x % 4 === 1 || x % 4 === 2
// the north band, rows 0..6, and the south band, rows 10..15
const northBand = (x, y) => y < 2 ? INK : y === 2 ? (cren(x) ? INK : S1) : y === 3 ? (cren(x) ? S3 : S1) : y === 4 ? (cren(x) ? S3 : S2) : S2
// a vertical run of merlons, by row
const vMerlon = y => y % 4 === 1 ? S2 : y % 4 === 2 ? S3 : S1
const crenCol = y => [INK, S3, S3, S2, S2][Math.min(4, y)]   // the corner's gap column, from the band's first row

function wallTop(m) {
  const p = new Pic(T, T).rect(0, 0, T, T, S1)
  const nE = !(m & N), sE = !(m & S), wE = !(m & Wb), eE = !(m & E)
  for (let x = 0; x < T; x++) {
    if (nE) for (let y = 0; y <= 6; y++) p.set(x, y, northBand(x, y))
    if (sE) for (let y = 10; y <= 15; y++) p.set(x, y, y <= 13 ? northBand(x, y - 8) : S2)
  }
  // a band down the west (mirrored for the east) side
  const side = (east) => {
    const X = x => east ? T - 1 - x : x
    for (let y = 0; y < T; y++) {
      const inN = nE && y <= 6, inS = sE && y >= 10
      if (nE && y < 2) { for (let x = 0; x <= 4; x++) p.set(X(x), y, INK); continue }
      p.set(X(0), y, INK); p.set(X(1), y, INK)
      let v = vMerlon(y)
      if (inN) v = [S1, S1, S2, S2, S3][y - 2]
      if (inS && y >= 14) v = S2
      p.set(X(2), y, v); p.set(X(3), y, v)
      p.set(X(4), y, inN ? crenCol(y - 2) : inS ? crenCol(y === 11 ? 0 : y - 10) : INK)
    }
    // the outer corner is rounded off
    if (nE) p.set(X(0), 0, null)
  }
  if (wE) side(false)
  if (eE) side(true)
  // an inner corner, where both sides beside it run on as wall: the corner
  // post of the two parapets that meet there
  const post = (east, south) => {
    const X = x => east ? T - 1 - x : x
    const rows = south ? [10, 11, 12, 13, 14, 15] : [0, 1, 2, 3, 4, 5, 6]
    for (const y of rows) for (let x = 0; x <= 4; x++) {
      const ly = south ? y - 8 : y
      let c = ly < 2 ? INK : ly === 2 ? (x === 4 ? INK : S1) : ly === 3 ? (x === 4 ? INK : S1) : ly === 4 ? (x === 4 ? INK : S2) : S2
      if (south && y >= 14) c = x === 4 ? S3 : S2
      p.set(X(x), y, c)
    }
  }
  if (!nE && !wE) post(false, false)
  if (!nE && !eE) post(true, false)
  if (!sE && !wE) post(false, true)
  if (!sE && !eE) post(true, true)
  return p
}
function face({ lower = false, l = false, r = false, variant = 0 } = {}) {
  const p = new Pic(T, T).each((_, x, y) => brickAt(x + variant * 5, y + (variant ? 4 : 0)))
  if (variant === 1) {   // a weathered patch: a few stones a shade down, a tuft of moss at the foot
    p.each((c, x, y) => (x >= 3 && x <= 9 && y >= 5 && y <= 10 && same(c, hex(S2))) ? shade(c, 1) : undefined)
  }
  if (lower) {
    // the plinth: a light ledge, then big footing stones
    p.hline(0, 15, 11, S1).hline(0, 15, 12, S4)
    for (let x = 0; x < T; x++) for (let y = 13; y < T; y++) p.set(x, y, (x % 8 === 7) ? S4 : y === 13 ? S2 : S3)
    if (variant === 1) { p.set(4, 13, G3).set(5, 13, G1).set(5, 12, G3).set(11, 14, G3) }
  }
  const quoin = (east) => {
    const X = x => east ? T - 1 - x : x
    for (let y = 0; y < T; y++) {
      p.set(X(0), y, INK)
      const block = Math.floor(y / 4), ry = y % 4
      const wide = block % 2 === 0
      const w = wide ? 5 : 3
      for (let x = 1; x <= w; x++) p.set(X(x), y, ry === 0 ? S4 : x === 1 ? S2 : S1)
      if (ry !== 0) p.set(X(w + 1), y, S4)
    }
  }
  if (l) quoin(false)
  if (r) quoin(true)
  return p
}
const slit = () => {
  const p = face()
  p.rect(6, 2, 4, 11, S1).rect(7, 3, 2, 9, NAVY).set(7, 3, INK).set(8, 3, INK).hline(6, 9, 13, S4).hline(5, 10, 2, S4)
  return p
}
export function cylinder(p, x0, w, y0, h, { baseArc = true } = {}) {
  const cx = x0 + (w - 1) / 2, r = w / 2
  for (let x = x0; x < x0 + w; x++) {
    const dx = (x - cx) / r
    const tx = Math.floor((Math.asin(Math.max(-1, Math.min(1, dx))) + Math.PI / 2) * r)
    const k = dx < -0.6 ? -1 : dx < 0.2 ? 0 : dx < 0.62 ? 1 : 2
    for (let y = y0; y < y0 + h; y++) {
      let c = tex(srcTile('ow_brick'), tx, y)
      c = k < 0 ? (same(c, hex(S2)) ? hex(S1) : c) : shade(c, k)
      p.set(x, y, c)
    }
  }
  // outline down both sides
  p.vline(x0, y0, y0 + h - 1, INK).vline(x0 + w - 1, y0, y0 + h - 1, INK)
  if (baseArc) {
    // the foot: a plinth whose front edge curves down toward the viewer
    const yb = y0 + h - 1
    for (let x = x0; x < x0 + w; x++) {
      const dx = (x - cx) / r
      const drop = Math.round(3 * (1 - Math.sqrt(Math.max(0, 1 - dx * dx))))   // 0 at the middle, 3 at the sides
      for (let y = yb - drop + 1; y <= yb; y++) p.set(x, y, null)
      const k = dx < -0.6 ? 0 : dx < 0.2 ? 1 : dx < 0.62 ? 2 : 3
      p.set(x, yb - drop, INK)
      p.set(x, yb - drop - 1, shade(hex(S2), k))
      p.set(x, yb - drop - 2, shade(hex(S2), k))
      p.set(x, yb - drop - 3, shade(hex(S1), k))
      p.set(x, yb - drop - 4, shade(hex(S4), Math.max(0, k - 1)))
    }
  }
}
// rings of shingles round a cone: apex (cx, ay), eave ellipse centred (cx, ey) with radii rx, ry
function cone(p, cx, ay, ey, rx, ry, pal) {
  const H = ey - ay
  const [hi, li, mid] = pal
  for (let y = ay; y <= ey + ry; y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const u = x - cx, v = y - ay
    // which ring (0 apex .. 1 eave) passes through this pixel, on the front half
    const g = t => (u / rx) ** 2 + ((v - t * H) / ry) ** 2 - t * t
    let lo = 0, hiT = Math.min(1, v / H)
    if (v <= 0 || g(hiT) > 0) {
      // not on the front half of any ring: the back half shows above it near the tip
      if (y > ey) continue
      const half = rx * v / H
      if (Math.abs(u) > half + 0.5) continue
      lo = v / H; hiT = lo
    } else {
      for (let i = 0; i < 30; i++) { const mt = (lo + hiT) / 2; if (g(mt) > 0) lo = mt; else hiT = mt }
    }
    const t = (lo + hiT) / 2
    if (t > 1.0001) continue
    const ringH = 3.4
    const ring = Math.floor(t * H / ringH), ry0 = (t * H / ringH) - ring
    const phi = Math.atan2(Math.max(0, v - t * H) / ry, u / rx)   // 0 right .. pi left, front half
    const around = phi * Math.max(3, t * rx * 0.9)
    const col = Math.floor(around / 3.2 + (ring % 2) * 0.5), cx0 = (around / 3.2 + (ring % 2) * 0.5) - col
    // Tiny Town's shingles (tile 53): faces of the light tone, a lighter rim
    // round the foot of each, the mid tone in the joints between
    let c = li
    if (ry0 > 0.78 || cx0 > 0.86) c = mid
    else if (ry0 > 0.5 && cx0 > 0.12 && cx0 < 0.74) c = hi
    // light from the left: the right side a step or two down
    const lit = Math.cos(phi - 2.5)
    const k = lit > -0.15 ? 0 : lit > -0.7 ? 1 : 2
    c = shade(hex(c), k)
    p.set(x, y, c)
  }
}

function roundTower(w, rows) {
  const W_ = w * T, Hh = rows * T
  const p = new Pic(W_, Hh)
  const bodyX = 2, bodyW = W_ - 4
  // body from under the eave to the foot
  cylinder(p, bodyX, bodyW, 26, Hh - 26)
  // the cone and its eave ring
  const c = new Pic(W_, Hh)
  const cx = (W_ - 1) / 2, rx = W_ / 2 - 0.5, ry = w === 3 ? 4.5 : 5.5
  const ey = 25, ay = w === 3 ? 4 : 3
  cone(c, cx, ay, ey, rx, ry, RED_ROOF)
  // outline the cone (only over the cap rows: the body has its own)
  const o = []
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W_; x++) {
    if (c.get(x, y)) continue
    if (c.get(x - 1, y) || c.get(x + 1, y) || c.get(x, y - 1) || c.get(x, y + 1)) o.push([x, y])
  }
  // shadow of the eave on the body
  for (let x = bodyX; x < bodyX + bodyW; x++) {
    let ye = -1
    for (let y = Hh - 1; y >= 0; y--) if (c.get(x, y)) { ye = y; break }
    if (ye >= 0) for (let y = ye + 1; y <= ye + 2; y++) { const b = p.get(x, y); if (b) p.set(x, y, shade(b, 2)) }
  }
  p.blit(c)
  for (const [x, y] of o) if (y < 32) p.set(x, y, INK)
  // a finial at the tip
  const tx = Math.round(cx)
  p.set(tx, ay - 1, INK).set(tx - 1, ay - 2, INK).set(tx, ay - 2, YEL).set(tx - 1, ay - 3, null).set(tx, ay - 3, INK)
  p.set(tx - 1, ay - 1, INK)
  // a window slit in the body
  const sx = Math.round(cx) - 2, sy = 26 + Math.max(2, Math.floor((Hh - 26) / 2) - 5)
  p.rect(sx, sy, 4, 7, S1).rect(sx + 1, sy + 1, 2, 5, NAVY).hline(sx, sx + 3, sy + 7, S4)
  return p
}
function squareTower(w, rows, roofPal = DARK_ROOF) {
  const W_ = w * T, Hh = rows * T
  const p = new Pic(W_, Hh)
  // body: brick with quoins at both corners
  const bx0 = 2, bx1 = W_ - 3, by0 = 24
  for (let y = by0; y < Hh; y++) for (let x = bx0; x <= bx1; x++) p.set(x, y, brickAt(x, y))
  for (let y = by0; y < Hh; y++) {
    const block = Math.floor((y - by0) / 4), ry = (y - by0) % 4, wd = block % 2 ? 3 : 5
    for (let i = 1; i <= wd; i++) { p.set(bx0 + i, y, ry === 0 ? S4 : S1); p.set(bx1 - i, y, ry === 0 ? S4 : shade(hex(S1), 1)) }
    p.set(bx0 + wd + 1, y, S4); p.set(bx1 - wd - 1, y, S4)
    // the right-hand face of the stone a step down for the light
    for (let x = Math.floor(W_ / 2) + 6; x < bx1 - wd - 1; x++) { const c = p.get(x, y); if (c && !same(c, hex(S4))) p.set(x, y, shade(c, 0)) }
  }
  p.vline(bx0, by0, Hh - 1, INK).vline(bx1, by0, Hh - 1, INK)
  // the plinth
  p.hline(bx0, bx1, Hh - 5, S1).hline(bx0 - 1, bx1 + 1, Hh - 4, S4)
  for (let y = Hh - 3; y < Hh; y++) for (let x = bx0 - 1; x <= bx1 + 1; x++) p.set(x, y, (x - bx0) % 8 === 7 ? S4 : y === Hh - 3 ? S2 : S3)
  p.vline(bx0 - 1, Hh - 4, Hh - 1, INK).vline(bx1 + 1, Hh - 4, Hh - 1, INK).hline(bx0 - 1, bx1 + 1, Hh - 1, INK)
  // the hip roof: a front face, the two sides as slivers, rows of shingles
  const [hi, li, mid, dk, deep] = roofPal
  const cx = (W_ - 1) / 2, ay = 3, ey = 25, backY = 17
  for (let y = ay; y <= ey; y++) for (let x = 0; x < W_; x++) {
    const u = x - cx
    const front = Math.abs(u) <= (W_ / 2) * (y - ay) / (ey - ay)
    const sideLim = y <= backY ? (W_ / 2) * (y - ay) / (backY - ay) : W_ / 2
    if (Math.abs(u) > sideLim + 0.01) continue
    const ry = (y - ay) % 4, rx = (x + (Math.floor((y - ay) / 4) % 2) * 2) % 4
    let c = ry === 3 ? (rx === 0 ? deep : dk) : (ry === 0 && rx === 1) ? hi : li
    if (!front) c = u < 0 ? (ry === 3 ? mid : hi) : (ry === 3 ? deep : dk)
    else if (u > W_ / 4) c = shade(hex(c), 1)
    p.set(x, y, c)
  }
  // hips and the outline
  for (let y = ay; y <= ey; y++) {
    const half = (W_ / 2) * (y - ay) / (ey - ay)
    p.set(Math.round(cx - half), y, li); p.set(Math.round(cx + half), y, deep)
  }
  const o = []
  for (let y = 0; y <= ey + 1; y++) for (let x = 0; x < W_; x++) {
    if (p.get(x, y) && y <= ey) continue
    if (y > ey) { if (p.get(x, y - 1) && x >= 1 && x <= W_ - 2) o.push([x, y]); continue }
    if (p.get(x - 1, y) || p.get(x + 1, y) || p.get(x, y + 1) || p.get(x, y - 1)) o.push([x, y])
  }
  for (const [x, y] of o) p.set(x, y, INK)
  for (let x = 0; x < W_; x++) { p.set(x, ey, INK); p.set(x, ey + 1, S4) }
  p.set(0, ey, null); p.set(W_ - 1, ey, null)
  for (let y = backY; y <= ey; y++) { p.set(0, y, INK); p.set(W_ - 1, y, INK) }
  // a finial and a slit
  const tx = Math.round(cx)
  p.set(tx, ay - 1, INK).set(tx, ay - 2, YEL).set(tx, ay - 3, INK)
  const sx = tx - 2, sy = by0 + 3 + Math.max(0, Math.floor((Hh - by0 - 8) / 2) - 3)
  p.rect(sx, sy, 4, 7, S1).rect(sx + 1, sy + 1, 2, 5, NAVY).hline(sx, sx + 3, sy + 7, S4)
  return p
}
function archFace(rows, { portcullis = false } = {}) {
  const Wd = 3 * T, Hh = rows * T
  const p = new Pic(Wd, Hh).each((_, x, y) => brickAt(x + 3, y))
  // the parapet: Tiny Town's merlons along the top, its face under them
  for (let x = 0; x < Wd; x++) for (let y = 0; y < 6; y++) p.set(x, y, y < 2 ? INK : y === 2 ? (cren(x) ? INK : S1) : y === 3 ? (cren(x) ? S3 : S1) : y === 4 ? (cren(x) ? S3 : S2) : S2)
  p.hline(0, Wd - 1, 6, S4).hline(0, Wd - 1, 7, S1).hline(0, Wd - 1, 8, S4)   // a string course
  const cx = (Wd - 1) / 2, x0 = 7, x1 = Wd - 8, rx = (x1 - x0) / 2 + 0.5
  const spring = Hh - (rows === 2 ? 12 : 16), ry = spring - (rows === 2 ? 12 : 14)
  const inOpen = (x, y) => x >= x0 && x <= x1 && (y >= spring || ((x - cx) / rx) ** 2 + ((y - spring) / ry) ** 2 <= 1)
  const ringT = 4
  for (let y = 0; y < spring; y++) for (let x = x0 - ringT; x <= x1 + ringT; x++) {
    if (inOpen(x, y)) continue
    const d = ((x - cx) / (rx + ringT)) ** 2 + ((y - spring) / (ry + ringT)) ** 2
    if (d > 1) continue
    // the voussoirs: blocks between radial joints, a dark line round the outside
    const ang = Math.atan2(spring - y, x - cx), step = Math.PI / 11
    const joint = Math.abs(ang / step - Math.round(ang / step)) < 0.12
    const outer = ((x - cx) / (rx + ringT + 1)) ** 2 + ((y - spring) / (ry + ringT + 1)) ** 2 > 0.8 && d > 0.86
    p.set(x, y, outer ? INK : joint ? S4 : (x < cx - 4 ? S1 : x > cx + 6 ? S2 : S1))
  }
  // the keystone, standing proud of the ring
  const kx = Math.round(cx), ky = Math.round(spring - ry - ringT) - 1
  p.rect(kx - 2, ky, 5, ringT + 3, S1).hline(kx - 2, kx + 2, ky, WHITE).vline(kx + 2, ky + 1, ky + ringT + 2, S2)
  p.hline(kx - 3, kx + 3, ky - 1, INK).vline(kx - 3, ky, ky + ringT + 2, INK).vline(kx + 3, ky, ky + ringT + 2, INK)
  // the opening: the vault's soffit in the dark, then see-through
  for (let y = 0; y < Hh; y++) for (let x = x0; x <= x1; x++) {
    if (!inOpen(x, y)) continue
    let depth = 0; while (depth < 6 && inOpen(x, y - depth - 1)) depth++
    p.set(x, y, depth === 0 ? NAVY : depth <= 2 ? INK : null)
  }
  // the jambs: the passage side in shadow, a dark edge
  for (let y = spring - 2; y < Hh; y++) {
    p.set(x0 - 1, y, NAVY); p.set(x1 + 1, y, NAVY)
    p.set(x0 - 2, y, S3); p.set(x1 + 2, y, S4)
  }
  // springers: a light block where the ring meets each jamb
  for (const sx of [x0 - ringT - 1, x1 + 2]) p.rect(sx, spring - 1, ringT, 3, S1).hline(sx, sx + ringT - 1, spring + 2, S4)
  if (portcullis) {
    // let down: oak bars bound with iron, its teeth in the ground
    for (let y = 0; y < Hh; y++) for (let x = x0; x <= x1; x++) {
      if (!inOpen(x, y)) continue
      const bar = (x - x0) % 6 === 2 || (x - x0) % 6 === 3, rail = (y - spring) % 7 === 3 || (y - spring) % 7 === 4
      if (bar && rail) p.set(x, y, S2)
      else if (bar) p.set(x, y, (x - x0) % 6 === 2 ? W2 : W3)
      else if (rail) p.set(x, y, (y - spring) % 7 === 3 ? S3 : S4)
      else if (!p.get(x, y)) p.set(x, y, NAVY)
    }
  }
  return p
}

export function draw(ctx) {
  const { put, putGrid, putRow } = ctx
  drawHarbour(ctx)
  drawCastle(ctx)
  WALL.top.forEach((n, m) => put(n, wallTop(m)))

  // The face: Tiny Town's brick (tile 126). Ends get an outline and quoins;
  // the lower row stands on a plinth.
  put(WALL.upper.l, face({ l: true })); put(WALL.upper.m, face()); put(WALL.upper.r, face({ r: true }))
  put(WALL.upper.lr, face({ l: true, r: true })); put(WALL.upper.m2, face({ variant: 1 })); put(WALL.upper.slit, slit())
  put(WALL.lower.l, face({ lower: true, l: true })); put(WALL.lower.m, face({ lower: true })); put(WALL.lower.r, face({ lower: true, r: true }))
  put(WALL.lower.lr, face({ lower: true, l: true, r: true })); put(WALL.lower.m2, face({ lower: true, variant: 1 }))

  // ==== towers ==================================================================
  // A round tower is a cylinder of Tiny Town's brick, mapped round so the
  // joints close up toward its sides, lit from the left; its roof a cone of
  // red shingles in rings. A square tower: a flat face with quoins under a
  // slate hip roof.
  for (const [kind, w, fn] of [['round3', 3, roundTower], ['round4', 4, roundTower], ['square3', 3, squareTower], ['square4', 4, squareTower]]) {
    const t = TOWER[kind]
    const tall = fn(w, 4)               // cap, body, base
    putGrid(t.cap, tall.crop(0, 0, w * T, 2 * T))
    putRow(t.body, tall.crop(0, 2 * T, w * T, T))
    putRow(t.base, tall.crop(0, 3 * T, w * T, T))
  }

  // ==== land gates ==============================================================
  // An arch of light voussoirs with a keystone in Tiny Town's brick, merlons
  // along the top edge (it stands in the wall-top row), the passage see-through
  // so the street shows, the vault dark above it.
  putGrid(GATE.arch2, archFace(2))
  putGrid(GATE.arch3, archFace(3))
  putGrid(CASTLE.gate2, archFace(2, { portcullis: true }))
  putGrid(CASTLE.gate3, archFace(3, { portcullis: true }))
  // a gate in a north-south wall, from above: the road under the vault, the
  // arches at either end seen from above as stone bands, the vault's shadow
  {
    const p = new Pic(T, 3 * T)
    for (let y = 0; y < 3 * T; y++) for (let x = 0; x < T; x++) {
      const X = Math.min(x, T - 1 - x), east = x > 7
      if (X === 0) p.set(x, y, INK)
      else if (X <= 2) p.set(x, y, y % 4 === 0 ? S4 : X === 1 ? (east ? S2 : S1) : (east ? S3 : S2))
      else if (X === 3) p.set(x, y, NAVY)
      else p.set(x, y, [38, 43, 68, y < 4 ? 140 - y * 20 : 60])   // shadow, deeper under the tower to the north
    }
    GATE.side.forEach((n, i) => put(n, p.cell(0, i)))
  }


}

// ==== the harbour ============================================================
// A round tower with an open battlemented head, a beacon basket on it, the
// chain's ring on either side of its foot.
function harbourTower() {
  const W_ = 3 * T, Hh = 4 * T
  const p = new Pic(W_, Hh)
  const cx = (W_ - 1) / 2
  cylinder(p, 2, W_ - 4, 14, Hh - 14)
  // the head seen from above: a ring of merlons round a flagged floor
  const ey = 11, rx = 23, ry = 9, irx = 15.5, iry = 5
  const inE = (x, y, a, b) => ((x - cx) / a) ** 2 + ((y - ey) / b) ** 2 <= 1
  for (let y = 0; y < 26; y++) for (let x = 0; x < W_; x++) {
    if (!inE(x, y, rx, ry)) continue
    if (inE(x, y, irx, iry)) { p.set(x, y, ((x + 1) % 6 === 0 || y % 4 === 0) ? S3 : S2); continue }
    const ang = Math.atan2((y - ey) / ry, (x - cx) / rx)
    const m = Math.floor((ang + Math.PI) / (Math.PI / 8)) % 2 === 0
    // a merlon's top is light; on the near half its outer face shows under it
    const outerEdge = !inE(x, y + 2, rx, ry) && y > ey
    p.set(x, y, m ? (outerEdge ? S2 : S1) : (y > ey ? S3 : S4))
  }
  // the parapet's outer face drops into the tower's body
  for (let x = 2; x < W_ - 2; x++) {
    let yb = -1
    for (let y = 25; y >= 0; y--) if (inE(x, y, rx, ry)) { yb = y; break }
    if (yb < 0) continue
    const dx = (x - cx) / rx, k = dx < 0.2 ? 0 : dx < 0.62 ? 1 : 2
    for (let y = yb + 1; y <= yb + 3; y++) p.set(x, y, shade(hex(y === yb + 3 ? S4 : S2), k))
  }
  // outlines round the head and round the floor
  for (let y = 0; y < 26; y++) for (let x = 0; x < W_; x++) {
    if (!inE(x, y, rx, ry) && inE(x, y, rx + 1, ry + 1) && y <= ey + 2) p.set(x, y, INK)
    if (!inE(x, y, irx, iry) && inE(x, y, irx + 1, iry + 1)) p.set(x, y, INK)
  }
  p.vline(2, ey, 18, INK).vline(W_ - 3, ey, 18, INK)
  // the beacon: an iron basket of split wood on a post
  const bx = Math.round(cx)
  p.vline(bx, 8, 13, INK).vline(bx + 1, 9, 13, NAVY)
  p.map(['.a.a.a.a.', 'awbwbwbwa', 'aWwWwWwWa', '.aWaWaWa.', '..aaaaa..'], { a: INK, w: W2, b: W1, W: W3 }, bx - 4, 3)
  // the chain's rings, low on either side
  for (const rx0 of [3, W_ - 8]) p.map(['.aaa.', 'a...a', 'a...a', '.aaa.'], { a: INK }, rx0, 3 * T + 3)
  return p
}
function chainTile(kind) {
  const p = new Pic(T, T)
  const link = (x, y, wide) => {
    if (wide) p.map(['.aaa.', 'as.sa', '.aaa.'], { a: INK, s: S2 }, x, y)
    else p.hline(x, x + 2, y + 1, INK).set(x + 1, y + 1, S3)
  }
  const path = x => kind === 'l' ? Math.round(3 + (x / 15) * 6) : kind === 'r' ? Math.round(9 - (x / 15) * 6) : 9
  for (let x = 0; x < T; x += 4) link(x, path(x) - 1, (x / 4) % 2 === 0)
  if (kind === 'float') {
    // a tarred cask riding the water, the chain through it, ripples round it
    p.map([
      '....aaaaaaa.....',
      '...awWwwwWwa....',
      '..awWwwwwWwwa...',
      '..aWWWWWWWWWa...',
      '..awWwwwwWwwa...',
      '...aaaaaaaaa....',
      '.cc.........cc..',
    ], { a: INK, w: W2, W: W3, c: CYAN }, 0, 5)
  }
  if (kind === 'l' || kind === 'r') {
    const x0 = kind === 'l' ? 0 : 12
    p.map(['aaaa', 'asSa', 'aaaa'], { a: INK, s: S1, S: S3 }, x0, 2)   // the staple in the wall
  }
  return p
}

// quay paving: granite blocks, a coping kerb along the water side(s)
const quayBase = (x, y) => {
  const row = Math.floor(y / 5), ry = y % 5, off = row % 2 ? 4 : 0, bx = (x + off) % 8
  if (ry === 4 || bx === 7) return S3
  const id = (Math.floor((x + off) / 8) * 7 + row * 3) % 5
  if (ry === 0 && bx < 6) return S1
  return id === 0 ? S1 : id === 3 ? shade(hex(S2), 1) : S2
}
function quay(sides) {
  const p = new Pic(T, T).each((_, x, y) => quayBase(x, y))
  const band = (side) => {
    for (let i = 0; i < T; i++) for (let d = 0; d < 4; d++) {
      const [x, y] = side === 'n' ? [i, d] : side === 's' ? [i, T - 1 - d] : side === 'w' ? [d, i] : [T - 1 - d, i]
      const joint = i % 8 === 7
      let c = d === 0 ? INK : d === 3 ? S4 : joint ? S3 : d === 1 ? S1 : (side === 's' || side === 'e' ? S2 : S1)
      if (side === 's' && d === 0) c = S2     // the coping's front edge: the face below takes the shadow
      p.set(x, y, c)
    }
  }
  for (const s of sides) band(s)
  return p
}
function quayFace() {
  const p = new Pic(T, T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (y === 0) p.set(x, y, INK)
    else if (y <= 8) { const row = Math.floor((y - 1) / 4), off = row % 2 ? 5 : 0; p.set(x, y, ((y - 1) % 4 === 3 || (x + off) % 10 === 9) ? S4 : y <= 2 ? S2 : S3) }
    else if (y <= 10) p.set(x, y, (x + y) % 3 === 0 ? G3 : G2)                       // weed at the water line
    else if (y === 11) p.set(x, y, x % 4 === 1 ? G2 : null)
  }
  return p
}
function mole(v) {
  const p = new Pic(T, T).each((_, x, y) => {
    const row = Math.floor(y / 6), ry = y % 6, off = row % 2 ? 5 : 1, bx = (x + off) % 9
    if (ry === 5 || bx === 8) return S4
    if (ry === 0) return S2
    return ((Math.floor((x + off) / 9) + row) % 3 === 0) ? S2 : S3
  })
  if (v) p.set(3, 3, G3).set(4, 3, G2).set(4, 4, G3).set(11, 9, WHITE).set(12, 13, G3).set(9, 2, S1)
  else p.set(6, 8, S1).set(12, 3, S1)
  return p
}
function bollard() {
  return new Pic(T, T).map([
    '................',
    '................',
    '................',
    '................',
    '.....aaaaaa.....',
    '....asssSSSa....',
    '....aaaaaaaa....',
    '.....assSSa.....',
    '.....assSSa.....',
    '.....assSSa.....',
    '....aaaaaaaa....',
    '....assssSSa....',
    '....aSSSSSSa....',
    '.....aaaaaa.....',
    '................',
    '................',
  ], { a: INK, s: S2, S: S3 })
}
function drawHarbour({ put, putGrid, putRow }) {
  const t = harbourTower()
  putGrid(HARBOUR.tower.head, t.crop(0, 0, 3 * T, 2 * T))
  putRow(HARBOUR.tower.body, t.crop(0, 2 * T, 3 * T, T))
  putRow(HARBOUR.tower.base, t.crop(0, 3 * T, 3 * T, T))
  for (const k of ['l', 'm', 'r', 'float']) put(HARBOUR.chain[k], chainTile(k))
  for (const [k, sides] of Object.entries({ n: 'n', e: 'e', s: 's', w: 'w', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw' })) put(HARBOUR.quay[k], quay([...sides]))
  put(HARBOUR.face, quayFace())
  HARBOUR.mole.forEach((n, i) => put(n, mole(i)))
  put(HARBOUR.bollard, bollard())
}

// ==== the castle =============================================================
// A pitched roof seen from the south, in rows of scallops four pixels apart
// so the slope row repeats: ridge (cap and the first courses), slope, eave.
export function roofRow(part, end, pal, pointed = false) {
  const [hi, li, mid, dk, deep] = pal
  const p = new Pic(T, T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let c
    const course = Math.floor((y + (part === 'ridge' ? 0 : 0)) / 4), ry = y % 4
    const off = course % 2 ? 2 : 0, sx = (x + off) % 4
    if (part === 'ridge' && y < 2) c = INK
    else if (part === 'ridge' && y === 2) c = hi
    else if (part === 'ridge' && y === 3) c = mid
    else if (part === 'eave' && y >= 12) c = [dk, li, INK, S3][y - 12]
    else if (pointed) {
      // pointed shingles (Finnish paanu): each comes to a tip at its foot
      if (ry === 0) c = (sx === 1 || sx === 2) ? li : dk
      else if (sx === 3) c = ry === 3 ? dk : mid
      else if (ry === 1 && sx === 0) c = hi
      else c = li
    }
    else if (ry === 0) c = dk
    else if (sx === 3) c = mid
    else if (ry === 3 && sx !== 0) c = hi
    else c = li
    p.set(x, y, c)
  }
  if (end === 'l' || end === 'lr') for (let y = part === 'ridge' ? 0 : 0; y < T - (part === 'eave' ? 1 : 0); y++) { p.set(0, y, INK); p.set(1, y, INK); p.set(2, y, y % 4 === 0 ? mid : hi) }
  if (end === 'r' || end === 'lr') for (let y = 0; y < T - (part === 'eave' ? 1 : 0); y++) { p.set(15, y, INK); p.set(14, y, INK); p.set(13, y, y % 4 === 0 ? deep : dk) }
  if (part === 'ridge' && (end === 'l' || end === 'lr')) p.set(0, 0, null)
  if (part === 'ridge' && (end === 'r' || end === 'lr')) p.set(15, 0, null)
  return p
}
// the keep's ashlar: big pale blocks
const ashlar = (x, y) => {
  const row = Math.floor(y / 4), ry = y % 4, off = row % 2 ? 6 : 0, bx = (x + off) % 12
  if (ry === 3 || bx === 11) return S2
  if (ry === 0 && bx < 10) return WHITE
  return ((Math.floor((x + off) / 12) + row) % 4 === 1) ? hex(S2) : S1
}
function keepFace({ lower = false, l = false, r = false, win = false } = {}) {
  const p = new Pic(T, T).each((_, x, y) => ashlar(x, y))
  if (win) {
    // a tall window: the arch at the top of the upper row, the sill at the foot of the lower
    const y0 = lower ? 0 : 5, y1 = lower ? 11 : 15
    p.rect(4, y0, 8, y1 - y0 + 1, S2).rect(5, y0, 6, y1 - y0 + 1, NAVY)
    if (!lower) { p.set(5, 5, S2).set(10, 5, S2).set(4, 5, S1).set(11, 5, S1).hline(6, 9, 4, S2).hline(6, 9, 3, INK).set(5, 4, INK).set(10, 4, INK); p.set(4, 4, null) }
    for (let y = y0; y <= y1; y++) { p.set(3, y, INK); p.set(12, y, INK); p.set(7, y, S3); p.set(8, y, S3) }
    p.set(6, y0 + (lower ? 2 : 3), '#3d6b9e').set(9, y0 + (lower ? 4 : 5), '#3d6b9e')
    if (!lower) { p.set(3, 5, S1).set(12, 5, S1).set(4, 4, INK).set(11, 4, INK).set(5, 3, null) ; p.hline(5, 10, 3, INK).set(4, 4, INK) }
    if (lower) p.hline(3, 12, 12, S1).hline(3, 12, 13, S4)
  }
  if (lower) {
    p.hline(0, 15, 12, p.get(0, 12) && !win ? S1 : S1).hline(0, 15, 13, S4)
    for (let y = 14; y < T; y++) for (let x = 0; x < T; x++) p.set(x, y, x % 8 === 7 ? S4 : S2)
    if (win) p.hline(3, 12, 12, S1)
  }
  if (l) { p.vline(0, 0, 15, INK); for (let y = 0; y < T; y++) p.set(1, y, y % 4 === 3 ? S2 : WHITE) }
  if (r) { p.vline(15, 0, 15, INK); for (let y = 0; y < T; y++) p.set(14, y, y % 4 === 3 ? S3 : S2) }
  return p
}
function keepDoor() {
  // the great door, two cells wide: oak planks under a round arch, iron studs
  const p = new Pic(2 * T, T).each((_, x, y) => ashlar(x + 3, y))
  p.hline(0, 31, 12, S1).hline(0, 31, 13, S4)
  for (let y = 14; y < T; y++) for (let x = 0; x < 2 * T; x++) p.set(x, y, x % 8 === 7 ? S4 : S2)
  const cx = 15.5, x0 = 6, x1 = 25
  for (let y = 0; y < T; y++) for (let x = x0 - 2; x <= x1 + 2; x++) {
    const top = 6 - Math.round(5 * Math.sqrt(Math.max(0, 1 - ((x - cx) / 11.5) ** 2)))
    if (y < top - 2) continue
    if (y < top) { p.set(x, y, y === top - 2 ? INK : S1); continue }
    if (x < x0 || x > x1) { p.set(x, y, x === x0 - 1 || x === x1 + 1 ? INK : S1); continue }
    const plank = (x - x0) % 4 === 3
    p.set(x, y, plank ? W3 : (x < cx ? W2 : shade(hex(W2), 1)))
    if ((y === top + 2 || y === 10) && (x - x0) % 4 === 1) p.set(x, y, S1)
  }
  p.vline(15, 1, 15, INK).vline(16, 1, 15, W3)
  p.set(13, 8, YEL).set(18, 8, YEL)
  p.hline(x0 - 1, x1 + 1, 15, INK)
  return p
}
function banner(frame) {
  const p = new Pic(T, T)
  // the rod
  p.hline(2, 13, 1, INK).set(1, 1, YEL).set(14, 1, YEL).set(1, 0, INK).set(14, 0, INK).set(1, 2, INK).set(14, 2, INK)
  // the cloth: red, a golden sampo-lid sun on it, a swallowtail that stirs
  const sway = frame === 'b' ? 1 : 0
  for (let y = 2; y < 15; y++) {
    const s = y > 9 ? sway : 0
    const xl = 4 + s, xr = 11 + s
    for (let x = xl; x <= xr; x++) {
      let c = x === xl || x === xr ? INK : (x < xl + 3 ? RED : x > xr - 2 ? '#a8322a' : RED)
      // the swallowtail: a notch cut up into its foot
      if (y >= 12 && Math.abs(x - (xl + xr) / 2) < y - 11) c = null
      p.set(x, y, c)
    }
  }
  for (let x = 4 + sway; x <= 11 + sway; x++) p.set(x, 14, null)
  p.map(['.y.y.', 'yyyyy', '.yoy.', 'yyyyy', '.y.y.'], { y: YEL, o: ORA }, 5, 5)
  // the swallowtail's points and outline
  const s = sway
  p.set(4 + s, 14, INK).set(11 + s, 14, INK).set(5 + s, 13, INK).set(10 + s, 13, INK).set(6 + s, 12, INK).set(9 + s, 12, INK).set(7 + s, 12, INK).set(8 + s, 12, INK)
  for (let y = 12; y <= 13; y++) for (let x = 7 + s; x <= 8 + s; x++) if (y > 12) p.set(x, y, null)
  if (frame === 'b') { p.set(6, 3, '#a8322a').set(6, 4, '#a8322a'); p.set(9, 10, '#a8322a') }
  else { p.set(10, 4, '#a8322a').set(10, 8, '#a8322a') }
  return p
}
// a red pennant on a pole whose foot stands on a 3-wide tower's finial (x 8)
function pennant(frame) {
  const p = new Pic(T, T)
  p.vline(8, 1, 8, INK).set(8, 0, YEL)
  const rows = frame === 'a'
    ? ['aaaaaa..', 'arrrrraa', 'arrrrrra', 'aRRRRaa.', 'aaaa....']
    : ['aaaa....', 'arrraaa.', 'arrrrrra', 'aRRRRRaa', 'aaaaaa..']
  p.map(rows, { a: INK, r: RED, R: '#a8322a' }, 8, 1)
  return p
}
// a stone chimney standing up from the ridge
function castleChimney() {
  const p = roofRow('ridge', 'm', DARK_ROOF)
  p.map([
    '....aaaaaaaa....',
    '....aSSSSSSa....',
    '....aaaaaaaa....',
    '.....asssSa.....',
    '.....asssSa.....',
    '.....aaaaaa.....',
    '.....asSSSa.....',
    '.....asssSa.....',
    '.....asssSa.....',
    '....aaaaaaaa....',
  ], { a: INK, s: S1, S: S2 })
  return p
}
// a dormer window in the slope: a little gable over a pale face and a casement
function castleDormer() {
  const [hi, li, mid, dk] = DARK_ROOF
  const p = roofRow('slope', 'm', DARK_ROOF)
  p.map([
    '.......aa.......',
    '......ahla......',
    '.....ahllla.....',
    '....ahllllda....',
    '...ahlllllldaa..',
    '..aaaaaaaaaaaaa.',
    '...assssssssa...',
    '...asaaaaaasa...',
    '...asaggggasa...',
    '...asagGggasa...',
    '...asaggggasa...',
    '...asaaaaaasa...',
    '...aaaaaaaaaa...',
    '....aDDDDDDa....',
  ], { a: INK, h: hi, l: li, d: dk, s: S1, g: NAVY, G: '#3d6b9e', D: mid })
  return p
}
function drawCastle({ put, putGrid, putRow }) {
  for (const part of ['ridge', 'slope', 'eave']) CASTLE.roof[part].forEach((n, i) => put(n, roofRow(part, ['l', 'm', 'r'][i], DARK_ROOF)))
  put(CASTLE.roof.chim, castleChimney()); put(CASTLE.roof.dormer, castleDormer())
  put(CASTLE.upper.l, keepFace({ l: true })); put(CASTLE.upper.m, keepFace()); put(CASTLE.upper.r, keepFace({ r: true })); put(CASTLE.upper.win, keepFace({ win: true }))
  put(CASTLE.lower.l, keepFace({ lower: true, l: true })); put(CASTLE.lower.m, keepFace({ lower: true })); put(CASTLE.lower.r, keepFace({ lower: true, r: true }))
  put(CASTLE.lower.win, keepFace({ lower: true, win: true }))
  const d = keepDoor(); putRow(CASTLE.lower.door, d)
  CASTLE.banner.forEach((n, i) => put(n, banner('ab'[i])))
  CASTLE.pennant.forEach((n, i) => put(n, pennant('ab'[i])))
}
