// Pixel rules that give house furniture lit and shaded edges and a floor shadow.
// Light comes from the upper left. Both functions are self-contained (no imports,
// no module state) so tools can pass their source into a browser page.

export const SHADE = {
  subtle: { light: 0.10, dark: 0.14, cast: 0.18, dx: 1, dy: 2 },
  medium: { light: 0.16, dark: 0.22, cast: 0.26, dx: 1, dy: 2 },
  strong: { light: 0.24, dark: 0.32, cast: 0.36, dx: 1, dy: 3 },
}

// Outline: opaque and dark. Body: opaque and not outline.
export function rimShade(rgba, w, h, level) {
  const out = new Uint8ClampedArray(rgba)
  const kind = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    const i = (y * w + x) * 4
    if (rgba[i + 3] < 128) return 0
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] < 70 ? 1 : 2
  }
  // an "open" neighbour is transparent, off the tile, or outline
  const open = (x, y) => kind(x, y) !== 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (kind(x, y) !== 2) continue
      const i = (y * w + x) * 4
      if (open(x, y - 1) || open(x - 1, y)) {
        for (let c = 0; c < 3; c++) out[i + c] = rgba[i + c] + (255 - rgba[i + c]) * level.light
      } else if (open(x, y + 1) || open(x + 1, y)) {
        for (let c = 0; c < 3; c++) out[i + c] = rgba[i + c] * (1 - level.dark)
      }
    }
  }
  return out
}

// The silhouette moved by (dx, dy): what falls in the cell itself, and what falls into the cell below.
export function castShadow(rgba, w, h, level) {
  const self = new Uint8ClampedArray(w * h * 4)
  let below = null
  const alpha = Math.round(255 * level.cast)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] < 128) continue
      const sx = x + level.dx, sy = y + level.dy
      if (sx >= w) continue
      if (sy < h) {
        self[(sy * w + sx) * 4 + 3] = alpha
      } else {
        if (!below) below = new Uint8ClampedArray(w * h * 4)
        below[((sy - h) * w + sx) * 4 + 3] = alpha
      }
    }
  }
  return { self, below }
}
