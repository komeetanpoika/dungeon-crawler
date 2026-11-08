import test from 'node:test'
import assert from 'node:assert/strict'
import { findPieces } from '../tools/monster-cutter/finder.js'
import { segment } from '../tools/monster-cutter/segment.js'
import { validateCut } from '../tools/monster-cutter/cut-format.js'
import { encodeMask, decodeMask, autoMask, keepMain } from '../tools/monster-cutter/mask.js'
import { readPng } from '../tools/png-read.mjs'
import { readFileSync } from 'node:fs'

// A stick figure at 400x500 (times k): torso rectangle, head disc on top, two
// arms from the upper sides angled down, two legs from the bottom, a tail
// leaving the right side at mid-height and a separate 8 px orb above the head.
// joints: where each limb's axis crosses the torso outline.
function stickFigure(k = 1) {
  const w = 400 * k, h = 500 * k
  const mask = new Uint8Array(w * h)
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0 * k; y < y1 * k; y++) for (let x = x0 * k; x < x1 * k; x++) mask[y * w + x] = 1
  }
  const disc = (cx, cy, r) => {
    for (let y = Math.floor((cy - r) * k); y <= Math.ceil((cy + r) * k); y++) {
      for (let x = Math.floor((cx - r) * k); x <= Math.ceil((cx + r) * k); x++) {
        if ((x + 0.5 - cx * k) ** 2 + (y + 0.5 - cy * k) ** 2 <= (r * k) ** 2) mask[y * w + x] = 1
      }
    }
  }
  const capsule = ([ax, ay], [bx, by], r) => {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    for (let y = Math.floor((Math.min(ay, by) - r) * k); y <= Math.ceil((Math.max(ay, by) + r) * k); y++) {
      for (let x = Math.floor((Math.min(ax, bx) - r) * k); x <= Math.ceil((Math.max(ax, bx) + r) * k); x++) {
        const px = (x + 0.5) / k, py = (y + 0.5) / k
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        if ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= r * r) mask[y * w + x] = 1
      }
    }
  }
  rect(130, 140, 270, 360) // torso
  disc(200, 95, 50) // head, overlapping the torso top by 5 px
  capsule([150, 183], [50, 268], 12) // left arm
  capsule([250, 183], [350, 268], 12) // right arm
  rect(165, 355, 195, 480) // left leg
  rect(205, 355, 235, 480) // right leg
  capsule([262, 237], [360, 400], 9) // tail
  disc(200, 25, 4) // orb
  const joints = {
    head: [200, 140], arm_left: [130, 200], arm_right: [270, 200],
    leg_left: [180, 360], leg_right: [220, 360], tail: [270, 250],
  }
  for (const j of Object.values(joints)) { j[0] *= k; j[1] *= k }
  return { mask, w, h, joints, orb: [200 * k, 25 * k] }
}

function blob() {
  const w = 400, h = 400, mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (((x - 200) / 150) ** 2 + ((y - 200) / 110) ** 2 <= 1) mask[y * w + x] = 1
  }
  return { mask, w, h }
}

const wrap = (mask, w, h, pieces) => ({
  version: 1, name: 'x', source: 'x.png', credit: null, w, h, mask: encodeMask(mask),
  view: 'front', faces: 'left', outHeight: 84, outline: '#000000', pieces, points: {},
})

function figureHeight(mask, w, h) {
  let y0 = h, y1 = -1
  for (let i = 0; i < w * h; i++) if (mask[i]) { const y = Math.floor(i / w); if (y < y0) y0 = y; if (y > y1) y1 = y }
  return y1 - y0 + 1
}

const key = p => (p.side ? `${p.role}_${p.side}` : p.role)

test('finds one head, two arms (left and right), two legs, one tail and the orb as an extra', () => {
  const { mask, w, h, orb } = stickFigure()
  const pieces = findPieces(mask, w, h)
  assert.deepEqual(validateCut(wrap(mask, w, h, pieces)), [])
  const keys = pieces.map(key).sort()
  assert.deepEqual(keys, ['arm_left', 'arm_right', 'extra', 'head', 'leg_left', 'leg_right', 'tail', 'torso'])
  const extra = pieces.find(p => p.role === 'extra')
  assert.equal(extra.cut, null)
  assert.ok(Math.hypot(extra.seed[0] - orb[0], extra.seed[1] - orb[1]) <= 6, `orb seed at ${extra.seed}`)
  const z = Object.fromEntries(pieces.map(p => [key(p), p.z]))
  assert.equal(z.torso, 0)
  assert.equal(z.tail, -1)
  assert.equal(z.head, 1)
  assert.equal(z.arm_left, 1)
})

test('every proposed cut separates its piece', () => {
  const { mask, w, h } = stickFigure()
  const pieces = findPieces(mask, w, h)
  const { owner, leaks } = segment(mask, w, h, pieces)
  assert.deepEqual(leaks, [])
  pieces.forEach((p, i) => {
    let n = 0
    for (let j = 0; j < w * h; j++) if (owner[j] === i) n++
    assert.ok(n > 0, `piece ${p.id} owns no pixels`)
  })
})

test('pivots sit near the true joints', () => {
  const { mask, w, h, joints } = stickFigure()
  const tol = 0.06 * figureHeight(mask, w, h)
  const pieces = findPieces(mask, w, h)
  for (const [name, [jx, jy]] of Object.entries(joints)) {
    const p = pieces.find(q => key(q) === name)
    assert.ok(p, `no ${name}`)
    const d = Math.hypot(p.pivot[0] - jx, p.pivot[1] - jy)
    assert.ok(d <= tol, `${name} pivot ${p.pivot} is ${d.toFixed(1)} px from ${jx},${jy} (tolerance ${tol.toFixed(1)})`)
  }
})

test('never guesses a weapon', () => {
  const armed = stickFigure()
  // a long rod held up from the right hand looks most like a weapon
  for (let y = 150; y < 280; y++) for (let x = 352; x < 358; x++) armed.mask[y * armed.w + x] = 1
  for (const { mask, w, h } of [armed, stickFigure(), blob()]) {
    const pieces = findPieces(mask, w, h)
    assert.ok(pieces.length > 0)
    assert.ok(pieces.every(p => p.role !== 'weapon'), pieces.map(key).join(' '))
  }
})

test('a plain blob yields a torso only', () => {
  const { mask, w, h } = blob()
  const pieces = findPieces(mask, w, h)
  assert.equal(pieces.length, 1)
  assert.equal(pieces[0].role, 'torso')
  assert.equal(pieces[0].parent, null)
  assert.equal(pieces[0].cut, null)
  assert.deepEqual(validateCut(wrap(mask, w, h, pieces)), [])
  const [sx, sy] = pieces[0].seed
  assert.equal(mask[sy * w + sx], 1)
})

test('runs a 1600x1600 mask in under a second', () => {
  const { mask, w, h } = stickFigure(4) // 1600 wide; 2000 tall, so harder than 1600x1600
  const t0 = performance.now()
  const pieces = findPieces(mask, w, h)
  const ms = performance.now() - t0
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`)
  assert.equal(pieces.length, 8)
})

const ASSEMBLED = new URL('../tools/monster-cutter/fixtures/kenney/assembled/', import.meta.url)
const KENNEY = ['square', 'round', 'egg', 'pill', 'dome']

test('scores at least IoU 0.7 per limb and labels 4 of 5 Kenney assemblies right', t => {
  let labelled = 0
  const lows = []
  for (const name of KENNEY) {
    const { width: w, height: h, pixels } = readPng(new URL(`${name}.png`, ASSEMBLED))
    const truth = JSON.parse(readFileSync(new URL(`${name}.truth.json`, ASSEMBLED), 'utf8'))
    const mask = keepMain(autoMask({ w, h, rgba: pixels }), w, h, 30)
    const pieces = findPieces(mask, w, h)
    assert.deepEqual(validateCut(wrap(mask, w, h, pieces)), [], name)
    const { owner, leaks } = segment(mask, w, h, pieces)
    assert.deepEqual(leaks, [], name)
    const area = new Int32Array(pieces.length)
    for (let i = 0; i < w * h; i++) if (owner[i] >= 0) area[owner[i]]++
    let right = true
    const notes = []
    for (const limb of truth.pieces) {
      const tm = decodeMask(limb.mask, w * h)
      let tn = 0
      const inter = new Int32Array(pieces.length)
      for (let i = 0; i < w * h; i++) if (tm[i]) { tn++; if (owner[i] >= 0) inter[owner[i]]++ }
      let best = -1, iou = 0
      pieces.forEach((p, i) => { const u = inter[i] / (tn + area[i] - inter[i]); if (u > iou) { iou = u; best = i } })
      const got = best < 0 ? 'nothing' : key(pieces[best])
      if (got !== `${limb.role}_${limb.side}`) right = false
      if (iou < 0.7) lows.push(`${name} ${limb.role}_${limb.side}: IoU ${iou.toFixed(2)}`)
      notes.push(`${limb.role}_${limb.side} ${iou.toFixed(2)} as ${got}`)
    }
    if (right) labelled++
    t.diagnostic(`${name}: ${notes.join(', ')}; labels ${right ? 'right' : 'wrong'}`)
  }
  assert.deepEqual(lows, [])
  assert.ok(labelled >= 4, `labels right on ${labelled} of 5`)
})
