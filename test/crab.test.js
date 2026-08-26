import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeCrab, updateCrab } from '../renderer/systems/crab.js'
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
    assert.equal(c.hp, 6)
    assert.equal(c.maxHp, 6)
    assert.equal(c.grabState, null)
    assert.equal(c.grabCooldown, 0)
    assert.equal(typeof c.facing, 'number')
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

describe('updateCrab — strafing movement', () => {
  it('orbits the player with LOS: distance stays roughly stable (allowing inward drift) while its angle around the player changes', () => {
    const c = makeCrab(5, 5)
    c.px = 5 * S + 16; c.py = 5 * S + 16
    c.grabCooldown = 99  // stay out of grab range so strafing isn't interrupted
    const player = { x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(c, player)
    const startDist = Math.hypot(c.px - player.px, c.py - player.py)
    const startAngle = Math.atan2(c.py - player.py, c.px - player.px)
    for (let i = 0; i < 60; i++) updateCrab(c, state, 1 / 60)
    const endDist = Math.hypot(c.px - player.px, c.py - player.py)
    const endAngle = Math.atan2(c.py - player.py, c.px - player.px)
    assert.ok(endDist > startDist * 0.5 && endDist < startDist * 1.1,
      `distance should stay roughly stable (inward drift allowed), start=${startDist} end=${endDist}`)
    let angleDelta = Math.abs(endAngle - startAngle)
    if (angleDelta > Math.PI) angleDelta = 2 * Math.PI - angleDelta
    assert.ok(angleDelta > 0.15,
      `crab should orbit sideways around the player, angleDelta=${angleDelta}`)
  })
})

describe('updateCrab — contact melee via weapon framework', () => {
  it('pincer hit damages the player and starts a swing animation', () => {
    const e = makeCrab(5, 5)
    e.px = 5 * 32 + 16; e.py = 5 * 32 + 16
    e.grabCooldown = 99   // keep the grab from triggering first
    const player = { x: 5, y: 5, px: e.px + 10, py: e.py, hp: 10, grabbed: false }
    const state = { player, map: openMap(), projectiles: [], entities: [e], log: [] }
    updateCrab(e, state, 0.016)
    assert.equal(player.hp, 9, 'pincer deals 1')
    assert.equal(e.attack.weaponId, 'pincer')
    assert.equal(e.attack.phase, 'swing')
    assert.deepEqual(state.log, ['Crab pinches! (-1 HP)'])
  })
})
