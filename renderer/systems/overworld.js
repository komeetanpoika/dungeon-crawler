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
import { createMap } from './map.js'

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

export function generateOverworld(width = WORLD_W, height = WORLD_H, { structures = {}, rng = Math.random } = {}) {
  const map = createMap(width, height)
  fillGround(map)

  // Drawn before the boulder so the counts values stay stable as later tasks
  // add their own draws. Nothing consumes them until Task 2. Note this does NOT
  // make whole worlds reproducible across tasks — Task 2 changes the draw
  // sequence — and production never seeds at all.
  const n = contentCounts(width, height, rng)

  // A single seed-dependent boulder, so determinism is actually exercised from
  // this task rather than trivially true. Tasks 2-4 replace this with real
  // content; it sits well inside the border and cannot disconnect the plain.
  // Never on the spawn tile: the centre is the placeholder playerSpawn until
  // Task 4 picks a real one. Seed 4339 lands here otherwise.
  let bx, by
  do {
    bx = 2 + Math.floor(rng() * (width - 4))
    by = 2 + Math.floor(rng() * (height - 4))
  } while (bx === (width >> 1) && by === (height >> 1))
  map[by][bx].tile = TILE.WALL

  return { map, entitySpawns: [], playerSpawn: { x: width >> 1, y: height >> 1 }, rooms: [] }
}
