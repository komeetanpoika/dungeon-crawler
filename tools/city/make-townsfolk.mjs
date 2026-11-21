// Kalevanlinna's people and town animals, drawn into renderer/assets/tiles/
// as tf_*.png, and the list of them written to renderer/data/townsfolk-looks.js.
//
//   node tools/city/make-townsfolk.mjs                  draw the tiles and the list
//   node tools/city/make-townsfolk.mjs --sheet f.png    and a contact sheet (x4)
//   node tools/city/make-townsfolk.mjs --out <dir>      write everything into <dir> instead
//
// The townsfolk are put together from layers in the look of Kenney's Tiny
// Dungeon people (CC0): a big head on a small body, everything inside a thick
// dark outline (#3f2631), three shades a colour. A look is a body by age (an
// adult, a child 12 px tall, an elder stooped into the shoulders, some on a
// cane), a skin tone, clothes (tunic, smock, dress, blouse and skirt, coat;
// an apron over any), hair or headwear (short, tousled, long, braids, bun,
// bald; kerchief, headscarf, cap, hat, hood), a beard for some, and a thing
// in the hands (basket, rye bread, fish, bucket). Every look has a second
// frame, a step (the body bobs a pixel onto one foot, the other lifted), which
// the game draws under drawWalker's tilt.
//
// Combinations come from a fixed seed, so running this again draws the same
// files. The named characters and the watch are put together from the same
// parts plus their own pieces. The horse is Tiny Creatures' (CC0, Clint
// Bellanger) tile 51 cut from the RGBA sheet; dogs, cats and the flock birds
// are drawn here in that pack's manner (side on, facing east, as the game
// flips a sprite to face west).
//
// Layers are maps of role letters, coloured per look; the outline is worked
// out from what was drawn: every empty pixel within sqrt(5) px of a body
// pixel (sqrt(2) of a held thing) is ink.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writePng } from '../png-write.mjs'
import { readPng } from '../png-read.mjs'
import { mulberry32 } from '../../renderer/terrain/lib.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const opt = k => args.includes(k) ? args[args.indexOf(k) + 1] : null
const OUT = opt('--out')
const TILES = OUT ?? `${ROOT}/renderer/assets/tiles`
const DATA = OUT ? `${OUT}/townsfolk-looks.js` : `${ROOT}/renderer/data/townsfolk-looks.js`
const SEED = 0x6b616c65    // 'kale'

const INK = '#3f2631'
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]

// ==== the figure: a 16x16 grid of role letters =================================
// Roles held things are drawn in get a thin outline; every other role a thick one.
const HELD = new Set('wxyijbnfghopqruvz')
class Fig {
  constructor(g) { this.g = g ?? Array.from({ length: 16 }, () => Array(16).fill(null)) }
  clone() { return new Fig(this.g.map(r => [...r])) }
  get(x, y) { return x >= 0 && y >= 0 && x < 16 && y < 16 ? this.g[y][x] : null }
  put(x, y, r) { if (x >= 0 && y >= 0 && x < 16 && y < 16) this.g[y][x] = r; return this }
  // rows of 16 letters from row y0 (moved by dx, dy): '.' leaves a pixel, '-' clears it
  map(rows, y0 = 0, dx = 0, dy = 0) {
    rows.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '.' || ch === ' ') return
      this.put(i + dx, y0 + j + dy, ch === '-' ? null : ch)
    }))
    return this
  }
  // move what lies in a box by (dx, dy); what it leaves is cleared
  move(x0, y0, x1, y1, dx, dy) {
    const take = []
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { take.push([x, y, this.get(x, y)]); this.put(x, y, null) }
    for (const [x, y, r] of take) if (r) this.put(x + dx, y + dy, r)
    return this
  }
  // Pixels to RGBA: roles through `pal`, '#' is ink, then the outline.
  render(pal, { thick = 5, thin = 2 } = {}) {
    const d = new Uint8Array(16 * 16 * 4)
    const set = (x, y, h) => d.set(hex(h), (y * 16 + x) * 4)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = this.g[y][x]
      if (!r) {
        let ink = false
        for (let j = -2; j <= 2 && !ink; j++) for (let i = -2; i <= 2 && !ink; i++) {
          const n = this.get(x + i, y + j)
          if (n && n !== '#') ink = i * i + j * j <= (HELD.has(n) ? thin : thick)
        }
        if (ink) set(x, y, INK)
        continue
      }
      if (r === '#') { set(x, y, INK); continue }
      if (!pal[r]) throw new Error(`no colour for role "${r}"`)
      set(x, y, pal[r])
    }
    return d
  }
}

// ==== colours =================================================================
const SKIN = [
  { k: '#fbdcb8', s: '#e8ae86' },     // pale
  { k: '#f7c282', s: '#e19a65' },     // Tiny Dungeon's own
  { k: '#dfa26c', s: '#b87a4c' },     // tanned
  { k: '#a96a42', s: '#7e4a30' },     // dark
]
const SKIN_ODDS = [4, 4, 2, 1]
// twelve muted cloths, light / mid / dark
const CLOTH = {
  linen: ['#e8e0cc', '#c4b89c', '#8f846c'],
  grey: ['#c0cbdc', '#8b9bb4', '#5a6988'],
  brown: ['#c98b5a', '#9e5e3b', '#6b3a2a'],
  umber: ['#957055', '#6e4f3a', '#4c3428'],
  ochre: ['#dcb85e', '#b28c3e', '#7d6128'],
  madder: ['#c45e4e', '#963f38', '#662a2c'],
  rust: ['#d4824e', '#a95c36', '#743c2a'],
  moss: ['#97a866', '#6d7f46', '#4b5a32'],
  pine: ['#5f9064', '#41704e', '#2b4c3a'],
  woad: ['#7395b8', '#526f96', '#38496c'],
  slate: ['#5e6a86', '#424c6c', '#2c3150'],
  heather: ['#a07898', '#7a5674', '#563a52'],
}
const HAIR = {
  flax: ['#f4dc96', '#dcb664', '#a8823e'],
  straw: ['#e2b86e', '#c08e4a', '#8c6032'],
  brown: ['#b0784c', '#86553a', '#5c382a'],
  dark: ['#7c5640', '#5a3c2e', '#4a2e28'],
  black: ['#57546a', '#3e3c50', '#302e40'],
  red: ['#dc7a44', '#b4552e', '#7e3826'],
  grey: ['#d4d8e0', '#a8b0c0', '#7c8498'],
  white: ['#f6f6f2', '#d8dce4', '#aab2c2'],
}
const SHOES = { brown: ['#9e5e3b', '#6b3a2a'], dark: ['#6e4f3a', '#4c3428'], grey: ['#8b9bb4', '#5a6988'] }
const APRON = { linen: ['#efe9da', '#c9bfa6'], leather: ['#a5683f', '#74472e'], blue: ['#9cb4cc', '#7390ae'] }
const HELD_PAL = {
  w: '#c98b5a', x: '#9e5e3b', y: '#6b3a2a',          // wood
  i: '#c0cbdc', j: '#6e7c96',                        // iron
  b: '#b8784a', n: '#84502e',                        // rye bread
  f: '#e4ead8', g: '#a8b494', h: '#5e7458',          // fish (a pike: olive back, pale belly)
  o: '#f2c14e', p: '#b88a2e',                        // brass
  r: '#d8483c', q: '#f4f1e8',                        // plume
  u: '#d8a868', v: '#a8743e',                        // wicker
  z: '#5f8fc0',                                      // water
}
const FIXED = { e: '#262b44', J: '#5c3a2a', W: '#f2efe6', X: '#c8c2b4', Y: '#f2c14e', Z: '#b88a2e', M: '#f4f1e8', N: '#c8ccd8', O: '#302e40' }

// one look's colours from its picks
function palette(p) {
  const [A, B, C] = CLOTH[p.cloth], [D, E, F] = CLOTH[p.under]
  const [h1, h2, h3] = HAIR[p.hair], [T, U, V] = CLOTH[p.hat ?? p.cloth]
  const [G, H] = SHOES[p.shoes], [P, Q] = APRON[p.apronCloth ?? 'linen']
  return { ...FIXED, ...HELD_PAL, ...SKIN[p.skin], A, B, C, D, E, F, 1: h1, 2: h2, 3: h3, T, U, V, G, H, P, Q, ...(p.extra ?? {}) }
}

// ==== bodies ====================================================================
// Rulers: 0123456789abcdef. The adult's head is rows 3-9, the elder's 4-10 (the
// neck sunk into the shoulders), the child's 6-11.
const HEAD = {
  adult: [3, [
    '.....kkkkkk.....',
    '....kkkkkkkk....',
    '....kkkkkkkk....',
    '....kkkkkkkk....',
    '....kkekkkek....',
    '....skessses....',
    '.....sskkks.....',
  ]],
  child: [6, [
    '......kkkk......',
    '.....kkkkkk.....',
    '.....kkkkkk.....',
    '.....kekkek.....',
    '.....sesses.....',
    '......skks......',
  ]],
}
HEAD.elder = [4, HEAD.adult[1]]

// A: cloth (light, mid, dark B C), D E F: under-cloth (trousers, blouse,
// skirt), G H: shoes, k s: hands, J: belt.
const WEAR = {
  adult: {
    tunic: [10, [
      '...AA......AA...',
      '...AABAAAABAA...',
      '..kkBBAAAABBkk..',
      '..ss.EEEEEE.ss..',
      '.....FF..FF.....',
      '.....GG..GG.....',
    ]],
    smock: [10, [
      '...AA......AA...',
      '...AABAAAABAA...',
      '..kkJJJJJJJJkk..',
      '..ss.BAAAAB.ss..',
      '.....FF..FF.....',
      '.....GG..GG.....',
    ]],
    dress: [10, [
      '...AA......AA...',
      '...AABAAAABAA...',
      '..kkBBAAAABBkk..',
      '..ss.BAAAAB.ss..',
      '....BBAAAABB....',
      '.....GG..GG.....',
    ]],
    blouse: [10, [
      '...WW......WW...',
      '...WXDDDDDDXW...',
      '..kkXDDDDDDXkk..',
      '..ss.BAAAAB.ss..',
      '....BBAAAABB....',
      '.....GG..GG.....',
    ]],
    coat: [10, [
      '...AAB....BAA...',
      '...AABAACABAA...',
      '..kkBBAACABBkk..',
      '..ss.BAACAB.ss..',
      '....BBAAFABB....',
      '.....HH..HH.....',
    ]],
  },
  child: {
    tunic: [12, [
      '.....AAAAAA.....',
      '....kBAAAABk....',
      '.....FF..FF.....',
      '.....GG..GG.....',
    ]],
    dress: [12, [
      '.....AAAAAA.....',
      '....kBAAAABk....',
      '....BAAAAAAB....',
      '.....GG..GG.....',
    ]],
  },
}

// The elder wears the adult's clothes with the head a row lower: the
// shoulders hunch up beside the chin.
WEAR.elder = WEAR.adult

// aprons over the clothes (P light, Q shade)
const APRONS = {
  adult: {
    bib: [11, ['......PPPP......', '......PPPQ......', '.....PPPPPQ.....', '.....PPPPQQ.....']],
    waist: [13, ['.....PPPPPQ.....', '.....PPPPQQ.....']],
  },
  child: {},
}

// ==== hair, headwear, beards (adult rows; the elder's are one row lower) ========
const HAIRDO = {
  adult: {
    short: [3, [
      '.....322223.....',
      '....32112223....',
      '....22k222k2....',
      '....2...........',
    ]],
    tousled: [2, [
      '......2..2......',
      '.....322223.....',
      '....31212123....',
      '....2k2k22k2....',
      '....2......2....',
    ]],
    long: [3, [
      '.....322223.....',
      '....32112223....',
      '...322k222k23...',
      '...32......23...',
      '...32......23...',
      '...32......23...',
      '...32......23...',
      '...33......33...',
      '...3........3...',
    ]],
    braids: [3, [
      '.....321123.....',
      '....32211223....',
      '...322k222k23...',
      '...32......23...',
      '...2........2...',
      '...3........3...',
      '...2........2...',
      '...3........3...',
      '...T........T...',
    ]],
    bun: [2, [
      '......2112......',
      '.....322223.....',
      '....32112223....',
      '....22k222k2....',
      '....2......2....',
    ]],
    bald: [3, [
      '.....skkkks.....',
      '....skkkkkks....',
      '....2......2....',
      '....2......2....',
    ]],
  },
  child: {
    short: [6, ['......3223......', '.....321123.....', '.....2k22k2.....']],
    tousled: [5, ['......2..2......', '......3223......', '.....312123.....', '.....2k2k22.....']],
    long: [6, ['......3223......', '.....321123.....', '....32k22k23....', '....3......3....', '....3......3....', '....3......3....']],
    braids: [6, ['......3113......', '.....321123.....', '....32k22k23....', '....2......2....', '....3......3....', '....T......T....']],
  },
}
HAIRDO.elder = HAIRDO.adult
APRONS.elder = APRONS.adult

const HATS = {
  adult: {
    kerchief: [2, [               // tied at the nape: the hair shows at the sides
      '......UUUU......',
      '.....TTTTTU.....',
      '....TTTTTTUV....',
      '....UV2222VU....',
    ]],
    scarf: [2, [                  // a headscarf knotted under the chin
      '......UUUU......',
      '.....TTTTTU.....',
      '....TTTTTTTU....',
      '...UTT2222TUV...',
      '...UT......UV...',
      '...UT......UV...',
      '...VU......VV...',
      '....VU....VV....',
      '.......UV.......',
    ]],
    cap: [2, [
      '......TTTT......',
      '.....TTTTTU.....',
      '....VVVVVVVV....',
    ]],
    hat: [1, [
      '......TTTT......',
      '.....TTTTUU.....',
      '.....VVVVVV.....',
      '..TTTTTTTTTTUU..',
    ]],
    hood: [2, [
      '......UUUU......',
      '.....TTTTTU.....',
      '....TTTTTTTU....',
      '...TTT2222TUU...',
      '...TU......UV...',
      '...TU......UV...',
      '...TU......UV...',
      '...TUU....UUV...',
      '...TUUUUUUUUV...',
    ]],
  },
  child: {
    cap: [5, ['......TTTT......', '.....TTTTTU.....', '.....VVVVVV.....']],
    kerchief: [5, ['......UUUU......', '.....TTTTTU.....', '.....TTTTUV.....', '.....V2222V.....']],
  },
}
HATS.elder = HATS.adult

const BEARDS = {
  adult: {
    moustache: [8, ['.......333......', '......3..3......']],
    beard: [7, [
      '....2......2....',
      '....2..333.2....',
      '....22222222....',
      '.....322223.....',
      '......3223......',
    ]],
    long: [7, [
      '....2......2....',
      '....2..333.2....',
      '....22222222....',
      '.....212223.....',
      '.....221223.....',
      '......2122......',
      '......2223......',
      '.......23.......',
    ]],
  },
}
BEARDS.elder = BEARDS.adult

// ==== things carried =============================================================
// Held in front in both hands (hands at x 2-3 and 12-13, rows 12-13) where a
// thing is big, at the right hand where it hangs. Rows are an adult's; a
// child's are moved one down and in. '#' draws ink where a thing lies over
// the clothes and so gets no outline of its own.
const CARRY = {
  basket: [10, [
    '......xxxx......',
    '.....x....x.....',
    '..kkvuuuuuuvkk..',
    '..ssvuvuvuvvss..',
    '.....vvvvvv.....',
  ]],
  bread: [11, [               // a rye ring loaf
    '....#nbbbbn#....',
    '..kk#bn##nb#kk..',
    '..ss#nnnnnn#ss..',
  ]],
  fish: [11, [                // a pike held across, its head to the right
    '...h#hhhhhh#....',
    '..kkhgffffefkk..',
    '..ssh#gggggg#s..',
  ]],
  bucket: [13, [
    '............ssj.',
    '...........#yzy.',
    '...........#xwx.',
  ]],
  cane: [10, [
    '.............xx.',
    '..............x.',
    '............kkx.',
    '............ssx.',
    '..............x.',
    '..............y.',
  ]],
}

// ==== putting a person together =================================================
const headDy = age => (age === 'elder' ? 1 : 0)
function person(p) {
  const f = new Fig()
  const [hy, head] = HEAD[p.age]
  const [wy, wear] = WEAR[p.age][p.wear]
  f.map(wear, wy)
  if (p.apron) { const [ay, a] = APRONS[p.age][p.apron]; f.map(a, ay) }
  f.map(head, hy)
  const dy = headDy(p.age)
  if (p.hairdo) { const [y, m] = HAIRDO[p.age][p.hairdo]; f.map(m, y, 0, dy) }
  if (p.beard) { const [y, m] = BEARDS[p.age][p.beard]; f.map(m, y, 0, dy) }
  if (p.hatType) { const [y, m] = HATS[p.age][p.hatType]; f.map(m, y, 0, dy) }
  if (p.carry) { const [y, m] = CARRY[p.carry]; f.map(m, y, p.age === 'child' ? -1 : 0, p.age === 'child' ? 1 : 0) }
  for (const extra of p.parts ?? []) f.map(extra[1], extra[0])
  return f
}
// The step: the body bobs a pixel down onto the right foot; the left one is
// lifted out of sight (under a skirt the right shoe still peeks out).
const SHOE = new Set('GH')
function stepOf(f) {
  const s = f.clone().move(0, 0, 15, 14, 0, 1)
  for (let x = 0; x < 16; x++) {
    const was = f.get(x, 15)
    if (x >= 8 && SHOE.has(was)) s.put(x, 15, was)
    else if (x < 8 && 'FEGH'.includes(s.get(x, 15) ?? '-')) s.put(x, 15, null)
  }
  return s
}

// ==== the seeded crowd ==========================================================
const rng = mulberry32(SEED)
const pick = list => list[Math.floor(rng() * list.length)]
const weighted = odds => { let t = rng() * odds.reduce((a, b) => a + b, 0); for (let i = 0; i < odds.length; i++) if ((t -= odds[i]) < 0) return i; return odds.length - 1 }
// a deck: every option once in a shuffled order, then again, so a crowd uses them all
function deck(options) {
  let pile = []
  return () => {
    if (!pile.length) { pile = [...options]; for (let i = pile.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]] } }
    return pile.pop()
  }
}
const CLOTHS = Object.keys(CLOTH)
const UNDER = ['brown', 'umber', 'grey', 'slate', 'linen', 'moss']
const YOUNG_HAIR = ['flax', 'flax', 'straw', 'brown', 'dark', 'black', 'red']
const OLD_HAIR = ['grey', 'white', 'grey']

const decks = {
  cloth: deck(CLOTHS), under: deck(UNDER), hatCloth: deck(['linen', 'grey', 'madder', 'moss', 'pine', 'woad', 'slate', 'heather', 'ochre']),
  hairF: deck(['long', 'braids', 'bun', 'long', 'short']), hairM: deck(['short', 'tousled', 'bald', 'short', 'long']),
  hatF: deck([null, 'kerchief', 'scarf', null, 'hood', 'kerchief']), hatM: deck([null, 'cap', 'hat', null, 'hood', null, 'cap']),
  beard: deck([null, 'moustache', 'beard', null, 'beard']),
  wearF: deck(['dress', 'blouse', 'dress', 'smock']), wearM: deck(['tunic', 'smock', 'coat', 'tunic']),
  carry: deck([null, null, 'basket', 'bread', 'fish', 'bucket', null]),
  apron: deck([null, null, 'bib', 'waist', null]),
}
function adult(sex) {
  const p = { age: 'adult', sex, skin: weighted(SKIN_ODDS), cloth: decks.cloth(), under: decks.under(), shoes: pick(Object.keys(SHOES)), hair: pick(YOUNG_HAIR) }
  p.wear = sex === 'f' ? decks.wearF() : decks.wearM()
  p.hairdo = sex === 'f' ? decks.hairF() : decks.hairM()
  p.hatType = sex === 'f' ? decks.hatF() : decks.hatM()
  if (p.hatType) p.hat = decks.hatCloth()
  if (sex === 'm') p.beard = decks.beard()
  p.apron = decks.apron()
  if (p.apron) p.apronCloth = pick(['linen', 'linen', 'leather', 'blue'])
  p.carry = decks.carry()
  return p
}
function child(sex) {
  const p = { age: 'child', sex, skin: weighted(SKIN_ODDS), cloth: decks.cloth(), under: decks.under(), shoes: pick(Object.keys(SHOES)), hair: pick(YOUNG_HAIR) }
  p.wear = sex === 'f' ? 'dress' : 'tunic'
  p.hairdo = sex === 'f' ? pick(['long', 'braids']) : pick(['short', 'tousled'])
  p.hatType = rng() < 0.3 ? (sex === 'f' ? 'kerchief' : 'cap') : null
  if (p.hatType) p.hat = decks.hatCloth()
  return p
}
function elder(sex) {
  const p = { age: 'elder', sex, skin: weighted(SKIN_ODDS), cloth: decks.cloth(), under: decks.under(), shoes: pick(Object.keys(SHOES)), hair: pick(OLD_HAIR) }
  p.wear = sex === 'f' ? 'dress' : pick(['tunic', 'coat'])
  p.hairdo = sex === 'f' ? pick(['bun', 'long', 'short']) : pick(['bald', 'short', 'bald'])
  p.hatType = sex === 'f' ? pick(['scarf', 'kerchief', null, 'scarf']) : pick([null, 'cap', 'hood', null])
  if (p.hatType) p.hat = decks.hatCloth()
  if (sex === 'm') p.beard = pick(['beard', 'long', 'moustache', null])
  p.carry = rng() < 0.5 ? 'cane' : pick([null, null, 'basket'])
  if (rng() < 0.3) { p.apron = sex === 'f' ? 'bib' : 'waist'; p.apronCloth = 'linen' }
  return p
}

const pad = n => String(n).padStart(2, '0')
const LOOKS = []
const add = (prefix, n, make) => { for (let i = 1; i <= n; i++) LOOKS.push({ id: `${prefix}${pad(i)}`, ...make(i) }) }
add('a', 40, i => adult(i % 2 ? 'f' : 'm'))
add('c', 12, i => child(i % 2 ? 'f' : 'm'))
add('e', 12, i => elder(i % 2 ? 'f' : 'm'))

// ==== the named characters and the watch ======================================
const NAMED = {
  seppo: { age: 'adult', sex: 'm', skin: 2, wear: 'tunic', cloth: 'umber', under: 'slate', shoes: 'dark', hair: 'grey', hairdo: 'bald', beard: 'beard',
    apron: 'bib', apronCloth: 'leather', carry: 'hammer' },
  vaino: { age: 'elder', sex: 'm', skin: 0, wear: 'coat', cloth: 'woad', under: 'slate', shoes: 'dark', hair: 'white', hairdo: 'bald', beard: 'long' },
  pohjanen: { age: 'elder', sex: 'f', skin: 0, wear: 'dress', cloth: 'umber', under: 'slate', shoes: 'dark', hair: 'grey', hairdo: 'bun', hatType: 'scarf', hat: 'slate',
    parts: [[10, ['...VU......UV...', '...VUUUUUUUUV...', '..kkVUUUUUUVkk..']]] },
  vicar: { age: 'adult', sex: 'm', skin: 0, wear: 'coat', cloth: 'slate', under: 'slate', shoes: 'dark', hair: 'dark', hairdo: 'short',
    extra: { A: '#3a3a4e', B: '#2e2e40', C: '#24243a' }, parts: [[10, ['.......WW.......', '.......XX.......']]] },
  crier: { age: 'adult', sex: 'm', skin: 1, wear: 'coat', cloth: 'madder', under: 'umber', shoes: 'brown', hair: 'red', hairdo: 'short', hatType: 'hat', hat: 'umber',
    beard: 'moustache', carry: 'bell', extra: { A: '#d0503e', B: '#a83a32', C: '#74282a' } },
  innkeeper: { age: 'adult', sex: 'm', skin: 1, wear: 'round', cloth: 'rust', under: 'brown', shoes: 'brown', hair: 'brown', hairdo: 'bald', beard: 'moustache',
    apron: 'round', apronCloth: 'linen' },
  captain: { age: 'adult', sex: 'm', skin: 0, wear: 'tabard', cloth: 'woad', under: 'slate', shoes: 'dark', hair: 'flax', hairdo: 'short', beard: 'moustache',
    hatType: 'plumed', carry: 'sword' },
  count: { age: 'adult', sex: 'm', skin: 0, wear: 'coat', cloth: 'heather', under: 'slate', shoes: 'dark', hair: 'dark', hairdo: 'short', beard: 'beard',
    extra: { A: '#8e3a5a', B: '#6c2a46', C: '#4a1e34' },
    hatType: 'furcap', hat: 'heather',
    parts: [[10, ['...MMOMMMMOMM...', '...NMMMOMMMMN...', '.....Y....Y.....', '......Y..Y......', '.......YZ.......']]] },
}
const WATCH = [
  { skin: 1, hair: 'brown', hairdo: 'short', beard: 'moustache', hatType: 'kettle' },
  { skin: 0, hair: 'flax', hairdo: 'short', hatType: 'nasal' },
  { skin: 2, hair: 'black', hairdo: 'short', beard: 'beard', hatType: 'kettle' },
  { skin: 3, hair: 'black', hairdo: 'short', hatType: 'nasal' },
].map(w => ({ age: 'adult', sex: 'm', wear: 'tabard', cloth: 'woad', under: 'slate', shoes: 'dark', carry: 'spear', ...w }))

// the extra parts only they wear
WEAR.adult.tabard = [10, [                   // the city's blue and yellow over mail
  '...ii......ii...',
  '...iAAAYYAAji...',
  '..kkiAAYYAAjkk..',
  '..ss.YYYYYY.ss..',
  '.....FF..FF.....',
  '.....GG..GG.....',
]]
WEAR.adult.round = [10, [                    // the innkeeper, well fed
  '...AA......AA...',
  '..AABAAAAAABAA..',
  '.kkBAAAAAAAABkk.',
  '.ss.BAAAAAAB.ss.',
  '.....FF..FF.....',
  '.....GG..GG.....',
]]
APRONS.adult.round = [11, ['.....PPPPP......', '....PPPPPPQ.....', '....PPPPPPQ.....', '.....PPPPQQ.....']]
HATS.adult.furcap = [1, ['.....TTTTTU.....', '....TTTTTTUU....', '...MMMOMMMMNN...']]
HATS.adult.kettle = [1, ['......iiii......', '.....iiiijj.....', '..iiiiiiiijjjj..']]
HATS.adult.nasal = [1, ['.......ii.......', '......iiij......', '.....iiiijj.....', '....jjjjjjjj....', '.......j........']]
HATS.adult.plumed = [0, ['.......rq.......', '......irqr......', '.....iiiijj.....', '....iiiiiijj....', '....jjjjjjjj....']]
CARRY.hammer = [5, ['............iij.', '............jjj.', '.............x..', '.............x..', '.............x..', '.............x..', '.............x..']]
CARRY.bell = [11, ['.............p..', '............kk..', '............soo.', '...........#ooop', '...........#.p..']]
CARRY.sword = [7, ['..............i.', '..............i.', '..............i.', '..............i.', '.............ooo', '............kkx.', '............ssx.', '..............o.']]
CARRY.spear = [0, [
  '..............i.', '.............iij', '..............j.',
  '..............x.', '..............x.', '..............x.', '..............x.', '..............x.', '..............x.',
  '..............x.', '..............x.', '..............x.', '............kkx.', '............ssx.', '..............x.', '..............y.',
]]

// ==== animals (side on, facing east, as Tiny Creatures) ===========================
// 1 2 3: coat light, mid, dark; W X: a white patch, its shade; e: eye; R: a
// cat's nose; '#': ink.
// `step` replaces the leg rows from its first row down ('-' clears).
const COAT = { W: '#f6ead2', X: '#d8c4a4', e: '#262b44', R: '#d88a8a' }
const SPITZ = [
  '................',
  '................',
  '................',
  '........1...1...',
  '........21.12...',
  '........11111...',
  '..11....111e1...',
  '.1..1...111111#.',
  '.22.1..11111WW..',
  '..21111111WW....',
  '..11111111WW....',
  '..22222222W2....',
  '...22222222.....',
  '...2.2..2.2.....',
  '...2.2..2.2.....',
  '...3.3..3.3.....',
]
const SPITZ_STEP = [13, ['...2.2..2.2.....', '..2...2.2..2....', '..3...3.3..3....']]
const DOGS = [
  { id: 'dog_1', breed: 'spitz', pal: { 1: '#e8a85a', 2: '#c87a3a', 3: '#8c4e2a' }, art: SPITZ, step: SPITZ_STEP },
  { id: 'dog_2', breed: 'hound', pal: { 1: '#d89a5c', 2: '#a8683a', 3: '#3e3a4c' }, art: [
    '................',
    '................',
    '................',
    '................',
    '........111.....',
    '.......21111....',
    '.......211eWW#..',
    'W......2111WW...',
    '.2....111WW.....',
    '..2333331WW.....',
    '..1333331WW.....',
    '..11111WWWW.....',
    '...1WWWWWW......',
    '...2.1..W.W.....',
    '...1.W..W.W.....',
    '...W.W..W.W.....',
  ], step: [13, ['...2.1..W.W.....', '..1...W.W..W....', '..W...W.W..W....']] },
  { id: 'dog_3', breed: 'terrier', pal: { 1: '#dcd2bc', 2: '#aca290', 3: '#6e6a7a', X: '#f2eee2' }, art: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.........3..3...',
    '..3......3113...',
    '..3......11e1#..',
    '..2333333311X...',
    '..23333331XXX...',
    '..22222221X.....',
    '...111111.......',
    '...1.1.1.1......',
    '...2.2.2.2......',
  ], step: [14, ['..1..1.1..1.....', '..2..2.2..2.....']] },
  { id: 'dog_4', breed: 'lapphund', pal: { 1: '#5c5870', 2: '#45425a', 3: '#302e40', e: '#e0b040' }, art: SPITZ, step: SPITZ_STEP },
]
const CAT = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...1............',
  '..1......1..1...',
  '..1......1111...',
  '..1......11e1R..',
  '..2111111111....',
  '...11111112.....',
  '...2222222......',
  '...2.2..2.2.....',
  '...3.3..3.3.....',
]
const CAT_STEP = [14, ['...2.2..2.2.....', '..3...3.3..3....']]
// tabby stripes over the back, a white bib and socks
const STRIPES = [[11, ['....3.3.3.......', '.....3.3........']]]
const BIB = [[10, ['............W...']], [11, ['..........WW....']], [12, ['.........WW.....']], [15, ['...W.W..W.W.....']]]
const CATS = [
  { id: 'cat_1', coat: 'grey tabby', pal: { 1: '#aeb6c6', 2: '#848ca2', 3: '#5a6076' }, over: STRIPES },
  { id: 'cat_2', coat: 'ginger', pal: { 1: '#eca462', 2: '#c4783c', 3: '#8e522c' }, over: STRIPES },
  { id: 'cat_3', coat: 'black and white', pal: { 1: '#56526a', 2: '#403c52', 3: '#2e2c3c', e: '#e0c040' }, over: BIB },
  { id: 'cat_4', coat: 'calico', pal: { 1: '#f4eee0', 2: '#d8ccb4', 3: '#e08e4a', 4: '#4e4a5c' }, over: [[9, ['.........33.....']], [11, ['....33..44......']], [12, ['.....4333.......']]] },
].map(c => ({ ...c, art: c.over.reduce((f, [y, rows]) => f.map(rows, y), new Fig().map(CAT, 0)).g.map(r => r.map(ch => ch ?? '.').join('')), step: CAT_STEP }))

// pigeons and gulls are flock sprites: _a on the ground (wings folded), _b wings up
const PIGEON = { 1: '#b4bece', 2: '#8892a8', 3: '#4e5670', g: '#6aa890', p: '#9a78aa', e: '#262b44', n: '#d88a8a', '#': '#3f2631' }
const GULL = { W: '#f6f6f2', X: '#d4d8e0', G: '#b8c0cc', H: '#8890a2', 3: '#302e40', Y: '#f2c14e', e: '#262b44', n: '#e8b860' }
const BIRDS = {
  pigeon_a: { pal: PIGEON, art: [
    '', '', '', '', '', '', '', '', '', '',
    '.........11.....',
    '........g1e#....',
    '...33222p1......',
    '....2323111.....',
    '.....11111......',
    '......n.n.......',
  ] },
  pigeon_b: { pal: PIGEON, art: [
    '', '', '', '', '', '', '', '',
    '...3.3..........',
    '...23.2.........',
    '....22...11.....',
    '....21..g1e#....',
    '...33222p1......',
    '....2111111.....',
    '.....11111......',
    '......n.n.......',
  ] },
  gull_a: { pal: GULL, art: [
    '', '', '', '', '', '', '', '',
    '..........WW....',
    '..........WeYY..',
    '.........WW.....',
    '..33GGGGWW......',
    '...3HGGGWWW.....',
    '....HHXWWW......',
    '.....XWWX.......',
    '......n.n.......',
  ] },
  gull_b: { pal: GULL, art: [
    '', '', '', '',
    '.33.............',
    '..3G............',
    '...GG...........',
    '....GG..........',
    '....HGG...WW....',
    '.....HG...WeYY..',
    '......G..WW.....',
    '..33GGGGWW......',
    '...3HGGGWWW.....',
    '....HXXWWW......',
    '.....XWWX.......',
    '......n.n.......',
  ] },
}

function animal(a) {
  const f = new Fig().map(a.art, 0)
  const s = f.clone()
  const [y0, rows] = a.step
  for (let y = y0; y < 16; y++) for (let x = 0; x < 16; x++) s.put(x, y, null)
  s.map(rows, y0)
  return [f, s]
}

// The horse: Tiny Creatures' tile 51, cut from the RGBA sheet (its per-tile
// PNGs have no alpha) and read into roles; its outline is drawn already.
function horse() {
  const sheet = readPng(`${ROOT}/assets/tiny-creatures/Tilemap/tilemap.png`)
  const ROLE = { '3f2631': '#', bd6c4a: '2', '763b36': '3', c0cbdc: 'W', '52607c': 'H' }
  const tile = 51, ox = ((tile - 1) % 10) * 17, oy = Math.floor((tile - 1) / 10) * 17
  const f = new Fig()
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = ((oy + y) * sheet.width + ox + x) * 4
    if (!sheet.pixels[i + 3]) continue
    const key = [0, 1, 2].map(k => sheet.pixels[i + k].toString(16).padStart(2, '0')).join('')
    if (!ROLE[key]) throw new Error(`horse: unexpected colour #${key}`)
    f.put(x, y, ROLE[key])
  }
  // the step: the near hind leg back a pixel, the near foreleg forward
  const s = f.clone().map(['-##22####22#HH##', '-##HH##-##HH####'], 14)
  return [f, s, { 2: '#bd6c4a', 3: '#763b36', W: '#c0cbdc', H: '#52607c' }]
}

// ==== write ===================================================================
const out = new Map()   // tile name -> RGBA
function emit(name, fig, pal, outline) { out.set(name, fig.render(pal, outline)) }
for (const l of LOOKS) { const f = person(l); emit(`tf_${l.id}`, f, palette(l)); emit(`tf_${l.id}_step`, stepOf(f), palette(l)) }
for (const [id, l] of Object.entries(NAMED)) { const f = person(l); emit(`tf_${id}`, f, palette(l)); emit(`tf_${id}_step`, stepOf(f), palette(l)) }
WATCH.forEach((w, i) => { const f = person(w); emit(`tf_w${pad(i + 1)}`, f, palette(w)); emit(`tf_w${pad(i + 1)}_step`, stepOf(f), palette(w)) })
for (const a of [...DOGS, ...CATS]) { const [f, s] = animal(a); const pal = { ...COAT, ...a.pal }; emit(`tf_${a.id}`, f, pal, { thick: 4 }); emit(`tf_${a.id}_step`, s, pal, { thick: 4 }) }
{ const [f, s, pal] = horse(); emit('tf_horse_1', f, pal, { thick: 0 }); emit('tf_horse_1_step', s, pal, { thick: 0 }) }
for (const [name, b] of Object.entries(BIRDS)) emit(`tf_${name}`, new Fig().map(b.art, 0), b.pal, { thick: 2 })

if (!fs.existsSync(TILES)) fs.mkdirSync(TILES, { recursive: true })
for (const [name, d] of out) writePng(`${TILES}/${name}.png`, 16, 16, d)
console.log(`wrote ${out.size} townsfolk tiles to ${TILES}`)

// ---- the list the game reads --------------------------------------------------
const lit = o => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${v === null ? 'null' : `'${v}'`}`).join(', ')} }`
const tag = (id, l) => ({ id, age: l.age, sex: l.sex, wear: l.wear, apron: l.apron ?? null, carry: l.carry ?? null })
fs.writeFileSync(DATA, `// Kalevanlinna's people and town animals: their looks. Written by
// tools/city/make-townsfolk.mjs, which draws the tiles; change that and run it
// again rather than editing this. Data only.
//
// A look \`id\` has two tiles: tf_<id> standing and tf_<id>_step, a step. An npc
// carrying \`look: id\` is drawn with them (systems/npc.js spriteKeyFor).
//   age     child | adult | elder
//   sex     f | m: which first names fit
//   wear    tunic | smock | dress | blouse | coat (and the named ones' own)
//   apron   bib | waist | null;  carry: basket | bread | fish | bucket | cane | null
// The tiles are loaded with the Wilds' (wilds/terrain.js WILDS_SKINS).

export const LOOKS = [
${LOOKS.map(l => `  ${lit(tag(l.id, l))},`).join('\n')}
]

export const NAMED_LOOKS = {
${Object.entries(NAMED).map(([id, l]) => `  ${id}: ${lit(tag(id, l))},`).join('\n')}
}

// the city watch, in the city's blue and yellow, with a spear
export const WATCH_LOOKS = [
${WATCH.map((w, i) => `  ${lit(tag(`w${pad(i + 1)}`, w))},`).join('\n')}
]

export const ANIMAL_LOOKS = {
  dog: [
${DOGS.map(d => `    ${lit({ id: d.id, breed: d.breed })},`).join('\n')}
  ],
  cat: [
${CATS.map(c => `    ${lit({ id: c.id, coat: c.coat })},`).join('\n')}
  ],
  horse: [
    { id: 'horse_1' },
  ],
}

// Flock birds are sprites, not npcs: _a on the ground with the wings folded,
// _b with the wings up (a flock in the air shows the two in turn).
export const FLOCK_SKINS = [${Object.keys(BIRDS).map(n => `'tf_${n}'`).join(', ')}]

const frames = l => [\`tf_\${l.id}\`, \`tf_\${l.id}_step\`]
export const TOWNSFOLK_SKINS = [
  ...[...LOOKS, ...Object.values(NAMED_LOOKS), ...WATCH_LOOKS, ...Object.values(ANIMAL_LOOKS).flat()].flatMap(frames),
  ...FLOCK_SKINS,
]
`)
console.log(`wrote ${DATA}`)
if (args.includes('--list')) for (const l of LOOKS) console.log(l.id, l.sex, l.wear, l.cloth, l.hairdo, l.hair, l.hatType ?? '', l.beard ?? '', l.apron ?? '', l.carry ?? '', `skin${l.skin}`)

// ==== the contact sheet =======================================================
// x4: Tiny Dungeon's player and villagers first (the look to match), then
// every look by age with its step beside it, the named, the watch, the
// animals and the flock birds; last a crowd of 24 on the city's cobbles,
// at x3, to see that a crowd is not one face.
const sheetAt = opt('--sheet')
if (sheetAt) {
  const S = 4, CELL = 16 * S, GAP = 4 * S
  const rows = []
  const ref = readPng(`${ROOT}/assets/kenney_tiny-dungeon/Tilemap/tilemap_packed.png`)
  const refTile = id => { const d = new Uint8Array(1024); const ox = (id % 12) * 16, oy = Math.floor(id / 12) * 16
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.set(ref.pixels.subarray(((oy + y) * ref.width + ox + x) * 4, ((oy + y) * ref.width + ox + x) * 4 + 4), (y * 16 + x) * 4); return d }
  rows.push([[88, 97], [112, 84], [98, 86], [99, 100]].map(p => p.map(refTile)))
  const pairs = ids => ids.map(id => [out.get(`tf_${id}`), out.get(`tf_${id}_step`)])
  for (const age of ['adult', 'child', 'elder']) {
    const ids = LOOKS.filter(l => l.age === age).map(l => l.id)
    for (let i = 0; i < ids.length; i += 10) rows.push(pairs(ids.slice(i, i + 10)))
  }
  rows.push(pairs(Object.keys(NAMED)))
  rows.push(pairs(WATCH.map((_, i) => `w${pad(i + 1)}`)))
  rows.push(pairs([...DOGS, ...CATS].map(a => a.id).concat('horse_1')))
  rows.push(Object.keys(BIRDS).reduce((acc, n, i) => (i % 2 ? acc.at(-1).push(out.get(`tf_${n}`)) : acc.push([out.get(`tf_${n}`)]), acc), []))
  // the crowd: 13 x 5 cells of cobbles, people dealt from a fixed seed
  const CS = 3, CW = 13, CH = 5
  const width = Math.max(Math.max(...rows.map(r => r.length)) * (2 * CELL + GAP) + GAP, CW * 16 * CS + 2 * GAP)
  const height = rows.length * (CELL + GAP) + GAP + CH * 16 * CS + GAP
  const img = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) img.set([86, 104, 84, 255], i * 4)
  const blit = (tile, ox, oy, sc) => {
    for (let y = 0; y < 16 * sc; y++) for (let x = 0; x < 16 * sc; x++) {
      const si = ((y / sc | 0) * 16 + (x / sc | 0)) * 4
      if (tile[si + 3]) img.set(tile.subarray(si, si + 4), ((oy + y) * width + ox + x) * 4)
    }
  }
  rows.forEach((row, r) => row.forEach((group, c) => group.forEach((tile, k) => blit(tile, GAP + c * (2 * CELL + GAP) + k * CELL, GAP + r * (CELL + GAP), S))))
  const cy0 = rows.length * (CELL + GAP) + GAP
  const cobble = [0, 1, 2, 3].map(i => `${ROOT}/renderer/assets/tiles/ow_city_pave_cobble_${i}.png`).filter(f => fs.existsSync(f)).map(f => readPng(f).pixels)
  const crowdRng = mulberry32(7)
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (cobble.length) blit(cobble[Math.floor(crowdRng() * cobble.length)], GAP + x * 16 * CS, cy0 + y * 16 * CS, CS)
  const people = [...LOOKS].sort(() => crowdRng() - 0.5).slice(0, 24)
  const spots = people.map((l, i) => ({ l, x: (i % 8) * 1.4 + (Math.floor(i / 8) % 2) * 0.7 + crowdRng() * 0.4, y: Math.floor(i / 8) * 1.4 + crowdRng() * 0.3, step: crowdRng() < 0.5, flip: crowdRng() < 0.5 }))
  for (const p of spots.sort((a, b) => a.y - b.y)) {
    let t = out.get(`tf_${p.l.id}${p.step ? '_step' : ''}`)
    if (p.flip) { const f = new Uint8Array(1024); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) f.set(t.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4), (y * 16 + 15 - x) * 4); t = f }
    blit(t, GAP + Math.round((p.x + 0.4) * 16 * CS), cy0 + Math.round((p.y + 0.6) * 16 * CS), CS)
  }
  writePng(sheetAt, width, height, img)
  console.log(`sheet ${sheetAt}`)
}
