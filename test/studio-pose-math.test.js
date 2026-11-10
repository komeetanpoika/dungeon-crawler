import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { posablePieces, jointGroups, dragValues } from '../tools/monster-studio/pose-math.js'

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
})
