import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRules } from '../tools/tile-editor/derive-rules.js'

// tileMeta: name -> { role, tags }
const META = new Map([
  ['m1', { role: 'floor', tags: ['floor.moss'] }],
  ['m2', { role: 'floor', tags: ['floor.moss'] }],
  ['pl', { role: 'floor', tags: ['floor.plain'] }],
  ['wl', { role: 'wall',  tags: ['wall.base'] }],
])

describe('deriveRules', () => {
  it('counts per-tile weights from occurrences', () => {
    const grid = [['m1', 'm1', 'pl']]
    const { tiles } = deriveRules(grid, META)
    assert.deepEqual(tiles.m1, { tags: ['floor.moss'], weight: 2 })
    assert.deepEqual(tiles.pl, { tags: ['floor.plain'], weight: 1 })
  })

  it('accumulates directional adjacency between tags', () => {
    const grid = [['m1', 'pl']]   // pl is east of m1
    const { tags } = deriveRules(grid, META)
    assert.equal(tags['floor.moss'].adjacency.e['floor.plain'], 1)
    assert.equal(tags['floor.plain'].adjacency.w['floor.moss'], 1)
    assert.deepEqual(tags['floor.moss'].adjacency.n, {})
  })

  it('emits permissive tag defaults with role from tile meta', () => {
    const { tags } = deriveRules([['wl']], META)
    assert.equal(tags['wall.base'].role, 'wall')
    assert.deepEqual(tags['wall.base'].allow, ['*'])
    assert.deepEqual(tags['wall.base'].forbid, [])
    assert.deepEqual(tags['wall.base'].directional, {})
  })

  it('skips untagged cells and counts them', () => {
    const grid = [['m1', 'ghost', null]]   // ghost not in META, null empty
    const { tiles, skipped } = deriveRules(grid, META)
    assert.equal(skipped, 1)               // only 'ghost' (null is not "placed")
    assert.equal(tiles.ghost, undefined)
  })

  it('returns empty fragment for an empty grid', () => {
    assert.deepEqual(deriveRules([[null, null]], META), { tiles: {}, tags: {}, skipped: 0 })
  })

  it('treats moss tiles as the same tag for adjacency (generalization)', () => {
    const grid = [['m1', 'wl'], ['m2', 'wl']]   // both moss tiles sit west of wall
    const { tags } = deriveRules(grid, META)
    assert.equal(tags['floor.moss'].adjacency.e['wall.base'], 2)
  })
})
