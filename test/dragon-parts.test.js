import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DRAGON_PALETTE, PALETTE_KEYS, rgbKey } from '../renderer/data/dragon-palette.js'

describe('DRAGON_PALETTE', () => {
  it('has exactly 16 colours', () => {
    assert.equal(DRAGON_PALETTE.length, 16)
  })

  it('has no duplicates', () => {
    assert.equal(PALETTE_KEYS.size, 16)
  })

  it('is all valid 8-bit RGB triples', () => {
    for (const c of DRAGON_PALETTE) {
      assert.equal(c.length, 3)
      for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `bad channel ${v}`)
    }
  })

  it('rgbKey round-trips a palette entry into the lookup set', () => {
    assert.ok(PALETTE_KEYS.has(rgbKey(255, 210, 58)), 'eye-glow yellow should be in the palette')
    assert.ok(!PALETTE_KEYS.has(rgbKey(1, 2, 3)), 'an unrelated colour should not be')
  })

  it('is frozen: writing to a channel does not change its value', () => {
    const original = DRAGON_PALETTE[0][0]
    try { DRAGON_PALETTE[0][0] = 999 } catch { /* strict mode throws on a frozen write; either way, check the value */ }
    assert.equal(DRAGON_PALETTE[0][0], original)
  })
})
