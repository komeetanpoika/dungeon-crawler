import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerMonsters, clearMonsters, getMonsterDef, monsterNames, monstersForDepth,
         makeMonsterFromDef, updateMonsterPose, entityPose } from '../renderer/systems/monsters.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'
import { CREATURE_TYPES } from '../renderer/systems/creatures.js'

const FAKE_RIG = {
  RIG_ID: 'fakerig',
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
}
const rigLoader = table => async id => { if (!table[id]) throw new Error('no rig'); return table[id] }
const DEF = { name: 'boarhound', rig: 'fakerig', params: { size: 5 },
              stats: { hp: 30, dmg: 8, speed: 85, half: 10 },
              behavior: { sightRange: 260 }, spawn: { depths: [3, 5], weight: 2 } }
const load = (defs, opts = {}) =>
  registerMonsters(defs, { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => {}, warn: () => {}, ...opts })

describe('registerMonsters', () => {
  beforeEach(clearMonsters)
  it('loads a def: clamped params, stat defaults, AI row, spawn pool', async () => {
    assert.equal(await load([DEF]), 1)
    const d = getMonsterDef('boarhound')
    assert.equal(d.params.size, 2)                       // clamped 5 -> max 2
    assert.equal(d.stats.hp, 30)
    assert.deepEqual(monsterNames(), ['boarhound'])
    assert.equal(getAIConfig({ type: 'boarhound' }).sightRange, 260)
    assert.equal(getAIConfig({ type: 'boarhound' }).speed, 85)  // stats.speed feeds the row
    assert.deepEqual(monstersForDepth(4), [{ name: 'boarhound', weight: 2 }])
    assert.deepEqual(monstersForDepth(6), [])
  })
  it('skips a def whose rig is missing, warns, loads the rest', async () => {
    const warnings = []
    const n = await load([{ ...DEF, rig: 'ghost' }, { ...DEF, name: 'ok' }], { warn: m => warnings.push(m) })
    assert.equal(n, 1)
    assert.equal(getMonsterDef('boarhound'), null)
    assert.ok(getMonsterDef('ok'))
    assert.ok(warnings.some(w => w.includes('ghost')))
  })
  it('rejects bad names', async () => {
    assert.equal(await load([{ ...DEF, name: '../evil' }]), 0)
  })
  it('a failing hooks module is non-fatal and never touches CREATURE_TYPES', async () => {
    const before = [...CREATURE_TYPES]
    const n = await registerMonsters([{ ...DEF, hooks: true }],
      { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => { throw new Error('boom') }, warn: () => {} })
    assert.equal(n, 1)
    assert.ok(getMonsterDef('boarhound'))
    assert.deepEqual([...CREATURE_TYPES], before)
  })
})

describe('makeMonsterFromDef', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  it('builds the entity from stats', () => {
    assert.deepEqual(makeMonsterFromDef('boarhound', 4, 5),
      { type: 'boarhound', x: 4, y: 5, hp: 30, maxHp: 30, damage: 8, inCombat: false })
  })
  it('null for unknown names', () => assert.equal(makeMonsterFromDef('nosuch', 0, 0), null))
})

describe('updateMonsterPose / entityPose', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  const ent = () => ({ ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 })
  it('starts idle, seeds deterministically from the spawn tile', () => {
    const a = ent(), b = ent()
    updateMonsterPose(a, 0.016); updateMonsterPose(b, 0.016)
    assert.equal(entityPose(a).state, 'idle')
    assert.equal(entityPose(a).seed, entityPose(b).seed)
  })
  it('movement -> walk with speed01 and facing from velocity', () => {
    const e = ent()
    updateMonsterPose(e, 0.016)
    e.px += 85 * 0.016            // one frame at full configured speed, +x
    updateMonsterPose(e, 0.016)
    const p = entityPose(e)
    assert.equal(p.state, 'walk')
    assert.ok(p.speed01 > 0.9 && p.speed01 <= 1)
    assert.ok(Math.abs(p.facing) < 0.01)
  })
  it('hp drop -> hit for a flash, then back; attack flag -> attack; hp<=0 -> death', () => {
    const e = ent()
    updateMonsterPose(e, 0.016)
    e.hp -= 5
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'hit')
    updateMonsterPose(e, 0.5)                 // flash expires
    assert.equal(entityPose(e).state, 'idle')
    e.attack = { swing: 1 }
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'attack')
    delete e.attack; e.hp = 0
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'death')
  })
  it('stateT accumulates within a state and resets on change', () => {
    const e = ent()
    updateMonsterPose(e, 0.016); updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).stateT > 0.016)
    e.hp -= 1; updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).stateT <= 0.016)
  })
})
