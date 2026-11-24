// Draws the road's own ground into renderer/assets/tiles/: ow_road_<ground>_<n>,
// four tiles for each of the four grounds a road crosses in the Wilds
// (renderer/wilds/terrain.js roadGround picks them):
//   grass  packed earth, paler and less orange than a trail's ow_dirt_*, grey
//          stones pressed into it and a wheel rut here and there
//   sand   the same, darker than the sand round it, with drifts of sand
//   mtn    a pale gravel track that shows on the dark mountain floor
//   marsh  a grey gravel causeway that shows on the orange mud and the grass
// The four tiles share one set of pixel maps, each ground with its palette;
// every map keeps its stones and ruts off the outer pixel and has the plain
// ground colour along all four edges, so any of them tiles with any other
// in both directions without a seam.
//
//   node tools/make-wilds-road-tiles.mjs
import { writePng } from './png-write.mjs'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function tile(name, rows, palette) {
  if (rows.length !== 16 || rows.some(r => r.length !== 16)) throw new Error(`${name}: not 16x16`)
  if (/[^.]/.test(rows[0] + rows[15] + rows.map(r => r[0] + r[15]).join(''))) throw new Error(`${name}: something on the edge`)
  const rgba = new Uint8Array(16 * 16 * 4)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!palette[ch]) throw new Error(`${name}: no colour for "${ch}"`)
    rgba.set([...hex(palette[ch]), 255], (y * 16 + x) * 4)
  }))
  const out = new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
  writePng(out, 16, 16, rgba)
  console.log(`wrote ${out}`)
}

// . ground   , a paler fleck   : a darker grain
// r a rut's shadow   u its worn lip
// h s k a stone: light, body, shade
// g G the ground's own touch (a tuft, a drift, grit, a damp patch)
const MAPS = [
  [
    '................',
    '...........:....',
    '................',
    '................',
    '.........rrrr...',
    '..hs.....uuuu...',
    '.hssk...........',
    '..kk............',
    '................',
    '.,..............',
    '.......g........',
    '......gG....hs..',
    '............sk..',
    '................',
    '..........,.....',
    '................',
  ],
  [
    '................',
    '................',
    '...hs...........',
    '...sk......r....',
    '...........ru...',
    '...........ru...',
    '...........ru...',
    '................',
    '................',
    '..:.............',
    '.......hs.......',
    '......hssk......',
    '.......kk.......',
    '.g..............',
    '.Gg........,....',
    '................',
  ],
  [
    '................',
    '........,.......',
    '.....s..........',
    '................',
    '.........hs.....',
    '.........sk.....',
    '................',
    '.............s..',
    '.hs.............',
    '.sk......:......',
    '............gg..',
    '............Gg..',
    '................',
    '.........hs.....',
    '.........sk.....',
    '................',
  ],
  [
    '................',
    '................',
    '..:.............',
    '................',
    '................',
    '................',
    '............,...',
    '................',
    '................',
    '................',
    '........hs......',
    '........sk...g..',
    '.............G..',
    '................',
    '................',
    '................',
  ],
]

const STONE = { h: '#e4e9f0', s: '#c0cbdc', k: '#8b9bb4' }   // Tiny Town's stone greys
const PALETTES = {
  grass: { '.': '#e1c598', ',': '#efdcb5', ':': '#c9a877', r: '#bd9866', u: '#f0e2c2', ...STONE, g: '#84c669', G: '#65a556' },
  sand: { '.': '#cdb184', ',': '#dcc59c', ':': '#b49568', r: '#a88a5e', u: '#dfcca8', ...STONE, g: '#e6dabf', G: '#d9caa9' },
  mtn: { '.': '#ab9f8c', ',': '#c2b7a3', ':': '#8c806e', r: '#857968', u: '#c8bda9', h: '#dfe4ec', s: '#b5bfcf', k: '#6f7d96', g: '#968a77', G: '#7f7363' },
  marsh: { '.': '#d3cbb2', ',': '#e2dcc8', ':': '#b6ad91', r: '#ada386', u: '#e6e0cd', ...STONE, g: '#65a556', G: '#b9ae8f' },
}

for (const [ground, palette] of Object.entries(PALETTES)) MAPS.forEach((rows, i) => tile(`ow_road_${ground}_${i}`, rows, palette))
