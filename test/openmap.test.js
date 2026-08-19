import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { generateLevel } from '../renderer/systems/map.js'
import { OPEN_MAPS, OPEN_MAP_SPRITES } from '../renderer/data/open-maps.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

const DATA = OPEN_MAPS[7]

describe('buildOpenMap', () => {
  const { map, entitySpawns, playerSpawn } = buildOpenMap(DATA)

  it('produces a map with the data dimensions', () => {
    assert.equal(map.length, DATA.h)
    assert.equal(map[0].length, DATA.w)
  })

  it('mirrors the walk grid: open cells are FLOOR, blocked cells are WALL (interior)', () => {
    for (let y = 1; y < DATA.h - 1; y++) for (let x = 1; x < DATA.w - 1; x++) {
      const open = DATA.walk[y][x] === '1'
      assert.equal(isWalkable(map[y][x].tile), open, `walkability mismatch at ${x},${y}`)
      assert.equal(map[y][x].tile, open ? TILE.FLOOR : TILE.WALL)
    }
  })

  it('blocks every border cell so the camera never shows the void', () => {
    for (let x = 0; x < DATA.w; x++) {
      assert.equal(map[0][x].tile, TILE.WALL)
      assert.equal(map[DATA.h - 1][x].tile, TILE.WALL)
    }
    for (let y = 0; y < DATA.h; y++) {
      assert.equal(map[y][0].tile, TILE.WALL)
      assert.equal(map[y][DATA.w - 1].tile, TILE.WALL)
    }
  })

  it('skins every cell from the palette, with props as overlays', () => {
    let overlays = 0
    for (let y = 0; y < DATA.h; y++) for (let x = 0; x < DATA.w; x++) {
      const c = map[y][x]
      assert.equal(c.skin, DATA.palette[DATA.ground[y][x]], `ground skin at ${x},${y}`)
      const pi = DATA.prop[y][x]
      if (pi >= 0 && !entitySpawns.some(s => s.x === x && s.y === y)) {
        assert.equal(c.overlay, DATA.palette[pi], `prop overlay at ${x},${y}`)
        overlays++
      }
    }
    assert.ok(overlays > 100, 'a forest should carry many prop overlays')
  })

  it('locks every cell so a decoration pass cannot repaint the art', () => {
    for (const row of map) for (const c of row) assert.equal(c.locked, true)
  })

  it('turns chest POIs into chest spawns and drops their baked-in overlay', () => {
    const chests = DATA.pois.filter(p => p.kind === 'chest')
    assert.ok(chests.length > 0, 'Clearings has caches')
    assert.equal(entitySpawns.length, chests.length)
    for (const p of chests) {
      assert.ok(entitySpawns.some(s => s.kind === 'chest' && s.x === p.x && s.y === p.y), `spawn for cache at ${p.x},${p.y}`)
      assert.equal(map[p.y][p.x].overlay, undefined, 'chest art comes from the entity, not the map')
    }
  })

  it('spawns no enemies and no markers for scenery POIs', () => {
    assert.ok(entitySpawns.every(s => s.kind === 'chest'))
  })

  it('places the player on a walkable cell', () => {
    assert.deepEqual(playerSpawn, DATA.playerSpawn)
    assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile))
  })
})

describe('waystone exit', () => {
  it('marks the exit cell with the arch overlay and keeps it walkable', () => {
    const { map, mapExit } = buildOpenMap(DATA)
    assert.deepEqual(mapExit, DATA.exit)
    const c = map[mapExit.y][mapExit.x]
    assert.equal(c.overlay, 'ow_house_arch_stone')
    assert.equal(c.tile, TILE.FLOOR)
  })

  it('the last map has no exit and no marker', () => {
    const { mapExit } = buildOpenMap(OPEN_MAPS[15])
    assert.equal(mapExit, null)
  })
})

describe('generateLevel depth 7', () => {
  it('dispatches to the static open map', () => {
    const { map } = generateLevel(7, DATA.w, DATA.h)
    assert.equal(map.length, DATA.h)
    assert.equal(map[0].length, DATA.w)
    assert.equal(map[DATA.playerSpawn.y][DATA.playerSpawn.x].tile, TILE.FLOOR)
  })
})

describe('OPEN_MAP_SPRITES', () => {
  it('collects every palette name exactly once', () => {
    assert.equal(new Set(OPEN_MAP_SPRITES).size, OPEN_MAP_SPRITES.length)
    for (const n of DATA.palette) assert.ok(OPEN_MAP_SPRITES.includes(n))
  })
})
