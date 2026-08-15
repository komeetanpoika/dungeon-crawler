// The pixel dragon's locked 16-colour palette, derived from the vector boss's
// own colours. Every opaque pixel in assets/tiles/dragon_boss_parts.png must be
// one of these — asserted by test/dragon-parts.test.js, so hand-drawn
// replacements stay on-palette automatically.
export const DRAGON_PALETTE = [
  [ 20,   8,   6],   //  0 near-black outline
  [ 42,  13,  10],   //  1 deepest shadow
  [ 58,  18,  13],   //  2 body underlay
  [ 90,  23,  18],   //  3 foot pad / dark scale
  [124,  36,  27],   //  4 scale mid-dark
  [156,  46,  36],   //  5 wing bone
  [184,  58,  44],   //  6 scale mid
  [212,  85,  58],   //  7 scale light
  [239, 138,  90],   //  8 highlight
  [ 86,  21,  16],   //  9 membrane dark
  [146,  48,  40],   // 10 membrane
  [239, 224, 192],   // 11 claw / tooth
  [216, 184, 134],   // 12 horn
  [122,  96,  60],   // 13 horn shadow
  [255, 210,  58],   // 14 eye glow
  [255, 122,  42],   // 15 flame
]

export function rgbKey(r, g, b) { return (r << 16) | (g << 8) | b }

export const PALETTE_KEYS = new Set(DRAGON_PALETTE.map(([r, g, b]) => rgbKey(r, g, b)))

// Nearest palette entry by squared RGB distance. Used by the bake.
export function nearestPaletteColor(r, g, b) {
  let best = DRAGON_PALETTE[0], bd = Infinity
  for (const c of DRAGON_PALETTE) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2
    if (d < bd) { bd = d; best = c }
  }
  return best
}
