import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { openGate, updateGates } from '../renderer/systems/gates.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { TILE } from '../renderer/systems/entities.js'

// Synthetic 12x8 open map with one dungeon entrance at (4,3) — arch cells
// (4,3)+(5,3), gargoyle flanks (3,3)+(6,3), basins (3,4)+(6,4). A baked rock
// prop sits on a flank cell to prove the stamp clears it.
const mkData = () => ({
  name: 'test-map', w: 12, h: 8,
  palette: ['ow_grass_0', 'ow_cave_arch_1', 'ow_rock_gray_0'],
  ground: Array.from({ length: 8 }, () => Array(12).fill(0)),
  prop:   Array.from({ length: 8 }, (_, y) => Array.from({ length: 12 }, (_, x) =>
    (y === 3 && x === 5) ? 1 : (y === 3 && x === 6) ? 2 : -1)),
  walk:   Array.from({ length: 8 }, () => '111111111111'),
  pois: [{ kind: 'dungeon_entrance', x: 4, y: 3, label: 'cave 1' }],
  caveDepths: [1],
  playerSpawn: { x: 1, y: 1 },
})

describe('gate assembly stamping', () => {
  const { map, entitySpawns, gates } = buildOpenMap(mkData())

  it('closes the arch cells with the vined gate overlays', () => {
    assert.equal(map[3][4].overlay, 'ow_cave_gate_l')
    assert.equal(map[3][5].overlay, 'ow_cave_gate_r')
    assert.equal(map[3][4].tile, TILE.FLOOR)
    assert.equal(map[3][5].tile, TILE.FLOOR)
  })

  it('turns the flank cells into blocking gargoyle walls with no baked art', () => {
    for (const x of [3, 6]) {
      assert.equal(map[3][x].tile, TILE.WALL, `flank ${x},3 blocks`)
      assert.equal(map[3][x].overlay, undefined, `flank ${x},3 art comes from the entity`)
    }
    const walls = entitySpawns.filter(s => s.kind === 'fountain_wall')
    assert.deepEqual(walls.map(w => [w.x, w.y]).sort(), [[3, 3], [6, 3]])
    for (const w of walls) {
      assert.equal(w.propType, 'prop_gargoyle_dry')
      assert.equal(w.gateId, 'cave 1')
      assert.deepEqual([w.pairX, w.pairY], [w.x, w.y + 1])
    }
  })

  it('places walkable empty basins in front of the gargoyles', () => {
    const basins = entitySpawns.filter(s => s.kind === 'fountain_basin')
    assert.deepEqual(basins.map(b => [b.x, b.y]).sort(), [[3, 4], [6, 4]])
    for (const b of basins) {
      assert.equal(b.propType, 'prop_fountain_empty')
      assert.equal(b.gateId, 'cave 1')
      assert.deepEqual([b.pairX, b.pairY], [b.x, b.y - 1])
      assert.equal(map[b.y][b.x].tile, TILE.FLOOR)
      assert.equal(map[b.y][b.x].overlay, undefined)
    }
  })

  it('returns a closed fountain-trigger gate holding its open-art cells', () => {
    assert.deepEqual(gates, {
      'cave 1': {
        open: false, trigger: 'fountains',
        cells: [
          { x: 4, y: 3, overlay: 'ow_cave_arch_0' },
          { x: 5, y: 3, overlay: 'ow_cave_arch_1' },
        ],
      },
    })
  })

  it('stamps both entrances of the real first level', () => {
    const built = buildOpenMap(OPEN_MAPS[7])
    assert.equal(Object.keys(built.gates).length, 2)
    assert.equal(built.entitySpawns.filter(s => s.kind === 'fountain_wall').length, 4)
    assert.equal(built.entitySpawns.filter(s => s.kind === 'fountain_basin').length, 4)
    for (const p of OPEN_MAPS[7].pois.filter(p => p.kind === 'dungeon_entrance')) {
      assert.equal(built.map[p.y][p.x].overlay, 'ow_cave_gate_l')
      assert.equal(built.map[p.y][p.x + 1].overlay, 'ow_cave_gate_r')
    }
  })
})

// A minimal live state: the built map + gates, and the fountain-wall
// entities as game.js buildEntities would create them.
const mkState = () => {
  const { map, gates } = buildOpenMap(mkData())
  const walls = [
    { type: 'prop', isFountainWall: true, flowing: false, gateId: 'cave 1', x: 3, y: 3 },
    { type: 'prop', isFountainWall: true, flowing: false, gateId: 'cave 1', x: 6, y: 3 },
  ]
  return { map, gates, entities: walls }
}

describe('openGate', () => {
  it('swaps the closed overlays for the open arch and marks the gate open', () => {
    const state = mkState()
    openGate(state, 'cave 1')
    assert.equal(state.gates['cave 1'].open, true)
    assert.equal(state.map[3][4].overlay, 'ow_cave_arch_0')
    assert.equal(state.map[3][5].overlay, 'ow_cave_arch_1')
  })
})

describe('updateGates with the fountains trigger', () => {
  it('stays closed while only one gargoyle flows', () => {
    const state = mkState()
    state.entities[0].flowing = true
    updateGates(state)
    assert.equal(state.gates['cave 1'].open, false)
    assert.equal(state.map[3][4].overlay, 'ow_cave_gate_l')
  })

  it('opens when every gargoyle of the gate flows', () => {
    const state = mkState()
    state.entities[0].flowing = true
    state.entities[1].flowing = true
    updateGates(state)
    assert.equal(state.gates['cave 1'].open, true)
    assert.equal(state.map[3][4].overlay, 'ow_cave_arch_0')
  })

  it('latches: un-flowing a gargoyle later does not re-close it', () => {
    const state = mkState()
    state.entities[0].flowing = true
    state.entities[1].flowing = true
    updateGates(state)
    state.entities[1].flowing = false
    updateGates(state)
    assert.equal(state.gates['cave 1'].open, true)
    assert.equal(state.map[3][4].overlay, 'ow_cave_arch_0')
  })
})

describe('adventure save shape', () => {
  it('normalizes a missing gates record to an empty map', () => {
    assert.deepEqual(normalizeAdventureSave(null).gates, {})
    assert.deepEqual(normalizeAdventureSave({ caves: {}, progress: { mapDepth: 7, cleared: {} } }).gates, {})
  })

  it('keeps saved open-gate lists through normalization', () => {
    const raw = { caves: {}, progress: { mapDepth: 7, cleared: {} }, gates: { 'forest-1-clearings': ['cave 1'] } }
    assert.deepEqual(normalizeAdventureSave(raw).gates, { 'forest-1-clearings': ['cave 1'] })
  })
})
