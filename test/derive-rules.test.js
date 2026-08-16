import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRules } from '../tools/tile-editor/derive-rules.js'

// tileMeta: name -> { role, tags }
const META = new Map([
  ['m1', { role: 'floor',   tags: ['floor.moss'] }],
  ['m2', { role: 'floor',   tags: ['floor.moss'] }],
  ['pl', { role: 'floor',   tags: ['floor.plain'] }],
  ['wl', { role: 'wall',    tags: ['wall.base'] }],
  ['br', { role: 'overlay', tags: ['overlay.barrel'] }],
  ['gr', { role: 'overlay', tags: ['overlay.grave'] }],
])

// all-null overlay grid matching base dims
const empty = (g) => g.map(r => r.map(() => null))

describe('deriveRules — base layer', () => {
  it('counts per-tile weights from occurrences', () => {
    const base = [['m1', 'm1', 'pl']]
    const { tiles } = deriveRules(base, empty(base), META)
    assert.equal(tiles.m1.weight, 2)
    assert.deepEqual(tiles.m1.tags, ['floor.moss'])
    assert.equal(tiles.pl.weight, 1)
    assert.deepEqual(tiles.pl.tags, ['floor.plain'])
  })

  it('accumulates directional adjacency between base tags', () => {
    const base = [['m1', 'pl']]
    const { tags } = deriveRules(base, empty(base), META)
    assert.equal(tags['floor.moss'].adjacency.e['floor.plain'], 1)
    assert.equal(tags['floor.plain'].adjacency.w['floor.moss'], 1)
    assert.deepEqual(tags['floor.moss'].adjacency.n, {})
  })

  it('emits permissive tag defaults with role from tile meta', () => {
    const base = [['wl']]
    const { tags } = deriveRules(base, empty(base), META)
    assert.equal(tags['wall.base'].role, 'wall')
    assert.deepEqual(tags['wall.base'].allow, ['*'])
    assert.deepEqual(tags['wall.base'].forbid, [])
    assert.deepEqual(tags['wall.base'].directional, {})
  })

  it('skips untagged base cells and counts them', () => {
    const base = [['m1', 'ghost', null]]
    const { tiles, skipped } = deriveRules(base, empty(base), META)
    assert.equal(skipped, 1)
    assert.equal(tiles.ghost, undefined)
  })

  it('returns empty fragment for an empty grid', () => {
    assert.deepEqual(deriveRules([[null, null]], [[null, null]], META), { tiles: {}, tags: {}, skipped: 0 })
  })

  it('treats tiles sharing a tag as one (generalization)', () => {
    const base = [['m1', 'wl'], ['m2', 'wl']]
    const { tags } = deriveRules(base, empty(base), META)
    assert.equal(tags['floor.moss'].adjacency.e['wall.base'], 2)
  })
})

describe('deriveRules — per-tile neighbour tables', () => {
  it('records the exact neighbouring tile per direction', () => {
    const base = [['m1', 'pl']]
    const { tiles } = deriveRules(base, empty(base), META)
    assert.deepEqual(tiles.m1.neighbors.e, { pl: 1 })
    assert.deepEqual(tiles.pl.neighbors.w, { m1: 1 })
    assert.deepEqual(tiles.m1.neighbors.n, {})
  })

  it('distinguishes two tiles that share a tag', () => {
    // m1 always sits above wl, m2 always sits below it. The tag table cannot
    // tell them apart (both are floor.moss); the per-tile table must.
    const base = [['m1'], ['wl'], ['m2']]
    const { tiles, tags } = deriveRules(base, empty(base), META)
    assert.deepEqual(tiles.m1.neighbors.s, { wl: 1 })
    assert.deepEqual(tiles.m2.neighbors.n, { wl: 1 })
    assert.deepEqual(tiles.m1.neighbors.n, {})
    assert.deepEqual(tiles.m2.neighbors.s, {})
    // ...whereas the tag view lumps both directions together, as before
    assert.equal(tags['floor.moss'].adjacency.s['wall.base'], 1)
    assert.equal(tags['floor.moss'].adjacency.n['wall.base'], 1)
  })

  it('accumulates repeats', () => {
    const base = [['m1', 'pl'], ['m1', 'pl']]
    const { tiles } = deriveRules(base, empty(base), META)
    assert.deepEqual(tiles.m1.neighbors.e, { pl: 2 })
    assert.deepEqual(tiles.m1.neighbors.s, { m1: 1 })
  })

  it('records neighbours on the overlay layer too, without crossing layers', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['br', 'gr']]
    const { tiles } = deriveRules(base, overlay, META)
    assert.deepEqual(tiles.br.neighbors.e, { gr: 1 })
    assert.deepEqual(tiles.pl.neighbors.e, { pl: 1 })   // base sees base only
  })

  it('untagged neighbours contribute nothing', () => {
    const base = [['m1', 'ghost']]
    const { tiles } = deriveRules(base, empty(base), META)
    assert.deepEqual(tiles.m1.neighbors.e, {})
  })
})

describe('deriveRules — overlay layer', () => {
  it('registers overlay tiles + tags with role overlay and counts weights', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['br', 'br']]
    const { tiles, tags } = deriveRules(base, overlay, META)
    assert.deepEqual(tiles.br.tags, ['overlay.barrel'])
    assert.equal(tiles.br.weight, 2)
    assert.equal(tags['overlay.barrel'].role, 'overlay')
  })

  it('accumulates base-conditional overlay distribution including the empty key', () => {
    const base    = [['pl', 'pl', 'pl']]
    const overlay = [['br', null, null]]
    const { tags } = deriveRules(base, overlay, META)
    assert.deepEqual(tags['floor.plain'].overlays, { 'overlay.barrel': 1, '': 2 })
  })

  it('accumulates overlay-to-overlay adjacency from the overlay layer', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['br', 'br']]
    const { tags } = deriveRules(base, overlay, META)
    assert.equal(tags['overlay.barrel'].adjacency.e['overlay.barrel'], 1)
    assert.equal(tags['overlay.barrel'].adjacency.w['overlay.barrel'], 1)
  })

  it('skips untagged overlay cells and counts them (null is not skipped)', () => {
    const base    = [['pl', 'pl']]
    const overlay = [['ghost', null]]
    const { skipped, tiles } = deriveRules(base, overlay, META)
    assert.equal(skipped, 1)
    assert.equal(tiles.ghost, undefined)
  })

  it('does not add an overlays distribution to overlay tags', () => {
    const base    = [['pl']]
    const overlay = [['br']]
    const { tags } = deriveRules(base, overlay, META)
    assert.equal(tags['overlay.barrel'].overlays, undefined)
  })
})
