import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateOverworld, WORLD_W, WORLD_H } from '../renderer/systems/overworld.js'
import { isFullyConnected } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

// Deterministic RNG so a seed pins an entire world.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
// Every assertion runs across many seeds: a single-seed test hid a bug during
// design where the ruin pockets vanished on most seeds but not the first one.
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]
const world = (seed, w = WORLD_W, h = WORLD_H, opts = {}) =>
  generateOverworld(w, h, { structures: {}, rng: mulberry32(seed), ...opts })

describe('generateOverworld — the plain', () => {
  it('exports the documented world size', () => {
    assert.equal(WORLD_W, 180)
    assert.equal(WORLD_H, 116)
  })

  it('returns the same shape generateLevel does', () => {
    const r = world(1)
    for (const k of ['map', 'entitySpawns', 'playerSpawn', 'rooms']) assert.ok(k in r, `missing ${k}`)
    assert.equal(r.map.length, WORLD_H)
    assert.equal(r.map[0].length, WORLD_W)
  })

  it('walls the border so the player cannot leave', () => {
    const { map } = world(1)
    for (let x = 0; x < WORLD_W; x++) {
      assert.equal(map[0][x].tile, TILE.WALL, `top x=${x}`)
      assert.equal(map[WORLD_H - 1][x].tile, TILE.WALL, `bottom x=${x}`)
    }
    for (let y = 0; y < WORLD_H; y++) {
      assert.equal(map[y][0].tile, TILE.WALL, `left y=${y}`)
      assert.equal(map[y][WORLD_W - 1].tile, TILE.WALL, `right y=${y}`)
    }
  })

  it('is fully connected on every seed', () => {
    for (const s of SEEDS) assert.ok(isFullyConnected(world(s).map), `seed ${s} disconnected`)
  })

  it('is mostly open ground, not a maze', () => {
    for (const s of SEEDS) {
      const { map } = world(s)
      let walk = 0
      for (const row of map) for (const c of row) if (isWalkable(c.tile)) walk++
      const frac = walk / (WORLD_W * WORLD_H)
      assert.ok(frac > 0.90, `seed ${s}: only ${(frac * 100).toFixed(0)}% walkable`)
    }
  })

  it('never buries the player spawn', () => {
    for (const s of [...SEEDS, 4339]) {
      const { map, playerSpawn } = world(s)
      assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile), `seed ${s}: spawn is not walkable`)
    }
  })

  it('is deterministic for a seed and different across seeds', () => {
    const skin = r => r.map.map(row => row.map(c => c.tile).join('')).join('\n')
    assert.equal(skin(world(7)), skin(world(7)))
    assert.notEqual(skin(world(7)), skin(world(8)))
  })

  it('scales down rather than hanging on a small world', () => {
    const r = world(1, 60, 40)
    assert.equal(r.map.length, 40)
    assert.ok(isFullyConnected(r.map))
  })
})
