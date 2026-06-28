import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startKnockback, stepKnockback } from '../renderer/systems/knockback.js'

const FREE = () => true

describe('startKnockback', () => {
  it('sets velocity along the normalized direction, scaled to distance', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 2, 0, 10)          // DRAG=25 -> v0 = 10*25 = 250
    assert.ok(e.knockback)
    assert.equal(Math.round(e.knockback.vx), 250)
    assert.equal(Math.round(e.knockback.vy), 0)
  })

  it('is a no-op for a zero direction', () => {
    const e = { px: 0, py: 0 }
    startKnockback(e, 0, 0, 10)
    assert.equal(e.knockback, undefined)
  })
})

describe('stepKnockback', () => {
  it('slides the entity approximately the requested distance with no walls', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 1, 0, 30)
    for (let i = 0; i < 2000 && e.knockback; i++) stepKnockback(e, 0.001, FREE)
    const travelled = e.px - 100
    assert.ok(travelled > 27 && travelled < 33, `travelled=${travelled}`)
    assert.equal(e.knockback, null)        // cleared once settled
  })

  it('stops at a wall on the blocked axis', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 1, 0, 50)
    // Wall: cannot move past x = 110
    const canMove = (px) => px <= 110
    for (let i = 0; i < 2000 && e.knockback; i++) stepKnockback(e, 0.001, canMove)
    assert.ok(e.px <= 110, `px=${e.px}`)
  })

  it('updates tile coords from pixel position', () => {
    const e = { px: 100, py: 100 }
    startKnockback(e, 1, 0, 30)
    stepKnockback(e, 0.05, FREE)
    assert.equal(e.x, Math.floor(e.px / 32))
    assert.equal(e.y, Math.floor(e.py / 32))
  })

  it('is a no-op when there is no knockback', () => {
    const e = { px: 5, py: 5 }
    stepKnockback(e, 0.1, FREE)            // must not throw
    assert.equal(e.px, 5)
  })
})
