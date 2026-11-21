import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildCells } from '../renderer/interior/walls.js'
import { WALLS, MISC, N, E, S, W } from '../renderer/interior/kit.js'
import { TILE } from '../renderer/systems/entities.js'

// Two rooms side by side, a doorway between them, the way out under room 0.
const PLAN = {
  w: 11, h: 7,
  grid: [
    '###########',
    '#uuuu#uuu##',
    '#llll#lll##',
    '#....d...##',
    '#....#...##',
    '###E#######',
    '           ',
  ].map(r => r),
  rooms: [{ id: 0, x0: 1, x1: 4, y0: 1, y1: 4, floorY0: 3 }, { id: 1, x0: 6, x1: 8, y0: 1, y1: 4, floorY0: 3 }],
  doors: [{ a: 0, b: 1, axis: 'v', x: 5, y: 3, cells: [{ x: 5, y: 3 }] }],
  exit: { x: 3, y: 5 }, spawn: { x: 3, y: 4 }, entry: 0,
}
const T = WALLS.plaster
const cells = () => buildCells(PLAN, { palette: 'plaster', floorOf: id => (id === 0 ? 'in_floor_planks' : 'in_floor_flags') })

describe('interior walls and floors', () => {
  it('autotiles wall tops from their wall-top neighbours', () => {
    const m = cells()
    assert.equal(m[0][0].skin, T.top[E | S])            // the top-left corner
    assert.equal(m[0][2].skin, T.top[E | W])            // over a face: no south arm
    assert.equal(m[0][5].skin, T.top[E | W | S])        // the dividing wall meets the outer wall
    assert.equal(m[2][5].skin, T.top[N])                // the divider stops above the doorway
    assert.equal(m[4][5].skin, T.top[S])                // and starts again below it
    assert.equal(m[5][0].skin, T.top[N | E])            // bottom-left corner
    assert.equal(m[5][2].skin, T.top[W])                // the wall ends at the way out
    assert.equal(m[5][4].skin, T.top[E])                // and starts again past it
    assert.equal(m[5][5].skin, T.top[E | W | N])        // where the divider comes down
  })
  it('gives face rows end pieces where they meet walls', () => {
    const m = cells()
    assert.equal(m[1][1].skin, T.faceU.l); assert.equal(m[1][2].skin, T.faceU.m); assert.equal(m[1][4].skin, T.faceU.r)
    assert.equal(m[2][1].skin, T.faceL.l); assert.equal(m[2][3].skin, T.faceL.m); assert.equal(m[2][4].skin, T.faceL.r)
    for (const [x, y] of [[1, 1], [4, 2], [7, 1]]) assert.equal(m[y][x].tile, TILE.WALL)
  })
  it('lays each room its floor, the doorway too, and a doormat at the way out', () => {
    const m = cells()
    assert.equal(m[3][2].skin, 'in_floor_planks'); assert.equal(m[3][2].tile, TILE.FLOOR_WOOD); assert.equal(m[3][2].roomId, 0)
    assert.equal(m[3][7].skin, 'in_floor_flags'); assert.equal(m[3][7].roomId, 1)
    assert.equal(m[3][5].tile, TILE.FLOOR_WOOD); assert.ok(['in_floor_planks', 'in_floor_flags'].includes(m[3][5].skin))
    assert.equal(m[5][3].tile, TILE.FLOOR_WOOD); assert.equal(m[5][3].deco, MISC.doormat); assert.equal(m[5][3].skin, 'in_floor_planks')
  })
  it('draws nothing outside the house and locks every cell', () => {
    const m = cells()
    assert.equal(m[6][0].skin, MISC.void); assert.equal(m[6][0].tile, TILE.WALL)
    assert.ok(m.flat().every(c => c.locked === true))
  })
})
