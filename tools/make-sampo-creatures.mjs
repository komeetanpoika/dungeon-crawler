// Draws the Sampo story's own creatures into renderer/assets/monsters/:
//   eagle.png   Louhi as the great eagle, five frames in a row (wings up,
//               level, down; the stoop; on the ground), 96x64 each
//   pike.png    the great pike rising, two frames (jaws shut, jaws wide), 64x40
//   ikuturso.png      Iku-Turso: the sea serpent's sheet in his own colours (the
//                     deep's violet-black, a bone-pale throat, eyes like coals)
//   pohjanvahti-parts.png   Pohjan vahti: the winged beast's cut-out pieces
//                     as a thing made of the dark, its eyes and claws embers
// The first two are painted from shapes a pixel at a time and inked round, in
// the flat style of the game's tiles; the other two are repainted from sheets
// the game already has, shape for shape. The rigs (render/monster-rigs/
// eagle.js, pike.js, turso.js, pohjanvahti.js) know the frame sizes.
//
//   node tools/make-sampo-creatures.mjs
import { writePng } from './png-write.mjs'
import { readPng } from './png-read.mjs'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const INK = '#2b1d2a'

// A frame: a grid of colour strings (null: clear).
function frame(w, h) {
  const px = Array.from({ length: h }, () => Array(w).fill(null))
  const set = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) px[y][x] = c }
  const get = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? px[y][x] : null)
  // a filled polygon (even-odd), sampled at pixel centres
  function poly(pts, c, only = null) {
    const ys = pts.map(p => p[1])
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs = []
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]
        if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + (bx - ax) * (y + 0.5 - ay) / (by - ay))
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) if (!only || only(x, y)) set(x, y, c)
    }
  }
  function oval(cx, cy, rx, ry, c, only = null) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry
      if (dx * dx + dy * dy <= 1 && (!only || only(x, y))) set(x, y, c)
    }
  }
  function line(x0, y0, x1, y1, c, only = null) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); if (!only || only(x, y)) set(x, y, c) }
  }
  // ink every clear pixel that touches paint
  function ink(c = INK) {
    const edge = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (px[y][x]) continue
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const g = get(x + dx, y + dy); return g && g !== c })) edge.push([x, y])
    }
    for (const [x, y] of edge) px[y][x] = c
  }
  const painted = (x, y) => !!get(x, y)
  return { w, h, px, set, get, poly, oval, line, ink, painted }
}

function sheet(name, frames) {
  const w = frames[0].w, h = frames[0].h
  const rgba = new Uint8Array(w * frames.length * h * 4)
  frames.forEach((f, i) => f.px.forEach((row, y) => row.forEach((c, x) => {
    if (c) rgba.set([...hex(c), 255], (y * w * frames.length + i * w + x) * 4)
  })))
  const out = new URL(`../renderer/assets/monsters/${name}.png`, import.meta.url).pathname
  writePng(out, w * frames.length, h, rgba)
  console.log(`wrote ${out} (${frames.length} frames of ${w}x${h})`)
}

// ---- the eagle ------------------------------------------------------------------------
// Seen as the game sees everything: from the front and a little above. Iron
// feathers, a pale head, brass beak and claws, a red eye.
const E = { wing: '#4b5163', dark: '#2f3342', light: '#6d7489', bar: '#3a3f4f', body: '#3d4252', belly: '#565c70',
  head: '#ece7da', shade: '#bfb8a8', brass: '#e2b64a', brassD: '#a9792a', eye: '#c0271d' }

// one spread wing: `s` is -1 (her right, our left) or 1; `lift` raises the tip, `fold` 0..1 draws it in
function wing(f, s, cx, lift, fold) {
  const X = d => cx + s * d
  const span = 44 - 26 * fold
  const sh = [X(5), 27], wrist = [X(span * 0.56), 21 - lift * 0.45 + fold * 4], tip = [X(span), 25 - lift + fold * 22]
  const back = [X(span * 0.74), 38 - lift * 0.5 + fold * 14], root = [X(5), 40]
  // the long flight feathers, the trailing edge cut into feather tips
  const n = 7
  const trail = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const ex = tip[0] + (root[0] - tip[0]) * t, ey = tip[1] + (back[1] + 4 - tip[1]) * Math.sin(t * Math.PI * 0.5) + (root[1] - back[1] - 4) * t * t
    trail.push([ex, ey + 3]); if (i < n) trail.push([ex + (root[0] - tip[0]) / n * 0.5, ey])
  }
  f.poly([sh, wrist, tip, ...trail, root], E.wing)
  // feather shafts: dark lines from the leading edge to each tip
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const ax = wrist[0] + (sh[0] - wrist[0]) * t * 1.05, ay = wrist[1] + (sh[1] - wrist[1]) * t + 3
    f.line(ax, ay, trail[Math.min(trail.length - 1, i * 2)][0], trail[Math.min(trail.length - 1, i * 2)][1] - 1, E.bar, f.painted)
  }
  // the coverts: a lighter band along the leading edge, darker under it
  f.poly([sh, wrist, tip, [tip[0] - s * 5, tip[1] + 3], [wrist[0], wrist[1] + 5], [sh[0], sh[1] + 5]], E.light, f.painted)
  f.line(sh[0], sh[1] + 6, wrist[0], wrist[1] + 6, E.dark, f.painted)
  f.line(wrist[0], wrist[1] + 6, tip[0] - s * 6, tip[1] + 4, E.dark, f.painted)
}
function tail(f, cx, y, len) {
  f.poly([[cx - 5, y], [cx + 5, y], [cx + 9, y + len], [cx + 5, y + len - 2], [cx + 2, y + len + 1], [cx - 2, y + len + 1], [cx - 5, y + len - 2], [cx - 9, y + len]], E.dark)
  for (const dx of [-4, 0, 4]) f.line(cx + dx * 0.6, y + 2, cx + dx, y + len - 2, E.bar, f.painted)
  f.line(cx - 8, y + len - 3, cx + 8, y + len - 3, E.light, f.painted)
}
function head(f, cx, y) {
  f.oval(cx, y, 5.5, 5.5, E.head)
  f.poly([[cx - 5, y + 1], [cx + 5, y + 1], [cx + 4, y + 5], [cx - 4, y + 5]], E.shade, f.painted)   // the ruff, in shadow
  f.poly([[cx - 2.5, y + 0.5], [cx + 2.5, y + 0.5], [cx + 1.5, y + 5], [cx, y + 7.5], [cx - 1.5, y + 5]], E.brass)   // the beak, hooked down
  f.line(cx, y + 5, cx, y + 7, E.brassD)
  // a scowl: dark brows over red eyes
  f.line(cx - 5, y - 2.5, cx - 2, y - 1, INK); f.line(cx + 5, y - 2.5, cx + 2, y - 1, INK)
  f.set(cx - 3, y - 0.5, E.eye); f.set(cx + 3, y - 0.5, E.eye)
}
function body(f, cx, cy, rx, ry) {
  f.oval(cx, cy, rx, ry, E.body)
  // barred breast
  for (let y = cy - ry + 4; y < cy + ry - 1; y += 3) f.line(cx - rx + 2, y + ((y / 3) % 2), cx + rx - 2, y + ((y / 3) % 2), E.belly, f.painted)
}
function aloft(lift) {
  const f = frame(96, 64), cx = 48
  tail(f, cx, 42, 12)
  wing(f, -1, cx, lift, 0); wing(f, 1, cx, lift, 0)
  body(f, cx + 0.5, 33, 7, 11)
  head(f, cx + 0.5, 20)
  // claws tucked under
  f.poly([[cx - 5, 43], [cx - 2, 43], [cx - 3, 46]], E.brass); f.poly([[cx + 3, 43], [cx + 6, 43], [cx + 4, 46]], E.brass)
  f.ink()
  return f
}
function stoop() {
  const f = frame(96, 64), cx = 48
  tail(f, cx, 40, 16)
  wing(f, -1, cx, -6, 0.62); wing(f, 1, cx, -6, 0.62)
  body(f, cx + 0.5, 31, 6.5, 11)
  head(f, cx + 0.5, 18)
  // claws thrown forward
  for (const s of [-1, 1]) {
    f.poly([[cx + s * 2, 40], [cx + s * 6, 40], [cx + s * 7, 47], [cx + s * 3, 47]], E.brassD)
    for (const d of [2, 4.5, 7]) f.line(cx + s * d, 46, cx + s * (d + 0.5), 50, E.brass)
  }
  f.ink()
  return f
}
function grounded() {
  const f = frame(96, 64), cx = 48
  tail(f, cx, 50, 9)
  // wings folded down her sides
  for (const s of [-1, 1]) {
    f.poly([[cx + s * 6, 27], [cx + s * 13, 30], [cx + s * 15, 44], [cx + s * 12, 57], [cx + s * 8, 52], [cx + s * 6, 40]], E.wing)
    f.line(cx + s * 12, 32, cx + s * 13, 54, E.bar, f.painted); f.line(cx + s * 9.5, 31, cx + s * 10.5, 51, E.bar, f.painted)
    f.poly([[cx + s * 6, 27], [cx + s * 13, 30], [cx + s * 13.5, 34], [cx + s * 6, 32]], E.light, f.painted)
  }
  body(f, cx + 0.5, 39, 8, 13)
  head(f, cx + 0.5, 23)
  // feet planted, three claws each
  for (const s of [-1, 1]) {
    f.poly([[cx + s * 2, 50], [cx + s * 6, 50], [cx + s * 6, 55], [cx + s * 2, 55]], E.brassD)
    for (const d of [1, 4, 7]) f.line(cx + s * 4, 55, cx + s * d, 58, E.brass)
  }
  f.ink()
  return f
}
sheet('eagle', [aloft(9), aloft(0), aloft(-8), stoop(), grounded()])

// ---- the great pike -------------------------------------------------------------------
// The head and shoulders of it, up out of the water at a slant, facing west.
// The rig cuts it at the waterline (row 31) and slides it under.
const P = { back: '#3f5a2c', side: '#62803a', spot: '#c5d27a', belly: '#dcd9aa', fin: '#8a5a32', mouth: '#7a2a35', tooth: '#ffffff', eye: '#e8c33a', pupil: '#1c1420' }
function pike(open) {
  const f = frame(64, 40)
  // the body: a thick spindle from under the water up to the back of the head
  f.poly([[60, 39], [46, 39], [26, 19], [31, 11], [44, 17], [62, 33]], P.side)
  f.poly([[60, 39], [62, 33], [44, 17], [31, 11], [33, 9.5], [47, 14], [63, 30], [63, 39]], P.back)                 // the dark back
  f.poly([[46, 39], [26, 19], [27.5, 17.5], [50, 39]], P.belly, f.painted)                                          // the pale belly
  // the head: long, flat, a duck's bill; the lower jaw drops when it gapes
  const j = open ? 6 : 0
  f.poly([[31, 11], [20, 8], [6, 9], [3, 11.5], [8, 13], [26, 15], [28, 18]], P.side)                               // skull and upper jaw
  f.poly([[31, 11], [20, 8], [6, 9], [8, 10.2], [21, 10], [33, 12.5]], P.back, f.painted)
  f.poly([[27, 17], [8, 14 + j * 0.5], [4, 14.5 + j], [7, 17 + j], [22, 19 + j * 0.6], [27, 21]], P.belly)          // lower jaw
  if (open) {
    f.poly([[26, 15.5], [8, 13.5], [8, 15.5 + j * 0.4], [25, 17.5]], P.mouth)
    for (let x = 9; x <= 23; x += 3) { f.set(x, 13.5, P.tooth); f.set(x, 14.5, P.tooth); f.set(x + 1, 16 + j * 0.45 - (x - 9) * 0.08, P.tooth) }
  } else for (let x = 8; x <= 22; x += 3) f.set(x, 13.6, P.tooth)
  f.oval(22.5, 11.5, 2.2, 2.2, P.eye); f.set(22, 11, P.pupil); f.set(22, 12, P.pupil)
  // gill cover, the fin behind it, pale spots down the flank
  f.line(30, 12, 28, 18, P.back)
  f.poly([[34, 22], [40, 30], [33, 28]], P.fin)
  for (const [x, y] of [[36, 17], [40, 20], [38, 23], [44, 22], [43, 26], [48, 27], [47, 31], [52, 30], [51, 35], [56, 34], [41, 15.5], [50, 23.5], [55, 38]]) { f.set(x, y, P.spot); f.set(x + 1, y, P.spot) }
  f.ink()
  return f
}
sheet('pike', [pike(false), pike(true)])

// ---- repaints -------------------------------------------------------------------------
const mon = name => new URL(`../renderer/assets/monsters/${name}.png`, import.meta.url).pathname
function repaint(from, to, fn) {
  const img = readPng(mon(from))
  const w = img.width, h = img.height, src = img.pixels, out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3]
    if (!a) continue
    out.set([...fn(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]).map(Math.round), a], i * 4)
  }
  writePng(mon(to), w, h, out)
  console.log(`wrote ${mon(to)} (${w}x${h}, from ${from}.png)`)
}
function toHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, mx ? d / mx : 0, mx]
}
function fromHsv(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) }
  return [f(5), f(3), f(1)]
}
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t)
const ramp = (stops, t) => { const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)); return mix(hex(stops[i]), hex(stops[i + 1]), x - i) }

// Iku-Turso: the serpent's greens turned to the deep's violet and darkened;
// its yellow eye to a coal; the water and the foam it rises in left alone.
repaint('serpent', 'ikuturso', (r, g, b) => {
  const [h, s, v] = toHsv(r, g, b)
  if (h >= 203 && h <= 250) return [r, g, b]                                   // sea and spray
  if (h >= 60 && h < 203) return s < 0.28 ? fromHsv(40, 0.18, Math.min(1, v * 1.08))   // the throat: bone
    : fromHsv(h + 108, Math.min(1, s * 0.9), v * 0.72)                          // the hide
  if (h >= 30 && h < 60 && s > 0.5) return fromHsv(8, 0.9, Math.min(1, v * 1.05))   // the eye
  return [r, g, b]
})

// Pohjan vahti: the pale beast's own shading kept, on a ramp from the dark
// to a cold violet; what was drawn black on it (eyes, claws) burns.
const DARK = ['#120f1b', '#2a2241', '#4a3d74', '#7b6fb2', '#b4abe3']
repaint('manticore-parts', 'pohjanvahti-parts', (r, g, b) => {
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (l < 0.2) return hex('#ff9a3c')
  return ramp(DARK, Math.pow((l - 0.2) / 0.8, 2.2))
})
