// How a person of Kalevanlinna gets about: their schedule turned into a place
// to go, a street route there, and a walk along it. Pure (no DOM, no game
// state); the runtime (runtime.js) owns the walkers and calls these.
//
// A Walker keeps its position in world tiles (X, Y; whole numbers are tile
// centres), never window tiles, so a re-centre of the window cannot touch it.
// Routes are city tiles (streets.js waypoints). The walk:
//
//   phase 'wait'   the place changed and a route is on order (a frame or two)
//   phase 'go'     walking `path` from waypoint `wi` on
//   phase 'there'  arrived: standing about a spot, or walking a patrol route
//                  back and forth (`loop`); a door's arrival is mode 'indoors'
//
// A far walker moves FAR_SPEED tiles a second along its path, with no
// collision and no reactions (R1); a near one is an npc entity that the
// runtime steers waypoint by waypoint (npc.js follow_city).
import { route } from './streets.js'
import { CITY } from './geometry.js'
import { PLAN } from './plan.js'
import { rollTownsfolk, rollWatch } from './folk.js'
import { hash } from '../rand.js'
import { DAY_LENGTH } from '../../data/weather.js'

export const FAR_SPEED = 1.6           // tiles/s: a far walker's pace
const N = CITY.size
const OX = CITY.wx0 * 80, OY = CITY.wy0 * 80   // world tile of city tile (0, 0)
export { OX as CITY_OX, OY as CITY_OY }
const EXACT = new Set(['post', 'stall', 'cry', 'lamps', 'ring'])   // acts done on the spot itself
const SURE_DETOUR = 2.5                // a route is never longer than this many straight lines (+30)

export const placeKey = where => where.door ? `d:${where.door}` : where.spot ? `s:${where.spot}` : `p:${where.patrol}`
const octile = (a, b) => { const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy) }

// What every walker of one city shares: the street graph, the doors, the
// patrol routes and the people. Built once per city.
const cache = new WeakMap()
export function cityCtx(city, seed) {
  let cc = cache.get(city)
  if (cc) return cc
  const G = city.streets
  const doorOf = new Map(city.doors.map(d => [d.label, d]))
  const doorCells = new Set(city.doors.map(d => d.y * N + d.x))
  // the cell before a door: where its people come out (the street graph's own step to it)
  const front = label => {
    const d = doorOf.get(label), i = G.snapNext[d.y * N + d.x]
    return i >= 0 ? { x: i % N, y: (i / N) | 0 } : { x: d.x, y: d.y + 1 }
  }
  cc = { city, seed, G, doorOf, doorCells, front, patrols: new Map(), folk: [...rollTownsfolk(seed, city), ...rollWatch(seed, city)] }
  cache.set(city, cc)
  for (const r of PLAN.patrols) patrolPath(cc, r.id)   // routed now, while the town is being placed
  return cc
}

// a cell a route can start or end on: walkable and within reach of a street
export const reachable = (cc, x, y) => x >= 0 && y >= 0 && x < N && y < N && cc.G.snapDist[y * N + x] >= 0 && !cc.doorCells.has(y * N + x)

// A PLAN.patrols route as walkable waypoints: the streets between its points.
export function patrolPath(cc, id) {
  let path = cc.patrols.get(id)
  if (path) return path
  const pts = PLAN.patrols.find(r => r.id === id).pts.map(([x, y]) => ({ x, y }))
  path = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const leg = route(cc.G, pts[i - 1], pts[i]) ?? [pts[i - 1], pts[i]]
    path.push(...leg.slice(1))
  }
  cc.patrols.set(id, path)
  return path
}

// Where a person stands about a spot: a cell of their own within 2 tiles (3
// at the fountain), so a crowd is not one heap; on the spot for its own work.
function standTile(cc, w, spot, act) {
  const s = cc.city.spots[spot]
  if (EXACT.has(act)) return s
  const r = spot === 'fountain' ? 3 : 2, side = 2 * r + 1, n = side * side
  const k = Math.floor(hash(cc.seed, w.n, spot.length, 77) * n)
  for (let i = 0; i < n; i++) {
    const j = (k + i * 7) % n   // 7 is coprime with 25 and 49: every cell is tried
    const x = s.x + (j % side) - r, y = s.y + Math.floor(j / side) - r
    if (reachable(cc, x, y)) return { x, y }
  }
  return s
}

// The place an entry sends a walker to (city tiles).
function targetOf(cc, w, entry) {
  const where = entry.where
  if (where.door) { const d = cc.doorOf.get(where.door); return { key: placeKey(where), kind: 'door', door: where.door, tile: { x: d.x, y: d.y } } }
  if (where.spot) return { key: placeKey(where), kind: 'spot', tile: standTile(cc, w, where.spot, entry.act) }
  const path = patrolPath(cc, where.patrol)
  return { key: placeKey(where), kind: 'patrol', path, tile: path[0] }
}

// the walker's tile in city coordinates
const cityTile = w => ({ x: Math.round(w.X) - OX, y: Math.round(w.Y) - OY })
// a start a route can use: the walker's tile, or the nearest one near it
function startTile(cc, w) {
  const t = cityTile(w)
  for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    if (reachable(cc, t.x + dx, t.y + dy) || cc.doorCells.has((t.y + dy) * N + t.x + dx)) return { x: t.x + dx, y: t.y + dy }
  }
  return t
}

export function makeWalker(cc, person, n) {
  return {
    id: person.id, n, person, species: person.job === 'watch' ? 'watchman' : 'townsfolk', look: person.look,
    sched: null, day: -1, ei: 0, entry: null, goal: null,
    mode: 'far', X: 0, Y: 0, door: null, entity: null, out: false,
    phase: 'wait', path: null, wi: 0, dir: 1, loop: false, needRoute: false,
    side: 0, homed: false, shy: null, still: 0, sx: 0, sy: 0, rerouted: false,
  }
}

const setAt = (w, t) => { w.X = t.x + OX; w.Y = t.y + OY }
// a route that could not be found: walked straight (far) or by the npc's own A* (near), and noted for tools
const noRoute = (stats, w, from, to) => { if (stats && stats.noRoute.length < 50) stats.noRoute.push({ id: w.id, from, to }) }

// Arrived at the end of the path: in through a door, about a spot, or onto a
// patrol route. Returns 'indoors' when the walker went in.
export function arrive(cc, w) {
  const g = w.goal
  w.path = null; w.loop = false; w.still = 0
  if (g.kind === 'door') {
    w.mode = 'indoors'; w.door = g.door; w.phase = 'there'
    setAt(w, g.tile)
    return 'indoors'
  }
  if (g.kind === 'spot') {
    w.phase = 'there'
    if (w.mode !== 'near') setAt(w, g.tile)
    return 'there'
  }
  // a patrol: on from the end it came to, back and forth until the next entry
  const p = g.path
  const atEnd = octile(cityTile(w), p[p.length - 1]) < octile(cityTile(w), p[0])
  w.path = p; w.loop = true; w.phase = 'there'
  w.dir = atEnd ? -1 : 1
  w.wi = p.length < 2 ? 0 : atEnd ? p.length - 2 : 1
  return 'there'
}

// on to the next waypoint; the end of the path is an arrival (or a turn, on a patrol)
export function advance(cc, w) {
  w.wi += w.dir
  if (w.wi >= 0 && w.wi < w.path.length) return null
  if (w.loop) {
    w.dir = -w.dir
    w.wi = Math.max(0, Math.min(w.path.length - 1, w.wi + 2 * w.dir))
    return null
  }
  return arrive(cc, w)
}
export const lastWaypoint = w => !w.loop && w.wi === w.path.length - 1

// A new route from where the walker is to its goal. Returns 'indoors' or
// 'there' if it was already there, else null.
export function routeWalker(cc, w, stats) {
  w.needRoute = false
  const g = w.goal
  const from = startTile(cc, w)
  let to = g.tile
  if (g.kind === 'patrol') {
    const p = g.path
    to = octile(from, p[p.length - 1]) < octile(from, p[0]) ? p[p.length - 1] : p[0]
  }
  if (from.x === to.x && from.y === to.y) return arrive(cc, w)
  let path = route(cc.G, from, to)
  if (!path) { noRoute(stats, w, from, to); path = [from, to] }
  w.path = path; w.wi = 1; w.dir = 1; w.loop = false; w.phase = 'go'
  w.still = 0; w.sx = w.X; w.sy = w.Y
  return null
}

// The entry in force changed to index ei. Returns 'out' when the walker
// leaves a building (its position is then the door's front cell).
export function setEntry(cc, w, ei) {
  w.ei = ei
  w.entry = w.sched[ei]
  const goal = targetOf(cc, w, w.entry)
  const same = w.goal && w.goal.key === goal.key
  w.goal = goal
  if (same) return null
  let left = null
  if (w.mode === 'indoors') {
    setAt(w, cc.front(w.door))
    w.mode = 'far'; w.door = null; left = 'out'
  }
  w.phase = 'wait'; w.path = null; w.loop = false; w.needRoute = true; w.homed = false
  return left
}

const pathLength = (pts, i0 = 0) => { let L = 0; for (let i = i0 + 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L }

// Put a walker `d` tiles along `path` (city tiles) from its start, heading on.
function placeAlong(w, path, d) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.y - a.y)
    if (d <= L || i === path.length - 1) {
      const f = L ? Math.min(1, d / L) : 1
      w.X = a.x + (b.x - a.x) * f + OX; w.Y = a.y + (b.y - a.y) * f + OY
      w.wi = i
      return
    }
    d -= L
  }
}
// ... and along a patrol, back and forth
function placeOnPatrol(w, d) {
  const p = w.path, L = pathLength(p)
  if (L <= 0) return
  let s = d % (2 * L)
  if (s <= L) { w.dir = 1; placeAlong(w, p, s) } else {
    w.dir = -1
    const rev = p.slice().reverse()
    placeAlong(w, rev, s - L)
    w.wi = p.length - 1 - w.wi
  }
}

// Where the schedule says a walker is at `frac` of the day: at the place of
// the entry in force if they would have got there by now (route length at
// FAR_SPEED from the last entry's place), else partway along the way.
export function placeByClock(cc, w, frac, stats) {
  const S = w.sched
  let ei = 0
  while (ei + 1 < S.length && S[ei + 1].at <= frac) ei++
  w.ei = ei; w.entry = S[ei]; w.goal = targetOf(cc, w, w.entry)
  w.mode = 'far'; w.door = null; w.path = null; w.loop = false; w.needRoute = false; w.homed = false
  const since = Math.max(0, frac - w.entry.at) * DAY_LENGTH
  const prev = ei > 0 ? targetOf(cc, w, S[ei - 1]) : null
  const there = extra => {
    if (w.goal.kind === 'patrol') {
      setAt(w, w.goal.path[0]); arrive(cc, w)
      placeOnPatrol(w, extra * FAR_SPEED)
    } else arrive(cc, w)
  }
  if (!prev) return there(since)
  const from = prev.kind === 'door' ? cc.front(prev.door) : prev.tile
  setAt(w, from)
  const to = w.goal.kind === 'patrol' ? w.goal.path[0] : w.goal.tile
  const travelled = since * FAR_SPEED
  if (travelled > SURE_DETOUR * octile(from, to) + 30) return there(since - octile(from, to) * 1.3 / FAR_SPEED)
  const path = route(cc.G, from, to)
  if (!path) { noRoute(stats, w, from, to); setAt(w, to); return there(0) }
  const L = pathLength(path)
  if (travelled >= L) { setAt(w, to); return there((travelled - L) / FAR_SPEED) }
  w.path = path; w.dir = 1; w.phase = 'go'
  placeAlong(w, path, travelled)
  w.still = 0; w.sx = w.X; w.sy = w.Y
}

// One far step: FAR_SPEED tiles a second along the path. Returns 'indoors'
// when the walk ended at a door.
export function stepFar(cc, w, dt) {
  if (!w.path || (w.phase !== 'go' && !w.loop)) return null
  let budget = FAR_SPEED * dt
  for (let guard = 0; budget > 1e-9 && guard < 64; guard++) {
    const t = w.path[w.wi]
    const tx = t.x + OX, ty = t.y + OY
    const d = Math.hypot(tx - w.X, ty - w.Y)
    if (d > budget) { w.X += (tx - w.X) / d * budget; w.Y += (ty - w.Y) / d * budget; return null }
    w.X = tx; w.Y = ty; budget -= d
    const r = advance(cc, w)
    if (r) return r
  }
  return null
}

export const cityToWorld = t => ({ X: t.x + OX, Y: t.y + OY })
