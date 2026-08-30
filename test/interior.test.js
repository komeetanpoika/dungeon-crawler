import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { INTERIOR_DEPTH, INTERIOR_CONFIG, attachPickups } from '../renderer/systems/houses.js'
import { generateLevel } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'

const gen = (tier, extra = {}) => generateLevel(INTERIOR_DEPTH, 44, 28, { config: INTERIOR_CONFIG[tier], structures: {}, ...extra })
const count = (spawns, kind, variant) => spawns.filter(s => s.kind === kind && (variant === undefined || s.variant === variant)).length

describe('interior config', () => {
  it('has the three tiers with the spec densities and no boss/landmark/guards', () => {
    for (const t of ['safe', 'hut', 'ruin']) { const c = INTERIOR_CONFIG[t]; assert.equal(c.depth, 19); assert.equal(c.landmark, null); assert.equal(c.guardCount, 0); assert.equal(c.trapDensity, 0) }
    assert.equal(INTERIOR_CONFIG.safe.monsterDensity, 0); assert.equal(INTERIOR_CONFIG.hut.monsterDensity, 0.006); assert.equal(INTERIOR_CONFIG.ruin.monsterDensity, 0.010)
    assert.deepEqual(INTERIOR_CONFIG.hut.variantPool, ['weak'])
    assert.ok(DEPTH_THEMES.find(t => t.depths.includes(19))?.floorTile === 'floor_wood')
  })
})

describe('generated interiors', () => {
  it('safe houses have no enemies; huts have only rats; ruins have spiders and a strong one', () => {
    // Ruin monster counts must hold per generation, not just in aggregate:
    // spec section 2 guarantees a ruin "1 strong" monster, so
    // INTERIOR_CONFIG.ruin carries guaranteed: ['strong', 'medium']
    // (houses.js) and generateLevel places those variants deterministically
    // ahead of the density roll, rather than leaving them to chance.
    for (let i = 0; i < 5; i++) {
      const s = gen('safe').entitySpawns; assert.equal(count(s, 'monster'), 0); assert.equal(count(s, 'guard'), 0)
      const h = gen('hut').entitySpawns; assert.ok(count(h, 'monster') >= 1); assert.equal(count(h, 'monster'), count(h, 'monster', 'weak'))
      const r = gen('ruin').entitySpawns; assert.ok(count(r, 'monster', 'medium') >= 1); assert.ok(count(r, 'monster', 'strong') >= 1); assert.equal(count(r, 'monster', 'boss'), 0)
    }
  })
  it('floors are wooden and walkable, the map is 44x28 with a stairs-free spawn', () => {
    const { map, playerSpawn } = gen('safe')
    assert.equal(map.length, 28); assert.equal(map[0].length, 44)
    const floors = map.flat().filter(c => isWalkable(c.tile))
    assert.ok(floors.length > 100)
    assert.ok(floors.every(c => c.tile === TILE.FLOOR_WOOD || c.tile === TILE.FLOOR), 'wood or plain floor only')
    assert.ok(floors.filter(c => c.tile === TILE.FLOOR_WOOD).length / floors.length > 0.9)
    assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile))
  })
  it('a story prefab becomes the landmark room and its pickup slots become floating pickups', () => {
    const prefab = { w: 3, h: 3, targetDepth: 19, cells: [
      ...[0, 1, 2].flatMap(x => [0, 2].map(y => ({ x, y, skin: 'tile_0040', overlay: null, collision: 'wall', interaction: null }))),
      { x: 0, y: 1, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 0 } },
      { x: 1, y: 1, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: null },
      { x: 2, y: 1, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 1 } },
    ] }
    const pickups = [{ type: 'meat', count: 3 }, { type: 'weapon', weaponType: 'hatchet' }]
    const { map, entitySpawns } = gen('hut', { structures: { toivo: prefab } })
    const spawns = attachPickups(entitySpawns, pickups)
    const fp = spawns.filter(s => s.kind === 'floating_pickup')
    assert.equal(fp.length, 2)
    assert.deepEqual(fp.map(s => s.contents).sort((a, b) => a.type.localeCompare(b.type)), pickups.slice().sort((a, b) => a.type.localeCompare(b.type)))
    for (const s of fp) assert.ok(isWalkable(map[s.y][s.x].tile))
    assert.equal(spawns.some(s => s.kind === 'pickup'), false)
  })
})
