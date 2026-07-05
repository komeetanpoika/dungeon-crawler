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
