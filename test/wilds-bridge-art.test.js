// How the Wilds' bridges and paths look: the plank decks of bridge-art.js on
// small hand-made shapes and on real pieces, and the path ground beside them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { skinBridges, recutDeck, deckSkin, deckHasPost, isDeckSkin, DECK_SKINS } from '../renderer/wilds/bridge-art.js'
import { WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { PIECE, FRAME, MARGIN } from '../renderer/wilds/layout.js'
import { MapBuilder, isWaterSkin, isPierSkin } from '../renderer/terrain/lib.js'
import { TILE } from '../renderer/systems/entities.js'
import { takeDirtyTiles } from '../renderer/systems/tile-dirty.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const N = 1, E = 2, S = 4, W = 8
const mod = (n, m) => ((n % m) + m) % m
const parse = name => {
  const m = /^ow_pier_deck_([hv])_(\d+)(p?)$/.exec(name ?? '')
  return m && { boards: m[1], mask: +m[2], post: m[3] === 'p' }
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
  const joined = (x, y) => !b.in(x, y) || (b.walkG[y][x] && isPierSkin(propAt(b, x, y)))
  let n = 0
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const d = parse(propAt(b, x, y))
    if (!d) continue
    n++
    const mask = (joined(x, y - 1) ? 0 : N) | (joined(x + 1, y) ? 0 : E) | (joined(x, y + 1) ? 0 : S) | (joined(x - 1, y) ? 0 : W)
    assert.equal(d.mask, mask, `beams at ${x},${y}`)
    assert.equal(d.post, deckHasPost(mask) && mod(mask & (N | S) ? X0 + x : Y0 + y, 3) === 0, `post at ${x},${y}`)
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
    // a step's outer corner is cut on its two outer sides, and joined on the other two
    assert.equal(at(1, 1).mask, N | E)
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
  assert.equal(at(2, 3).mask, W)
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
      // off the piece the neighbour is not ours to see: take the tile's word (the seam has its own test)
      if (c ? !isBridge(c) : d.mask & bit) mask |= bit
    }
    assert.equal(d.mask, mask, `${p.key}: beams at ${d.x},${d.y}`)
    const along = mask & (N | S) ? p.wx * PIECE + d.x : p.wy * PIECE + d.y
    assert.equal(d.post, deckHasPost(mask) && mod(along, 3) === 0, `${p.key}: post at ${d.x},${d.y}`)
  }
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
  // the desert gate road: the lane cells of a corridor over sand wear the sand path
  const desert = piece(7, 6, 5)
  const lane = [0, 1].map(o => desert.cells[0][desert.gates.N.x + o].skin)
  for (const s of lane) assert.ok(/^ow_(path_sand|dirt)_/.test(s), `the north gate's lane is ${s}`)
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
