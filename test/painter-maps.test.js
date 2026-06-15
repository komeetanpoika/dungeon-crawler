import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  serializeGrid, applyMap, renameMap, deleteMap,
  listMaps, getActive, getMap,
} from '../tools/tile-editor/painter-maps.js'

const grid = (rows) => rows.map(r => r.slice())

describe('serializeGrid', () => {
  it('captures dimensions and cell values', () => {
    const base = grid([['a', null], [null, 'b']])
    const overlay = grid([[null, 'o'], [null, null]])
    const s = serializeGrid(base, overlay)
    assert.equal(s.w, 2)
    assert.equal(s.h, 2)
    assert.deepEqual(s.base, [['a', null], [null, 'b']])
    assert.deepEqual(s.overlay, [[null, 'o'], [null, null]])
  })

  it('deep-copies rows so later mutation does not leak in', () => {
    const base = grid([['a']])
    const overlay = grid([[null]])
    const s = serializeGrid(base, overlay)
    base[0][0] = 'CHANGED'
    assert.equal(s.base[0][0], 'a')
  })

  it('reports w=0 for an empty grid', () => {
    const s = serializeGrid([], [])
    assert.equal(s.w, 0)
    assert.equal(s.h, 0)
  })
})

describe('applyMap', () => {
  it('creates the ruleset bucket, stores the map, and sets active', () => {
    const store = {}
    applyMap(store, 'catacombs', 'main', serializeGrid([['a']], [[null]]))
    assert.deepEqual(Object.keys(store), ['catacombs'])
    assert.equal(store.catacombs.active, 'main')
    assert.deepEqual(store.catacombs.maps.main.base, [['a']])
  })

  it('switches active to the most recently applied map', () => {
    const store = {}
    applyMap(store, 'c', 'one', serializeGrid([['a']], [[null]]))
    applyMap(store, 'c', 'two', serializeGrid([['b']], [[null]]))
    assert.equal(store.c.active, 'two')
    assert.deepEqual(listMaps(store, 'c'), ['one', 'two'])
  })
})

describe('renameMap', () => {
  it('moves the map under the new name and updates active', () => {
    const store = {}
    applyMap(store, 'c', 'old', serializeGrid([['a']], [[null]]))
    renameMap(store, 'c', 'old', 'new')
    assert.deepEqual(listMaps(store, 'c'), ['new'])
    assert.equal(store.c.active, 'new')
  })

  it('no-ops when the source is missing or the target name collides', () => {
    const store = {}
    applyMap(store, 'c', 'a', serializeGrid([['x']], [[null]]))
    applyMap(store, 'c', 'b', serializeGrid([['y']], [[null]]))
    renameMap(store, 'c', 'a', 'b')        // collision
    renameMap(store, 'c', 'missing', 'z')  // missing source
    assert.deepEqual(listMaps(store, 'c'), ['a', 'b'])
  })
})

describe('deleteMap', () => {
  it('removes the map and repoints active to the first remaining', () => {
    const store = {}
    applyMap(store, 'c', 'a', serializeGrid([['x']], [[null]]))
    applyMap(store, 'c', 'b', serializeGrid([['y']], [[null]]))
    deleteMap(store, 'c', 'b')              // 'b' was active
    assert.deepEqual(listMaps(store, 'c'), ['a'])
    assert.equal(store.c.active, 'a')
  })

  it('clears active when the last map is deleted', () => {
    const store = {}
    applyMap(store, 'c', 'a', serializeGrid([['x']], [[null]]))
    deleteMap(store, 'c', 'a')
    assert.deepEqual(listMaps(store, 'c'), [])
    assert.equal(store.c.active, null)
  })
})

describe('listMaps / getActive / getMap', () => {
  it('return empties for an unknown ruleset', () => {
    assert.deepEqual(listMaps({}, 'nope'), [])
    assert.equal(getActive({}, 'nope'), null)
    assert.equal(getMap({}, 'nope', 'x'), null)
  })

  it('getActive falls back to the first map when active is stale', () => {
    const store = { c: { active: 'gone', maps: { real: serializeGrid([['a']], [[null]]) } } }
    assert.equal(getActive(store, 'c'), 'real')
  })
})
