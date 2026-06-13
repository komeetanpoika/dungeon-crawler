import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, tagsOf, pairAllowed, candidatesForRole, pickWeighted, decorateMap, pruneMissingTiles, adjacencyScore, pickByAdjacency, ADJACENCY_ALPHA, rulesetHasOverlays } from '../renderer/systems/decorate.js'
import { TILE } from '../renderer/systems/entities.js'

// Deterministic RNG for reproducible decoration tests
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function makeCells(rows) {
  // rows: array of strings, '.' = FLOOR, '#' = WALL, ',' = SAND, 'D' = DOOR
  const ids = { '.': TILE.FLOOR, '#': TILE.WALL, ',': TILE.SAND, 'D': TILE.DOOR }
  return rows.map(r => [...r].map(ch => ({ tile: ids[ch], skin: null })))
}

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

describe('candidatesForRole', () => {
  it('floor role yields floor-tagged tiles only', () => {
    assert.deepEqual(candidatesForRole(RS, 'floor').sort(), ['moss1', 'moss2', 'plain'])
  })
  it('wall role yields wall-tagged tiles only', () => {
    assert.deepEqual(candidatesForRole(RS, 'wall').sort(), ['top', 'wallA'])
  })
})

describe('pickWeighted', () => {
  it('rng=0 picks the first candidate', () => {
    assert.equal(pickWeighted(RS, ['moss1', 'moss2'], () => 0), 'moss1')
  })
  it('respects weights: moss2 (weight 3) wins at rng=0.5 of total 4', () => {
    // total = 1 + 3 = 4; r = 2.0 lands inside moss2's [1,4) band
    assert.equal(pickWeighted(RS, ['moss1', 'moss2'], () => 0.5), 'moss2')
  })
  it('missing weight defaults to 1', () => {
    const rs = { tiles: { a: { tags: [] }, b: { tags: [] } }, tags: {} }
    assert.equal(pickWeighted(rs, ['a', 'b'], () => 0.9), 'b')
  })
})

describe('decorateMap', () => {
  // Like RS but without wall.top's directional rule: the scan decides cells
  // before their south neighbor exists, so RS's "wall.base must be south of
  // wall.top" makes top placements dead-end and the skin assertions fragile.
  const RS_DECORATE = {
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
      'wall.top':    { role: 'wall',  allow: ['*'] },
    },
  }

  it('skins floor and sand cells with floor-role tiles, walls with wall-role tiles', () => {
    const map = makeCells(['##', '.,'])
    decorateMap(map, RS_DECORATE, mulberry32(1))
    assert.ok(['wallA', 'top'].includes(map[0][0].skin))
    assert.ok(['moss1', 'moss2', 'plain'].includes(map[1][0].skin))
    assert.ok(['moss1', 'moss2', 'plain'].includes(map[1][1].skin))
  })
  it('leaves non-role cells unskinned', () => {
    const map = makeCells(['D'])
    decorateMap(map, RS_DECORATE, mulberry32(1))
    assert.equal(map[0][0].skin, null)
  })
  it('never places forbidden pairs adjacently', () => {
    const map = makeCells(['....', '....', '....'])
    decorateMap(map, RS_DECORATE, mulberry32(42))
    const isMoss  = n => n === 'moss1' || n === 'moss2'
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
      const here = map[y][x].skin
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        const there = map[ny]?.[nx]?.skin
        if (!here || !there) continue
        assert.ok(!(isMoss(here) && there === 'plain'), `moss|plain at ${x},${y}`)
        assert.ok(!(here === 'plain' && isMoss(there)), `plain|moss at ${x},${y}`)
      }
    }
  })
  it('is deterministic for a given rng seed', () => {
    const a = makeCells(['....', '....'])
    const b = makeCells(['....', '....'])
    decorateMap(a, RS_DECORATE, mulberry32(7))
    decorateMap(b, RS_DECORATE, mulberry32(7))
    assert.deepEqual(a.map(r => r.map(c => c.skin)), b.map(r => r.map(c => c.skin)))
  })
  it('falls back to null skin and counts when rules dead-end', () => {
    // single tag that forbids itself: second floor cell can never be skinned
    const rs = {
      tiles: { solo: { tags: ['floor.x'], weight: 1 } },
      tags:  { 'floor.x': { role: 'floor', allow: ['*'], forbid: ['floor.x'] } },
    }
    const map = makeCells(['..'])
    const fallbacks = decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].skin, 'solo')
    assert.equal(map[0][1].skin, null)
    assert.equal(fallbacks, 1)
  })
  it('does not count fallbacks for roles the ruleset simply does not cover', () => {
    const rs = {
      tiles: { f: { tags: ['floor.a'], weight: 1 } },
      tags:  { 'floor.a': { role: 'floor', allow: ['*'] } },
    }
    const map = makeCells(['#.'])
    const fallbacks = decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].skin, null)   // no wall tiles in ruleset — fine
    assert.equal(map[0][1].skin, 'f')
    assert.equal(fallbacks, 0)
  })
  it('no-ops without a ruleset', () => {
    const map = makeCells(['..'])
    assert.equal(decorateMap(map, undefined), 0)
    assert.equal(map[0][0].skin, null)
  })

describe('pruneMissingTiles', () => {
  it('removes ruleset tiles whose sprite did not load and warns', () => {
    const rulesets = {
      cat: {
        tiles: { good: { tags: ['floor.a'] }, ghost: { tags: ['floor.a'] } },
        tags:  { 'floor.a': { role: 'floor', allow: ['*'] } },
      },
    }
    pruneMissingTiles(rulesets, { good: {} })
    assert.deepEqual(Object.keys(rulesets.cat.tiles), ['good'])
  })
  it('keeps everything when all sprites loaded', () => {
    const rulesets = { cat: { tiles: { a: { tags: [] } }, tags: {} } }
    pruneMissingTiles(rulesets, { a: {} })
    assert.deepEqual(Object.keys(rulesets.cat.tiles), ['a'])
  })
  it('tolerates empty/missing structures', () => {
    pruneMissingTiles({}, {})
    pruneMissingTiles({ x: {} }, {})
  })
})

  it('directional constraint: top never appears without wall.base below it', () => {
    const rs = {
      tiles: { wallA: { tags: ['wall.base'], weight: 1 }, top: { tags: ['wall.top'], weight: 1 } },
      tags: {
        'wall.base': { role: 'wall', allow: ['*'] },
        'wall.top':  { role: 'wall', allow: ['*'], directional: { s: ['wall.base'] } },
      },
    }
    const map = makeCells(['####', '####'])
    decorateMap(map, rs, mulberry32(1))
    for (let x = 0; x < 4; x++) {
      if (map[0][x].skin === 'top') {
        assert.equal(map[1][x].skin, 'wallA', `top at row=0,col=${x} must have wallA below`)
      }
    }
  })
})

describe('adjacency-aware selection', () => {
  const RS = {
    tiles: {
      moss:  { tags: ['floor.moss'],  weight: 1 },
      plain: { tags: ['floor.plain'], weight: 1 },
      wallA: { tags: ['wall.base'],   weight: 1 },
    },
    tags: {
      'floor.moss':  { role: 'floor', allow: ['*'], adjacency: { n:{}, e:{}, s:{}, w:{ 'wall.base': 4 } } },
      'floor.plain': { role: 'floor', allow: ['*'] },
      'wall.base':   { role: 'wall',  allow: ['*'] },
    },
  }

  it('ADJACENCY_ALPHA is the documented smoothing default', () => {
    assert.equal(ADJACENCY_ALPHA, 0.5)
  })

  it('adjacencyScore adds observed counts + ALPHA per neighbor', () => {
    assert.equal(adjacencyScore(RS, 'moss',  [{ dir: 'w', skin: 'wallA' }]), 4.5)
    assert.equal(adjacencyScore(RS, 'plain', [{ dir: 'w', skin: 'wallA' }]), 0.5)
  })

  it('adjacencyScore is neutral (1) with no neighbors', () => {
    assert.equal(adjacencyScore(RS, 'moss', []), 1)
  })

  it('pickByAdjacency biases toward observed neighbors', () => {
    const nb = [{ dir: 'w', skin: 'wallA' }]   // weights: moss 4.5, plain 0.5, total 5
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0),    'moss')
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0.95), 'plain')
  })

  it('pickByAdjacency with no neighbors reduces to weighted-by-weight', () => {
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], [], () => 0), 'moss')
  })

  it('decorateMap honors adjacency preference', () => {
    const rs = {
      tiles: { moss: { tags: ['floor.moss'], weight: 1 }, plain: { tags: ['floor.plain'], weight: 1 }, wallA: { tags: ['wall.base'], weight: 1 } },
      tags: {
        'floor.moss':  { role: 'floor', allow: ['*'], adjacency: { n:{}, e:{}, s:{}, w:{ 'wall.base': 999 } } },
        'floor.plain': { role: 'floor', allow: ['*'] },
        'wall.base':   { role: 'wall',  allow: ['*'] },
      },
    }
    const map = makeCells(['#.'])   // (0,0) wall, (0,1) floor with wall to its west
    decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].skin, 'wallA')
    assert.equal(map[0][1].skin, 'moss')   // 999.5 vs 0.5 → moss for any seed
  })
})

describe('rulesetHasOverlays', () => {
  it('true when a base tag has a non-empty overlay option', () => {
    assert.equal(rulesetHasOverlays({ tags: { b: { overlays: { '': 1, 'overlay.x': 2 } } } }), true)
  })
  it('false when only the empty key exists', () => {
    assert.equal(rulesetHasOverlays({ tags: { b: { overlays: { '': 5 } } } }), false)
  })
  it('false with no overlay data / no ruleset', () => {
    assert.equal(rulesetHasOverlays({ tags: { b: { role: 'floor' } } }), false)
    assert.equal(rulesetHasOverlays({}), false)
    assert.equal(rulesetHasOverlays(undefined), false)
  })
})

describe('overlay decoration pass', () => {
  const RS = {
    tiles: {
      fl: { tags: ['floor.plain'],   weight: 1 },
      br: { tags: ['overlay.barrel'], weight: 1 },
    },
    tags: {
      'floor.plain':   { role: 'floor',   allow: ['*'], overlays: { '': 0, 'overlay.barrel': 5 } },
      'overlay.barrel': { role: 'overlay', allow: ['*'], adjacency: { n: {}, e: {}, s: {}, w: {} } },
    },
  }

  it('places an overlay when the base demands it (empty weight 0)', () => {
    const map = makeCells(['.'])
    decorateMap(map, RS, mulberry32(1))
    assert.equal(map[0][0].skin, 'fl')
    assert.equal(map[0][0].overlay, 'br')
  })

  it('places no overlay when the empty key dominates', () => {
    const rs = structuredClone(RS)
    rs.tags['floor.plain'].overlays = { '': 999, 'overlay.barrel': 0 }
    const map = makeCells(['.'])
    decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].overlay, null)
  })

  it('leaves overlay undefined when the ruleset has no overlay data', () => {
    const rs = { tiles: { fl: { tags: ['floor.plain'], weight: 1 } }, tags: { 'floor.plain': { role: 'floor', allow: ['*'] } } }
    const map = makeCells(['.'])
    decorateMap(map, rs, mulberry32(1))
    assert.equal(map[0][0].overlay, undefined)
    assert.equal(map[0][0].skin, 'fl')   // base pass unaffected
  })
})

