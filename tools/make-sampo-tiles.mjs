// Builds the Sampo story's small art into renderer/assets/tiles/: the three
// lost pieces of the mill (the sea's wheel, the mountain's grindstone, the
// marsh's hopper), the great pike's jawbone, the jawbone kantele, and the
// Sampo made whole. Pixel maps, as make-lalli-tiles.mjs.
//
//   node tools/make-sampo-tiles.mjs
import { writePng } from './png-write.mjs'

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
