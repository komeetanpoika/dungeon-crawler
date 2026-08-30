import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseLevelCheat, cheatDecision, CHEAT_HOLD_MS } from '../renderer/systems/cheats.js'

describe('parseLevelCheat', () => {
  it('matches level1 through level5', () => {
    for (let d = 1; d <= 5; d++) {
      assert.equal(parseLevelCheat(`level${d}`), d)
    }
  })

  it('accepts level0 as the boss test arena', () => {
    assert.equal(parseLevelCheat('level0'), 0)
  })

  it('accepts level6 (castle ruleset sandbox)', () => {
    assert.equal(parseLevelCheat('level6'), 6)
  })

  it('accepts the adventure chain, level7 through level18', () => {
    for (let d = 7; d <= 18; d++) assert.equal(parseLevelCheat(`level${d}`), d)
  })

  it('ignores depths with no LEVEL_CONFIG entry', () => {
    assert.equal(parseLevelCheat('level19'), null)
    assert.equal(parseLevelCheat('level20'), null)
  })

  it('returns null for partial or empty input', () => {
    assert.equal(parseLevelCheat(''), null)
    assert.equal(parseLevelCheat('lev'), null)
    assert.equal(parseLevelCheat('level'), null)
  })

  it('matches a valid code at the end of a junk-prefixed buffer', () => {
    assert.equal(parseLevelCheat('xqlevel3'), 3)
  })

  it('is case-insensitive', () => {
    assert.equal(parseLevelCheat('LEVEL4'), 4)
  })
})

describe('parseWeaponCheat', () => {
  it('matches the mauno suffix regardless of earlier keystrokes', async () => {
    const { parseWeaponCheat } = await import('../renderer/systems/cheats.js')
    assert.equal(parseWeaponCheat('xxmauno'), 'maunonmiekka')
    assert.equal(parseWeaponCheat('MAUNO'), 'maunonmiekka')
    assert.equal(parseWeaponCheat('maun'), null)
    assert.equal(parseWeaponCheat('level3'), null)
  })
})

// The level cheat is suffix-matched, so "level1" matches the moment the 1
// lands even though the player may be halfway through typing "level18".
// cheatDecision says whether to fire now or hold for another digit.
describe('cheatDecision', () => {
  it('holds a depth that a further digit could extend', () => {
    assert.deepEqual(cheatDecision('level1'), { depth: 1, wait: true })   // 10..18 extend it
  })

  it('fires immediately for a depth nothing can extend', () => {
    assert.deepEqual(cheatDecision('level10'), { depth: 10, wait: false }) // no depth 100+
    assert.deepEqual(cheatDecision('level18'), { depth: 18, wait: false })
    assert.deepEqual(cheatDecision('level5'), { depth: 5, wait: false })   // no depth 50+
    assert.deepEqual(cheatDecision('level0'), { depth: 0, wait: false })   // no depth 0N
  })

  it('is null wherever parseLevelCheat is', () => {
    assert.equal(cheatDecision('levelx'), null)
    assert.equal(cheatDecision('level19'), null)
    assert.equal(cheatDecision(''), null)
  })

  it('declares a hold window the menu can arm a timer with', () => {
    assert.ok(CHEAT_HOLD_MS >= 300 && CHEAT_HOLD_MS <= 1500)
  })
})
