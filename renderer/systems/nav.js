// Grid navigation for enemy AI: walkability + clearance, and (in later
// sections of this file) Dijkstra flow fields and clearance-aware A*.
// Pure — no DOM, no game state. The nav grid caches on map._nav; tiles do
// not change at runtime today (set map._nav = null if that ever changes).
import { isWalkable } from './entities.js'

const S = 32
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

// Pixel-space AABB corner check — the same rule game.js/crab.js/cyclops.js
// have each been duplicating locally.
export function canMoveTo(map, px, py, half) {
  const corners = [
    [px - half, py - half], [px + half, py - half],
    [px - half, py + half], [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const t = map[Math.floor(cy / S)]?.[Math.floor(cx / S)]
    return t && isWalkable(t.tile, t)
  })
}

// Clearance class an entity of pixel half-size `half` needs on a tile:
// 1 = fits within a single tile, 2 = also needs the 8 surrounding tiles free.
export function clearanceFor(half) {
  return 1 + Math.max(0, Math.ceil((half - S / 2) / S))
}

// clear[i] = chebyshev distance (tiles) to the nearest blocked tile or map
// edge; blocked tiles are 0. Multi-source BFS over 8 neighbours.
export function buildNavGrid(map) {
  if (map._nav) return map._nav
  const h = map.length, w = map[0].length
  const walk = new Uint8Array(w * h)
  const clear = new Int16Array(w * h).fill(-1)
  const qx = [], qy = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    walk[i] = isWalkable(map[y][x].tile, map[y][x]) ? 1 : 0
    if (!walk[i]) { clear[i] = 0; qx.push(x); qy.push(y) }
  }
  // out-of-bounds counts as blocked: walkable border tiles start at distance 1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      const i = y * w + x
      if (walk[i] && clear[i] === -1) { clear[i] = 1; qx.push(x); qy.push(y) }
    }
  }
  for (let head = 0; head < qx.length; head++) {
    const x = qx[head], y = qy[head], d = clear[y * w + x]
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (clear[ni] === -1) { clear[ni] = d + 1; qx.push(nx); qy.push(ny) }
    }
  }
  map._nav = { w, h, walk, clear }
  return map._nav
}

export function passable(nav, x, y, clearance = 1) {
  return x >= 0 && y >= 0 && x < nav.w && y < nav.h && nav.clear[y * nav.w + x] >= clearance
}

// Nearest tile passable at `clearance`, scanning outward in chebyshev rings.
export function nearestPassable(nav, x, y, clearance = 1, maxR = 6) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (passable(nav, x + dx, y + dy, clearance)) return { x: x + dx, y: y + dy }
      }
    }
  }
  return null
}

const SQRT2 = Math.SQRT2

// Small binary min-heap keyed on cost; shared by Dijkstra and A*.
class MinHeap {
  constructor() { this.k = []; this.v = [] }
  get size() { return this.k.length }
  push(key, val) {
    const k = this.k, v = this.v
    let i = k.length; k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]; ;[v[p], v[i]] = [v[i], v[p]]; i = p
    }
  }
  pop() {
    const k = this.k, v = this.v
    const top = v[0], last = k.length - 1
    k[0] = k[last]; v[0] = v[last]; k.pop(); v.pop()
    let i = 0
    for (;;) {
      const l = 2 * i + 1, r = l + 1
      let m = i
      if (l < k.length && k[l] < k[m]) m = l
      if (r < k.length && k[r] < k[m]) m = r
      if (m === i) break
      ;[k[m], k[i]] = [k[i], k[m]]; ;[v[m], v[i]] = [v[i], v[m]]; i = m
    }
    return top
  }
}

// A diagonal move is legal only when both orthogonal neighbours are passable
// (no corner cutting — a body would clip the corner tile).
function diagOk(nav, x, y, dx, dy, clearance) {
  return !(dx && dy) || (passable(nav, x + dx, y, clearance) && passable(nav, x, y + dy, clearance))
}

// A* over tiles passable at `clearance`, octile heuristic. Returns waypoints
// from the first step to the target (start excluded), [] if already there,
// or null when unreachable.
export function findPath(nav, sx, sy, tx, ty, clearance = 1) {
  const { w, h } = nav
  if (!passable(nav, sx, sy, clearance)) {
    const alt = nearestPassable(nav, sx, sy, clearance)
    if (!alt) return null
    sx = alt.x; sy = alt.y
  }
  if (!passable(nav, tx, ty, clearance)) {
    const alt = nearestPassable(nav, tx, ty, clearance)
    if (!alt) return null
    tx = alt.x; ty = alt.y
  }
  if (sx === tx && sy === ty) return []
  const g = new Float64Array(w * h).fill(Infinity)
  const came = new Int32Array(w * h).fill(-1)
  const hcost = (x, y) => {
    const ax = Math.abs(x - tx), ay = Math.abs(y - ty)
    return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay)
  }
  const heap = new MinHeap()
  const start = sy * w + sx, goal = ty * w + tx
  g[start] = 0
  heap.push(hcost(sx, sy), start)
  while (heap.size) {
    const i = heap.pop()
    if (i === goal) break
    const x = i % w, y = (i / w) | 0
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (!passable(nav, nx, ny, clearance) || !diagOk(nav, x, y, dx, dy, clearance)) continue
      const ni = ny * w + nx
      const ng = g[i] + (dx && dy ? SQRT2 : 1)
      if (ng < g[ni] - 1e-9) { g[ni] = ng; came[ni] = i; heap.push(ng + hcost(nx, ny), ni) }
    }
  }
  if (came[goal] === -1) return null
  const path = []
  for (let i = goal; i !== start; i = came[i]) path.push({ x: i % w, y: (i / w) | 0 })
  return path.reverse()
}
