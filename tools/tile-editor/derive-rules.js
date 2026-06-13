// Pure: base + overlay painted grids + tile metadata → a ruleset fragment. No DOM.
// Each grid is grid[row][col] = tile name or null (empty); both share dimensions.
// tileMeta: Map<tileName, { role: 'floor'|'wall'|'overlay', tags: string[] }>.
// Returns { tiles, tags, skipped }:
//   tiles[name] = { tags, weight }
//   tags[tag]   = { role, allow:['*'], forbid:[], directional:{}, adjacency:{n,e,s,w} }
//                 base (floor/wall) tags additionally gain `overlays` (base-conditional
//                 distribution over overlay tags + '' = no overlay) during conditioning.
//   skipped     = count of placed-but-untagged cells across both layers.

const DIRS = [
  { dx: 0, dy: -1, d: 'n' },
  { dx: 1, dy: 0,  d: 'e' },
  { dx: 0, dy: 1,  d: 's' },
  { dx: -1, dy: 0, d: 'w' },
]

function metaOf(tileMeta, name) {
  if (name == null) return null
  const m = tileMeta.get(name)
  return m && Array.isArray(m.tags) && m.tags.length ? m : null
}

// Weights + tag registration + same-layer directional adjacency. Mutates tiles/tags.
function accumulateLayer(grid, tileMeta, tiles, tags) {
  let skipped = 0
  for (const row of grid) {
    for (const name of row) {
      if (name == null) continue
      const meta = metaOf(tileMeta, name)
      if (!meta) { skipped++; continue }
      tiles[name] = tiles[name] ?? { tags: meta.tags.slice(), weight: 0 }
      tiles[name].weight++
      for (const t of meta.tags) {
        if (!tags[t]) {
          tags[t] = { role: meta.role, allow: ['*'], forbid: [], directional: {}, adjacency: { n: {}, e: {}, s: {}, w: {} } }
        }
      }
    }
  }
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const meta = metaOf(tileMeta, grid[y][x])
      if (!meta) continue
      for (const { dx, dy, d } of DIRS) {
        const nbMeta = metaOf(tileMeta, grid[y + dy]?.[x + dx])
        if (!nbMeta) continue
        for (const t of meta.tags) {
          for (const u of nbMeta.tags) {
            tags[t].adjacency[d][u] = (tags[t].adjacency[d][u] ?? 0) + 1
          }
        }
      }
    }
  }
  return skipped
}

export function deriveRules(baseGrid, overlayGrid, tileMeta) {
  const tiles = {}
  const tags = {}
  let skipped = 0

  skipped += accumulateLayer(baseGrid, tileMeta, tiles, tags)
  skipped += accumulateLayer(overlayGrid, tileMeta, tiles, tags)

  // Base-conditional overlay distribution (incl. '' = no overlay) on base tags.
  for (let y = 0; y < baseGrid.length; y++) {
    for (let x = 0; x < baseGrid[y].length; x++) {
      const baseMeta = metaOf(tileMeta, baseGrid[y][x])
      if (!baseMeta) continue
      // Only true overlay-role tiles count toward the distribution; anything
      // else on the overlay grid (a mis-painted base tile) reads as "no overlay",
      // matching what the decoration pass can actually place.
      const ovMeta = metaOf(tileMeta, overlayGrid[y]?.[x])
      const ov = ovMeta?.role === 'overlay' ? ovMeta : null
      for (const B of baseMeta.tags) {
        const dist = (tags[B].overlays ??= {})
        if (ov) for (const O of ov.tags) dist[O] = (dist[O] ?? 0) + 1
        else dist[''] = (dist[''] ?? 0) + 1
      }
    }
  }

  return { tiles, tags, skipped }
}
