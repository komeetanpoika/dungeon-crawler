import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildCaveState, restoreSurface } from '../renderer/systems/cave.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const T = 32
const dungeonMap = () => Array.from({ length: 6 }, () =>
  Array.from({ length: 8 }, () => ({ tile: TILE.FLOOR, dirty: true })))

const surfaceState = () => ({
  level: 7,
  map: [[{ tile: TILE.FLOOR }]],
  entities: [{ type: 'chest', x: 3, y: 3, opening: true }],
  player: { x: 10, y: 12, px: 10 * T + 16, py: 12 * T + 16, hp: 7, maxHp: 12, inventory: ['potion'], weapon: { name: 'Dagger' } },
  log: ['old news'],
  feedback: makeFeedback(),
  hasKey: true,
  caveEntrances: [{ x: 10, y: 12, caveDepth: 1, label: 'cave 1' }],
  run: { deepestLevel: 7, won: false },
})

describe('buildCaveState', () => {
  const surface = surfaceState()
  const entrance = { x: 10, y: 12, caveDepth: 1, label: 'cave 1' }
  const dungeon = { map: dungeonMap(), entities: [{ type: 'guard', x: 5, y: 2 }], playerSpawn: { x: 2, y: 4 }, theme: { bgColor: '#000' } }
  const cave = buildCaveState(surface, entrance, dungeon)

  it('drops the player on an up-stairs tile at the dungeon spawn', () => {
    assert.equal(cave.map[4][2].tile, TILE.STAIRS_UP)
    assert.deepEqual([cave.player.x, cave.player.y], [2, 4])
    assert.equal(cave.player.px, 2 * T + 16)
    assert.equal(cave.player.py, 4 * T + 16)
  })

  it('carries the player body (hp, inventory, weapon) down', () => {
    assert.equal(cave.player.hp, 7)
    assert.deepEqual(cave.player.inventory, ['potion'])
    assert.equal(cave.player.weapon.name, 'Dagger')
  })

  it('runs at the cave depth with fresh combat/message state', () => {
    assert.equal(cave.level, 1)
    assert.deepEqual(cave.log, [])
    assert.deepEqual(cave.projectiles, [])
    assert.equal(cave.hasKey, false)
    assert.deepEqual(cave.caveEntrances, [])
  })

  it('stashes the surface untouched and remembers the mouth and stairs', () => {
    assert.equal(cave.cave.surface, surface)
    assert.equal(surface.hasKey, true)
    assert.equal(surface.entities[0].opening, true)
    assert.deepEqual(cave.cave.mouth, { x: 10, y: 12 })
    assert.deepEqual(cave.cave.stairs, { x: 2, y: 4 })
    assert.equal(cave.cave.offStairs, false)
  })
})

describe('restoreSurface', () => {
  const surface = surfaceState()
  const entrance = { x: 10, y: 12, caveDepth: 1, label: 'cave 1' }
  const dungeon = { map: dungeonMap(), entities: [], playerSpawn: { x: 2, y: 4 }, theme: {} }
  const cave = buildCaveState(surface, entrance, dungeon)
  cave.player.hp = 3
  cave.player.inventory = []
  cave.player.weapon = { name: 'Axe' }
  const back = restoreSurface(cave)

  it('returns the stashed world exactly as it was', () => {
    assert.equal(back.map, surface.map)
    assert.equal(back.entities, surface.entities)
    assert.equal(back.level, 7)
    assert.equal(back.hasKey, true)
  })

  it('puts the changed player body back at the cave mouth', () => {
    assert.deepEqual([back.player.x, back.player.y], [10, 12])
    assert.equal(back.player.px, 10 * T + 16)
    assert.equal(back.player.hp, 3)
    assert.equal(back.player.weapon.name, 'Axe')
  })

  it('holds the entrance so the arch does not swallow the player again', () => {
    assert.equal(back.entranceHold, true)
    assert.equal(back.cave, undefined)
  })
})

describe('open map cave entrances', () => {
  const { caveEntrances } = buildOpenMap(OPEN_MAPS[7])

  it('emits a trigger for both arch cells of each dungeon entrance', () => {
    const pois = OPEN_MAPS[7].pois.filter(p => p.kind === 'dungeon_entrance')
    assert.equal(pois.length, 2)
    assert.equal(caveEntrances.length, 4)
    for (const p of pois) {
      assert.ok(caveEntrances.some(e => e.x === p.x && e.y === p.y))
      assert.ok(caveEntrances.some(e => e.x === p.x + 1 && e.y === p.y))
    }
  })

  it('maps caveDepths onto the entrances in POI order', () => {
    const byLabel = l => caveEntrances.filter(e => e.label === l)
    assert.ok(byLabel('cave 1').every(e => e.caveDepth === 1))
    assert.ok(byLabel('cave 2').every(e => e.caveDepth === 3))
  })
})
