import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tileNameHint } from '../tools/tile-editor/lib.js'

describe('tileNameHint', () => {
  it('is invalid with a warning for empty/whitespace input', () => {
    assert.deepEqual(tileNameHint(''), { valid: false, text: '⚠ enter a tile name' })
    assert.deepEqual(tileNameHint('   '), { valid: false, text: '⚠ enter a tile name' })
    assert.deepEqual(tileNameHint('!!!'), { valid: false, text: '⚠ enter a tile name' })
  })

  it('is valid and shows the sanitized save name', () => {
    assert.deepEqual(tileNameHint('Moss Floor'),
      { valid: true, text: 'saves as: custom_moss_floor.png' })
  })

  it('does not double-prefix an already custom_ name', () => {
    assert.deepEqual(tileNameHint('custom_brick'),
      { valid: true, text: 'saves as: custom_brick.png' })
  })
})
