import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnToForm, formToSpawn, spawnErrors, describeSpawn } from '../tools/monster-studio/spawn-form.js'

describe('spawn form', () => {
  it('round-trips the two existing shapes', () => {
    const s = { depths: [3, 5], weight: 1, openMaps: { depths: [7, 14], count: 3 } }
    assert.deepEqual(formToSpawn(spawnToForm(s)), s)
    assert.equal(formToSpawn(spawnToForm(null)), null)
  })
  it('clamps and orders ranges', () => {
    const f = spawnToForm(null); f.dungeon = { on: true, from: 9, to: 0, weight: 10 }
    assert.deepEqual(formToSpawn(f), { depths: [1, 5], weight: 4 })
  })
  it('describes spawns in plain words', () => {
    assert.equal(describeSpawn(null), 'nowhere')
    assert.equal(describeSpawn({ openMaps: { depths: [7, 18], count: 2 } }), 'open maps 7–18, 2 per map')
    assert.equal(describeSpawn({ depths: [3, 5], weight: 1, openMaps: { depths: [7, 18], count: 2 } }),
      'dungeon & cave levels 3–5 (how common: 1); open maps 7–18, 2 per map')
  })
  it('spawnErrors flags shapes the game cannot read', () => {
    assert.deepEqual(spawnErrors({ openMaps: { depths: [7, 18], count: 2 } }), [])
    assert.ok(spawnErrors({ depths: [0, 9] }).length > 0)
  })
})
