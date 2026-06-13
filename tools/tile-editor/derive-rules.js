// Pure: a painted grid + tile metadata → a ruleset fragment. No DOM.
// grid[row][col] is a tile name or null (empty).
// tileMeta: Map<tileName, { role: 'floor'|'wall', tags: string[] }>.
// Returns { tiles, tags, skipped } where skipped counts placed-but-untagged cells.

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

export function deriveRules(grid, tileMeta) {
  const tiles = {}
  const tags = {}
  let skipped = 0

  // Per-tile weights + tag registration.
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

  // Per-tag directional adjacency counts.
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

  return { tiles, tags, skipped }
}
