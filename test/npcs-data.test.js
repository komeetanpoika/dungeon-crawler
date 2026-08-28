import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NPC_SPECIES } from '../renderer/data/npcs.js'

const GOAL_NAMES = new Set(['flee_hurt', 'attack_hostile', 'startle', 'go_to', 'wander'])

describe('NPC_SPECIES', () => {
  it('defines the five first-iteration species', () => {
    assert.deepEqual(Object.keys(NPC_SPECIES).sort(), ['chicken', 'deer', 'elder', 'mouse', 'villager'])
  })

  it('every species has the fields the goal loop reads', () => {
    for (const [name, s] of Object.entries(NPC_SPECIES)) {
      assert.ok(['village', 'wild'].includes(s.faction), `${name} faction`)
      assert.ok(['fight', 'flee'].includes(s.onHit), `${name} onHit`)
      assert.ok(s.hp >= 1 && s.speed > 0 && s.wanderSpeed > 0 && s.roam >= 1, `${name} numbers`)
      assert.ok(s.fleeHp >= 0 && s.fleeHp <= 1, `${name} fleeHp`)
      assert.ok(typeof s.sprite === 'string', `${name} sprite`)
      assert.ok(s.priorities.length && s.priorities.at(-1) === 'wander', `${name} ends in wander`)
      for (const g of s.priorities) assert.ok(GOAL_NAMES.has(g), `${name} goal ${g}`)
    }
  })

  it('villagers speak, animals react', () => {
    for (const s of Object.values(NPC_SPECIES)) {
      if (s.faction === 'village') assert.ok(s.lines.length >= 2 && s.walker === true)
      else assert.ok(s.startle > 0 && ['hop', 'bolt', 'scurry'].includes(s.react))
    }
  })

  it('fight species have attack_hostile in their list; flee species do not', () => {
    for (const s of Object.values(NPC_SPECIES))
      assert.equal(s.priorities.includes('attack_hostile'), s.onHit === 'fight')
  })
})
