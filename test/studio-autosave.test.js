import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeAutosave } from '../tools/monster-studio/autosave.js'

const tick = ms => new Promise(r => setTimeout(r, ms))
// save fails while `fail.left` > 0, recording every attempt
function saver(failTimes = 0) {
  const calls = [], fail = { left: failTimes }
  const save = async job => { calls.push(job); if (fail.left > 0) { fail.left--; throw new Error('disk full') } }
  return { calls, fail, save }
}

describe('studio autosave', () => {
  it('debounces: a burst of edits is one save of the latest cut', async () => {
    const s = saver()
    const a = makeAutosave({ save: s.save, delay: 5 })
    a.queue('ogre', 1); a.queue('ogre', 2); a.queue('ogre', 3)
    assert.equal(a.pending(), true)
    await a.flush()
    assert.deepEqual(s.calls, [{ name: 'ogre', cut: 3 }])
    assert.equal(a.unsaved(), false)
  })

  it('keeps a failed save and retries it on the next flush', async () => {
    const s = saver(1), errors = []
    const a = makeAutosave({ save: s.save, delay: 5, onError: e => errors.push(e.message) })
    a.queue('ogre', 1)
    await tick(30)
    assert.equal(a.error, 'disk full')
    assert.equal(a.unsaved(), true, 'a failed job is still unsaved')
    assert.equal(a.pending(), false, 'no automatic retry loop')
    assert.deepEqual(errors, ['disk full'])
    await a.flush()
    assert.deepEqual(s.calls.map(c => c.cut), [1, 1])
    assert.equal(a.error, null)
    assert.equal(a.unsaved(), false)
  })

  it('a newer edit supersedes the failed job', async () => {
    const s = saver(1)
    const a = makeAutosave({ save: s.save, delay: 5 })
    a.queue('ogre', 1)
    await tick(30)
    a.queue('ogre', 2)
    await a.flush()
    assert.deepEqual(s.calls.map(c => c.cut), [1, 2])
    assert.equal(a.unsaved(), false)
  })

  it('flush rejects while a failed job stays unsaved, retrying each time', async () => {
    const s = saver(Infinity)
    const a = makeAutosave({ save: s.save, delay: 5 })
    a.queue('ogre', 1)
    await assert.rejects(a.flush(), /disk full/)
    assert.equal(a.unsaved(), true)
    await assert.rejects(a.flush(), /disk full/)
    assert.equal(s.calls.length, 2)
  })

  it('reset (the user left the monster) clears the error and the failed job', async () => {
    const s = saver(Infinity)
    const a = makeAutosave({ save: s.save, delay: 5 })
    a.queue('ogre', 1)
    await assert.rejects(a.flush())
    a.reset()
    assert.equal(a.error, null)
    assert.equal(a.unsaved(), false)
    await a.flush()
    assert.equal(s.calls.length, 1, 'nothing left to retry')
  })
})
