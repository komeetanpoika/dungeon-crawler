import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GUST, GUST_CHARGE, GUST_TIERS, resolveGustTier, shouldAutoReleaseGust, tryGust, affordableGustTier } from '../renderer/systems/magic.js'
import { nextStance } from '../renderer/systems/ranged.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const T = 32
const mkPlayer = () => ({
  px: 100, py: 100, facing: 'east', attackMode: 'magic',
  stamina: 100, maxStamina: 100, staminaRegenT: 99, magicCooldown: 0,
  talents: ['magic_stance'],
})
const mkState = (entities = []) => ({ player: mkPlayer(), entities, feedback: makeFeedback(), log: [] })
const guardAt = (dx, dy) => ({ type: 'guard', px: 100 + dx, py: 100 + dy, x: 0, y: 0, hp: 4, maxHp: 4 })

describe('stance cycle', () => {
  it('magic is reachable in the cycle once learned', () => {
    const p = { attackMode: 'ranged', talents: ['ranged_stance', 'magic_stance'] }
    assert.equal(nextStance(p), 'magic')
  })

  it('skips magic when unlearned', () => {
    const p = { attackMode: 'ranged', talents: ['ranged_stance'] }
    assert.equal(nextStance(p), 'melee')
  })
})

describe('tryGust', () => {
  it('spends the tap cost, starts the cooldown, and reports ok', () => {
    const state = mkState([])
    const r = tryGust(state)
    assert.equal(r.ok, true)
    assert.equal(state.player.stamina, 100 - 14)
    assert.equal(state.player.magicCooldown, GUST.cooldown)
  })

  it('refuses while the cooldown runs, without spending stamina', () => {
    const state = mkState([])
    tryGust(state)
    const r = tryGust(state)
    assert.deepEqual(r, { ok: false, reason: 'cooldown' })
    assert.equal(state.player.stamina, 100 - 14)
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

  it('refuses without the magic_stance talent', () => {
    const state = mkState([])
    state.player.talents = []
    assert.deepEqual(tryGust(state), { ok: false, reason: 'not_learned' })
    assert.equal(state.player.stamina, 100)
  })
})

describe('gust charge tiers', () => {
  it('resolves hold time to tiers at 0.5/1.1s', () => {
    assert.equal(resolveGustTier(0.1), 'tap')
    assert.equal(resolveGustTier(0.5), 'full')
    assert.equal(resolveGustTier(1.1), 'over')
  })
  it('auto-releases 0.5s past over', () => {
    assert.equal(shouldAutoReleaseGust(1.55), false)   // threshold is 1.1 + 0.5 = 1.6, exclusive
    assert.equal(shouldAutoReleaseGust(1.7), true)
  })
  it('tiers scale cone, stun, and shove; only over slams', () => {
    assert.deepEqual(GUST_TIERS.tap,  { mul: 1,    stun: 1.0, knockback: 30, bossKnockback: 12, slam: false })
    assert.deepEqual(GUST_TIERS.full, { mul: 1.25, stun: 1.5, knockback: 45, bossKnockback: 18, slam: false })
    assert.deepEqual(GUST_TIERS.over, { mul: 1.5,  stun: 2.0, knockback: 70, bossKnockback: 28, slam: true })
  })
})

describe('tryGust with stamina', () => {
  const mkState = (playerOver = {}, entities = []) => {
    const player = { type: 'player', px: 100, py: 100, facing: 'east',
      talents: ['magic_stance'], magicCooldown: 0,
      stamina: 100, maxStamina: 100, staminaRegenT: 99, ...playerOver }
    return { player, entities: [player, ...entities] }
  }
  it('spends the tier cost on success', () => {
    const s = mkState()
    const r = tryGust(s, 'over')
    assert.equal(r.ok, true)
    assert.equal(s.player.stamina, 60)
  })
  it('refuses with reason stamina when the tank cannot cover the tier', () => {
    const s = mkState({ stamina: 13 })
    assert.deepEqual(tryGust(s, 'tap'), { ok: false, reason: 'stamina' })
    assert.equal(s.player.stamina, 13)
  })
  it('over-tier knocks a caught enemy back with a slam flag', () => {
    const enemy = { type: 'monster', hp: 3, px: 140, py: 100, x: 4, y: 3 }
    const s = mkState({}, [enemy])
    tryGust(s, 'over')
    assert.ok(enemy.knockback)
    assert.deepEqual(enemy.knockback.slam, { damage: 3 })
  })
  it('tap tier knocks back without a slam flag', () => {
    const enemy = { type: 'monster', hp: 3, px: 140, py: 100, x: 4, y: 3 }
    const s = mkState({}, [enemy])
    tryGust(s, 'tap')
    assert.ok(enemy.knockback)
    assert.equal(enemy.knockback.slam, undefined)
  })
  it('over tier reaches further than tap', () => {
    const enemy = { type: 'monster', hp: 3, px: 100 + 100, py: 100, x: 6, y: 3 }   // 100px out, past base 80 reach
    const tap = mkState({}, [{ ...enemy }])
    const over = mkState({}, [enemy])
    assert.equal(tryGust(tap, 'tap').caught, 0)
    assert.equal(tryGust(over, 'over').caught, 1)
  })
})

describe('affordableGustTier', () => {
  it('keeps the reached tier when the tank covers it', () => {
    assert.equal(affordableGustTier(100, 'over'), 'over')
    assert.equal(affordableGustTier(22, 'full'), 'full')
    assert.equal(affordableGustTier(14, 'tap'), 'tap')
  })
  it('degrades a held-to-over release to the highest affordable tier', () => {
    assert.equal(affordableGustTier(30, 'over'), 'full')   // 40 > 30 >= 22
    assert.equal(affordableGustTier(20, 'over'), 'tap')    // 40, 22 both > 20 >= 14
  })
  it('degrades a held-to-full release too', () => {
    assert.equal(affordableGustTier(20, 'full'), 'tap')
  })
  it('returns null when even tap is unaffordable, so the caller still refuses', () => {
    assert.equal(affordableGustTier(13, 'over'), null)
    assert.equal(affordableGustTier(13, 'tap'), null)
    const s = { player: { px: 100, py: 100, facing: 'east', talents: ['magic_stance'],
      magicCooldown: 0, stamina: 13, maxStamina: 100, staminaRegenT: 99 }, entities: [] }
    assert.deepEqual(tryGust(s, affordableGustTier(s.player.stamina, 'over') ?? 'tap'),
      { ok: false, reason: 'stamina' })
  })
})
