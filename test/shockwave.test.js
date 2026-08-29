import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyShockwave, SHOCK_RADIUS, SHOCK_DAMAGE } from '../renderer/systems/shockwave.js'

const enemy = (px, py, extra = {}) => ({ type: 'monster', px, py, hp: 5, maxHp: 5, ...extra })

describe('applyShockwave', () => {
  it('damages and knocks back enemies inside the radius, leaves distant ones alone', () => {
    const near = enemy(140, 100)
    const far = enemy(100 + SHOCK_RADIUS + 30, 100)
    const { entities, hitCount } = applyShockwave([near, far], 100, 100, new Set())
    assert.equal(hitCount, 1)
    const hitNear = entities.find(e => e.py === 100 && e.px >= 140)
    assert.equal(hitNear.hp, 5 - SHOCK_DAMAGE)
    assert.ok(hitNear.knockback, 'splash shoves the enemy')
    assert.ok(hitNear.knockback.vx > 0, 'away from the blast center')
    const untouched = entities.find(e => e.px === far.px)
    assert.equal(untouched.hp, 5)
    assert.equal(untouched.knockback, undefined)
  })

  it('excludes the directly-struck enemies and non-enemies', () => {
    const struck = enemy(110, 100)
    const bystander = enemy(120, 100)
    const chest = { type: 'chest', px: 105, py: 100 }
    const { entities, hitCount } = applyShockwave([struck, bystander, chest], 100, 100, new Set([struck]))
    assert.equal(hitCount, 1)
    assert.equal(entities.find(e => e === struck).hp, 5, 'primary target not double-dipped')
    assert.equal(entities.find(e => e.type === 'chest').hp, undefined, 'chest untouched')
  })

  it('skips the dragon boss and shielded wizards, removes splash kills', () => {
    const boss = enemy(120, 100, { type: 'dragon_boss', hp: 18, maxHp: 18 })
    const shielded = enemy(100, 130, { type: 'wizard', shieldTimer: 2 })
    const weakling = enemy(100, 70, { hp: 1 })
    const { entities, hitCount } = applyShockwave([boss, shielded, weakling], 100, 100, new Set())
    assert.equal(hitCount, 1, 'only the weakling counts as hit')
    assert.equal(entities.find(e => e.type === 'dragon_boss').hp, 18)
    assert.equal(entities.find(e => e.type === 'wizard').hp, 5)
    assert.ok(!entities.some(e => e.hp !== undefined && e.hp <= 0), 'splash kill removed')
    assert.equal(entities.length, 2)
  })
})

describe('npc splashability', () => {
  it('splashes an npc inside the radius and culls it when the splash kills', () => {
    const npc = { type: 'npc', species: 'chicken', id: 'n', px: 140, py: 100, hp: 5, maxHp: 5 }
    const frail = { type: 'npc', species: 'chicken', id: 'm', px: 100, py: 140, hp: 1, maxHp: 1 }
    const { entities, hitCount } = applyShockwave([npc, frail], 100, 100, new Set())
    assert.equal(hitCount, 2)
    assert.equal(entities.length, 1, 'the killed npc is culled')
    assert.equal(entities[0].hp, 5 - SHOCK_DAMAGE)
    assert.ok(entities[0].knockback, 'splash shoves the npc')
  })
})
