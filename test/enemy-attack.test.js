import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEAPONS, ENEMY_MELEE, ATTACK_COOLDOWN,
  getEnemyWeapon, tryStartEnemyAttack, stepEnemyAttack,
} from '../renderer/systems/enemy-attack.js'

function makeState(player) {
  return { player, log: [] }
}

function makeEnemy(type, px = 100, py = 100) {
  return { type, px, py, x: 3, y: 3, hp: 5, maxHp: 5, inCombat: false, damageCooldown: 0 }
}

describe('getEnemyWeapon', () => {
  it('resolves the type default', () => {
    const w = getEnemyWeapon(makeEnemy('guard'))
    assert.equal(w.id, 'sword')
    assert.equal(w.damage, 1)
    assert.equal(w.style, 'arc')
  })

  it('per-entity weaponId overrides the type default', () => {
    const e = makeEnemy('guard')
    e.weaponId = 'club'
    const w = getEnemyWeapon(e)
    assert.equal(w.id, 'club')
    assert.equal(w.damage, 3)
  })

  it('weaponOverrides tweaks individual stats', () => {
    const e = makeEnemy('guard')
    e.weaponOverrides = { damage: 9, windup: 0.5 }
    const w = getEnemyWeapon(e)
    assert.equal(w.id, 'sword')
    assert.equal(w.damage, 9)
    assert.equal(w.windup, 0.5)
  })

  it('returns null for enemies with no melee weapon', () => {
    assert.equal(getEnemyWeapon(makeEnemy('wizard')), null)
    assert.equal(getEnemyWeapon(makeEnemy('dragon_boss')), null)
  })
})

describe('tryStartEnemyAttack — windup 0 (seeded behavior)', () => {
  it('strikes instantly: damage, cooldown, swing animation, angle toward player', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    const started = tryStartEnemyAttack(e, state)
    assert.equal(started, true)
    assert.equal(state.player.hp, 9)
    assert.equal(e.damageCooldown, ATTACK_COOLDOWN)
    assert.equal(e.attack.phase, 'swing')
    assert.equal(e.attack.weaponId, 'sword')
    assert.ok(Math.abs(e.attack.angle) < 0.01, 'angle points east toward the player')
    assert.equal(e.inCombat, true)
  })

  it('deals the seeded per-type damage values', () => {
    const cases = [
      ['guard', 1], ['monster', 1], ['dragon', 2], ['crab', 1], ['cyclops', 3],
    ]
    for (const [type, dmg] of cases) {
      const e = makeEnemy(type, 100, 100)
      const state = makeState({ px: 110, py: 100, hp: 10 })
      tryStartEnemyAttack(e, state)
      assert.equal(state.player.hp, 10 - dmg, `${type} deals ${dmg}`)
    }
  })

  it('uses the default log message with the weapon damage', () => {
    const e = makeEnemy('dragon', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    assert.deepEqual(state.log, ['Hit for 2 damage!'])
  })

  it('uses a custom message when provided', () => {
    const e = makeEnemy('crab', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state, 'Crab pinches! (-1 HP)')
    assert.deepEqual(state.log, ['Crab pinches! (-1 HP)'])
  })

  it('does not start out of range (sword range 20)', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 125, py: 100, hp: 10 })
    assert.equal(tryStartEnemyAttack(e, state), false)
    assert.equal(state.player.hp, 10)
    assert.equal(e.attack ?? null, null)
  })

  it('cyclops club reaches 40px', () => {
    const e = makeEnemy('cyclops', 100, 100)
    const state = makeState({ px: 135, py: 100, hp: 10 })
    assert.equal(tryStartEnemyAttack(e, state), true)
    assert.equal(state.player.hp, 7)
  })

  it('does not start while damageCooldown is running', () => {
    const e = makeEnemy('guard', 100, 100)
    e.damageCooldown = 0.5
    const state = makeState({ px: 110, py: 100, hp: 10 })
    assert.equal(tryStartEnemyAttack(e, state), false)
    assert.equal(state.player.hp, 10)
  })

  it('i-framed strike cancels silently: no damage, no cooldown, no animation', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10, invulnTimer: 0.5 })
    tryStartEnemyAttack(e, state)
    assert.equal(state.player.hp, 10)
    assert.equal(e.damageCooldown, 0)
    assert.equal(e.attack ?? null, null)
    assert.equal(e.inCombat, false)
  })
})

describe('windup > 0 (telegraph framework)', () => {
  it('telegraphs first, then strikes when the windup elapses', () => {
    const e = makeEnemy('guard', 100, 100)
    e.weaponOverrides = { windup: 0.3 }
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    assert.equal(e.attack.phase, 'windup')
    assert.equal(state.player.hp, 10, 'no damage during windup')

    stepEnemyAttack(e, state, 0.15)
    assert.equal(e.attack.phase, 'windup')
    assert.equal(state.player.hp, 10)

    stepEnemyAttack(e, state, 0.2)
    assert.equal(e.attack.phase, 'swing')
    assert.equal(state.player.hp, 9)
    assert.equal(e.damageCooldown, ATTACK_COOLDOWN)
  })

  it('whiffs when the player leaves range during the windup: no damage, cooldown still set', () => {
    const e = makeEnemy('guard', 100, 100)
    e.weaponOverrides = { windup: 0.3 }
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    state.player.px = 300
    stepEnemyAttack(e, state, 0.4)
    assert.equal(state.player.hp, 10, 'dodged — no damage')
    assert.equal(e.damageCooldown, ATTACK_COOLDOWN, 'attack is still spent')
    assert.equal(e.attack.phase, 'swing', 'the swing plays out')
    assert.equal(e.inCombat, false)
  })
})

describe('stepEnemyAttack — swing lifecycle', () => {
  it('clears the attack when the swing finishes', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    tryStartEnemyAttack(e, state)
    stepEnemyAttack(e, state, 0.1)
    assert.ok(e.attack, 'still swinging (sword duration 0.25)')
    stepEnemyAttack(e, state, 0.2)
    assert.equal(e.attack ?? null, null, 'swing over, state cleared')
  })

  it('is a safe no-op without an active attack', () => {
    const e = makeEnemy('guard', 100, 100)
    const state = makeState({ px: 110, py: 100, hp: 10 })
    stepEnemyAttack(e, state, 0.016)
    assert.equal(e.attack ?? null, null)
  })
})
