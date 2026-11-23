import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHADE, rimShade, castShadow, shadeSprites } from '../renderer/render/interior-shade.js'

// a w×h tile from rows of characters: '.' transparent, '#' outline (20,20,20), 'o' body (160,120,80)
const tile = rows => {
  const h = rows.length, w = rows[0].length, a = new Uint8ClampedArray(w * h * 4)
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const i = (y * w + x) * 4
    if (ch === '#') a.set([20, 20, 20, 255], i)
    if (ch === 'o') a.set([160, 120, 80, 255], i)
  }))
  return { a, w, h }
}
const px = (a, w, x, y) => [...a.slice((y * w + x) * 4, (y * w + x) * 4 + 4)]
const BOX = tile(['......', '.####.', '.#oo#.', '.#oo#.', '.#oo#.', '.####.'])

test('the outline and the transparent pixels are left alone', () => {
  const out = rimShade(BOX.a, BOX.w, BOX.h, SHADE.medium)
  assert.deepEqual(px(out, 6, 1, 1), [20, 20, 20, 255])
  assert.deepEqual(px(out, 6, 0, 0), [0, 0, 0, 0])
  assert.notEqual(out, BOX.a, 'a new array')
})
test('body pixels under or right of the outline are lit, those over or left of it are shaded', () => {
  const out = rimShade(BOX.a, BOX.w, BOX.h, SHADE.medium)
  const lit = px(out, 6, 2, 2), dark = px(out, 6, 3, 4)
  assert.ok(lit[0] > 160 && lit[1] > 120 && lit[2] > 80, 'the upper left body pixel is lighter')
  assert.deepEqual(lit, [Math.round(160 + 95 * 0.16), Math.round(120 + 135 * 0.16), Math.round(80 + 175 * 0.16), 255])
  assert.deepEqual(dark, [Math.round(160 * 0.78), Math.round(120 * 0.78), Math.round(80 * 0.78), 255])
  assert.deepEqual(px(out, 6, 2, 3), px(out, 6, 2, 2), 'the left column is lit all the way down but its last row')
})
test('an inner body pixel away from every edge is unchanged', () => {
  const big = tile(['#######', '#ooooo#', '#ooooo#', '#ooooo#', '#ooooo#', '#ooooo#', '#######'])
  assert.deepEqual(px(rimShade(big.a, 7, 7, SHADE.strong), 7, 3, 3), [160, 120, 80, 255])
})
test('the shadow is the silhouette moved down and right, split at the tile\'s lower edge', () => {
  const { self, below } = castShadow(BOX.a, BOX.w, BOX.h, SHADE.subtle)   // dx 1, dy 2
  const A = Math.round(255 * 0.18)
  assert.deepEqual(px(self, 6, 2, 3), [0, 0, 0, A], 'from the outline corner (1,1)')
  assert.deepEqual(px(self, 6, 1, 3), [0, 0, 0, 0], 'nothing left of the silhouette')
  assert.deepEqual(px(below, 6, 2, 0), [0, 0, 0, A], 'row 4 falls to row 0 of the cell below')
  assert.deepEqual(px(below, 6, 2, 2), [0, 0, 0, 0], 'only dy rows fall out')
})
test('a tile whose shadow stays inside has no part below', () => {
  const low = tile(['....', '.##.', '....', '....'])
  assert.equal(castShadow(low.a, 4, 4, SHADE.subtle).below, null)
})

// a fake canvas good enough for shadeSprites: getImageData / putImageData over an RGBA array
const fakeCanvas = (w, h, data = new Uint8ClampedArray(w * h * 4)) => ({
  width: w, height: h, data,
  getContext() { const c = this; return { drawImage(src) { c.data.set(src.data) }, getImageData: () => ({ data: c.data, width: w, height: h }), putImageData(img) { c.data = img.data } } },
})
test('shadeSprites swaps the shaded tile in, adds the shadow parts, and does it once', () => {
  const sprites = { in_table_l: fakeCanvas(6, 6, BOX.a.slice()), in_window: fakeCanvas(6, 6, BOX.a.slice()), in_floor_planks: fakeCanvas(6, 6, BOX.a.slice()) }
  const kinds = new Map([['in_table_l', 'cast'], ['in_window', 'rim']])
  const floor = sprites.in_floor_planks
  assert.equal(shadeSprites(sprites, { kinds, level: SHADE.medium, makeCanvas: fakeCanvas }), 2)
  assert.ok(sprites['in_table_l#cast'] && sprites['in_table_l#below'], 'a standing thing casts')
  assert.equal(sprites['in_window#cast'], undefined, 'a window only gets its rim')
  assert.ok(sprites.in_floor_planks === floor, 'the floor is not touched')
  const once = sprites.in_table_l.data.slice()
  assert.equal(shadeSprites(sprites, { kinds, level: SHADE.medium, makeCanvas: fakeCanvas }), 0, 'a second pass shades nothing')
  assert.deepEqual(sprites.in_table_l.data, once)
  assert.ok(!Object.keys(sprites).includes('__shaded'))
})

test('off the tile is not an open side: a tile that runs to its borders has no rim there', () => {
  const full = tile(['oooo', 'oooo', 'oooo', 'oooo'])
  assert.deepEqual(rimShade(full.a, 4, 4, SHADE.medium), full.a)
  const bar = tile(['####', 'oooo', 'oooo', '####'])
  const out = rimShade(bar.a, 4, 4, SHADE.medium)
  assert.ok(px(out, 4, 1, 1)[0] > 160, 'the row under the top outline is lit')
  assert.ok(px(out, 4, 1, 2)[0] < 160, 'the row over the bottom outline is shaded')
  for (const y of [1, 2]) {
    assert.deepEqual(px(out, 4, 0, y), px(out, 4, 1, y), `left border, row ${y}`)
    assert.deepEqual(px(out, 4, 3, y), px(out, 4, 2, y), `right border, row ${y}`)
  }
})

const quiet = fn => { const w = console.warn, calls = []; console.warn = (...a) => calls.push(a.join(' ')); try { return [fn(), calls] } finally { console.warn = w } }

test('a tile whose readback throws stays as it was; the others are shaded and nothing throws', () => {
  const sprites = { in_a: fakeCanvas(6, 6, BOX.a.slice()), in_b: fakeCanvas(6, 6, BOX.a.slice()) }
  const bad = sprites.in_a, before = bad.data.slice()
  const kinds = new Map([['in_a', 'cast'], ['in_b', 'rim']])
  // in_a's own readback happens on a fresh canvas, so make that canvas throw only when drawing from `bad`
  const make = (w, h) => {
    const c = fakeCanvas(w, h), g = c.getContext
    c.getContext = function () { const ctx = g.call(this); const d = ctx.drawImage; ctx.drawImage = src => { if (src === bad) throw new Error('tainted'); d(src) }; return ctx }
    return c
  }
  const [n, warns] = quiet(() => shadeSprites(sprites, { kinds, level: SHADE.medium, makeCanvas: make }))
  assert.equal(n, 1)
  assert.ok(sprites.in_a === bad && bad.data.every((v, i) => v === before[i]), 'the failing tile is as it was')
  assert.equal(sprites['in_a#cast'], undefined)
  assert.notDeepEqual([...sprites.in_b.data], [...BOX.a], 'the other tile is shaded')
  assert.equal(warns.length, 1)
})

test('a canvas that does not give back what was drawn skips the whole pass', () => {
  const sprites = { in_a: fakeCanvas(6, 6, BOX.a.slice()) }
  const before = sprites.in_a
  const lying = (w, h) => {
    const c = fakeCanvas(w, h)
    c.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }), putImageData() {} })
    return c
  }
  const [n, warns] = quiet(() => shadeSprites(sprites, { kinds: new Map([['in_a', 'cast']]), level: SHADE.medium, makeCanvas: lying }))
  assert.equal(n, 0)
  assert.ok(sprites.in_a === before)
  assert.equal(sprites['in_a#cast'], undefined)
  assert.equal(warns.length, 1)
})
