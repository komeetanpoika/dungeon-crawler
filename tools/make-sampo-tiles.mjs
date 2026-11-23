// Builds the Sampo story's art into renderer/assets/tiles/. Its places: the
// giant Vipunen's belly (a wall palette `flesh`, a floor, a rib, the gullet
// that is the way out), the keep's battlements (a wall palette `roof`: the
// parapet from above, merlon and embrasure), the lid with the Sampo under it,
// the fountain with the Sampo in it, and the copper mountain's braziers, cold
// and lit. And its small things: the three
// lost pieces of the mill (the sea's wheel, the mountain's grindstone, the
// marsh's hopper), the great pike's jawbone, a salt herring, and the Sampo
// made whole. Pixel maps, as make-lalli-tiles.mjs.
//
//   node tools/make-sampo-tiles.mjs
import { writePng } from './png-write.mjs'
import { readPng } from './png-read.mjs'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function tile(name, rows, palette) {
  const rgba = new Uint8Array(16 * 16 * 4)
  if (rows.length !== 16 || rows.some(r => r.length !== 16)) throw new Error(`${name}: not 16x16`)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    if (!palette[ch]) throw new Error(`${name}: no colour for "${ch}"`)
    rgba.set([...hex(palette[ch]), 255], (y * 16 + x) * 4)
  }))
  const out = new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
  writePng(out, 16, 16, rgba)
  console.log(`wrote ${out}`)
}
const INK = '#3f2631'

// the sea piece: a toothed wheel, verdigris and salt
tile('item_sampo_sea', [
  '................',
  '.....kk..kk.....',
  '....kggkkggk....',
  '..kkkgggggggkk..',
  '.kggggwggwgggk..',
  '.kgggwkkkkwgggk.',
  '..kgwkk..kkwgk..',
  '.kggwk....kwggk.',
  '.kggwk....kwggk.',
  '..kgwkk..kkwgk..',
  '.kgggwkkkkwgggk.',
  '.kggggwwwwggggk.',
  '..kkkgggggggkk..',
  '....kggkkggk....',
  '.....kk..kk.....',
  '................',
], { k: INK, g: '#4f9a8a', w: '#d9efe6' })

// the mountain piece: a grindstone bound in copper
tile('item_sampo_mountain', [
  '................',
  '.....kkkkkk.....',
  '...kkssssssk....',
  '..kssssssssssk..',
  '.kcccccccccccck.',
  '.kssssssssssssk.',
  '.ksssskkkksssdk.',
  '.kssssk..kssddk.',
  '.kssssk..kssddk.',
  '.ksssskkkksdddk.',
  '.kssssssssddddk.',
  '.kcccccccccccck.',
  '..ksssssddddk...',
  '...kkssdddkk....',
  '.....kkkkk......',
  '................',
], { k: INK, s: '#b9b3a8', d: '#8d877f', c: '#c9773a' })

// the marsh piece: a hopper of bog-dark wood with a gold rim
tile('item_sampo_marsh', [
  '................',
  '.kkkkkkkkkkkkkk.',
  '.kyyyyyyyyyyyyk.',
  '.kkkkkkkkkkkkkk.',
  '..kbbbbbbbbbbk..',
  '..kbnbbbbbbnbk..',
  '...kbbbbbbbbk...',
  '...kbnbbbbnbk...',
  '....kbbbbbbk....',
  '....kbnbbnbk....',
  '.....kbbbbk.....',
  '.....kbbbbk.....',
  '......kyyk......',
  '......kyyk......',
  '.......kk.......',
  '................',
], { k: INK, b: '#6b4a34', n: '#4a3224', y: '#e2b64a' })

// the pike's jawbone, teeth up
tile('item_pike_jaw', [
  '................',
  '................',
  '..w.w.w.w.w.w...',
  '..w.w.w.w.w.w.w.',
  '.kwkwkwkwkwkwkwk',
  '.kbbbbbbbbbbbbbk',
  '.kbbbbbbbbbbbbk.',
  '..kbbkkkkkbbbk..',
  '..kbbk...kbbk...',
  '...kbbk..kbk....',
  '...kbbk.kbk.....',
  '....kbbkbk......',
  '.....kbbk.......',
  '......kk........',
  '................',
  '................',
], { k: INK, b: '#e8e0c8', w: '#ffffff' })

// a salt herring
tile('item_herring', [
  '................',
  '................',
  '................',
  '................',
  '.kk.....kkkkk...',
  '.ksk..kkssssskk.',
  '.kssk.ksswsssbsk',
  '..ksskssssssssk.',
  '..ksskssssssssk.',
  '.kssk.kssssssk..',
  '.ksk...kkkkkk...',
  '.kk.............',
  '................',
  '................',
  '................',
  '................',
], { k: INK, s: '#9fb4c8', w: '#e8f0f6', b: '#22303c' })

// the Sampo whole: the bright lid over the mill
tile('item_sampo', [
  '................',
  '......kkkk......',
  '....kkryybkk....',
  '...kryyggbbrk...',
  '..kyyggbbrryyk..',
  '.kkkkkkkkkkkkkk.',
  '.kcccccccccccck.',
  '..kssssssssssk..',
  '..ksskkkkkkssk..',
  '..kssk....kssk..',
  '..ksskkkkkkssk..',
  '..kssssssssssk..',
  '.kcccccccccccck.',
  '.kbbbbbbbbbbbbk.',
  '..kkkkkkkkkkkk..',
  '................',
], { k: INK, r: '#d9534f', y: '#e2b64a', g: '#5fb878', b: '#4f8fd0', c: '#c9773a', s: '#b9b3a8' })

// ---- the places -----------------------------------------------------------------------
const tilePath = name => new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
// a tile made from another, colour for colour (`map`: hex -> hex), then touched up a pixel at a time
function remap(from, to, map, touch = null) {
  const src = readPng(tilePath(from)).pixels, out = new Uint8Array(16 * 16 * 4)
  for (let i = 0; i < 256; i++) {
    if (!src[i * 4 + 3]) continue
    const key = '#' + [0, 1, 2].map(c => src[i * 4 + c].toString(16).padStart(2, '0')).join('')
    // a colour the map does not name goes to the one nearest it in lightness (the corner studs)
    const lum = h => { const [r, g, b] = hex(h); return 0.299 * r + 0.587 * g + 0.114 * b }
    const to = map[key] ?? map[Object.keys(map).sort((a, b) => Math.abs(lum(a) - lum(key)) - Math.abs(lum(b) - lum(key)))[0]]
    out.set([...hex(to), 255], i * 4)
  }
  const put = (x, y, c) => out.set([...hex(c), 255], (y * 16 + x) * 4)
  const at = (x, y) => '#' + [0, 1, 2].map(c => out[(y * 16 + x) * 4 + c].toString(16).padStart(2, '0')).join('')
  touch?.(put, at)
  writePng(tilePath(to), 16, 16, out)
  console.log(`wrote ${tilePath(to)}`)
}
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }

// The belly: the grey stone's shapes in meat. Wall tops are dark muscle seen
// from above; the faces are lighter, hung in folds.
const GREY = ['#868686', '#a9a9a9', '#cccccc', '#dbdbdb', '#e3e3e3']
const TOP = { '#868686': '#4a1823', '#a9a9a9': '#7d2c3a', '#cccccc': '#a04350', '#dbdbdb': '#b85560', '#e3e3e3': '#c86a70' }
const FACE = { '#868686': '#6b2431', '#a9a9a9': '#8f3744', '#cccccc': '#bb5a63', '#dbdbdb': '#d27b7c', '#e3e3e3': '#e69a92' }
for (let m = 0; m < 16; m++) remap(`in_wall_grey_${m}`, `in_wall_flesh_${m}`, TOP, (put, at) => {
  // sinew: a few darker flecks in the flat of it
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (at(x, y) === TOP['#a9a9a9'] && hash(x, y, 11) < 0.07) put(x, y, '#6a2331')
})
// folds down the faces: a dark crease with a lit lip, wandering a pixel as it falls
const folds = (rows, salt) => (put, at) => {
  for (const x0 of [3, 8, 13]) for (const y of rows) {
    const x = x0 + (hash(x0, Math.floor(y / 4), salt) < 0.4 ? 1 : 0)
    if (x > 14) continue
    const here = at(x, y)
    if (here === FACE['#cccccc'] || here === FACE['#dbdbdb']) { put(x, y, FACE['#a9a9a9']); if (at(x - 1, y) === here) put(x - 1, y, FACE['#e3e3e3']) }
  }
}
for (const e of ['l', 'm', 'r']) remap(`in_faceu_grey_${e}`, `in_faceu_flesh_${e}`, FACE, folds([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 3))
for (const e of ['l', 'm', 'r', 'lr']) remap(`in_facel_grey_${e}`, `in_facel_flesh_${e}`, FACE, folds([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3))
// the floor: wet and blotched, the same from tile to tile; the worn twin is the sorer
for (const [name, sore] of [['in_floor_flesh', 0], ['in_floor_flesh_worn', 1]]) {
  const rgba = new Uint8Array(16 * 16 * 4)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    // blotches two pixels across, so it reads as tissue and not as noise
    const n = hash(x >> 1, y >> 1, 5), v = hash((x + (y >> 2)) >> 2, y >> 2, 9)
    const c = v < 0.16 + sore * 0.1 ? '#93404c' : n < 0.2 ? '#a94f5a' : n > 0.86 ? '#c56f74' : '#b65d66'
    rgba.set([...hex(c), 255], (y * 16 + x) * 4)
  }
  writePng(tilePath(name), 16, 16, rgba)
  console.log(`wrote ${tilePath(name)}`)
}
const BONE = { k: INK, b: '#ece4cf', s: '#c7bda4', w: '#fbf7ea' }
// a rib, standing: what holds the roof of him up
tile('in_rib', [
  '................',
  '.....kkkkkk.....',
  '....kbwbbbsk....',
  '....kbwbbssk....',
  '.....kbwbsk.....',
  '.....kbwbsk.....',
  '......kbwsk.....',
  '......kbwsk.....',
  '......kbwsk.....',
  '......kbwsk.....',
  '.....kbwbsk.....',
  '.....kbwbsk.....',
  '....kbwbbssk....',
  '...kbbwbbbssk...',
  '...kbbbssssbk...',
  '....kkkkkkkk....',
], BONE)
// the gullet: the way back up, a throat going away into the dark
tile('in_gullet', [
  '....kkkkkkkk....',
  '..kkllllllllkk..',
  '.kllmmmmmmmmllk.',
  '.klmmddddddmmlk.',
  'klmmddddddddmmlk',
  'klmddnnnnnnddmlk',
  'klmddnnnnnnddmlk',
  'klmddnnnnnnddmlk',
  'klmddnnnnnnddmlk',
  'klmddnnnnnnddmlk',
  'klmmddnnnnddmmlk',
  'klmmddddddddmmlk',
  '.klmmddddddmmlk.',
  '.kllmmmmmmmmllk.',
  '..kkllllllllkk..',
  '....kkkkkkkk....',
], { k: '#4a1823', l: '#e69a92', m: '#bb5a63', d: '#6b2431', n: '#1c0a10' })

// The battlements: the parapet from above. The grey wall top with an
// embrasure cut across every straight run of it; corners and ends stay whole.
const LOW = { '#868686': '#6c6c6c', '#a9a9a9': '#8a8a8a', '#cccccc': '#a2a2a2', '#dbdbdb': '#b0b0b0' }
for (let m = 0; m < 16; m++) {
  const NS = m & 5, EW = m & 10
  remap(`in_wall_grey_${m}`, `in_wall_roof_${m}`, Object.fromEntries(GREY.map(c => [c, c])), (put, at) => {
    const band = (x, y) => { const c = at(x, y); if (LOW[c]) put(x, y, LOW[c]) }
    if (EW && !NS) for (let y = 0; y < 16; y++) { for (let x = 6; x <= 9; x++) band(x, y); put(5, y, '#5e5e5e') }        // a run east-west
    if (NS && !EW) for (let x = 0; x < 16; x++) { for (let y = 6; y <= 9; y++) band(x, y); put(x, 5, '#5e5e5e') }        // a run north-south
  })
}

// The lid with the Sampo under it: the lid of many colours, awake.
tile('in_sampo_lid_bright', [
  '................',
  '................',
  '.......aa.......',
  '......aYya......',
  '....aaaaaaaa....',
  '...aRRYYGGBBa...',
  '..aRRRYYGGBBBa..',
  '..aRyRYyGyByBa..',
  '.aRRRRYYYGGGBBa.',
  '.aCCCCCCCCCCCCa.',
  '.acccccccccccca.',
  '..aaaaaaaaaaaa..',
  '.....fggghf.....',
  '.....fggghf.....',
  '....figggghf....',
  '....ffffffff....',
], { a: '#262c34', R: '#d9534f', Y: '#f0c85a', y: '#c9962e', G: '#5fb878', B: '#4f8fd0', C: '#e39a5a', c: '#b0672f', f: '#232327', g: '#4c4c54', h: '#38383e', i: '#62626a' })

// The fountain with the Sampo in it: the running basin, the bright lid in its water.
tile('ow_fountain_basin_sampo', [
  'aabbcccffcccbbaa',
  'aacccaaaaaaaccaa',
  'aabbaRRYGGBBabaa',
  'aabbaRyYGyBBabaa',
  'aaccaCCCCCCCacaa',
  'aabbdaaaaaaadbaa',
  'aabbddfddfddbbaa',
  'aabcbbcbbcbbcbaa',
  'aacbbbcbbcbbbcaa',
  'aacgccccccccgcaa',
  'aaagccccccccgaaa',
  '.aaaaaaaaaaaaaa.',
  '..aaaaaaaaaaaa..',
  '................',
  '................',
  '................',
], { a: '#262b44', b: '#c0cbdc', c: '#8b9bb4', d: '#43e1b3', f: '#69ffd4', g: '#52607c', R: '#d9534f', Y: '#f0c85a', y: '#c9962e', G: '#5fb878', B: '#4f8fd0', C: '#e39a5a' })

// The copper mountain's braziers: a copper bowl on iron legs, cold and lit.
const BRAZIER = { k: INK, c: '#c9773a', l: '#e8a868', d: '#3a3038', i: '#6a6f7b', r: '#d9482b', f: '#f08a2c', y: '#ffd75e' }
const LEGS = [
  '....kkkkkkkk....',
  '....ki....ik....',
  '...ki......ik...',
  '...ki......ik...',
  '..kik......kik..',
  '..kkk......kkk..',
]
tile('prop_brazier_cold', [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..kkkkkkkkkkkk..',
  '.kllllllllllllk.',
  '.kcddddddddddck.',
  '..kcccccccccck..',
  '...kcccccccck...',
  ...LEGS,
], BRAZIER)
tile('prop_brazier_lit', [
  '................',
  '.......r........',
  '......rfr...r...',
  '.....rffyr.rfr..',
  '....rfyyyfrfyr..',
  '..kkrfyyyyyyfrk.',
  '.kllfyyyyyyfllk.',
  '.kcffffffffffck.',
  '..kcccccccccck..',
  '...kcccccccck...',
  ...LEGS,
], BRAZIER)
