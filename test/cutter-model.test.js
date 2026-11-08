import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCut } from '../tools/monster-cutter/cut-format.js'
import { segment } from '../tools/monster-cutter/segment.js'
import {
  newCut, moveCutEnd, movePivot, moveSeed, setRole, splitPiece, mergePiece, setZ,
  addClaim, clearClaims, setPoint, removePoint, setView, setFaces, fitSize,
  setMask, replacePieces, setOutHeight, setOutline, guessPoints, behindClaims,
} from '../tools/monster-cutter/cut-model.js'

const W = 60, H = 60

// A torso (20..40 x 15..50), an arm out to the left (8..20 x 18..40) holding
// a weapon (2..8 x 20..26), and a head on top (24..36 x 4..15).
function figure() {
  const mask = new Uint8Array(W * H)
  const rect = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1 }
  rect(20, 15, 40, 50); rect(8, 18, 20, 40); rect(2, 20, 8, 26); rect(24, 4, 36, 15)
  return mask
}

function baseCut() {
  const pieces = [
    { id: 'torso', role: 'torso', side: null, parent: null, seed: [30, 32], cut: null, pivot: [30, 32], z: 0, claims: [] },
    { id: 'arm', role: 'arm', side: 'left', parent: 'torso', seed: [12, 30], cut: [[20, 16], [20, 41]], pivot: [20, 28], z: 1, claims: [{ x: 21, y: 30, r: 1 }] },
    { id: 'weapon', role: 'weapon', side: null, parent: 'arm', seed: [4, 22], cut: [[8, 19], [8, 27]], pivot: [8, 23], z: 2, claims: [] },
    { id: 'head', role: 'head', side: null, parent: 'torso', seed: [30, 8], cut: [[23, 15], [37, 15]], pivot: [30, 15], z: 1, claims: [] },
  ]
  let cut = newCut({ name: 't', w: W, h: H, mask: figure(), pieces })
  cut = setPoint(cut, 'grip', 'arm', [10, 30])
  cut = setPoint(cut, 'head', 'head', [30, 6])
  return cut
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

test('the base figure is a valid cut with no leaks', () => {
  const cut = baseCut()
  assert.deepEqual(validateCut(cut), [])
  const { leaks } = segment(figure(), W, H, cut.pieces)
  assert.deepEqual(leaks, [])
})

test('every operation returns a valid cut and leaves the input untouched', () => {
  const before = baseCut()
  const snapshot = structuredClone(before)
  const cut = deepFreeze(before)
  const torsoOnly = [{ id: 'torso', role: 'torso', side: null, parent: null, seed: [30, 32], cut: null, pivot: [30, 32], z: 0, claims: [] }]
  const ops = {
    moveCutEnd: () => moveCutEnd(cut, 'arm', 1, [21, 42]),
    movePivot: () => movePivot(cut, 'arm', [19, 30]),
    moveSeed: () => moveSeed(cut, 'arm', [11, 31]),
    setRoleTail: () => setRole(cut, 'arm', 'tail'),
    setRoleLeg: () => setRole(cut, 'weapon', 'leg', 'right'),
    splitPiece: () => splitPiece(cut, 'torso', [[19, 44], [41, 44]], [30, 47]).cut,
    mergePiece: () => mergePiece(cut, 'arm'),
    setZ: () => setZ(cut, 'arm', -1),
    addClaim: () => addClaim(cut, 'head', { x: 30, y: 16, r: 2 }),
    clearClaims: () => clearClaims(cut, 'arm'),
    setPoint: () => setPoint(cut, 'chest', 'torso', [30, 20]),
    movePoint: () => setPoint(cut, 'grip', 'weapon', [4, 22]),
    removePoint: () => removePoint(cut, 'grip'),
    setView: () => setView(cut, 'side'),
    setFaces: () => setFaces(cut, 'right'),
    setMask: () => setMask(cut, figure()),
    replacePieces: () => replacePieces(cut, torsoOnly),
    setOutHeight: () => setOutHeight(cut, 60),
    setOutline: () => setOutline(cut, '#203040'),
    clearOutline: () => setOutline(cut, null),
  }
  for (const [name, op] of Object.entries(ops)) {
    const out = op()
    assert.notEqual(out, cut, `${name} returned its input`)
    assert.deepEqual(validateCut(out), [], `${name} made an invalid cut`)
  }
  assert.deepEqual(before, snapshot)
})

test('mergePiece moves children and points to the parent', () => {
  const out = mergePiece(baseCut(), 'arm')
  assert.equal(out.pieces.find(p => p.id === 'arm'), undefined)
  assert.equal(out.pieces.find(p => p.id === 'weapon').parent, 'torso')
  assert.equal(out.points.grip.piece, 'torso')
  assert.equal(out.points.head.piece, 'head')
  assert.deepEqual(validateCut(out), [])
  assert.throws(() => mergePiece(baseCut(), 'torso'), /root/)
})

test('setRole to a role without a side clears side; to arm or leg requires one', () => {
  const cut = baseCut()
  const tail = setRole(cut, 'arm', 'tail')
  assert.equal(tail.pieces.find(p => p.id === 'arm').role, 'tail')
  assert.equal(tail.pieces.find(p => p.id === 'arm').side, null)
  assert.throws(() => setRole(cut, 'weapon', 'leg'), /side/)
  assert.throws(() => setRole(cut, 'weapon', 'arm', 'up'), /side/)
  const leg = setRole(cut, 'weapon', 'leg', 'left')
  assert.equal(leg.pieces.find(p => p.id === 'weapon').side, 'left')
  const flipped = setRole(cut, 'arm', 'arm', 'right')
  assert.equal(flipped.pieces.find(p => p.id === 'arm').side, 'right')
  // the root stays the torso, and only the root is
  assert.throws(() => setRole(cut, 'torso', 'head'), /torso/)
  assert.throws(() => setRole(cut, 'head', 'torso'), /torso/)
})

test('splitPiece adds an extra with the line as its cut and its midpoint as the pivot', () => {
  const { cut, id } = splitPiece(baseCut(), 'torso', [[19, 44], [41, 45]], [30, 47])
  assert.equal(id, 'extra_1')
  const p = cut.pieces.find(q => q.id === id)
  assert.deepEqual(p, { id: 'extra_1', role: 'extra', side: null, parent: 'torso', seed: [30, 47],
    cut: [[19, 44], [41, 45]], pivot: [30, 44.5], z: 1, claims: [] })
  assert.deepEqual(validateCut(cut), [])
  assert.deepEqual(segment(figure(), W, H, cut.pieces).leaks, [])
  assert.equal(splitPiece(cut, 'torso', [[19, 20], [41, 20]], [30, 18]).id, 'extra_2')
})

test('cut ends and seeds snap to whole pixels (the flood walks integer lines)', () => {
  const cut = moveSeed(moveCutEnd(baseCut(), 'arm', 0, [20.4, 15.6]), 'arm', [11.7, 30.2])
  const arm = cut.pieces.find(p => p.id === 'arm')
  assert.deepEqual(arm.cut[0], [20, 16])
  assert.deepEqual(arm.seed, [12, 30])
  assert.throws(() => moveCutEnd(baseCut(), 'torso', 0, [1, 1]), /no cut/)
})

test('replacePieces hands points on vanished pieces to the root', () => {
  const torsoOnly = [{ id: 'torso', role: 'torso', side: null, parent: null, seed: [30, 32], cut: null, pivot: [30, 32], z: 0, claims: [] }]
  const out = replacePieces(baseCut(), torsoOnly)
  assert.equal(out.points.grip.piece, 'torso')
  assert.equal(out.points.head.piece, 'torso')
})

test('setPoint refuses an unknown piece or a bad name', () => {
  assert.throws(() => setPoint(baseCut(), 'head', 'nope', [1, 1]), /unknown piece/)
  assert.throws(() => setPoint(baseCut(), 'Head!', 'torso', [1, 1]), /name/)
})

test('guessPoints puts head on the head piece and chest on the torso', () => {
  const cut = baseCut()
  const mask = figure()
  const { owner } = segment(mask, W, H, cut.pieces)
  const pts = guessPoints(mask, W, H, cut.pieces, owner)
  assert.equal(pts.head.piece, 'head')
  assert.equal(pts.chest.piece, 'torso')
  assert.ok(pts.head.y >= 4 && pts.head.y < 15)
  assert.ok(pts.chest.y >= 15 && pts.chest.y < 50)
})

test('behindClaims flags a claim by a piece drawn behind the piece it takes from', () => {
  // the head claims torso pixels: fine at z 1 over the torso's 0, flagged at z -1
  const front = addClaim(baseCut(), 'head', { x: 30, y: 18, r: 2 })
  const { base } = segment(figure(), W, H, front.pieces)
  assert.deepEqual(behindClaims(front, base), [])
  const behind = setZ(front, 'head', -1)
  assert.deepEqual(behindClaims(behind, base), [{ id: 'head', over: 'torso' }])
})

test('fitSize shrinks a 4000x3000 photo to 2048 on the long side and leaves small images alone', () => {
  assert.deepEqual(fitSize(4000, 3000), { w: 2048, h: 1536, scale: 0.512 })
  assert.deepEqual(fitSize(300, 200), { w: 300, h: 200, scale: 1 })
  assert.deepEqual(fitSize(2048, 100), { w: 2048, h: 100, scale: 1 })
  const tall = fitSize(1000, 5000)
  assert.equal(tall.h, 2048)
  assert.equal(tall.w, 410)
  assert.deepEqual(fitSize(400, 100, 200), { w: 200, h: 50, scale: 0.5 })
})
