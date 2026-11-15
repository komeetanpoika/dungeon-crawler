// Builds the Lalli tale's small art into renderer/assets/tiles/: Lalli with
// the bishop's mitre stuck on his head (on the ground, and waist-deep in the
// top of his pine), the piper, Kerttu, the flute, the pint, the sausage and
// Lalli's axe. The people are Tiny Dungeon's (CC0, Kenney) tiles 0086, 0111,
// 0099 and 0119 transcribed as pixel maps and repainted, as
// make-firewand-tile.mjs does: the source tiles are 4-bit indexed PNGs our
// reader does not parse.
//
//   node tools/make-lalli-tiles.mjs
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

// ---- Lalli: the bald villager (0086), the mitre pulled down to his brows ----
const MITRE = [
  '.......aa.......',
  '......awwa......',
  '.....awrrwa.....',
  '....awrrrrwa....',
  '....awwrrwwa....',
  '..aaayyyyyyaaa..',
]
const LALLI_BODY = [
  '..aadccccccdaa..',
  '..aacceeceecaa..',
  '..aafccdfdcfaa..',
  '..aaafffcffaaa..',
  '.aaagdfffffgaaa.',
  'aaaggdggggdggaaa',
  'aacchfddddfhccaa',
  'aaccaddddddaccaa',
  'aaaaaffffffaaaaa',
  '.aaaaddddddaaaa.',
]
const LALLI = { a: INK, b: '#e19a65', c: '#f7c282', d: '#bd6c4a', e: '#262b44', f: '#763b36', g: '#c0cbdc', h: '#8b9bb4',
  w: '#f4f1e8', r: '#c8323c', y: '#f2c14e' }
tile('npc_lalli', [...MITRE, ...LALLI_BODY], LALLI)
// up the tree: his arms round the top, the boughs (p, q: the pine's greens) closing over the rest
tile('npc_lalli_tree', [...MITRE, ...LALLI_BODY.slice(0, 5),
  'acca.dggggd.acca',
  'acca.pqppqp.acca',
  '.aa..........aa.',
  '................',
  '................',
], { ...LALLI, p: '#84c669', q: '#479f4a' })

// ---- the piper: the pointed-hat figure (0111) in green, a red feather in the hat ----
tile('npc_piper', [
  '...aaaaaa..r....',
  '..aaaaaaaaar....',
  '.aaabbbbaaaa....',
  '.aabacbbbbaaaa..',
  '.aaaabbbbbbaaaa.',
  '.aabddddddddbaa.',
  '.aadbhhhhhhbdaa.',
  '.aabbhhhhhhbbaa.',
  '.aabbhehhhebbaa.',
  '.aacbhhfffhbca..',
  'aaaabagaaagbaaa.',
  'aahhbbfffffbhhaa',
  'aahhbbfffffbhhaa',
  'aabbabfffffabbaa',
  'aabbabbffibabbaa',
  '.aaabbfffbbaaaa.',
], { a: INK, b: '#3f8f4f', c: '#2a6b3c', d: '#7fc46a', e: '#262b44', f: '#e8dcc0', g: '#b9ab8a', h: '#f7c282', i: '#cfc3a4', r: '#c8323c' })

// ---- Kerttu: the village woman (0099) in an ochre dress with a white apron ----
tile('npc_kerttu', [
  '................',
  '....aaaaaaaa....',
  '...aaaaaaaaaa...',
  '..aaabcdddbaaa..',
  '..aadcdcddddaa..',
  '.aaaddcdddddaaa.',
  '.aabdddddccdbaa.',
  '.aadddecccecdaa.',
  '.aaddcecccecfaa.',
  '.aaddcccgcccdaa.',
  '.aadddcccccbdaa.',
  'aaacddggggbhcaaa',
  'aacccdhwwwhcccaa',
  'aaccadwwwwwaccaa',
  'aaaaahwwwwhaaaaa',
  '.aaahhhwwhhaaaa.',
], { a: INK, b: '#763b36', c: '#f7c282', d: '#b9b0a0', e: '#262b44', f: '#eaa56c', g: '#e19a65', h: '#c98a2b', w: '#f4f1e8' })

// ---- things ----
const K = '#1c1917'   // the item icons' outline (tools/npc-placeholders.mjs)
tile('weapon_flute', [
  '................',
  '............aa..',
  '...........awya.',
  '..........awwa..',
  '.........awda...',
  '........awwa....',
  '.......awda.....',
  '......awwa......',
  '.....awda.......',
  '....awwa........',
  '...ayda.........',
  '..ayya..........',
  '..aaa...........',
  '................',
  '................',
  '................',
], { a: INK, w: '#eaa56c', d: '#763b36', y: '#f2c14e' })
tile('item_beer', [
  '................',
  '................',
  '...kwwwwwwk.....',
  '..kwwwwwwwwk....',
  '..kkkkkkkkkkkk..',
  '..kyyyoyyykggk..',
  '..kyyyoyyyk.kgk.',
  '..kyyyoyyyk.kgk.',
  '..kyyyoyyyk.kgk.',
  '..kyyyoyyykggk..',
  '..kyyyoyyykkk...',
  '..kyyyoyyyk.....',
  '..kkkkkkkkk.....',
  '................',
  '................',
  '................',
], { k: K, w: '#f5f0e1', y: '#e0a030', o: '#b87a1c', g: '#b9c2cf' })
tile('item_sausage', [
  '................',
  '................',
  '................',
  '..........kk....',
  '.........ktk....',
  '......kkkkk.....',
  '....kkbbbbbk....',
  '...kbbcbbbbbk...',
  '..kbbcbbbbbbk...',
  '..kbbbbbbbbk....',
  '..kbbbbbbkk.....',
  '.ktkkkkkk.......',
  '.kk.............',
  '................',
  '................',
  '................',
], { k: K, b: '#9a3b2e', c: '#d27a5c', t: '#decdaa' })
// Lalli's axe: the hatchet (0119) with a broad pale head and a red binding
tile('weapon_lalli_axe', [
  '..aaaaaaaa......',
  '.aaaaaaaaaa.....',
  'aaabbbaccaa.....',
  'aabddbaccaa.....',
  'abddddeffaa.....',
  'abddddercaa.....',
  'abddddercaa.....',
  'abddddeffaa.....',
  'aabddbaccaa.....',
  'aaabbbaccaa.....',
  '.aaaaaaccaa.....',
  '...aaaaccaa.....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaaaaa.....',
  '......aaaa......',
], { a: INK, b: '#e6edf5', c: '#bd6c4a', d: '#aab7cc', e: '#52607c', f: '#eaa56c', r: '#c8323c' })
