// Builds the art of the worn pieces (entities.js WORN_TYPES) into
// renderer/assets/tiles/:
//
//   hero_head_<key>.png   rows 0-9 of a 16x16 figure: the bare head, the
//                         outfits' hood and hat, and each headwear
//   hero_body_<key>.png   rows 10-13 (the robe: 10-15): bare, the outfits'
//                         coat, robe and tabard, and each armor
//   hero_feet_<key>.png   rows 14-15: bare feet and each pair of boots
//   gear_<gearType>.png   a 16x16 icon for the bag, the floor and the shops
//   outfit_tabard.png     the Knight's Tabard's icon
//
// The hero is dressed by drawing one feet, one body and one head overlay on
// top of each other (render/hero-look.js; data/hero-parts.js says which).
// The pack's figures share a layout, which is what makes that work: the bare
// adventurer (tile_0088), the knight (0097), the ranger (0112) and the
// horned warrior (0087) line up pixel for pixel, and the wizard (0084) sits
// one column to the left with a robe and beard down to row 15 and no feet.
//
// Overlays are cut from those figures where the pack has the thing (helm,
// horned helm, hood, hat, plate, coat, robe) and are small pixel maps in the
// pack's palette where it does not.
//
//   node tools/gear-art/build.mjs
import { fileURLToPath } from 'node:url'
import { readPng } from '../png-read.mjs'
import { writePng } from '../png-write.mjs'

const TILES = fileURLToPath(new URL('../../renderer/assets/tiles/', import.meta.url))
const S = 16
const blank = () => new Uint8Array(S * S * 4)
const tile = n => readPng(`${TILES}tile_${n}.png`).pixels

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
// The pack's colours, and a few of the same family for what it has no piece of.
const PAL = {
  a: '#3f2631',                                  // outline
  s: '#f7c282', t: '#e19a65',                    // skin, skin shade
  h: '#bd6c4a', j: '#763b36',                    // brown, dark brown
  L: '#c0cbdc', M: '#8b9bb4', D: '#52607c',      // steel: light, mid, dark
  e: '#262b44',                                  // eye, deep blue
  r: '#e43b44', R: '#a22633', y: '#feae34', o: '#f77622',   // red, dark red, gold, orange
  w: '#f4f1e6', c: '#d9d0b4',                    // pale hide / cloth, its shade
  g: '#3e8948', G: '#265c42',                    // green, dark green
}

const at = (px, x, y) => (y * S + x) * 4
function set(px, x, y, colour) {
  const i = at(px, x, y), [r, g, b] = hex(colour)
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
}
const get = (px, x, y) => { const i = at(px, x, y); return px[i + 3] ? '#' + [px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('') : null }

// rows y0..y1 of a figure, the rest clear
function rows(src, y0, y1) {
  const out = blank()
  out.set(src.subarray(y0 * S * 4, (y1 + 1) * S * 4), y0 * S * 4)
  return out
}
// every pixel of colour `from` becomes `to` ({ '#from': '#to' })
function recolour(px, map) {
  const out = px.slice()
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = get(out, x, y); if (c && map[c]) set(out, x, y, map[c]) }
  return out
}
// a pixel map: lines of PAL letters ('.' clear), drawn from row `y0`, over `base` if given
function paint(lines, y0 = 0, base = null, pal = PAL) {
  const out = base ? base.slice() : blank()
  lines.forEach((line, dy) => [...line].forEach((ch, x) => { if (ch !== '.' && ch !== ' ') set(out, x, y0 + dy, pal[ch]) }))
  return out
}

const BARE = tile('0088'), KNIGHT = tile('0097'), WIZARD = tile('0084'), RANGER = tile('0112'), HORNED = tile('0087')

// ---- heads (rows 0-9) --------------------------------------------------------
// A leather cap: the bare head's hair under dark leather, with a pale brim.
const CAP = paint([
  '....aaaaaaaa....',
  '...aaaajjjaaa...',
  '..aaajjhjjjaaa..',
  '..aajjjjjjjjaa..',
  '..aayyyyyyyyaa..',
], 1, rows(BARE, 0, 9))
// A desert headcloth: pale cloth bound with a dark cord, hanging by the cheeks.
const CLOTH = paint([
  '....aaaaaaaa....',
  '...aaaawwwaaa...',
  '..aaawwwwwwaaa..',
  '..aaeeeeeeeeaa..',
  '..aawwwwwwwwaa..',
  '..aaw......waa..',
  '..aac......caa..',
  '..aac......caa..',
  '..aaac....caaa..',
], 1, rows(BARE, 0, 9))

const HEADS = {
  bare: rows(BARE, 0, 9), hood: rows(RANGER, 0, 9), hat: rows(WIZARD, 0, 9),
  cap: CAP, helm: rows(KNIGHT, 0, 9), horned: rows(HORNED, 0, 9), cloth: CLOTH,
}

// ---- bodies (rows 10-13; the robe to 15) ---------------------------------------
// The knight's body is the shape of all the made ones: shoulders, chest, the
// two hands at the sides, the belt. Hands are skin unless the piece gloves them.
const BODIES = {
  bare: rows(BARE, 10, 13), coat: rows(RANGER, 10, 13), robe: rows(WIZARD, 10, 15), plate: rows(KNIGHT, 10, 13),
  // the Knight's Tabard: red cloth with a gold charge, bare hands
  tabard: paint([
    '.aarraaaaaarraa.',
    'aaarrRrrrrRrraaa',
    'aassRRryyrRRssaa',
    'aassarrrrrrassaa',
  ], 10),
  leather: paint([
    '.aahhaaaaaahhaa.',
    'aaahhjhhhhjhhaaa',
    'aassjjhjjhjjssaa',
    'aassajjjjjjassaa',
  ], 10),
  // mail: darker than plate, a broken pattern across the chest, bare hands
  chain: paint([
    '.aaMMaaaaaaMMaa.',
    'aaaMDMDMDMDMDaaa',
    'aassDMDMDMDMssaa',
    'aassahhhhhhassaa',
  ], 10),
}

// ---- feet (rows 14-15) -----------------------------------------------------------
const feet = (top, sole) => paint([
  'aaaaa' + top + top + 'aa' + top + top + 'aaaaa',
  '.aaaa' + sole + sole + 'aa' + sole + sole + 'aaaa.',
], 14)
const FEET = {
  bare: rows(BARE, 14, 15),
  elk: feet('w', 'c'),           // pale hide, fur side out
  ironshod: rows(KNIGHT, 14, 15),
  wayfarer: feet('g', 'G'),      // a traveller's green
}

// ---- icons ---------------------------------------------------------------------
// Headwear: the head overlay with the face blacked out (an empty helm, not a
// head), set a little lower so it sits in the middle of its tile.
const FACE = new Set([PAL.s, PAL.t, PAL.e, '#eaa56c'])
function headIcon(head, keep = []) {
  const out = blank()
  for (let y = 0; y < 10; y++) for (let x = 0; x < S; x++) {
    const c = get(head, x, y)
    if (c) set(out, x, y + 3, FACE.has(c) && !keep.includes(c) ? PAL.a : c)
  }
  return out
}
// One shape for each of the other three slots, coloured per piece:
// 1 main, 2 shade, 3 light, 4 a second colour (a ring's stone, a tabard's charge).
const TORSO = [
  '................',
  '..aaa......aaa..',
  '.a111a.aa.a111a.',
  '.a1111a33a1111a.',
  '.a121111111121a.',
  '..a1211111121a..',
  '..aa12111121aa..',
  '...a12144121a...',
  '...a11144111a...',
  '...a12111121a...',
  '...a11222211a...',
  '...a11111111a...',
  '...a12222221a...',
  '....aaaaaaaa....',
]
const BOOTS = [
  '................',
  '................',
  '..aaaa....aaaa..',
  '..a33a....a33a..',
  '..a11a....a11a..',
  '..a11a....a11a..',
  '..a11a....a11a..',
  '..a12a....a12a..',
  '..a11aa...a11aa.',
  '..a111aa..a111aa',
  '..a1111a..a1111a',
  '..a2222a..a2222a',
  '..aaaaaa..aaaaaa',
]
const RING = [
  '................',
  '................',
  '......aaaa......',
  '.....a3443a.....',
  '.....a4444a.....',
  '......a44a......',
  '.....aa11aa.....',
  '....a11aa11a....',
  '...a11a..a11a...',
  '...a1a....a1a...',
  '...a1a....a1a...',
  '...a12a..a11a...',
  '....a12aa11a....',
  '.....a2211a.....',
  '......aaaa......',
]
const shaped = (shape, c1, c2, c3, c4 = c1) => paint(shape, 0, null, { a: PAL.a, 1: c1, 2: c2, 3: c3, 4: c4 })

// a ring's stone is its tint (entities.js WORN_TYPES `tint`), lit a little
const RING_TINTS = { breath: '#7dd3fc', mending: '#4ade80', miser: '#facc15', smith: '#cbd5e1' }
const ICONS = {
  cap: headIcon(HEADS.cap), helm: headIcon(HEADS.helm), horned: headIcon(HEADS.horned, ['#eaa56c']), cloth: headIcon(HEADS.cloth),
  leather: shaped(TORSO, PAL.h, PAL.j, PAL.y),
  chain: shaped(TORSO, PAL.M, PAL.D, PAL.L),
  plate: shaped(TORSO, PAL.L, PAL.M, '#ffffff'),
  elk: shaped(BOOTS, PAL.w, PAL.c, PAL.h),
  ironshod: shaped(BOOTS, PAL.h, PAL.D, PAL.L),
  wayfarer: shaped(BOOTS, PAL.g, PAL.G, PAL.y),
  ...Object.fromEntries(Object.entries(RING_TINTS).map(([key, tint]) => [key, shaped(RING, PAL.y, PAL.o, '#ffffff', tint)])),
}
const TABARD_ICON = shaped(TORSO, PAL.r, PAL.R, PAL.y, PAL.y)

// ---- write -----------------------------------------------------------------------
export const PARTS = { head: HEADS, body: BODIES, feet: FEET }
export function buildAll() {
  const files = {}
  for (const [zone, set] of Object.entries(PARTS)) for (const [key, px] of Object.entries(set)) files[`hero_${zone}_${key}`] = px
  for (const [key, px] of Object.entries(ICONS)) files[`gear_${key}`] = px
  files.outfit_tabard = TABARD_ICON
  return files
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = buildAll()
  for (const [name, px] of Object.entries(files)) writePng(`${TILES}${name}.png`, S, S, px)
  console.log(`wrote ${Object.keys(files).length} tiles to ${TILES}`)
}
