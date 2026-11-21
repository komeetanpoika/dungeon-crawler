// House interiors through the game's door: the real doors of the hand-made
// open maps and their story houses, built the way game.js enterHouse builds
// them. The parts are tested on their own in test/interior-*.test.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateInterior, houseSpec, INTERIOR_SKINS } from '../renderer/systems/interior.js'
import { houseDoorsForMap, INTERIOR_DEPTH } from '../renderer/systems/houses.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { EPISODES } from '../renderer/data/leaps.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'

const doorsOf = data => houseDoorsForMap(data, EPISODES[data.name] ?? null)
const allDoors = Object.values(OPEN_MAPS).flatMap(data => doorsOf(data).map(d => ({ data, d })))

function reach(map, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile, map[ny][nx])) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

describe('every door of the hand-made maps', () => {
  it('opens on a house you can walk all of, from a front door in its south wall', () => {
    assert.ok(allDoors.length > 20, `${allDoors.length} doors`)
    for (const { data, d } of allDoors) {
      const g = generateInterior(houseSpec(d, { story: EPISODES[data.name]?.houses?.[d.story] ?? null }))
      const seen = reach(g.map, g.playerSpawn)
      g.map.forEach((row, y) => row.forEach((c, x) => { if (isWalkable(c.tile, c)) assert.ok(seen.has(`${x},${y}`), `${d.label}: ${x},${y} cut off`) }))
      assert.deepEqual(g.exit, { x: g.playerSpawn.x, y: g.playerSpawn.y + 1 })
      assert.equal(g.exit.y, g.map.length - 1)
      assert.ok(g.map.length <= 20 && g.map[0].length <= 24)
      for (const row of g.map) for (const c of row) for (const n of [c.skin, c.deco, c.overlay]) if (n) assert.ok(INTERIOR_SKINS.includes(n), `${n} is not loaded`)
    }
  })
  it('is the same house every time it is opened', () => {
    for (const { data, d } of allDoors.slice(0, 8)) {
      const story = EPISODES[data.name]?.houses?.[d.story] ?? null
      assert.deepEqual(generateInterior(houseSpec(d, { story })), generateInterior(houseSpec(d, { story })))
    }
  })
  it('a village door is a home or an empty house; the fixed depth keeps its fallback theme', () => {
    for (const { d } of allDoors.filter(x => x.d.tier === 'safe')) assert.ok(['home', 'abandoned'].includes(houseSpec(d).version), d.label)
    assert.ok(DEPTH_THEMES.find(t => t.depths.includes(INTERIOR_DEPTH)))
  })
})

describe('the story houses of the leap maps', () => {
  for (const [map, story] of [['lake-1-ferry', "Toivo's hut"], ['highland-2-fold', "Aino's house"], ['marsh-3-hermit', 'hermit hut']]) {
    it(`${story}: every item of the episode lies on reachable floor, once`, () => {
      const data = Object.values(OPEN_MAPS).find(m => m.name === map)
      const d = doorsOf(data).find(x => x.story === story)
      assert.ok(d, `no door for ${story}`)
      const { pickups } = EPISODES[map].houses[story]
      const g = generateInterior(houseSpec(d, { story: EPISODES[map].houses[story] }))
      assert.equal(g.version, 'empty')
      const seen = reach(g.map, g.playerSpawn)
      for (const p of pickups) {
        const at = g.entitySpawns.filter(s => s.kind === 'floating_pickup' && s.contents === p)
        assert.equal(at.length, 1, `${story}: ${p.type}`)
        assert.ok(seen.has(`${at[0].x},${at[0].y}`), `${story}: ${p.type} out of reach`)
        assert.notEqual(g.map[at[0].y][at[0].x].tile, TILE.WALL)
      }
    })
  }
})
