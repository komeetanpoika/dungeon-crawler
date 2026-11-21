// A house's floor plan: a footprint (sometimes an L) cut into rooms by walls
// one cell thick, with a doorway between neighbours and the way out in the
// south wall. Pure in (size, rng).
//
// The grid, one character a cell:
//   ' ' outside the house     '#' wall top (the wall seen from above)
//   'u' 'l' the upper and lower rows of a wall face: the first two rows of
//           every room, where the wall above it is seen from the front
//   '.' floor    'd' a doorway    'E' the way out (a gap in the south wall)
//
// A room is { id, x0, x1, y0, y1, floorY0 }: x0..x1 its columns, y0 its
// upper face row, floorY0 = y0 + 2 its first floor row, y1 its last.

// Inner sizes (inside the outer walls) and room counts. Every size can reach
// its largest count: a vertical cut needs 3 + 1 + 3 columns, a horizontal
// cut 5 + 1 + 5 rows (two face rows and three floor rows a side).
export const SIZES = {
  small: { w: [7, 9], h: [7, 8], rooms: [1, 2] },
  medium: { w: [11, 13], h: [8, 10], rooms: [2, 3] },
  large: { w: [14, 17], h: [11, 13], rooms: [3, 4] },
  grand: { w: [17, 21], h: [12, 15], rooms: [4, 5] },
}
const MIN_W = 3, MIN_H = 5   // a room: 3 columns; 2 face rows + 3 floor rows
const L_CHANCE = 0.35

const between = (rng, lo, hi) => lo + Math.floor(((rng() + rng()) / 2) * (hi - lo + 1))
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))

const canV = r => r.x1 - r.x0 + 1 >= MIN_W * 2 + 1
const canH = r => r.y1 - r.y0 + 1 >= MIN_H * 2 + 1
function split(r, rng) {
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1
  // rooms read wider than tall (two of their rows are wall), so lean vertical
  const vertical = canV(r) && (!canH(r) || w >= h * 1.1 || (w >= h * 0.8 && rng() < 0.5))
  if (vertical) {
    const c = between(rng, r.x0 + MIN_W, r.x1 - MIN_W)
    return [{ ...r, x1: c - 1 }, { ...r, x0: c + 1 }]
  }
  const row = between(rng, r.y0 + MIN_H, r.y1 - MIN_H)
  return [{ ...r, y1: row - 1 }, { ...r, y0: row + 1 }]
}

// Cut the footprint into rects. Returns null when the count cannot be met.
function cut(W, H, target, rng, withL) {
  let rects = [{ x0: 1, x1: W, y0: 1, y1: H }]
  if (withL) {
    const cw = Math.round(W * (0.35 + rng() * 0.1)), ch = Math.round(H * (0.35 + rng() * 0.1))
    const left = rng() < 0.5
    // the full-height part and the lower wing, a wall between them
    const wing = left ? { x0: 1, x1: cw, y0: ch + 2, y1: H } : { x0: W - cw + 1, x1: W, y0: ch + 2, y1: H }
    const main = left ? { x0: cw + 2, x1: W, y0: 1, y1: H } : { x0: 1, x1: W - cw - 1, y0: 1, y1: H }
    if (wing.x1 - wing.x0 + 1 < MIN_W || wing.y1 - wing.y0 + 1 < MIN_H || main.x1 - main.x0 + 1 < MIN_W) return null
    rects = [main, wing]
  }
  while (rects.length < target) {
    const can = rects.filter(r => canV(r) || canH(r))
    if (!can.length) return null
    const big = can.reduce((a, b) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) > (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1) ? b : a)
    rects = rects.filter(r => r !== big).concat(split(big, rng))
  }
  return rects
}

// Shared walls between rooms, as door candidates.
function doorChoices(a, b) {
  const out = []
  if (a.x1 + 2 === b.x0 || b.x1 + 2 === a.x0) {
    const x = a.x1 + 2 === b.x0 ? a.x1 + 1 : b.x1 + 1
    for (let y = Math.max(a.floorY0, b.floorY0); y <= Math.min(a.y1, b.y1); y++) out.push({ axis: 'v', cells: [{ x, y }] })
  }
  if (a.y1 + 2 === b.y0 || b.y1 + 2 === a.y0) {
    const [up, lo] = a.y1 + 2 === b.y0 ? [a, b] : [b, a]
    const wide = lo.x1 - lo.x0 + 1 >= 5
    const from = Math.max(up.x0, lo.x0 + (wide ? 2 : 1)), to = Math.min(up.x1, lo.x1 - (wide ? 2 : 1))
    for (let x = from; x <= to; x++) out.push({ axis: 'h', cells: [{ x, y: up.y1 + 1 }, { x, y: lo.y0 }, { x, y: lo.y0 + 1 }] })
  }
  return out
}

function attempt(size, rng) {
  const S = SIZES[size]
  const W = int(rng, ...S.w), H = int(rng, ...S.h)
  const target = int(rng, ...S.rooms)
  const withL = (size === 'large' || size === 'grand') && rng() < L_CHANCE
  const rects = cut(W, H, target, rng, withL)
  if (!rects) return null
  const rooms = rects.map((r, id) => ({ id, ...r, floorY0: r.y0 + 2 }))
  const w = W + 2, h = H + 2
  const g = Array.from({ length: h }, () => new Array(w).fill(' '))
  for (const r of rooms) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++)
    g[y][x] = y === r.y0 ? 'u' : y === r.y0 + 1 ? 'l' : '.'
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (g[y][x] !== ' ') continue
    let near = false
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = g[y + dy]?.[x + dx]
      if (c === 'u' || c === 'l' || c === '.') { near = true; break }
    }
    if (near) g[y][x] = '#'
  }

  // doors: a random spanning tree over the rooms, plus a loop in a grand house
  const edges = []
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const ch = doorChoices(rooms[i], rooms[j])
    if (ch.length) edges.push({ a: rooms[i].id, b: rooms[j].id, ch })
  }
  for (let i = edges.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]] }
  const parent = rooms.map((_, i) => i)
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
  const doors = [], spare = []
  for (const e of edges) {
    if (find(e.a) !== find(e.b)) { parent[find(e.a)] = find(e.b); doors.push(e) } else spare.push(e)
  }
  if (new Set(rooms.map(r => find(r.id))).size > 1) return null
  if (size === 'grand' && spare.length) doors.push(spare[0])
  const placed = doors.map(e => {
    const d = e.ch[Math.floor(rng() * e.ch.length)]
    for (const c of d.cells) g[c.y][c.x] = 'd'
    return { a: e.a, b: e.b, axis: d.axis, x: d.cells[0].x, y: d.cells[0].y, cells: d.cells }
  })

  // the way out: the biggest room on the south wall, in its middle third
  const south = rooms.filter(r => r.y1 === H)
  const mid = (W + 1) / 2
  const area = r => (r.x1 - r.x0 + 1) * (r.y1 - r.floorY0 + 1)
  const entry = south.reduce((a, b) => area(b) > area(a) || (area(b) === area(a) && Math.abs((b.x0 + b.x1) / 2 - mid) < Math.abs((a.x0 + a.x1) / 2 - mid)) ? b : a)
  const third = Math.floor((entry.x1 - entry.x0 + 1) / 3)
  const ex = int(rng, entry.x0 + third, entry.x1 - third)
  g[h - 1][ex] = 'E'
  return {
    w, h, grid: g.map(r => r.join('')), rooms, doors: placed,
    exit: { x: ex, y: h - 1 }, spawn: { x: ex, y: h - 2 }, entry: entry.id,
  }
}

export function makePlan(size, rng) {
  if (!SIZES[size]) throw new Error(`makePlan: unknown size "${size}"`)
  for (let i = 0; i < 40; i++) {
    const p = attempt(size, rng)
    if (p) return p
  }
  throw new Error(`makePlan: no ${size} plan after 40 attempts`)
}
