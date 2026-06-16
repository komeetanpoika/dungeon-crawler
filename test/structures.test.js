// test/structures.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { placeStructure } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

function blankMap(w, h) {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ tile: TILE.WALL, roomId: null })))
}

const structure = {
  w: 2, h: 2,
  cells: [
    { x: 0, y: 0, skin: 'castle_wall', overlay: null, collision: 'wall', interaction: null },
    { x: 1, y: 0, skin: 'castle_gate', overlay: null, collision: 'wall', interaction: { type: 'door' } },
    { x: 0, y: 1, skin: 'castle_floor', overlay: 'rug', collision: 'walkable', interaction: null },
    { x: 1, y: 1, skin: 'castle_floor', overlay: null, collision: 'walkable', interaction: { type: 'chest' } },
  ],
}

describe('placeStructure', () => {
  it('stamps skins/overlays and marks cells locked at the offset', () => {
    const map = blankMap(5, 5)
    placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][2].skin, 'castle_wall')
    assert.equal(map[1][2].locked, true)
    assert.equal(map[2][2].overlay, 'rug')
  })
  it('maps collision to logical tiles', () => {
    const map = blankMap(5, 5)
    placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][2].tile, TILE.WALL)       // collision: wall
    assert.equal(map[2][2].tile, TILE.FLOOR)      // collision: walkable
    assert.equal(map[2][2].roomId, 7)
  })
  it('forces interaction cells walkable and emits door/chest spawns', () => {
    const map = blankMap(5, 5)
    const spawns = placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][3].tile, TILE.FLOOR)      // gate door overrides wall->floor
    assert.deepEqual(spawns.find(s => s.kind === 'door'), { kind: 'door', x: 3, y: 1 })
    assert.deepEqual(spawns.find(s => s.kind === 'chest'), { kind: 'chest', x: 3, y: 2 })
  })
  it('ignores cells that fall outside the map', () => {
    const map = blankMap(2, 2)
    assert.doesNotThrow(() => placeStructure(map, structure, 1, 1, 0))
    assert.equal(map[1][1].skin, 'castle_wall')   // only the in-bounds cell stamped
  })
})
