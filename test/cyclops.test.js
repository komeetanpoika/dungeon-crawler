import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeCyclops, updateCyclops } from '../renderer/systems/cyclops.js'
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

function makeState(cyclops, player) {
  return { player, map: openMap(), projectiles: [], entities: [cyclops], log: [] }
}

describe('makeCyclops', () => {
  it('has correct initial fields', () => {
    const c = makeCyclops(5, 5)
    assert.equal(c.type, 'cyclops')
    assert.equal(c.hp, 30)
    assert.equal(c.maxHp, 30)
    assert.equal(c.state, 'chase')
    assert.equal(c.chargeCooldown, 0)
    assert.equal(c.slamRing, null)
    assert.equal(typeof c.slamTimer, 'number')
    assert.ok(c.slamTimer > 0)
  })
})

describe('updateCyclops — state transitions', () => {
  it('enters charge_windup when player within 200px with LOS and chargeCooldown is 0', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.slamTimer = 99
    const player = { x: 7, y: 5, px: 7 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.016)
    assert.equal(c.state, 'charge_windup')
  })

  it('transitions from charge_windup to charging when stateTimer expires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.state = 'charge_windup'
    c.stateTimer = 0.01
    const player = { x: 7, y: 5, px: 7 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'charging')
    assert.ok(c.chargeAngle !== undefined)
  })

  it('resets chargeCooldown to 8 and returns to chase when stunned timer expires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.state = 'stunned'
    c.stateTimer = 0.01
    c.chargeCooldown = 0
    const player = { x: 12, y: 5, px: 12 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'chase')
    assert.equal(c.chargeCooldown, 8)
  })

  it('enters slam_windup when slamTimer expires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.slamTimer = 0.01
    c.chargeCooldown = 99  // prevent charge from winning
    const player = { x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'slam_windup')
  })

  it('creates slamRing and damages player in range when slam fires', () => {
    const c = makeCyclops(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.state = 'slam_windup'
    c.stateTimer = 0.01
    const player = { x: 6, y: 5, px: 6 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    updateCyclops(c, state, 0.02)
    assert.equal(c.state, 'slamming')
    assert.ok(c.slamRing !== null)
    assert.ok(state.player.hp < 10)
  })
})
