import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE } from '../renderer/systems/entities.js'
import { computeBlastTiles, BLAST_TILES } from '../renderer/systems/fire.js'

// Build a map from ASCII rows: '#' wall, '.' floor, 'v' floor with a void zone.
function grid(rows) {
  return rows.map(r => [...r].map(ch => ({
    tile: ch === '#' ? TILE.WALL : TILE.FLOOR,
    ...(ch === 'v' ? { voidZone: true } : {}),
  })))
}
const key = t => `${t.x},${t.y}`

describe('computeBlastTiles', () => {
  it('fills a BFS diamond in the open — 16 tiles, all of manhattan radius 2 included', () => {
    const map = grid(['.........', '.........', '.........', '.........',
                      '.........', '.........', '.........', '.........', '.........'])
    const tiles = computeBlastTiles(map, 4, 4)
    assert.equal(tiles.length, BLAST_TILES)
    assert.deepEqual(tiles[0], { x: 4, y: 4 }, 'origin first in BFS order')
    const keys = new Set(tiles.map(key))
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= 2)
          assert.ok(keys.has(`${4 + dx},${4 + dy}`), `manhattan-2 tile ${dx},${dy} burns`)
    for (const t of tiles)
      assert.ok(Math.abs(t.x - 4) + Math.abs(t.y - 4) <= 3, 'never farther than ring 3')
  })

  it('spills around walls like a gas and truncates when the space runs out', () => {
    // Two chambers joined only by the gap at row 3. Straight-line distance to
    // the right chamber is short, but fire must walk around through the gap.
    const map = grid([
      '#######',
      '#..#..#',
      '#..#..#',
      '#.....#',
      '#######',
    ])
    const tiles = computeBlastTiles(map, 1, 1)
    const keys = new Set(tiles.map(key))
    assert.equal(tiles.length, 13, 'all 13 reachable tiles burn — closet truncation under 16')
    assert.ok(keys.has('4,1'), 'spilled through the gap into the right chamber')
    assert.ok(!keys.has('3,1'), 'wall tile never burns')
  })

  it('respects void zones and refuses an unwalkable origin', () => {
    const map = grid(['....', '.v..', '....'])
    const keys = new Set(computeBlastTiles(map, 0, 0).map(key))
    assert.ok(!keys.has('1,1'), 'void-zone tile excluded')
    assert.deepEqual(computeBlastTiles(grid(['#..']), 0, 0), [], 'wall origin → no blast')
  })

  it('honors a custom count', () => {
    const map = grid(['.....', '.....', '.....'])
    assert.equal(computeBlastTiles(map, 2, 1, 4).length, 4)
  })
})
