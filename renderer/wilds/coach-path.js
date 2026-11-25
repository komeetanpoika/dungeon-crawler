// The coach's way (coach-ride.js drives it): from the cart at the stop it
// leaves, onto the road, along the road's middle lane through every piece of
// the road (roads.js roadsFrom: its route), to the cart at the far stop. Into
// Kalevanlinna, the outside road takes it to the gate its road comes to,
// through the gate and along the city's streets (its street graph,
// city/streets.js) to the inn yard's cart; out of it the same way back. World
// tiles, each step to one of the four neighbours. DOM-free, and pure in the
// world's seed and its pieces' deals: it reads the pieces as generated
// (getPiece) and Kalevanlinna as built (cityFor).
//
// Where a road crosses from one piece to the next it does so on the gate's
// lanes, g..g+ROAD_WIDTH-1 (terrain.js); the coach crosses on the middle one.
// Inside a piece it keeps to the middle of the road: a road cell beside the
// road's edge costs more, and so does a turn. Where the road does not go
// through (on a tale's place the roads each end at the place: features.js),
// the coach crosses what lies between over as few cells off the road as can
// be, and keeps to the road everywhere else.
import { roadsFrom, townOf } from './roads.js'
import { getPiece } from './world.js'
import { PIECE, gateAt, pieceKey } from './layout.js'
import { ROAD_WIDTH, roadLane0 } from './terrain.js'
import { boardingTile, isRoadCell } from './coach.js'
import { cityFor } from './city/build.js'
import { CITY_KEYS, isCityPiece, fromCity, toCity } from './city/geometry.js'
import { PLAN, insideWalls } from './city/plan.js'
import { isGate, isTop } from './over.js'
import { TILE } from '../systems/entities.js'

// The horse and the cart a stop stands beside (sites.js coach, city/build-fixed.js
// the inn's yard): the horse west, the cart east of it.
export const CART = Object.freeze(['ow_prop_city_cart_horse', 'ow_prop_city_cart'])
const EDGE = 4          // a road cell beside the road's edge (one of its four neighbours is not road)
const TURN = 1          // a change of direction
const NOT_LANE = 6      // a city cell the street graph hangs off a street (a door's front, a yard's way in)
const AT_STOP = 20      // the city's boarding cell (the coach goes round it where it can)
// A walkable cell off the road: dearer than any way along the road through a
// piece could be (80 x 80 cells at 1 + EDGE + TURN each), so a way crosses as
// few of them as it can, and only where the road itself does not go on
const OFF_ROAD = 1e5
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const cellAt = (world, X, Y) => {
  const wx = Math.floor(X / PIECE), wy = Math.floor(Y / PIECE)
  return getPiece(world, wx, wy).cells[Y - wy * PIECE]?.[X - wx * PIECE] ?? null
}
// a cell the coach drives on outside the city: the road's ground, its planks
// over water, the cobbles it wears in a village; walkable
export const onRoad = c => !!c && c.tile === TILE.FLOOR && isRoadCell(c)
// what stands on a cell, a cart taken off it for a ride included (coach-ride.js)
const artOf = c => c?.hiddenCart ?? c?.overlay ?? null

// The world tiles of the horse (H) and the cart (C) beside a town's stop, or null.
export function cartOf(world, townKey) {
  const b = boardingTile(world, townKey)
  if (!b) return null
  for (const [dx, dy] of N4) {
    const X = b.X + dx, Y = b.Y + dy, art = artOf(cellAt(world, X, Y))
    if (art === CART[0]) return { H: { X, Y }, C: { X: X + 1, Y } }
    if (art === CART[1]) return { H: { X: X - 1, Y }, C: { X, Y } }
  }
  return null
}

const sideOf = (a, b) => (b.wx > a.wx ? 'E' : b.wx < a.wx ? 'W' : b.wy > a.wy ? 'S' : 'N')

// Where the road crosses from piece a into the next piece b: the cell on a's
// edge and the cell on b's, both on the middle lane.
export function crossing(seed, a, b) {
  const side = sideOf(a, b)
  const m = roadLane0(gateAt(seed, a.wx, a.wy, side)) + (ROAD_WIDTH >> 1)
  const X0 = a.wx * PIECE, Y0 = a.wy * PIECE
  if (side === 'E') return { out: { X: X0 + PIECE - 1, Y: Y0 + m }, in: { X: X0 + PIECE, Y: Y0 + m } }
  if (side === 'W') return { out: { X: X0, Y: Y0 + m }, in: { X: X0 - 1, Y: Y0 + m } }
  if (side === 'S') return { out: { X: X0 + m, Y: Y0 + PIECE - 1 }, in: { X: X0 + m, Y: Y0 + PIECE } }
  return { out: { X: X0 + m, Y: Y0 }, in: { X: X0 + m, Y: Y0 - 1 } }
}

// The pieces a ride along `route` sees: every piece of it and the eight
// round each, and Kalevanlinna's four (and theirs) when it is one end. Keys.
export function ridePieces(route) {
  const keys = new Set()
  const add = (wx, wy) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.add(pieceKey(wx + dx, wy + dy)) }
  for (const p of route) add(p.wx, p.wy)
  if (route.some(p => isCityPiece(p.wx, p.wy))) for (const k of CITY_KEYS) add(...k.split(',').map(Number))
  return [...keys]
}

// The coach's way from the cart of `fromKey` to the cart of `toKey` (towns
// one road apart: roadsFrom), or null if no road joins them. World tiles.
export function coachPath(world, fromKey, toKey) {
  const road = roadsFrom(world.seed, fromKey).find(r => r.town.key === toKey)
  if (!road) return null
  const route = road.route, n = route.length
  const cross = route.slice(1).map((p, i) => crossing(world.seed, route[i], p))
  const way = townLeg(world, fromKey, route[0], route[1], cross[0].out)
  for (let i = 1; i < n - 1; i++) way.push(...roadLeg(world, route[i], cross[i - 1].in, cross[i].out))
  way.push(...townLeg(world, toKey, route[n - 1], route[n - 2], cross[n - 2].in).reverse())
  return Object.freeze(way.map(p => Object.freeze({ X: p.X, Y: p.Y })))
}

// From a town's cart to `edge`, where its road leaves its piece toward `next`.
function townLeg(world, key, piece, next, edge) {
  return key === 'city' ? cityLeg(world, sideOf(piece, next), edge) : villageLeg(world, key, edge)
}

// Through a piece of the road, from where it comes in to where it goes on.
function roadLeg(world, p, from, to) {
  const piece = getPiece(world, p.wx, p.wy)
  const box = { x0: p.wx * PIECE, y0: p.wy * PIECE, w: PIECE, h: PIECE }
  return cheapest(box, from, to, wayCost(piece, box)) ?? bend(from, to)
}

// What entering a cell of `piece` costs: a road cell 1, more beside the
// road's edge (a cell out of the box is no edge: the road goes on there); a
// walkable cell off the road OFF_ROAD, but never a doorway, a cave's mouth or
// a cell walked under (a roof's top row: over.js), nor one `shut` names;
// Infinity for the rest.
function wayCost(piece, box, shut = () => false) {
  const local = (X, Y) => piece.cells[Y - box.y0]?.[X - box.x0]
  const openings = new Set([...piece.doors, ...piece.caves].map(d => `${box.x0 + d.x},${box.y0 + d.y}`))
  return (X, Y) => {
    const c = local(X, Y)
    if (!c || c.tile !== TILE.FLOOR || shut(X, Y)) return Infinity
    if (!isRoadCell(c)) return isTop(c) || openings.has(`${X},${Y}`) ? Infinity : OFF_ROAD
    for (const [dx, dy] of N4) {
      const n = local(X + dx, Y + dy)
      if (n && !onRoad(n)) return 1 + EDGE
    }
    return 1
  }
}

// The last resort, where nothing walkable joins two cells (it should not happen): a plain bend.
function bend(from, to) {
  const out = [{ X: from.X, Y: from.Y }]
  let { X, Y } = from
  while (X !== to.X) { X += Math.sign(to.X - X); out.push({ X, Y }) }
  while (Y !== to.Y) { Y += Math.sign(to.Y - Y); out.push({ X, Y }) }
  return out
}

// A village: from its cart onto the road (the cart stands with the horse or
// the cart itself beside it: features.js layCoachStop), so off the road only
// on the cart's own two cells; then the road to `edge`. Never over the stop
// or where the coachman stands.
function villageLeg(world, key, edge) {
  const town = townOf(world.seed, key)
  const piece = getPiece(world, town.wx, town.wy)
  const box = { x0: town.wx * PIECE, y0: town.wy * PIECE, w: PIECE, h: PIECE }
  const cart = cartOf(world, key), stop = boardingTile(world, key)
  const man = piece.spawns.find(s => s.coachman)
  const isCart = (X, Y) => !!cart && ((X === cart.H.X && Y === cart.H.Y) || (X === cart.C.X && Y === cart.C.Y))
  const way = wayCost(piece, box, (X, Y) => (stop && X === stop.X && Y === stop.Y) || (man && X === box.x0 + man.x && Y === box.y0 + man.y))
  const cost = (X, Y) => (isCart(X, Y) ? 1 : way(X, Y))
  const from = cart?.C ?? stop ?? { X: box.x0 + piece.spawnPoint.x, Y: box.y0 + piece.spawnPoint.y }
  return cheapest(box, from, edge, cost) ?? bend(from, edge)
}

// Kalevanlinna: from the inn yard's cart along the streets to the arch of
// the gate on `gate`'s side, then out along the road to `edge`. Inside the
// walls only, then outside only (the arch is both), so it passes that gate;
// never in the castle's plot (its gate is let down at night). The street
// graph's cells: its lanes, and the cells that hang off them (a yard's way in
// over a strip of grass costs more); no door.
function cityLeg(world, gate, edge) {
  const city = cityFor(world.seed), G = city.streets, N = city.cells.length
  const cart = cartOf(world, 'city')
  const g = PLAN.gates[gate]
  const arch = fromCity(g.x, g.y)
  const doors = new Set(city.doors.flatMap(d => Array.from({ length: d.span ?? 1 }, (_, i) => (d.y * N) + d.x + i)))
  const castle = PLAN.places.castle
  const street = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return false
    const i = cy * N + cx
    return G.walk[i] === 1 && G.snapDist[i] >= 0 && !doors.has(i) &&
      !(cx >= castle.x0 && cx <= castle.x1 && cy >= castle.y0 && cy <= castle.y1)
  }
  const isCart = (X, Y) => !!cart && ((X === cart.H.X && Y === cart.H.Y) || (X === cart.C.X && Y === cart.C.Y))
  const stop = city.coach
  const cost = inside => (X, Y) => {
    if (isCart(X, Y)) return 1
    const { cx, cy } = toCity(X, Y)
    if (!street(cx, cy)) return Infinity
    const c = city.cells[cy][cx]
    if (!isGate(c.overlay) && !isGate(c.deco) && insideWalls(cx, cy) !== inside) return Infinity
    let k = G.lane[cy * N + cx] ? 1 : NOT_LANE
    if (N4.some(([dx, dy]) => !street(cx + dx, cy + dy) && !isCart(X + dx, Y + dy))) k += EDGE
    if (stop && cx === stop.x && cy === stop.y) k += AT_STOP
    return k
  }
  const box = { x0: fromCity(0, 0).X, y0: fromCity(0, 0).Y, w: N, h: N }
  const from = cart?.C ?? (stop ? fromCity(stop.x, stop.y) : arch)
  const inward = cheapest(box, from, arch, cost(true)) ?? bend(from, arch)
  const outward = cheapest(box, arch, edge, cost(false)) ?? bend(arch, edge)
  return [...inward, ...outward.slice(1)]
}

// The cheapest way from `from` to `to` by steps to the four neighbours inside
// `box` (world tiles x0, y0, w, h): entering a cell costs `cost(X, Y)`
// (Infinity: it is shut), each change of direction TURN more. Ties are
// settled by the order of the steps, so the answer is the same every time.
// [{ X, Y }] from `from` to `to`, or null.
function cheapest(box, from, to, cost) {
  const { x0, y0, w, h } = box
  const inBox = p => p.X >= x0 && p.Y >= y0 && p.X < x0 + w && p.Y < y0 + h
  if (!inBox(from) || !inBox(to)) return null
  if (from.X === to.X && from.Y === to.Y) return [{ X: from.X, Y: from.Y }]
  const n = w * h
  const enter = new Float64Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) enter[y * w + x] = cost(x0 + x, y0 + y)
  const dist = new Float64Array(n * 4).fill(Infinity), prev = new Int32Array(n * 4).fill(-1)
  const s = (from.Y - y0) * w + (from.X - x0), t = (to.Y - y0) * w + (to.X - x0)
  const heap = makeHeap()
  const step = (i, d) => {
    const x = i % w, y = (i / w) | 0, nx = x + N4[d][0], ny = y + N4[d][1]
    return nx < 0 || ny < 0 || nx >= w || ny >= h ? -1 : ny * w + nx
  }
  for (let d = 0; d < 4; d++) {
    const j = step(s, d)
    if (j < 0 || enter[j] === Infinity) continue
    dist[j * 4 + d] = enter[j]
    prev[j * 4 + d] = -2 - s
    heap.push(enter[j], j * 4 + d)
  }
  let end = -1
  while (heap.size()) {
    const [k, st] = heap.pop()
    if (k > dist[st]) continue
    const i = st >> 2, d = st & 3
    if (i === t) { end = st; break }
    for (let e = 0; e < 4; e++) {
      const j = step(i, e)
      if (j < 0 || j === s || enter[j] === Infinity) continue
      const nk = k + enter[j] + (e === d ? 0 : TURN)
      if (nk < dist[j * 4 + e]) { dist[j * 4 + e] = nk; prev[j * 4 + e] = st; heap.push(nk, j * 4 + e) }
    }
  }
  if (end < 0) return null
  const out = []
  for (let st = end; ; st = prev[st]) {
    const i = st >> 2
    out.push({ X: x0 + i % w, Y: y0 + ((i / w) | 0) })
    if (prev[st] <= -2) break
  }
  out.push({ X: from.X, Y: from.Y })
  return out.reverse()
}

// A binary min-heap of (key, value) numbers; equal keys come out in the order pushed.
function makeHeap() {
  const keys = [], vals = [], order = []
  let seq = 0
  const less = (a, b) => keys[a] < keys[b] || (keys[a] === keys[b] && order[a] < order[b])
  const swap = (a, b) => {
    [keys[a], keys[b]] = [keys[b], keys[a]]; [vals[a], vals[b]] = [vals[b], vals[a]]; [order[a], order[b]] = [order[b], order[a]]
  }
  return {
    size: () => keys.length,
    push(k, v) {
      keys.push(k); vals.push(v); order.push(seq++)
      for (let i = keys.length - 1; i > 0;) {
        const p = (i - 1) >> 1
        if (!less(i, p)) break
        swap(i, p); i = p
      }
    },
    pop() {
      const top = [keys[0], vals[0]]
      const last = keys.length - 1
      swap(0, last)
      keys.pop(); vals.pop(); order.pop()
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < keys.length && less(l, m)) m = l
        if (r < keys.length && less(r, m)) m = r
        if (m === i) break
        swap(i, m); i = m
      }
      return top
    },
  }
}
