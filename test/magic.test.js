import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MANA_MAX, MANA_REGEN_TIME, GUST, tickMana, tryGust } from '../renderer/systems/magic.js'
import { toggleAttackMode } from '../renderer/systems/ranged.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const T = 32
const mkPlayer = () => ({
  px: 100, py: 100, facing: 'east', attackMode: 'magic',
  mana: MANA_MAX, manaRegenT: 0, magicCooldown: 0,
})
const mkState = (entities = []) => ({ player: mkPlayer(), entities, feedback: makeFeedback(), log: [] })
const guardAt = (dx, dy) => ({ type: 'guard', px: 100 + dx, py: 100 + dy, x: 0, y: 0, hp: 4, maxHp: 4 })

describe('stance cycle', () => {
  it('Shift walks melee -> ranged -> magic -> melee', () => {
    const p = { attackMode: 'melee' }
    assert.equal(toggleAttackMode(p), 'ranged')
    assert.equal(toggleAttackMode(p), 'magic')
    assert.equal(toggleAttackMode(p), 'melee')
  })
})

describe('mana', () => {
  it('recharges one charge per MANA_REGEN_TIME, capped at MANA_MAX', () => {
    const p = { mana: 1, manaRegenT: 0 }
    tickMana(p, MANA_REGEN_TIME - 0.1)
    assert.equal(p.mana, 1)
    tickMana(p, 0.2)
    assert.equal(p.mana, 2)
    tickMana(p, MANA_REGEN_TIME * 10)
    assert.equal(p.mana, MANA_MAX)
  })

  it('a full pool does not bank regen time', () => {
    const p = { mana: MANA_MAX, manaRegenT: 0 }
    tickMana(p, 100)
    assert.equal(p.manaRegenT, 0)
  })
})

describe('tryGust', () => {
  it('spends one mana, starts the cooldown, and reports ok', () => {
    const state = mkState([])
    const r = tryGust(state)
    assert.equal(r.ok, true)
    assert.equal(state.player.mana, MANA_MAX - 1)
    assert.equal(state.player.magicCooldown, GUST.cooldown)
  })

  it('four casts in a row empty the pool; the fifth refuses for mana', () => {
    const state = mkState([])
    for (let i = 0; i < 4; i++) {
      state.player.magicCooldown = 0
      assert.equal(tryGust(state).ok, true)
    }
    state.player.magicCooldown = 0
    assert.deepEqual(tryGust(state), { ok: false, reason: 'mana' })
  })

  it('refuses while the cooldown runs, without spending mana', () => {
    const state = mkState([])
    tryGust(state)
    const r = tryGust(state)
    assert.deepEqual(r, { ok: false, reason: 'cooldown' })
    assert.equal(state.player.mana, MANA_MAX - 1)
  })

  it('stuns and knocks back a regular enemy in the cone', () => {
    const g = guardAt(T * 1.5, 0)   // 1.5 tiles east, straight ahead
    const state = mkState([g])
    tryGust(state)
    assert.equal(g.stunTimer, GUST.stun)
    assert.ok(g.knockback, 'gust shoves')
  })

  it('misses enemies behind the caster or out of reach', () => {
    const behind = guardAt(-T, 0)
    const far = guardAt(GUST.reach + 10, 0)
    const state = mkState([behind, far])
    tryGust(state)
    assert.equal(behind.stunTimer, undefined)
    assert.equal(far.stunTimer, undefined)
  })

  it('minibosses shrug the stun but still get shoved lightly', () => {
    const crab = { type: 'crab', isBoss: true, px: 100 + T, py: 100, x: 0, y: 0, hp: 20 }
    const state = mkState([crab])
    tryGust(state)
    assert.equal(crab.stunTimer, undefined)
    assert.ok(crab.knockback, 'still shoved')
  })

  it('the dragon boss ignores the wind entirely', () => {
    const boss = { type: 'dragon_boss', isBoss: true, px: 100 + T, py: 100, x: 0, y: 0, hp: 60 }
    const state = mkState([boss])
    tryGust(state)
    assert.equal(boss.stunTimer, undefined)
    assert.equal(boss.knockback, undefined)
  })
})
