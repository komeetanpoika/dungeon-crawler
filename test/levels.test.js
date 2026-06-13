import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, registerCustomTemplates } from '../renderer/data/levels.js'

describe('registerCustomTemplates', () => {
  it('adds a valid custom template to TEMPLATES and returns its name', () => {
    const added = registerCustomTemplates({
      MOSS_CRYPT: { tiles: ['##', '##'], width: 2, height: 2 },
    })
    assert.deepEqual(added, ['MOSS_CRYPT'])
    assert.deepEqual(TEMPLATES.MOSS_CRYPT, { tiles: ['##', '##'], width: 2, height: 2 })
  })

  it('never overrides a built-in template name', () => {
    const original = TEMPLATES.SHRINE
    const added = registerCustomTemplates({
      SHRINE: { tiles: ['XXX'], width: 3, height: 1 },
    })
    assert.deepEqual(added, [])
    assert.equal(TEMPLATES.SHRINE, original)
  })

  it('skips malformed entries and tolerates non-objects', () => {
    assert.deepEqual(registerCustomTemplates(null), [])
    assert.deepEqual(registerCustomTemplates({ BAD1: { width: 2 } }), [])      // no tiles
    assert.deepEqual(registerCustomTemplates({ BAD2: { tiles: 'nope' } }), []) // tiles not array
    assert.equal(TEMPLATES.BAD1, undefined)
    assert.equal(TEMPLATES.BAD2, undefined)
  })
})
