import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isLooseSkin, looseSand, deepSand } from '../renderer/wilds/sand.js'
import { TILE } from '../renderer/systems/entities.js'
import { registerMonsters, clearMonsters, spellSpares } from '../renderer/systems/monsters.js'
import { deathDrop } from '../renderer/systems/drops.js'

const floor = skin => ({ tile: TILE.FLOOR, skin })
const grid = (w, h, skin) => Array.from({ length: h }, () => Array.from({ length: w }, () => floor(skin)))

describe('loose sand', () => {
  it('is the rippled sand, the dunes and a trail over sand', () => {
    for (const n of ['ow_sand_ripple_3_1', 'ow_sand_shade_12_0_1', 'ow_sand_slip_2', 'ow_sand_edge_0_8_2', 'ow_dune_4', 'ow_path_sand_2'])
      assert.equal(isLooseSkin(n), true, n)
  })
  it('is not hardpan, a road, paving, grass, the old sand tiles or nothing', () => {
    for (const n of ['ow_hardpan_cracked_1_0', 'ow_hardpan_edge_1_0_0', 'ow_road_sand_0', 'ow_pave_sand_0', 'ow_grass_0', 'ow_sand_0', undefined, null])
      assert.equal(isLooseSkin(n), false, String(n))
  })
  it('needs a walkable cell that is not walked under', () => {
    const map = grid(3, 3, 'ow_sand_ripple_0_0')
    assert.equal(looseSand(map, 1, 1), true)
    map[1][1] = { tile: TILE.WALL, skin: 'ow_sand_ripple_0_0' }
    assert.equal(looseSand(map, 1, 1), false)
    map[1][1] = { ...floor('ow_sand_ripple_0_0'), over: true }
    assert.equal(looseSand(map, 1, 1), false)
    assert.equal(looseSand(map, 9, 9), false)
  })
  it('off the outdoor tiles (a dungeon floor, the bench) every floor cell is loose', () => {
    const map = grid(3, 3, undefined)
    assert.equal(looseSand(map, 1, 1), true)
    map[0][0] = { tile: TILE.WALL }
    assert.equal(looseSand(map, 0, 0), false)
  })
  it('deep sand has loose sand on all eight sides', () => {
    const map = grid(5, 5, 'ow_sand_ripple_0_0')
    assert.equal(deepSand(map, 2, 2), true)
    map[1][1] = floor('ow_road_sand_0')
    assert.equal(deepSand(map, 2, 2), false)
    assert.equal(deepSand(map, 3, 3), true)
    assert.equal(deepSand(map, 0, 0), false)   // the map's edge is not sand
  })
})

describe('spellSpares', () => {
  const DEF = { rig: 'quadruped', params: {}, stats: {}, behavior: {} }
  beforeEach(async () => {
    clearMonsters()
    await registerMonsters([{ ...DEF, name: 'hooked', behavior: { driver: 'hook' } }, { ...DEF, name: 'plain' }],
      { loadRig: id => import(`../renderer/render/monster-rigs/${id}.js`), warn: () => {} })
  })
  it('spares a hook-driven creature unless it is open to spells', () => {
    assert.equal(spellSpares({ type: 'hooked' }), true)
    assert.equal(spellSpares({ type: 'hooked', spellOpen: true }), false)
    assert.equal(spellSpares({ type: 'hooked', brainDriven: true }), false)
    assert.equal(spellSpares({ type: 'plain' }), false)
  })
})

describe('what a creature leaves when it dies', () => {
  const chest = { behavior: { drops: 'chest' } }
  it('one chest roll where it stood, once', () => {
    const e = { type: 'pit', x: 4, y: 5, hp: 0, lootDepth: 3 }
    const seen = []
    const s = deathDrop(e, chest, depth => { seen.push(depth); return { type: 'potion', amount: 4 } })
    assert.deepEqual(s, { kind: 'floating_pickup', contents: { type: 'potion', amount: 4 }, x: 4, y: 5 })
    assert.deepEqual(seen, [3])
    assert.equal(deathDrop(e, chest, () => ({})), null)
  })
  it('nothing from the living, nor from a def that drops nothing', () => {
    assert.equal(deathDrop({ x: 1, y: 1, hp: 2 }, chest, () => ({})), null)
    assert.equal(deathDrop({ x: 1, y: 1, hp: 0 }, { behavior: {} }, () => ({})), null)
    assert.equal(deathDrop({ x: 1, y: 1, hp: 0 }, null, () => ({})), null)
  })
})
