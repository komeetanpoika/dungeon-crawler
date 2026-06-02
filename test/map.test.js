// test/map.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateLevel, isFullyConnected, createMap, carveRoomShaped, carveCorridor } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

describe('isFullyConnected', () => {
  it('returns true for a single-room map', () => {
    const map = createMap(10, 10)
    map[1][1].tile = TILE.FLOOR
    map[1][2].tile = TILE.FLOOR
    map[2][1].tile = TILE.FLOOR
    assert.equal(isFullyConnected(map), true)
  })

  it('returns false when two floor regions are separated by walls', () => {
    const map = createMap(10, 10)
    map[1][1].tile = TILE.FLOOR
    map[8][8].tile = TILE.FLOOR
    assert.equal(isFullyConnected(map), false)
  })
})

describe('generateLevel', () => {
  it('produces a connected map for each depth 1–9', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map } = generateLevel(depth)
      assert.equal(isFullyConnected(map), true, `depth ${depth} not connected`)
    }
  })

  it('includes a playerSpawn object with x and y', () => {
    const { playerSpawn } = generateLevel(1)
    assert.equal(typeof playerSpawn.x, 'number')
    assert.equal(typeof playerSpawn.y, 'number')
  })

  it('places STAIRS_DOWN on non-final levels', () => {
    const { map } = generateLevel(1)
    const hasStairs = map.some(row => row.some(t => t.tile === TILE.STAIRS_DOWN))
    assert.equal(hasStairs, true)
  })

  it('does not place STAIRS_DOWN on level 9', () => {
    const { map } = generateLevel(9)
    const hasStairs = map.some(row => row.some(t => t.tile === TILE.STAIRS_DOWN))
    assert.equal(hasStairs, false)
  })

  it('places a TREASURE tile on level 9', () => {
    const { map } = generateLevel(9)
    const hasTreasure = map.some(row => row.some(t => t.tile === TILE.TREASURE))
    assert.equal(hasTreasure, true)
  })

  it('returns entitySpawns as an array', () => {
    const { entitySpawns } = generateLevel(1)
    assert.ok(Array.isArray(entitySpawns))
  })

  it('produces rooms with valid walkable centers across all depths', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, rooms } = generateLevel(depth)
      for (const room of rooms) {
        const c = room.center ?? { x: Math.floor(room.x + room.w/2), y: Math.floor(room.y + room.h/2) }
        assert.equal(isWalkable(map[c.y][c.x].tile), true,
          `depth ${depth} room id=${room.id} shape=${room.shape} center not walkable`)
      }
    }
  })

  it('playerSpawn is walkable at all depths', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      assert.equal(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), true,
        `depth ${depth}: playerSpawn not walkable`)
    }
  })

  it('stairs-down is not at playerSpawn position', () => {
    const { map, playerSpawn } = generateLevel(1)
    let sx = -1, sy = -1
    for (let y = 0; y < map.length && sx === -1; y++)
      for (let x = 0; x < map[y].length && sx === -1; x++)
        if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
    assert.ok(sx !== -1, 'no stairs-down found')
    assert.ok(sx !== playerSpawn.x || sy !== playerSpawn.y, 'stairs-down at playerSpawn')
  })

  it('playerSpawn is on TILE.STAIRS_UP (top of entrance passage)', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      const spawnTile = map[playerSpawn.y][playerSpawn.x]
      assert.equal(isWalkable(spawnTile.tile, spawnTile), true,
        `depth ${depth}: playerSpawn not walkable`)
      assert.equal(spawnTile.tile, TILE.STAIRS_UP,
        `depth ${depth}: playerSpawn should be TILE.STAIRS_UP`)
    }
  })

  it('entrance passage STAIR tiles lead south from playerSpawn into dungeon', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      let foundStair = false
      for (let dy = 1; dy <= 8 && !foundStair; dy++)
        if (map[playerSpawn.y + dy]?.[playerSpawn.x]?.tile === TILE.STAIR) foundStair = true
      assert.ok(foundStair, `depth ${depth}: no STAIR tile south of playerSpawn (STAIRS_UP)`)
    }
  })

  it('STAIRS_DOWN has 4 walkable STAIR tiles above it in the exit passage', () => {
    for (let depth = 1; depth < 9; depth++) {
      const { map } = generateLevel(depth)
      let sx = -1, sy = -1
      for (let y = 0; y < map.length && sx === -1; y++)
        for (let x = 0; x < map[y].length && sx === -1; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
      assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
      for (let dy = 1; dy <= 4; dy++) {
        const t = map[sy - dy]?.[sx]
        assert.ok(t, `depth ${depth}: row sy-${dy} out of bounds`)
        assert.equal(t.tile, TILE.STAIR, `depth ${depth}: row sy-${dy} should be TILE.STAIR`)
        assert.ok(!t.voidZone, `depth ${depth}: row sy-${dy} should not be voidZone`)
      }
    }
  })

  it('STAIRS_DOWN has 3 non-walkable void STAIR tiles below it', () => {
    for (let depth = 1; depth < 9; depth++) {
      const { map } = generateLevel(depth)
      let sx = -1, sy = -1
      for (let y = 0; y < map.length && sx === -1; y++)
        for (let x = 0; x < map[y].length && sx === -1; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
      assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
      for (let dy = 1; dy <= 3; dy++) {
        const t = map[sy + dy]?.[sx]
        assert.ok(t, `depth ${depth}: void tile sy+${dy} is out of bounds`)
        assert.equal(t.tile, TILE.STAIR, `depth ${depth}: row sy+${dy} should be TILE.STAIR`)
        assert.equal(t.voidZone, true, `depth ${depth}: row sy+${dy} should be voidZone`)
        assert.equal(isWalkable(t.tile, t), false, `depth ${depth}: row sy+${dy} should not be walkable`)
      }
    }
  })

  it('STAIRS_DOWN has stairDepth 4', () => {
    for (let depth = 1; depth < 9; depth++) {
      const { map } = generateLevel(depth)
      let sx = -1, sy = -1
      for (let y = 0; y < map.length && sx === -1; y++)
        for (let x = 0; x < map[y].length && sx === -1; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) { sx = x; sy = y }
      assert.ok(sx !== -1, `depth ${depth}: no STAIRS_DOWN found`)
      assert.equal(map[sy][sx].stairDepth, 4, `depth ${depth}: STAIRS_DOWN should have stairDepth 4`)
    }
  })

})

describe('paired fountain placement', () => {
  it('places fountain_wall directly above fountain_basin', () => {
    let pairsFound = 0
    for (let attempt = 0; attempt < 20; attempt++) {
      const { entitySpawns } = generateLevel(1)
      const walls  = entitySpawns.filter(s => s.kind === 'fountain_wall')
      const basins = entitySpawns.filter(s => s.kind === 'fountain_basin')
      assert.equal(walls.length, basins.length, 'wall and basin counts must match')
      for (const w of walls) {
        const b = basins.find(b => b.x === w.pairX && b.y === w.pairY)
        assert.ok(b, `fountain_wall at (${w.x},${w.y}) has no matching basin`)
        assert.equal(b.y, w.y + 1, 'basin must be exactly 1 tile below wall')
        assert.equal(b.pairX, w.x, 'basin.pairX must point back to wall x')
        assert.equal(b.pairY, w.y, 'basin.pairY must point back to wall y')
        pairsFound++
      }
    }
    assert.ok(pairsFound > 0, 'expected at least one fountain pair across 20 generateLevel(1) calls')
  })

  it('does not place fountain pairs on sand-floor depths', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { entitySpawns } = generateLevel(4)
      const walls = entitySpawns.filter(s => s.kind === 'fountain_wall')
      assert.equal(walls.length, 0, `depth 4 must have no fountain_wall, found ${walls.length}`)
    }
  })
})

function wallMap(w = 20, h = 20) {
  return createMap(w, h)  // all WALL
}

describe('carveRoomShaped — lshape', () => {
  it('carves floor tiles and returns a walkable center', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 12, h: 10, id: 0, shape: 'lshape' }
    carveRoomShaped(map, room)
    assert.ok(room.center, 'room.center should be set')
    assert.equal(isWalkable(map[room.center.y][room.center.x].tile), true)
  })
})

describe('carveRoomShaped — cross', () => {
  it('carves floor tiles and returns center at geometric middle', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 11, h: 11, id: 0, shape: 'cross' }
    carveRoomShaped(map, room)
    assert.ok(room.center)
    const cx = 1 + Math.floor(11 / 2), cy = 1 + Math.floor(11 / 2)
    assert.equal(room.center.x, cx)
    assert.equal(room.center.y, cy)
    assert.equal(isWalkable(map[cy][cx].tile), true)
  })
})

describe('carveRoomShaped — sunken', () => {
  it('carves an outer floor ring and leaves inner area as walls', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 11, h: 9, id: 0, shape: 'sunken' }
    carveRoomShaped(map, room)
    assert.ok(room.center)
    assert.equal(isWalkable(map[room.center.y][room.center.x].tile), true)
    // inner tile should be WALL
    const innerX = 1 + Math.floor(11 / 2)
    const innerY = 1 + Math.floor(9 / 2)
    assert.equal(map[innerY][innerX].tile, TILE.WALL)
  })
})

describe('carveRoomShaped — rect', () => {
  it('carves a rectangle and leaves center unset (uses geometric center)', () => {
    const map = wallMap()
    const room = { x: 1, y: 1, w: 8, h: 8, id: 0, shape: 'rect' }
    carveRoomShaped(map, room)
    assert.equal(room.center, undefined)
    const cx = 1 + Math.floor(8 / 2), cy = 1 + Math.floor(8 / 2)
    assert.equal(isWalkable(map[cy][cx].tile), true)
  })
})

describe('isWalkable — void zone', () => {
  it('returns false for a STAIR tile with voidZone:true', () => {
    assert.equal(isWalkable(TILE.STAIR, { voidZone: true }), false)
  })
  it('returns true for a STAIR tile without a tile object', () => {
    assert.equal(isWalkable(TILE.STAIR), true)
  })
  it('returns true for a STAIR tile with voidZone:false', () => {
    assert.equal(isWalkable(TILE.STAIR, { voidZone: false }), true)
  })
})

describe('carveCorridor width', () => {
  it('width=1 carves exactly a 1-tile-wide path', () => {
    const map = createMap(10, 10)
    carveCorridor(map, 1, 5, 8, 5, 1)
    assert.equal(map[5][4].tile, TILE.FLOOR)
    assert.equal(map[4][4].tile, TILE.WALL)
    assert.equal(map[6][4].tile, TILE.WALL)
  })

  it('width=3 carves a 3-tile-wide path', () => {
    const map = createMap(10, 10)
    carveCorridor(map, 1, 5, 8, 5, 3)
    assert.equal(map[4][4].tile, TILE.FLOOR)
    assert.equal(map[5][4].tile, TILE.FLOOR)
    assert.equal(map[6][4].tile, TILE.FLOOR)
  })
})
