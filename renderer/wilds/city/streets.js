// Kalevanlinna's street graph: the cells people walk on, and a router over
// them. Pure; built once with the city (City.streets).
//
// Lanes are the walkable paved cells (streets, alleys, squares, quays and
// their piers, the gate arches) and the dirt roads outside, minus the door cells. Every other walkable cell within
// SNAP_RANGE steps of a lane hangs off the nearest lane by a short chain
// (a door's front cell, a stall's spot, a gate's -out spot outside the wall),
// so any tile near a street can be a start or an end. Adjacency is
// precomputed once (CSR typed arrays); a query is an A* over lane cells with
// reused scratch arrays, its path cut to waypoints at turns and every
// MAX_LEG tiles at most, each leg a straight line (orthogonal or diagonal)
// over lane cells.
import { isWalkable } from '../../systems/entities.js'
import { isTop } from '../over.js'

const N = 160
const MAX_LEG = 6
const SNAP_RANGE = 10
const STRAIGHT = 10, DIAG = 14
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const idx = (x, y) => y * N + x

// paving, the quays' piers, and the dirt roads outside the walls (to the farms)
const isLaneCell = c => (typeof c.skin === 'string' && /^ow_(city_pave|dirt_|path_sand)/.test(c.skin))
  || (typeof c.overlay === 'string' && c.overlay.startsWith('ow_pier_deck'))

export function buildStreetGraph(city) {
  const walk = new Uint8Array(N * N)
  const lane = new Uint8Array(N * N)
  // every cell of a door (a double door is two): an end, never a lane
  const doorAt = new Set(city.doors.flatMap(d => Array.from({ length: d.span ?? 1 }, (_, i) => idx(d.x + i, d.y))))
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = city.cells[y][x]
    if (!isWalkable(c.tile, c)) continue
    // the row under a roof's or a wall's top (over.js) is no street: the town
    // keeps to the ways it had (a gate's arch is `over` too, and is one)
    if (isTop(c)) continue
    walk[idx(x, y)] = 1
    if (isLaneCell(c) && !doorAt.has(idx(x, y))) lane[idx(x, y)] = 1
  }
  // adjacency (8-way, a diagonal only past two lane corners)
  const off = new Int32Array(N * N + 1)
  const to = []
  for (let i = 0; i < N * N; i++) {
    off[i] = to.length
    if (!lane[i]) continue
    const x = i % N, y = (i / N) | 0
    for (const [dx, dy] of D8) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || !lane[idx(nx, ny)]) continue
      if (dx && dy && !(lane[idx(x + dx, y)] && lane[idx(x, y + dy)])) continue
      to.push(idx(nx, ny))
    }
  }
  off[N * N] = to.length
  const adj = Int32Array.from(to)

  // snap: multi-source BFS from lanes through walkable non-lane cells
  const snapNext = new Int32Array(N * N).fill(-1) // the next cell towards the lane
  const snapDist = new Int16Array(N * N).fill(-1)
  const q = []
  for (let i = 0; i < N * N; i++) if (lane[i]) { snapDist[i] = 0; q.push(i) }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]
    if (snapDist[i] >= SNAP_RANGE || doorAt.has(i)) continue // a door is an end, never a way through
    const x = i % N, y = (i / N) | 0
    for (const [dx, dy] of D8.slice(0, 4)) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue
      const j = idx(nx, ny)
      if (!walk[j] || snapDist[j] >= 0) continue
      snapDist[j] = snapDist[i] + 1; snapNext[j] = i; q.push(j)
    }
  }

  const n = N * N
  return {
    n: N, lane, walk, off, adj, snapNext, snapDist,
    g: new Float64Array(n), from: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint8Array(n),
    run: 0, heap: new Int32Array(adj.length + 2), heapF: new Float64Array(adj.length + 2),
  }
}

// the chain from a tile to the lane it hangs off: [tile, ..., laneCell] as indexes, or null
function chain(G, x, y) {
  let i = idx(x, y)
  if (x < 0 || y < 0 || x >= N || y >= N || G.snapDist[i] < 0) return null
  const out = [i]
  while (!G.lane[i]) { i = G.snapNext[i]; out.push(i) }
  return out
}

function heapPush(G, st, i, f) {
  let k = st.size++
  while (k > 0) {
    const p = (k - 1) >> 1
    if (G.heapF[p] <= f) break
    G.heapF[k] = G.heapF[p]; G.heap[k] = G.heap[p]; k = p
  }
  G.heapF[k] = f; G.heap[k] = i
}
function heapPop(G, st) {
  const top = G.heap[0]
  const f = G.heapF[--st.size], i = G.heap[st.size]
  let k = 0
  for (;;) {
    let c = 2 * k + 1
    if (c >= st.size) break
    if (c + 1 < st.size && G.heapF[c + 1] < G.heapF[c]) c++
    if (G.heapF[c] >= f) break
    G.heapF[k] = G.heapF[c]; G.heap[k] = G.heap[c]; k = c
  }
  G.heapF[k] = f; G.heap[k] = i
  return top
}

function astar(G, s, t) {
  if (s === t) return [s]
  const run = ++G.run
  const tx = t % N, ty = (t / N) | 0
  const hf = i => {
    const dx = Math.abs((i % N) - tx), dy = Math.abs(((i / N) | 0) - ty)
    return STRAIGHT * (dx + dy) + (DIAG - 2 * STRAIGHT) * Math.min(dx, dy)
  }
  const st = { size: 0 }
  G.stamp[s] = run; G.g[s] = 0; G.from[s] = -1; G.closed[s] = 0
  heapPush(G, st, s, hf(s))
  while (st.size) {
    const i = heapPop(G, st)
    if (i === t) {
      const path = []
      for (let c = t; c !== -1; c = G.from[c]) path.push(c)
      return path.reverse()
    }
    if (G.closed[i] === 1 && G.stamp[i] === run) continue
    G.closed[i] = 1
    const x = i % N, y = (i / N) | 0
    for (let e = G.off[i]; e < G.off[i + 1]; e++) {
      const j = G.adj[e]
      const nx = j % N, ny = (j / N) | 0
      const ng = G.g[i] + (nx !== x && ny !== y ? DIAG : STRAIGHT)
      if (G.stamp[j] !== run) { G.stamp[j] = run; G.closed[j] = 0 } else if (ng >= G.g[j]) continue
      G.g[j] = ng; G.from[j] = i; heapPush(G, st, j, ng + hf(j))
    }
  }
  return null
}

// cells -> waypoints: turns kept, long straight runs cut every MAX_LEG tiles
function waypoints(cells) {
  const pts = cells.map(i => ({ x: i % N, y: (i / N) | 0 }))
  if (pts.length <= 1) return pts
  const out = [pts[0]]
  let last = 0, dir = null
  for (let k = 1; k < pts.length; k++) {
    const d = `${pts[k].x - pts[k - 1].x},${pts[k].y - pts[k - 1].y}`
    if (dir !== null && d !== dir) { out.push(pts[k - 1]); last = k - 1 }
    else if (k - last >= MAX_LEG) { out.push(pts[k]); last = k }
    dir = d
  }
  const end = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (tail.x !== end.x || tail.y !== end.y) out.push(end)
  return out
}

// City tiles from `from` to `to` inclusive, or null when either is not on or
// within a few steps of a street, or no street joins them. A door is reached
// through its front cell and the last point is the door cell.
export function route(G, from, to) {
  const a = chain(G, from.x, from.y), b = chain(G, to.x, to.y)
  if (!a || !b) return null
  const core = astar(G, a[a.length - 1], b[b.length - 1])
  if (!core) return null
  const cells = [...a.slice(0, -1), ...core, ...b.slice(0, -1).reverse()]
  return waypoints(cells)
}
