// Kalevanlinna's generated blocks: the land between the fixed streets, cut into
// lots (houses, shops, workshops, cottages), alleys, yards and gardens. Pure in
// the world seed: the same seed gives the same blocks on every visit.
//
// Output of `cutBlocks(seed)`, all in city tiles (0..159), rects inclusive:
//   lots    { id, district, x0, y0, x1, y1, front, kind, storeys, wall, roof, sign, door }
//           `front` is the side facing the street or alley; `door` is the lot's
//           front-face cell, and the cell in front of it is a street or alley cell.
//           Lots in a row share walls (terraced); frontage 3-5, depth 4-7.
//   alleys  { pts: [[x0, y0], [x1, y1]], w: 1 | 2 } rastered like streets (w 2 =
//           the given cell and the next one, to the east or south). Each alley
//           joins a street or another alley at both ends. There are no dead-end
//           alleys at all (stricter than "ends at a door").
//   yards, gardens  rects of leftover land behind lots (never covering lots or alleys)
// `reserved()` lists the footprints no lot, yard or garden may cover (the point
// places); the windmill also keeps a one-tile clear ring (`clear`).
import { mulberry32, hashInt } from '../rand.js'
import { PLAN, streetCells, districtAt } from './plan.js'

const S = 160
const key = (x, y) => y * S + x
const FREE = 1, ALLEY = 2, LOT = 3

export function reserved() {
  const { windmill, fountain, crier, stocks } = PLAN.places
  const box = (p, r) => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r })
  return [
    { id: 'windmill', ...box(windmill, 1), clear: box(windmill, 2) },
    { id: 'fountain', ...box(fountain, 1) },
    { id: 'crier', ...box(crier, 0) },
    { id: 'stocks', ...box(stocks, 0) },
  ]
}

const FRONTS = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }
const pick = (rng, a) => a[Math.floor(rng() * a.length)]
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
const weighted = (rng, table) => {
  let t = rng() * table.reduce((s, [, w]) => s + w, 0)
  for (const [v, w] of table) { if ((t -= w) < 0) return v }
  return table[table.length - 1][0]
}

function freeGrid() {
  const g = new Uint8Array(S * S)
  const sc = streetCells()
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (districtAt(x, y) && !sc.has(key(x, y))) g[key(x, y)] = FREE
  // explicit exclusions, whatever districtAt says: basin and mouth, fixed places, reserved footprints
  const { basin, mouth } = PLAN.harbour
  const cut = c => { for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) g[key(x, y)] = 0 }
  cut({ ...basin, y1: mouth.y }); cut({ x0: mouth.x0, x1: mouth.x1, y0: mouth.y, y1: mouth.y })
  for (const p of Object.values(PLAN.places)) if (p.x0 !== undefined) cut(p)
  for (const r of reserved()) cut(r.clear || r)
  return g
}

export function cutBlocks(seed) {
  const rng = mulberry32(hashInt(seed, 0, 0, 9101))
  const sc = streetCells()
  const g = freeGrid()
  const open = (x, y) => sc.has(key(x, y)) || (x >= 0 && y >= 0 && x < S && y < S && g[key(x, y)] === ALLEY)
  const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : g[key(x, y)])

  // ---- alleys: straight cuts through the wide blocks, street to street ----
  const alleys = []
  const spanFree = (x, y, dx, dy) => { let n = 0; while (at(x + dx * (n + 1), y + dy * (n + 1)) === FREE) n++; return n }
  const components = () => {
    const seen = new Uint8Array(S * S); const out = []
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (g[key(x, y)] !== FREE || seen[key(x, y)]) continue
      const c = { x0: x, x1: x, y0: y, y1: y }; const q = [[x, y]]; seen[key(x, y)] = 1
      while (q.length) {
        const [a, b] = q.pop()
        c.x0 = Math.min(c.x0, a); c.x1 = Math.max(c.x1, a); c.y0 = Math.min(c.y0, b); c.y1 = Math.max(c.y1, b)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = a + dx, ny = b + dy
          if (at(nx, ny) === FREE && !seen[key(nx, ny)]) { seen[key(nx, ny)] = 1; q.push([nx, ny]) }
        }
      }
      out.push(c)
    }
    return out
  }
  // cells (p, q): p across the alley, q along it; vertical alley = p is x
  const cell = (vert, p, q) => (vert ? [p, q] : [q, p])
  const tryAlley = (vert, pos, w, comp) => {
    const [a0, a1] = vert ? [comp.y0, comp.y1] : [comp.x0, comp.x1]
    const rowFree = q => { for (let i = 0; i < w; i++) { const [x, y] = cell(vert, pos + i, q); if (at(x, y) !== FREE) return false } return true }
    const openAt = q => { for (let i = 0; i < w; i++) { const [x, y] = cell(vert, pos + i, q); if (!open(x, y)) return false } return true }
    for (let q = a0; q <= a1; q++) {
      if (!rowFree(q)) continue
      let e = q; while (e + 1 <= a1 + 1 && rowFree(e + 1)) e++
      const run = [q, e]; q = e
      if (run[1] - run[0] + 1 < 8 || !openAt(run[0] - 1) || !openAt(run[1] + 1)) continue
      const mid = (run[0] + run[1]) >> 1
      const [mx, my] = cell(vert, pos, mid)
      const [dx, dy] = vert ? [1, 0] : [0, 1]
      if (spanFree(mx, my, -dx, -dy) < 6 || spanFree(mx + dx * (w - 1), my + dy * (w - 1), dx, dy) < 6) continue
      for (let k = run[0]; k <= run[1]; k++) for (let i = 0; i < w; i++) { const [x, y] = cell(vert, pos + i, k); g[key(x, y)] = ALLEY }
      alleys.push({ pts: [cell(vert, pos, run[0]), cell(vert, pos, run[1])], w })
      return true
    }
    return false
  }
  for (const vert of [true, false]) {
    for (const comp of components()) {
      const [lo, hi] = vert ? [comp.x0, comp.x1] : [comp.y0, comp.y1]
      let pos = lo + 8 + int(rng, 0, 4)
      while (pos <= hi - 8) {
        const w = rng() < 0.35 ? 2 : 1
        let placed = null
        for (const off of [0, 1, -1, 2, -2, 3, -3]) if (tryAlley(vert, pos + off, w, comp)) { placed = pos + off; break }
        pos = (placed ?? pos) + int(rng, 12, 20)
      }
    }
  }

  // ---- lots along every street and alley face ----
  const lots = []
  const raw = []
  const frontage = n => { // widths 3-5 that never leave a 1-2 cell sliver
    const out = []
    while (n >= 3) {
      let w = n <= 5 ? n : int(rng, 3, 5)
      if (n - w > 0 && n - w < 3) w = n - 3
      out.push(w); n -= w
    }
    return out
  }
  for (const front of ['S', 'N', 'E', 'W']) {
    const [fx, fy] = FRONTS[front]
    const horizFront = fy !== 0 // the frontage runs along x
    const ax = horizFront ? 1 : 0, ay = horizFront ? 0 : 1
    const ready = (x, y) => at(x, y) === FREE && open(x + fx, y + fy)
    for (let line = 0; line < S; line++) {
      for (let p = 0; p < S; p++) {
        const [x, y] = horizFront ? [p, line] : [line, p]
        if (!ready(x, y)) continue
        let n = 0; while (p + n < S && ready(x + ax * n, y + ay * n)) n++
        let off = 0
        for (const w of frontage(n)) {
          const sx = x + ax * off, sy = y + ay * off
          off += w
          // depth available behind the frontage (unclaimed free cells), shortest column
          let avail = 99
          for (let i = 0; i < w; i++) { let d = 0; while (at(sx + ax * i - fx * d, sy + ay * i - fy * d) === FREE) d++; avail = Math.min(avail, d) }
          if (avail < 4) continue
          let depth = int(rng, 4, 7)
          if (avail <= 7) depth = avail
          else if (avail - depth < 4) depth = avail - 4 >= 4 ? avail - 4 : avail
          depth = Math.min(depth, avail)
          const xs = [sx, sx + ax * (w - 1), sx - fx * (depth - 1), sx + ax * (w - 1) - fx * (depth - 1)]
          const ys = [sy, sy + ay * (w - 1), sy - fy * (depth - 1), sy + ay * (w - 1) - fy * (depth - 1)]
          const lot = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), front, w }
          for (let yy = lot.y0; yy <= lot.y1; yy++) for (let xx = lot.x0; xx <= lot.x1; xx++) g[key(xx, yy)] = LOT
          raw.push(lot)
        }
        p += n - 1
      }
    }
  }

  // ---- flavour ----
  raw.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const byDistrict = new Map()
  for (const r of raw) {
    r.district = districtAt((r.x0 + r.x1) >> 1, (r.y0 + r.y1) >> 1) || districtAt(r.x0, r.y0)
    r.street = sc.has(key(r.x0 + (r.front === 'E' ? r.x1 - r.x0 + 1 : r.front === 'W' ? -1 : 0), r.y0 + (r.front === 'S' ? r.y1 - r.y0 + 1 : r.front === 'N' ? -1 : 0)))
    r.roll = rng()
    if (!byDistrict.has(r.district)) byDistrict.set(r.district, [])
    byDistrict.get(r.district).push(r)
  }
  const MIX = { // [main kind, share], then weights for the rest
    market: ['shop', 0.72, [['house', 5], ['workshop', 2], ['cottage', 1]]],
    crafts: ['workshop', 0.55, [['house', 4], ['shop', 1], ['cottage', 2]]],
    harbour: ['cottage', 0.6, [['workshop', 3], ['house', 2]]],
    gardens: ['house', 0.6, [['cottage', 1]]],
  }
  const STOREYS = { market: [['2', 3], ['3', 2]], crafts: [['2', 3], ['3', 1], ['1', 1]], harbour: [['1', 3], ['2', 2]], gardens: [['1', 2], ['2', 3]] }
  const WALLS = { market: [['plaster', 4], ['stone', 3], ['wood', 1]], crafts: [['stone', 3], ['wood', 2], ['plaster', 2]], harbour: [['wood', 5], ['plaster', 1], ['stone', 1]], gardens: [['wood', 3], ['plaster', 3], ['stone', 1]] }
  for (const [d, list] of byDistrict) {
    const [main, share, rest] = MIX[d]
    const order = [...list].sort((a, b) => (b.street - a.street) || (a.roll - b.roll))
    const quota = Math.ceil(list.length * share)
    order.forEach((l, i) => { l.kind = i < quota ? main : weighted(rng, rest) })
  }
  const SIGNS = ['baker', 'butcher', 'cloth', 'cooper', 'apothecary']
  raw.forEach((r, i) => {
    const d = r.district
    let storeys = +weighted(rng, STOREYS[d])
    if (r.kind === 'cottage') storeys = 1
    if (r.w === 3 && storeys === 3) storeys = 2
    lots.push({
      id: 'L' + i, district: d, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, front: r.front, kind: r.kind, storeys,
      wall: weighted(rng, WALLS[d]), roof: pick(rng, ['red', 'blue', 'slate']),
      sign: r.kind === 'shop' ? pick(rng, SIGNS) : r.kind === 'workshop' && rng() < 0.3 ? 'cooper' : null,
      door: doorOf(r, rng),
    })
  })

  // ---- yards and gardens from what is left behind the lots ----
  const yards = [], gardens = []
  const used = new Uint8Array(S * S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (g[key(x, y)] !== FREE || used[key(x, y)]) continue
    let x1 = x; while (at(x1 + 1, y) === FREE && !used[key(x1 + 1, y)]) x1++
    let y1 = y
    grow: while (true) {
      for (let xx = x; xx <= x1; xx++) if (at(xx, y1 + 1) !== FREE || used[key(xx, y1 + 1)]) break grow
      y1++
    }
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[key(xx, yy)] = 1
    if (x1 - x < 1 || y1 - y < 1) continue // slivers stay bare ground
    const rect = { x0: x, y0: y, x1, y1 }
    ;(districtAt(x, y) === 'gardens' || (districtAt(x, y) !== 'market' && rng() < 0.3) ? gardens : yards).push(rect)
  }
  return { lots, alleys, yards, gardens }
}

function doorOf(r, rng) {
  const along = int(rng, 0, r.w - 1)
  switch (r.front) {
    case 'S': return { x: r.x0 + along, y: r.y1 }
    case 'N': return { x: r.x0 + along, y: r.y0 }
    case 'E': return { x: r.x1, y: r.y0 + along }
    default: return { x: r.x0, y: r.y0 + along }
  }
}
