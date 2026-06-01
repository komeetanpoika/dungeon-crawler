import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeCrab, updateCrab, deflects } from '../renderer/systems/crab.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const S = 32

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(crab, player) {
  return { player, map: openMap(), projectiles: [], entities: [crab], log: [] }
}

describe('makeCrab', () => {
  it('has correct initial fields', () => {
    const c = makeCrab(5, 5)
    assert.equal(c.type, 'crab')
    assert.equal(c.hp, 20)
    assert.equal(c.maxHp, 20)
    assert.equal(c.grabState, null)
    assert.equal(c.grabCooldown, 0)
    assert.equal(typeof c.facing, 'number')
    assert.ok(c.strafeDir === 1 || c.strafeDir === -1)
  })
})

describe('deflects', () => {
  it('deflects a projectile coming from the front (within 60°)', () => {
    const c = makeCrab(5, 5)
    c.facing = 0  // facing east (toward player at east)
    // Player shoots westward (dx < 0) — hitting crab from the east side (front)
    const p = { dx: -200, dy: 0 }
    assert.equal(deflects(c, p), true)
  })

  it('does not deflect a projectile from the side', () => {
    const c = makeCrab(5, 5)
    c.facing = 0  // facing east
    // Projectile going northward — hits crab from south (side)
    const p = { dx: 0, dy: -200 }
    assert.equal(deflects(c, p), false)
  })

  it('does not deflect a projectile from behind', () => {
    const c = makeCrab(5, 5)
    c.facing = 0  // facing east
    // Projectile going eastward — hits crab from west (behind)
    const p = { dx: 200, dy: 0 }
    assert.equal(deflects(c, p), false)
  })
})

describe('updateCrab — grab', () => {
  it('enters grabbing state and sets player.grabbed when within grab range', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabCooldown = 0
    // Player very close
    const player = { x: 5, y: 5, px: 5 * S + 30, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCrab(c, state, 0.016)
    assert.equal(c.grabState, 'grabbing')
    assert.equal(state.player.grabbed, true)
  })

  it('releases player after grab duration expires', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabState = 'grabbing'
    c.grabTimer = 0.01
    c.grabDamageTimer = 99
    const player = { x: 5, y: 5, px: 5 * S + 20, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCrab(c, state, 0.02)
    assert.equal(c.grabState, null)
    assert.ok(c.grabCooldown > 0)
  })

  it('does not grab again while grabCooldown > 0', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabCooldown = 5
    const player = { x: 5, y: 5, px: 5 * S + 20, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCrab(c, state, 0.016)
    assert.equal(c.grabState, null)
  })
})
