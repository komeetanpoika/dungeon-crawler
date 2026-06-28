import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drawTile, isFlickerVisible } from '../renderer/render/canvas.js'
import { TILE } from '../renderer/systems/entities.js'

// Minimal ctx that records drawImage calls by the sprite passed in.
function recordingCtx() {
  const calls = []
  return {
    calls,
    drawImage: (img) => calls.push(img),
    fillRect: () => {},
    set fillStyle(_v) {},
    get fillStyle() { return '' },
  }
}

const SPR = { floor: 'FLOOR', fl: 'SKIN_FL', br: 'OVERLAY_BR' }

describe('drawTile overlay', () => {
  it('draws the overlay on top of the skin', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { skin: 'fl', overlay: 'br' })
    assert.deepEqual(ctx.calls, ['SKIN_FL', 'OVERLAY_BR'])
  })

  it('draws the overlay on top of the default tile sprite (no skin)', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { overlay: 'br' })
    assert.deepEqual(ctx.calls, ['FLOOR', 'OVERLAY_BR'])
  })

  it('draws no overlay when none is set', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { skin: 'fl' })
    assert.deepEqual(ctx.calls, ['SKIN_FL'])
  })
})

describe('isFlickerVisible', () => {
  it('is always visible when not invulnerable', () => {
    assert.equal(isFlickerVisible(0), true)
    assert.equal(isFlickerVisible(undefined), true)
    assert.equal(isFlickerVisible(-1), true)
  })

  it('alternates on the interval boundary', () => {
    assert.equal(isFlickerVisible(0.04), true)   // bucket 0
    assert.equal(isFlickerVisible(0.10), false)  // bucket 1
    assert.equal(isFlickerVisible(0.20), true)   // bucket 2
  })
})
