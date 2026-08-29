import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { WEAPONS } from '../renderer/systems/enemy-attack.js'

const GOAL_NAMES = new Set(['flee_hurt', 'attack_hostile', 'startle', 'go_to', 'wander'])

describe('NPC_SPECIES', () => {
  it('defines the villagers, livestock and wild animals', () => {
    assert.deepEqual(Object.keys(NPC_SPECIES).sort(),
      ['bear', 'boar', 'chicken', 'deer', 'elder', 'goat', 'mouse', 'sheep', 'villager', 'wolf'])
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

  it('villagers speak; peaceful animals startle and react; hostile animals carry a weapon', () => {
    for (const [name, s] of Object.entries(NPC_SPECIES)) {
      if (s.walker) { assert.ok(s.lines.length >= 2, `${name} lines`); continue }
      if (s.hostile) {
        assert.ok(WEAPONS[s.weapon], `${name} weapon`)
        assert.equal(s.startle, undefined, `${name} must not startle`)
        assert.equal(s.onHit, 'fight', `${name} fights`)
      } else if (s.onHit === 'flee') {
        assert.ok(s.startle > 0 && ['hop', 'bolt', 'scurry'].includes(s.react), `${name} startle/react`)
      }
      if (s.weapon) assert.ok(WEAPONS[s.weapon], `${name} weapon`)
    }
  })

  it('animals drop meat with a probability; villagers never do', () => {
    for (const [name, s] of Object.entries(NPC_SPECIES)) {
      if (s.walker) assert.equal(s.drop, undefined, `${name} drops`)
      else assert.ok(s.drop > 0 && s.drop <= 1, `${name} drop chance`)
    }
  })

  it('livestock belong to the village so hurting them provokes it', () => {
    assert.equal(NPC_SPECIES.sheep.faction, 'village')
    assert.equal(NPC_SPECIES.goat.faction, 'village')
    assert.equal(NPC_SPECIES.wolf.hostile, true)
    assert.equal(NPC_SPECIES.bear.hostile, true)
    assert.equal(NPC_SPECIES.boar.hostile, undefined)
    assert.equal(NPC_SPECIES.boar.onHit, 'fight')
  })

  it('fight species have attack_hostile in their list; flee species do not', () => {
    for (const s of Object.values(NPC_SPECIES))
      assert.equal(s.priorities.includes('attack_hostile'), s.onHit === 'fight')
  })
})
