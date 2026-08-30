import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isHouseDoorArt, houseDoorsForMap, tierForDoor, storyForDoor } from '../renderer/systems/houses.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { EPISODES } from '../renderer/data/leaps.js'

const byName = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, m]))
const doorCount = m => m.prop.flat().filter(pi => pi >= 0 && isHouseDoorArt(m.palette[pi])).length

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
