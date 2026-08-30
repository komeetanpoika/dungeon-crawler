import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, tagsOf, pairAllowed, candidatesForRole, pickWeighted, decorateMap, pruneMissingTiles, adjacencyCount, adjacencyScore, pickByAdjacency, ADJACENCY_ALPHA, ADJACENCY_EPSILON, rulesetHasOverlays } from '../renderer/systems/decorate.js'
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
  it('FLOOR, SAND and FLOOR_WOOD are floor-role', () => {
    assert.equal(roleOf(TILE.FLOOR), 'floor')
    assert.equal(roleOf(TILE.SAND), 'floor')
    // House interiors swap their carved floor to FLOOR_WOOD before the
    // decoration pass runs, so the wooden floor must decorate like a floor.
    assert.equal(roleOf(TILE.FLOOR_WOOD), 'floor')
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
    const nb = [{ dir: 'w', skin: 'wallA' }]
    // observed mass 4 is shared 98/2 with the unobserved candidate, so even the
    // top of the rng range still lands on the pairing the painting showed
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0),    'moss')
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0.95), 'moss')
    assert.equal(pickByAdjacency(RS, ['moss', 'plain'], nb, () => 0.999), 'plain')
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

describe('per-tile adjacency (two sprites sharing one tag)', () => {
  // 'top' always sits directly above 'bot'; both are tagged wall.stone, so the
  // tag-level table says only "wall.stone above wall.stone" and cannot tell them
  // apart. The per-tile tables can.
  const RS = {
    tiles: {
      top: { tags: ['wall.stone'], weight: 4, neighbors: { n: {}, e: {}, s: { bot: 4 }, w: {} } },
      bot: { tags: ['wall.stone'], weight: 4, neighbors: { n: { top: 4 }, e: {}, s: {}, w: {} } },
      fl:  { tags: ['floor.a'],    weight: 9, neighbors: { n: {}, e: {}, s: {}, w: {} } },
    },
    tags: {
      'wall.stone': { role: 'wall',  allow: ['*'], adjacency: { n: { 'wall.stone': 4 }, e: {}, s: { 'wall.stone': 4 }, w: {} } },
      'floor.a':    { role: 'floor', allow: ['*'], adjacency: { n: {}, e: {}, s: {}, w: {} } },
    },
  }

  it('reads the per-tile table in preference to the tag table', () => {
    assert.equal(adjacencyCount(RS, 'bot', { dir: 'n', skin: 'top' }), 4)
    assert.equal(adjacencyCount(RS, 'top', { dir: 'n', skin: 'top' }), 0)
    assert.equal(adjacencyCount(RS, 'top', { dir: 'n', skin: 'bot' }), 0)
  })

  it('an absent entry in a painted tile\'s table is a real zero, not a tag fallback', () => {
    // the tag table would have answered 4 here; the per-tile table says never
    assert.equal(adjacencyCount(RS, 'top', { dir: 'n', skin: 'bot' }), 0)
  })

  it('places the tile the painting showed, not a same-tag sibling', () => {
    const nb = [{ dir: 'n', skin: 'top' }]
    // even at the very top of the rng range the observed pairing wins
    assert.equal(pickByAdjacency(RS, ['top', 'bot'], nb, () => 0.95), 'bot')
  })

  it('falls back to the tag table, weight-shared, for a tile the painting never covered', () => {
    // 'extra' has no per-tile table; wall.stone's tag mass is 4+4+2 = 10, so
    // 'extra' claims 2/10 of the tag-level count of 4
    const rs = structuredClone(RS)
    rs.tiles.extra = { tags: ['wall.stone'], weight: 2 }
    assert.equal(adjacencyCount(rs, 'extra', { dir: 'n', skin: 'top' }), 4 * 2 / 10)
  })
})

describe('adjacency noise floor does not grow with the ruleset', () => {
  // One tile the painting showed in this context, plus N tiles it never did.
  // The old flat per-candidate ALPHA gave the unobserved group weight
  // proportional to N, so adding tiles to a ruleset silently destroyed the
  // adjacency signal. The floor is now a fixed share of the observed mass.
  function ruleset(extras) {
    const tiles = {
      nbr:  { tags: ['wall.n'], weight: 1, neighbors: { n: {}, e: {}, s: {}, w: {} } },
      good: { tags: ['wall.g'], weight: 1, neighbors: { n: { nbr: 10 }, e: {}, s: {}, w: {} } },
    }
    const tags = {
      'wall.n': { role: 'wall', allow: ['*'] },
      'wall.g': { role: 'wall', allow: ['*'] },
    }
    for (let i = 0; i < extras; i++) {
      tiles[`bad${i}`] = { tags: [`wall.b${i}`], weight: 10, neighbors: { n: {}, e: {}, s: {}, w: {} } }
      tags[`wall.b${i}`] = { role: 'wall', allow: ['*'] }
    }
    return { tiles, tags }
  }

  // Fraction of picks that land on a pairing the painting never showed.
  function noiseRate(extras, draws = 2000) {
    const rs = ruleset(extras)
    const names = ['good', ...Array.from({ length: extras }, (_, i) => `bad${i}`)]
    const nb = [{ dir: 'n', skin: 'nbr' }]
    let bad = 0
    for (let i = 0; i < draws; i++) {
      const r = (i + 0.5) / draws                       // sweep the rng range evenly
      if (pickByAdjacency(rs, names, nb, () => r) !== 'good') bad++
    }
    return bad / draws
  }

  it('stays within the epsilon budget at 2 candidates', () => {
    assert.ok(noiseRate(1) <= ADJACENCY_EPSILON + 0.01, `got ${noiseRate(1)}`)
  })

  it('stays within the epsilon budget at 20 candidates', () => {
    assert.ok(noiseRate(19) <= ADJACENCY_EPSILON + 0.01, `got ${noiseRate(19)}`)
  })

  it('does not degrade as candidates are added', () => {
    assert.ok(noiseRate(19) <= noiseRate(1) + 0.01,
      `2 candidates: ${noiseRate(1)}, 20 candidates: ${noiseRate(19)}`)
  })

  it('a frequently painted tile cannot outbid the observed answer on weight alone', () => {
    // every bad tile carries weight 10 against good's weight 1; only the old
    // `weight × score` product let them win contexts they never appeared in
    assert.ok(noiseRate(19) < 0.5)
  })
})

describe('pickByAdjacency without learned data', () => {
  const RS = {
    tiles: { a: { tags: ['floor.x'], weight: 1 }, b: { tags: ['floor.x'], weight: 3 } },
    tags:  { 'floor.x': { role: 'floor', allow: ['*'] } },
  }
  it('reduces to plain weighted selection when nothing was ever observed', () => {
    const nb = [{ dir: 'n', skin: 'a' }]
    assert.equal(pickByAdjacency(RS, ['a', 'b'], nb, () => 0),    'a')
    assert.equal(pickByAdjacency(RS, ['a', 'b'], nb, () => 0.5),  'b')   // weights 1:3
  })
})

describe('decorateMap — end to end on same-tag sprites', () => {
  it('rebuilds a two-row wall the way it was painted', () => {
    const rs = {
      tiles: {
        cap:  { tags: ['wall.s'],  weight: 6, neighbors: { n: { grass: 6 }, e: { cap: 5 },  s: { base: 6 },  w: { cap: 5 } } },
        base: { tags: ['wall.s'],  weight: 6, neighbors: { n: { cap: 6 },   e: { base: 5 }, s: { grass: 6 }, w: { base: 5 } } },
        grass:{ tags: ['floor.s'], weight: 20, neighbors: { n: {}, e: { grass: 10 }, s: { cap: 6 }, w: { grass: 10 } } },
      },
      tags: {
        'wall.s':  { role: 'wall',  allow: ['*'] },
        'floor.s': { role: 'floor', allow: ['*'] },
      },
    }
    // floor row, then two wall rows: the painting says cap sits under floor and
    // base sits under cap, every time.
    const map = makeCells(['......', '######', '######'])
    decorateMap(map, rs, mulberry32(3))
    for (let x = 0; x < 6; x++) {
      assert.equal(map[1][x].skin, 'cap',  `row 1 col ${x}`)
      assert.equal(map[2][x].skin, 'base', `row 2 col ${x}`)
    }
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

  it('normalizes a multi-member overlay tag so its total mass equals the observed count (no fan-out amplification)', () => {
    // Tag 'overlay.multi' has two member tiles (weights 3 and 4, summing to 7).
    // dist = { '': 10, 'overlay.multi': 5 } means the painting saw 'none' 10x
    // and the tag 5x — so the correctly-normalized none-vs-overlay split is
    // 10 : 5 (total mass 15), regardless of how many tiles carry the tag.
    // The buggy pre-fix code instead summed each member's own weight into the
    // overlay side, inflating total mass to 10 + 5*(3+4) = 45.
    const rsMulti = {
      tiles: {
        fl: { tags: ['floor.plain'], weight: 1 },
        ma: { tags: ['overlay.multi'], weight: 3 },
        mb: { tags: ['overlay.multi'], weight: 4 },
      },
      tags: {
        'floor.plain':   { role: 'floor',   allow: ['*'], overlays: { '': 10, 'overlay.multi': 5 } },
        'overlay.multi': { role: 'overlay', allow: ['*'], adjacency: { n: {}, e: {}, s: {}, w: {} } },
      },
    }
    // rng sequence: first call resolves the (single-candidate) base skin pick;
    // second call resolves the overlay pick. r=0.3 lands at 0.3*15=4.5, which
    // is inside the none share [0,10) under correct normalization (total=15) —
    // but would land inside the overlay share under the old unnormalized total
    // (0.3*45=13.5, past none's 10 and into member 'ma's inflated weight-15
    // slice), so this single deterministic draw distinguishes fixed from buggy.
    const seq = [0, 0.3]
    let i = 0
    const rng = () => seq[i++]
    const map = makeCells(['.'])
    decorateMap(map, rsMulti, rng)
    assert.equal(map[0][0].overlay, null)
  })
})

describe('decorateMap — locked cells', () => {
  const ruleset = {
    tiles: { floor_a: { tags: ['floor'], weight: 1 }, deco: { tags: ['overlay.x'], weight: 1 } },
    tags: {
      floor: { role: 'floor', allow: ['*'], forbid: [], directional: {},
               adjacency: { n: {}, e: {}, s: {}, w: {} }, overlays: { 'overlay.x': 1, '': 1 } },
      'overlay.x': { role: 'overlay', allow: ['*'], forbid: [], directional: {},
                     adjacency: { n: {}, e: {}, s: {}, w: {} } },
    },
  }
  it('never overwrites the skin or overlay of a locked cell', () => {
    const map = [[{ tile: TILE.FLOOR, skin: 'castle_floor', overlay: 'banner', locked: true }]]
    decorateMap(map, ruleset)
    assert.equal(map[0][0].skin, 'castle_floor')
    assert.equal(map[0][0].overlay, 'banner')
  })
})

