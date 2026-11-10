import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { posablePieces, jointGroups, dragValues, startGrab, grabPoint, DEAD_ZONE } from '../tools/monster-studio/pose-math.js'

const piece = (id, parent, pivot, rect = [0, 0, 4, 4]) => ({ id, role: 'arm', parent, pivot, rect, at: [0, 0] })
const PARTS = { pieces: [
  piece('torso', null, [10, 10]), piece('hammer', 'torso', [5, 5]), piece('hammer_butt', 'torso', [5, 5]),
  piece('arm', 'torso', [15, 5]), piece('empty', 'torso', [1, 1], [0, 0, 0, 4]),
] }

describe('pose-math', () => {
  it('posable pieces skip empty ones; shared joints group', () => {
    assert.deepEqual(posablePieces(PARTS), ['torso', 'hammer', 'hammer_butt', 'arm'])
    const g = jointGroups(PARTS)
    assert.deepEqual(g.get('hammer'), ['hammer', 'hammer_butt'])
    assert.deepEqual(g.get('hammer_butt'), ['hammer', 'hammer_butt'])
    assert.deepEqual(g.get('arm'), ['arm'])
    assert.equal(g.has('empty'), false)
  })
  it('drag turns clockwise and stretches by distance', () => {
    const joint = { x: 0, y: 0 }, restEnd = { x: 10, y: 0 }
    const down = dragValues({ joint, restEnd, mouse: { x: 0, y: 20 } })
    assert.ok(Math.abs(down.turn - 90) < 1e-9); assert.ok(Math.abs(down.stretch - 2) < 1e-9)
    const short = dragValues({ joint, restEnd, mouse: { x: 1, y: 0 } })
    assert.ok(Math.abs(short.turn) < 1e-9); assert.equal(short.stretch, 0.5)
    assert.equal(dragValues({ joint, restEnd: joint, mouse: { x: 3, y: 4 } }).stretch, 1)
  })
  it('turning keeps counting past 180 instead of jumping', () => {
    const joint = { x: 0, y: 0 }, restEnd = { x: 10, y: 0 }
    const a = Math.PI * 190 / 180, mouse = { x: 10 * Math.cos(a), y: 10 * Math.sin(a) }
    assert.ok(Math.abs(dragValues({ joint, restEnd, mouse, prevTurn: 175 }).turn - 190) < 1e-9)
    assert.ok(Math.abs(dragValues({ joint, restEnd, mouse, prevTurn: -175 }).turn - -170) < 1e-9)
    assert.equal(dragValues({ joint, restEnd, mouse: { x: 10, y: 0 }, prevTurn: 359 }).turn, 360)
  })
  it('a grab moves the dot by the pointer\'s travel, not onto the pointer, and a click moves nothing', () => {
    const joint = { x: 0, y: 0 }, tip = { x: 10, y: 0 }
    const press = { x: 10, y: 14 }                                   // 14 px off the dot, inside the hit radius
    const grab = startGrab(tip, press)
    assert.equal(grabPoint(grab, press), null)                       // pressed, not moved
    assert.equal(grabPoint(grab, { x: 11, y: 15.5 }), null)          // hand jitter inside the dead zone
    assert.ok(DEAD_ZONE >= 2 && DEAD_ZONE <= 4)
    const at = grabPoint(grab, { x: 10, y: 18 })                     // 4 px down: past the dead zone
    assert.deepEqual(at, { x: 10, y: 4 })                            // the dot, moved 4 px down
    const v = dragValues({ joint, restEnd: tip, mouse: at })
    assert.ok(Math.abs(v.turn - Math.atan2(4, 10) * 180 / Math.PI) < 1e-9)  // a small turn...
    const snap = dragValues({ joint, restEnd: tip, mouse: { x: 10, y: 18 } })
    assert.ok(snap.turn > 2 * v.turn && snap.stretch > 1.9)          // ...not the snap to the pointer
    grab.live = true                                                 // once dragging, the dead zone is gone
    assert.deepEqual(grabPoint(grab, { x: 10, y: 15 }), { x: 10, y: 1 })
  })
})
