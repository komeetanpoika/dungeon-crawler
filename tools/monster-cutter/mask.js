// Background mask for the monster cutter: automatic keying, brush strokes,
// speck clean-up and the run-length format stored in the cut file. Pure.
import { components, boxes } from './raster.js'

const median = a => { a.sort((p, q) => p - q); return a[a.length >> 1] }

// Mask = the subject. Real transparency wins; otherwise the backdrop is
// flooded in from the border (a subject touching the border is not seeded
// unless it matches the backdrop colour).
export function autoMask({ w, h, rgba }, { tolerance = 40, alphaCut = 128 } = {}) {
  const n = w * h
  let clear = 0
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < alphaCut) clear++
  const mask = new Uint8Array(n)
  if (clear >= n * 0.01) {
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3] >= alphaCut ? 1 : 0
    return mask
  }
  const border = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1)
  const dom = [0, 1, 2].map(c => median(border.map(p => rgba[p * 4 + c])))
  const dist = (p, r, g, b) => Math.hypot(rgba[p * 4] - r, rgba[p * 4 + 1] - g, rgba[p * 4 + 2] - b)
  const flooded = new Uint8Array(n)
  const stack = []
  for (const p of border) {
    if (!flooded[p] && dist(p, dom[0], dom[1], dom[2]) <= tolerance) { flooded[p] = 1; stack.push(p) }
  }
  const tryGrow = (from, q) => {
    if (flooded[q]) return
    if (dist(q, rgba[from * 4], rgba[from * 4 + 1], rgba[from * 4 + 2]) > tolerance) return
    if (dist(q, dom[0], dom[1], dom[2]) > 3 * tolerance) return
    flooded[q] = 1; stack.push(q)
  }
  while (stack.length) {
    const p = stack.pop()
    const x = p % w, y = (p - x) / w
    if (x > 0) tryGrow(p, p - 1)
    if (x < w - 1) tryGrow(p, p + 1)
    if (y > 0) tryGrow(p, p - w)
    if (y < h - 1) tryGrow(p, p + w)
  }
  for (let i = 0; i < n; i++) mask[i] = flooded[i] ? 0 : 1
  return mask
}

// strokes: [{ x, y, r, keep }] discs painted in order; returns a new mask.
export function applyStrokes(mask, w, h, strokes) {
  const out = Uint8Array.from(mask)
  for (const { x, y, r, keep } of strokes) {
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(h - 1, Math.ceil(y + r))
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w - 1, Math.ceil(x + r))
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      if ((px - x) ** 2 + (py - y) ** 2 <= r * r) out[py * w + px] = keep ? 1 : 0
    }
  }
  return out
}

// The largest component plus any component whose box lies within `margin`
// px of the largest one's box.
export function keepMain(mask, w, h, margin) {
  const { label, sizes } = components(mask, w, h)
  const out = new Uint8Array(w * h)
  if (!sizes.length) return out
  const bx = boxes(label, sizes, w, h)
  let main = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i
  const m = bx[main]
  const keep = bx.map(b => b[0] <= m[2] + margin && b[2] >= m[0] - margin &&
                           b[1] <= m[3] + margin && b[3] >= m[1] - margin)
  for (let i = 0; i < w * h; i++) if (label[i] >= 0 && keep[label[i]]) out[i] = 1
  return out
}

// Run lengths, alternating 0-run, 1-run, ... (so a mask starting with 1
// begins with a zero-length 0-run).
export function encodeMask(mask) {
  const runs = []
  let cur = 0, len = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === cur) len++
    else { runs.push(len); cur = mask[i]; len = 1 }
  }
  runs.push(len)
  return runs
}

export function decodeMask(runs, n) {
  const out = new Uint8Array(n)
  let p = 0, v = 0
  for (const r of runs) {
    if (v) out.fill(1, p, p + r)
    p += r; v ^= 1
  }
  return out
}
