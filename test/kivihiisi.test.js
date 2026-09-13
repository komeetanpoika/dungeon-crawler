import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ensureKivihiisi, tickClad, CLAD_MAX, RECLAD_EVERY } from '../renderer/systems/monsters/kivihiisi.js'
import { CREATURE_HIT, hurtCreature } from '../renderer/systems/creatures.js'
import { applyFreeze } from '../renderer/systems/status.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const mk = () => ({ type: 'kivihiisi', x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 40, maxHp: 40, damage: 3 })
const mkState = e => ({ entities: [e], feedback: makeFeedback(), sfx: makeSfx(), player: { x: 4, y: 5, px: 4 * S + 16, py: 5 * S + 16, hp: 10 } })

describe('lazy init', () => {
  it('stamps full cladding capped by the standing stones, and does not arm it', () => {
    const e = ensureKivihiisi(mk(), 6)
    assert.equal(e.clad, CLAD_MAX)
    assert.equal('weaponId' in e, false, 'the weapon is the def\'s (behavior.weapon), not the hook\'s')
    const two = ensureKivihiisi(mk(), 2)
    assert.equal(two.clad, 2)
  })
  it('never re-stamps', () => {
    const e = ensureKivihiisi(mk(), 6)
    e.clad = 1
    ensureKivihiisi(e, 6)
    assert.equal(e.clad, 1)
  })
  it('registers its hit hook', () => { assert.equal(typeof CREATURE_HIT.kivihiisi, 'function') })
})

describe('cladding', () => {
  it('absorbs a hit and strips one layer while clad', () => {
    const e = ensureKivihiisi(mk(), 6)
    const r = hurtCreature(mkState(e), e, 9)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'wall-slam')
    assert.equal(e.hp, 40)
    assert.equal(e.clad, 2)
  })
  it('three hits strip it bare; the fourth lands', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e)
    for (let i = 0; i < 3; i++) hurtCreature(state, e, 5)
    assert.equal(e.clad, 0)
    const r = hurtCreature(state, e, 5)
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, 35)
  })
  it('a frozen Hiisi loses every layer on the next hit, which lands with the shatter bonus and thaws it', () => {
    const e = ensureKivihiisi(mk(), 6)
    applyFreeze(e, 2)
    const r = hurtCreature(mkState(e), e, 5)
    assert.equal(r.absorbed, false)
    assert.equal(e.clad, 0)
    assert.equal(e.hp, 40 - 5 - 2)
    assert.equal(e.frozen, false)
  })
  it('a killing blow records the kill', () => {
    const e = ensureKivihiisi(mk(), 0)
    const state = mkState(e)
    const r = hurtCreature(state, e, 99)
    assert.equal(r.killed, true)
    assert.equal(state.creatureKills.kivihiisi, true)
  })
})

describe('re-clad', () => {
  it('adds one layer every RECLAD_EVERY seconds, never above the standing stones', () => {
    const e = ensureKivihiisi(mk(), 6)
    e.clad = 0
    assert.equal(tickClad(e, RECLAD_EVERY - 0.1, 6), false)
    assert.equal(e.clad, 0)
    assert.equal(tickClad(e, 0.2, 6), true)
    assert.equal(e.clad, 1)
    for (let t = 0; t < RECLAD_EVERY * 5; t += 0.5) tickClad(e, 0.5, 2)
    assert.equal(e.clad, 2, 'capped by two standing stones')
  })
  it('zero stones means no cladding at all, and strips any it still wears', () => {
    const e = ensureKivihiisi(mk(), 6)
    tickClad(e, 0.1, 0)
    assert.equal(e.clad, 0)
    for (let t = 0; t < RECLAD_EVERY * 3; t += 0.5) tickClad(e, 0.5, 0)
    assert.equal(e.clad, 0)
  })
})
