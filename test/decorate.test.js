import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, tagsOf, pairAllowed } from '../renderer/systems/decorate.js'
import { TILE } from '../renderer/systems/entities.js'

// Shared fixture: moss only tolerates moss; plain tolerates anything except moss.
const RS = {
  tiles: {
    moss1: { tags: ['floor.moss'],  weight: 1 },
    moss2: { tags: ['floor.moss'],  weight: 3 },
    plain: { tags: ['floor.plain'], weight: 1 },
    wallA: { tags: ['wall.base'],   weight: 1 },
    top:   { tags: ['wall.top'],    weight: 1 },
  },
  tags: {
    'floor.moss':  { role: 'floor', allow: ['floor.moss'] },
    'floor.plain': { role: 'floor', allow: ['*'], forbid: ['floor.moss'] },
    'wall.base':   { role: 'wall',  allow: ['*'] },
    // wall.top demands wall.base directly south of it; anything elsewhere
    'wall.top':    { role: 'wall',  allow: ['*'], directional: { s: ['wall.base'] } },
  },
}

describe('roleOf', () => {
  it('FLOOR and SAND are floor-role', () => {
    assert.equal(roleOf(TILE.FLOOR), 'floor')
    assert.equal(roleOf(TILE.SAND), 'floor')
  })
  it('WALL is wall-role', () => assert.equal(roleOf(TILE.WALL), 'wall'))
  it('other tiles have no role', () => {
    assert.equal(roleOf(TILE.DOOR), null)
    assert.equal(roleOf(TILE.STAIR), null)
    assert.equal(roleOf(TILE.TREASURE), null)
    assert.equal(roleOf(TILE.STAIRS_DOWN), null)
    assert.equal(roleOf(TILE.STAIRS_UP), null)
  })
})

describe('tagsOf', () => {
  it('returns tags for a known tile', () => assert.deepEqual(tagsOf(RS, 'moss1'), ['floor.moss']))
  it('returns [] for unknown tiles', () => assert.deepEqual(tagsOf(RS, 'nope'), []))
})

describe('pairAllowed', () => {
  it('moss next to moss is allowed', () => {
    assert.equal(pairAllowed(RS, 'moss1', 'moss2', 'e'), true)
  })
  it('moss next to plain is blocked (moss only allows moss)', () => {
    assert.equal(pairAllowed(RS, 'moss1', 'plain', 'e'), false)
  })
  it('is symmetric: plain next to moss is blocked too (mutual check)', () => {
    assert.equal(pairAllowed(RS, 'plain', 'moss1', 'e'), false)
  })
  it('forbid beats allow: plain allows * but forbids moss', () => {
    // even with moss allowing plain, plain's forbid wins
    const rs = structuredClone(RS)
    rs.tags['floor.moss'].allow = ['*']
    assert.equal(pairAllowed(rs, 'plain', 'moss1', 'n'), false)
  })
  it('"*" allows any neighbor', () => {
    assert.equal(pairAllowed(RS, 'wallA', 'wallA', 'n'), true)
  })
  it('directional override: top accepts base to its south', () => {
    assert.equal(pairAllowed(RS, 'top', 'wallA', 's'), true)
  })
  it('directional override: top rejects top to its south', () => {
    assert.equal(pairAllowed(RS, 'top', 'top', 's'), false)
  })
  it('directional override only constrains that direction', () => {
    assert.equal(pairAllowed(RS, 'top', 'top', 'e'), true)
  })
  it('opposite direction is checked from the neighbor side: base under top is fine', () => {
    // a=wallA, b=top, b is north of a → from top's view, wallA is to its south
    assert.equal(pairAllowed(RS, 'wallA', 'top', 'n'), true)
  })
  it('tiles with unknown tags impose no constraints', () => {
    const rs = { tiles: { x: { tags: ['ghost.tag'] }, y: { tags: ['ghost.tag'] } }, tags: {} }
    assert.equal(pairAllowed(rs, 'x', 'y', 'e'), true)
  })
})
