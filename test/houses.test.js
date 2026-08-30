import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isHouseDoorArt, isHouseWallArt, houseDoorsForMap, tierForDoor, storyForDoor, storyStructures, INTERIOR_DEPTH, SAFE_RADIUS } from '../renderer/systems/houses.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { EPISODES } from '../renderer/data/leaps.js'

const STRUCTURES = JSON.parse(readFileSync(new URL('../renderer/data/structures.json', import.meta.url)))

const byName = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, m]))
const propArt = (m, x, y) => { const pi = m.prop[y]?.[x]; return pi >= 0 ? m.palette[pi] : null }
// A door is door art flanked by a house wall — the same rule houses.js uses,
// restated here from the raw map data so the count is an independent check.
const doorCount = m => m.prop.flatMap((row, y) => row.map((pi, x) =>
  pi >= 0 && isHouseDoorArt(m.palette[pi]) &&
  (isHouseWallArt(propArt(m, x - 1, y)) || isHouseWallArt(propArt(m, x + 1, y))))).filter(Boolean).length
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))
const LEAP_MAPS = ['lake-1-ferry', 'highland-2-fold', 'marsh-3-hermit']

describe('door art', () => {
  it('matches house doors and arches, not signs, walls or cave arches', () => {
    for (const ok of ['ow_house_door', 'ow_house_door_brown', 'ow_house_door_gray', 'ow_house_arch_stone', 'ow_house_arch_brown']) assert.equal(isHouseDoorArt(ok), true, ok)
    for (const no of ['ow_sign', 'ow_house_wall_l', 'ow_cave_arch_0', 'ow_cave_gate_l', 'ow_house_wall_win']) assert.equal(isHouseDoorArt(no), false, no)
  })
})

describe('houseDoorsForMap', () => {
  it('finds every door cell on every open map with unique, stable labels', () => {
    for (const m of Object.values(OPEN_MAPS)) {
      const doors = houseDoorsForMap(m, EPISODES[m.name] ?? null)
      assert.equal(doors.length, doorCount(m), m.name)
      assert.equal(new Set(doors.map(d => d.label)).size, doors.length, m.name)
      for (const d of doors) assert.equal(d.label, `house:${m.name}:${d.x},${d.y}`)
    }
  })
  it('village houses are safe, outlying huts are hut, stone arches are ruin', () => {
    const lake = byName['lake-1-ferry']
    const village = lake.pois.find(p => p.kind === 'village')
    const doors = houseDoorsForMap(lake, EPISODES[lake.name])
    const near = doors.filter(d => Math.max(Math.abs(d.x - village.x), Math.abs(d.y - village.y)) <= 10 && !d.story)
    assert.ok(near.length >= 3)
    for (const d of near) assert.equal(d.tier, 'safe')
    const toivo = doors.find(d => d.story === "Toivo's hut")
    assert.ok(toivo, 'Toivo\'s hut door resolved'); assert.equal(toivo.tier, 'hut')
    assert.equal(tierForDoor({ pois: [] }, 5, 5, 'ow_house_door'), 'ruin')
    assert.equal(tierForDoor({ pois: [{ kind: 'village', x: 5, y: 5 }] }, 6, 6, 'ow_house_arch_stone'), 'ruin')
    assert.equal(tierForDoor({ pois: [{ kind: 'village', x: 5, y: 5 }] }, 30, 30, 'ow_house_door'), 'hut')
  })
  it('resolves the three story houses and nothing else', () => {
    const expect = { 'lake-1-ferry': "Toivo's hut", 'highland-2-fold': "Aino's house", 'marsh-3-hermit': 'hermit hut' }
    for (const [name, story] of Object.entries(expect)) {
      const doors = houseDoorsForMap(byName[name], EPISODES[name])
      assert.equal(doors.filter(d => d.story).length, 1, name)
      assert.equal(doors.find(d => d.story).story, story)
      assert.equal(doors.find(d => d.story).tier, 'hut')
    }
    for (const d of houseDoorsForMap(byName['forest-1-clearings'], null)) assert.equal(d.story, null)
  })
})

describe('standing stones are not doors', () => {
  it('matches house wall art', () => {
    for (const ok of ['ow_house_wall_l', 'ow_house_wall_r', 'ow_house_wall_brown_l', 'ow_house_wall_stone_r', 'ow_house_wall_win']) assert.equal(isHouseWallArt(ok), true, ok)
    for (const no of ['ow_house_door', 'ow_house_arch_stone', 'ow_roof_red_m', null, undefined]) assert.equal(isHouseWallArt(no), false, String(no))
  })

  it('skips the arrival runestone and the exit waystone on every leap map', () => {
    for (const name of LEAP_MAPS) {
      const m = byName[name]
      const at = new Set(houseDoorsForMap(m, EPISODES[name]).map(d => `${d.x},${d.y}`))
      const stones = m.pois.filter(p => p.label === 'runestone' || /\bstone$/.test(p.label))
      assert.ok(stones.length >= 1, `${name} has standing-stone POIs`)
      for (const s of stones) assert.equal(at.has(`${s.x},${s.y}`), false, `${name}: ${s.label} must not be a door`)
    }
  })

  it('leaves no door within one tile of a leap map spawn', () => {
    for (const name of LEAP_MAPS) {
      const m = byName[name]
      for (const d of houseDoorsForMap(m, EPISODES[name]))
        assert.ok(cheb(d.x, d.y, m.playerSpawn.x, m.playerSpawn.y) > 1, `${name}: door at ${d.x},${d.y} sits on the spawn`)
    }
  })

  it('finds the real houses on every map and nothing else', () => {
    const expected = {
      'forest-1-clearings': 4, 'lake-1-ferry': 5, 'highland-2-fold': 4, 'marsh-3-hermit': 5,
      'forest-2-river': 1, 'forest-3-autumn': 1, 'desert-1-dunes': 0, 'desert-2-canyon': 0,
      'desert-3-lost-city': 0, 'sea-1-suomenlinna': 0, 'sea-2-fishing-village': 4, 'sea-3-archipelago': 0,
    }
    const got = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, houseDoorsForMap(m, EPISODES[m.name] ?? null).length]))
    assert.deepEqual(got, expected)
    assert.equal(Object.values(got).reduce((a, b) => a + b, 0), 24)
  })
})

describe('tier distribution across the real maps', () => {
  it('is 21 safe village doors, the 3 story huts, and no ruins today', () => {
    const tally = { safe: 0, hut: 0, ruin: 0 }
    const stories = []
    for (const m of Object.values(OPEN_MAPS)) {
      const anchors = m.pois.filter(p => p.kind === 'village' || p.kind === 'camp')
      for (const d of houseDoorsForMap(m, EPISODES[m.name] ?? null)) {
        tally[d.tier]++
        if (d.story) { stories.push(d.story); assert.equal(d.tier, 'hut', `${m.name} ${d.story}`); continue }
        const near = Math.min(...anchors.map(a => cheb(d.x, d.y, a.x, a.y)))
        assert.equal(d.tier, near <= SAFE_RADIUS ? 'safe' : 'hut', `${m.name} door ${d.x},${d.y} at ${near}`)
      }
    }
    assert.deepEqual(stories.sort(), ["Aino's house", "Toivo's hut", 'hermit hut'])
    assert.deepEqual(tally, { safe: 21, hut: 3, ruin: 0 })
  })

  it('tiers off the NEAREST village/camp anchor, not the first listed', () => {
    const data = { pois: [{ kind: 'village', x: 60, y: 60 }, { kind: 'camp', x: 5, y: 5 }] }
    assert.equal(tierForDoor(data, 7, 7, 'ow_house_door'), 'safe')
    assert.equal(tierForDoor(data, 30, 30, 'ow_house_door'), 'hut')
  })
})

describe('storyStructures', () => {
  it("resolves Toivo's hut to the toivo_kitchen prefab with targetDepth 19", () => {
    const out = storyStructures(STRUCTURES, EPISODES['lake-1-ferry'], "Toivo's hut")
    assert.deepEqual(Object.keys(out), ['toivo_kitchen'])
    assert.equal(out.toivo_kitchen.targetDepth, INTERIOR_DEPTH)
    assert.equal(out.toivo_kitchen.w, STRUCTURES.toivo_kitchen.w)
    assert.deepEqual(out.toivo_kitchen.cells, STRUCTURES.toivo_kitchen.cells)
  })
  it('resolves the other two story houses', () => {
    assert.deepEqual(Object.keys(storyStructures(STRUCTURES, EPISODES['highland-2-fold'], "Aino's house")), ['aino_larder'])
    assert.deepEqual(Object.keys(storyStructures(STRUCTURES, EPISODES['marsh-3-hermit'], 'hermit hut')), ['hermit_woodpile'])
  })
  it('is {} when the story is null', () => {
    assert.deepEqual(storyStructures(STRUCTURES, EPISODES['lake-1-ferry'], null), {})
  })
  it('is {} for a generic house (no story) even with an episode present', () => {
    assert.deepEqual(storyStructures(STRUCTURES, EPISODES['lake-1-ferry'], undefined), {})
  })
  it('is {} when the named room is missing from structures.json (warns once)', () => {
    const warnings = []
    const orig = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      const out = storyStructures({}, EPISODES['lake-1-ferry'], "Toivo's hut")
      assert.deepEqual(out, {})
      assert.equal(warnings.length, 1)
    } finally {
      console.warn = orig
    }
  })
})
