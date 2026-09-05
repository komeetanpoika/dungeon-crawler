// Mountain-pass terrain for the map generators, drawn with the ow_mtn_ tiles
// from tools/extract-mountain-tiles.mjs (assets/mountainpass2.png).
//
// A mountain is a mass of blocked cells whose art sits on the PROP layer
// over mountain ground, the way trees do. Every mass cell draws one cell of
// a global jittered cone lattice (`ow_mtn_lat_M_Q`: Q = the cell's position
// in the 4x3 lattice period, M = which of its four sides are open to the
// ground, so the lattice stops in a ragged cone silhouette on those sides
// and the ground shows between the tips). Islands are the artist's keyed
// peak clusters. The ground just south of a mass wears a shadow gradient
// (`ow_mtn_shade_N`), as in the sheet's example strips; rocks are keyed
// scatters on the prop layer.
const hash = (a, b, c = 0) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return h >>> 0 }
const seq = (p, n) => Array.from({ length: n }, (_, i) => `${p}_${i}`)
export const LAT_PX = 4, LAT_PY = 3   // lattice period in cells
export const MTN = {
  ground: seq('ow_mtn_ground', 14),
  shade: seq('ow_mtn_shade', 14),
  lat: Array.from({ length: 15 }, (_, m) => seq(`ow_mtn_lat_${m}`, LAT_PX * LAT_PY)),   // mask 15 is an island: a cluster
  ridge: { dr: seq('ow_mtn_ridge_dr', 13), dl: seq('ow_mtn_ridge_dl', 13), lb: seq('ow_mtn_ridge_lb', 2), br: seq('ow_mtn_ridge_br', 2), v: seq('ow_mtn_ridge_v', 1) },
  cluster: seq('ow_mtn_cluster', 13),
  rock: seq('ow_mtn_rock', 6),
}
// Plain ground dominates; the pebbled variants (7-13) are accents.
export const MTN_GROUND_WEIGHTED = [...MTN.ground.slice(0, 7).flatMap(n => [n, n, n, n, n]), ...MTN.ground.slice(7)]

const MASS_PREFIXES = ['ow_mtn_lat_', 'ow_mtn_ridge_', 'ow_mtn_cluster_']
export const isMassSkin = n => !!n && MASS_PREFIXES.some(p => n.startsWith(p))
export const isMountainSkin = n => !!n && n.startsWith('ow_mtn_')
export const isMountainGround = n => !!n && (n.startsWith('ow_mtn_ground') || n.startsWith('ow_mtn_shade'))
// Off the map counts as mass, so a range running off the edge shows no face
// on that side.
export const isMass = (b, x, y) => !b.in(x, y) || isMassSkin(b.palette[b.prop[y][x]])

// Plant one mass cell: a lattice placeholder on the prop layer, blocked.
// The rim pass repaints it for its position later.
export function stampMass(b, rng, x, y) {
  if (!b.in(x, y)) return
  b.p(x, y, MTN.lat[0][0])
  // a face open to the ground shows the ground between its tips: never grass
  if (!isMountainGround(b.palette[b.ground[y][x]])) b.g(x, y, MTN.ground[hash(x, y, 3) % 7])
}
// A boulder: a keyed rock scatter on the prop layer, blocked.
export function stampRock(b, rng, x, y) {
  if (!b.in(x, y)) return
  b.p(x, y, MTN.rock[Math.floor(rng() * MTN.rock.length)])
}

const clearable = n => isMassSkin(n) || n?.startsWith('ow_mtn_rock')
// Open a mountain back into ground within radius r (a mine mouth, a stone
// circle, a carved pass): mass and rock cells become walkable ground.
export function clearMountain(b, rng, cx, cy, r, skin = MTN_GROUND_WEIGHTED) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r || !b.in(cx + x, cy + y)) continue
    if (!clearable(b.palette[b.prop[cy + y][cx + x]])) continue
    b.clearProp(cx + x, cy + y)
    b.g(cx + x, cy + y, skin[Math.floor(rng() * skin.length)])
  }
}
// The same for a rectangle (a house plot).
export function clearMountainRect(b, rng, x0, y0, x1, y1, skin = MTN_GROUND_WEIGHTED) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!b.in(x, y) || !clearable(b.palette[b.prop[y][x]])) continue
    b.clearProp(x, y)
    b.g(x, y, skin[Math.floor(rng() * skin.length)])
  }
}

// Shape for a mass cell from its neighbourhood: f = which of the four sides
// are floor. Returns the open-side mask (1 N, 2 E, 4 S, 8 W) for a lattice
// cell, 'cluster' for an island or a spur tip (three or four sides open),
// or 'wall' for a cell
// open on both N and S or both E and W (one cell thick) when walls are
// drawn with ridge pieces (see stampMountainRim's `walls` option).
export function rimShape(f, d, { walls = 'ridge' } = {}) {
  const n = f.N + f.E + f.S + f.W
  if (n >= 3) return 'cluster'
  if (walls === 'ridge' && ((f.N && f.S) || (f.E && f.W))) return 'wall'
  return (f.N ? 1 : 0) | (f.E ? 2 : 0) | (f.S ? 4 : 0) | (f.W ? 8 : 0)
}

// Repaint every mass cell's prop for its position in the mass, and shade
// the ground south of it. Run last, after every carve: it reads the mass
// shape and rewrites only mass cells and mountain ground, so it is safe to
// run again over a finished map.
//   apron: shade the ground just south of a mass (default false: the rim
//          lumps' own undersides ground the mass, as in the sheet)
//   walls: 'ridge' (default) — one-cell-thick walls are a zigzag of the
//          sheet's diagonal ridge pieces ("/" where x+y is even, "\" where
//          odd, so the line always meets its neighbours at a shared corner),
//          and a corner cell joining two such walls turns with them;
//          'lattice' — they are a thin lattice
export function stampMountainRim(b, rng, { apron = false, walls = 'ridge' } = {}) {
  const pick = a => a[Math.floor(rng() * a.length)]
  // avoid repeating the piece to the W or N
  const pickFresh = (a, x, y) => {
    const used = new Set([b.palette[b.prop[y]?.[x - 1]], b.palette[b.prop[y - 1]?.[x]]])
    const free = a.filter(n => !used.has(n))
    return pick(free.length ? free : a)
  }
  const paint = []
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (!isMass(b, x, y)) continue
    const floor = (dx, dy) => !isMass(b, x + dx, y + dy)
    paint.push([x, y, rimShape(
      { N: floor(0, -1), E: floor(1, 0), S: floor(0, 1), W: floor(-1, 0) },
      { NE: floor(1, -1), NW: floor(-1, -1), SE: floor(1, 1), SW: floor(-1, 1) }, { walls })])
  }
  // a corner cell between two ridge walls is part of the wall
  if (walls === 'ridge') {
    const shapeAt = new Map(paint.map(([x, y, s]) => [`${x},${y}`, s]))
    for (const cell of paint) {
      const [x, y, s] = cell
      if (s !== 3 && s !== 6 && s !== 12 && s !== 9) continue
      const closed = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]].filter(([, , bit]) => !(s & bit))
      if (closed.every(([dx, dy]) => shapeAt.get(`${x + dx},${y + dy}`) === 'wall')) cell[2] = 'wall'
    }
  }
  const zig = (x, y) => ((x + y) & 1) === 0 ? MTN.ridge.dr : MTN.ridge.dl
  for (const [x, y, shape] of paint) {
    const skin = shape === 'cluster' ? pickFresh(MTN.cluster, x, y)
      : shape === 'wall' ? pickFresh(zig(x, y), x, y)
      : MTN.lat[shape][((x % LAT_PX) + LAT_PX) % LAT_PX + LAT_PX * (((y % LAT_PY) + LAT_PY) % LAT_PY)]
    b.p(x, y, skin)
  }
  // shadow apron: mountain ground directly south of a mass wears the
  // gradient; other mountain ground goes back to plain
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (isMass(b, x, y) && b.in(x, y)) continue
    const g = b.palette[b.ground[y][x]]
    if (!isMountainGround(g)) continue
    const i = Math.max(MTN.ground.indexOf(g), MTN.shade.indexOf(g))
    const under = apron && b.in(x, y - 1) && isMass(b, x, y - 1)
    b.g(x, y, under ? MTN.shade[i] : MTN.ground[i])
  }
}
