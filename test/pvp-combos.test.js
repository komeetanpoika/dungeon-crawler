// The Warrior's gesture recogniser (renderer/pvp/combos.js).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sectorOf, startGesture, stepGesture, classify, unitMove } from '../renderer/pvp/combos.js'

const N = { x: 0, y: -1 }, E = { x: 1, y: 0 }, S = { x: 0, y: 1 }, W = { x: -1, y: 0 }, O = { x: 0, y: 0 }
const NE = { x: 1, y: -1 }
// Feed a list of stick positions to a fresh gesture, stamina unlimited.
const feed = (moves, stamina = Infinity, start = O) => {
  let g = startGesture(start)
  let spent = 0
  for (const m of moves) { g = stepGesture(g, m, stamina - spent); spent += g.cost }
  return { g, spent }
}

describe('sectorOf', () => {
  it('reads the four sectors and neutral', () => {
    assert.deepEqual([N, E, S, W, O].map(m => sectorOf(m)), ['n', 'e', 's', 'w', null])
  })
  it('a diagonal with equal axes keeps the previous sector', () => {
    assert.equal(sectorOf(NE, 'n'), 'n')
    assert.equal(sectorOf(NE, 'e'), 'e')
    assert.equal(sectorOf(NE, null), null)
  })
  it('unitMove normalises a diagonal', () => {
    const u = unitMove(NE)
    assert.ok(Math.abs(Math.hypot(u.x, u.y) - 1) < 1e-12)
    assert.deepEqual(unitMove(O), { x: 0, y: 0 })
  })
})

describe('stepGesture', () => {
  it('leaving neutral and every change of sector is a move, costing 25', () => {
    const { g, spent } = feed([E, O, E])
    assert.deepEqual(g.moves, ['e', 'e'])
    assert.equal(spent, 50)
  })
  it('holding a direction registers once; the same direction again needs neutral between', () => {
    assert.deepEqual(feed([E, E, E]).g.moves, ['e'])
    assert.deepEqual(feed([E, O, O, E]).g.moves, ['e', 'e'])
  })
  it('W then adding D does not register until W is let go', () => {
    const up = { x: 0, y: -1 }, upRight = { x: 1, y: -1 }, right = { x: 1, y: 0 }
    assert.deepEqual(feed([up, upRight, upRight]).g.moves, ['n'])
    assert.deepEqual(feed([up, upRight, right]).g.moves, ['n', 'e'])
  })
  it('sweeping the stick around registers each quarter', () => {
    assert.deepEqual(feed([N, E, S, W]).g.moves, ['n', 'e', 's', 'w'])
  })
  it('the direction held at the press is not a move', () => {
    assert.deepEqual(feed([E, E], Infinity, E).g.moves, [])
    assert.deepEqual(feed([O, E], Infinity, E).g.moves, ['e'])
  })
  it('records at most four moves; later ones are ignored and free', () => {
    const { g, spent } = feed([N, E, S, W, N, E])
    assert.equal(g.moves.length, 4)
    assert.equal(spent, 100)
  })
  it('a move the hero cannot afford is not recorded, and still counts as seen', () => {
    const { g, spent } = feed([E, O, E, O, E], 60)
    assert.deepEqual(g.moves, ['e', 'e'])
    assert.equal(spent, 50)
    assert.equal(g.last, 'e')
  })
})

describe('classify', () => {
  it('no moves is the plain swing', () => {
    assert.deepEqual(classify([]), { kind: 'swing', dir: null })
  })
  it('d, d is a lunge toward d', () => {
    for (const d of ['n', 'e', 's', 'w']) assert.deepEqual(classify([d, d]), { kind: 'lunge', dir: d })
  })
  it('d, opposite is a fence toward d', () => {
    assert.deepEqual(classify(['e', 'w']), { kind: 'fence', dir: 'e' })
    assert.deepEqual(classify(['s', 'n']), { kind: 'fence', dir: 's' })
  })
  it('four quarter turns in one sense, either sense, is a whirlwind', () => {
    assert.deepEqual(classify(['n', 'e', 's', 'w']), { kind: 'whirl', dir: 'w' })
    assert.deepEqual(classify(['e', 'n', 'w', 's']), { kind: 'whirl', dir: 's' })
    assert.deepEqual(classify(['w', 'n', 'e', 's']), { kind: 'whirl', dir: 's' })
  })
  it('anything else is the plain swing', () => {
    for (const m of [['e'], ['e', 'n'], ['n', 'e', 's'], ['n', 'e', 'n', 'e'], ['n', 'e', 's', 'e'], ['e', 'e', 'e']])
      assert.deepEqual(classify(m), { kind: 'swing', dir: null }, m.join(','))
  })
})
