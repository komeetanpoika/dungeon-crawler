// Builds the ten tiles the wands-and-bows redesign needs, in the same
// pixel-map style as tools/make-firewand-tile.mjs:
//
//   weapon_hunterbow  weapon_splitbow  weapon_crossbow  weapon_sling
//   weapon_frostwand  weapon_bramblewand  weapon_blinkwand
//   item_arrows  item_bolts  item_stones
//
// The two new bows are recolours of the hand-drawn weapon_shortbow /
// weapon_longbow PNGs, which are 8-bit RGBA and so readable with our own
// tools/png-read.mjs — no need to transcribe a shape we already own. The
// tileset's own wand tiles (tile_0129/0130) are 4-bit indexed and our reader
// refuses them, so the straight and wavy wand shapes are transcribed here as
// pixel maps, exactly as make-firewand-tile.mjs had to do.
//
//   node tools/make-ranged-tiles.mjs
import { writePng } from './png-write.mjs'
import { readPng } from './png-read.mjs'

const W = 16, H = 16
const TILES = new URL('../renderer/assets/tiles/', import.meta.url).pathname

// ---------------------------------------------------------------- palettes

// Shared with make-firewand-tile.mjs so every wand reads as one family: the
// same dark rim, shaft and collar, only the tip changes colour.
const WAND_BASE = {
  a: [0x3f, 0x26, 0x31],   // dark rim
  c: [0xbd, 0x6c, 0x4a],   // shaft
  d: [0xea, 0xa5, 0x6c],   // shaft highlight
  e: [0x76, 0x3b, 0x36],   // collar shadow
}

// The straight wand (make-firewand-tile.mjs's transcription of tile_0129).
// b = tip core, B = tip highlight; every wand supplies its own pair.
const STRAIGHT_WAND = [
  '......aaaa......',
  '.....aaaaaa.....',
  '.....aaBBaa.....',
  '....aaaBBaaa....',
  '....aacbbcaa....',
  '....aacbbcaa....',
  '....aadccdaa....',
  '....aaaeeaaa....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaddaa.....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaaaaa.....',
  '......aaaa......',
]

// The wavy wand: a tip orb over a shaft that snakes a pixel either way, the
// silhouette tile_0130 (the Spark Wand) reads as. Drawn rather than read for
// the same 4-bit reason.
const WAVY_WAND = [
  '......aaaa......',
  '.....aaBBaa.....',
  '.....aBbbBa.....',
  '.....aabbaa.....',
  '......aeea......',
  '......acca......',
  '......acda......',
  '.....acca.......',
  '.....acda.......',
  '......acca......',
  '.......acca.....',
  '.......acda.....',
  '......acca......',
  '......acda......',
  '......acca......',
  '......aaaa......',
]

// ------------------------------------------------------------- pixel maps

// Crossbow, upright: a metal bolt in the groove, a curved prod whose limb
// tips droop, the string converging back to the nock, and the stock running
// down the middle over the top of the string.
const CROSSBOW = [
  '................',
  '.......aa.......',
  '......amma......',
  '......amma......',
  '...aaaaaaaaaa...',
  '..assssssssssa..',
  '..as..asSa..sa..',
  '...t..asSa..t...',
  '....t.asSa.t....',
  '.....tasSat.....',
  '......asSa......',
  '......asSa......',
  '......asSa......',
  '......asSa......',
  '......aaaa......',
  '................',
]
const CROSSBOW_PALETTE = {
  a: [0x3f, 0x26, 0x31],   // dark rim
  s: [0x8a, 0x5a, 0x2b],   // stock wood (the bows' wood)
  S: [0xea, 0xa5, 0x6c],   // stock highlight
  m: [0xe5, 0xe7, 0xeb],   // steel — the crossbow's table colour
  t: [0xe8, 0xe0, 0xcf],   // string (as on the bow tiles)
}

// Sling: two cords narrowing into a leather pouch with a stone already in it,
// so the tile reads as ammo-fed even lying on the floor.
const SLING = [
  '...t........t...',
  '...t........t...',
  '....t......t....',
  '....t......t....',
  '.....t....t.....',
  '.....t....t.....',
  '......t..t......',
  '......t..t......',
  '.....aaaaaa.....',
  '....apggggpa....',
  '....apggggpa....',
  '....apggggpa....',
  '.....apggpa.....',
  '......aaaa......',
  '................',
  '................',
]
const SLING_PALETTE = {
  a: [0x3f, 0x26, 0x31],   // dark rim
  t: [0xe8, 0xe0, 0xcf],   // cord
  p: [0x8a, 0x5a, 0x2b],   // leather pouch
  g: [0xa8, 0xa2, 0x9e],   // the loaded stone — the sling's table colour
}

// Three arrows stood in a bundle: steel heads, wooden shafts, yellow
// fletching matching the arrow projectile's colour.
const ARROWS = [
  '................',
  '...m...m...m....',
  '..mmm.mmm.mmm...',
  '...w...w...w....',
  '...w...w...w....',
  '...w...w...w....',
  '...w...w...w....',
  '...w...w...w....',
  '...w...w...w....',
  '...w...w...w....',
  '...w...w...w....',
  '..fwf.fwf.fwf...',
  '..fwf.fwf.fwf...',
  '...w...w...w....',
  '................',
  '................',
]
const ARROWS_PALETTE = {
  m: [0xe5, 0xe7, 0xeb],   // steel head
  w: [0x8a, 0x5a, 0x2b],   // shaft
  f: [0xfa, 0xcc, 0x15],   // fletching — the arrow projectile's yellow
}

// Bolts: shorter and stubbier than arrows, two pixels thick, with pale vanes.
const BOLTS = [
  '................',
  '................',
  '................',
  '..mm...mm...mm..',
  '..mm...mm...mm..',
  '..ww...ww...ww..',
  '..ww...ww...ww..',
  '..ww...ww...ww..',
  '..ww...ww...ww..',
  '..ww...ww...ww..',
  '..ww...ww...ww..',
  '.vwwv.vwwv.vwwv.',
  '.vwwv.vwwv.vwwv.',
  '..ww...ww...ww..',
  '................',
  '................',
]
const BOLTS_PALETTE = {
  m: [0xe5, 0xe7, 0xeb],   // steel head
  w: [0x5c, 0x3d, 0x1e],   // dark shaft — bolts are stubby and dark
  v: [0xe8, 0xe0, 0xcf],   // vane
}

// Sling stones: a little cairn of three pebbles.
const STONES = [
  '................',
  '................',
  '................',
  '................',
  '......aaa.......',
  '.....agGga......',
  '.....aggga......',
  '......aaa.......',
  '................',
  '..aaa......aaa..',
  '.agGga....agGga.',
  '.aggga....aggga.',
  '..aaa......aaa..',
  '................',
  '................',
  '................',
]
const STONES_PALETTE = {
  a: [0x3f, 0x26, 0x31],   // dark rim
  g: [0xa8, 0xa2, 0x9e],   // stone — the sling's table colour
  G: [0xd6, 0xd3, 0xd1],   // lit face
}

// ------------------------------------------------------------------ paint

function paint(shape, palette, name) {
  if (shape.length !== H) throw new Error(`${name}: ${shape.length} rows, expected ${H}`)
  const rgba = new Uint8Array(W * H * 4)
  shape.forEach((row, y) => {
    if (row.length !== W) throw new Error(`${name}: row ${y} is ${row.length} wide, expected ${W}`)
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      const rgb = palette[ch]
      if (!rgb) throw new Error(`${name}: no palette entry for '${ch}' at ${x},${y}`)
      rgba.set([...rgb, 255], (y * W + x) * 4)
    })
  })
  return rgba
}

// Swap exact colours in an existing tile. Keys are 'r,g,b' of the source.
function recolour(srcName, map) {
  const { width, height, pixels } = readPng(`${TILES}${srcName}.png`)
  if (width !== W || height !== H) throw new Error(`${srcName}: expected ${W}x${H}, got ${width}x${height}`)
  const out = Uint8Array.from(pixels)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const to = map[`${out[i]},${out[i + 1]},${out[i + 2]}`]
    if (to) out.set(to, i)
  }
  return out
}

// A parallel second string one pixel outboard of the first: the Splitbow's
// forked shot, told in the silhouette. Only transparent pixels are taken, so
// the limbs stay exactly as drawn.
function doubleString(rgba, stringRgb, ghostRgb) {
  const src = Uint8Array.from(rgba)
  const at = (x, y) => (y * W + x) * 4
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
    const i = at(x, y)
    if (src[i + 3] === 0) continue
    if (src[i] !== stringRgb[0] || src[i + 1] !== stringRgb[1] || src[i + 2] !== stringRgb[2]) continue
    const j = at(x + 1, y)
    if (src[j + 3] !== 0) continue
    rgba.set([...ghostRgb, 255], j)
  }
  return rgba
}

const WOOD = { light: '138,90,43', dark: '92,58,30', gold: '232,184,75' }
const STRING = [0xe8, 0xe0, 0xcf]

const OUTPUTS = [
  // Bows: the shortbow shape in pale ash for the quick Hunter's Bow, the
  // longbow shape in yew green with a twin string for the Splitbow.
  ['weapon_hunterbow', () => recolour('weapon_shortbow', {
    [WOOD.light]: [0xd6, 0xba, 0x8a],
    [WOOD.dark]:  [0x9c, 0x7d, 0x50],
  })],
  ['weapon_splitbow', () => doubleString(recolour('weapon_longbow', {
    [WOOD.gold]:  [0x84, 0xcc, 0x16],
    [WOOD.light]: [0x4d, 0x7c, 0x0f],
    [WOOD.dark]:  [0x36, 0x53, 0x14],
  }), STRING, [0xa8, 0xa2, 0x9e])],

  ['weapon_crossbow', () => paint(CROSSBOW, CROSSBOW_PALETTE, 'crossbow')],
  ['weapon_sling',    () => paint(SLING, SLING_PALETTE, 'sling')],

  // Wands: one shape each, told apart only by the tip, matching the spell
  // colours in WAND_TYPES (#93c5fd rime, #65a30d bramble, #c084fc blink).
  ['weapon_frostwand', () => paint(STRAIGHT_WAND,
    { ...WAND_BASE, b: [0x93, 0xc5, 0xfd], B: [0xdb, 0xea, 0xfe] }, 'frostwand')],
  ['weapon_bramblewand', () => paint(WAVY_WAND,
    { ...WAND_BASE, b: [0x65, 0xa3, 0x0d], B: [0xbe, 0xf2, 0x64] }, 'bramblewand')],
  ['weapon_blinkwand', () => paint(WAVY_WAND,
    { ...WAND_BASE, b: [0xc0, 0x84, 0xfc], B: [0xf3, 0xe8, 0xff] }, 'blinkwand')],

  ['item_arrows', () => paint(ARROWS, ARROWS_PALETTE, 'arrows')],
  ['item_bolts',  () => paint(BOLTS, BOLTS_PALETTE, 'bolts')],
  ['item_stones', () => paint(STONES, STONES_PALETTE, 'stones')],
]

for (const [name, build] of OUTPUTS) {
  const out = `${TILES}${name}.png`
  writePng(out, W, H, build())
  console.log(`wrote ${out}`)
}
