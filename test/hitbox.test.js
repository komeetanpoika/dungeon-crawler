import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { hitShape, pointHits, overlapsTiles, nearestPoint, SPRITE_SHAPES, PLAYER_SHAPE, FALLBACK_SHAPE }
  from '../renderer/systems/hitbox.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'

const T = 32
const at = (type, px, py, over = {}) => ({ type, px, py, hp: 5, ...over })

// A rig that knows its drawn extent: a capsule 20 px forward, 5 px back,
// 10 px wide, in the rig's own facing frame. And one that only knows a
// half-size, the way the lurker/sheet rigs report through hitHalf.
const CAPSULE_RIG = {
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
  hitShape: p => ({ r: 10 * p.size, front: 20 * p.size, back: 5 * p.size }),
}
const HALF_RIG = {
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
  hitHalf: () => 20,
}
const rigs = { caprig: CAPSULE_RIG, halfrig: HALF_RIG }

describe('hitShape', () => {
  before(() => registerMonsters(
    [{ name: 'capbeast', rig: 'caprig', stats: { hp: 10 } },
     { name: 'halfbeast', rig: 'halfrig', stats: { hp: 10 } }],
    { loadRig: async id => rigs[id], loadHooks: async () => {}, warn: () => {} }))
  after(() => clearMonsters())

  it('gives a one-tile sprite enemy a circle just inside its 32 px sprite', () => {
    const s = hitShape(at('guard', 100, 200))
    assert.deepEqual(s, { ax: 100, ay: 200, bx: 100, by: 200, r: SPRITE_SHAPES.guard.r })
    assert.ok(s.r > 8 && s.r <= 16)
  })

  it('gives the cyclops a circle sized to its 64 px sprite', () => {
    assert.ok(hitShape(at('cyclops', 0, 0)).r >= 24)
  })

  it('lifts the plain dragon up to its drawn body, not its feet', () => {
    const s = hitShape(at('dragon', 100, 200))
    assert.equal(s.ay, 200 + SPRITE_SHAPES.dragon.oy)
    assert.ok(SPRITE_SHAPES.dragon.oy < 0, 'the sprite hangs above the entity centre')
    assert.ok(s.r >= 30)
  })

  it('gives the player its own circle', () => {
    assert.equal(hitShape(at('player', 0, 0)).r, PLAYER_SHAPE.r)
  })

  it('falls back to the old 8 px point disc for anything it does not know', () => {
    assert.equal(hitShape({ px: 1, py: 2 }).r, FALLBACK_SHAPE.r)
    assert.equal(FALLBACK_SHAPE.r, 8)
  })

  it('orients a rig capsule along the monster pose facing', () => {
    const e = at('capbeast', 100, 100, { pose: { facing: Math.PI / 2 } })   // facing south
    const s = hitShape(e)
    assert.equal(s.r, 10)
    assert.deepEqual([Math.round(s.ax), Math.round(s.ay)], [100, 120], 'front end 20 px south')
    assert.deepEqual([Math.round(s.bx), Math.round(s.by)], [100, 95], 'back end 5 px north')
  })

  it('faces east when a registry monster has no pose yet', () => {
    const s = hitShape(at('capbeast', 100, 100))
    assert.deepEqual([Math.round(s.ax), Math.round(s.ay)], [120, 100])
  })

  it('uses the registered half-size as a circle for a rig without hitShape', () => {
    const s = hitShape(at('halfbeast', 50, 50))
    assert.deepEqual(s, { ax: 50, ay: 50, bx: 50, by: 50, r: 20 })
  })
})

describe('pointHits', () => {
  it('is true inside the shape, false outside, and pad widens it', () => {
    const e = at('guard', 100, 100)
    const r = SPRITE_SHAPES.guard.r
    assert.ok(pointHits(e, 100 + r - 1, 100))
    assert.ok(!pointHits(e, 100 + r + 3, 100))
    assert.ok(pointHits(e, 100 + r + 3, 100, 4), 'a fat projectile pads the test')
  })

  it('hits along a capsule body, not just at the centre', async () => {
    await registerMonsters([{ name: 'capbeast2', rig: 'caprig', stats: { hp: 10 } }],
      { loadRig: async id => rigs[id], loadHooks: async () => {}, warn: () => {} })
    try {
      const e = at('capbeast2', 100, 100)   // no pose: faces east, nose at 120, tail at 95
      assert.ok(pointHits(e, 128, 100), 'just inside the nose cap')
      assert.ok(pointHits(e, 86, 100), 'just inside the tail cap')
      assert.ok(!pointHits(e, 100, 112), 'beside the body, past its half-width')
      assert.ok(!pointHits(e, 132, 100), 'past the nose')
    } finally { clearMonsters() }
  })
})

describe('overlapsTiles', () => {
  const keys = tiles => new Set(tiles.map(([x, y]) => `${x},${y}`))

  it('is true when the body spills into a listed tile the centre is not on', () => {
    const cyclops = at('cyclops', 5 * T + 16, 5 * T + 16)   // centred on (5,5), r > 16
    assert.ok(overlapsTiles(cyclops, keys([[6, 5]])), 'east neighbour: body crosses the edge')
    assert.ok(overlapsTiles(cyclops, keys([[6, 6]])), 'diagonal neighbour: the corner is within r')
    assert.ok(!overlapsTiles(cyclops, keys([[7, 5]])), 'two tiles east: out of reach')
  })

  it('is always true for the tile the centre is on', () => {
    assert.ok(overlapsTiles({ px: 5 * T + 16, py: 5 * T + 16 }, keys([[5, 5]])))
  })

  it('is false for an empty set', () => {
    assert.ok(!overlapsTiles(at('guard', 16, 16), new Set()))
  })
})

describe('nearestPoint', () => {
  it('returns the rim point facing the probe from outside', () => {
    const e = at('guard', 100, 100)
    const r = SPRITE_SHAPES.guard.r
    const p = nearestPoint(e, 200, 100)
    assert.deepEqual([Math.round(p.x), Math.round(p.y)], [100 + r, 100])
  })

  it('returns the probe itself from inside', () => {
    assert.deepEqual(nearestPoint(at('guard', 100, 100), 103, 99), { x: 103, y: 99 })
  })
})
