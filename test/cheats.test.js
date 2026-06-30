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

  it('ignores out-of-range depths', () => {
    assert.equal(parseLevelCheat('level6'), null)
    assert.equal(parseLevelCheat('level9'), null)
    assert.equal(parseLevelCheat('level10'), null)
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
