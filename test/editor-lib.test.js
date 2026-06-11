import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SIZE, idx, wrapIndex, sanitizeTileName, floodFill, rgbaToHex, hexToRgba }
  from '../tools/tile-editor/lib.js'

describe('wrapIndex', () => {
  it('wraps negatives', () => assert.equal(wrapIndex(-1), 15))
  it('wraps overflow', () => assert.equal(wrapIndex(16), 0))
  it('passes through in-range values', () => assert.equal(wrapIndex(7), 7))
})

describe('sanitizeTileName', () => {
  it('prefixes custom_ and lowercases', () =>
    assert.equal(sanitizeTileName('Moss Floor!'), 'custom_moss_floor'))
  it('does not double the prefix', () =>
    assert.equal(sanitizeTileName('custom_moss'), 'custom_moss'))
  it('returns null for empty/invalid input', () => {
    assert.equal(sanitizeTileName(''), null)
    assert.equal(sanitizeTileName('!!!'), null)
  })
})

describe('floodFill', () => {
  function grid(fillWith = null) { return new Array(SIZE * SIZE).fill(fillWith) }

  it('fills a contiguous region only', () => {
    const g = grid('#ffffffff')
    g[idx(0, 0)] = null  // isolated transparent pixel
    const out = floodFill(g, 0, 0, '#ff0000ff', false)
    assert.equal(out[idx(0, 0)], '#ff0000ff')
    assert.equal(out[idx(1, 0)], '#ffffffff')
  })
  it('does not cross the edge without wrap', () => {
    const g = grid()
    for (let y = 0; y < SIZE; y++) { g[idx(0, y)] = 'a'; g[idx(15, y)] = 'a' }
    const out = floodFill(g, 0, 0, 'b', false)
    assert.equal(out[idx(0, 8)], 'b')    // same column filled
    assert.equal(out[idx(15, 8)], 'a')   // opposite column untouched
  })
  it('crosses the edge with wrap', () => {
    const g = grid()
    for (let y = 0; y < SIZE; y++) { g[idx(0, y)] = 'a'; g[idx(15, y)] = 'a' }
    const out = floodFill(g, 0, 0, 'b', true)
    assert.equal(out[idx(15, 8)], 'b')   // reached via x: 0 → -1 ≡ 15
  })
  it('no-ops when target equals fill color', () => {
    const g = grid('x')
    assert.deepEqual(floodFill(g, 3, 3, 'x', false), g)
  })
})

describe('hex/rgba conversion', () => {
  it('round-trips', () => {
    assert.equal(rgbaToHex(90, 90, 114, 255), '#5a5a72ff')
    assert.deepEqual(hexToRgba('#5a5a72ff'), [90, 90, 114, 255])
  })
  it('hexToRgba defaults alpha to 255 for 6-digit hex', () =>
    assert.deepEqual(hexToRgba('#5a5a72'), [90, 90, 114, 255]))
})
