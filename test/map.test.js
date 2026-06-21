// test/map.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateLevel, isFullyConnected, createMap, carveRoomShaped, carveCorridor, placeTemplate } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { TEMPLATE_LEGEND } from '../renderer/data/levels.js'

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
  it('produces a connected map for each depth 1–5', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map } = generateLevel(depth)
      assert.equal(isFullyConnected(map), true, `depth ${depth} not connected`)
    }
  })

  it('includes a playerSpawn object with x and y', () => {
    const { playerSpawn } = generateLevel(1)
    assert.equal(typeof playerSpawn.x, 'number')
    assert.equal(typeof playerSpawn.y, 'number')
  })

  it('returns entitySpawns as an array', () => {
    const { entitySpawns } = generateLevel(1)
    assert.ok(Array.isArray(entitySpawns))
  })

  it('produces rooms with valid walkable centers across all depths', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map, rooms } = generateLevel(depth)
      for (const room of rooms) {
        const c = room.center ?? { x: Math.floor(room.x + room.w/2), y: Math.floor(room.y + room.h/2) }
        assert.equal(isWalkable(map[c.y][c.x].tile), true,
          `depth ${depth} room id=${room.id} shape=${room.shape} center not walkable`)
      }
    }
  })

  it('playerSpawn is walkable at all depths', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      assert.equal(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), true,
        `depth ${depth}: playerSpawn not walkable`)
    }
  })

  it('playerSpawn is always at col 2, row 1', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { playerSpawn } = generateLevel(depth)
      assert.equal(playerSpawn.x, 2,  `depth ${depth}: playerSpawn.x should be 2`)
      assert.equal(playerSpawn.y, 1,  `depth ${depth}: playerSpawn.y should be 1`)
    }
  })

  it('playerSpawn is on TILE.STAIRS_UP (top of entrance passage)', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      const spawnTile = map[playerSpawn.y][playerSpawn.x]
      assert.equal(isWalkable(spawnTile.tile, spawnTile), true,
        `depth ${depth}: playerSpawn not walkable`)
      assert.equal(spawnTile.tile, TILE.STAIRS_UP,
        `depth ${depth}: playerSpawn should be TILE.STAIRS_UP`)
    }
  })

  it('entrance passage STAIR tiles lead south from playerSpawn into dungeon', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map, playerSpawn } = generateLevel(depth)
      let foundStair = false
      for (let dy = 1; dy <= 8 && !foundStair; dy++)
        if (map[playerSpawn.y + dy]?.[playerSpawn.x]?.tile === TILE.STAIR) foundStair = true
      assert.ok(foundStair, `depth ${depth}: no STAIR tile south of playerSpawn (STAIRS_UP)`)
    }
  })

  it('does not pre-carve a STAIRS_DOWN exit (exit appears on boss death)', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const { map } = generateLevel(depth)
      let found = false
      for (let y = 0; y < map.length && !found; y++)
        for (let x = 0; x < map[y].length && !found; x++)
          if (map[y][x].tile === TILE.STAIRS_DOWN) found = true
      assert.equal(found, false, `depth ${depth}: should have no pre-carved STAIRS_DOWN`)
    }
  })

  it('generates connected maps at the smaller L1/L2 sizes', () => {
    assert.equal(isFullyConnected(generateLevel(1, 50, 32).map), true)
    assert.equal(isFullyConnected(generateLevel(2, 64, 40).map), true)
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
      const { entitySpawns } = generateLevel(3)
      const walls = entitySpawns.filter(s => s.kind === 'fountain_wall')
      assert.equal(walls.length, 0, `depth 3 (sand floor) must have no fountain_wall, found ${walls.length}`)
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

describe('placeTemplate', () => {
  // One template exercising all 11 symbols. Scan order is row-major.
  const ALL = {
    tiles: ['#.C', 'TSX', 'WPL', 'DB.'],
    width: 3, height: 4,
  }

  it('maps every tile symbol to the right tile id and roomId', () => {
    const map = createMap(3, 4)
    placeTemplate(map, ALL, 0, 0, 7)
    assert.equal(map[0][0].tile, TILE.WALL)
    assert.equal(map[0][0].roomId, null)            // walls keep no roomId
    assert.equal(map[0][1].tile, TILE.FLOOR);    assert.equal(map[0][1].roomId, 7)
    assert.equal(map[0][2].tile, TILE.COLUMN);   assert.equal(map[0][2].roomId, 7)
    assert.equal(map[1][0].tile, TILE.TREASURE); assert.equal(map[1][0].roomId, 7)
    assert.equal(map[1][1].tile, TILE.SHRINE);   assert.equal(map[1][1].roomId, 7)
    assert.equal(map[1][2].tile, TILE.SNARE);    assert.equal(map[1][2].roomId, 7)
    // spawn cells stand on floor
    assert.equal(map[2][0].tile, TILE.FLOOR)     // weapon
    assert.equal(map[3][0].tile, TILE.FLOOR)     // dragon
    assert.equal(map[3][1].tile, TILE.FLOOR)     // boss
  })

  it('produces spawns in scan order with the right shapes', () => {
    const map = createMap(3, 4)
    const spawns = placeTemplate(map, ALL, 0, 0, 7)
    assert.deepEqual(spawns, [
      { kind: 'weapon', x: 0, y: 2 },             // weapon/potion carry no roomId
      { kind: 'potion', x: 1, y: 2 },
      { kind: 'door',   x: 2, y: 2 },             // door also carries no roomId
      { kind: 'dragon', x: 0, y: 3, roomId: 7, isBoss: true },
      { kind: 'dragon_boss', x: 1, y: 3, roomId: 7, isBoss: true },
    ])
  })

  it('places only the first dragon_boss', () => {
    const map = createMap(2, 1)
    const spawns = placeTemplate(map, { tiles: ['BB'], width: 2, height: 1 }, 0, 0, 3)
    const bosses = spawns.filter(s => s.kind === 'dragon_boss')
    assert.equal(bosses.length, 1)
    assert.equal(map[0][0].tile, TILE.FLOOR)      // both cells still become floor
    assert.equal(map[0][1].tile, TILE.FLOOR)
  })

  it('honors the ox/oy offset and ignores out-of-bounds cells', () => {
    const map = createMap(4, 4)
    placeTemplate(map, { tiles: ['##', '##'], width: 2, height: 2 }, 2, 2, 1)
    assert.equal(map[2][2].tile, TILE.WALL)
    assert.equal(map[3][3].tile, TILE.WALL)
    assert.equal(map[0][0].tile, TILE.WALL)       // createMap default, untouched
  })

  it('ignores unknown characters', () => {
    const map = createMap(2, 1)
    const spawns = placeTemplate(map, { tiles: ['?z'], width: 2, height: 1 }, 0, 0, 1)
    assert.deepEqual(spawns, [])
    assert.equal(map[0][0].tile, TILE.WALL)       // unchanged default
  })

  it('legend covers all template symbols with valid entries', () => {
    assert.deepEqual(
      Object.keys(TEMPLATE_LEGEND).sort(),
      ['#', '.', 'B', 'C', 'D', 'L', 'P', 'R', 'S', 'T', 'W', 'X', 'Z'],
    )
    for (const [ch, e] of Object.entries(TEMPLATE_LEGEND)) {
      assert.ok(e.label, `${ch} has a label`)
      assert.ok(e.kind === 'tile' || e.kind === 'spawn', `${ch} has a valid kind`)
      if (e.kind === 'tile') assert.equal(typeof e.tile, 'number', `${ch} has a tile id`)
      else assert.equal(typeof e.spawn, 'string', `${ch} has a spawn kind`)
    }
  })
})

describe('generateLevel skipProps', () => {
  it('omits random prop spawns when skipProps is set', () => {
    for (let i = 0; i < 10; i++) {
      const { entitySpawns } = generateLevel(1, 80, 50, { skipProps: true })
      assert.equal(entitySpawns.filter(s => s.kind === 'prop').length, 0)
    }
  })

  it('still produces a connected map with skipProps', () => {
    const { map } = generateLevel(1, 80, 50, { skipProps: true })
    assert.equal(isFullyConnected(map), true)
  })
})

import { FINAL_DEPTH } from '../renderer/data/levels.js'
import { TILE as MTILE } from '../renderer/systems/entities.js'

describe('depth 10 boss arena', () => {
  it('FINAL_DEPTH is 5', () => { assert.equal(FINAL_DEPTH, 5) })

  it('spawns a dragon_boss and a treasure tile on depth 10', () => {
    let foundBoss = false, foundTreasure = false
    for (let attempt = 0; attempt < 5 && !(foundBoss && foundTreasure); attempt++) {
      const { map, entitySpawns } = generateLevel(10)
      if (entitySpawns.some(s => s.kind === 'dragon_boss')) foundBoss = true
      if (map.some(row => row.some(t => t.tile === MTILE.TREASURE))) foundTreasure = true
    }
    assert.ok(foundBoss, 'depth 10 should spawn a dragon_boss')
    assert.ok(foundTreasure, 'depth 10 should place a treasure tile')
  })
})

describe('boss template spawns', () => {
  it('legend marks crab/wizard/dragon/boss as isBoss', () => {
    assert.equal(TEMPLATE_LEGEND['R'].spawn, 'crab')
    assert.equal(TEMPLATE_LEGEND['R'].isBoss, true)
    assert.equal(TEMPLATE_LEGEND['Z'].spawn, 'wizard')
    assert.equal(TEMPLATE_LEGEND['Z'].isBoss, true)
    assert.equal(TEMPLATE_LEGEND['D'].isBoss, true)
    assert.equal(TEMPLATE_LEGEND['B'].isBoss, true)
  })

  it('placeTemplate tags the boss spawn with isBoss', () => {
    const map = createMap(20, 20)
    const tpl = { tiles: ['#####', '#.R.#', '#####'], width: 5, height: 3 }
    const spawns = placeTemplate(map, tpl, 0, 0, 7)
    const crab = spawns.find(s => s.kind === 'crab')
    assert.ok(crab, 'expected a crab spawn')
    assert.equal(crab.isBoss, true)
  })

  it('non-boss spawns are not tagged isBoss', () => {
    const map = createMap(20, 20)
    const tpl = { tiles: ['#####', '#.W.#', '#####'], width: 5, height: 3 }
    const spawns = placeTemplate(map, tpl, 0, 0, 7)
    const weapon = spawns.find(s => s.kind === 'weapon')
    assert.ok(weapon, 'expected a weapon spawn')
    assert.equal(weapon.isBoss, undefined)
  })
})

describe('generateLevel — structure landmarks', () => {
  const structures = {
    test_keep: {
      w: 2, h: 1, targetDepth: 1,
      cells: [
        { x: 0, y: 0, skin: 'keep_wall', overlay: null, collision: 'wall', interaction: null },
        { x: 1, y: 0, skin: 'keep_gate', overlay: null, collision: 'walkable', interaction: { type: 'door' } },
      ],
    },
  }
  it('places a targetDepth structure with its exact locked skins', () => {
    const { map } = generateLevel(1, undefined, undefined, { structures })
    let found = false
    for (const row of map) for (const c of row) if (c.locked && c.skin === 'keep_wall') found = true
    assert.equal(found, true)
  })

  it('does not let one structure permanently shadow another at the same depth', () => {
    // Two single-cell structures both target depth 3. First-key-wins resolution
    // would only ever place `alpha`; random resolution lets both appear.
    const two = {
      alpha: { w: 1, h: 1, targetDepth: 3,
        cells: [{ x: 0, y: 0, skin: 'alpha_skin', overlay: null, collision: 'walkable', interaction: null }] },
      beta:  { w: 1, h: 1, targetDepth: 3,
        cells: [{ x: 0, y: 0, skin: 'beta_skin',  overlay: null, collision: 'walkable', interaction: null }] },
    }
    const seen = new Set()
    for (let i = 0; i < 40; i++) {
      const { map } = generateLevel(3, undefined, undefined, { structures: two })
      for (const row of map) for (const c of row) if (c.locked) seen.add(c.skin)
    }
    assert.ok(seen.has('alpha_skin'), 'alpha never placed')
    assert.ok(seen.has('beta_skin'), 'beta never placed (shadowed by alpha)')
  })
})
