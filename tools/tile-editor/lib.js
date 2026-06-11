// Pure helpers for the tile editor. No DOM — unit-tested with node --test.

export const SIZE = 16

export function idx(x, y) { return y * SIZE + x }

export function wrapIndex(i, n = SIZE) { return ((i % n) + n) % n }

// User-typed name → 'custom_<slug>' or null if nothing usable remains.
export function sanitizeTileName(raw) {
  const cleaned = String(raw).toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return null
  return `custom_${cleaned.replace(/^custom_/, '')}`
}

// grid: Array(SIZE*SIZE) of '#rrggbbaa' strings (null = transparent).
// Returns a new grid; with wrap, neighbor lookup goes around the edges so
// fills behave seamlessly like the final tiled texture.
export function floodFill(grid, x, y, color, wrap = false) {
  const target = grid[idx(x, y)]
  if (target === color) return grid
  const out = grid.slice()
  const stack = [[x, y]]
  const seen = new Set()
  while (stack.length) {
    const [cx, cy] = stack.pop()
    const key = cx + ',' + cy
    if (seen.has(key)) continue
    seen.add(key)
    if (out[idx(cx, cy)] !== target) continue
    out[idx(cx, cy)] = color
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = cx + dx, ny = cy + dy
      if (wrap) { nx = wrapIndex(nx); ny = wrapIndex(ny) }
      else if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
      stack.push([nx, ny])
    }
  }
  return out
}

export function rgbaToHex(r, g, b, a = 255) {
  return '#' + [r, g, b, a].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function hexToRgba(hex) {
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255
  return [r, g, b, a]
}
