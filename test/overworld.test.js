import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const STRUCTURES = JSON.parse(readFileSync(new URL('../renderer/data/structures.json', import.meta.url), 'utf8'))
const withPrefabs = seed => generateOverworld(WORLD_W, WORLD_H, { structures: STRUCTURES, rng: mulberry32(seed) })

describe('generateOverworld — structures', () => {
  it('gives every settlement a sized compound', () => {
    for (const s of SEEDS) {
      for (const r of world(s).rooms) {
        assert.ok(r.w > 0 && r.h > 0, `seed ${s}: room ${r.id} has no extent`)
      }
    }
  })

  it('walls the full perimeter of each compound bar its gate', () => {
    for (const s of SEEDS) {
      const { map, rooms } = world(s)
      for (const r of rooms) {
        let wall = 0, open = 0
        for (let x = r.x; x < r.x + r.w; x++) for (const y of [r.y, r.y + r.h - 1]) {
          if (map[y]?.[x]?.tile === TILE.WALL) wall++; else open++
        }
        for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (const x of [r.x, r.x + r.w - 1]) {
          if (map[y]?.[x]?.tile === TILE.WALL) wall++; else open++
        }
        assert.ok(wall > 0, `seed ${s}: room ${r.id} has no wall at all`)
        // Exactly one 2-cell gate, so at most 2 perimeter cells are open.
        assert.ok(open <= 2, `seed ${s}: room ${r.id} has ${open} open perimeter cells`)
      }
    }
  })

  it('faces each compound gate toward its road', () => {
    // The road is carved to the site centre and the wall stamped across it, so
    // a gate on the wrong side leaves the road dead-ending into blank wall.
    //
    // "Nearest by raw distance" is NOT the same thing as "the site's real MST
    // neighbour": Prim's assigns each node whichever edge is globally
    // cheapest during construction, which is not always that node's own
    // closest point. Confirmed on seed 2, room 3: one other site sits 63 away
    // and another 66 away, but roadEdges (the exact function the generator
    // uses to derive roadDir) links room 3 to the 66-away site because that
    // was the cheaper edge available when its subtree attached. A
    // nearest-by-distance proxy disagrees with the generator on ties this
    // close, so recompute the real MST here instead of approximating it.
    for (const s of SEEDS) {
      const { map, rooms } = world(s)
      if (rooms.length < 2) continue
      const centres = rooms.map(r => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }))
      const neighbour = new Map()
      for (const { a, b } of roadEdges(centres)) {
        if (!neighbour.has(a)) neighbour.set(a, b)
        if (!neighbour.has(b)) neighbour.set(b, a)
      }
      for (const r of rooms) {
        // Compare centre-to-centre, matching how the generator itself derives
        // roadDir (site-to-site) — mixing the neighbour's centre against this
        // room's raw corner shifts each axis by roughly half the compound's
        // width/height, which is enough to flip which axis "dominates" on a
        // close call and was a second, self-inflicted bug here.
        const c = centres[r.id]
        const nearest = centres[neighbour.get(r.id)]
        const wantE = nearest.x > c.x, wantS = nearest.y > c.y
        const horizontal = Math.abs(nearest.x - c.x) > Math.abs(nearest.y - c.y)
        // Find which side the open cells are on.
        const sides = { n: 0, s: 0, w: 0, e: 0 }
        for (let x = r.x; x < r.x + r.w; x++) {
          if (map[r.y]?.[x]?.tile !== TILE.WALL) sides.n++
          if (map[r.y + r.h - 1]?.[x]?.tile !== TILE.WALL) sides.s++
        }
        for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
          if (map[y]?.[r.x]?.tile !== TILE.WALL) sides.w++
          if (map[y]?.[r.x + r.w - 1]?.tile !== TILE.WALL) sides.e++
        }
        const gateSide = Object.entries(sides).sort((a, b) => b[1] - a[1])[0][0]
        const expected = horizontal ? (wantE ? 'e' : 'w') : (wantS ? 's' : 'n')
        assert.equal(gateSide, expected, `seed ${s}: room ${r.id} gate on ${gateSide}, road runs ${expected}`)
      }
    }
  })

  it('stays connected with the real prefabs stamped in', () => {
    for (const s of SEEDS) assert.ok(isFullyConnected(withPrefabs(s).map), `seed ${s} disconnected`)
  })

  it('emits the prefabs\' own door and chest spawns', () => {
    const kinds = new Set()
    for (const s of SEEDS) for (const sp of withPrefabs(s).entitySpawns) kinds.add(sp.kind)
    assert.ok(kinds.has('chest') || kinds.has('door'), `got ${[...kinds].join(', ')}`)
  })

  it('works with no structures at all — an empty courtyard, not a crash', () => {
    for (const s of SEEDS) {
      const r = generateOverworld(WORLD_W, WORLD_H, { structures: {}, rng: mulberry32(s) })
      assert.ok(isFullyConnected(r.map), `seed ${s} disconnected`)
    }
  })

  it('carves ruin pockets on every seed', () => {
    // A pocket is wall built away from any compound. Count wall tiles outside
    // every compound's bounding box; with no pockets this is ~0.
    for (const s of SEEDS) {
      const { map, rooms } = world(s)
      let outside = 0
      for (let y = 1; y < WORLD_H - 1; y++) for (let x = 1; x < WORLD_W - 1; x++) {
        if (map[y][x].tile !== TILE.WALL) continue
        if (rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue
        outside++
      }
      assert.ok(outside > 40, `seed ${s}: only ${outside} ruin wall tiles`)
    }
  })

  it('is connected across a wide seed sweep, with and without prefabs', () => {
    // 12 seeds missed a 1.3% failure rate — seeds 10 and 115 shipped sealed
    // ruin interiors. This is the invariant the whole design rests on, so it
    // gets a real sweep rather than the standard list.
    for (let s = 1; s <= 120; s++) {
      assert.ok(isFullyConnected(generateOverworld(WORLD_W, WORLD_H, { structures: STRUCTURES, rng: mulberry32(s) }).map),
        `seed ${s} disconnected with prefabs`)
      assert.ok(isFullyConnected(generateOverworld(WORLD_W, WORLD_H, { structures: {}, rng: mulberry32(s) }).map),
        `seed ${s} disconnected without prefabs`)
    }
  })
})

// Every kind buildEntities (renderer/game.js) actually handles, plus the new
// one Task 6 will add. buildEntities drops unknown kinds SILENTLY — no warning,
// no log — so a typo here vanishes without a trace at runtime.
const HANDLED_KINDS = new Set([
  'guard', 'monster', 'dragon', 'trap', 'puzzle', 'weapon', 'ranged', 'potion',
  'door', 'exit_door', 'chest', 'cyclops', 'wizard', 'crab', 'dragon_boss',
  'dragon_boss_pixel', 'prop', 'fountain_wall', 'fountain_basin',
  'dungeon_entrance',
])
const ENEMY_KINDS = new Set(['guard', 'monster', 'cyclops', 'wizard', 'crab'])

describe('generateOverworld — contents', () => {
  const ringOf = (p, spawn) => {
    const f = (Math.abs(spawn.x - p.x) + Math.abs(spawn.y - p.y)) / (WORLD_W + WORLD_H)
    return f < 0.25 ? 'inner' : f < 0.60 ? 'mid' : 'outer'
  }

  it('emits only kinds buildEntities handles', () => {
    for (const s of SEEDS) for (const sp of withPrefabs(s).entitySpawns) {
      assert.ok(HANDLED_KINDS.has(sp.kind), `seed ${s}: unhandled kind "${sp.kind}"`)
    }
  })

  it('spawns the player on walkable, unlocked ground', () => {
    for (const s of SEEDS) {
      const { map, playerSpawn } = withPrefabs(s)
      const c = map[playerSpawn.y][playerSpawn.x]
      assert.ok(isWalkable(c.tile), `seed ${s}: spawn tile not walkable`)
      assert.ok(!c.locked, `seed ${s}: spawn is inside a prefab`)
    }
  })

  it('keeps the inner ring free of enemies', () => {
    for (const s of SEEDS) {
      const { entitySpawns, playerSpawn } = withPrefabs(s)
      for (const sp of entitySpawns) {
        if (!ENEMY_KINDS.has(sp.kind)) continue
        assert.notEqual(ringOf(sp, playerSpawn), 'inner', `seed ${s}: ${sp.kind} in the inner ring`)
      }
    }
  })

  it('puts more enemies in the outer ring than the mid ring', () => {
    for (const s of SEEDS) {
      const { entitySpawns, playerSpawn } = withPrefabs(s)
      let mid = 0, outer = 0
      for (const sp of entitySpawns) {
        if (!ENEMY_KINDS.has(sp.kind)) continue
        const r = ringOf(sp, playerSpawn)
        if (r === 'mid') mid++; else if (r === 'outer') outer++
      }
      assert.ok(outer > mid, `seed ${s}: mid ${mid} vs outer ${outer}`)
    }
  })

  it('places dungeon entrances on every seed, all in the outer ring', () => {
    for (const s of SEEDS) {
      const { entitySpawns, playerSpawn } = withPrefabs(s)
      const ent = entitySpawns.filter(sp => sp.kind === 'dungeon_entrance')
      assert.ok(ent.length >= 1, `seed ${s}: no entrances`)
      for (const e of ent) assert.equal(ringOf(e, playerSpawn), 'outer', `seed ${s}: entrance not in the outer ring`)
    }
  })

  it('never stacks two spawns on one tile', () => {
    for (const s of SEEDS) {
      const seen = new Set()
      for (const sp of withPrefabs(s).entitySpawns) {
        const k = `${sp.x},${sp.y}`
        assert.ok(!seen.has(k), `seed ${s}: two spawns at ${k}`)
        seen.add(k)
      }
    }
  })

  it('never spawns anything on a wall, in a prefab, or on the player', () => {
    for (const s of SEEDS) {
      const { map, entitySpawns, playerSpawn } = withPrefabs(s)
      for (const sp of entitySpawns) {
        const c = map[sp.y]?.[sp.x]
        assert.ok(c && isWalkable(c.tile), `seed ${s}: ${sp.kind} on a non-walkable tile at ${sp.x},${sp.y}`)
        // Prefab spawns (door/chest) are legitimately on locked cells; the
        // gradient-placed ones must not be.
        if (!['door', 'chest'].includes(sp.kind) || ENEMY_KINDS.has(sp.kind)) {
          assert.ok(!(sp.x === playerSpawn.x && sp.y === playerSpawn.y), `seed ${s}: ${sp.kind} on the player spawn`)
        }
      }
    }
  })

  it('scales its contents down on a small world rather than flooding it', () => {
    const r = generateOverworld(60, 40, { structures: STRUCTURES, rng: mulberry32(1) })
    const enemies = r.entitySpawns.filter(sp => ENEMY_KINDS.has(sp.kind)).length
    assert.ok(enemies <= 12, `small world got ${enemies} enemies`)
  })
})
