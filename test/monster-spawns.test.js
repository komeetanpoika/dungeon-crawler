import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { pickMonsterSpawn, buildArena } from '../renderer/systems/map.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'

const FAKE_RIG = { RIG_ID: 'r', PARAM_SCHEMA: [], drawMonster: () => {} }
const loadOpts = { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }

describe('pickMonsterSpawn', () => {
  it('guaranteed slots always win', () => {
    const r = pickMonsterSpawn({}, 3, 0, ['strong'], [{ name: 'gen', weight: 9 }], () => 0)
    assert.deepEqual(r, { kind: 'monster', variant: 'strong' })
  })
  it('empty genPool reproduces the built-in variant logic exactly', () => {
    assert.deepEqual(pickMonsterSpawn({}, 3, 0, [], [], () => 0.6), { kind: 'monster', variant: 'weak' })
    assert.deepEqual(pickMonsterSpawn({}, 3, 0, [], [], () => 0.8), { kind: 'monster', variant: 'medium' })
    assert.deepEqual(pickMonsterSpawn({ variantPool: ['boss'] }, 3, 0, [], [], () => 0.99),
                     { kind: 'monster', variant: 'boss' })
  })
  it('weight 1 vs the 2 default built-in types -> generated share is 1/3', () => {
    const gen = [{ name: 'boarhound', weight: 1 }]
    // rand() drawn first for the pool split: below 1/3 -> generated
    assert.deepEqual(pickMonsterSpawn({}, 3, 0, [], gen, () => 0.32), { kind: 'boarhound' })
    assert.equal(pickMonsterSpawn({}, 3, 0, [], gen, () => 0.35).kind, 'monster')
  })
  it('weighted choice among several generated monsters', () => {
    const gen = [{ name: 'a', weight: 1 }, { name: 'b', weight: 3 }]
    // split roll 0 -> generated branch; second roll 0.9 * 4 = 3.6 lands in b
    const seq = [0, 0.9]
    const r = pickMonsterSpawn({}, 3, 0, [], gen, () => seq.shift())
    assert.equal(r.kind, 'b')
  })
})

describe('buildArena generated-monster gate', () => {
  beforeEach(clearMonsters)
  it('accepts a registered monster kind and still rejects unknowns', async () => {
    await registerMonsters([{ name: 'boarhound', rig: 'r', stats: { hp: 5 } }], loadOpts)
    const warnings = []
    const { entitySpawns } = buildArena(
      { enemies: [{ kind: 'boarhound' }, { kind: 'nosuch' }] }, m => warnings.push(m))
    assert.deepEqual(entitySpawns.map(s => s.kind), ['boarhound'])
    assert.ok(warnings.some(w => w.includes('nosuch')))
  })
})
