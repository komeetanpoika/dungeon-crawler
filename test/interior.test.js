import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INTERIOR_DEPTH, INTERIOR_CONFIG, attachPickups, storyStructures } from '../renderer/systems/houses.js'
import { generateLevel } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'
import { EPISODES } from '../renderer/data/leaps.js'

const STRUCTURES = JSON.parse(readFileSync(new URL('../renderer/data/structures.json', import.meta.url)))

const gen = (tier, extra = {}) => generateLevel(INTERIOR_DEPTH, 44, 28, { config: INTERIOR_CONFIG[tier], structures: {}, ...extra })
const count = (spawns, kind, variant) => spawns.filter(s => s.kind === kind && (variant === undefined || s.variant === variant)).length
const pickupsOf = (spawns, type) => spawns.filter(s => s.kind === 'floating_pickup' && s.contents?.type === type)
// The generator now lays its own potion/weapon floating pickups, so a story
// room's items are picked out by identity: attachPickups hands the episode's
// own contents objects straight through.
const storyPickups = (spawns, pickups) => spawns.filter(s => s.kind === 'floating_pickup' && pickups.includes(s.contents))

// Flood the walkable cells from `from`; returns the reached key set.
function reachable(map, from) {
  const seen = new Set([`${from.x},${from.y}`])
  const q = [from]
  while (q.length) {
    const { x, y } = q.shift()
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile)) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

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
    const fp = storyPickups(spawns, pickups)
    assert.equal(fp.length, 2)
    assert.deepEqual(fp.map(s => s.contents).sort((a, b) => a.type.localeCompare(b.type)), pickups.slice().sort((a, b) => a.type.localeCompare(b.type)))
    for (const s of fp) assert.ok(isWalkable(map[s.y][s.x].tile))
    assert.equal(spawns.some(s => s.kind === 'pickup'), false)
  })
  it("generates Toivo's hut with storyStructures: the kitchen prefab lands with its three pickups", () => {
    const episode = EPISODES['lake-1-ferry']
    const structures = storyStructures(STRUCTURES, episode, "Toivo's hut")
    const { map, entitySpawns } = gen('hut', { structures })
    const spawns = attachPickups(entitySpawns, episode.houses["Toivo's hut"].pickups)
    const fp = storyPickups(spawns, episode.houses["Toivo's hut"].pickups)
    assert.equal(fp.length, 3)
    assert.deepEqual(
      fp.map(s => s.contents).sort((a, b) => a.type.localeCompare(b.type)),
      episode.houses["Toivo's hut"].pickups.slice().sort((a, b) => a.type.localeCompare(b.type)),
    )
    for (const s of fp) assert.ok(isWalkable(map[s.y][s.x].tile))
    assert.equal(spawns.some(s => s.kind === 'pickup'), false)
  })
})

// F2/F3: an interior is a home, not a dungeon room — no chests to open, no
// gargoyle fountains on the wall. Loot lies on the floor as walk-into pickups.
describe('interior loot and dressing', () => {
  it('never emits a chest spawn at any tier', () => {
    for (const tier of ['safe', 'hut', 'ruin'])
      for (let i = 0; i < 10; i++)
        assert.equal(count(gen(tier).entitySpawns, 'chest'), 0, tier)
  })

  it('never places a fountain gargoyle or basin indoors', () => {
    for (const tier of ['safe', 'hut', 'ruin'])
      for (let i = 0; i < 10; i++) {
        const s = gen(tier).entitySpawns
        assert.equal(count(s, 'fountain_wall'), 0, tier)
        assert.equal(count(s, 'fountain_basin'), 0, tier)
      }
  })

  it('lays potions on the floor as floating pickups of 4', () => {
    let seen = 0
    for (const tier of ['safe', 'hut', 'ruin'])
      for (let i = 0; i < 10; i++)
        for (const p of pickupsOf(gen(tier).entitySpawns, 'potion')) {
          seen++
          assert.deepEqual(p.contents, { type: 'potion', amount: 4 })
          assert.equal(typeof p.x, 'number'); assert.equal(typeof p.y, 'number')
        }
    assert.ok(seen > 0, 'some interior laid out potions')
  })

  it('leaves no weapons in a safe house or a hut, and only daggers/swords in a ruin', () => {
    assert.equal(INTERIOR_CONFIG.safe.weaponDensity, 0)
    assert.equal(INTERIOR_CONFIG.hut.weaponDensity, 0)
    assert.deepEqual(INTERIOR_CONFIG.ruin.weaponPool, ['dagger', 'sword'])
    for (const tier of ['safe', 'hut'])
      for (let i = 0; i < 10; i++) assert.equal(pickupsOf(gen(tier).entitySpawns, 'weapon').length, 0, tier)
    let seen = 0
    for (let i = 0; i < 20; i++)
      for (const p of pickupsOf(gen('ruin').entitySpawns, 'weapon')) {
        seen++
        assert.ok(['dagger', 'sword'].includes(p.contents.weaponType), p.contents.weaponType)
        assert.equal(p.contents.name, p.contents.weaponType === 'dagger' ? 'Dagger' : 'Sword')
      }
    assert.ok(seen > 0, 'a ruin laid out weapons')
  })
})

// F6: the story rooms' solid furniture blocks, so the room must still be
// walkable end to end — every item on the floor has to be reachable on foot.
describe('story house reachability', () => {
  for (const [map, story] of [['lake-1-ferry', "Toivo's hut"], ['highland-2-fold', "Aino's house"], ['marsh-3-hermit', 'hermit hut']]) {
    it(`walks from the spawn to every pickup in ${story}`, () => {
      const episode = EPISODES[map]
      const structures = storyStructures(STRUCTURES, episode, story)
      for (let i = 0; i < 20; i++) {
        const { map: grid, entitySpawns, playerSpawn } = gen('hut', { structures })
        const spawns = attachPickups(entitySpawns, episode.houses[story].pickups)
        const fp = spawns.filter(s => s.kind === 'floating_pickup')
        assert.equal(storyPickups(spawns, episode.houses[story].pickups).length, episode.houses[story].pickups.length, `${story} run ${i}`)
        const seen = reachable(grid, playerSpawn)
        for (const s of fp) assert.ok(seen.has(`${s.x},${s.y}`), `${story} run ${i}: pickup at ${s.x},${s.y} unreachable`)
      }
    })
  }
})
