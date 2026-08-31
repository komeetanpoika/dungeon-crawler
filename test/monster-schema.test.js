import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams, clampParams } from '../renderer/render/monster-rigs/schema.js'

const GOOD = [
  { key: 'legLength', label: 'Leg length', group: 'legs', type: 'range', min: 0.4, max: 2.2, step: 0.05, default: 1.0 },
  { key: 'hideColor', label: 'Hide', group: 'skin', type: 'color', default: '#7c4a24' },
  { key: 'horns', label: 'Horns', group: 'head', type: 'toggle', default: false },
]

describe('schemaErrors', () => {
  it('accepts a valid schema', () => assert.deepEqual(schemaErrors(GOOD), []))
  it('rejects non-array', () => assert.equal(schemaErrors('nope').length, 1))
  it('flags duplicate keys, bad types, min>=max, default out of range', () => {
    const errs = schemaErrors([
      { key: 'a', label: 'A', group: 'g', type: 'range', min: 2, max: 1, step: 0.1, default: 3 },
      { key: 'a', label: 'A2', group: 'g', type: 'slider', default: 0 },
      { key: 'c', label: 'C', group: 'g', type: 'color', default: 'red' },
      { key: 'b', label: 'B', group: 'g', type: 'toggle', default: 'yes' },
    ])
    assert.ok(errs.some(e => e.includes('min >= max')))
    assert.ok(errs.some(e => e.includes('duplicate')))
    assert.ok(errs.some(e => e.includes('unknown type')))
    assert.ok(errs.some(e => e.includes('#rrggbb')))
    assert.ok(errs.some(e => e.includes('boolean')))
  })
})

describe('defaultParams', () => {
  it('collects defaults by key', () =>
    assert.deepEqual(defaultParams(GOOD), { legLength: 1.0, hideColor: '#7c4a24', horns: false }))
})

describe('clampParams', () => {
  it('clamps out-of-range, keeps valid, defaults the rest, warns per problem', () => {
    const warnings = []
    const out = clampParams(GOOD, { legLength: 99, horns: true, ghost: 1 }, m => warnings.push(m))
    assert.deepEqual(out, { legLength: 2.2, hideColor: '#7c4a24', horns: true })
    assert.equal(warnings.length, 2) // clamp + unknown key
  })
  it('rejects bad colors and non-numbers back to defaults', () => {
    const out = clampParams(GOOD, { hideColor: 'javascript:', legLength: 'wide' }, () => {})
    assert.deepEqual(out, defaultParams(GOOD))
  })
  it('handles null params', () => assert.deepEqual(clampParams(GOOD, null), defaultParams(GOOD)))
})
