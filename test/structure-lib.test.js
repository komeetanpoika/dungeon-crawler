// test/structure-lib.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setProperty, exportStructure } from '../tools/tile-editor/structure-lib.js'

describe('setProperty', () => {
  it('sets an exclusive collision value', () => {
    assert.deepEqual(setProperty(null, 'collision', 'wall'), { collision: 'wall' })
  })
  it('replaces collision with a different value', () => {
    assert.deepEqual(setProperty({ collision: 'wall' }, 'collision', 'walkable'), { collision: 'walkable' })
  })
  it('toggles collision off when painting the same value', () => {
    assert.equal(setProperty({ collision: 'wall' }, 'collision', 'wall'), null)
  })
  it('toggles an interaction on and off', () => {
    assert.deepEqual(setProperty(null, 'interaction', 'door'), { interaction: { type: 'door' } })
    assert.equal(setProperty({ interaction: { type: 'door' } }, 'interaction', 'door'), null)
  })
  it('replaces one interaction type with another', () => {
    assert.deepEqual(setProperty({ interaction: { type: 'door' } }, 'interaction', 'chest'),
      { interaction: { type: 'chest' } })
  })
  it('toggles structure membership', () => {
    assert.deepEqual(setProperty(null, 'structure'), { structure: true })
    assert.equal(setProperty({ structure: true }, 'structure'), null)
  })
  it('keeps other properties when toggling one', () => {
    assert.deepEqual(setProperty({ collision: 'wall' }, 'structure'), { collision: 'wall', structure: true })
  })
})

describe('exportStructure', () => {
  const meta = new Map([
    ['w1', { role: 'wall', tags: ['wall.base'] }],
    ['f1', { role: 'floor', tags: ['floor.base'] }],
  ])
  // 2-wide x 2-tall painted map; structure marks the right column only.
  const base = [['f1', 'w1'], ['f1', 'w1']]
  const overlay = [[null, 'banner'], [null, null]]
  const props = [
    [null, { structure: true }],
    [null, { structure: true, collision: 'walkable', interaction: { type: 'door' } }],
  ]

  it('returns null when nothing is marked', () => {
    assert.equal(exportStructure(base, overlay, [[null, null], [null, null]], meta), null)
  })
  it('normalizes the footprint origin to (0,0) and sizes it', () => {
    const s = exportStructure(base, overlay, props, meta)
    assert.equal(s.w, 1)
    assert.equal(s.h, 2)
    assert.equal(s.cells.length, 2)
    assert.deepEqual(s.cells.map(c => [c.x, c.y]).sort(), [[0, 0], [0, 1]])
  })
  it('defaults collision from the tile role and carries skin/overlay', () => {
    const s = exportStructure(base, overlay, props, meta)
    const top = s.cells.find(c => c.y === 0)
    assert.equal(top.skin, 'w1')
    assert.equal(top.overlay, 'banner')
    assert.equal(top.collision, 'wall')        // defaulted from wall role
    assert.equal(top.interaction, null)
  })
  it('honors explicit collision and interaction overrides', () => {
    const s = exportStructure(base, overlay, props, meta)
    const bottom = s.cells.find(c => c.y === 1)
    assert.equal(bottom.collision, 'walkable')          // explicit, not role-derived
    assert.deepEqual(bottom.interaction, { type: 'door' })
  })
  it('excludes structure cells that have no painted base tile', () => {
    const p = [[{ structure: true }, null], [null, null]]
    assert.equal(exportStructure([[null, 'w1'], ['f1', 'w1']], overlay, p, meta), null)
  })
  it('excludes base-less structure cells but keeps valid marked siblings', () => {
    const b = [[null, 'w1'], ['f1', 'w1']]   // (0,0) has no base tile
    const p = [[{ structure: true }, { structure: true }], [null, null]]
    const s = exportStructure(b, overlay, p, meta)
    assert.equal(s.cells.length, 1)
    assert.equal(s.cells[0].skin, 'w1')
  })
})
