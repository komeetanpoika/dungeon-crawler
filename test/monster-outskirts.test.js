import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { outskirtsSpots, buildOpenMap } from '../renderer/systems/openmap.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

const seeded = () => { let s = 12345; return () => ((s = s * 16807 % 2147483647) / 2147483647) }
function openFloor(w, h) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}

describe('outskirtsSpots', () => {
  const spawn = { x: 30, y: 20 }
  it('returns only floor tiles in the border band, far from the player spawn', () => {
    const spots = outskirtsSpots(openFloor(60, 40), spawn, new Set(), seeded())
    assert.ok(spots.length > 0)
    for (const s of spots) {
      assert.ok(Math.min(s.x, s.y, 59 - s.x, 39 - s.y) <= 12, `not in band: ${s.x},${s.y}`)
      assert.ok(Math.max(Math.abs(s.x - spawn.x), Math.abs(s.y - spawn.y)) >= 25, `too close: ${s.x},${s.y}`)
    }
  })
  it('skips taken tiles and never duplicates', () => {
    const all = outskirtsSpots(openFloor(60, 40), spawn, new Set(), seeded())
    const banned = `${all[0].x},${all[0].y}`
    const spots = outskirtsSpots(openFloor(60, 40), spawn, new Set([banned]), seeded())
    assert.ok(!spots.some(s => `${s.x},${s.y}` === banned))
    assert.equal(new Set(spots.map(s => `${s.x},${s.y}`)).size, spots.length)
  })
  it('is deterministic under a seeded rng', () => {
    const a = outskirtsSpots(openFloor(60, 40), spawn, new Set(), seeded())
    const b = outskirtsSpots(openFloor(60, 40), spawn, new Set(), seeded())
    assert.deepEqual(a, b)
  })
})

describe('buildOpenMap outskirts wiring (real forest-1 data)', () => {
  const FAKE_RIG = { RIG_ID: 'r', PARAM_SCHEMA: [], drawMonster: () => {} }
  const loadOpts = { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }
  beforeEach(clearMonsters)
  it('places count spawns for a registered monster on the map fringe', async () => {
    await registerMonsters([{ name: 'aa', rig: 'r', stats: { hp: 5 },
      spawn: { openMaps: { depths: [7, 14], count: 3 } } }], loadOpts)
    const data = OPEN_MAPS['7']
    const { entitySpawns, playerSpawn } = buildOpenMap(data, { depth: 7, rng: seeded() })
    const mine = entitySpawns.filter(s => s.kind === 'aa')
    assert.equal(mine.length, 3)
    for (const s of mine) {
      assert.ok(Math.min(s.x, s.y, data.w - 1 - s.x, data.h - 1 - s.y) <= 12, `not fringe: ${s.x},${s.y}`)
      assert.ok(Math.max(Math.abs(s.x - playerSpawn.x), Math.abs(s.y - playerSpawn.y)) >= 25, `too close: ${s.x},${s.y}`)
    }
  })
  it('places nothing when no monster covers the depth', async () => {
    const { entitySpawns } = buildOpenMap(OPEN_MAPS['7'], { depth: 7, rng: seeded() })
    assert.ok(!entitySpawns.some(s => s.kind === 'aa'))
  })
})
