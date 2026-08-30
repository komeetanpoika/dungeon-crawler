import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { isHouseDoorArt, houseDoorsForMap } from '../renderer/systems/houses.js'
import { EPISODES } from '../renderer/data/leaps.js'

const REQUIRED = {
  'lake-1-ferry':     ['runestone', 'village', 'bell', 'pier end', 'nakki', 'pier gap 1', 'pier gap 2', 'islet cache'],
  'highland-2-fold':  ['runestone', 'village', 'fold', 'den', 'burrow', 'lair', 'fleece cache', 'burn 1', 'burn 2', 'burn 3', 'burn 4'],
  'marsh-3-hermit':   ['runestone', 'village', 'hearth', 'hermit hut', 'mushroom ring', 'hearth 1', 'hearth 2', 'hearth 3'],
}
const byName = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, m]))

// 4-neighbour BFS over a map's `walk` grid ('1' = passable), starting from
// `starts` ([x, y] pairs). `passable(x, y)` overrides walkability per cell —
// pass it something that also treats certain props as passable to simulate
// felling them. Returns the set of reached "x,y" keys.
function bfsReachable(data, starts, passable) {
  const seen = new Set(starts.map(([x, y]) => `${x},${y}`))
  const queue = [...starts]
  while (queue.length) {
    const [x, y] = queue.shift()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`
      if (nx < 0 || ny < 0 || ny >= data.h || nx >= data.w || seen.has(key)) continue
      if (!passable(nx, ny)) continue
      seen.add(key)
      queue.push([nx, ny])
    }
  }
  return seen
}

const walkable = data => (x, y) => data.walk[y]?.[x] === '1'
const isTreeProp = data => (x, y) => {
  const idx = data.prop[y]?.[x]
  return idx >= 0 && /^(ow_tree_|ow_deadtree_|ow_bush_)/.test(data.palette[idx])
}

for (const [name, labels] of Object.entries(REQUIRED)) {
  describe(name, { skip: !byName[name] && 'not exported yet' }, () => {
    const data = byName[name]
    it('is a leap map with one cave, an exit and a starter-free spawn', () => {
      assert.equal(data.leap, true)
      assert.equal(data.pois.filter(p => p.kind === 'dungeon_entrance').length, 1)
      assert.equal(data.caveDepths.length, 1)
      assert.ok(data.exit)
      assert.equal(data.starter, null)
    })
    for (const label of labels) it(`declares POI "${label}"`, () => {
      assert.ok(data.pois.some(p => p.label === label), `missing ${label}`)
    })
    it('builds; spawn and every POI sit on or beside walkable floor', () => {
      const { map } = buildOpenMap(data)
      const open = (x, y) => map[y]?.[x]?.tile === TILE.FLOOR
      const near = (x, y) => open(x, y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => open(x + dx, y + dy))
      assert.ok(open(data.playerSpawn.x, data.playerSpawn.y), 'spawn')
      for (const p of data.pois) assert.ok(near(p.x, p.y), `poi ${p.label} at ${p.x},${p.y}`)
    })
    it('has at least three caches', () => {
      assert.ok(data.pois.filter(p => p.kind === 'chest').length >= 3)
    })

    if (name === 'lake-1-ferry') {
      const spawn = [data.playerSpawn.x, data.playerSpawn.y]
      const poi = label => { const p = data.pois.find(q => q.label === label); return [p.x, p.y] }
      const reachedAt = (set, [x, y]) => set.has(`${x},${y}`)

      it('the islet, the pier gap and the orchard are unreachable by plain walking from spawn', () => {
        const reached = bfsReachable(data, [spawn], walkable(data))
        assert.ok(!reachedAt(reached, poi('islet cache')), 'islet cache should be unreachable')
        assert.ok(!reachedAt(reached, poi('pier gap 1')), 'pier gap 1 should be unreachable')
        assert.ok(!reachedAt(reached, poi('orchard')), 'orchard should be unreachable')
      })

      it('the islet becomes reachable once its tree ring/connector is treated as felled', () => {
        const passable = (x, y) => walkable(data)(x, y) || isTreeProp(data)(x, y)
        const reached = bfsReachable(data, [spawn], passable)
        assert.ok(reachedAt(reached, poi('islet cache')), 'islet cache should be reachable with trees felled')
      })

      it('the orchard is reachable from the pier gap once the gap itself is crossable', () => {
        const [g1x, g1y] = poi('pier gap 1')
        const [g2x, g2y] = poi('pier gap 2')
        const passable = (x, y) => walkable(data)(x, y) || (x === g1x && y === g1y) || (x === g2x && y === g2y)
        const reached = bfsReachable(data, [poi('pier gap 2')], passable)
        assert.ok(reachedAt(reached, poi('orchard')), 'orchard should be reachable once the gap is crossed')
      })
    }

    if (name === 'highland-2-fold') {
      it('homes three wolves at the den and seals the burrow with rocks', () => {
        assert.deepEqual(data.npcs.at.den, ['wolf', 'wolf', 'wolf'])
        assert.equal((data.npcs.wild ?? []).filter(s => s === 'wolf').length, 0, 'no loose wolves')
        const burrow = data.pois.find(p => p.label === 'burrow')
        const rocks = [[0, 0], [-1, 0], [1, 0]].filter(([dx, dy]) => (data.palette[data.prop[burrow.y + dy][burrow.x + dx]] ?? '').startsWith('ow_rock_'))
        assert.equal(rocks.length, 3)
      })

      for (let n = 1; n <= 4; n++) it(`burn ${n} has enough fuel to be a real burn stage`, () => {
        const p = data.pois.find(q => q.label === `burn ${n}`)
        let trees = 0
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
          const idx = data.prop[p.y + dy]?.[p.x + dx]
          if (idx >= 0 && data.palette[idx].startsWith('ow_tree_')) trees++
        }
        assert.ok(trees >= 20, `burn ${n} has only ${trees} tree cells within radius 6`)
      })

      const spawn = [data.playerSpawn.x, data.playerSpawn.y]
      const poi = label => { const p = data.pois.find(q => q.label === label); return [p.x, p.y] }
      const reachedAt = (set, [x, y]) => set.has(`${x},${y}`)
      const isRockProp = data => (x, y) => {
        const idx = data.prop[y]?.[x]
        return idx >= 0 && data.palette[idx].startsWith('ow_rock_')
      }

      it('the lair is unreachable by plain walking from spawn', () => {
        const reached = bfsReachable(data, [spawn], walkable(data))
        assert.ok(!reachedAt(reached, poi('lair')), 'lair should be unreachable')
      })

      it('the lair becomes reachable once the burrow rocks are treated as passable', () => {
        const passable = (x, y) => walkable(data)(x, y) || isRockProp(data)(x, y)
        const reached = bfsReachable(data, [spawn], passable)
        assert.ok(reachedAt(reached, poi('lair')), 'lair should be reachable with rocks passable')
      })

      it("Aino's house is a declared landmark POI on a door cell", () => {
        const p = data.pois.find(q => q.label === "Aino's house")
        assert.ok(p, "Aino's house POI missing")
        assert.equal(p.kind, 'landmark')
        assert.equal(isHouseDoorArt(data.palette[data.prop[p.y][p.x]]), true)
      })
    }

    if (name === 'marsh-3-hermit') {
      it('the hermit hut is a landmark, so only the real village anchors the village npcs', () => {
        const huts = data.pois.filter(p => p.label === 'hermit hut')
        assert.equal(huts.length, 1)
        assert.equal(huts[0].kind, 'landmark')
        assert.equal(data.pois.filter(p => p.kind === 'village' || p.kind === 'camp').length, 1)
      })

      it('the three village hearths carry the cold hearth prop', () => {
        for (const n of [1, 2, 3]) {
          const p = data.pois.find(q => q.label === `hearth ${n}`)
          assert.equal(data.palette[data.prop[p.y][p.x]], 'prop_hearth_cold')
        }
      })

      const spawn = [data.playerSpawn.x, data.playerSpawn.y]
      const poi = label => { const p = data.pois.find(q => q.label === label); return [p.x, p.y] }
      // Hearth props (and the cave arch) are non-walkable overlays, so
      // "reached" means the walk grid reaches the cell itself or a cell
      // orthogonally beside it — the same rule buildOpenMap's own POI test
      // above uses for spawn/POI adjacency.
      const reachedNear = (reached, [x, y]) =>
        reached.has(`${x},${y}`) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reached.has(`${x + dx},${y + dy}`))

      it('spawn reaches the hearths, hermit hut, mushroom ring, cave and every cache over plain walk', () => {
        const reached = bfsReachable(data, [spawn], walkable(data))
        for (const label of ['hearth', 'hermit hut', 'mushroom ring', 'hearth 1', 'hearth 2', 'hearth 3'])
          assert.ok(reachedNear(reached, poi(label)), `${label} should be reachable`)
        const cave = data.pois.find(p => p.kind === 'dungeon_entrance')
        assert.ok(reachedNear(reached, [cave.x, cave.y]), 'the cave should be reachable')
        for (const c of data.pois.filter(p => p.kind === 'chest'))
          assert.ok(reachedNear(reached, [c.x, c.y]), `cache at ${c.x},${c.y} should be reachable`)
      })
    }
  })
}

describe('gen-forest maps are unchanged by the kit refactor', () => {
  it('forest-1-clearings JSON on disk still matches the exported data', () => {
    const json = JSON.parse(readFileSync(new URL('../tools/static-overworld/out/maps/forest-1-clearings.json', import.meta.url)))
    const data = byName['forest-1-clearings']
    assert.deepEqual(json.ground, data.ground)
    assert.deepEqual(json.prop, data.prop)
    assert.deepEqual(json.walk, data.walk)
    assert.deepEqual(json.pois, data.pois)
    assert.deepEqual(json.playerSpawn, data.playerSpawn)
  })
})

describe('story houses', () => {
  const REQUIRED_ITEMS = {
    'lake-1-ferry':   { house: "Toivo's hut", hatchet: true, lumber: 3, meat: 3 },
    'highland-2-fold': { house: "Aino's house" },
    'marsh-3-hermit': { house: 'hermit hut', hatchet: true, lumber: 3 },
  }

  for (const [mapName, req] of Object.entries(REQUIRED_ITEMS)) {
    it(`${mapName}: the "${req.house}" POI exists and resolves to exactly one door`, () => {
      const data = byName[mapName]
      assert.ok(data.pois.some(p => p.label === req.house), `missing POI ${req.house}`)
      const doors = houseDoorsForMap(data, EPISODES[mapName]).filter(d => d.story === req.house)
      assert.equal(doors.length, 1, `expected exactly one door resolving to ${req.house}`)
    })

    it(`${mapName}: "${req.house}" carries the episode's required items`, () => {
      const pickups = EPISODES[mapName].houses[req.house].pickups
      if (req.hatchet) {
        const hatchet = pickups.find(p => p.type === 'weapon' && p.weaponType === 'hatchet')
        assert.ok(hatchet, 'missing hatchet pickup')
        assert.deepEqual(
          { weaponType: hatchet.weaponType, name: hatchet.name, damage: hatchet.damage, chop: hatchet.chop },
          weaponContents('hatchet'),
        )
      }
      if (req.lumber) {
        const lumber = pickups.filter(p => p.type === 'lumber').reduce((n, p) => n + (p.count ?? 0), 0)
        assert.ok(lumber >= req.lumber, `expected lumber >= ${req.lumber}, got ${lumber}`)
      }
      if (req.meat) {
        const meat = pickups.filter(p => p.type === 'meat').reduce((n, p) => n + (p.count ?? 0), 0)
        assert.ok(meat >= req.meat, `expected meat >= ${req.meat}, got ${meat}`)
      }
    })
  }
})
