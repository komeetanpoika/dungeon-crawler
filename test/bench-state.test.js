import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeBenchModel, edit, snapshot, restore, savePatch, markSaved, storageKey, takeSnapshot, keepSnapshot } from '../tools/monster-bench/bench-state.js'

const SCHEMA = [
  { key: 'cooldown', label: 'Cooldown', group: 'attack', type: 'range', min: 0.5, max: 10, step: 0.1, default: 2 },
  { key: 'range', label: 'Range', group: 'attack', type: 'range', min: 10, max: 400, step: 1, default: 200 },
]
const def = (tuning = { cooldown: 2, range: 200 }, behavior = { taxon: 'beast', sightRange: 300 }) =>
  ({ tuning, tuningSchema: SCHEMA, stats: { hp: 10, dmg: 2, speed: 60, half: 12 }, behavior })

describe('makeBenchModel', () => {
  it('copies tuning, the three stats and numeric behaviour fields', () => {
    const d = def()
    const m = makeBenchModel(d)
    assert.deepEqual(m.values.tuning, { cooldown: 2, range: 200 })
    assert.notEqual(m.values.tuning, d.tuning)
    assert.deepEqual(m.values.stats, { hp: 10, dmg: 2, speed: 60 })
    assert.deepEqual(m.values.behavior, { sightRange: 300 })
    assert.equal(m.dirty.size, 0)
    assert.deepEqual(m.switches, { frozen: false, invulnerable: false, hitboxes: false, timeScale: 1, paused: false, count: 1, collapsed: false })
  })
})

describe('edit / savePatch / markSaved', () => {
  it('edit sets the value and marks the key dirty', () => {
    const m = makeBenchModel(def())
    edit(m, 'tuning', 'cooldown', 4)
    edit(m, 'stats', 'hp', 20)
    assert.equal(m.values.tuning.cooldown, 4)
    assert.deepEqual([...m.dirty].sort(), ['stats.hp', 'tuning.cooldown'])
  })
  it('savePatch returns full values; markSaved clears dirty', () => {
    const m = makeBenchModel(def())
    edit(m, 'tuning', 'cooldown', 4)
    assert.deepEqual(savePatch(m), { tuning: { cooldown: 4, range: 200 }, stats: { hp: 10, dmg: 2, speed: 60 }, behavior: { sightRange: 300 } })
    markSaved(m)
    assert.equal(m.dirty.size, 0)
  })
})

describe('savePatch without a tuning schema', () => {
  it('leaves tuning out, so Save never wipes saved values when the hook failed to load', () => {
    const m = makeBenchModel({ ...def(), tuning: {}, tuningSchema: null })
    edit(m, 'stats', 'hp', 20)
    assert.equal('tuning' in savePatch(m), false)
    assert.deepEqual(savePatch(m).stats, { hp: 20, dmg: 2, speed: 60 })
  })
})

describe('snapshot / restore', () => {
  it('keeps unsaved tuning over disk values and stays dirty', () => {
    const m1 = makeBenchModel(def({ cooldown: 2, range: 200 })); edit(m1, 'tuning', 'cooldown', 4.5)
    const m2 = makeBenchModel(def({ cooldown: 3, range: 250 }))        // disk changed under us
    restore(m2, snapshot(m1), SCHEMA)
    assert.equal(m2.values.tuning.cooldown, 4.5)
    assert.ok(m2.dirty.has('tuning.cooldown'))
  })
  it('takes disk values for keys not edited', () => {
    const m1 = makeBenchModel(def()); edit(m1, 'tuning', 'cooldown', 4.5)
    const m2 = makeBenchModel(def({ cooldown: 3, range: 250 }))
    restore(m2, snapshot(m1), SCHEMA)
    assert.equal(m2.values.tuning.range, 250)
    assert.equal(m2.dirty.has('tuning.range'), false)
  })
  it('drops keys no longer in the schema', () => {
    const m1 = makeBenchModel({ ...def(), tuning: { cooldown: 2, range: 200, gone: 1 } })
    edit(m1, 'tuning', 'gone', 7)
    const m2 = makeBenchModel(def())
    restore(m2, snapshot(m1), SCHEMA)
    assert.equal('gone' in m2.values.tuning, false)
    assert.equal(m2.dirty.size, 0)
  })
  it('re-clamps a value to the current schema range', () => {
    const m1 = makeBenchModel(def()); edit(m1, 'tuning', 'range', 999)
    const m2 = makeBenchModel(def())
    restore(m2, snapshot(m1), SCHEMA)
    assert.equal(m2.values.tuning.range, 400)
  })
  it('restores stats and numeric behaviour edits', () => {
    const m1 = makeBenchModel(def()); edit(m1, 'stats', 'hp', 25); edit(m1, 'behavior', 'sightRange', 111)
    const m2 = makeBenchModel(def())
    restore(m2, snapshot(m1), SCHEMA)
    assert.equal(m2.values.stats.hp, 25); assert.equal(m2.values.behavior.sightRange, 111)
    assert.ok(m2.dirty.has('stats.hp') && m2.dirty.has('behavior.sightRange'))
  })
  it('drops a behaviour key the def no longer has', () => {
    const m1 = makeBenchModel(def()); edit(m1, 'behavior', 'sightRange', 111)
    const m2 = makeBenchModel(def(undefined, { taxon: 'beast' }))
    restore(m2, snapshot(m1), SCHEMA)
    assert.deepEqual(m2.values.behavior, {}); assert.equal(m2.dirty.size, 0)
  })
  it('applies switches but not paused', () => {
    const m1 = makeBenchModel(def())
    Object.assign(m1.switches, { frozen: true, hitboxes: true, timeScale: 0.25, paused: true, count: 3, collapsed: true })
    const m2 = makeBenchModel(def())
    restore(m2, snapshot(m1), SCHEMA)
    assert.deepEqual(m2.switches, { frozen: true, invulnerable: false, hitboxes: true, timeScale: 0.25, paused: false, count: 3, collapsed: true })
  })
  it('ignores null and malformed text', () => {
    const m = makeBenchModel(def())
    restore(m, null, SCHEMA); restore(m, '{nope', SCHEMA); restore(m, '42', SCHEMA)
    assert.deepEqual(m.values.tuning, { cooldown: 2, range: 200 })
    assert.equal(m.dirty.size, 0)
  })
  it('a non-numeric snapshot value is dropped', () => {
    const m = makeBenchModel(def())
    restore(m, JSON.stringify({ values: { 'stats.hp': 'lots' } }), SCHEMA)
    assert.equal(m.values.stats.hp, 10); assert.equal(m.dirty.size, 0)
  })
})

const PSCHEMA = [
  { key: 'armSwing', label: 'Arm swing', group: 'limbs', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'tint', label: 'Tint', group: 'colour', type: 'color', default: '#336699' },
  { key: 'flip', label: 'Flip', group: 'limbs', type: 'toggle', default: false },
]
const rigDef = () => ({ ...def(), rig: { PARAM_SCHEMA: PSCHEMA }, params: { armSwing: 0.5, tint: '#336699', flip: false } })

describe('rig params', () => {
  it('the model carries the rig params and Save sends them', () => {
    const d = rigDef()
    const m = makeBenchModel(d)
    assert.equal(m.hasParams, true)
    assert.deepEqual(m.values.params, d.params)
    assert.notEqual(m.values.params, d.params)
    edit(m, 'params', 'armSwing', 0.9)
    assert.deepEqual(savePatch(m).params, { armSwing: 0.9, tint: '#336699', flip: false })
  })
  it('restore re-clamps params to the rig schema and drops unknown keys', () => {
    const m1 = makeBenchModel(rigDef())
    edit(m1, 'params', 'armSwing', 0.9); edit(m1, 'params', 'tint', '#ff0000'); edit(m1, 'params', 'flip', true)
    edit(m1, 'params', 'gone', 3)
    const text = JSON.parse(snapshot(m1)); text.values['params.armSwing'] = 7; text.values['params.tint'] = 'red'
    const m2 = makeBenchModel(rigDef())
    restore(m2, JSON.stringify(text), SCHEMA, PSCHEMA)
    assert.equal(m2.values.params.armSwing, 1)
    assert.equal(m2.values.params.tint, '#336699')
    assert.equal(m2.values.params.flip, true)
    assert.equal('gone' in m2.values.params, false)
    assert.deepEqual([...m2.dirty].sort(), ['params.armSwing', 'params.flip'])
  })
  it('a def without a rig schema sends no params', () => {
    const m = makeBenchModel(def())
    assert.equal(m.hasParams, false)
    assert.equal('params' in savePatch(m), false)
  })
})

describe('storageKey', () => {
  it('is per monster', () => { assert.equal(storageKey('glorp'), 'dc-bench:glorp') })
})

describe('takeSnapshot / keepSnapshot', () => {
  const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m } }
  it('a snapshot is taken once: a later reload does not bring it back', () => {
    const st = memory(), m = makeBenchModel(def()); edit(m, 'tuning', 'cooldown', 4)
    keepSnapshot(st, 'k', m)
    assert.equal(JSON.parse(takeSnapshot(st, 'k')).values['tuning.cooldown'], 4)
    assert.equal(takeSnapshot(st, 'k'), null)
  })
  it('storage that throws reads as no snapshot and never throws', () => {
    const bad = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => {} }
    assert.equal(takeSnapshot(bad, 'k'), null)
    assert.doesNotThrow(() => keepSnapshot(bad, 'k', makeBenchModel(def())))
  })
})
