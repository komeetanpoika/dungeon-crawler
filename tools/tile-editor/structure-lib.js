// tools/tile-editor/structure-lib.js
// Pure helpers for the Build-tab properties layer and structure export. No DOM.
// A properties cell is `null` or { collision?: 'wall'|'walkable',
//   interaction?: { type: 'door'|'chest' }, structure?: true }.

// Toggle/replace one property on a properties cell, returning a NEW cell (or null
// when the cell ends up empty). Collision replaces; painting the same collision or
// interaction type, or toggling structure, clears it. The returned cell is fresh and
// should be treated as immutable by callers — do not mutate its nested `interaction`
// object in place.
export function setProperty(cell, property, payload) {
  const c = cell ? { ...cell } : {}
  if (property === 'collision') {
    if (c.collision === payload) delete c.collision
    else c.collision = payload
  } else if (property === 'interaction') {
    if (c.interaction?.type === payload) delete c.interaction
    else c.interaction = { type: payload }
  } else if (property === 'structure') {
    if (c.structure) delete c.structure
    else c.structure = true
  }
  return Object.keys(c).length > 0 ? c : null
}

// base/overlay: grid[row][col] = tile name | null. props: grid[row][col] = cell|null.
// tileMeta: Map<name, { role, tags }>. Returns { w, h, cells } or null when no
// structure-marked cell has a painted base tile. Cells are sparse and normalized so
// the footprint's top-left is (0,0).
export function exportStructure(base, overlay, props, tileMeta) {
  const marked = []
  for (let y = 0; y < props.length; y++) {
    for (let x = 0; x < (props[y]?.length ?? 0); x++) {
      if (props[y][x]?.structure && base[y]?.[x]) marked.push({ x, y })
    }
  }
  if (marked.length === 0) return null
  const xs = marked.map(m => m.x), ys = marked.map(m => m.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const maxX = Math.max(...xs), maxY = Math.max(...ys)
  const cells = marked.map(({ x, y }) => {
    const p = props[y][x]
    const role = tileMeta.get(base[y][x])?.role
    return {
      x: x - minX,
      y: y - minY,
      skin: base[y][x],
      overlay: overlay[y]?.[x] ?? null,
      // Explicit collision wins; otherwise derive from the tile's role. Unknown or
      // untagged tiles (no role) intentionally default to walkable.
      collision: p.collision ?? (role === 'wall' ? 'wall' : 'walkable'),
      interaction: p.interaction ?? null,
    }
  })
  return { w: maxX - minX + 1, h: maxY - minY + 1, cells }
}
