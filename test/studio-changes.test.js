import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { describeChanges } from '../tools/monster-studio/changes.js'
import { clampParams, sparseValues } from '../renderer/render/monster-rigs/schema.js'

const W = { maul: { damage: 2, reach: 34 }, club: { damage: 3, reach: 52 } }
const pub = { stats: { hp: 20, speed: 50 }, behavior: { weapon: 'maul' }, params: { armSwing: 4 }, tuning: {}, spawn: null }

describe('describeChanges', () => {
  it('lists changes in plain words, in order', () => {
    const draft = { ...pub, stats: { hp: 24, speed: 50 }, behavior: { weapon: 'maul', weaponOverrides: { damage: 3 } },
                    params: { armSwing: 6 }, spawn: { openMaps: { depths: [7, 18], count: 2 } } }
    assert.deepEqual(describeChanges({ name: 'ogre', isNew: false, published: pub, draft, cutChanged: true, labels: { armSwing: 'Arm swing' }, weapons: W }),
      ['New cut', 'Health 20 → 24', 'Damage 2 → 3', 'Movement: Arm swing 4 → 6', 'Spawns: open maps 7–18, 2 per map'])
  })
  it('weapon none, and nothing changed', () => {
    assert.deepEqual(describeChanges({ name: 'o', isNew: false, published: pub, draft: { ...pub, behavior: {} }, cutChanged: false, weapons: W }),
      ['Weapon maul → none', 'Damage 2 → —', 'Reach 34 → —'])
    assert.deepEqual(describeChanges({ name: 'o', isNew: false, published: pub, draft: pub, cutChanged: false, weapons: W }), [])
  })
  it('new monster, tuning and other numeric behaviour', () => {
    const draft = { ...pub, tuning: { rush: 3 }, behavior: { weapon: 'maul', aggro: 6 } }
    assert.deepEqual(describeChanges({ name: 'x', isNew: true, published: null, draft, cutChanged: true, weapons: W }).slice(0, 1), ['New monster "x"'])
    assert.deepEqual(describeChanges({ name: 'x', isNew: false, published: pub, draft, cutChanged: false, weapons: W }),
      ['Special moves: rush — → 3', 'aggro — → 6'])
  })
  it('one slider moved on a monster the game holds sparsely: exactly one Movement line', () => {
    const schema = ['size', 'armSwing', 'footLift', 'bob', 'lean', 'nod'].map((key, i) =>
      ({ key, label: key, group: 'g', type: 'range', min: 0, max: 10, step: 1, default: i }))
    const published = { ...pub, params: { armSwing: 4 } }
    // what the Movement tab holds (clamped, every key) and what it saves after one nudge
    const live = { ...clampParams(schema, published.params), bob: 7 }
    const draft = { ...published, params: sparseValues(schema, live, published.params) }
    assert.deepEqual(draft.params, { armSwing: 4, bob: 7 })
    assert.deepEqual(describeChanges({ name: 'o', isNew: false, published, draft, cutChanged: false, labels: { bob: 'Bob' }, weapons: W }),
      ['Movement: Bob — → 7'])
  })
  it('names animation changes in plain words', () => {
    const ph = n => ({ phases: Array.from({ length: n }, (_, i) => ({ time: 0.2, pose: {}, ...(i === n - 1 && n > 1 ? { hit: true } : {}) })) })
    const pub = { stats: {}, params: {}, behavior: {}, anims: { walk: ph(2), idle: ph(2) } }
    const draft = { ...pub, anims: { attack: ph(3), walk: { phases: [{ time: 0.3, pose: {} }, { time: 0.2, pose: { a: { turn: 5 } } }] } } }
    assert.deepEqual(describeChanges({ name: 'p', isNew: false, published: pub, draft, cutChanged: false, weapons: W }),
      ['Idle animation: back to built-in', 'Walk animation changed', 'Attack animation: 3 phases (was built-in)'])
  })
})
