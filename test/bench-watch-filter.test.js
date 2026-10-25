import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { shouldReload } = createRequire(import.meta.url)('../tools/monster-bench/watch-filter.cjs')

describe('shouldReload', () => {
  it('reloads on renderer js and json', () => {
    assert.equal(shouldReload('renderer/systems/monsters/x.js', 0, null), true)
    assert.equal(shouldReload('renderer/data/monsters/x.json', 0, null), true)
  })
  it('normalises Windows separators', () => {
    assert.equal(shouldReload('renderer\\systems\\x.js', 0, null), true)
  })
  it('ignores non-renderer paths and other extensions', () => {
    assert.equal(shouldReload('tools/x.js', 0, null), false)
    assert.equal(shouldReload('renderer/assets/a.png', 0, null), false)
    assert.equal(shouldReload('renderer/data/x.json.tmp', 0, null), false)
    assert.equal(shouldReload('', 0, null), false)
  })
  it('ignores painter-maps.json', () => {
    assert.equal(shouldReload('renderer/data/painter-maps.json', 0, null), false)
  })
  it("ignores the bench's own write for 1.5 s", () => {
    const lw = { rel: 'renderer/data/monsters/m.json', at: 1000 }
    assert.equal(shouldReload('renderer/data/monsters/m.json', 2000, lw), false)
    assert.equal(shouldReload('renderer/data/monsters/index.json', 2000, lw), true)
    assert.equal(shouldReload('renderer/data/monsters/m.json', 2600, lw), true)
  })
})
