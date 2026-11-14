// Ground edge tiles, shared by the mountain floor (mountain.mjs) and the
// beach (beach.mjs): a base ground frayed into the ground beside it.
//
// A set is 46 shapes: M = the open-side mask (1 N / 2 E / 4 S / 8 W, the
// sides where the neighbour is not the base material) and D = the concave
// corners to nibble (1 NE / 2 SE / 4 SW / 8 NW — only corners whose two
// flanking sides are closed, so a corner never doubles a frayed side), each
// in V variants. tools/synth-ground-edges.mjs draws the PNGs; stampEdges
// lays them from the neighbourhood, hash-picked so no rng draw moves a tree.
export const hash = (a, b, c = 0) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return h >>> 0 }

const freeCorners = M => (!(M & 3) ? 1 : 0) | (!(M & 6) ? 2 : 0) | (!(M & 12) ? 4 : 0) | (!(M & 9) ? 8 : 0)
export const EDGE_SHAPES = []
for (let M = 0; M < 16; M++) for (let D = 0; D < 16; D++) if ((M || D) && (D & ~freeCorners(M)) === 0) EDGE_SHAPES.push([M, D])

export const edgeTileName = (prefix, M, D, V) => `${prefix}_${M}_${D}_${V}`
export const edgeTileNames = (prefix, variants) =>
  EDGE_SHAPES.flatMap(([M, D]) => Array.from({ length: variants }, (_, V) => edgeTileName(prefix, M, D, V)))

// Fray one material into its neighbours. `base(skin)` says which ground
// cells get repainted (the plain material and its edge tiles), `inside(skin)`
// which neighbours count as the same material (off the map always does, so
// nothing frays against the border), `plain(x, y)` the plain skin for a cell
// that no longer needs an edge. Ground only — props, collision and everything
// on the prop layer are untouched. Idempotent. Returns how many cells changed.
export function stampEdges(b, { base, inside, prefix, variants, plain }) {
  const same = (x, y) => !b.in(x, y) || inside(b.palette[b.ground[y][x]])
  const writes = []
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const g = b.palette[b.ground[y][x]]
    if (!base(g)) continue
    const M = (same(x, y - 1) ? 0 : 1) | (same(x + 1, y) ? 0 : 2) | (same(x, y + 1) ? 0 : 4) | (same(x - 1, y) ? 0 : 8)
    let D = 0
    if (!(M & 3) && !same(x + 1, y - 1)) D |= 1
    if (!(M & 6) && !same(x + 1, y + 1)) D |= 2
    if (!(M & 12) && !same(x - 1, y + 1)) D |= 4
    if (!(M & 9) && !same(x - 1, y - 1)) D |= 8
    const want = M || D ? edgeTileName(prefix, M, D, hash(x, y, 5) % variants) : g.startsWith(prefix) ? plain(x, y) : g
    if (want !== g) writes.push([x, y, want])
  }
  for (const [x, y, skin] of writes) b.g(x, y, skin)
  return writes.length
}
