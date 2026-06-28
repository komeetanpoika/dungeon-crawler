import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer, INVULN_DURATION } from '../renderer/systems/player-damage.js'

function freshState() {
  return { player: { hp: 10 }, log: [] }
}

describe('damagePlayer', () => {
  it("'hit' applies damage, sets invuln, logs, returns true", () => {
    const s = freshState()
    const applied = damagePlayer(s, 3, 'hit', 'ouch')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 7)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
    assert.deepEqual(s.log, ['ouch'])
  })

  it("'hit' is blocked while invulnerable (no damage, returns false)", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    const applied = damagePlayer(s, 3, 'hit', 'ouch')
    assert.equal(applied, false)
    assert.equal(s.player.hp, 10)
    assert.deepEqual(s.log, [])
  })

  it("'dot' always applies and never sets invuln", () => {
    const s = freshState()
    const applied = damagePlayer(s, 1, 'dot', 'fire')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, undefined)
  })

  it("'dot' applies even while invulnerable, leaving invuln untouched", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    damagePlayer(s, 1, 'dot', 'fire')
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, 0.5)
  })
})
