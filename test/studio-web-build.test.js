// The public web build must never reach the bench or the studio: only the lab
// server injects the studio bridge, and only into its /sg/ mirror.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

describe('web build stays out of the studio', () => {
  it('renderer/web-shim.js never mentions benchSave or isStudio', () => {
    const shim = read('renderer/web-shim.js')
    assert.equal(/benchSave/.test(shim), false)
    assert.equal(/isStudio/.test(shim), false)
  })
  it('renderer/index.html never loads the studio bridge', () => {
    assert.equal(/game-bridge/.test(read('renderer/index.html')), false)
  })
})
