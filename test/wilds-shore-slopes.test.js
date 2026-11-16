// The slanted shores of the Wilds (renderer/wilds/shore-art.js): the rule on
// small hand-made coasts, that it changes art and nothing else, and that
// pieces still fit each other and do not move with the deal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slopeShores, SLOPE_SKINS, SHORE_SKINS, CUT_SKINS, FAMILIES, LIES, SIDES, cutSkin, shoreSkin, shoreOf, isBankSkin } from '../renderer/wilds/shore-art.js'
import { makeTerrain, WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { isFilletSkin } from '../renderer/wilds/bridge-art.js'
import { PIECE, MARGIN } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { MapBuilder, shoreline, isWaterSkin, isPierSkin, RIM_TILES } from '../renderer/terrain/lib.js'
import { LOS_CLEAR_PREFIXES } from '../renderer/systems/openmap.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeShoreCheck } from '../tools/wilds/shore-lines.mjs'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')

// ---- hand-made coasts -------------------------------------------------------
// . water   g grass   s sand   m marsh dirt   r mountain floor
// T a tree on grass   H a house wall on grass   # a deck over water   l a rock in the water
const GROUND = { g: 'ow_grass_0', T: 'ow_grass_0', H: 'ow_grass_0', s: 'ow_sand_0', m: 'ow_dirt_1', r: 'ow_mtn_ground_0' }
function scene(rows) {
  const b = new MapBuilder('t', 't', 't', rows[0].length, rows.length)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (GROUND[ch]) b.g(x, y, GROUND[ch])
    else { b.g(x, y, `ow_water_${(x + y) & 1}`); b.walkG[y][x] = false }
    if (ch === 'T') b.p(x, y, 'ow_tree_small')
    if (ch === 'H') b.p(x, y, 'ow_house_wall_l')
    if (ch === 'l') b.p(x, y, 'ow_rock_water_gray_0')
    if (ch === '#') { b.p(x, y, 'ow_pier_log', { walkable: true }); b.walkG[y][x] = true }
  }))
  shoreline(b)
  return b
}
// A cell as a short word: Fnea a fill (the land north of it, its corner at
// the east end, piece a), Cnwa a cut, Mnwb the foot of a cut on the water
// under it, R a square bank, ~ open water or a corner's bank alone, . land.
// A double lies by one side, written twice: Fnnu a pocket's end, Cnnu a bump
// and Mnnu the water off its tip, Cnnv a spit's end.
const ENDS_OF = { n: 'we', s: 'we', e: 'ns', w: 'ns' }
function word(name) {
  let m
  if ((m = /^ow_bank_(?:grass|sand|dirt)_([nsew])_([uv])$/.exec(name))) return `C${m[1]}${m[1]}${m[2]}`
  if ((m = /^ow_bank_(?:grass|sand|dirt)_(..)_(.)$/.exec(name))) return `C${m[1]}${m[2]}`
  const s = shoreOf(name)
  if (!s) return isWaterSkin(name) ? '~' : '.'
  for (let k = 0; k < 4; k++) {
    const ch = s.sides[k], side = 'nesw'[k], [start, end] = ENDS_OF[side]
    let j
    if (ch === 'u') return `F${side}${side}u`
    if (ch === 'm') { const land = 'nesw'[(k + 2) % 4]; return `M${land}${land}u` }
    if ((j = 'abcde'.indexOf(ch)) >= 0) return `F${side}${start}${'abcde'[j]}`
    if ((j = 'pqrst'.indexOf(ch)) >= 0) return `F${side}${end}${'abcde'[j]}`
    if ((j = 'gh'.indexOf(ch)) >= 0) return `M${side}${start}${'bc'[j]}`
    if ((j = 'ij'.indexOf(ch)) >= 0) return `M${side}${end}${'bc'[j]}`
  }
  return s.sides.includes('l') ? 'R' : '~'
}
const words = b => b.ground.map(r => r.map(i => word(b.palette[i])))
// a water cell with a fill on it; any cell of a ramp, water or land
const isFill = n => /[a-ep-u]/.test(shoreOf(n)?.sides ?? '')
const isSlope = n => isBankSkin(n) || /[^lo]/.test(shoreOf(n)?.sides ?? '')
// Where the drawn coast of a builder does not join up, tile to tile (tools/wilds/shore-lines.mjs).
const shoreCheck = makeShoreCheck(TILES)
function faults(b) {
  const cell = shoreCheck((x, y) => b.in(x, y) ? { skin: b.palette[b.ground[y][x]], overlay: b.prop[y][x] >= 0 ? b.palette[b.prop[y][x]] : null } : null)
  const out = []
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (const m of cell(x, y)) out.push(`${x},${y} ${m.side}: ${m.what}, ${m.own} against ${m.other}`)
  return out
}
// Every coast in this file is laid through here, and every one must join up.
const sloped = rows => {
  const b = scene(rows)
  const res = slopeShores(b)
  assert.equal(res.unknown, 0, rows.join('/'))
  assert.deepEqual(faults(b), [], rows.join('/'))
  return { b, res, w: words(b) }
}
const expectWords = (rows, want) => {
  const { w } = sloped(rows)
  assert.deepEqual(w.map(r => r.join(' ')), want.map(r => r.trim().split(/\s+/).join(' ')))
}

// The eight ways to turn a coast, and what each does to a piece's lie.
const flipX = g => g.map(r => [...r].reverse())
const flipY = g => [...g].reverse()
const transpose = g => g[0].map((_, x) => g.map(r => r[x]))
const swap = pairs => ch => pairs[ch] ?? ch
const TURNS = [
  { name: 'as it is', grid: g => g, letter: ch => ch, swaps: false },
  { name: 'mirrored east-west', grid: flipX, letter: swap({ w: 'e', e: 'w' }), swaps: false },
  { name: 'mirrored north-south', grid: flipY, letter: swap({ n: 's', s: 'n' }), swaps: false },
  { name: 'turned half round', grid: g => flipX(flipY(g)), letter: swap({ w: 'e', e: 'w', n: 's', s: 'n' }), swaps: false },
  { name: 'transposed', grid: transpose, letter: swap({ n: 'w', w: 'n', s: 'e', e: 's' }), swaps: true },
  { name: 'transposed and mirrored east-west', grid: g => flipX(transpose(g)), letter: swap({ n: 'e', w: 'n', s: 'w', e: 's' }), swaps: true },
  { name: 'transposed and mirrored north-south', grid: g => flipY(transpose(g)), letter: swap({ n: 'w', w: 's', s: 'e', e: 'n' }), swaps: true },
  { name: 'transposed and turned', grid: g => flipX(flipY(transpose(g))), letter: swap({ n: 'e', w: 's', s: 'w', e: 'n' }), swaps: true },
]
// A word after a turn. A 45-degree piece is named from its east-west side
// (the land north or south of it, then the end the corner is at), which is
// the corner of the cell a fill fills and the one across from the corner a
// cut cuts; which of d and e a fill is hangs on which of its two sides runs
// east-west, so a transposed coast may swap them.
const across = swap({ n: 's', s: 'n' })
function turnWord(wd, turn) {
  if (wd.length !== 4) return wd
  const [kind, a, c, piece] = wd
  if (!'de'.includes(piece)) return kind + turn.letter(a) + turn.letter(c) + piece
  const corner = [kind === 'C' ? across(a) : a, c].map(turn.letter)
  const [ns, we] = turn.swaps ? [corner[1], corner[0]] : corner
  return kind + (kind === 'C' ? across(ns) : ns) + we + (turn.swaps && piece === 'e' ? 'd' : piece)
}
const looser = (wd, turn) => turn.swaps && wd.length === 4 && wd[3] === 'e' ? wd.slice(0, 3) + 'd' : wd

test('every shore tile is drawn, loaded with the Wilds, and named for what its cell is', () => {
  assert.equal(new Set(SLOPE_SKINS).size, SLOPE_SKINS.length)
  // per bank 28 cuts and, for the doubles, 4 bumps and 4 spit ends
  assert.equal(CUT_SKINS.length, 108)
  // water cells: 15 with a corner's bank alone and 20 feet of cuts, the same for every bank; per bank 23
  // sets of square banks lib.js has no tile for and 88 cells with a ramp (22 a side)
  assert.equal(SHORE_SKINS.length, 15 + 20 + 3 * (23 + 88))
  const loaded = new Set(WILDS_SKINS)
  for (const n of SLOPE_SKINS) {
    assert.ok(loaded.has(n), `${n} is not in WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), `no tile art for ${n}`)
    assert.ok(!isPierSkin(n) && !n.endsWith('_top'), n)
  }
  // a water cell is water to every reader of names: collision art, sight, lightning
  for (const n of SHORE_SKINS) {
    assert.ok(isWaterSkin(n) && LOS_CLEAR_PREFIXES.some(p => n.startsWith(p)), n)
    const s = shoreOf(n)
    assert.equal(shoreSkin(s.rim, s.sides, s.tips), n)
  }
  // a cut is land: never water, and not grass to the elk's trail, which would repaint it
  for (const n of CUT_SKINS) assert.ok(!isWaterSkin(n) && !LOS_CLEAR_PREFIXES.some(p => n.startsWith(p)) && !n.startsWith('ow_grass'), n)
  for (const f of FAMILIES) for (const l of LIES) assert.ok(loaded.has(cutSkin(f.ground, l, 'b')))
  for (const f of FAMILIES) for (const l of SIDES) assert.ok(loaded.has(cutSkin(f.ground, l, 'u')) && loaded.has(cutSkin(f.ground, l, 'v')))
  // the eight cells lib.js has tiles for keep its names, and file names differ by more than case
  for (const tile of Object.values(RIM_TILES).flat()) assert.ok(shoreOf(tile) && shoreSkin(shoreOf(tile).rim, shoreOf(tile).sides) === tile, tile)
  assert.equal(new Set(SLOPE_SKINS.map(n => n.toLowerCase())).size, SLOPE_SKINS.length)
  // no tile is left over from an older set
  const drawn = fs.readdirSync(TILES).filter(f => /^ow_(pond|shore|mud|water)_(k|slope|foam)_|^ow_bank_/.test(f)).map(f => f.replace(/\.png$/, ''))
  assert.deepEqual(drawn.filter(n => !SLOPE_SKINS.includes(n)), [])
})

test('a coast that steps a tile every four: one straight line through the middle of each step', () => {
  // each tread's last two water cells take a wedge of land, the next tread's
  // first two land cells a wedge of water; the water under the first of
  // those is open, under the second the foot of the bank shows
  expectWords([
    'gggggggggggg',
    '....gggggggg',
    '........gggg',
    '............',
  ], [
    '.  .  .    .    .    .    .    .    .    .    .  .',
    'R  R  Fneb Fnea Cnwa Cnwb .    .    .    .    .  .',
    '~  ~  ~    ~    ~    Mnwb Fneb Fnea Cnwa Cnwb .  .',
    '~  ~  ~    ~    ~    ~    ~    ~    ~    Mnwb R  R',
  ])
})

test('treads of one, two and three, and a long one that ramps only at its ends', () => {
  // one: a 45-degree line, half a corner cut off each land cell and half filled in each water cell
  expectWords([
    'gggggggggggg',
    '....gggggggg',
    '.....ggggggg',
    '......gggggg',
    '.......ggggg',
    '............',
  ], [
    '. . .    .    .    .    .    .    .    . . .',
    'R R Fneb Fnea Cnwd .    .    .    .    . . .',
    '~ ~ ~    ~    Fnee Cnwd .    .    .    . . .',
    '~ ~ ~    ~    ~    Fnee Cnwd .    .    . . .',
    '~ ~ ~    ~    ~    ~    Fnee Cnwa Cnwb . . .',
    '~ ~ ~    ~    ~    ~    ~    ~    Mnwb R R R',
  ])
  // two: one cell each way, 8 px a cell
  expectWords([
    'gggggggggggggg',
    '.....ggggggggg',
    '.......ggggggg',
    '.........ggggg',
    '..............',
  ], [
    '. . . .    .    .    .    .    .    .    .    . . .',
    'R R R Fneb Fnea Cnwc .    .    .    .    .    . . .',
    '~ ~ ~ ~    ~    Mnwc Fnec Cnwc .    .    .    . . .',
    '~ ~ ~ ~    ~    ~    ~    Mnwc Fnec Cnwa Cnwb . . .',
    '~ ~ ~ ~    ~    ~    ~    ~    ~    ~    Mnwb R R R',
  ])
  // three: the same short ramps with a flat cell between them, not a line of
  // its own slope (it wavers from the true line by under 3 px)
  expectWords([
    'gggggggggggggggg',
    '.....ggggggggggg',
    '........gggggggg',
    '...........ggggg',
    '................',
  ], [
    '. . . .    .    .    . .    .    . .    .    .    . . .',
    'R R R Fneb Fnea Cnwc . .    .    . .    .    .    . . .',
    '~ ~ ~ ~    ~    Mnwc R Fnec Cnwc . .    .    .    . . .',
    '~ ~ ~ ~    ~    ~    ~ ~    Mnwc R Fnec Cnwa Cnwb . . .',
    '~ ~ ~ ~    ~    ~    ~ ~    ~    ~ ~    ~    Mnwb R R R',
  ])
  // seven: two cells of ramp at each end, the square rim between
  expectWords([
    'gggggggggggggggg',
    '....gggggggggggg',
    '...........ggggg',
    '................',
  ], [
    '. . .    .    .    .    . . . .    .    .    .    . . .',
    'R R Fneb Fnea Cnwa Cnwb . . . .    .    .    .    . . .',
    '~ ~ ~    ~    ~    Mnwb R R R Fneb Fnea Cnwa Cnwb . . .',
    '~ ~ ~    ~    ~    ~    ~ ~ ~ ~    ~    ~    Mnwb R R R',
  ])
})

test('a tread one tile long with a riser of two or more slopes along the riser', () => {
  // the coast of threes above, transposed: land to the west, risers of three and five
  expectWords([
    'g....', 'g....', 'g....', 'g....', 'g....',
    'gg...', 'gg...', 'gg...',
    'ggg..', 'ggg..', 'ggg..',
    'gggg.', 'gggg.', 'gggg.', 'gggg.', 'gggg.',
  ], [
    '. R    ~    ~    ~',
    '. R    ~    ~    ~',
    '. R    ~    ~    ~',
    '. Fwsb ~    ~    ~',
    '. Fwsa ~    ~    ~',
    '. Cwnc Mwnc ~    ~',
    '. .    R    ~    ~',
    '. .    Fwsc ~    ~',
    '. .    Cwnc Mwnc ~',
    '. .    .    R    ~',
    '. .    .    Fwsc ~',
    '. .    .    Cwna ~',
    '. .    .    Cwnb Mwnb',
    '. .    .    .    R',
    '. .    .    .    R',
    '. .    .    .    R',
  ])
})

test('bays and capes ramp from both ends; a real corner and a channel open at both ends stay square', () => {
  // a bay two wide and one five wide: the fills meet, or leave the rim
  // between them; the two cells of land between the bays are a cape
  expectWords([
    'gggggggggggg',
    'g..gg.....gg',
    '............',
  ], [
    '. .    .    .    .    .    .    . .    .    . .',
    '. Fnwc Fnec Cnwc Cnec Fnwa Fnwb R Fneb Fnea . .',
    'R ~    ~    Mnwc Mnec ~    ~    ~ ~    ~    R R',
  ])
  // a cape three wide: both ends cut, the middle flat
  expectWords([
    'ggggggggggggg',
    '.....ggg.....',
    '.............',
  ], [
    '. . . .    .    .    . .    .    .    . . .',
    'R R R Fneb Fnea Cnwc . Cnec Fnwa Fnwb R R R',
    '~ ~ ~ ~    ~    Mnwc R Mnec ~    ~    ~ ~ ~',
  ])
  // corners with both legs two or longer, a one-tile channel with no end
  for (const rows of [
    ['gggggg', 'gg....', 'gg....', 'gg....'],
    ['gggggg', '......', 'gggggg'],
  ]) {
    const { w, res } = sloped(rows)
    assert.equal(res.fills + res.cuts, 0, rows.join('/'))
    assert.ok(w.flat().every(c => c.length === 1), rows.join('/'))
  }
})

test('a one-tile pocket is a V notch, a one-tile bump a point, and a channel or a spit ends in a taper', () => {
  // a pocket: its end filled from both corners, the land either side cut to meet it
  expectWords([
    'ggggggggggggg',
    'gggggg.gggggg',
    '.............',
    '.............',
  ], [
    '. . . . .    .    .    .    .    . . . .',
    '. . . . Cneb Cnea Fnnu Cnwa Cnwb . . . .',
    'R R R R Mneb ~    ~    ~    Mnwb R R R R',
    '~ ~ ~ ~ ~    ~    ~    ~    ~    ~ ~ ~ ~',
  ])
  // a bump: cut from both corners to a point, the foot of its bank on the water beyond, the fills beside it
  expectWords([
    'ggggggggggggg',
    '.............',
    '.............',
    '......g......',
    'ggggggggggggg',
  ], [
    '. . . . .    .    .    .    .    . . . .',
    'R R R R R    R    R    R    R    R R R R',
    '~ ~ ~ ~ ~    ~    Mnnu ~    ~    ~ ~ ~ ~',
    'R R R R Fseb Fsea Cnnu Fswa Fswb R R R R',
    '. . . . .    .    .    .    .    . . . .',
  ])
  // a one-tile channel, however long its walls: the same V at its end
  expectWords([
    'ggggggg',
    'ggg.ggg',
    'ggg.ggg',
    'ggg.ggg',
    '.......',
    '.......',
  ], [
    '. . . .    . . .',
    '. . . Fnnu . . .',
    '. . . R    . . .',
    '. . . R    . . .',
    'R R R ~    R R R',
    '~ ~ ~ ~    ~ ~ ~',
  ])
  // a spit: its last cell tapered from both sides, the water either side taking the foot of that bank
  // and the water off its point the foot of the point
  expectWords([
    '.......',
    '.......',
    '...g...',
    '...g...',
    '...g...',
    'ggggggg',
  ], [
    '~ ~ ~    ~    ~    ~ ~',
    '~ ~ ~    Mnnu ~    ~ ~',
    '~ ~ Menc Cnnv Mwnc ~ ~',
    '~ ~ R    .    R    ~ ~',
    'R R R    .    R    R R',
    '. . .    .    .    . .',
  ])
  // each in its own ground: the pocket in its end wall's, the bump and the spit in their own
  for (const [ch, f] of [['g', FAMILIES[0]], ['s', FAMILIES[1]], ['m', FAMILIES[2]]]) {
    const names = rows => { const b = scene(rows.map(r => r.replaceAll('g', ch))); slopeShores(b); return new Set(b.ground.flat().map(i => b.palette[i])) }
    // (the pocket's end wall north of it; the land either side is cut, so no bank is left below the V)
    assert.ok(names(['ggggggggggggg', 'gggggg.gggggg', '.............', '.............']).has(shoreSkin(f.rim, 'uooo')), f.ground)
    const bump = names(['ggggggggggggg', '.............', '.............', '......g......', 'ggggggggggggg'])
    assert.ok(bump.has(cutSkin(f.ground, 'n', 'u')) && bump.has(shoreSkin(null, 'oomo')), f.ground)
    const spit = names(['.......', '.......', '...g...', '...g...', '...g...', 'ggggggg'])
    assert.ok(spit.has(cutSkin(f.ground, 'n', 'v')) && spit.has(shoreSkin(null, 'oomo')) && spit.has(shoreSkin(null, 'ohoo')) && spit.has(shoreSkin(null, 'oooh')), f.ground)
  }
})

test('teeth with no clean answer stay square', () => {
  const square = rows => { const { w } = sloped(rows); return w.flat().every(c => c.length === 1) }
  // a cell four corners want: a one-tile pond, a one-tile island
  assert.ok(square(['ggggg', 'gg.gg', 'ggggg']))
  assert.ok(square(['.....', '..g..', '.....', '.....'].flatMap((r, y) => y === 0 ? [r, r] : [r])))
  // the water off a tip is another bank's to rim: a bump facing a coast one tile off keeps its
  // square end (the fills beside it stand), and so does a spit that all but closes a strait
  expectWords([
    'ggggggggggggg',
    '.............',
    '......g......',
    'ggggggggggggg',
  ], [
    '. . . . .    .    . .    .    . . . .',
    'R R R R R    R    R R    R    R R R R',
    'R R R R Fseb Fsea . Fswa Fswb R R R R',
    '. . . . .    .    . .    .    . . . .',
  ])
  expectWords([
    'ggggggg',
    '.......',
    '...g...',
    '...g...',
    '...g...',
    'ggggggg',
  ], [
    '. . . . . . .',
    'R R R R R R R',
    '~ ~ R . R ~ ~',
    '~ ~ R . R ~ ~',
    'R R R . R R R',
    '. . . . . . .',
  ])
  // a bump whose one side cannot be filled (a rock in that water) is not cut at all
  const { w } = sloped(['ggggggggggggg', '.............', '.............', '.....lg......', 'ggggggggggggg'])
  assert.deepEqual(w[3].slice(4, 9), ['R', 'R', '.', 'Fswa', 'Fswb'])
  assert.equal(w[2][6], 'R')
})

test('the rule is the same whichever way the coast faces', () => {
  const coasts = [
    ['gggggggggggggggg', '....gggggggggggg', '...........ggggg', '................'],
    ['gggggggggggggggg', '.....ggggggggggg', '........gggggggg', '...........ggggg', '................'],
    ['gggggggggggg', '....gggggggg', '.....ggggggg', '......gggggg', '.......ggggg', '............'],
    ['gggggggggggg', 'g..gg.....gg', '............'],
    ['ggggggggggggg', '.....ggg.....', '.............'],
    ['ggggggggggggggggg', 'ggggg.......ggggg', 'ggg...........ggg', 'gg......g......gg', 'g......ggg......g', 'g.....ggggg.....g', 'gg.....ggg.....gg', 'ggg.....g.....ggg', 'ggggg.......ggggg', 'ggggggggggggggggg'],
    // teeth: a pocket, a bump, a dead-end channel, a spit
    ['ggggggggggggg', 'gggggg.gggggg', '.............', '.............', '......g......', 'ggggggggggggg'],
    ['ggggggggg', 'ggg.ggggg', 'ggg.ggggg', '.........', '.........', '.....g...', '.....g...', '.....g...', 'ggggggggg'],
  ]
  const seen = new Set()
  for (const rows of coasts) {
    const base = sloped(rows).w
    for (const turn of TURNS) {
      const turned = turn.grid(rows.map(r => [...r])).map(r => r.join(''))
      const got = sloped(turned).w.map(r => r.map(c => looser(c, turn)))
      const want = turn.grid(base).map(r => r.map(c => turnWord(c, turn)))
      assert.deepEqual(got.map(r => r.join(' ')), want.map(r => r.join(' ')), `${rows.join('/')} ${turn.name}`)
      for (const c of got.flat()) if (c.length === 4) seen.add(c)
    }
  }
  // every piece of every lie came up: all four sides, both ways along each
  for (const l of LIES) for (const c of ['Fa', 'Fb', 'Fc', 'Ca', 'Cb', 'Cc', 'Mb', 'Mc']) assert.ok(seen.has(c[0] + l + c[1]), `${c[0]}${l}${c[1]} never laid`)
  for (const l of ['nw', 'ne', 'sw', 'se']) for (const c of ['Fd', 'Cd']) assert.ok(seen.has(c[0] + l + c[1]), `${c[0]}${l}${c[1]} never laid`)
  for (const l of SIDES) for (const c of ['Fu', 'Cu', 'Mu', 'Cv']) assert.ok(seen.has(c[0] + l + l + c[1]), `${c[0]}${l}${c[1]} never laid`)
})

test('each bank slopes in its own ground, cell by cell; ground with no tiles stays square', () => {
  const stair = ch => ['gggggggggggg', '....gggggggg', '........gggg', '............'].map(r => r.replaceAll('g', ch))
  for (const [ch, f] of [['g', FAMILIES[0]], ['s', FAMILIES[1]], ['m', FAMILIES[2]]]) {
    const b = scene(stair(ch))
    slopeShores(b)
    const names = new Set(b.ground.flat().map(i => b.palette[i]))
    // the fill's two cells (its corner at their east end, the land across the step cut), the cut's, and the cut's foot
    for (const n of [shoreSkin(f.rim, 'pooo'), shoreSkin(f.rim, 'qooo'), cutSkin(f.ground, 'nw', 'a'), cutSkin(f.ground, 'nw', 'b'), shoreSkin(null, 'gooo')]) assert.ok(names.has(n), `${f.ground}: ${n}`)
    for (const n of names) if (isFill(n) || isBankSkin(n)) assert.ok(n.startsWith(`${f.rim}_`) || n.startsWith(`ow_bank_${f.ground}_`), `${n} on a ${f.ground} bank`)
  }
  // mountain floor has no tiles: nothing is drawn
  assert.equal(sloped(stair('r')).w.flat().filter(c => c.length === 4).length, 0)
  // a coast of several grounds: a fill is the ground of the land across the
  // bank from it, a cut the ground of the cell it cuts
  const mixed = scene(['ssgsgggggggggg', '....mggggggggg', '........gggggg', '..............'])
  slopeShores(mixed)
  const at = (x, y) => mixed.palette[mixed.ground[y][x]]
  assert.deepEqual([at(2, 1), at(3, 1), at(4, 1), at(5, 1)], ['ow_pond_k_qooo_0', 'ow_shore_k_pooo_0', 'ow_bank_dirt_nw_a', 'ow_bank_grass_nw_b'])
  // a cell of the ramp on ground with no tiles: the whole ramp stays square,
  // and the cut across the step with it
  expectWords([
    'ggrggggggggggg',
    '....gggggggggg',
    '........gggggg',
    '..............',
  ], [
    '. . . . . . .    .    .    .    . . . .',
    'R R R R . . .    .    .    .    . . . .',
    '~ ~ ~ ~ R R Fneb Fnea Cnwa Cnwb . . . .',
    '~ ~ ~ ~ ~ ~ ~    ~    ~    Mnwb R R R R',
  ])
})

test('what stands on a cell: a tree may be cut under, a house may not, and then the fill is drawn alone', () => {
  const stair = (a, c) => ['gggggggggggg', `....${a}${c}gggggg`, '........gggg', '............']
  // trees at the tip: the cut is drawn under them
  assert.deepEqual(sloped(stair('T', 'T')).w[1].slice(0, 7), ['R', 'R', 'Fneb', 'Fnea', 'Cnwa', 'Cnwb', '.'])
  // a house on either cell of the cut: no cut at all; the fill across the step stands alone, a step half as tall
  for (const [a, c] of [['H', 'g'], ['g', 'H']]) {
    const { w } = sloped(stair(a, c))
    assert.deepEqual(w[1].slice(0, 7), ['R', 'R', 'Fneb', 'Fnea', '.', '.', '.'], `house at ${a}${c}`)
    assert.deepEqual(w[2].slice(0, 8), ['~', '~', '~', '~', 'R', 'R', 'Fneb', 'Fnea'], `house at ${a}${c}`)
  }
  // a rock in a water cell the fill wants: no fill, and so no cut across the step either
  const rock = sloped(['gggggggggggg', '...lgggggggg', '........gggg', '............']).w
  assert.deepEqual(rock[1].slice(0, 7), ['R', 'R', 'R', 'R', '.', '.', '.'])
  assert.deepEqual(rock[2].slice(4, 10), ['R', 'R', 'Fneb', 'Fnea', 'Cnwa', 'Cnwb'])
  // a deck over a fill is fine; the land a deck lands on is never cut
  const deck = sloped(['gggggggggggg', '..##gggggggg', '....#...gggg', '....#.......']).w
  assert.deepEqual(deck[1].slice(0, 7), ['R', 'R', 'Fneb', 'Fnea', '.', '.', '.'])
  assert.deepEqual(deck[2].slice(4, 10), ['R', 'R', 'Fneb', 'Fnea', 'Cnwa', 'Cnwb'])
})

test('a channel one tile high: its end is filled from both corners, and the land above it is not cut', () => {
  // the channel's east end is the notch of the tread above and of the one
  // below: one double fill. The foot of a cut in the upper tread would lie
  // on the channel and meet its far bank: no cut, and the fill above stands
  // alone, with the square bank down the rest of its step.
  const { b, w } = sloped([
    'gggggggggggg',
    '.....ggggggg',
    '.......ggggg',
    'gggggggggggg',
  ])
  assert.deepEqual(w.map(r => r.join(' ')), [
    '. . . . . . . . . . . .',
    'R R R Fneb Fnea . . . . . . .',
    'R R R R R R Feeu . . . . .',
    '. . . . . . . . . . . .',
  ])
  assert.equal(b.palette[b.ground[1][4]], 'ow_pond_k_ploo_0')
})

test('only the ground art changes: no cell becomes water or land, walkable or not, and nothing standing moves', () => {
  for (const rows of [
    ['gggggggggggg', '....gggggggg', '........gggg', '............'],
    ['ggggggggggggggggg', 'ggggg.......ggggg', 'ggT...........ggg', 'gg......g......gg', 'g......ggg..#...g', 'g.....ggggg.#...g', 'gg.....ggg..#..gg', 'ggg.....g...#.ggg', 'ggggg.......ggggg', 'gggggggggggg#gggg'],
  ]) {
    const b = scene(rows)
    const before = { ground: b.ground.map(r => r.map(i => b.palette[i])), prop: b.prop.map(r => r.map(i => b.palette[i] ?? null)), walk: b.walkG.map(r => r.slice()) }
    const res = slopeShores(b)
    assert.ok(res.fills > 0 && res.cuts > 0)
    assert.deepEqual(b.prop.map(r => r.map(i => b.palette[i] ?? null)), before.prop)
    assert.deepEqual(b.walkG, before.walk)
    b.ground.forEach((r, y) => r.forEach((i, x) => {
      const now = b.palette[i], was = before.ground[y][x]
      assert.equal(isWaterSkin(now), isWaterSkin(was), `${x},${y}: ${was} -> ${now}`)
      if (!isWaterSkin(was) && now !== was) assert.ok(isBankSkin(now) && FAMILIES.some(f => f.is(was) && now.startsWith(`ow_bank_${f.ground}_`)), `${x},${y}: ${was} -> ${now}`)
    }))
  }
})

// ---- real pieces --------------------------------------------------------------
const built = (seed, wx, wy, deal = 0) => { const t = makeTerrain(seed, wx, wy, deal); t.finish(); return t }
const groundOf = (t, x, y) => t.b.palette[t.b.ground[y + MARGIN][x + MARGIN]]
const samplePieces = (seed, n) => Array.from({ length: n }, (_, i) => ({
  wx: (hashInt(seed, i, 0, 5) % 25) - 12, wy: (hashInt(seed, i, 1, 5) % 25) - 12,
}))
// where the second cell of a long ramp lies from its first
const NEXT = { w: [1, 0], e: [-1, 0], n: [0, 1], s: [0, -1] }

test('real pieces: slopes are laid, whole, and on cells that are what they were', () => {
  let fills = 0, cuts = 0
  for (const seed of [3, 77]) for (const { wx, wy } of samplePieces(seed, 10)) {
    const p = generatePiece(seed, wx, wy, 0)
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const c = p.cells[y][x], n = c.skin
      if (!isSlope(n)) continue
      const at = `${n} at ${x},${y} of ${wx},${wy} (seed ${seed})`
      if (isBankSkin(n)) {
        cuts++
        // land: walked on unless something stands there, and then it is growth
        if (c.tile === TILE.FLOOR) assert.ok(!c.overlay || !isPierSkin(c.overlay), at)
        else assert.ok(/^ow_(tree|bush|deadtree|shrub|rock)_/.test(c.overlay ?? ''), `${at} under ${c.overlay}`)
      } else {
        fills++
        // water: blocked and seen across (a bridge's fillet may lie on it), or under a deck
        if (c.tile === TILE.FLOOR) assert.ok(isPierSkin(c.overlay), at)
        else assert.ok(c.losClear && (!c.overlay || isFilletSkin(c.overlay)), `${at} under ${c.overlay}`)
      }
      // the two cells of a long ramp come together (inside the piece: the neighbour draws its own)
      const wd = word(n)
      if (wd[0] !== 'M' && 'ab'.includes(wd[3])) {
        const [dx, dy] = NEXT[wd[2]], s = wd[3] === 'a' ? 1 : -1
        const o = p.cells[y + dy * s]?.[x + dx * s]
        // (each in the ground of its own land, so the bank may differ)
        if (o) assert.equal(word(o.skin), wd.slice(0, -1) + (wd[3] === 'a' ? 'b' : 'a'), at)
      }
    }
  }
  assert.ok(fills > 200 && cuts > 100, `only ${fills} fills and ${cuts} cuts in the sample`)
})

test('real pieces: neighbours draw the same slopes along their seam, and the deal does not move them', () => {
  let near = 0
  for (const seed of [3, 77, 2024]) for (const { wx, wy } of samplePieces(seed, 8)) {
    const A = built(seed, wx, wy, 0), A2 = built(seed, wx, wy, 2), E = built(seed, wx + 1, wy, 1), S = built(seed, wx, wy + 1, 1)
    for (let i = 0; i < PIECE; i++) for (let k = 0; k < MARGIN; k++) {
      // what A lays in its margin is what the neighbour lays in its own first cells, and the other way
      for (const [mine, theirs, where] of [
        [groundOf(A, PIECE + k, i), groundOf(E, k, i), `east of ${wx},${wy} col ${k} row ${i}`],
        [groundOf(E, -1 - k, i), groundOf(A, PIECE - 1 - k, i), `west of ${wx + 1},${wy} col ${k} row ${i}`],
        [groundOf(A, i, PIECE + k), groundOf(S, i, k), `south of ${wx},${wy} row ${k} col ${i}`],
        [groundOf(S, i, -1 - k), groundOf(A, i, PIECE - 1 - k), `north of ${wx},${wy + 1} row ${k} col ${i}`],
      ]) {
        // every cell of the shore, square banks and corners too
        if (!isBankSkin(mine) && !shoreOf(mine) && !isBankSkin(theirs) && !shoreOf(theirs)) continue
        if (isSlope(mine) || isSlope(theirs)) near++
        // (the builder's last ring cannot see the land past it: which bank's colours it picks there is not held to)
        const bankless = n => (k === MARGIN - 1 ? n.replace(/^ow_(pond|shore|mud)_/, '') : n)
        assert.equal(bankless(mine), bankless(theirs), `seed ${seed} ${where}`)
      }
    }
    // within MARGIN of the edge the same slopes whatever is dealt inside
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      if (Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y) < MARGIN) assert.equal(groundOf(A, x, y), groundOf(A2, x, y), `seed ${seed} piece ${wx},${wy} at ${x},${y}`)
    }
  }
  assert.ok(near > 40, `only ${near} sloped cells beside a seam in the sample: the test proves nothing`)
})
