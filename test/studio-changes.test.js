import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { describeChanges } from '../tools/monster-studio/changes.js'

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
})
