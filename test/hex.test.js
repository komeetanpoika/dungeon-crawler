import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HEX, hexPlayer, isFrog, tickHex, frogSpeedMul, hasHands, clearHex } from '../renderer/systems/hex.js'
import { makePlayer } from '../renderer/systems/entities.js'

const hero = (over = {}) => ({ ...makePlayer(5, 5), px: 176, py: 176, facing: 'south', ...over })

describe('the frog hex', () => {
  it('its numbers', () => {
    assert.equal(HEX.speed, 0.85)
    assert.equal(HEX.ward, 3)
  })

  it('makes the hero a frog for its seconds: slower, and without hands', () => {
    const p = hero()
    assert.equal(isFrog(p), false)
    assert.equal(hasHands(p), true)
    assert.equal(frogSpeedMul(p), 1)
    assert.equal(hexPlayer(p, 4), true)
    assert.equal(isFrog(p), true)
    assert.equal(hasHands(p), false)
    assert.equal(frogSpeedMul(p), HEX.speed)
    for (let i = 0; i < 60 * 3; i++) tickHex(p, 1 / 60)
    assert.equal(isFrog(p), true)
    for (let i = 0; i < 61; i++) tickHex(p, 1 / 60)
    assert.equal(isFrog(p), false)
    assert.equal(hasHands(p), true)
    assert.equal(frogSpeedMul(p), 1)
  })

  it('drops a charge in progress, a raised shield, a stance switch under way and a swing in the air', () => {
    const p = hero({ charging: { t: 0.4, kind: 'spell' }, blocking: true, attackTimer: 0.1,
      stanceSwitch: { from: 'melee', to: 'magic', t: 0.1, dur: 0.4 } })
    assert.equal(hexPlayer(p, 4), true)
    assert.equal(p.charging, null)
    assert.equal(p.blocking, false)
    assert.equal(p.stanceSwitch, null)
    assert.equal(p.attackTimer, 0)
    assert.equal(p.attackMode, 'melee')   // the switch never landed
  })

  it('is followed by a ward: no hex takes for three seconds after one ends', () => {
    const p = hero()
    hexPlayer(p, 1)
    for (let i = 0; i < 61; i++) tickHex(p, 1 / 60)
    assert.equal(isFrog(p), false)
    assert.equal(hexPlayer(p, 4), false)
    assert.equal(isFrog(p), false)
    for (let i = 0; i < 60 * 2.5; i++) tickHex(p, 1 / 60)
    assert.equal(hexPlayer(p, 4), false)
    for (let i = 0; i < 60 * 0.6; i++) tickHex(p, 1 / 60)
    assert.equal(hexPlayer(p, 4), true)
  })

  it('the ward does not run while he is still a frog', () => {
    const p = hero()
    hexPlayer(p, 4)
    for (let i = 0; i < 60 * 3.9; i++) tickHex(p, 1 / 60)
    assert.equal(isFrog(p), true)
    for (let i = 0; i < 60 * 0.2; i++) tickHex(p, 1 / 60)
    assert.equal(isFrog(p), false)
    assert.equal(hexPlayer(p, 4), false, 'the whole ward is still ahead')
  })

  it('a new hex on a frog starts its time again', () => {
    const p = hero()
    hexPlayer(p, 4)
    for (let i = 0; i < 60 * 3; i++) tickHex(p, 1 / 60)
    assert.equal(hexPlayer(p, 4), true)
    for (let i = 0; i < 60 * 3; i++) tickHex(p, 1 / 60)
    assert.equal(isFrog(p), true)
  })

  it('does not take on a hero who is riding, frozen, held, in the stocks or dead, nor for no time', () => {
    for (const over of [{ riding: true }, { ice: { t: 1, dur: 1 } }, { held: { by: {}, presses: 0 } }, { stocks: { t: 5 } }, { hp: 0 }]) {
      const p = hero(over)
      assert.equal(hexPlayer(p, 4), false, JSON.stringify(Object.keys(over)))
      assert.equal(isFrog(p), false)
    }
    assert.equal(hexPlayer(hero(), 0), false)
  })

  it('ends with his death, leaving no ward; clearHex does the same', () => {
    const p = hero()
    hexPlayer(p, 4)
    p.hp = 0
    tickHex(p, 1 / 60)
    assert.equal(isFrog(p), false)
    p.hp = 10
    assert.equal(hexPlayer(p, 4), true)
    clearHex(p)
    assert.equal(isFrog(p), false)
    assert.equal(hexPlayer(p, 4), true)
  })

  it('a hero who was never hexed ticks without harm', () => {
    const p = hero()
    tickHex(p, 1 / 60)
    assert.equal(isFrog(p), false)
    assert.equal(isFrog(null), false)
  })
})
