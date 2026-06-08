import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeDragonBoss, updateDragonBoss, pointInCone, BOSS_HP } from '../renderer/systems/dragonboss.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const T = 32
function openMap(w = 40, h = 40) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}
function mkPlayer(px, py) { return { type: 'player', x: Math.floor(px/T), y: Math.floor(py/T), px, py, hp: 30, maxHp: 30 } }
function mkState(boss, player) { return { player, map: openMap(), projectiles: [], entities: [boss], log: [] } }

describe('pointInCone', () => {
  it('true for a point inside the half-angle and within length', () => {
    assert.equal(pointInCone(100, 0, 0, 0, 0, 0.4, 200), true)       // straight ahead (aim 0 = +x)
  })
  it('false beyond the length', () => {
    assert.equal(pointInCone(300, 0, 0, 0, 0, 0.4, 200), false)
  })
  it('false outside the half-angle', () => {
    assert.equal(pointInCone(0, 100, 0, 0, 0, 0.4, 200), false)      // 90° off-axis
  })
  it('respects a rotated aim', () => {
    assert.equal(pointInCone(0, 100, 0, 0, Math.PI/2, 0.4, 200), true) // aim points +y
  })
})

describe('makeDragonBoss', () => {
  it('has correct initial fields', () => {
    const e = makeDragonBoss(10, 8)
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.hp, BOSS_HP); assert.equal(e.maxHp, BOSS_HP)
    assert.equal(e.state, 'idle')
    assert.equal(e.anchorX, 10); assert.equal(e.anchorY, 8)
    assert.equal(e.tailSwing, 0); assert.equal(e.neckRear, 0)
  })
})

describe('updateDragonBoss facing', () => {
  it('eases facing toward the player over time', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    const player = mkPlayer(10*T, 16*T)           // due south => target angle +PI/2
    const state = mkState(e, player)
    for (let i = 0; i < 60; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(Math.abs(e.facing - Math.PI/2) < 0.2, `facing should approach +PI/2, got ${e.facing}`)
  })
})

describe('updateDragonBoss contact damage', () => {
  it('damages the player on body contact, respecting cooldown', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T
    const player = mkPlayer(10*T + 8, 10*T)       // overlapping the body
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    const after = player.hp
    assert.ok(after < 30, 'contact should deal damage')
    updateDragonBoss(e, state, 1/60)              // still on cooldown
    assert.equal(player.hp, after, 'no second hit while damageCooldown active')
  })
})
