// The road network of the Wilds: which towns are joined by road and which
// pieces the roads run through. Pure in the seed (no deal, no state): a link is
// a chain of edge-adjacent pieces found by a deterministic search, remembered
// per block. One league is one piece.
//
// Brickwork: every block's village is linked to the village of the block east
// of it; in every row one block in three (and others with odds EXTRA_SOUTH) is
// linked to the block south of it. Block (0,0) holds two towns, Koivula and the
// city; a link into or out of it ends at whichever of Koivula and the city's
// three land gates it reaches in fewest pieces.
import { hash, hashInt } from './rand.js'
import { blockVillage, villageAt, pieceBiome, fixedMain, pieceKey } from './layout.js'
import { isCityPiece, CITY } from './city/geometry.js'

export const EXTRA_SOUTH = 0.1
export const CITY_DOORS = [
  { gate: 'N', wx: 0, wy: 2, side: 'N' },
  { gate: 'W', wx: 0, wy: 2, side: 'W' },
  { gate: 'E', wx: 1, wy: 2, side: 'E' },
]
const CITY_TOWN = { key: 'city', name: CITY.name, wx: 0, wy: 2 }
const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
const OPPOSITE = { N: 'S', E: 'W', S: 'N', W: 'E' }
const mod = (n, m) => ((n % m) + m) % m
const CACHE_MAX = 400

export function townOf(seed, key) {
  if (key === 'city') return CITY_TOWN
  const [wx, wy] = String(key).split(',').map(Number)
  if (!Number.isInteger(wx) || !Number.isInteger(wy)) return null
  const v = villageAt(seed, wx, wy)
  return v ? { key: pieceKey(wx, wy), name: v.name, wx, wy } : null
}

const blockTown = (seed, bx, by) => {
  const v = blockVillage(seed, bx, by)
  return v ? townOf(seed, pieceKey(v.wx, v.wy)) : null
}

const stepCost = (seed, wx, wy) => {
  const b = pieceBiome(seed, wx, wy)
  return b === 'sea' ? 3 : b === 'mountain' ? 2 : 1
}

// Cheapest chain of pieces from `from` to `to` inclusive. City pieces and
// villages other than the two ends are walls. Ties are settled by a hash of
// the pieces, so the answer does not depend on visiting order.
function search(seed, from, to, grow) {
  const x0 = Math.min(from.wx, to.wx) - grow, x1 = Math.max(from.wx, to.wx) + grow
  const y0 = Math.min(from.wy, to.wy) - grow, y1 = Math.max(from.wy, to.wy) + grow
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const idx = (wx, wy) => (wy - y0) * w + (wx - x0)
  const px = i => x0 + i % w, py = i => y0 + Math.floor(i / w)
  const isEnd = (wx, wy) => (wx === from.wx && wy === from.wy) || (wx === to.wx && wy === to.wy)
  const wall = (wx, wy) => !isEnd(wx, wy) && (isCityPiece(wx, wy) || !!villageAt(seed, wx, wy))
  const cost = new Array(w * h).fill(Infinity), prev = new Array(w * h).fill(-1), done = new Array(w * h).fill(false)
  const tie = (wx, wy) => hashInt(seed, wx, wy, 332)
  cost[idx(from.wx, from.wy)] = 0
  for (;;) {
    let best = -1
    for (let i = 0; i < cost.length; i++) {
      if (done[i] || cost[i] === Infinity) continue
      if (best < 0 || cost[i] < cost[best] || (cost[i] === cost[best] && tie(px(i), py(i)) < tie(px(best), py(best)))) best = i
    }
    if (best < 0) return null
    done[best] = true
    const cx = px(best), cy = py(best)
    if (cx === to.wx && cy === to.wy) break
    for (const side of 'NESW') {
      const nx = cx + DIRS[side][0], ny = cy + DIRS[side][1]
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || wall(nx, ny)) continue
      const j = idx(nx, ny)
      if (done[j]) continue
      const c = cost[best] + stepCost(seed, nx, ny)
      if (c < cost[j] || (c === cost[j] && tie(cx, cy) < tie(px(prev[j]), py(prev[j])))) {
        cost[j] = c
        prev[j] = best
      }
    }
  }
  const route = []
  for (let i = idx(to.wx, to.wy); i >= 0; i = prev[i]) route.push({ wx: px(i), wy: py(i) })
  return route.reverse()
}

function findRoute(seed, from, to) {
  for (let grow = 1; grow <= 8; grow++) {
    const r = search(seed, from, to, grow)
    if (r) return r
  }
  return null
}

// The route from a village piece to a town of block (0,0): Koivula or one of
// the city's gates, whichever is fewest pieces (a tie goes to Koivula).
// Returns { town, route } with the route running village -> town.
function routeIntoHome(seed, v) {
  let best = null
  const koivula = findRoute(seed, v, { wx: 0, wy: 0 })
  if (koivula) best = { town: townOf(seed, '0,0'), route: koivula }
  for (const d of CITY_DOORS) {
    const out = { wx: d.wx + DIRS[d.side][0], wy: d.wy + DIRS[d.side][1] }
    const r = findRoute(seed, v, out)
    if (!r) continue
    const route = [...r, { wx: d.wx, wy: d.wy }]
    if (!best || route.length < best.route.length) best = { town: CITY_TOWN, route }
  }
  return best
}

const linkCache = new Map()
// The links owned by block (bx, by): its east link, its south link if it has
// one, and for block (0,0) Koivula to the city. `a` is the end in the owning
// block; the route runs a -> b.
export function linksOfBlock(seed, bx, by) {
  const key = `${seed}:${bx},${by}`
  let links = linkCache.get(key)
  if (links) return links
  links = []
  const own = bx === 0 && by === 0
  const ownVillage = blockTown(seed, bx, by)
  const joins = (tx, ty) => {
    const target = blockTown(seed, tx, ty)
    if (!ownVillage || !target) return
    if (own) {
      const r = routeIntoHome(seed, target)
      if (r) links.push({ a: r.town, b: target, route: r.route.slice().reverse() })
    } else if (tx === 0 && ty === 0) {
      const r = routeIntoHome(seed, ownVillage)
      if (r) links.push({ a: ownVillage, b: r.town, route: r.route })
    } else {
      const route = findRoute(seed, ownVillage, target)
      if (route) links.push({ a: ownVillage, b: target, route })
    }
  }
  joins(bx + 1, by)
  if (mod(bx, 3) === hashInt(seed, by, 0, 330) % 3 || hash(seed, bx, by, 331) < EXTRA_SOUTH) joins(bx, by + 1)
  if (own) links.push({ a: townOf(seed, '0,0'), b: CITY_TOWN, route: [{ wx: 0, wy: 0 }, { wx: 0, wy: 1 }, { wx: 0, wy: 2 }] })
  if (linkCache.size > CACHE_MAX) linkCache.clear()
  linkCache.set(key, links)
  return links
}

const blockOfPiece = (wx, wy) => [Math.floor(wx / 4), Math.floor(wy / 4)]

function sideOfStep(from, to) {
  return to.wx > from.wx ? 'E' : to.wx < from.wx ? 'W' : to.wy > from.wy ? 'S' : 'N'
}

// Per block: every edge its links use and the pieces that are farmland (the
// second piece out of a village or the last before a city gate).
const infoCache = new Map()
function infoOfBlock(seed, bx, by) {
  const key = `${seed}:${bx},${by}`
  let info = infoCache.get(key)
  if (info) return info
  const edges = new Set(), farm = new Set()
  for (const l of linksOfBlock(seed, bx, by)) {
    const r = l.route, n = r.length
    for (let i = 0; i + 1 < n; i++) {
      const s = sideOfStep(r[i], r[i + 1])
      edges.add(`${r[i].wx},${r[i].wy},${s}`)
      edges.add(`${r[i + 1].wx},${r[i + 1].wy},${OPPOSITE[s]}`)
    }
    if (n > 2) {
      farm.add(pieceKey(r[1].wx, r[1].wy))
      farm.add(pieceKey(r[n - 2].wx, r[n - 2].wy))
    }
  }
  info = { edges, farm }
  if (infoCache.size > CACHE_MAX) infoCache.clear()
  infoCache.set(key, info)
  return info
}

function nearbyInfos(seed, wx, wy) {
  const [bx, by] = blockOfPiece(wx, wy)
  const out = []
  for (let y = by - 2; y <= by + 2; y++) for (let x = bx - 2; x <= bx + 2; x++) out.push(infoOfBlock(seed, x, y))
  return out
}

export function roadSides(seed, wx, wy) {
  const infos = nearbyInfos(seed, wx, wy)
  const has = s => infos.some(i => i.edges.has(`${wx},${wy},${s}`))
  return { N: has('N'), E: has('E'), S: has('S'), W: has('W') }
}

export function roadsFrom(seed, townKey) {
  const town = townOf(seed, townKey)
  if (!town) return []
  const bx = Math.floor(town.wx / 4), by = Math.floor(town.wy / 4)
  const out = []
  for (const [x, y] of [[bx, by], [bx - 1, by], [bx, by - 1]]) {
    for (const l of linksOfBlock(seed, x, y)) {
      const fwd = l.a.key === townKey, back = l.b.key === townKey
      if (!fwd && !back) continue
      const route = fwd ? l.route : [...l.route].reverse()
      out.push({ town: fwd ? l.b : l.a, side: sideOfStep(route[0], route[1]), leagues: route.length - 1, route })
    }
  }
  return out.sort((p, q) => 'NESW'.indexOf(p.side) - 'NESW'.indexOf(q.side) || p.leagues - q.leagues)
}

export function townsAlong(seed, wx, wy, side) {
  const [bx, by] = blockOfPiece(wx, wy)
  const best = new Map()
  const note = (town, leagues) => {
    if (leagues < 1) return
    const cur = best.get(town.key)
    if (!cur || leagues < cur.leagues) best.set(town.key, { town, leagues })
  }
  for (let y = by - 2; y <= by + 2; y++) for (let x = bx - 2; x <= bx + 2; x++) {
    for (const l of linksOfBlock(seed, x, y)) {
      const r = l.route, n = r.length
      for (let i = 0; i < n; i++) {
        if (r[i].wx !== wx || r[i].wy !== wy) continue
        if (i + 1 < n && sideOfStep(r[i], r[i + 1]) === side) note(l.b, n - 1 - i)
        if (i > 0 && sideOfStep(r[i], r[i - 1]) === side) note(l.a, i)
      }
    }
  }
  return [...best.values()].sort((p, q) => p.leagues - q.leagues || (p.town.key < q.town.key ? -1 : 1)).slice(0, 2)
}

export function pieceClass(seed, wx, wy) {
  if (isCityPiece(wx, wy)) return 'city'
  if (villageAt(seed, wx, wy)) return 'village'
  if (fixedMain(wx, wy)) return 'fixed'
  if (nearbyInfos(seed, wx, wy).some(i => i.farm.has(pieceKey(wx, wy)))) return 'farmland'
  const s = roadSides(seed, wx, wy)
  return s.N || s.E || s.S || s.W ? 'roadside' : 'wild'
}
