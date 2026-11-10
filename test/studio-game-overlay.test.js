import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeProjectRoot } from './studio-fixture.js'
import { openDraft, patchDraftDef, readDraft, discardDraft } from '../tools/monster-studio/drafts.js'
import { makeDraftCache } from '../tools/monster-studio/game-overlay.js'

// One game boot through the /sg/ mirror asks for ~700 files; readDraft runs the
// cut's leak check and hashes files (~200 ms on a big drawing), so the mirror
// must read the draft once per revision, not once per file.
describe('game mirror draft cache', () => {
  const counting = () => { let n = 0; return { read: (root, name) => { n++; return readDraft(root, name) }, calls: () => n } }

  it('reads a draft once per revision', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    const c = counting(), cache = makeDraftCache(c.read)
    for (let i = 0; i < 50; i++) cache.get(r, 'boar')
    assert.equal(c.calls(), 1)
  })
  it('a saved edit (a new revision) is read again', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    const c = counting(), cache = makeDraftCache(c.read)
    cache.get(r, 'boar')
    patchDraftDef(r, 'boar', { stats: { hp: 9 } })
    assert.equal(cache.get(r, 'boar').def.stats.hp, 9)
    assert.equal(c.calls(), 2)
  })
  it('a discarded draft is gone; a fresh one at the same revision is read again', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    const c = counting(), cache = makeDraftCache(c.read)
    patchDraftDef(r, 'boar', { stats: { hp: 9 } })
    cache.get(r, 'boar')
    discardDraft(r, 'boar')
    assert.throws(() => cache.get(r, 'boar'))
    openDraft(r, 'boar')
    assert.notEqual(cache.get(r, 'boar').def.stats.hp, 9)
  })
})
