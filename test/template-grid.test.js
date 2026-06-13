import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBlankGrid, resizeGrid, gridToTemplate, gridFromTemplate, sanitizeTemplateName,
} from '../tools/tile-editor/template-grid.js'

describe('createBlankGrid', () => {
  it('makes an h-row, w-col grid filled with wall', () => {
    const g = createBlankGrid(3, 2)
    assert.deepEqual(g, [['#', '#', '#'], ['#', '#', '#']])
  })
})

describe('resizeGrid', () => {
  const base = [['.', '.'], ['.', '.']]  // 2x2 of floor
  it('pads new cells with wall when growing', () => {
    assert.deepEqual(resizeGrid(base, 3, 3), [
      ['.', '.', '#'],
      ['.', '.', '#'],
      ['#', '#', '#'],
    ])
  })
  it('crops when shrinking', () => {
    assert.deepEqual(resizeGrid(base, 1, 1), [['.']])
  })
})

describe('gridToTemplate / gridFromTemplate', () => {
  it('round-trips a grid through the template shape', () => {
    const g = [['#', '.'], ['.', '#']]
    const t = gridToTemplate(g)
    assert.deepEqual(t, { tiles: ['#.', '.#'], width: 2, height: 2 })
    assert.deepEqual(gridFromTemplate(t), g)
  })
})

describe('sanitizeTemplateName', () => {
  it('uppercases and replaces runs of junk with one underscore', () =>
    assert.equal(sanitizeTemplateName('moss crypt!!'), 'MOSS_CRYPT'))
  it('trims leading/trailing underscores', () =>
    assert.equal(sanitizeTemplateName('  spooky room  '), 'SPOOKY_ROOM'))
  it('returns null when nothing usable remains', () => {
    assert.equal(sanitizeTemplateName(''), null)
    assert.equal(sanitizeTemplateName('!!!'), null)
  })
})
