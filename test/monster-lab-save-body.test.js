import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { saveBody } from '../tools/monster-lab/save-body.js'

const work = over => ({ name: 'x', rigId: 'quadruped', params: { a: 1 }, stats: { hp: 3 }, behavior: { sightRange: 9 },
  spawn: null, hooks: true, extra: {}, ...over })

describe('saveBody', () => {
  it('keeps tuning and fields the lab does not edit', () => {
    const b = saveBody(work({ extra: { tuning: { a: 1 }, foo: 2, name: 'x', rig: 'old', params: { a: 9 } } }))
    assert.deepEqual(b.tuning, { a: 1 })
    assert.equal(b.foo, 2)
    assert.equal('name' in b, false)
    assert.equal(b.rig, 'quadruped')          // the lab's own fields win over the stale extra
    assert.deepEqual(b.params, { a: 1 })
  })
  it('writes rig, params, stats, behavior; spawn only with depths; hooks only when set', () => {
    assert.deepEqual(saveBody(work({ hooks: false })), { rig: 'quadruped', params: { a: 1 }, stats: { hp: 3 }, behavior: { sightRange: 9 } })
    const b = saveBody(work({ spawn: { depths: [1, 2] } }))
    assert.deepEqual(b.spawn, { depths: [1, 2] }); assert.equal(b.hooks, true)
  })
  it('a lab-emptied spawn drops a stale spawn from extra', () => {
    const b = saveBody(work({ spawn: {}, extra: { spawn: { depths: [3, 4] } } }))
    assert.equal('spawn' in b, false)
  })
  it('works without extra (a new monster)', () => {
    assert.equal(saveBody(work({ extra: undefined })).rig, 'quadruped')
  })
})
