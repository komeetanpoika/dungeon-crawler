import test from 'node:test'
import assert from 'node:assert/strict'
import { segment } from '../tools/monster-cutter/segment.js'
import { validateCut, ROLES } from '../tools/monster-cutter/cut-format.js'
import { encodeMask } from '../tools/monster-cutter/mask.js'

const W = 100, H = 100
function rect(mask, x, y, w, h) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) mask[j * W + i] = 1
}
// torso x30..69 y20..79; arm x20..29 y25..64 (touches the torso at x=30)
function figure({ orb = false } = {}) {
  const m = new Uint8Array(W * H)
  rect(m, 30, 20, 40, 60)
  rect(m, 20, 25, 10, 40)
  if (orb) rect(m, 40, 10, 5, 5)
  return m
}
const torso = { id: 'torso', role: 'torso', side: null, parent: null, seed: [50, 50], cut: null, pivot: [50, 50], z: 0, claims: [] }
const arm = (over = {}) => ({ id: 'arm', role: 'arm', side: 'left', parent: 'torso', seed: [22, 40], cut: [[30, 22], [30, 68]], pivot: [29, 40], z: 1, claims: [], ...over })
const count = (a, v) => a.reduce((n, x) => n + (x === v ? 1 : 0), 0)

test('an arm cut off at the shoulder owns exactly the protrusion', () => {
  const r = segment(figure(), W, H, [torso, arm()])
  assert.equal(count(r.owner, 1), 10 * 40)
  assert.deepEqual(r.leaks, [])
  assert.equal(r.owner[0], -1)
})

test('a nested forearm takes its part of the arm', () => {
  const fore = { id: 'fore', role: 'extra', side: null, parent: 'arm', seed: [24, 55], cut: [[19, 45], [30, 45]], pivot: [24, 45], z: 2, claims: [] }
  const r = segment(figure(), W, H, [torso, arm(), fore])
  assert.deepEqual(r.leaks, [])
  assert.equal(count(r.owner, 2), 10 * 19)
  assert.equal(count(r.owner, 1), 10 * 21)
  assert.equal(r.owner[45 * W + 24], 1)
})

test('a forearm split that puts the arm seed (at the hand) inside the forearm is no leak', () => {
  const fore = { id: 'fore', role: 'extra', side: null, parent: 'arm', seed: [24, 55], cut: [[19, 45], [30, 45]], pivot: [24, 45], z: 2, claims: [] }
  const r = segment(figure(), W, H, [torso, arm({ seed: [22, 60] }), fore])
  assert.deepEqual(r.leaks, [])
  assert.equal(count(r.owner, 2), 10 * 19)
})

test('a cut that stops inside the silhouette leaks and is reported', () => {
  const r = segment(figure(), W, H, [torso, arm({ cut: [[30, 22], [30, 30]] })])
  assert.deepEqual(r.leaks, ['arm'])
  assert.equal(count(r.owner, 1), 0)
  assert.equal(r.owner[40 * W + 22], 0)
})

test('a detached blob is a piece without a cut', () => {
  const orb = { id: 'orb', role: 'extra', side: null, parent: 'torso', seed: [42, 12], cut: null, pivot: [42, 12], z: 1, claims: [] }
  const r = segment(figure({ orb: true }), W, H, [torso, orb])
  assert.deepEqual(r.leaks, [])
  assert.equal(count(r.owner, 1), 25)
})

test('a detached orb hung on a cut-off arm owns exactly the orb, with no leak', () => {
  const orb = { id: 'orb', role: 'extra', side: null, parent: 'arm', seed: [42, 12], cut: null, pivot: [42, 12], z: 1, claims: [] }
  const r = segment(figure({ orb: true }), W, H, [torso, arm(), orb])
  assert.deepEqual(r.leaks, [])
  assert.equal(count(r.owner, 2), 25)
  assert.equal(r.owner[12 * W + 42], 2)
  assert.equal(count(r.owner, 1), 10 * 40)
})

test('a piece without a cut that is joined to the torso leaks', () => {
  const r = segment(figure(), W, H, [torso, arm({ cut: null })])
  assert.deepEqual(r.leaks, ['arm'])
  assert.equal(count(r.owner, 1), 0)
})

test('claims move pixels and keep base', () => {
  const a = arm({ claims: [{ x: 50, y: 40, r: 5 }] })
  const r = segment(figure(), W, H, [torso, a])
  const i = 40 * W + 50
  assert.equal(r.owner[i], 1)
  assert.equal(r.base[i], 0)
  assert.equal(r.owner[0], -1)
})

test('validateCut accepts a good cut and names each problem in a bad one', () => {
  const m = figure()
  const good = {
    version: 1, name: 'x', source: 's.png', credit: null, w: W, h: H, mask: encodeMask(m),
    view: 'front', faces: 'left', outHeight: 84, outline: '#000',
    pieces: [torso, arm()], points: { chest: { piece: 'torso', x: 1, y: 1 } },
  }
  assert.deepEqual(validateCut(good), [])
  assert.equal(ROLES.length, 7)
  const bad = JSON.parse(JSON.stringify(good))
  bad.pieces.push({ ...arm(), id: 'arm', parent: 'ghost', side: null })
  bad.pieces.push({ ...torso, id: 'torso2' })
  bad.points.hand = { piece: 'nowhere', x: 0, y: 0 }
  const errs = validateCut(bad)
  for (const s of ['duplicate piece id "arm"', 'piece "arm" has unknown parent "ghost"', 'exactly one root piece is required, found 2',
    'piece "arm" must have a side', 'point "hand" names unknown piece "nowhere"']) {
    assert.ok(errs.includes(s), `missing: ${s}\n${errs.join('\n')}`)
  }
})
