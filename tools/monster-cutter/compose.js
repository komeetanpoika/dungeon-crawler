// Compose a cut into the finished pixel-art pieces of a cut-out rig, packed
// into one atlas, plus the PARTS description the engine draws from. Every
// output cell goes to the one piece owning most of it, so the pieces tile the
// figure with no seam; pixels a claim took from a piece are filled by
// diffusion so moving the claimer opens no hole; each cut piece gets a joint
// cap mirrored from its own colours; the 1 px outline runs only along the
// original silhouette, never a cut. Pure (no DOM, no node: imports).
import { decodeMask } from './mask.js'
import { segment } from './segment.js'
import { supercoverLine } from './raster.js'

const ALPHA_CUT = 110     // output cells covered less than this (of 255) stay clear
const OUTLINE_DARK = 0.45 // default outline: the figure's mean colour times this
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]] // N, E, S, W

// -> { atlas: Image, parts: PARTS }. PARTS coordinates are art px with (0,0)
// at the top-left of the figure's box at rest; the outline lies 1 px outside
// it, so `at` may be -1.
export function composeCut(src, cut) {
  const { w, h, pieces } = cut
  if (src.w !== w || src.h !== h) throw new Error(`source is ${src.w}x${src.h} but the cut is ${w}x${h}`)
  if (!(cut.outHeight > 0)) throw new Error(`outHeight must be a positive number, got ${cut.outHeight}`)
  const mask = decodeMask(cut.mask, w * h)
  const { owner, base } = segment(mask, w, h, pieces)
  const n = pieces.length
  const rgb = i => [src.rgba[i * 4], src.rgba[i * 4 + 1], src.rgba[i * 4 + 2]]

  // the figure's box in source px; output cell (X, Y) covers scale x scale
  // source px from its top-left
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let i = 0; i < w * h; i++) if (mask[i]) {
    const x = i % w, y = (i - x) / w
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < 0) x0 = y0 = 0
  const scale = Math.max(1, Math.ceil((y1 - y0 + 1) / cut.outHeight))
  const FW = Math.ceil((x1 - x0 + 1) / scale), FH = Math.ceil((y1 - y0 + 1) / scale), cells = FW * FH
  const cellOf = i => { const x = i % w, y = (i - x) / w; return Math.floor((y - y0) / scale) * FW + Math.floor((x - x0) / scale) }
  const covered = count => Math.round(255 * count / (scale * scale)) >= ALPHA_CUT

  // draw order: by z, ties in cut order
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].z - pieces[b].z || a - b)
  const pos = new Int32Array(n)
  order.forEach((k, at) => { pos[k] = at })

  // per cell: mask cover, per-piece owner and base counts, and per-piece
  // colour sums over the piece's own pixels plus its filled holes
  const cover = new Int32Array(cells), own = new Int32Array(cells * n), held = new Int32Array(cells * n)
  const sums = new Float64Array(cells * n * 4)
  const add = (p, c, col) => { const k = (c * n + p) * 4; sums[k] += col[0]; sums[k + 1] += col[1]; sums[k + 2] += col[2]; sums[k + 3]++ }
  const holes = pieces.map(() => [])
  const mean = [0, 0, 0]
  let area = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x
    if (!mask[i]) continue
    const c = cellOf(i), o = owner[i], b = base[i], col = rgb(i)
    cover[c]++; own[c * n + o]++; held[c * n + b]++
    add(o, c, col)
    if (b !== o) holes[b].push(i)
    mean[0] += col[0]; mean[1] += col[1]; mean[2] += col[2]; area++
  }
  holes.forEach((list, p) => { for (const [i, col] of fillHoles(list, p, owner, rgb, w, h)) add(p, cellOf(i), col) })
  const ink = outlineColour(cut.outline, mean.map(v => (area ? v / area : 0)))

  // each covered cell is opaque in exactly the piece owning most of it (ties
  // to the earlier piece in the cut); the piece it belonged to before claims
  // keeps it too, as hole fill, when the claimer draws over it
  const argmax = (counts, c) => { let best = 0; for (let p = 1; p < n; p++) if (counts[c * n + p] > counts[c * n + best]) best = p; return best }
  const colour = (p, c) => { const k = (c * n + p) * 4; return [0, 1, 2].map(j => Math.round(sums[k + j] / sums[k + 3])) }
  const win = new Int32Array(cells).fill(-1)
  const art = pieces.map(() => []) // [X, Y, [r, g, b]] per piece
  for (let c = 0; c < cells; c++) {
    if (!covered(cover[c])) continue
    const X = c % FW, Y = (c - X) / FW, o = win[c] = argmax(own, c), b = argmax(held, c)
    art[o].push([X, Y, colour(o, c)])
    if (b !== o && pos[o] > pos[b]) art[b].push([X, Y, colour(b, c)])
  }

  // outline: a clear pixel 4-adjacent to the figure goes to the piece owning
  // the first such neighbour, N, E, S, W
  const solid = (X, Y) => X >= 0 && Y >= 0 && X < FW && Y < FH && win[Y * FW + X] >= 0
  for (let Y = -1; Y <= FH; Y++) for (let X = -1; X <= FW; X++) {
    if (solid(X, Y)) continue
    const nb = N4.find(([dx, dy]) => solid(X + dx, Y + dy))
    if (nb) art[win[(Y + nb[1]) * FW + X + nb[0]]].push([X, Y, ink])
  }

  // caps: their own coverage cut, kept only where the parent's own cells
  // hide them at rest
  const caps = pieces.map((p, k) => {
    const pi = pieces.findIndex(q => q.id === p.parent)
    if (!p.cut || pi < 0) return []
    const acc = new Map()
    for (const [i, col] of capPixels(p, k, pi, owner, rgb, w, h)) {
      const c = cellOf(i), a = acc.get(c) || [0, 0, 0, 0]
      a[0] += col[0]; a[1] += col[1]; a[2] += col[2]; a[3]++
      acc.set(c, a)
    }
    const list = []
    for (const [c, a] of acc) {
      if (covered(a[3]) && win[c] === pi) list.push([c % FW, Math.floor(c / FW), a.slice(0, 3).map(v => Math.round(v / a[3]))])
    }
    return list
  })

  const pieceImg = art.map(image), capImg = caps.map(image)
  const atlas = shelfPack(order.flatMap(k => [pieceImg[k], capImg[k]]).filter(Boolean))
  const fig = (v, o) => Math.round((v - o) / scale * 2) / 2 || 0 // nearest half art px, no -0
  const parts = {
    version: 1, view: cut.view, faces: cut.faces,
    figure: { w: FW, h: FH },
    pieces: order.map(k => {
      const p = pieces[k], img = pieceImg[k], cap = capImg[k]
      return {
        id: p.id, role: p.role, side: p.side, parent: p.parent, z: p.z,
        pivot: [fig(p.pivot[0], x0), fig(p.pivot[1], y0)],
        rect: img ? [img.ax, img.ay, img.w, img.h] : [0, 0, 0, 0],
        at: img ? [img.x, img.y] : [0, 0],
        cap: cap ? [cap.ax, cap.ay, cap.w, cap.h, cap.x, cap.y] : null,
      }
    }),
    points: Object.fromEntries(Object.entries(cut.points || {}).map(([name, pt]) => [name, { piece: pt.piece, x: fig(pt.x, x0), y: fig(pt.y, y0) }])),
  }
  return { atlas, parts }
}

// Colours for the pixels piece p lost to claims, diffused in from p's own
// pixels: each pass gives every hole pixel touching p's opaque pixels the
// mean of those 4-neighbours, until all are filled. A hole out of reach keeps
// the source colour. -> [[i, [r, g, b]]]
function fillHoles(holes, p, owner, rgb, w, h) {
  if (!holes.length) return []
  const slot = new Map(holes.map((i, k) => [i, k]))
  const col = holes.map(() => null)
  const nbrs = i => {
    const x = i % w, out = []
    if (x > 0) out.push(i - 1)
    if (x < w - 1) out.push(i + 1)
    if (i >= w) out.push(i - w)
    if (i < w * (h - 1)) out.push(i + w)
    return out
  }
  const opaque = q => (owner[q] === p ? rgb(q) : slot.has(q) ? col[slot.get(q)] : null)
  const queued = new Uint8Array(holes.length)
  let ring = holes.filter(i => nbrs(i).some(q => owner[q] === p))
  for (const i of ring) queued[slot.get(i)] = 1
  while (ring.length) {
    const fresh = ring.map(i => {
      const s = [0, 0, 0]
      let m = 0
      for (const q of nbrs(i)) { const c = opaque(q); if (c) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; m++ } }
      return s.map(v => v / m)
    })
    ring.forEach((i, k) => { col[slot.get(i)] = fresh[k] })
    const next = []
    for (const i of ring) for (const q of nbrs(i)) {
      const k = slot.get(q)
      if (k !== undefined && !queued[k]) { queued[k] = 1; next.push(q) }
    }
    ring = next
  }
  return holes.map((i, k) => [i, col[k] || rgb(i)])
}

// A child's joint cap at source resolution: the half-disc of radius |cut|/2
// around its pivot on the parent's side of the cut (cut-line pixels count as
// the parent's side), over pixels the parent owns. Each pixel takes the
// child's colour at its mirror image across the cut line, or that of the
// child pixel nearest the mirror image when it falls off the child.
// -> [[i, [r, g, b]]]
function capPixels(piece, ci, pi, owner, rgb, w, h) {
  const [[ax, ay], [bx, by]] = piece.cut
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
  if (!len2) return []
  const r = Math.sqrt(len2) / 2, [px, py] = piece.pivot
  const side = (x, y) => dx * (y - ay) - dy * (x - ax)
  const inImg = (x, y) => x >= 0 && y >= 0 && x < w && y < h
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const qx0 = clamp(Math.floor(px - r), 0, w - 1), qx1 = clamp(Math.ceil(px + r), 0, w - 1) // the disc's box
  const qy0 = clamp(Math.floor(py - r), 0, h - 1), qy1 = clamp(Math.ceil(py + r), 0, h - 1)
  const inDisc = (x, y) => (x - px) ** 2 + (y - py) ** 2 <= r * r

  // the child's side: where its pixels near the joint lie (else all of them)
  let s = 0
  for (let y = qy0; y <= qy1; y++) for (let x = qx0; x <= qx1; x++) if (owner[y * w + x] === ci && inDisc(x, y)) s += side(x, y)
  if (!s) for (let i = 0; i < w * h; i++) if (owner[i] === ci) s += side(i % w, Math.floor(i / w))
  if (!s) return []

  const onCut = new Set()
  for (const [x, y] of supercoverLine(piece.cut[0], piece.cut[1])) if (inImg(x, y)) onCut.add(y * w + x)
  const cap = [] // [i, mirror x, mirror y]
  for (let y = qy0; y <= qy1; y++) for (let x = qx0; x <= qx1; x++) {
    const i = y * w + x
    if (!inDisc(x, y) || owner[i] !== pi || (side(x, y) * s > 0 && !onCut.has(i))) continue
    const t = ((x - ax) * dx + (y - ay) * dy) / len2
    cap.push([i, Math.round(2 * (ax + t * dx) - x), Math.round(2 * (ay + t * dy) - y)])
  }
  if (!cap.length) return []

  // nearest child pixel: a breadth-first fill from the child's pixels over the
  // mirror images' box (plus a margin)
  const m = Math.ceil(r) + 1
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity
  for (const [, mx, my] of cap) { X0 = Math.min(X0, mx); X1 = Math.max(X1, mx); Y0 = Math.min(Y0, my); Y1 = Math.max(Y1, my) }
  X0 = clamp(X0 - m, 0, w - 1); X1 = clamp(X1 + m, 0, w - 1); Y0 = clamp(Y0 - m, 0, h - 1); Y1 = clamp(Y1 + m, 0, h - 1)
  const BW = X1 - X0 + 1, BH = Y1 - Y0 + 1
  const near = new Int32Array(BW * BH).fill(-1), queue = []
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (owner[y * w + x] === ci) { near[(y - Y0) * BW + x - X0] = y * w + x; queue.push((y - Y0) * BW + x - X0) }
  }
  if (!queue.length) { // no child pixel nearby: the one nearest the pivot
    let best = -1, bd = Infinity
    for (let i = 0; i < w * h; i++) {
      if (owner[i] !== ci) continue
      const d = (i % w - px) ** 2 + (Math.floor(i / w) - py) ** 2
      if (d < bd) { bd = d; best = i }
    }
    near.fill(best)
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], x = k % BW, y = (k - x) / BW
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const nx = x + i, ny = y + j
      if (nx < 0 || ny < 0 || nx >= BW || ny >= BH || near[ny * BW + nx] >= 0) continue
      near[ny * BW + nx] = near[k]; queue.push(ny * BW + nx)
    }
  }
  return cap.map(([i, mx, my]) => {
    const on = inImg(mx, my) && owner[my * w + mx] === ci
    return [i, rgb(on ? my * w + mx : near[(clamp(my, Y0, Y1) - Y0) * BW + clamp(mx, X0, X1) - X0])]
  })
}

// '#rgb' / '#rrggbb', or null for a dark version of the figure's mean colour.
function outlineColour(hex, mean) {
  if (hex == null) return mean.map(v => Math.round(v * OUTLINE_DARK))
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`outline must be #rgb or #rrggbb, got "${hex}"`)
  const s = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(k => parseInt(s.slice(k, k + 2), 16))
}

// [[X, Y, [r, g, b]]] in figure px -> the tight opaque image placed at (x, y),
// or null when empty.
function image(list) {
  if (!list.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [X, Y] of list) { x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y) }
  const iw = x1 - x0 + 1, ih = y1 - y0 + 1, rgba = new Uint8Array(iw * ih * 4)
  for (const [X, Y, col] of list) rgba.set([col[0], col[1], col[2], 255], ((Y - y0) * iw + X - x0) * 4)
  return { x: x0, y: y0, w: iw, h: ih, rgba }
}

// Shelf packing, tallest first (ties keep their order), 1 px apart. Sets
// ax/ay on each image and returns the atlas.
function shelfPack(items) {
  const sorted = items.map((it, k) => [it, k]).sort((a, b) => b[0].h - a[0].h || a[1] - b[1]).map(([it]) => it)
  const area = items.reduce((sum, it) => sum + (it.w + 1) * (it.h + 1), 0)
  const width = Math.max(0, ...items.map(it => it.w), Math.ceil(Math.sqrt(area)))
  let x = 0, y = 0, shelf = 0, aw = 1, ah = 1
  for (const it of sorted) {
    if (x > 0 && x + it.w > width) { y += shelf + 1; x = 0; shelf = 0 }
    it.ax = x; it.ay = y
    x += it.w + 1; shelf = Math.max(shelf, it.h)
    aw = Math.max(aw, it.ax + it.w); ah = Math.max(ah, it.ay + it.h)
  }
  const rgba = new Uint8Array(aw * ah * 4)
  for (const it of items) {
    for (let r = 0; r < it.h; r++) rgba.set(it.rgba.subarray(r * it.w * 4, (r + 1) * it.w * 4), ((it.ay + r) * aw + it.ax) * 4)
  }
  return { w: aw, h: ah, rgba }
}
