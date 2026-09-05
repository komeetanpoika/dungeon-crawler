// Mountain-pass terrain for the map generators, drawn with the ow_mtn_ tiles
// from tools/extract-mountain-tiles.mjs. A mountain is a mass of blocked
// ground cells: peak fill inside, and along every face that meets non-mass
// ground a one-cell ridge rim wearing a cliff-edge tile. The edge tiles are
// ridge lines that leave a cell through two of its sides, so the rim is a
// line autotile: each rim cell picks the shape whose exits meet the ridges of
// its rim neighbours, worked out from which of its eight neighbours are floor.
export const MTN = {
  floor: ['ow_mtn_floor_0', 'ow_mtn_floor_1', 'ow_mtn_floor_2', 'ow_mtn_floor_3', 'ow_mtn_floor_4',
    'ow_mtn_floor_5', 'ow_mtn_floor_6', 'ow_mtn_floor_7', 'ow_mtn_floor_8', 'ow_mtn_floor_9'],
  peak: Array.from({ length: 17 }, (_, i) => `ow_mtn_peak_${i}`),
  scree: ['ow_mtn_scree_0', 'ow_mtn_scree_1', 'ow_mtn_scree_2'],
  edge: {
    h: Array.from({ length: 6 }, (_, i) => `ow_mtn_edge_h_${i}`),
    v: Array.from({ length: 4 }, (_, i) => `ow_mtn_edge_v_${i}`),
    tl: Array.from({ length: 3 }, (_, i) => `ow_mtn_edge_tl_${i}`),
    tr: Array.from({ length: 3 }, (_, i) => `ow_mtn_edge_tr_${i}`),
    lb: Array.from({ length: 2 }, (_, i) => `ow_mtn_edge_lb_${i}`),
    br: Array.from({ length: 2 }, (_, i) => `ow_mtn_edge_br_${i}`),
  },
}
// Plain floor dominates; the pebbled variants are accents.
export const MTN_FLOOR_WEIGHTED = [
  ...Array(12).fill('ow_mtn_floor_0'), ...Array(12).fill('ow_mtn_floor_1'), ...Array(12).fill('ow_mtn_floor_2'),
  'ow_mtn_floor_3', 'ow_mtn_floor_4', 'ow_mtn_floor_5', 'ow_mtn_floor_6', 'ow_mtn_floor_7', 'ow_mtn_floor_8', 'ow_mtn_floor_9',
]

export const isMassSkin = n => !!n && (n.startsWith('ow_mtn_peak') || n.startsWith('ow_mtn_edge'))
export const isMountainSkin = n => !!n && n.startsWith('ow_mtn_')
// Off the map counts as mass, so a range running off the edge shows no rim
// on that side.
export const isMass = (b, x, y) => !b.in(x, y) || isMassSkin(b.palette[b.ground[y][x]])

// Plant one mass cell: peak fill, blocked, prop cleared (a tree never grows
// out of a mountain). The rim pass repaints the faces later.
export function stampMass(b, rng, x, y, skin = null) {
  if (!b.in(x, y)) return
  b.prop[y][x] = -1
  b.g(x, y, skin ?? MTN.peak[Math.floor(rng() * MTN.peak.length)])
  b.block(x, y)
}

// Open a mountain back into floor within radius r (a mine mouth, a stone
// circle, a carved pass): mass and scree cells become walkable mountain floor.
export function clearMountain(b, rng, cx, cy, r, skin = MTN_FLOOR_WEIGHTED) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r || !b.in(cx + x, cy + y)) continue
    const n = b.palette[b.ground[cy + y][cx + x]]
    if (!isMassSkin(n) && !n.startsWith('ow_mtn_scree')) continue
    b.g(cx + x, cy + y, skin[Math.floor(rng() * skin.length)])
    b.unblock(cx + x, cy + y)
  }
}

// The same for a rectangle (a house plot).
export function clearMountainRect(b, rng, x0, y0, x1, y1, skin = MTN_FLOOR_WEIGHTED) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!b.in(x, y)) continue
    const n = b.palette[b.ground[y][x]]
    if (!isMassSkin(n) && !n.startsWith('ow_mtn_scree')) continue
    b.g(x, y, skin[Math.floor(rng() * skin.length)])
    b.unblock(x, y)
  }
}

// Ridge shape for a mass cell from its neighbourhood, or null for peak fill.
// f = which of the four sides are floor, d = which diagonals are floor.
// The shape names the two sides the ridge leaves through: a cell with floor
// to the south and east is a convex corner whose west neighbour (floor S,
// ridge h) and north neighbour (floor E, ridge v) hand it a ridge on its
// left and top — tl. A concave corner sees floor only diagonally and turns
// the same way from the other side. 'scree' is an isolated cell.
export function rimShape(f, d) {
  const n = f.N + f.E + f.S + f.W
  if (n === 4) return 'scree'
  if (n === 3) return f.N && f.S ? 'v' : 'h'
  if (n === 2) {
    if (f.N && f.S) return 'h'
    if (f.E && f.W) return 'v'
    if (f.S && f.E) return 'tl'
    if (f.S && f.W) return 'tr'
    if (f.N && f.E) return 'lb'
    return 'br'
  }
  if (n === 1) return f.N || f.S ? 'h' : 'v'
  const dn = d.NE + d.NW + d.SE + d.SW
  if (dn !== 1) return null
  return d.NE ? 'tr' : d.NW ? 'tl' : d.SE ? 'br' : 'lb'
}

// Repaint every mass cell's ground for its position in the mass. Run last,
// after every carve: it reads the mass shape and rewrites only mass cells,
// so it is safe to run again over a finished map.
export function stampMountainRim(b, rng) {
  const pick = a => a[Math.floor(rng() * a.length)]
  const paint = []
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (!isMass(b, x, y)) continue
    const floor = (dx, dy) => !isMass(b, x + dx, y + dy)
    const shape = rimShape(
      { N: floor(0, -1), E: floor(1, 0), S: floor(0, 1), W: floor(-1, 0) },
      { NE: floor(1, -1), NW: floor(-1, -1), SE: floor(1, 1), SW: floor(-1, 1) })
    paint.push([x, y, shape])
  }
  for (const [x, y, shape] of paint) {
    const skin = shape === 'scree' ? pick(MTN.scree) : shape ? pick(MTN.edge[shape])
      : isMassSkin(b.palette[b.ground[y][x]]) && b.palette[b.ground[y][x]].startsWith('ow_mtn_peak') ? b.palette[b.ground[y][x]]
      : pick(MTN.peak)
    b.g(x, y, skin)
    b.block(x, y)
  }
  // A boulder some clearing walked over (clearProp only strips props) is
  // floor now: a walkable cell never keeps a scree skin.
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++)
    if (b.walkable(x, y) && b.palette[b.ground[y][x]]?.startsWith('ow_mtn_scree')) b.g(x, y, pick(MTN_FLOOR_WEIGHTED))
}
