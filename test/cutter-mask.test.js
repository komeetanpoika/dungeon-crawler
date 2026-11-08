import test from 'node:test'
import assert from 'node:assert/strict'
import { components, distanceTransform, supercoverLine } from '../tools/monster-cutter/raster.js'
import { autoMask, applyStrokes, keepMain, encodeMask, decodeMask } from '../tools/monster-cutter/mask.js'
import * as lib from '../tools/sprite-sheet-lib.mjs'

function img(w, h, fn) {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(fn(x, y), (y * w + x) * 4)
  return { w, h, rgba }
}
const rect = (m, w, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1 }
const count = m => m.reduce((a, b) => a + b, 0)

test('distanceTransform: the centre of a 21x21 square is ~11 from the edge', () => {
  const m = new Uint8Array(21 * 21).fill(1)
  const d = distanceTransform(m, 21, 21)
  assert.ok(Math.abs(d[10 * 21 + 10] - 11) <= 1)
  for (const i of [0, 20, 20 * 21, 20 * 21 + 20]) assert.equal(d[i], 1)
})

test('supercoverLine is 4-connected', () => {
  const l = supercoverLine([0, 0], [7, 3])
  assert.deepEqual(l[0], [0, 0]); assert.deepEqual(l[l.length - 1], [7, 3])
  for (let i = 1; i < l.length; i++) {
    const dx = Math.abs(l[i][0] - l[i - 1][0]), dy = Math.abs(l[i][1] - l[i - 1][1])
    assert.equal(dx + dy, 1)
  }
})

test('components labels two blobs and sizes them', () => {
  const w = 10, h = 5, m = new Uint8Array(w * h)
  rect(m, w, 0, 0, 2, 2); rect(m, w, 5, 1, 8, 4)
  const { label, sizes } = components(m, w, h)
  assert.deepEqual(sizes, [4, 9])
  assert.equal(label[0], 0); assert.equal(label[1 * w + 5], 1); assert.equal(label[4 * w + 9], -1)
})

test('autoMask uses real transparency when the image has it', () => {
  const m = autoMask(img(40, 40, (x, y) => x >= 10 && x < 20 && y >= 10 && y < 20 ? [9, 9, 9, 255] : [0, 0, 0, 0]))
  assert.equal(count(m), 100)
})

test('autoMask floods a flat background away', () => {
  const inR = (x, y) => x >= 20 && x < 40 && y >= 10 && y < 40
  const m = autoMask(img(80, 60, (x, y) => inR(x, y) ? [200, 20, 20, 255] : [255, 255, 255, 255]))
  for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) assert.equal(m[y * 80 + x], inR(x, y) ? 1 : 0)
})

test('autoMask floods a gradient background away', () => {
  const inB = (x, y) => x >= 30 && x < 50 && y >= 30 && y < 50
  const m = autoMask(img(80, 80, (x, y) => { const g = Math.round(200 + 40 * y / 79); return inB(x, y) ? [30, 30, 30, 255] : [g, g, g, 255] }))
  assert.ok(Math.abs(count(m) - 400) <= 400 * 0.02)
})

test('autoMask keeps a subject that touches the border', () => {
  const m = autoMask(img(80, 60, (x, y) => x < 30 && y >= 10 && y < 40 ? [200, 20, 20, 255] : [255, 255, 255, 255]))
  assert.ok(count(m) >= 0.95 * 30 * 30)
})

test('applyStrokes keeps and erases discs', () => {
  const w = 30, h = 30, m = new Uint8Array(w * h)
  const a = applyStrokes(m, w, h, [{ x: 10, y: 10, r: 5, keep: true }])
  assert.equal(count(m), 0)
  assert.equal(a[10 * w + 10], 1); assert.equal(a[10 * w + 16], 0)
  const b = applyStrokes(a, w, h, [{ x: 10, y: 10, r: 2, keep: false }])
  assert.equal(b[10 * w + 10], 0); assert.equal(b[10 * w + 14], 1)
})

test('keepMain drops far specks and keeps near ones', () => {
  const w = 300, h = 100, m = new Uint8Array(w * h)
  rect(m, w, 10, 10, 60, 60); rect(m, w, 65, 30, 68, 33); rect(m, w, 145, 30, 148, 33)
  const k = keepMain(m, w, h, 30)
  assert.equal(k[31 * w + 66], 1); assert.equal(k[20 * w + 20], 1); assert.equal(k[31 * w + 146], 0)
})

test('mask run-lengths round-trip', () => {
  for (const m of [Uint8Array.from([1, 1, 0, 0, 0, 1, 0, 1, 1]), Uint8Array.from([0, 0, 1]), new Uint8Array(5)]) {
    assert.deepEqual(decodeMask(encodeMask(m), m.length), m)
  }
})

test('sprite-sheet-lib still exports downsample', () => {
  assert.equal(typeof lib.downsample, 'function')
})
