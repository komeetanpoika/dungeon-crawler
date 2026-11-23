// Pixel rules that give house furniture lit and shaded edges and a floor shadow.
// Light comes from the upper left. Both functions are self-contained (no imports,
// no module state) so tools can pass their source into a browser page.

import { SHADE_KIND, SHADE_LEVEL } from '../interior/kit.js'

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

// Shades the loaded furniture sprites in place of the plain pictures. For each
// name in `kinds` that `sprites` holds: the sprite becomes a canvas of the
// rim-shaded pixels; a 'cast' name also gets `name#cast` (its shadow on its own
// cell) and `name#below` (what spills into the cell under it, when anything).
// Done names are remembered in the non-enumerable `sprites.__shaded`, so a
// second pass does nothing. Returns how many it shaded.
export function shadeSprites(sprites, { kinds = SHADE_KIND, level = SHADE[SHADE_LEVEL], makeCanvas }) {
  if (!sprites.__shaded) Object.defineProperty(sprites, '__shaded', { value: new Set() })
  const paint = (rgba, w, h) => {
    const c = makeCanvas(w, h), g = c.getContext('2d')
    const img = g.getImageData(0, 0, w, h)
    img.data.set(rgba)
    g.putImageData(img, 0, 0)
    return c
  }
  let n = 0
  for (const [name, kind] of kinds) {
    const src = sprites[name]
    if (!src || sprites.__shaded.has(name)) continue
    const w = src.width, h = src.height
    const read = makeCanvas(w, h), rg = read.getContext('2d')
    rg.drawImage(src, 0, 0)
    const rgba = rg.getImageData(0, 0, w, h).data
    if (kind === 'cast') {
      const { self, below } = castShadow(rgba, w, h, level)
      sprites[`${name}#cast`] = paint(self, w, h)
      if (below) sprites[`${name}#below`] = paint(below, w, h)
    }
    sprites[name] = paint(rimShade(rgba, w, h, level), w, h)
    sprites.__shaded.add(name)
    n++
  }
  return n
}
