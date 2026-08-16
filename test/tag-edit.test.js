import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { memberTiles, assignTileToTag, removeTileFromTag, brushStatus, medianMemberWeight, blankTag,
  taggedCount, bestCoveringRuleset }
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
  it('collapses a multi-tag tile to the assigned tag, reporting only the first', () => {
    const rs = fixture()
    rs.tiles.a.tags = ['floor.moss', 'floor.extra']
    assert.equal(assignTileToTag(rs, 'a', 'wall.brick'), 'floor.moss')
    assert.deepEqual(rs.tiles.a.tags, ['wall.brick'])
  })
  it('creates a tag whose name collides with an Object.prototype key', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'constructor')
    assert.equal(rs.tags.constructor.role, 'floor')
    assert.deepEqual(rs.tags.constructor.allow, ['*'])
  })
  it('seeds a brand-new tile at the given weight', () => {
    const rs = fixture()
    assignTileToTag(rs, 'fresh', 'floor.moss', 'floor', 7)
    assert.equal(rs.tiles.fresh.weight, 7)
  })
  it('ignores the seed weight for a tile the ruleset already knows', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'wall.brick', 'wall', 99)
    assert.equal(rs.tiles.a.weight, 4)
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

describe('medianMemberWeight', () => {
  it('returns the middle weight for an odd number of members', () => {
    const rs = fixture()
    rs.tiles.d = { tags: ['floor.moss'], weight: 10 }
    assert.equal(medianMemberWeight(rs, 'floor.moss'), 4)   // 1, 4, 10
  })
  it('averages the middle pair for an even number of members', () => {
    assert.equal(medianMemberWeight(fixture(), 'floor.moss'), 2.5)   // 1, 4
  })
  it('returns 1 for a tag with no members', () => {
    assert.equal(medianMemberWeight(fixture(), 'floor.empty'), 1)
  })
  it('treats a missing weight as 1', () => {
    // Without the ?? 1 fallback, this would be NaN. Distinct from the even-count
    // case to prove the fallback is wired. (Odd length [1, 1, 4] vs even [1, 4].)
    const rs = fixture()
    rs.tiles.b = { tags: ['floor.moss'] }
    rs.tiles.d = { tags: ['floor.moss'] }
    assert.equal(medianMemberWeight(rs, 'floor.moss'), 1)   // 1, 1, 4
  })
})

describe('blankTag', () => {
  it('matches the shape deriveRules emits for a fresh tag', () => {
    // Keep in step with tools/tile-editor/derive-rules.js — an editor-made tag
    // and a derived one must be the same shape or the next derive surprises you.
    assert.deepEqual(blankTag('wall'), {
      role: 'wall', allow: ['*'], forbid: [], directional: {},
      adjacency: { n: {}, e: {}, s: {}, w: {} },
    })
  })
})

// Painted-vs-active coverage. A painting made under one ruleset derives to
// nothing under another, and the old message blamed the user for not tagging.
describe('taggedCount', () => {
  const rs = { tiles: { a: { tags: ['x'] }, b: { tags: [] }, c: {} }, tags: { x: { role: 'floor' } } }
  it('counts only tiles the ruleset has tagged', () => {
    assert.equal(taggedCount(rs, new Set(['a', 'b', 'c', 'ghost'])), 1)
  })
  it('returns 0 for an empty name set', () => assert.equal(taggedCount(rs, new Set()), 0))
  it('tolerates a missing ruleset', () => assert.equal(taggedCount(undefined, new Set(['a'])), 0))
})

describe('bestCoveringRuleset', () => {
  const rulesets = {
    catacombs: { tiles: { moss: { tags: ['floor.moss'] } } },
    outdoors:  { tiles: { t1: { tags: ['a'] }, t2: { tags: ['b'] } } },
    castle:    { tiles: { t1: { tags: ['a'] }, t2: { tags: ['b'] }, t3: { tags: ['c'] } } },
  }
  const painted = new Set(['t1', 't2', 't3'])

  it('names the ruleset recognising the most painted tiles', () => {
    assert.deepEqual(bestCoveringRuleset(rulesets, painted, 'catacombs'), { name: 'castle', count: 3 })
  })
  it('never suggests the ruleset already active', () => {
    assert.deepEqual(bestCoveringRuleset(rulesets, painted, 'castle'), { name: 'outdoors', count: 2 })
  })
  it('returns null when no other ruleset recognises anything', () => {
    assert.equal(bestCoveringRuleset({ only: rulesets.castle }, new Set(['zz']), 'only'), null)
  })
  it('tolerates a missing rulesets object', () => {
    assert.equal(bestCoveringRuleset(undefined, painted, 'x'), null)
  })
})
