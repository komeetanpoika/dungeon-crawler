// Pure helpers for the template Build tab. No DOM — unit-tested with node --test.
// A grid is a 2D array of single-char symbols (keys of TEMPLATE_LEGEND);
// grid[row][col]. '#' (wall) is the neutral/empty fill.

const WALL = '#'

export function createBlankGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => WALL))
}

// Crop on shrink, pad with wall on grow. Preserves painted content in-bounds.
export function resizeGrid(grid, width, height) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => grid[y]?.[x] ?? WALL))
}

export function gridToTemplate(grid) {
  return {
    tiles: grid.map(row => row.join('')),
    width: grid[0]?.length ?? 0,
    height: grid.length,
  }
}

export function gridFromTemplate(tmpl) {
  return tmpl.tiles.map(row => [...row])
}

// User-typed name → 'UPPER_SNAKE' or null if nothing usable remains.
export function sanitizeTemplateName(raw) {
  const cleaned = String(raw).toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || null
}
