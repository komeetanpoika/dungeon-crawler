import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateOverworld, WORLD_W, WORLD_H, sampleSites, contentCounts, dist, roadEdges } from '../renderer/systems/overworld.js'
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
    // Every seed, not one: from Task 3 punchGaps can select a border cell and
    // open it, and a single-seed check would make that a coincidence away.
    for (const seed of SEEDS) {
      const { map } = world(seed)
      for (let x = 0; x < WORLD_W; x++) {
        assert.equal(map[0][x].tile, TILE.WALL, `seed ${seed}: top x=${x}`)
        assert.equal(map[WORLD_H - 1][x].tile, TILE.WALL, `seed ${seed}: bottom x=${x}`)
      }
      for (let y = 0; y < WORLD_H; y++) {
        assert.equal(map[y][0].tile, TILE.WALL, `seed ${seed}: left y=${y}`)
        assert.equal(map[y][WORLD_W - 1].tile, TILE.WALL, `seed ${seed}: right y=${y}`)
      }
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
    // Fingerprint the whole result, not just tiles: from Task 2 the seed varies
    // where the settlements land, and roads carve FLOOR over an already-open
    // plain, so the tile grid alone carries no seed signal at all.
    const fingerprint = r => JSON.stringify({
      tiles: r.map.map(row => row.map(c => c.tile).join('')),
      rooms: r.rooms,
      spawn: r.playerSpawn,
    })
    assert.equal(fingerprint(world(7)), fingerprint(world(7)))
    assert.notEqual(fingerprint(world(7)), fingerprint(world(8)))
  })

  it('scales down rather than hanging on a small world', () => {
    const r = world(1, 60, 40)
    assert.equal(r.map.length, 40)
    assert.ok(isFullyConnected(r.map))
  })
})

describe('sampleSites', () => {
  it('places the requested count on every seed', () => {
    for (const s of SEEDS) {
      const got = sampleSites(mulberry32(s), 5, { w: WORLD_W, h: WORLD_H, pad: 12, minSep: 26 })
      assert.equal(got.length, 5, `seed ${s} placed ${got.length}`)
    }
  })

  it('respects the separation it was given when it does not need to relax', () => {
    // The relaxed floor is max(4, minSep - 24). At want:4 on a 180x116 map no
    // relaxation round is needed, so the strict bound holds — but assert the
    // guaranteed floor so raising `want` later does not fail a legal result.
    for (const s of SEEDS) {
      const got = sampleSites(mulberry32(s), 4, { w: WORLD_W, h: WORLD_H, pad: 12, minSep: 26 })
      for (let i = 0; i < got.length; i++) for (let j = i + 1; j < got.length; j++)
        assert.ok(dist(got[i], got[j]) >= 4, `seed ${s}: below even the relaxed floor`)
    }
  })

  it('relaxes rather than returning short when the map is too crowded', () => {
    // 8 points at separation 60 cannot fit a 180x116 map at full clearance.
    const got = sampleSites(mulberry32(1), 8, { w: WORLD_W, h: WORLD_H, pad: 12, minSep: 60 })
    assert.equal(got.length, 8)
  })

  it('keeps clear of an avoid set when it can', () => {
    const avoid = [{ x: 30, y: 30 }, { x: 140, y: 90 }]
    for (const s of SEEDS) {
      const got = sampleSites(mulberry32(s), 2, { w: WORLD_W, h: WORLD_H, pad: 12, minSep: 20, avoid, clearOf: 25 })
      assert.equal(got.length, 2)
      // The length alone passes even with the avoid filter deleted — this is
      // the assertion that actually pins the clearance.
      for (const p of got) for (const a of avoid) {
        assert.ok(dist(p, a) >= 25, `seed ${s}: ${JSON.stringify(p)} within 25 of ${JSON.stringify(a)}`)
      }
    }
  })

  it('stays inside the map bounds', () => {
    for (const s of SEEDS) {
      for (const p of sampleSites(mulberry32(s), 5, { w: WORLD_W, h: WORLD_H, pad: 12, minSep: 26 })) {
        assert.ok(p.x >= 12 && p.x < WORLD_W - 12, `seed ${s}: x=${p.x} out of pad`)
        assert.ok(p.y >= 12 && p.y < WORLD_H - 12, `seed ${s}: y=${p.y} out of pad`)
      }
    }
  })
})

describe('generateOverworld — roads', () => {
  it('records a settlement per site', () => {
    for (const s of SEEDS) {
      const { rooms } = world(s)
      assert.ok(rooms.length >= 4 && rooms.length <= 5, `seed ${s}: ${rooms.length} settlements`)
    }
  })
})

describe('roadEdges', () => {
  const sites = s => sampleSites(mulberry32(s), 5, { w: WORLD_W, h: WORLD_H, pad: 12, minSep: 26 })

  it('returns n-1 edges', () => {
    for (const s of SEEDS) assert.equal(roadEdges(sites(s)).length, 4, `seed ${s}`)
  })

  it('spans every site', () => {
    for (const s of SEEDS) {
      const seen = new Set()
      for (const { a, b } of roadEdges(sites(s))) { seen.add(a); seen.add(b) }
      assert.equal(seen.size, 5, `seed ${s}: only ${seen.size} sites on the graph`)
    }
  })

  it('is acyclic — each edge attaches exactly one new site', () => {
    for (const s of SEEDS) {
      const linked = new Set([0])
      for (const { a, b } of roadEdges(sites(s))) {
        assert.ok(linked.has(a), `seed ${s}: edge from an unlinked site`)
        assert.ok(!linked.has(b), `seed ${s}: edge to an already-linked site — cycle`)
        linked.add(b)
      }
    }
  })

  it('matches a brute-force minimum spanning tree by total weight', () => {
    // Prim's from every possible start; the MST weight is invariant.
    const weight = (pts, es) => es.reduce((t, { a, b }) => t + dist(pts[a], pts[b]), 0)
    for (const s of SEEDS) {
      const pts = sites(s)
      const mine = weight(pts, roadEdges(pts))
      let bestAlt = Infinity
      for (let start = 0; start < pts.length; start++) {
        const linked = [start], rest = pts.map((_, i) => i).filter(i => i !== start)
        let total = 0
        while (rest.length) {
          let best = null
          for (const a of linked) for (const b of rest) {
            const d = dist(pts[a], pts[b])
            if (!best || d < best.d) best = { a, b, d }
          }
          total += best.d; linked.push(best.b); rest.splice(rest.indexOf(best.b), 1)
        }
        bestAlt = Math.min(bestAlt, total)
      }
      assert.equal(mine, bestAlt, `seed ${s}: weight ${mine} vs best ${bestAlt}`)
    }
  })

  it('returns nothing for fewer than two sites', () => {
    assert.deepEqual(roadEdges([]), [])
    assert.deepEqual(roadEdges([{ x: 5, y: 5 }]), [])
  })
})
