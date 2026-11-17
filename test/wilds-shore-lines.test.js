// The drawn coast of the Wilds joins up from tile to tile: wherever two
// cells share a border, the waterline one draws up to it is taken up by the
// other, and no land lies bare against water. tools/wilds/shore-lines.mjs
// judges that from the tiles' own pixels; here it is held to on made-up
// coasts of every shape, on real pieces with the seams between them, and at
// the tales' waters.
//
// Allowed exceptions: none. (A border with a cell under a bridge deck is not
// judged at all: the deck hides the ground there.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeShoreCheck, shoreFault } from '../tools/wilds/shore-lines.mjs'
import { slopeShores, shoreOf, isBankSkin } from '../renderer/wilds/shore-art.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { PIECE } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { MapBuilder, shoreline } from '../renderer/terrain/lib.js'

const check = makeShoreCheck()
const ofBuilder = b => (x, y) => b.in(x, y) ? { skin: b.palette[b.ground[y][x]], overlay: b.prop[y][x] >= 0 ? b.palette[b.prop[y][x]] : null } : null
function faultsIn(at, x0, y0, w, h) {
  const cell = check(at), out = []
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) for (const m of cell(x, y)) out.push(`${x},${y} ${m.side}: ${shoreFault(m)} (${m.own} | ${m.other})`)
  return out
}
// . water, g grass, s sand, m marsh dirt, r mountain floor
const GROUND = { g: 'ow_grass_0', s: 'ow_sand_0', m: 'ow_dirt_1', r: 'ow_mtn_ground_0' }
function scene(rows) {
  const b = new MapBuilder('t', 't', 't', rows[0].length, rows.length)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (GROUND[ch]) b.g(x, y, GROUND[ch])
    else { b.g(x, y, `ow_water_${(x + y) & 1}`); b.walkG[y][x] = false }
  }))
  shoreline(b)
  return b
}

test('the check sees a coast that does not join, and the pass leaves none', () => {
  const rows = [
    'gggggggggggggg',
    'gggggg....gggg',
    '..............',
    '......gg......',
    '..............',
  ]
  // lib.js's square rim alone: its tiles end where the land turns a corner
  // away from the water, and a cell with land on two facing sides banks one
  const square = scene(rows)
  const before = faultsIn(ofBuilder(square), 0, 0, square.w, square.h)
  assert.ok(before.length >= 8, before.join('\n'))
  assert.ok(before.some(f => f.includes('a square rim ends against open water')) && before.some(f => f.includes('bare shore')), before.join('\n'))
  const b = scene(rows)
  slopeShores(b)
  assert.deepEqual(faultsIn(ofBuilder(b), 0, 0, b.w, b.h), [])
  // one cell's tile changed for another: the border shows it
  const x = 5, y = 2
  assert.ok(shoreOf(b.palette[b.ground[y][x]]), b.palette[b.ground[y][x]])
  b.g(x, y, 'ow_water_0')
  assert.ok(faultsIn(ofBuilder(b), 0, 0, b.w, b.h).length > 0)
})

test('made-up coasts of every shape join up, on every ground', () => {
  let shore = 0, ramps = 0
  for (let n = 0; n < 150; n++) {
    const w = 26, h = 22
    // lumps of land a few cells across, more or less of them, with single cells flipped here and there
    const grid = 3 + n % 4, level = 90 + (n * 37) % 80, flips = n % 5
    const lump = (x, y) => {
      const gx = Math.floor(x / grid), gy = Math.floor(y / grid), fx = (x % grid) / grid, fy = (y % grid) / grid
      const v = (i, j) => hashInt(n, gx + i, gy + j, 11) % 256
      return v(0, 0) * (1 - fx) * (1 - fy) + v(1, 0) * fx * (1 - fy) + v(0, 1) * (1 - fx) * fy + v(1, 1) * fx * fy
    }
    const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
      let land = lump(x, y) > level
      if (hashInt(n, x, y, 12) % 100 < flips) land = !land
      return land ? 'ggggsmr'[hashInt(n, Math.floor(x / 6), Math.floor(y / 6), 13) % 7] : '.'
    }).join(''))
    const b = scene(rows)
    const res = slopeShores(b)
    assert.equal(res.unknown, 0, `coast ${n}: a cell asked for a tile there is none of\n${rows.join('\n')}`)
    assert.deepEqual(faultsIn(ofBuilder(b), 0, 0, w, h), [], `coast ${n}\n${rows.join('\n')}`)
    shore += b.ground.flat().filter(i => shoreOf(b.palette[i])).length
    ramps += res.fills + res.cuts
  }
  assert.ok(shore > 10000 && ramps > 1500, `only ${shore} shore cells and ${ramps} ramps: the coasts prove little`)
})

test('real pieces join up, across the seams between them too', () => {
  let shore = 0
  // three by three pieces: a sea coast, marsh and forest, the land round home
  for (const [seed, wx0, wy0] of [[1, 1, 1], [1, -6, 2], [77, -1, -1]]) {
    const pieces = new Map()
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) pieces.set(`${i},${j}`, generatePiece(seed, wx0 + i, wy0 + j, (i + j) % 3))
    const at = (x, y) => pieces.get(`${Math.floor(x / PIECE)},${Math.floor(y / PIECE)}`)?.cells[y % PIECE][x % PIECE] ?? null
    assert.deepEqual(faultsIn(at, 0, 0, 3 * PIECE, 3 * PIECE), [], `seed ${seed} pieces from ${wx0},${wy0}`)
    for (const p of pieces.values()) shore += p.cells.flat().filter(c => shoreOf(c.skin) || isBankSkin(c.skin)).length
  }
  assert.ok(shore > 3000, `only ${shore} shore cells in the sample`)
})

test('the waters of the tales join up', () => {
  for (const tale of ['tar', 'nakki', 'elk', 'kivihiisi', 'fold', 'flame', 'lalli']) for (const [wx, wy] of [[-1, 1], [2, 3]]) {
    const p = generatePiece(1, wx, wy, 0, tale)
    const at = (x, y) => p.cells[y]?.[x] ?? null
    assert.deepEqual(faultsIn(at, 0, 0, PIECE, PIECE), [], `${tale} at ${wx},${wy}`)
  }
})
