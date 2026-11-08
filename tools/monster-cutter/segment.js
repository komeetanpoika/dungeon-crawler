// Cut-line segmentation: turns a mask plus pieces (parent, seed, cut, claims)
// into a per-pixel owner map (pure, no DOM, no node: imports).
import { supercoverLine } from './raster.js'

// -> { owner, base, leaks }. owner/base: piece index per pixel, -1 off the mask;
// base is the owner before claims. leaks: ids of pieces whose flood reached
// the parent's anchor (a cut that does not close), which get nothing.
// A detached piece (non-root, cut null) takes its whole connected blob from
// the pixels the root still owns, whatever its parent (which then only says
// what it moves with); it leaks if that blob holds the root's seed.
export function segment(mask, w, h, pieces) {
  const n = w * h
  const owner = new Int16Array(n).fill(-1)
  const index = new Map(pieces.map((p, i) => [p.id, i]))
  const root = pieces.findIndex(p => p.parent === null)
  for (let i = 0; i < n; i++) if (mask[i]) owner[i] = root
  const leaks = []
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h

  // breadth-first from the root so a parent is settled before its children
  const order = [root], seen = new Set([root])
  for (let k = 0; k < order.length; k++) {
    pieces.forEach((p, i) => { if (!seen.has(i) && index.get(p.parent) === order[k]) { seen.add(i); order.push(i) } })
  }

  for (const ci of order.slice(1)) {
    const child = pieces[ci], detached = !child.cut
    const pi = detached ? root : index.get(child.parent), parent = pieces[pi] // pi: whose pixels it carves
    const [sx, sy] = child.seed
    if (!inside(sx, sy) || owner[sy * w + sx] !== pi) { leaks.push(child.id); continue }

    // the anchor of the piece it carves from: the root's seed, else that piece's
    // owned pixel nearest its pivot
    let anchor
    if (parent.parent === null) anchor = parent.seed[1] * w + parent.seed[0]
    else {
      let best = Infinity
      const [px, py] = parent.pivot
      for (let i = 0; i < n; i++) {
        if (owner[i] !== pi) continue
        const x = i % w, y = (i - x) / w
        const d = (x - px) ** 2 + (y - py) ** 2
        if (d < best) { best = d; anchor = i }
      }
    }

    const wall = new Uint8Array(n)
    if (child.cut) for (const [x, y] of supercoverLine(child.cut[0], child.cut[1])) if (inside(x, y)) wall[y * w + x] = 1
    const region = [], stack = [sy * w + sx], mark = new Uint8Array(n)
    mark[stack[0]] = 1
    let leaked = false
    if (wall[stack[0]]) { leaks.push(child.id); continue } // seed sits on its own cut line
    while (stack.length) {
      const p = stack.pop()
      if (p === anchor) { leaked = true; break }
      region.push(p)
      const x = p % w, y = (p - x) / w
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy
        if (!inside(nx, ny)) continue
        const q = ny * w + nx
        if (mark[q] || wall[q] || owner[q] !== pi) continue
        mark[q] = 1; stack.push(q)
      }
    }
    if (leaked) { leaks.push(child.id); continue }
    for (const p of region) owner[p] = ci
  }

  const base = Int16Array.from(owner)
  pieces.forEach((p, i) => {
    for (const { x, y, r } of p.claims || []) {
      for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(h - 1, Math.ceil(y + r)); j++) {
        for (let k = Math.max(0, Math.floor(x - r)); k <= Math.min(w - 1, Math.ceil(x + r)); k++) {
          if (mask[j * w + k] && (k - x) ** 2 + (j - y) ** 2 <= r * r) owner[j * w + k] = i
        }
      }
    }
  })
  return { owner, base, leaks }
}
