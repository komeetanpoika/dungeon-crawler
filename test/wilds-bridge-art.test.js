// How the Wilds' bridges and paths look: the plank decks of bridge-art.js on
// small hand-made shapes and on real pieces, and the path ground beside them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  skinBridges, recutDeck, deckSkin, deckHasPost, isDeckSkin, DECK_SKINS,
  DECK_CUT_SKINS, DECK_UNDER_SKINS, FILLET_SKINS, deckCutSkin, deckUnderSkin, filletSkin, isDeckCutSkin, isDeckUnderSkin, isFilletSkin,
} from '../renderer/wilds/bridge-art.js'
import { readPng } from '../tools/png-read.mjs'
import { WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { PIECE, FRAME, MARGIN } from '../renderer/wilds/layout.js'
import { MapBuilder, isWaterSkin, isPierSkin } from '../renderer/terrain/lib.js'
import { TILE } from '../renderer/systems/entities.js'
import { takeDirtyTiles } from '../renderer/systems/tile-dirty.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const N = 1, E = 2, S = 4, W = 8
const mod = (n, m) => ((n % m) + m) % m
// A deck cell on a slanted edge. `cut`: its corner cut away; `mask` is then
// the two sides of that corner, which have no deck beside them, though the
// tile has no straight beam at all. `under`: the long leg of a ramp's fillet
// lies on one side; `mask` is the straight beam it may have on the far one.
// Neither has a post.
const BIT = { n: N, e: E, s: S, w: W }, FACING = { n: 's', s: 'n', w: 'e', e: 'w' }
const parse = name => {
  const m = /^ow_pier_deck_([hv])_(\d+)(p?)$/.exec(name ?? '')
  if (m) return { boards: m[1], mask: +m[2], post: m[3] === 'p' }
  const c = /^ow_pier_deck_([hv])_([nsew])([nsew])([cd])$/.exec(name ?? '')
  if (c) return { boards: c[1], mask: BIT[FACING[c[2]]] | BIT[c[3]], post: false, cut: { lie: c[2] + c[3], piece: c[4] } }
  const u = /^ow_pier_deck_([hv])_([nsew])([nsew])u([012])$/.exec(name ?? '')
  return u && { boards: u[1], mask: u[4] === '1' ? BIT[u[2]] : 0, post: false, under: { lie: u[2] + u[3], side: FACING[u[2]], both: u[4] === '2' } }
}

// ---- hand-made shapes ---------------------------------------------------------
// . water   g grass   s sand   # a pier laid as logs   | the same, laid upright
// L a pile of logs on the grass (a prop, not a bridge)
function scene(rows) {
  const b = new MapBuilder('t', 't', 't', rows[0].length, rows.length)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'g' || ch === 'L') b.g(x, y, 'ow_grass_0')
    else if (ch === 's') b.g(x, y, 'ow_sand_0')
    else { b.g(x, y, `ow_water_${(x + y) & 1}`); b.walkG[y][x] = false }
    if (ch === '#') { b.p(x, y, 'ow_pier_log', { walkable: true }); b.walkG[y][x] = true }
    if (ch === '|') { b.p(x, y, 'ow_pier_log_v', { walkable: true }); b.walkG[y][x] = true }
    if (ch === 'L') b.p(x, y, 'ow_pier_log')
  }))
  return { b }
}
const propAt = (b, x, y) => b.palette[b.prop[y]?.[x]] ?? null
const skinned = (rows, opts = {}) => {
  const s = scene(rows)
  const n = skinBridges(s.b, opts)
  return { ...s, n, at: (x, y) => parse(propAt(s.b, x, y)) }
}
// Every deck cell's beams and posts follow from the four cells beside it.
function assertCut(b, { X0 = 0, Y0 = 0 } = {}) {
  const decked = (x, y) => !b.in(x, y) || (b.walkG[y][x] && isPierSkin(propAt(b, x, y)))
  // a fillet is deck to the cell it lies against: no beam between the two
  const joined = (x, y) => decked(x, y) || isFilletSkin(propAt(b, x, y))
  const open = (x, y, is) => (is(x, y - 1) ? 0 : N) | (is(x + 1, y) ? 0 : E) | (is(x, y + 1) ? 0 : S) | (is(x - 1, y) ? 0 : W)
  let n = 0
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const d = parse(propAt(b, x, y))
    if (!d) continue
    n++
    if (d.cut) { assert.equal(d.mask, open(x, y, decked), `the corner cut at ${x},${y}`); continue }
    const mask = open(x, y, joined)
    assert.equal(d.mask, mask, `beams at ${x},${y}`)
    if (!d.under) assert.equal(d.post, deckHasPost(mask) && mod(mask & (N | S) ? X0 + x : Y0 + y, 3) === 0, `post at ${x},${y}`)
  }
  return n
}

test('every deck tile is drawn and loaded with the Wilds', () => {
  assert.equal(new Set(DECK_SKINS).size, 44)   // 16 cuts and 6 with a post, planked both ways
  const loaded = new Set(WILDS_SKINS)
  for (const n of [...DECK_SKINS, 'ow_path_sand_0', 'ow_path_sand_1', 'ow_path_sand_2', 'ow_path_sand_3']) {
    assert.ok(loaded.has(n), `${n} is not in WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), `no tile art for ${n}`)
  }
  // names carry behaviour: a pier by prefix and to isPierSkin, and never a canopy to the lumber table
  for (const n of DECK_SKINS) assert.ok(n.startsWith('ow_pier_') && isPierSkin(n) && isDeckSkin(n) && !n.endsWith('_top'), n)
  for (const n of ['ow_pier_log', 'ow_pier_log_v', 'ow_pier_post']) assert.ok(isPierSkin(n) && !isDeckSkin(n), n)
  for (const n of [null, undefined, '', 'ow_water_0', 'ow_prop_log', 'ow_pier']) assert.ok(!isPierSkin(n) && !isDeckSkin(n), String(n))
})

test('a straight span: beams down both sides, a sill and two posts where it lands', () => {
  const { b, n, at } = skinned([
    'ggggg',
    '..#..',
    '..#..',
    '..#..',
    '..#..',
    '..#..',
    'ggggg',
  ])
  assert.equal(n, 5)
  assert.deepEqual(at(2, 1), { boards: 'h', mask: N | E | W, post: false })   // the corner posts are the tile's own
  assert.deepEqual(at(2, 5), { boards: 'h', mask: S | E | W, post: false })
  for (const y of [2, 3, 4]) assert.deepEqual(at(2, y), { boards: 'h', mask: E | W, post: y === 3 }, `row ${y}`)
  assert.equal(assertCut(b), 5)
})

test('planks lie across the way a bridge runs, whichever tile the path laid', () => {
  const ew = skinned([
    'g.........g',
    'g#########g',
    'g#########g',
    'g.........g',
  ])
  for (let x = 1; x <= 9; x++) for (const y of [1, 2]) assert.equal(ew.at(x, y).boards, 'v', `${x},${y}`)
  assert.equal(ew.at(1, 1).mask, N | W)
  assert.equal(ew.at(5, 1).mask, N)
  assert.equal(ew.at(5, 2).mask, S)
  assert.equal(ew.at(9, 2).mask, S | E)
  const ns = skinned(['g||g', '.||.', '.||.', '.||.', '.||.', '.||.', '.||.', 'g||g'].map(r => r.replace(/g/g, '.')))
  for (let y = 0; y < 8; y++) for (const x of [1, 2]) assert.equal(ns.at(x, y).boards, 'h')
  // laid upright along an east-west run: the art follows the shape, not the name
  const wrong = skinned(['.........', '|||||||||', '.........'])
  for (let x = 0; x < 9; x++) assert.equal(wrong.at(x, 1).boards, 'v')
})

test('a stair of steps is one deck: no beam between its cells, one planking throughout', () => {
  // four-connected steps one tile wide, and the same stair two wide
  for (const rows of [[
    'g.........',
    '##........',
    '.##.......',
    '..##......',
    '...##.....',
    '....##....',
    '.....##...',
    '......##..',
    '.......##g',
  ], [
    'gg........',
    '##........',
    '###.......',
    '.###......',
    '..###.....',
    '...###....',
    '....###...',
    '.....###..',
    '......##gg',
  ]]) {
    const { b, at } = skinned(rows)
    const n = assertCut(b)
    assert.ok(n >= 16)
    const boards = new Set()
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (at(x, y)) boards.add(at(x, y).boards)
    assert.equal(boards.size, 1, 'the stair changes planking')
    // a step's outer corner has no deck on its two outer sides, and is joined on the other two
    assert.equal(at(2, 2).mask, N | E)
    assert.equal(at(1, 2).mask, rows[2][0] === '#' ? 0 : W | S)
  }
})

test('steps that touch only at corners are still one bridge', () => {
  const { b, at } = skinned([
    '........',
    '.#......',
    '..#.....',
    '...#....',
    '....#...',
    '.....#..',
    '......#.',
    '........',
  ])
  assertCut(b)
  for (let i = 1; i <= 6; i++) assert.deepEqual(at(i, i), { boards: 'h', mask: 15, post: false })
})

test('where bridges cross or join, the deck is whole', () => {
  const { b, at } = skinned([
    '....##....',
    '....##....',
    '....##....',
    '##########',
    '##########',
    '....##....',
    '....##....',
    '.....#....',
    '.....#....',
    '..........',
  ])
  assertCut(b)
  for (const [x, y] of [[4, 3], [5, 3], [4, 4], [5, 4]]) assert.equal(at(x, y).mask, 0, `crossing at ${x},${y}`)
  assert.equal(at(3, 3).mask, N)        // an arm's edge runs up to the crossing
  assert.equal(at(4, 5).mask, W)
  assert.equal(at(4, 6).mask, S | W)    // two wide narrowing to one: the corner gets its post
  assert.equal(at(5, 8).mask, S | E | W)
})

test('a wide corridor narrowing to a path keeps its edge all the way round', () => {
  const { b, at } = skinned([
    '.####.',
    '.####.',
    '.####.',
    '..##..',
    '..##..',
    'gggggg',
  ], { runs: (x, y) => y < 3 ? 'ew' : null })
  assertCut(b)
  assert.equal(at(1, 2).mask, S | W)
  assert.equal(at(2, 2).mask, 0)
  // (the shoulder is slanted: the path's first cell lies under the ramp's fillet, with no beam of its own there)
  assert.ok(at(2, 3).under && at(2, 3).mask === 0)
  assert.equal(at(2, 4).mask, S | W)
  // the caller's word wins where it gives one; the rest follows the bridge
  assert.equal(at(2, 0).boards, 'v')
  assert.equal(at(2, 4).boards, 'h')
})

test('a jetty that stops short ends properly; a log pile on land is no bridge', () => {
  const { b, at, n } = skinned([
    '..#.....',
    '..#.....',
    '..####..',
    '..#.....',
    'gLg.....',
  ])
  assert.equal(n, 7)
  assert.equal(at(2, 2).mask, W)
  assert.equal(at(4, 2).mask, N | S)
  assert.equal(at(5, 2).mask, N | E | S)   // the end over open water: beams on three sides, a post in both corners
  assert.equal(at(2, 3).mask, S | E | W)
  assert.equal(propAt(b, 1, 4), 'ow_pier_log')
  assertCut(b)
})

test('the pass changes art only, and is the same done twice', () => {
  const rows = ['g..##..g', '.####...', '.##.....', '.#..##..', 'gg..##sg']
  const before = scene(rows).b
  const { b } = skinned(rows)
  assert.deepEqual(b.walkG, before.walkG)
  assert.deepEqual(b.ground.map(r => r.map(i => b.palette[i])), before.ground.map(r => r.map(i => before.palette[i])))
  const once = b.prop.map(r => r.map(i => b.palette[i] ?? null))
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++)
    assert.equal(rows[y][x] === '#', isDeckSkin(once[y][x]), `${x},${y}`)
  assert.equal(skinBridges(b), rows.join('').split('#').length - 1)
  assert.deepEqual(b.prop.map(r => r.map(i => b.palette[i] ?? null)), once)
})

test('posts are counted in world tiles, so they run on from piece to piece', () => {
  const rows = ['..........', '##########', '..........']
  for (const X0 of [0, 1, -401, 7919]) {
    const { b, at } = skinned(rows, { X0 })
    assertCut(b, { X0 })
    for (let x = 0; x < 10; x++) assert.equal(at(x, 1).post, mod(X0 + x, 3) === 0)
  }
})

// ---- planks laid and lifted while the game runs ---------------------------------
// The game's cells of a builder, as wilds/piece.js makes them.
const gameCells = b => b.ground.map((row, y) => row.map((g, x) => {
  const c = { tile: b.walkG[y][x] ? TILE.FLOOR : TILE.WALL, skin: b.palette[g] }
  if (b.prop[y][x] !== -1) c.overlay = b.palette[b.prop[y][x]]
  if (!b.walkG[y][x] && isWaterSkin(c.skin)) c.losClear = true
  return c
}))
const overlays = map => map.map(r => r.map(c => c.overlay ?? null))
// what the generator lays for a shape: the truth a run-time change must arrive at
const generated = (rows, opts) => overlays(gameCells(skinned(rows, opts).b))
// a plank laid and lifted the way the quest modules do it, then cut in
const lay = (map, x, y, opts) => { const c = map[y][x]; c.tile = TILE.FLOOR; c.overlay = 'ow_pier_log'; delete c.losClear; return recutDeck(map, x, y, opts) }
const lift = (map, x, y, opts) => { const c = map[y][x]; c.tile = TILE.WALL; c.overlay = null; c.losClear = true; return recutDeck(map, x, y, opts) }
const row = (deck, y = 1) => ['..........', '..........', '..........'].map((r, i) => i === y ? deck : r)

test('a plank laid in a gap: it and both neighbours wear what a whole new deck would', () => {
  for (const X0 of [0, 1, 2, -401]) {
    const opts = { X0, Y0: 7 }
    const map = gameCells(skinned(row('g###...##g'), opts).b)
    // broken off, each side ends in a beam
    assert.equal(parse(map[1][3].overlay).mask, N | E | S)
    assert.equal(parse(map[1][7].overlay).mask, N | S | W)
    takeDirtyTiles(map)
    assert.equal(lay(map, 4, 1, opts), 2, 'the plank and the deck it joins')
    assert.deepEqual(overlays(map), generated(row('g####..##g'), opts), `X0 ${X0}: one plank`)
    assert.deepEqual(takeDirtyTiles(map), [4, 1, 3, 1], 'the tile layer is told of both')
    lay(map, 5, 1, opts)
    assert.deepEqual(overlays(map), generated(row('g#####.##g'), opts), `X0 ${X0}: two planks`)
    assert.equal(lay(map, 6, 1, opts), 3, 'the last plank closes both sides')
    assert.deepEqual(overlays(map), generated(row('g########g'), opts), `X0 ${X0}: the deck whole`)
    assert.equal(parse(map[1][6].overlay).mask, N | S)
    assert.equal(recutDeck(map, 6, 1, opts), 0, 'cutting again changes nothing')
    assert.equal(takeDirtyTiles(map).length, (2 + 3) * 2, 'two cells for the second plank, three for the last')
  }
})

test('a plank lifted leaves the deck a proper end on both sides, and laid back it is whole again', () => {
  const opts = { X0: 5, Y0: -3 }
  const whole = generated(row('g########g'), opts)
  const map = gameCells(skinned(row('g########g'), opts).b)
  assert.equal(lift(map, 5, 1, opts), 2)
  assert.deepEqual(overlays(map), generated(row('g####.###g'), opts))
  assert.equal(parse(map[1][4].overlay).mask, N | E | S)
  assert.equal(parse(map[1][6].overlay).mask, N | S | W)
  lift(map, 6, 1, opts); lift(map, 4, 1, opts)
  assert.deepEqual(overlays(map), generated(row('g###...##g'), opts))
  for (const x of [4, 5, 6]) lay(map, x, 1, opts)
  assert.deepEqual(overlays(map), whole)
  // the walking and the water under it are the caller's, never the cut's
  for (let x = 1; x <= 8; x++) { assert.equal(map[1][x].tile, TILE.FLOOR); assert.ok(isWaterSkin(map[1][x].skin)) }
})

test('planks laid from the far end, or out of order, still end as one deck', () => {
  // the ferryman's pier: standing planks, then a gap that runs to the island
  for (const order of [[4, 5, 6, 7], [7, 6, 5, 4], [5, 7, 4, 6], [6, 4, 7, 5]]) {
    const map = gameCells(skinned(row('g###....gg')).b)
    for (const x of order) lay(map, x, 1)
    assert.deepEqual(overlays(map), generated(row('g#######gg')), `laid ${order}`)
  }
})

test('a pier that runs north-south, and a wide deck with a plank out of its middle', () => {
  const pier = ['.g.', '.#.', '.#.', '...', '...', '.#.', '.#.', '.g.']
  const whole = pier.map((r, y) => y === 3 || y === 4 ? '.#.' : r)
  let map = gameCells(skinned(pier).b)
  lay(map, 1, 3); lay(map, 1, 4)
  assert.deepEqual(overlays(map), generated(whole))
  assert.equal(parse(map[3][1].overlay).boards, 'h')

  const wide = ['......', '.####.', '.####.', '.####.', '......']
  map = gameCells(skinned(wide).b)
  lift(map, 2, 2)
  assert.deepEqual(overlays(map), generated(['......', '.####.', '.#.##.', '.####.', '......']))
  assert.equal(parse(map[1][2].overlay).mask, N | S)   // the plank north of the hole has a beam facing it
  assert.equal(parse(map[2][1].overlay).mask, E | W)
  assert.equal(lay(map, 2, 2), 5, 'the plank and all four round it')
  assert.deepEqual(overlays(map), generated(wide))
})

test('the cut leaves alone what is not a deck over water', () => {
  const map = gameCells(scene(['gLg.', 'ggg.', 'ggg.']).b)
  const before = JSON.stringify(map)
  assert.equal(recutDeck(map, 1, 1), 0)
  assert.equal(recutDeck(map, 1, 0), 0)
  assert.equal(recutDeck(map, 9, 9), 0, 'off the map')
  assert.equal(JSON.stringify(map), before)
  assert.equal(takeDirtyTiles(map), null)
})

// ---- slanted edges -------------------------------------------------------------
// A cell as a short word: # deck, Cnwd a deck cell with a slanted corner (its
// lie and piece), Unw1 a deck cell under a ramp fillet's long leg (the
// fillet's lie; 1 with a beam on its far side), Fnec a fillet on the water,
// . anything else.
const slantWord = n => {
  let m
  if ((m = /^ow_pier_deck_[hv]_(..)([cd])$/.exec(n ?? ''))) return `C${m[1]}${m[2]}`
  if ((m = /^ow_pier_deck_[hv]_(..)u([012])$/.exec(n ?? ''))) return `U${m[1]}${m[2]}`
  if ((m = /^ow_prop_fillet_[hv]_(..)_([cdef])$/.exec(n ?? ''))) return `F${m[1]}${m[2]}`
  return isDeckSkin(n) ? '#' : '.'
}
const slantWords = b => b.prop.map(r => r.map(i => slantWord(b.palette[i])).join(' '))
const tidy = rows => rows.map(r => r.trim().split(/\s+/).join(' '))

test('every slanted deck tile and fillet is drawn, loaded with the Wilds, and named for what its cell is', () => {
  assert.equal(new Set(DECK_CUT_SKINS).size, 24)     // 8 ramps and 4 corners, planked both ways
  assert.equal(new Set(DECK_UNDER_SKINS).size, 40)   // under each of the 8 ramps with a far beam or none, and under 4 mirrored pairs, both ways
  assert.equal(new Set(FILLET_SKINS).size, 40)       // 8 ramps, and 4 corners whole or ending along either leg, both ways
  const loaded = new Set(WILDS_SKINS)
  for (const n of [...DECK_CUT_SKINS, ...DECK_UNDER_SKINS, ...FILLET_SKINS]) {
    assert.ok(loaded.has(n), `${n} is not in WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), `no tile art for ${n}`)
  }
  // no tile of the fillets that were timber wedges is left behind
  const drawn = fs.readdirSync(TILES).filter(f => f.startsWith('ow_prop_fillet_')).map(f => f.slice(0, -4)).sort()
  assert.deepEqual(drawn, [...FILLET_SKINS].sort())
  // deck on a slant is deck: a pier to every reader of names, and it parses
  for (const n of DECK_CUT_SKINS) assert.ok(isPierSkin(n) && isDeckSkin(n) && isDeckCutSkin(n) && !isDeckUnderSkin(n) && parse(n)?.cut && !isFilletSkin(n), n)
  for (const n of DECK_UNDER_SKINS) assert.ok(isPierSkin(n) && isDeckSkin(n) && isDeckUnderSkin(n) && !isDeckCutSkin(n) && parse(n)?.under && !isFilletSkin(n), n)
  for (const n of DECK_SKINS) assert.ok(!isDeckCutSkin(n) && !isDeckUnderSkin(n), n)
  // a fillet is a low prop: never a pier or a deck, not water by its own name, and sight passes over it
  for (const n of FILLET_SKINS) assert.ok(isFilletSkin(n) && !isPierSkin(n) && !isDeckSkin(n) && !isWaterSkin(n) && n.startsWith('ow_prop_'), n)
  assert.equal(deckCutSkin('h', 'nw', 'd'), 'ow_pier_deck_h_nwd')
  assert.equal(deckUnderSkin('v', 'se', true), 'ow_pier_deck_v_seu1')
  assert.equal(filletSkin('h', 'es', 'c'), 'ow_prop_fillet_h_es_c')
})

const STEPS_OF_TWO = ['...........', '.####......', '...####....', '.....####..', '.......###.', '...........']
const STEPS_OF_ONE = ['........', '.##.....', '..##....', '...##...', '....##..', '........']

test('a deck that steps a tile at a time: outer corners cut, inner corners filleted, the deck between gives up its beam', () => {
  // steps of two: each straight edge ramps over the one cell next to the
  // step. The deck cell under a fillet's long leg has no beam of its own on
  // that side (U); where the bridge ends square the last fillet ends the slant (e)
  const two = skinned(STEPS_OF_TWO)
  assert.deepEqual(slantWords(two.b), tidy([
    '. . .    .    .    .    .    .    .    .    .',
    '. # Une1 #    Csec Fswc .    .    .    .    .',
    '. . Fnec Cnwc Une0 Usw0 Csec Fswc .    .    .',
    '. . .    .    Fnec Cnwc Une0 Usw0 Csec Fswe .',
    '. . .    .    .    .    Fnec Cnwc #    #    .',
    '. . .    .    .    .    .    .    .    .    .',
  ]))
  // steps of one: 45 degrees, every cell of a two-wide deck with a corner off
  const one = skinned(STEPS_OF_ONE)
  assert.deepEqual(slantWords(one.b), tidy([
    '. .    .    .    .    .    . .',
    '. #    Csec Fswd .    .    . .',
    '. Fnee Cnwd Csed Fswd .    . .',
    '. .    Fned Cnwd Csed Fswe . .',
    '. .    .    Fned Cnwc #    . .',
    '. .    .    .    .    .    . .',
  ]))
  for (const { b } of [two, one]) {
    assertCut(b)
    const boards = parse(propAt(b, 1, 1)).boards
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const n = propAt(b, x, y), d = parse(n)
      if (d) {
        // deck, cut or not: walked on, over water, planked like the rest
        assert.ok(b.walkG[y][x] && isWaterSkin(b.palette[b.ground[y][x]]), `${x},${y}`)
        assert.equal(d.boards, boards, `planks at ${x},${y}`)
      } else if (isFilletSkin(n)) {
        // a fillet: on water that stays water and stays shut, planked as the bridge is
        assert.ok(!b.walkG[y][x] && isWaterSkin(b.palette[b.ground[y][x]]), `${x},${y}`)
        assert.equal(n['ow_prop_fillet_'.length], boards, `planks of the fillet at ${x},${y}`)
      } else assert.equal(n, null, `${x},${y}`)
    }
  }
})

test('a cut and its fillet go together, and where the rule has no clean answer the deck stays square', () => {
  const none = rows => { const { b } = skinned(rows); assert.ok(slantWords(b).join(' ').split(' ').every(c => c === '#' || c === '.'), rows.join('/')); return b }
  // real corners, a straight span and its ends, a hole in a wide deck
  none(['......', '.####.', '.#....', '.#....', '......'])
  none(['ggg', '.#.', '.#.', '.#.', '...'])
  none(['......', '.####.', '.#.##.', '.####.', '......'])
  // two decks that touch at a corner: one bridge, but no edge to slant
  none(['......', '.##...', '.##...', '...##.', '...##.', '......'])
  // the end of a one-wide pier: two outer corners on one cell, and no deck behind them
  none(['.....', '.###.', '.....'])
  // a step against land is a landing, not an edge: the same deck's step over the water is slanted
  const { b } = skinned(['gggggg', '.###gg', '...##g', '......'])
  assert.deepEqual(slantWords(b), tidy(['. . .    .    . .', '. # Une1 #    . .', '. . Fnec Cnwc # .', '. . .    .    . .']))
  // a one-wide deck stepping the same way on both edges: one cell lies under a ramp on each side
  assert.deepEqual(slantWords(skinned(['.........', '.###.....', '...###...', '.....###.', '.........']).b), tidy([
    '. . .    .    .    .    .    . .',
    '. # Une1 Csec Fswc .    .    . .',
    '. . Fnec Cnwc Une2 Csec Fswc . .',
    '. . .    .    Fnec Cnwc Usw1 # .',
    '. . .    .    .    .    .    . .',
  ]))
  // nothing where the caller says no; and a step is slanted only if every cell round it may be
  assert.deepEqual(slantWords(skinned(['......', '.###..', '...###', '......'], { slant: false }).b).join(' ').match(/[CFU]/), null)
  const half = skinned(['........', '.####...', '...#####', '........'], { slant: x => x < 4 }).b
  assert.deepEqual(slantWords(half), tidy(['. . . . . . . .', '. # # # # . . .', '. . . # # # # #', '. . . . . . . .']))
  const whole = skinned(['........', '.####...', '...#####', '........']).b
  assert.deepEqual(slantWords(whole), tidy(['. . .    .    .    .    . .', '. # Une1 #    Csec Fswc . .', '. . Fnec Cnwc #    Usw1 # #', '. . .    .    .    .    . .']))
})

// The prop layer of a shape as pixels, from the tiles themselves: null where
// nothing is drawn, else the colour as 'r,g,b'.
const TILE_PX = new Map()
const tilePx = name => {
  if (!TILE_PX.has(name)) TILE_PX.set(name, readPng(path.join(TILES, `${name}.png`)))
  return TILE_PX.get(name)
}
function propPixels(b) {
  const W16 = b.w * 16, px = new Array(W16 * b.h * 16).fill(null)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const n = propAt(b, x, y)
    if (!n) continue
    const t = tilePx(n)
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      const o = (j * 16 + i) * 4
      if (t.pixels[o + 3]) px[(y * 16 + j) * W16 + x * 16 + i] = `${t.pixels[o]},${t.pixels[o + 1]},${t.pixels[o + 2]}`
    }
  }
  return { px, w: W16, h: b.h * 16 }
}
// the two dark inks of a beam's outer edge and of a post: never used for a plank
const DARK = new Set(['109,74,47', '74,49,34'])

test('the outline of a slanted bridge is one beam: dark edge all the way round, and no beam inside it', () => {
  const shapes = [
    STEPS_OF_ONE, STEPS_OF_TWO,
    // 45 degrees three wide, a gentle stair of fours, a slant meeting a straight run, two slants joining
    ['.........', '.###.....', '..###....', '...###...', '....###..', '.........'],
    ['..............', '.#####........', '.....#####....', '.........####.', '..............'],
    ['............', '.##.........', '..##........', '...##.......', '....#######.', '............'],
    ['...........', '.##.....##.', '..##...##..', '...##.##...', '....###....', '....###....', '...........'],
  ]
  for (const rows of shapes) {
    const { b } = skinned(rows)
    const { px, w, h } = propPixels(b)
    const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? null : px[y * w + x]
    let edge = 0, bare = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = at(x, y)
      if (!c) continue
      const outer = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)
      if (outer) { edge++; if (!DARK.has(c)) bare++ }
      if (!DARK.has(c)) continue
      // a dark pixel is the outer edge of a beam, or a post's: water within 4 px of it
      let near = false
      for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) if (!at(x + dx, y + dy)) { near = true; break }
      assert.ok(near, `${rows.join('/')}: a beam inside the deck at pixel ${x},${y}`)
    }
    // the outline itself: beam all the way, but for the end grain where a beam stops at a corner
    assert.ok(edge >= 150 && bare / edge < 0.04, `${rows.join('/')}: ${bare} of ${edge} outline pixels are not beam`)
  }
})

test('the slanted pass is the same done twice, and lays nothing but props', () => {
  const rows = ['........', '.##.....', '..##....', '...##...', '....####', '........']
  const s = scene(rows)
  const ground = JSON.stringify(s.b.ground), walk = JSON.stringify(s.b.walkG)
  skinBridges(s.b)
  const once = slantWords(s.b), names = s.b.prop.map(r => r.map(i => s.b.palette[i] ?? null))
  assert.ok(once.join(' ').includes('F') && once.join(' ').includes('C'))
  skinBridges(s.b)
  assert.deepEqual(s.b.prop.map(r => r.map(i => s.b.palette[i] ?? null)), names)
  assert.equal(JSON.stringify(s.b.ground), ground)
  assert.equal(JSON.stringify(s.b.walkG), walk)
})

test('a plank laid or lifted on a stepped deck: the slants follow, and the fillets stay water', () => {
  const stair = ['..........', '.####.....', '...####...', '.....####.', '..........']
  const whole = generated(stair)
  assert.ok(whole.flat().some(isFilletSkin) && whole.flat().some(isDeckCutSkin) && whole.flat().some(isDeckUnderSkin))
  // every plank in turn lifted and laid back: each time what the generator would lay
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 8; x++) {
    if (stair[y][x] !== '#') continue
    const map = gameCells(skinned(stair).b)
    takeDirtyTiles(map)
    lift(map, x, y)
    const gone = stair.map((r, ry) => ry === y ? r.slice(0, x) + '.' + r.slice(x + 1) : r)
    assert.deepEqual(overlays(map), generated(gone), `lifted ${x},${y}`)
    // (the lifted cell's own overlay is the caller's; the tile layer hears of every other cell that changed)
    const dirty = takeDirtyTiles(map) ?? []
    for (let cy = 0; cy < map.length; cy++) for (let cx = 0; cx < map[0].length; cx++) {
      if ((cx !== x || cy !== y) && (whole[cy][cx] ?? null) !== (map[cy][cx].overlay ?? null)) {
        assert.ok(dirty.some((v, i) => i % 2 === 0 && v === cx && dirty[i + 1] === cy), `lifted ${x},${y}: ${cx},${cy} changed unseen`)
      }
    }
    lay(map, x, y)
    assert.deepEqual(overlays(map), whole, `laid back ${x},${y}`)
    for (const r of map) for (const c of r) {
      if (isFilletSkin(c.overlay)) assert.ok(c.tile === TILE.WALL && isWaterSkin(c.skin) && c.losClear, 'a fillet on open water')
      if (isDeckSkin(c.overlay)) assert.equal(c.tile, TILE.FLOOR)
    }
  }
  // a plank laid on a fillet's cell takes its place; lifted, the fillet is back
  const map = gameCells(skinned(stair).b)
  const fx = whole[1].findIndex(isFilletSkin)
  assert.ok(fx > 0)
  lay(map, fx, 1)
  assert.deepEqual(overlays(map), generated(stair.map((r, y) => y === 1 ? r.slice(0, fx) + '#' + r.slice(fx + 1) : r)))
  lift(map, fx, 1)
  // (lifting leaves the caller's null where the generator has nothing or a fillet: the fillet is laid again)
  assert.deepEqual(overlays(map), whole)
})

// ---- real pieces ---------------------------------------------------------------
const cache = new Map()
const piece = (seed, wx, wy, deal = 0, tale = null) => {
  const k = `${seed},${wx},${wy},${deal},${tale}`
  if (!cache.has(k)) cache.set(k, generatePiece(seed, wx, wy, deal, tale))
  return cache.get(k)
}
// Bridge-heavy pieces of every country, a sea village and the home village.
const SAMPLE = [
  [1, 2, 2], [2, 3, 6], [1, -1, 2], [1, -3, 3], [2, -3, 6], [7, 6, 5], [1, -5, 1], [1, 0, 0],
  [2, -6, -2], [2, -5, -2, 3], [2, -6, -1, 3], [2, -5, -1],
].map(a => piece(...a))
const TALES = [['nakki', 'pier end'], ['tar', 'bridge gap 1'], ['lalli', 'pier end']].map(([id, at]) => ({ id, at, p: piece(1, -1, 1, 0, id) }))
const isBridge = c => c?.tile === TILE.FLOOR && isPierSkin(c.overlay)
const decksOf = p => { const out = []; for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (isDeckSkin(p.cells[y][x].overlay)) out.push({ x, y, ...parse(p.cells[y][x].overlay) }); return out }

test('a piece\'s bridges are all deck: walkable, over water, and no bare log left', () => {
  let total = 0
  for (const p of [...SAMPLE, ...TALES.map(t => t.p)]) {
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const c = p.cells[y][x]
      assert.ok(!isPierSkin(c.overlay) || isDeckSkin(c.overlay), `${p.key}: a bare ${c.overlay} at ${x},${y}`)
      if (!isDeckSkin(c.overlay)) continue
      total++
      assert.ok(parse(c.overlay), c.overlay)
      assert.equal(c.tile, TILE.FLOOR, `${p.key}: deck at ${x},${y} cannot be walked`)
      assert.ok(isWaterSkin(c.skin), `${p.key}: deck at ${x},${y} lies on ${c.skin}`)
    }
  }
  assert.ok(total > 1500, `only ${total} deck cells in the sample`)
})

test('every deck cell of a piece is cut to the cells beside it', () => {
  for (const p of [...SAMPLE, ...TALES.map(t => t.p)]) for (const d of decksOf(p)) {
    let mask = 0
    for (const [bit, dx, dy] of [[N, 0, -1], [E, 1, 0], [S, 0, 1], [W, -1, 0]]) {
      const c = p.cells[d.y + dy]?.[d.x + dx]
      // off the piece the neighbour is not ours to see: take the tile's word (the seam has its own test).
      // A cut corner's two sides have no deck; to any other cell a fillet lying against it is deck.
      if (c ? !isBridge(c) && (d.cut || !isFilletSkin(c.overlay)) : d.mask & bit) mask |= bit
    }
    assert.equal(d.mask, mask, `${p.key}: beams at ${d.x},${d.y}`)
    if (d.cut || d.under) continue
    const along = mask & (N | S) ? p.wx * PIECE + d.x : p.wy * PIECE + d.y
    assert.equal(d.post, deckHasPost(mask) && mod(along, 3) === 0, `${p.key}: post at ${d.x},${d.y}`)
  }
})

test('a piece\'s slanted edges: cut deck you walk, fillets on water that stays shut, no beam between them, and never in the frame', () => {
  let cuts = 0, fillets = 0, unders = 0
  const STEPS = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]]
  const beside = (p, x, y, pred) => STEPS.some(([, dx, dy]) => pred(p.cells[y + dy]?.[x + dx]?.overlay))
  for (const p of [...SAMPLE, ...TALES.map(t => t.p)]) for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    const c = p.cells[y][x], at = `${p.key}: ${c.overlay} at ${x},${y}`
    const d = isDeckSkin(c.overlay) ? parse(c.overlay) : null
    // a deck side a fillet lies on has no straight beam, whatever the cell
    // is: a cut cell has none at all, the cell under a ramp only on its far side
    if (d && !d.cut) for (const [side, dx, dy] of STEPS) {
      if (isFilletSkin(p.cells[y + dy]?.[x + dx]?.overlay)) assert.equal(d.mask & BIT[side], 0, `${at}: a beam against the fillet to its ${side}`)
    }
    if (d?.under) {
      unders++
      const [, dx, dy] = STEPS.find(([side]) => side === d.under.side)
      const f = /^ow_prop_fillet_[hv]_(..)_c$/.exec(p.cells[y + dy]?.[x + dx]?.overlay ?? '')
      assert.equal(f?.[1], d.under.lie, `${at}: not under the long leg of that ramp`)
    }
    const isCut = !!d?.cut, isFillet = isFilletSkin(c.overlay)
    if (!isCut && !isFillet && !d?.under) continue
    // the frame is square as it was: what a neighbour, or another deal, cannot see is not slanted
    assert.ok(Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y) >= FRAME, `${at}: in the frame`)
    assert.ok(isWaterSkin(c.skin), at)
    if (isFillet) {
      fillets++
      // water still: shut, seen across, and no pier to anything that reads names
      assert.ok(c.tile === TILE.WALL && c.losClear && !c.losSoft && !c.losTall && !isPierSkin(c.overlay), at)
      assert.ok(beside(p, x, y, isDeckCutSkin), `${at}: no cut beside it`)
    } else {
      assert.equal(c.tile, TILE.FLOOR, at)
      if (isCut) { cuts++; assert.ok(beside(p, x, y, isFilletSkin), `${at}: no fillet beside it`) }
    }
  }
  assert.ok(cuts > 150 && fillets > 150 && unders > 40, `only ${cuts} cuts, ${fillets} fillets and ${unders} cells under a ramp in the sample`)
})

test('one bridge, one planking; a gate corridor is planked across the crossing', () => {
  for (const p of SAMPLE) {
    const at = new Map(decksOf(p).map(d => [d.y * PIECE + d.x, d]))
    const inside = d => Math.min(d.x, d.y, PIECE - 1 - d.x, PIECE - 1 - d.y) >= FRAME
    for (const d of at.values()) {
      if (inside(d)) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const o = at.get((d.y + dy) * PIECE + d.x + dx)
          if (o && inside(o)) assert.equal(o.boards, d.boards, `${p.key}: planking changes between ${d.x},${d.y} and ${o.x},${o.y}`)
        }
      } else {
        const northSouth = (d.y < FRAME && Math.abs(d.x - p.gates.N.x - 0.5) <= 1.5) || (d.y >= PIECE - FRAME && Math.abs(d.x - p.gates.S.x - 0.5) <= 1.5)
        assert.equal(d.boards, northSouth ? 'h' : 'v', `${p.key}: corridor deck at ${d.x},${d.y}`)
      }
    }
  }
})

test('a bridge runs on across a piece edge: no beam on the seam, whatever each side was dealt', () => {
  // seed 2: (-6,-2) | (-5,-2) meet at an east gate over the sea, (-6,-2) / (-6,-1) at a south gate
  const A = piece(2, -6, -2), East = piece(2, -5, -2, 3), South = piece(2, -6, -1, 3)
  let seam = 0
  for (let i = 0; i < PIECE; i++) {
    const a = parse(A.cells[i][PIECE - 1].overlay), e = parse(East.cells[i][0].overlay)
    assert.equal(!!a, !!e, `east seam row ${i}`)
    if (a) { seam++; assert.equal(a.mask & E, 0); assert.equal(e.mask & W, 0); assert.equal(a.boards, e.boards) }
    const s = parse(A.cells[PIECE - 1][i].overlay), t = parse(South.cells[0][i].overlay)
    assert.equal(!!s, !!t, `south seam column ${i}`)
    if (s) { seam++; assert.equal(s.mask & S, 0); assert.equal(t.mask & N, 0); assert.equal(s.boards, t.boards) }
  }
  assert.ok(seam >= 4, 'the sample seams carry no bridge')
})

test('the frame\'s art does not change with the deal', () => {
  for (const [seed, wx, wy] of [[2, -6, -2], [1, 2, 2], [7, 6, 5]]) {
    const a = piece(seed, wx, wy, 0), b = piece(seed, wx, wy, 1)
    let differ = 0
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const d = Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y)
      const same = a.cells[y][x].skin === b.cells[y][x].skin && a.cells[y][x].overlay === b.cells[y][x].overlay
      if (d < MARGIN) assert.ok(same, `${seed}:${wx},${wy} differs at ${x},${y}: ${a.cells[y][x].skin}/${a.cells[y][x].overlay} against ${b.cells[y][x].skin}/${b.cells[y][x].overlay}`)
      else if (!same) differ++
    }
    assert.ok(differ > 200, 'the two deals are the same piece')
  }
})

test('a tale\'s own pier is plank deck like any bridge, planked across its run', () => {
  for (const { id, at, p } of TALES) {
    const end = p.points.find(q => q.label === at)
    const d = parse(p.cells[end.y][end.x].overlay)
    assert.ok(d, `${id}: ${at} wears ${p.cells[end.y][end.x].overlay}`)
    // these piers run east-west, one plank wide: beams north and south all along
    assert.equal(d.mask & (N | S), N | S, `${id}: ${at}`)
    assert.equal(d.boards, 'v', `${id}: ${at}`)
  }
})

test('paths: dirt on grass, the same dirt on sand, and a sand-coloured rim where they meet the sea', () => {
  const beachy = s => /^ow_(sand|stone_ground|hardpan|path_sand)/.test(s)
  let sandPath = 0, shore = 0
  for (const p of SAMPLE) for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    const s = p.cells[y][x].skin
    // the pack's hardpan edge tile, see-through down one side, is not ground
    assert.notEqual(s, 'ow_hardpan_1', `${p.key}: ${x},${y}`)
    if (s.startsWith('ow_path_sand')) sandPath++
    if (s.startsWith('ow_shore_')) shore++
    const m = /^ow_pond_([012])([012])$/.exec(s)
    if (!m || (m[1] === '1' && m[2] === '1')) continue
    // a green bank needs something green, or at least not beach, on a land side
    const land = [m[1] !== '1' && p.cells[y][x + (m[1] - 1)], m[2] !== '1' && p.cells[y + (m[2] - 1)]?.[x]].filter(Boolean)
    if (land.length) assert.ok(!land.every(c => beachy(c.skin)), `${p.key}: a grass bank on the beach at ${x},${y}`)
  }
  assert.ok(sandPath > 300, `only ${sandPath} cells of path over sand`)
  assert.ok(shore > 500)
  // the desert gates: the lane cells of a corridor over sand wear the sand
  // path (the west gate), or the road's sand ground where a road crosses (the north)
  const desert = piece(7, 6, 5)
  const lane = [0, 1].map(o => desert.cells[desert.gates.W.y + o][0].skin)
  for (const s of lane) assert.ok(/^ow_(path_sand|dirt)_/.test(s), `the west gate's lane is ${s}`)
  const road = [0, 1, 2].map(o => desert.cells[0][desert.gates.N.x + o].skin)
  for (const s of road) assert.ok(/^ow_road_sand_/.test(s), `the north gate's road is ${s}`)
})

test('every skin the sample pieces use is loaded with the Wilds and has its tile', () => {
  const loaded = new Set(WILDS_SKINS)
  const used = new Set()
  for (const p of [...SAMPLE, ...TALES.map(t => t.p)]) for (const row of p.cells) for (const c of row) { used.add(c.skin); if (c.overlay) used.add(c.overlay) }
  assert.ok([...used].some(isDeckSkin))
  for (const n of used) {
    assert.ok(loaded.has(n), `${n} is laid but missing from WILDS_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), `no tile art for ${n}`)
  }
})
