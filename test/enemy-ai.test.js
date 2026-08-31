import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getAIConfig, registerMonsterAI } from '../renderer/data/enemy-ai.js'

describe('getAIConfig', () => {
  it('humanoids and mammals flee at low HP by default; beasts do not', () => {
    assert.equal(getAIConfig({ type: 'guard' }).fleeHp, 0.3)                       // humanoid
    assert.equal(getAIConfig({ type: 'monster', variant: 'weak' }).fleeHp, 0.3)    // rat: mammal
    assert.equal(getAIConfig({ type: 'monster', variant: 'strong' }).fleeHp, 0)    // beast
    assert.equal(getAIConfig({ type: 'crab' }).fleeHp, 0)                          // beast
  })

  it('explicit fleeHp overrides the taxon default', () => {
    assert.equal(getAIConfig({ type: 'wizard' }).fleeHp, 0)    // humanoid but never routs
    assert.equal(getAIConfig({ type: 'cyclops' }).fleeHp, 0)   // boss never routs
  })

  it('the shooting spider kites, the crab strafes, the cyclops is wide', () => {
    assert.deepEqual(getAIConfig({ type: 'monster', variant: 'medium' }).kiteBand, [70, 120])
    assert.equal(getAIConfig({ type: 'crab' }).combat, 'strafe')
    assert.equal(getAIConfig({ type: 'cyclops' }).half, 28)
  })

  it('unknown types fall back to the base monster row', () => {
    assert.equal(getAIConfig({ type: 'mystery' }).speed, 80)
  })

  it('npc rows merge the species speed and fleeHp', () => {
    const c = getAIConfig({ type: 'npc', species: 'villager' })
    assert.equal(c.speed, 70)
    assert.equal(c.wanderSpeed, 40)
    assert.equal(c.fleeHp, 0.3)
    assert.equal(c.half, 4)
    assert.equal(c.taxon, 'humanoid')
    assert.equal(getAIConfig({ type: 'npc', species: 'deer' }).speed, 130)
    assert.equal(getAIConfig({ type: 'npc', species: 'deer' }).fleeHp, 1)
  })
})

describe('registerMonsterAI', () => {
  it('registered rows resolve through getAIConfig with beast defaults', () => {
    registerMonsterAI('boarhound', { speed: 85, sightRange: 260, combat: 'strafe' })
    const cfg = getAIConfig({ type: 'boarhound' })
    assert.equal(cfg.speed, 85)
    assert.equal(cfg.sightRange, 260)
    assert.equal(cfg.combat, 'strafe')
    assert.equal(cfg.taxon, 'beast')
    assert.equal(cfg.fleeHp, 0)          // beast default: fights to the death
    assert.equal(cfg.half, 8)            // default half when row omits it
  })
  it('an unregistered type still falls back to BASE.monster', () => {
    assert.equal(getAIConfig({ type: 'nosuch' }).speed, 80)
  })
})
