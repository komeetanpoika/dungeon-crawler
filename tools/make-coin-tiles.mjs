// Builds the art of coin and what it buys into renderer/assets/tiles/: the
// coin itself (the purse in the HUD, a price in a trade menu, a purse dropped
// on the ground), a rye loaf and a turnip. Pixel maps, as make-lalli-tiles.mjs
// and make-sampo-tiles.mjs draw theirs.
//
//   node tools/make-coin-tiles.mjs
import { writePng } from './png-write.mjs'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const INK = '#3f2631'
function tile(name, rows, palette) {
  const rgba = new Uint8Array(16 * 16 * 4)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    if (!palette[ch]) throw new Error(`${name}: no colour for "${ch}"`)
    rgba.set([...hex(palette[ch]), 255], (y * 16 + x) * 4)
  }))
  const out = new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
  writePng(out, 16, 16, rgba)
  console.log(`wrote ${out}`)
}

// a gold coin, lit from the upper left, a C struck in it
tile('item_coin', [
  '................',
  '................',
  '.....kkkkkk.....',
  '....kyyyyyyk....',
  '...kywwyyyydk...',
  '..kywyyyyyyydk..',
  '..kyyyyddyyydk..',
  '..kyyydyyyyydk..',
  '..kyyydyyyyydk..',
  '..kyyyyddyyydk..',
  '..kyyyyyyyyddk..',
  '...kyyyyyyddk...',
  '....kddddddk....',
  '.....kkkkkk.....',
  '................',
  '................',
], { k: INK, y: '#f2c14e', w: '#fff3c4', d: '#b9802a' })

// a rye loaf, slashed three times
tile('item_bread', [
  '................',
  '................',
  '................',
  '................',
  '....kkkkkkkk....',
  '..kkbbbbbbbbkk..',
  '.kbblbbblbbblbk.',
  '.kblbbblbbblbbk.',
  '.kbbbbbbbbbbbbk.',
  '.kddbbbbbbbbddk.',
  '..kkddddddddkk..',
  '....kkkkkkkk....',
  '................',
  '................',
  '................',
  '................',
], { k: INK, b: '#8a5a2b', l: '#c8904e', d: '#5e3a1c' })

// a turnip: purple shoulders, pale root, two leaves
tile('item_turnip', [
  '................',
  '......g..g......',
  '.....kgkkgk.....',
  '.....kggggk.....',
  '......kggk......',
  '....kkkppkkk....',
  '...kppppppppk...',
  '..kppppppppppk..',
  '..kpwwppppppvk..',
  '..kwwwwwwwwwvk..',
  '..kwwwwwwwwwsk..',
  '...kwwwwwwwsk...',
  '....kwwwwwsk....',
  '.....kkwwkk.....',
  '.......kk.......',
  '................',
], { k: INK, g: '#5aa04a', p: '#b0527a', v: '#7d3558', w: '#f1ead8', s: '#c9bfa6' })
