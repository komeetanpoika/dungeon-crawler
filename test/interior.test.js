import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INTERIOR_DEPTH, INTERIOR_CONFIG, attachPickups, storyStructures } from '../renderer/systems/houses.js'
import { generateInterior } from '../renderer/systems/interior.js'
import { HOUSE_LAYOUTS, STORY_SLOT_W, STORY_SLOT_H } from '../renderer/data/house-layouts.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'
import { EPISODES } from '../renderer/data/leaps.js'

const STRUCTURES = JSON.parse(readFileSync(new URL('../renderer/data/structures.json', import.meta.url)))
const STORY_ROOMS = ['toivo_kitchen', 'aino_larder', 'hermit_woodpile']

const gen = (tier, extra = {}) => generateInterior(INTERIOR_CONFIG[tier], { structures: {}, ...extra })
const count = (spawns, kind, variant) => spawns.filter(s => s.kind === kind && (variant === undefined || s.variant === variant)).length
const pickupsOf = (spawns, type) => spawns.filter(s => s.kind === 'floating_pickup' && s.contents?.type === type)
const storyPickups = (spawns, pickups) => spawns.filter(s => s.kind === 'floating_pickup' && pickups.includes(s.contents))
const floorsOf = map => map.flat().filter(c => isWalkable(c.tile))

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
  it('has the three tiers with count ranges: safe = no monsters, hut = rats only, ruin = a strong and a medium', () => {
    for (const t of ['safe', 'hut', 'ruin']) assert.equal(INTERIOR_CONFIG[t].depth, 19)
    assert.deepEqual(INTERIOR_CONFIG.safe.monsters, [0, 0])
    assert.ok(INTERIOR_CONFIG.hut.monsters[0] >= 1)
    assert.deepEqual(INTERIOR_CONFIG.hut.variantPool, ['weak'])
    assert.deepEqual(INTERIOR_CONFIG.ruin.guaranteed, ['strong', 'medium'])
    assert.ok(DEPTH_THEMES.find(t => t.depths.includes(19))?.floorTile === 'floor_wood')
  })
})

describe('house layouts', () => {
  it('are five rectangular plans of at most 40x40 with one entry tile each', () => {
    assert.equal(HOUSE_LAYOUTS.length, 5)
    for (const l of HOUSE_LAYOUTS) {
      const w = l.rows[0].length, h = l.rows.length
      assert.ok(w <= 40 && h <= 40, `${l.name} is ${w}x${h}`)
      assert.ok(l.rows.every(r => r.length === w), `${l.name} has ragged rows`)
      assert.equal(l.rows.join('').split('@').length - 1, 1, `${l.name} entry tiles`)
      assert.ok(/^[#.@ ]+$/.test(l.rows.join('')), `${l.name} unknown glyph`)
    }
  })
  it('have distinct names', () => {
    assert.equal(new Set(HOUSE_LAYOUTS.map(l => l.name)).size, HOUSE_LAYOUTS.length)
  })
  it('walk from the entry to every floor cell', () => {
    for (const layout of HOUSE_LAYOUTS) {
      const { map, playerSpawn } = gen('safe', { layout })
      assert.equal(map.length, layout.rows.length); assert.equal(map[0].length, layout.rows[0].length)
      assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile))
      const floors = floorsOf(map)
      assert.equal(reachable(map, playerSpawn).size, floors.length, `${layout.name} disconnected`)
    }
  })
  it('draw the story slot as the prefab silhouette, doorway included', () => {
    for (const l of HOUSE_LAYOUTS) {
      const at = (x, y) => l.rows[y]?.[x] ?? '#'
      for (let py = 0; py < STORY_SLOT_H; py++) for (let px = 0; px < STORY_SLOT_W; px++) {
        const isWall = py <= 1 || px === 0 || px === STORY_SLOT_W - 1 || (py === STORY_SLOT_H - 1 && px !== 4)
        const ch = at(l.slot.x + px, l.slot.y + py)
        assert.equal(ch === '#' || ch === ' ', isWall, `${l.name} slot cell ${px},${py} is '${ch}'`)
      }
    }
  })
  it('hold every story prefab with all its pickups reachable, in every layout', () => {
    for (const layout of HOUSE_LAYOUTS) for (const room of STORY_ROOMS) {
      const prefab = STRUCTURES[room]
      assert.ok(prefab && prefab.w === STORY_SLOT_W && prefab.h === STORY_SLOT_H, room)
      const structures = { [room]: { ...prefab, targetDepth: INTERIOR_DEPTH } }
      const { map, entitySpawns, playerSpawn } = gen('hut', { structures, layout })
      const slots = entitySpawns.filter(s => s.kind === 'pickup')
      assert.equal(slots.length, prefab.cells.filter(c => c.interaction?.type === 'pickup').length, `${layout.name}/${room} slots`)
      const seen = reachable(map, playerSpawn)
      assert.equal(seen.size, floorsOf(map).length, `${layout.name}/${room} disconnected`)
      for (const s of slots) assert.ok(seen.has(`${s.x},${s.y}`), `${layout.name}/${room} slot at ${s.x},${s.y} unreachable`)
    }
  })
})

describe('generated interiors', () => {
  it('safe houses have no enemies; huts have only rats; ruins have spiders and a strong one', () => {
    for (let i = 0; i < 10; i++) {
      const s = gen('safe').entitySpawns; assert.equal(count(s, 'monster'), 0); assert.equal(count(s, 'guard'), 0)
      const h = gen('hut').entitySpawns; assert.ok(count(h, 'monster') >= 1); assert.equal(count(h, 'monster'), count(h, 'monster', 'weak'))
      const r = gen('ruin').entitySpawns; assert.ok(count(r, 'monster', 'medium') >= 1); assert.ok(count(r, 'monster', 'strong') >= 1); assert.equal(count(r, 'monster', 'boss'), 0)
    }
  })
  it('picks one of the five layouts at random, so every layout shows up', () => {
    const seen = new Set()
    for (let i = 0; i < 200 && seen.size < HOUSE_LAYOUTS.length; i++) seen.add(gen('safe').layout)
    assert.deepEqual([...seen].sort(), HOUSE_LAYOUTS.map(l => l.name).sort())
  })
  it('floors are wooden and walkable with a stairs-free spawn', () => {
    for (let i = 0; i < 10; i++) {
      const { map, playerSpawn } = gen('safe')
      assert.ok(map.length <= 40 && map[0].length <= 40)
      const floors = floorsOf(map)
      assert.ok(floors.length > 50)
      assert.ok(floors.every(c => c.tile === TILE.FLOOR_WOOD), 'wood floor only')
      assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile))
    }
  })
  it('never stacks two spawns on one cell or on the entry tile', () => {
    for (const tier of ['safe', 'hut', 'ruin']) for (let i = 0; i < 10; i++) {
      const { entitySpawns, playerSpawn } = gen(tier)
      const keys = entitySpawns.map(s => `${s.x},${s.y}`)
      assert.equal(new Set(keys).size, keys.length, `${tier}: stacked spawns`)
      assert.ok(!keys.includes(`${playerSpawn.x},${playerSpawn.y}`), `${tier}: spawn on entry`)
    }
  })
  it('a story prefab lands in the slot and its pickup slots become floating pickups', () => {
    const prefab = { w: 9, h: 7, targetDepth: 19, cells: [
      ...Array.from({ length: 9 }, (_, x) => [0, 1, 6].map(y => ({ x, y, skin: 'tile_0040', overlay: null, collision: x === 4 && y === 6 ? 'walkable' : 'wall', interaction: null }))).flat(),
      ...[2, 3, 4, 5].flatMap(y => [0, 8].map(x => ({ x, y, skin: 'tile_0040', overlay: null, collision: 'wall', interaction: null }))),
      { x: 1, y: 2, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 0 } },
      { x: 7, y: 5, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 1 } },
    ] }
    const pickups = [{ type: 'meat', count: 3 }, { type: 'weapon', weaponType: 'hatchet' }]
    const { map, entitySpawns } = gen('hut', { structures: { toivo: prefab } })
    const spawns = attachPickups(entitySpawns, pickups)
    const fp = storyPickups(spawns, pickups)
    assert.equal(fp.length, 2)
    for (const s of fp) { assert.ok(isWalkable(map[s.y][s.x].tile)); assert.equal(map[s.y][s.x].locked, true) }
    assert.equal(spawns.some(s => s.kind === 'pickup'), false)
  })
  it("generates Toivo's hut with storyStructures: the kitchen prefab lands with its three pickups", () => {
    const episode = EPISODES['lake-1-ferry']
    const structures = storyStructures(STRUCTURES, episode, "Toivo's hut")
    const { map, entitySpawns } = gen('hut', { structures })
    const spawns = attachPickups(entitySpawns, episode.houses["Toivo's hut"].pickups)
    const fp = storyPickups(spawns, episode.houses["Toivo's hut"].pickups)
    assert.equal(fp.length, 3)
    for (const s of fp) assert.ok(isWalkable(map[s.y][s.x].tile))
    assert.equal(spawns.some(s => s.kind === 'pickup'), false)
  })
})

// F2/F3: an interior is a home, not a dungeon room — no chests to open, no
// gargoyle fountains on the wall. Loot lies on the floor as walk-into pickups.
describe('interior loot and dressing', () => {
  it('never emits a chest, fountain, trap or guard spawn at any tier', () => {
    for (const tier of ['safe', 'hut', 'ruin'])
      for (let i = 0; i < 10; i++)
        for (const kind of ['chest', 'fountain_wall', 'fountain_basin', 'trap', 'guard', 'exit_door'])
          assert.equal(count(gen(tier).entitySpawns, kind), 0, `${tier} ${kind}`)
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
    assert.deepEqual(INTERIOR_CONFIG.safe.weapons, [0, 0])
    assert.deepEqual(INTERIOR_CONFIG.hut.weapons, [0, 0])
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

  it('dresses the rooms with the tier prop pool, never on a story prefab cell', () => {
    const episode = EPISODES['lake-1-ferry']
    const structures = storyStructures(STRUCTURES, episode, "Toivo's hut")
    for (const tier of ['safe', 'hut', 'ruin']) for (let i = 0; i < 10; i++) {
      const { map, entitySpawns } = gen(tier, { structures })
      const props = entitySpawns.filter(s => s.kind === 'prop')
      assert.ok(props.length >= 1, `${tier}: no props`)
      for (const p of props) {
        assert.ok(INTERIOR_CONFIG[tier].props.includes(p.propType), p.propType)
        assert.ok(!map[p.y][p.x].locked, `${tier}: prop on the story room`)
      }
    }
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
