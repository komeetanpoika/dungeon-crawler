import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE, hasLineOfSight, computePlayerFOV, LOS_TREE_BUDGET } from '../renderer/systems/entities.js'

// Build a one-row corridor map from a spec string:
//   '.' floor   '#' hard wall   'T' tree (soft blocker)   '~' water (clear blocker)
// A padding row of floor above and below keeps the ray strictly horizontal.
function corridor(spec) {
  const cell = ch => {
    if (ch === '#') return { tile: TILE.WALL }
    if (ch === 'T') return { tile: TILE.WALL, losSoft: true }
    if (ch === '~') return { tile: TILE.WALL, losClear: true }
    return { tile: TILE.FLOOR }
  }
  const row = () => [...spec].map(() => ({ tile: TILE.FLOOR }))
  return [row(), [...spec].map(cell), row()]
}

// Sight from the first cell to the last cell of the corridor's middle row.
const sees = spec => hasLineOfSight(corridor(spec), 1, 0, 1, spec.length - 1)

describe('line of sight through terrain', () => {
  it('a hard wall still blocks sight', () => {
    assert.equal(sees('..#..'), false)
  })

  it('open water never blocks sight', () => {
    assert.equal(sees('.~~~.'), true)
  })

  it(`up to ${LOS_TREE_BUDGET} tree cells stay see-through`, () => {
    assert.equal(sees('.T.'), true)
    assert.equal(sees('.TT.'), true)
  })

  it(`more than ${LOS_TREE_BUDGET} tree cells block sight`, () => {
    assert.equal(sees('.TTT.'), false)
  })

  it('the tree budget spans the whole ray, not a single clump', () => {
    assert.equal(sees('.T.T.T.'), false)
  })

  it('water does not consume the tree budget', () => {
    assert.equal(sees('.~~TT.'), true)
  })

  it('a tree next to a hard wall still blocks', () => {
    assert.equal(sees('.T#.'), false)
  })
})

describe('FOV radius', () => {
  it('computePlayerFOV honors the radius parameter on open ground', () => {
    const size = 31
    const map = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ({ tile: TILE.FLOOR })))
    const player = { x: 15, y: 15 }
    computePlayerFOV(map, player, 14)
    assert.equal(map[15][15 + 14].visible, true, 'edge of radius 14 lit')
    assert.equal(map[15][15 + 8].visible, true)
    computePlayerFOV(map, player, 8)
    assert.equal(map[15][15 + 14].visible, false, 'beyond radius 8 dark')
    assert.equal(map[15][15 + 8].visible, true)
  })
})
