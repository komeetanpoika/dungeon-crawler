import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getAIConfig } from '../renderer/data/enemy-ai.js'

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
})
