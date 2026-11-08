import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { capsuleToScreen } from '../tools/monster-bench/overlay.js'

describe('capsuleToScreen', () => {
  it('shifts both ends by the camera and keeps the radius', () => {
    assert.deepEqual(capsuleToScreen({ ax: 100, ay: 50, bx: 120, by: 50, r: 8 }, 40, 10),
                     { ax: 60, ay: 40, bx: 80, by: 40, r: 8 })
  })
})
