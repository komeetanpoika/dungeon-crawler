import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { memberTiles, assignTileToTag, removeTileFromTag, brushStatus }
  from '../tools/tile-editor/tag-edit.js'

function fixture() {
  return {
    tiles: {
      a: { tags: ['floor.moss'], weight: 4 },
      b: { tags: ['floor.moss'], weight: 1 },
      c: { tags: ['wall.brick'], weight: 2, neighbors: { n: { a: 3 }, e: {}, s: {}, w: {} } },
    },
    tags: {
      'floor.moss': { role: 'floor', allow: ['*'], forbid: [], directional: {} },
      'wall.brick': { role: 'wall', allow: ['*'], forbid: ['floor.moss'], directional: { s: ['wall.brick'] } },
    },
  }
}

describe('memberTiles', () => {
  it('returns members in ruleset insertion order', () => {
    assert.deepEqual(memberTiles(fixture(), 'floor.moss').map(([n]) => n), ['a', 'b'])
  })
  it('returns [] for an unknown tag', () => {
    assert.deepEqual(memberTiles(fixture(), 'nope'), [])
  })
  it('tolerates a missing ruleset', () => {
    assert.deepEqual(memberTiles(undefined, 'x'), [])
  })
})

describe('assignTileToTag', () => {
  it('registers a brand-new tile at weight 1', () => {
    const rs = fixture()
    assert.equal(assignTileToTag(rs, 'fresh', 'floor.moss'), null)
    assert.deepEqual(rs.tiles.fresh, { tags: ['floor.moss'], weight: 1 })
  })
  it('keeps an existing weight when moving a tile', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'wall.brick')
    assert.equal(rs.tiles.a.weight, 4)
    assert.deepEqual(rs.tiles.a.tags, ['wall.brick'])
  })
  it('returns the tag the tile came from, so the caller can report the move', () => {
    const rs = fixture()
    assert.equal(assignTileToTag(rs, 'a', 'wall.brick'), 'floor.moss')
  })
  it('returns null when the tile is already in that tag', () => {
    const rs = fixture()
    assert.equal(assignTileToTag(rs, 'a', 'floor.moss'), null)
  })
  it('preserves a derived neighbors table across a move', () => {
    const rs = fixture()
    assignTileToTag(rs, 'c', 'floor.moss')
    assert.deepEqual(rs.tiles.c.neighbors.n, { a: 3 })
  })
  it('creates a missing tag with a permissive gate and empty adjacency', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'floor.new', 'overlay')
    assert.deepEqual(rs.tags['floor.new'], {
      role: 'overlay', allow: ['*'], forbid: [], directional: {},
      adjacency: { n: {}, e: {}, s: {}, w: {} },
    })
  })
  it('leaves an existing tag\'s hand-authored gate untouched', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'wall.brick')
    assert.deepEqual(rs.tags['wall.brick'].forbid, ['floor.moss'])
    assert.deepEqual(rs.tags['wall.brick'].directional, { s: ['wall.brick'] })
  })
  it('builds tiles/tags containers on an empty ruleset', () => {
    const rs = {}
    assignTileToTag(rs, 'a', 'floor.x')
    assert.deepEqual(rs.tiles.a, { tags: ['floor.x'], weight: 1 })
    assert.equal(rs.tags['floor.x'].role, 'floor')
  })
})

describe('removeTileFromTag', () => {
  it('drops the tile from the ruleset when it has no tags left', () => {
    const rs = fixture()
    assert.equal(removeTileFromTag(rs, 'a', 'floor.moss'), true)
    assert.equal(rs.tiles.a, undefined)
  })
  it('keeps the tile when other tags remain', () => {
    const rs = fixture()
    rs.tiles.a.tags = ['floor.moss', 'floor.extra']
    removeTileFromTag(rs, 'a', 'floor.moss')
    assert.deepEqual(rs.tiles.a.tags, ['floor.extra'])
  })
  it('is a no-op for a tile that is not a member', () => {
    const rs = fixture()
    assert.equal(removeTileFromTag(rs, 'c', 'floor.moss'), false)
    assert.ok(rs.tiles.c)
  })
  it('is a no-op for an unknown tile', () => {
    assert.equal(removeTileFromTag(fixture(), 'ghost', 'floor.moss'), false)
  })
})

describe('brushStatus', () => {
  it('reports the tag of a registered tile', () => {
    assert.deepEqual(brushStatus(fixture(), 'a'),
      { tile: 'a', tag: 'floor.moss', untagged: false, text: 'a · floor.moss →' })
  })
  it('reports an unregistered tile as untagged', () => {
    assert.deepEqual(brushStatus(fixture(), 'ghost'),
      { tile: 'ghost', tag: null, untagged: true, text: 'ghost · untagged →' })
  })
  it('reports no brush at all', () => {
    assert.deepEqual(brushStatus(fixture(), null),
      { tile: null, tag: null, untagged: false, text: 'no brush selected' })
  })
  it('tolerates a missing ruleset', () => {
    assert.equal(brushStatus(undefined, 'a').untagged, true)
  })
})
