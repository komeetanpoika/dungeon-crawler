// Open-world generation: a plain of castle-skinned ground carrying walled
// settlements, roads between them, pockets of ruin, and a danger gradient that
// rises with distance from where you start.
//
// Connected BY CONSTRUCTION, not by retry. generateLevel's dungeon path
// generates, tests isFullyConnected, retries five times and then falls back to
// a bare unwinnable room — the mechanism behind the depth-4 softlock. Here the
// map starts fully open and every later step either only adds traversable
// ground or punches a guaranteed gap, so there is no retry loop and no
// fallback at all.

import { TILE } from './entities.js'
import { createMap, carveCorridor } from './map.js'

export const WORLD_W = 180
export const WORLD_H = 116

export const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

// Content targets at full size, scaled by area on smaller worlds so a 60x40
// test map asks for what it can actually hold instead of sampling forever.
export function contentCounts(width, height, rng) {
  const f = Math.min(1, (width * height) / (WORLD_W * WORLD_H))
  const scale = n => Math.max(1, Math.round(n * f))
  return {
    settlements: scale(4 + Math.floor(rng() * 2)),
    pockets:     scale(2 + Math.floor(rng() * 2)),
    entrances:   scale(3),
  }
}

// Carve the interior to open ground, leaving a one-tile wall border so the
// world has edges (the camera is unbounded and would otherwise show the void).
function fillGround(map) {
  for (let y = 1; y < map.length - 1; y++)
    for (let x = 1; x < map[0].length - 1; x++)
      map[y][x].tile = TILE.FLOOR
}

// Sample `want` points at least `minSep` apart and `clearOf` away from every
// point in `avoid`, relaxing both constraints if the map is too crowded to
// satisfy them. Filtering a pre-generated scatter instead of sampling against
// what already exists drops points entirely on most seeds — observed during
// design, where the ruin pockets vanished on two seeds in three.
export function sampleSites(rng, want, { w, h, pad = 10, minSep = 20, avoid = [], clearOf = 0 }) {
  const out = []
  for (let relax = 0; relax < 5 && out.length < want; relax++) {
    const sep = Math.max(4, minSep - relax * 6)
    const clr = Math.max(4, clearOf - relax * 6)
    for (let t = 0; t < 900 && out.length < want; t++) {
      const p = { x: pad + Math.floor(rng() * (w - pad * 2)), y: pad + Math.floor(rng() * (h - pad * 2)) }
      if (out.every(q => dist(p, q) >= sep) && avoid.every(q => dist(p, q) >= clr)) out.push(p)
    }
  }
  return out
}

// Minimum spanning tree over the settlements. carveCorridor only ever writes
// FLOOR, so this can add connectivity but never remove it.
function carveRoads(map, sites) {
  if (sites.length < 2) return
  const linked = [0]
  const rest = sites.map((_, i) => i).slice(1)
  while (rest.length) {
    let best = null
    for (const a of linked) for (const b of rest) {
      const d = dist(sites[a], sites[b])
      if (!best || d < best.d) best = { a, b, d }
    }
    carveCorridor(map, sites[best.a].x, sites[best.a].y, sites[best.b].x, sites[best.b].y, 2)
    linked.push(best.b)
    rest.splice(rest.indexOf(best.b), 1)
  }
}

export function generateOverworld(width = WORLD_W, height = WORLD_H, { structures = {}, rng = Math.random } = {}) {
  const map = createMap(width, height)
  fillGround(map)

  const n = contentCounts(width, height, rng)
  const sites = sampleSites(rng, n.settlements, { w: width, h: height, pad: 12, minSep: 26 })
  carveRoads(map, sites)

  // w/h stay 0 until Task 3 stamps the compounds and knows their extent.
  const rooms = sites.map((s, id) => ({ id, x: s.x, y: s.y, w: 0, h: 0 }))
  return { map, entitySpawns: [], playerSpawn: { x: width >> 1, y: height >> 1 }, rooms }
}
