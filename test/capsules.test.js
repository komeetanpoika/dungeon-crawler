import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pointInCapsule, dragonCapsules, hitPart, PART_MODIFIER } from '../renderer/systems/capsules.js'

describe('pointInCapsule', () => {
  it('true at a point on the segment', () => {
    assert.equal(pointInCapsule(5, 0, 0, 0, 10, 0, 2), true)
  })
  it('true within radius perpendicular to the segment', () => {
    assert.equal(pointInCapsule(5, 1.5, 0, 0, 10, 0, 2), true)
  })
  it('false beyond the radius perpendicular to the segment', () => {
    assert.equal(pointInCapsule(5, 3, 0, 0, 10, 0, 2), false)
  })
  it('true within radius past the endpoint (rounded cap)', () => {
    assert.equal(pointInCapsule(11, 0, 0, 0, 10, 0, 2), true)
  })
  it('false past the endpoint beyond the radius', () => {
    assert.equal(pointInCapsule(13, 0, 0, 0, 10, 0, 2), false)
  })
  it('handles a zero-length segment as a circle', () => {
    assert.equal(pointInCapsule(1, 1, 5, 5, 5, 5, 6), true)
    assert.equal(pointInCapsule(20, 20, 5, 5, 5, 5, 6), false)
  })
})

function mkBoss(px, py, facing = 0) {
  return { px, py, facing, neckRear: 0, headAim: 0, tailSwing: 0 }
}

describe('dragonCapsules', () => {
  it('returns the three named parts', () => {
    const parts = dragonCapsules(mkBoss(320, 320, 0)).map(c => c.part)
    assert.deepEqual(parts.sort(), ['core', 'neck', 'tail'])
  })
  it('facing 0 (head toward +x) puts the neck capsule ahead in +x', () => {
    // facing 0 means the head points along +x in world space.
    const neck = dragonCapsules(mkBoss(320, 320, 0)).find(c => c.part === 'neck')
    // forward endpoint (the head tip) is the one furthest from the body centre
    const tip = Math.hypot(neck.ax - 320, neck.ay - 320) > Math.hypot(neck.bx - 320, neck.by - 320)
      ? { x: neck.ax, y: neck.ay } : { x: neck.bx, y: neck.by }
    assert.ok(tip.x > 320 + 32, `expected head tip ahead in +x, got ${tip.x}`)
    assert.ok(Math.abs(tip.y - 320) < 16, `expected head tip near centre y, got ${tip.y}`)
  })
  it('facing PI/2 (head toward +y) puts the neck tip below centre', () => {
    const neck = dragonCapsules(mkBoss(320, 320, Math.PI / 2)).find(c => c.part === 'neck')
    const tip = Math.hypot(neck.ax - 320, neck.ay - 320) > Math.hypot(neck.bx - 320, neck.by - 320)
      ? { x: neck.ax, y: neck.ay } : { x: neck.bx, y: neck.by }
    assert.ok(tip.y > 320 + 32, `expected head tip ahead in +y, got ${tip.y}`)
    assert.ok(Math.abs(tip.x - 320) < 16, `expected head tip near centre x, got ${tip.x}`)
  })
})

const BH = 4 * 32

describe('hitPart', () => {
  it('returns null for a far-away point', () => {
    assert.equal(hitPart(0, 0, mkBoss(320, 320, 0)), null)
  })
  it('returns core for a point at the body centre', () => {
    assert.equal(hitPart(320, 320, mkBoss(320, 320, 0)), 'core')
  })
  it('returns neck for a point at the head tip (facing 0 = +x)', () => {
    assert.equal(hitPart(320 + BH * 0.6, 320, mkBoss(320, 320, 0)), 'neck')
  })
  it('weak-spot wins: neck beats core where the capsules overlap', () => {
    // A point in the neck/core overlap zone resolves to neck (higher modifier).
    const boss = mkBoss(320, 320, 0)
    const caps = dragonCapsules(boss)
    const neck = caps.find(c => c.part === 'neck')
    // midpoint of the neck segment is inside both neck and (near) core
    const mx = (neck.ax + neck.bx) / 2, my = (neck.ay + neck.by) / 2
    assert.equal(hitPart(mx, my, boss), 'neck')
  })
})
