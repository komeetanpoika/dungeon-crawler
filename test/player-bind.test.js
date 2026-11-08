import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { freezePlayer, grabPlayer, releasePlayer, struggle, tickBinds, playerBound, JOLT_TIME } from '../renderer/systems/player-bind.js'

const hero = (over = {}) => ({ px: 100, py: 100, hp: 10, ...over })
const beast = () => ({ type: 'monsteri', px: 120, py: 100, hp: 12 })

describe('frozen solid', () => {
  it('binds the hero until the ice thaws', () => {
    const p = hero()
    freezePlayer(p, 1.5)
    assert.equal(playerBound(p), true)
    tickBinds(p, 1.4)
    assert.equal(playerBound(p), true)
    tickBinds(p, 0.2)
    assert.equal(p.ice, null)
    assert.equal(playerBound(p), false)
  })

  it('never shortens ice already on the hero', () => {
    const p = hero()
    freezePlayer(p, 2); freezePlayer(p, 1)
    assert.equal(p.ice.t, 2)
  })

  it('drops a charge in progress', () => {
    const p = hero({ charging: { kind: 'melee', t: 0.4 } })
    freezePlayer(p, 1)
    assert.equal(p.charging, null)
  })
})

describe('held', () => {
  it('a grab breaks the ice and holds the hero', () => {
    const p = hero(), by = beast()
    freezePlayer(p, 1)
    grabPlayer(p, by)
    assert.equal(p.ice, null)
    assert.equal(p.held.by, by)
    assert.equal(p.held.presses, 0)
    assert.equal(playerBound(p), true)
  })

  it('stops a knockback in flight so the grip holds', () => {
    const p = hero({ knockback: { vx: 100, vy: 0 } })
    grabPlayer(p, beast())
    assert.equal(p.knockback, null)
  })

  it('counts key presses only while held', () => {
    const p = hero()
    assert.equal(struggle(p), false)
    grabPlayer(p, beast())
    assert.equal(struggle(p), true)
    struggle(p)
    assert.equal(p.held.presses, 2)
  })

  it('jolts the hero side to side on each press, and the jolt settles', () => {
    const p = hero()
    grabPlayer(p, beast())
    struggle(p)
    const side = p.held.side
    assert.equal(p.held.jolt, 1)
    struggle(p)
    assert.equal(p.held.side, -side)
    tickBinds(p, JOLT_TIME)
    assert.equal(p.held.jolt, 0)
  })

  it('release hands back the holder and frees the hero', () => {
    const p = hero(), by = beast()
    grabPlayer(p, by)
    assert.equal(releasePlayer(p), by)
    assert.equal(p.held, null)
    assert.equal(playerBound(p), false)
  })

  it('lets go when the holder dies', () => {
    const p = hero(), by = beast()
    grabPlayer(p, by)
    by.hp = 0
    tickBinds(p, 1 / 60, [by])
    assert.equal(p.held, null)
  })

  it('lets go when the holder is gone from the level', () => {
    const p = hero(), by = beast()
    grabPlayer(p, by)
    tickBinds(p, 1 / 60, [])
    assert.equal(p.held, null)
  })
})
