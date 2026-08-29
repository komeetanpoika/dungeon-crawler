import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseLevelCheat } from '../renderer/systems/cheats.js'

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
