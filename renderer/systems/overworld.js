// Open-world generation: a plain of castle-skinned ground carrying walled
// settlements, roads between them, pockets of ruin, and a danger gradient that
// rises with distance from where you start.
//
// Connected BY CONSTRUCTION, not by retry. generateLevel's dungeon path
// generates, tests isFullyConnected, retries five times and then falls back to
// a bare unwinnable room — the mechanism behind the depth-4 softlock. Here the
// map starts fully open and every later step either only adds traversable
// ground or punches a guaranteed gap, so there is no retry loop and no
// fallback at all.

import { TILE, isWalkable } from './entities.js'
import { createMap, carveCorridor, placeStructure } from './map.js'

export const WORLD_W = 180
export const WORLD_H = 116

export const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

// Content targets at full size, scaled by area on smaller worlds so a 60x40
// test map asks for what it can actually hold instead of sampling forever.
export function contentCounts(width, height, rng) {
  const f = Math.min(1, (width * height) / (WORLD_W * WORLD_H))
  const scale = n => Math.max(1, Math.round(n * f))
  return {
    settlements: scale(4 + Math.floor(rng() * 2)),
    pockets:     scale(2 + Math.floor(rng() * 2)),
    entrances:   scale(3),
  }
}

// Carve the interior to open ground, leaving a one-tile wall border so the
// world has edges (the camera is unbounded and would otherwise show the void).
function fillGround(map) {
  for (let y = 1; y < map.length - 1; y++)
    for (let x = 1; x < map[0].length - 1; x++)
      map[y][x].tile = TILE.FLOOR
}

// Sample `want` points at least `minSep` apart and `clearOf` away from every
// point in `avoid`, relaxing both constraints if the map is too crowded to
// satisfy them. Filtering a pre-generated scatter instead of sampling against
// what already exists drops points entirely on most seeds — observed during
// design, where the ruin pockets vanished on two seeds in three.
export function sampleSites(rng, want, { w, h, pad = 10, minSep = 20, avoid = [], clearOf = 0 }) {
  const out = []
  for (let relax = 0; relax < 5 && out.length < want; relax++) {
    const sep = Math.max(4, minSep - relax * 6)
    const clr = Math.max(4, clearOf - relax * 6)
    const spanW = Math.max(1, w - pad * 2), spanH = Math.max(1, h - pad * 2)
    for (let t = 0; t < 900 && out.length < want; t++) {
      const p = { x: pad + Math.floor(rng() * spanW), y: pad + Math.floor(rng() * spanH) }
      if (out.every(q => dist(p, q) >= sep) && avoid.every(q => dist(p, q) >= clr)) out.push(p)
    }
  }
  return out
}

// Minimum spanning tree over the sites, as an edge list. Pure and rng-free —
// ties break by first-encountered — so the graph can be tested without a map.
export function roadEdges(sites) {
  if (sites.length < 2) return []
  const edges = []
  const linked = [0]
  const rest = sites.map((_, i) => i).slice(1)
  while (rest.length) {
    let best = null
    for (const a of linked) for (const b of rest) {
      const d = dist(sites[a], sites[b])
      if (!best || d < best.d) best = { a, b, d }
    }
    edges.push({ a: best.a, b: best.b })
    linked.push(best.b)
    rest.splice(rest.indexOf(best.b), 1)
  }
  return edges
}

// Carve the road network. NOTE: on the already-open plain this writes no new
// floor — carveCorridor only ever sets FLOOR and every interior cell is FLOOR
// already, so this currently changes zero tiles. The roads become visible when
// a later change paints them a `skin` and marks them `locked`, the way
// placeStructure does. The MST itself is real and tested via roadEdges.
// O(n^3): 20 inner iterations at 5 sites, ~100ms at 400. Irrelevant at this scale.
function carveRoads(map, sites) {
  for (const { a, b } of roadEdges(sites)) {
    carveCorridor(map, sites[a].x, sites[a].y, sites[b].x, sites[b].y, 2)
  }
}

// The wall ring of a rect, as [x, y] pairs. A hollow stamp writes exactly
// these cells, so punching a gap means picking from this list — picking a
// random cell inside the rect can land in the interior and do nothing.
function perimeter(x, y, w, h) {
  const out = []
  for (let c = x; c < x + w; c++) out.push([c, y], [c, y + h - 1])
  for (let r = y + 1; r < y + h - 1; r++) out.push([x, r], [x + w - 1, r])
  return out
}

// Clamped to the interior: the world's one-tile border must stay solid, and
// punchGaps would otherwise be free to open a border cell and breach the edge.
const inInterior = (map, x, y) => x > 0 && y > 0 && x < map[0].length - 1 && y < map.length - 1

function hollowWall(map, x, y, w, h) {
  for (const [cx, cy] of perimeter(x, y, w, h)) if (inInterior(map, cx, cy)) map[cy][cx].tile = TILE.WALL
}

// The outward normal of a perimeter cell: which side of the rect it sits on,
// as the direction stepping OFF the wall ring altogether.
function outwardNormal(x, y, w, h, cx, cy) {
  if (cy === y) return [0, -1]
  if (cy === y + h - 1) return [0, 1]
  if (cx === x) return [-1, 0]
  return [1, 0]
}

// Open `n` distinct perimeter cells back to floor, so the stamp is always
// enterable from the plain by construction rather than by luck.
//
// Two filters, both load-bearing:
//
// 1. Corners are excluded. A corner cell's only orthogonal neighbours are two
// OTHER wall cells (the next cell along each edge) plus two exterior cells —
// it never touches the fragment's interior at all. Punching a corner pokes a
// hole that connects to nothing inside, so a fragment whose gaps both landed
// on corners (observed on seed 1) sealed its own interior even though tiles
// were "open" by value. Only a mid-edge cell has exactly one interior
// neighbour and one exterior neighbour, so it's the only kind of cell that
// can actually join the two.
//
// 2. Only cells whose OUTWARD neighbour is not itself wall. Pockets are a
// grid of independently-positioned fragments (see stampPocket), and two of
// them can sit close enough that a gap on fragment A's ring opens directly
// against fragment B's wall one cell further out — again open by tile value,
// leading nowhere. Checking the neighbour (rather than just clamping to the
// interior, as the settlement gate does) is what makes this connected by
// construction instead of by luck: every gap this picks genuinely reaches
// open ground, because by the time pockets punch their gaps every pocket's
// walls are already on the map (see generateOverworld's two-pass ordering).
//
// With footprintClear gating every stamp (see stampPocket), a stamped
// fragment always sits in clear ground, so `viable` is never empty here.
// Falling back to an unchecked cell would punch a gap into another wall — an
// opening onto nothing — which is exactly how two seeds in an earlier 150-seed
// sweep ended up with sealed interiors. No fallback: if this ever leaves a
// fragment with no gaps, the connectivity test must catch it loudly instead
// of the world quietly shipping broken.
function punchGaps(map, rng, x, y, w, h, n) {
  const isCorner = (cx, cy) => (cx === x || cx === x + w - 1) && (cy === y || cy === y + h - 1)
  const mid = perimeter(x, y, w, h).filter(([cx, cy]) => inInterior(map, cx, cy) && !isCorner(cx, cy))
  const viable = mid.filter(([cx, cy]) => {
    const [dx, dy] = outwardNormal(x, y, w, h, cx, cy)
    return map[cy + dy]?.[cx + dx]?.tile !== TILE.WALL
  })
  const per = viable
  for (let k = 0; k < n && per.length; k++) {
    const [gx, gy] = per.splice(Math.floor(rng() * per.length), 1)[0]
    map[gy][gx].tile = TILE.FLOOR
  }
}

// True when the rect and a one-cell margin around it contain no wall at all.
// A fragment stamped into clear ground can always be opened: every mid-edge
// cell has an open outward neighbour. Fragments that would touch a compound,
// the border, or another fragment are skipped instead — that is what keeps
// punchGaps' viable list non-empty and the world connected by construction.
// (inInterior returning false for an out-of-bounds margin means a fragment
// near the world edge is skipped rather than clamped.)
function footprintClear(map, x, y, w, h) {
  for (let cy = y - 1; cy < y + h + 1; cy++) {
    for (let cx = x - 1; cx < x + w + 1; cx++) {
      if (!inInterior(map, cx, cy)) return false
      if (map[cy][cx].tile === TILE.WALL) return false
    }
  }
  return true
}

// A pocket of broken street grid: fragments with gaps you walk through.
//
// Draws the wall only; the gap is punched in a later pass (see
// generateOverworld) once every pocket's fragments are on the map. Compounds
// are stamped before pockets, and footprintClear skips any fragment that
// would touch existing wall (a compound, the border, or another fragment), so
// by the time a fragment's wall goes down its surroundings are guaranteed
// clear — no later stamp can touch it and reseal a gap. `fragments` collects
// {x, y, w, h, n} for the deferred gap-punching pass; `n` is drawn here so
// the rng sequence still runs one fragment at a time, wall then gap count,
// exactly as before.
function stampPocket(map, rng, p, fragments) {
  const pw = 16 + Math.floor(rng() * 10), ph = 11 + Math.floor(rng() * 7)
  for (let by = p.y - (ph >> 1); by < p.y + (ph >> 1); by += 5) {
    for (let bx = p.x - (pw >> 1); bx < p.x + (pw >> 1); bx += 7) {
      if (rng() < 0.25) continue
      const fw = 4 + Math.floor(rng() * 3), fh = 3 + Math.floor(rng() * 2)
      if (!footprintClear(map, bx, by, fw, fh)) continue
      hollowWall(map, bx, by, fw, fh)
      fragments.push({ x: bx, y: by, w: fw, h: fh, n: 2 + Math.floor(rng() * 2) })
    }
  }
}

// A walled compound with a guaranteed two-cell gate, holding a prefab if one
// was supplied. Returns the compound rect and the prefab's own spawns.
//
// The gate is placed on the side the road arrives from, not at random. The road
// is carved to the site centre and the compound wall is then stamped across it,
// so a randomly-placed gate leaves the road dead-ending into a blank wall — a
// cosmetic break that only becomes visible once roads are skinned, and a
// confusing one to trace back to this function. `roadDir` is the unit vector
// from the site toward its nearest road neighbour; pass null for an isolated
// site and any side will do.
function stampSettlement(map, rng, site, structures, id, roadDir = null) {
  const s = structures.castle ?? structures.barracks ?? null
  const iw = s?.w ?? 7, ih = s?.h ?? 6
  const w = iw + 4, h = ih + 4
  const x = Math.max(1, Math.min(map[0].length - w - 1, site.x - (w >> 1)))
  const y = Math.max(1, Math.min(map.length - h - 1, site.y - (h >> 1)))
  hollowWall(map, x, y, w, h)
  punchGate(map, rng, x, y, w, h, roadDir)
  const spawns = s ? placeStructure(map, s, x + 2, y + 2, id) : []
  return { room: { id, x, y, w, h }, spawns }
}

// Open a two-cell gate on the side `roadDir` points toward, so the road meets
// it. Falls back to a random side when the site has no road neighbour.
function punchGate(map, rng, x, y, w, h, roadDir) {
  const side = roadDir
    ? (Math.abs(roadDir.x) > Math.abs(roadDir.y)
        ? (roadDir.x > 0 ? 'e' : 'w')
        : (roadDir.y > 0 ? 's' : 'n'))
    : ['n', 's', 'e', 'w'][Math.floor(rng() * 4)]
  const open = (cx, cy) => { if (inInterior(map, cx, cy)) map[cy][cx].tile = TILE.FLOOR }
  if (side === 'n' || side === 's') {
    const gx = x + 1 + Math.floor(rng() * Math.max(1, w - 3))
    const gy = side === 'n' ? y : y + h - 1
    open(gx, gy); open(gx + 1, gy)
  } else {
    const gy = y + 1 + Math.floor(rng() * Math.max(1, h - 3))
    const gx = side === 'w' ? x : x + w - 1
    open(gx, gy); open(gx, gy + 1)
  }
}

// Absolute counts, not densities. A dungeon density applied here would flood
// the map: monsterDensity 0.01 across 20,880 cells is over 150 monsters.
//
// mid's enemy total (guard + monster) tops out at 4 + 6 = 10; outer's bottoms
// out at 0 + 10 + 1 = 11. That gap is deliberate and load-bearing: the plan's
// original ranges (mid avg 13, outer avg 11.5) made outer's enemy count
// LOWER than mid's on average — a 12-seed sweep of that table failed the
// "more enemies in the outer ring" invariant on 10/12 seeds. Keeping mid's
// worst case below outer's best case makes the ordering a guarantee, not a
// coin flip that happens to land right on the seeds in SEEDS.
const CONTENTS = {
  mid:   { guard: [2, 4],  monster: [4, 6],   variant: 'weak',   chest: [3, 5] },
  outer: { guard: [0, 0],  monster: [10, 14], variant: 'strong', chest: [6, 9], cyclops: [1, 2] },
}
const between = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1))

// Walkable tiles bucketed by Manhattan distance from the spawn, so contents
// can be placed by ring without rescanning the map per kind.
function ringsFrom(map, spawn) {
  const max = map[0].length + map.length
  const out = { inner: [], mid: [], outer: [] }
  for (let y = 1; y < map.length - 1; y++) for (let x = 1; x < map[0].length - 1; x++) {
    if (!isWalkable(map[y][x].tile) || map[y][x].locked) continue
    const f = (Math.abs(x - spawn.x) + Math.abs(y - spawn.y)) / max
    out[f < 0.25 ? 'inner' : f < 0.60 ? 'mid' : 'outer'].push({ x, y })
  }
  return out
}

function drawFrom(pool, rng, taken, n, make) {
  const out = []
  for (let i = 0; i < n && pool.length; i++) {
    const t = pool.splice(Math.floor(rng() * pool.length), 1)[0]
    const k = `${t.x},${t.y}`
    if (taken.has(k)) continue
    taken.add(k)
    out.push(make(t))
  }
  return out
}

// The farthest a point at (x, y) could possibly be, as a fraction of
// ringsFrom's own (width + height) normalisation, from the single farthest
// interior corner. Purely geometric — no map scan — used only to pick a home
// settlement that leaves room for an outer ring at all.
//
// A settlement sitting exactly at the true map centre caps this below 0.5,
// since the two opposite-corner distances split evenly around (width + height
// - 6) / 2 ≈ 0.49. ringsFrom's outer bucket starts at 0.60, so a dead-centre
// spawn can leave the outer ring permanently empty — measured on a 150-seed
// sweep of the naive "nearest to centre" rule: 76/150 seeds (51%) had zero
// cells anywhere on the map reaching the outer fraction, silently starving
// both the enemy gradient and every dungeon entrance.
function farCornerFraction(x, y, width, height) {
  const max = width + height
  const corners = [[1, 1], [1, height - 2], [width - 2, 1], [width - 2, height - 2]]
  let best = 0
  for (const [cx, cy] of corners) {
    const f = (Math.abs(x - cx) + Math.abs(y - cy)) / max
    if (f > best) best = f
  }
  return best
}

// Nearest walkable tile to (x, y) by expanding square search — the compound
// corner we aim for may itself be wall. Also skips locked cells (prefab
// interiors): a spawn inside a prefab would put the player in a sealed room.
function nearestWalkable(map, x, y) {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy
      if (map[ny]?.[nx] && isWalkable(map[ny][nx].tile) && !map[ny][nx].locked) return { x: nx, y: ny }
    }
  }
  return { x: 1, y: 1 }
}

export function generateOverworld(width = WORLD_W, height = WORLD_H, { structures = {}, rng = Math.random } = {}) {
  const map = createMap(width, height)
  fillGround(map)

  const n = contentCounts(width, height, rng)
  const sites = sampleSites(rng, n.settlements, { w: width, h: height, pad: 12, minSep: 26 })
  const pockets = sampleSites(rng, n.pockets, { w: width, h: height, pad: 14, minSep: 24, avoid: sites, clearOf: 22 })

  carveRoads(map, sites)

  // Compounds are stamped before pockets so footprintClear (see stampPocket)
  // sees every compound wall already on the map — a pocket fragment that would
  // touch a compound is skipped rather than punching a gap that a compound
  // wall then seals.
  //
  // Which way the road leaves each site, so its gate faces the road.
  const neighbour = new Map()
  for (const { a, b } of roadEdges(sites)) {
    if (!neighbour.has(a)) neighbour.set(a, b)
    if (!neighbour.has(b)) neighbour.set(b, a)
  }

  const entitySpawns = []
  const rooms = []
  sites.forEach((site, id) => {
    const nb = neighbour.has(id) ? sites[neighbour.get(id)] : null
    const roadDir = nb ? { x: nb.x - site.x, y: nb.y - site.y } : null
    const { room, spawns } = stampSettlement(map, rng, site, structures, id, roadDir)
    rooms.push(room)
    entitySpawns.push(...spawns)
  })

  const fragments = []
  for (const p of pockets) stampPocket(map, rng, p, fragments)
  // Punch every pocket's gaps only after every pocket's walls are down — see
  // stampPocket for why interleaving the two lets one pocket reseal another's gap.
  for (const f of fragments) punchGaps(map, rng, f.x, f.y, f.w, f.h, f.n)

  // Spawn at the settlement nearest the centre, so the world extends in every
  // direction and the danger gradient is radial rather than one-sided —
  // except a settlement dead-centre leaves no room for an outer ring at all
  // (see farCornerFraction). Prefer the centre-most settlement that still
  // guarantees an outer band exists; only fall back to plain nearest-to-centre
  // when no settlement clears that bar (e.g. a tiny test map).
  const cx = width >> 1, cy = height >> 1
  const centreOf = r => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) })
  // The anchor point (home.x - 2, home.y - 2) is what nearestWalkable actually
  // spawns from, not the room's centre — qualify against the same point the
  // spawn will use, or a compound offset from its own centre can silently
  // fail the bar the centre passed.
  const anchorOf = r => ({ x: r.x - 2, y: r.y - 2 })
  const roomDist = r => dist(centreOf(r), { x: cx, y: cy })
  const qualifies = r => { const a = anchorOf(r); return farCornerFraction(a.x, a.y, width, height) >= 0.62 }
  const candidates = rooms.filter(qualifies)
  const pool = candidates.length ? candidates : rooms
  const home = pool.reduce((best, r) => roomDist(r) < roomDist(best) ? r : best, pool[0])
  const playerSpawn = nearestWalkable(map, home ? home.x - 2 : cx, home ? home.y - 2 : cy)

  const taken = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
  taken.add(`${playerSpawn.x},${playerSpawn.y}`)
  const rings = ringsFrom(map, playerSpawn)

  // Entrances are drawn from the outer pool FIRST, before any enemy or chest
  // draw touches it. The outer ring can be thin (measured as few as 15
  // walkable cells on one seed in a 150-seed sweep) and the outer monster+
  // chest+cyclops requests alone can ask for up to 25 cells — enough to
  // exhaust a thin pool outright. Reserving entrances' modest ask (2-3 cells)
  // first is what makes "every seed gets at least one entrance" a guarantee
  // instead of a race the enemies usually win.
  entitySpawns.push(...drawFrom(rings.outer, rng, taken, n.entrances, t => ({ kind: 'dungeon_entrance', ...t })))

  for (const which of ['mid', 'outer']) {
    const c = CONTENTS[which], pool = rings[which]
    entitySpawns.push(...drawFrom(pool, rng, taken, between(rng, c.guard), t => ({ kind: 'guard', ...t })))
    entitySpawns.push(...drawFrom(pool, rng, taken, between(rng, c.monster), t => ({ kind: 'monster', variant: c.variant, ...t })))
    entitySpawns.push(...drawFrom(pool, rng, taken, between(rng, c.chest), t => ({ kind: 'chest', ...t })))
    if (c.cyclops) entitySpawns.push(...drawFrom(pool, rng, taken, between(rng, c.cyclops), t => ({ kind: 'cyclops', ...t })))
  }

  return { map, entitySpawns, playerSpawn, rooms }
}
