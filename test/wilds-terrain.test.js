import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTerrain, WILDS_SKINS, TERRAIN_SKINS, ROAD_WIDTH, setRoadWidth } from '../renderer/wilds/terrain.js'
import { PIECE, FRAME, MARGIN, biomeAt, pieceBiome, gateAt } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { TREE_PAIRS } from '../renderer/terrain/lib.js'
import { isMountainGround } from '../renderer/terrain/mountain.js'
import { roadSides } from '../renderer/wilds/roads.js'
import { isDeckSkin } from '../renderer/wilds/bridge-art.js'
import { isCityPiece } from '../renderer/wilds/city/geometry.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const SEEDS = [3, 77, 2024]
const built = (seed, wx, wy, deal = 0) => { const t = makeTerrain(seed, wx, wy, deal); t.finish(); return t }
const cellOf = (t, x, y) => ({ kind: t.kind(x, y), walk: t.b.walkable(x + MARGIN, y + MARGIN) })
const skinsOf = (t, x, y) => {
  const b = t.b, bx = x + MARGIN, by = y + MARGIN
  return { ground: b.palette[b.ground[by][bx]], prop: b.palette[b.prop[by][bx]] ?? null }
}
// A deterministic sample of pieces across every direction and distance.
const samplePieces = (seed, n) => Array.from({ length: n }, (_, i) => ({
  wx: (hashInt(seed, i, 0, 5) % 25) - 12, wy: (hashInt(seed, i, 1, 5) % 25) - 12,
}))
// A piece well inside the named country, searched outward from home.
function pieceIn(seed, biome) {
  for (let r = 2; r < 40; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r) continue
    const all = [8, 40, 72].every(y => [8, 40, 72].every(x => biomeAt(seed, wx * PIECE + x, wy * PIECE + y) === biome))
    if (all) return { wx, wy }
  }
  throw new Error(`no ${biome} piece found for seed ${seed}`)
}
const edgeDist = (x, y) => Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y)

test('a piece is deterministic', () => {
  const a = built(3, 4, -2, 1), b = built(3, 4, -2, 1)
  assert.deepEqual(a.b.ground, b.b.ground)
  assert.deepEqual(a.b.prop.map(r => r.map(i => a.b.palette[i] ?? null)), b.b.prop.map(r => r.map(i => b.b.palette[i] ?? null)))
  assert.deepEqual(a.b.walkG, b.b.walkG)
})

test('neighbours agree on what both can see', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed, 8)) for (const [da, db] of [[0, 1], [2, 0]]) {
    const A = built(seed, wx, wy, da)
    const E = built(seed, wx + 1, wy, db)
    const S = built(seed, wx, wy + 1, db)
    for (let i = -MARGIN; i < PIECE + MARGIN; i++) for (let k = 0; k < MARGIN; k++) {
      // A's east margin is E's first columns; E's west margin is A's last columns
      if (i >= 0 && i < PIECE) {
        assert.deepEqual(cellOf(A, PIECE + k, i), cellOf(E, k, i), `seed ${seed} piece ${wx},${wy} east margin col ${k} row ${i}`)
        assert.deepEqual(cellOf(E, -1 - k, i), cellOf(A, PIECE - 1 - k, i), `seed ${seed} piece ${wx},${wy} west margin col ${k} row ${i}`)
        assert.deepEqual(cellOf(A, i, PIECE + k), cellOf(S, i, k), `seed ${seed} piece ${wx},${wy} south margin row ${k} col ${i}`)
        assert.deepEqual(cellOf(S, i, -1 - k), cellOf(A, i, PIECE - 1 - k), `seed ${seed} piece ${wx},${wy} north margin row ${k} col ${i}`)
      }
    }
  }
})

test('gates line up and are open on both sides', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed, 12)) {
    const A = built(seed, wx, wy, 0), E = built(seed, wx + 1, wy, 3), S = built(seed, wx, wy + 1, 3)
    assert.deepEqual(A.gates.E, { x: PIECE - 1, y: gateAt(seed, wx, wy, 'E') })
    assert.equal(A.gates.E.y, E.gates.W.y)
    assert.equal(A.gates.S.x, S.gates.N.x)
    assert.equal(E.gates.W.x, 0)
    assert.equal(A.gates.S.y, PIECE - 1)
    for (let d = 0; d < FRAME; d++) for (let o = -1; o <= 2; o++) {
      assert.ok(A.b.walkable(PIECE - 1 - d + MARGIN, A.gates.E.y + o + MARGIN), `A east corridor d${d} o${o}`)
      assert.ok(E.b.walkable(d + MARGIN, E.gates.W.y + o + MARGIN), `E west corridor d${d} o${o}`)
      assert.ok(A.b.walkable(A.gates.S.x + o + MARGIN, PIECE - 1 - d + MARGIN), `A south corridor d${d} o${o}`)
      assert.ok(S.b.walkable(S.gates.N.x + o + MARGIN, d + MARGIN), `S north corridor d${d} o${o}`)
    }
    assert.deepEqual(A.gateInner('N'), { x: A.gates.N.x, y: FRAME })
    assert.deepEqual(A.gateInner('E'), { x: PIECE - 1 - FRAME, y: A.gates.E.y })
  }
})

test('the deal changes the interior but not the frame', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed, 8)) {
    const a = built(seed, wx, wy, 0), b = built(seed, wx, wy, 1)
    let inner = 0, differ = 0
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const d = edgeDist(x, y)
      // the innermost frame row may carry the canopy of a dealt tree just inside
      if (d < FRAME) assert.equal(a.kind(x, y), b.kind(x, y), `kind in frame at ${x},${y}`)
      if (d < FRAME - 1) assert.deepEqual(cellOf(a, x, y), cellOf(b, x, y), `walkability in frame at ${x},${y}`)
      if (d < MARGIN) assert.deepEqual(skinsOf(a, x, y), skinsOf(b, x, y), `skins near the edge at ${x},${y}`)
      if (d >= FRAME + 8) {
        inner++
        if (JSON.stringify([cellOf(a, x, y), skinsOf(a, x, y)]) !== JSON.stringify([cellOf(b, x, y), skinsOf(b, x, y)])) differ++
      }
    }
    assert.ok(differ / inner > 0.05, `seed ${seed} piece ${wx},${wy}: only ${(differ / inner * 100).toFixed(1)}% of the interior changed`)
  }
})

test('every skin the generator can emit exists as a tile', () => {
  const names = new Set(WILDS_SKINS)
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed, 14)) for (const n of built(seed, wx, wy, 0).b.palette) {
    assert.ok(names.has(n), `${n} is laid but missing from WILDS_SKINS`)
  }
  for (const n of names) assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
})

test('no half trees', () => {
  const topOf = new Map(TREE_PAIRS.map(([top, trunk]) => [trunk, top]))
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed, 10)) {
    const t = built(seed, wx, wy, 1)
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const { prop } = skinsOf(t, x, y)
      if (topOf.has(prop)) assert.equal(skinsOf(t, x, y - 1).prop, topOf.get(prop), `orphan trunk at ${x},${y} in ${wx},${wy}`)
    }
  }
})

test('each country looks like itself', () => {
  const frac = (t, pred) => {
    let n = 0
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (pred(skinsOf(t, x, y), t.kind(x, y))) n++
    return n / (PIECE * PIECE)
  }
  for (const seed of SEEDS) {
    const at = b => { const p = pieceIn(seed, b); assert.equal(pieceBiome(seed, p.wx, p.wy), b); return built(seed, p.wx, p.wy, 0) }
    const water = frac(at('sea'), (s, k) => k === 'water')
    assert.ok(water > 0.35 && water < 0.75, `sea is ${(water * 100).toFixed(0)}% water`)
    const mass = frac(at('mountain'), (s, k) => k === 'mass')
    assert.ok(mass > 0.15 && mass < 0.6, `mountain is ${(mass * 100).toFixed(0)}% mass`)
    const sand = frac(at('desert'), s => s.ground.startsWith('ow_sand') || s.ground.startsWith('ow_hardpan'))
    assert.ok(sand > 0.7, `desert is ${(sand * 100).toFixed(0)}% sandy`)
    for (const b of ['forest', 'autumn']) {
      const trees = frac(at(b), s => !!s.prop && s.prop.startsWith('ow_tree'))
      assert.ok(trees > 0.15 && trees < 0.5, `${b} is ${(trees * 100).toFixed(0)}% trees`)
    }
    const mud = frac(at('marsh'), s => s.ground.startsWith('ow_mud_'))
    assert.ok(mud > 0.003, `marsh has ${(mud * 100).toFixed(2)}% mud-rimmed water`)
  }
})

test('enough of every piece is walkable', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed, 14)) {
    const t = built(seed, wx, wy, 0)
    let walk = 0
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (t.b.walkable(x + MARGIN, y + MARGIN)) walk++
    assert.ok(walk / (PIECE * PIECE) > 0.2, `piece ${wx},${wy} of seed ${seed} is only ${(walk / 64).toFixed(0)}% walkable`)
  }
})

test('open and path make walkable ground through anything', () => {
  for (const seed of SEEDS) for (const b of ['sea', 'mountain', 'forest']) {
    const p = pieceIn(seed, b)
    const t = makeTerrain(seed, p.wx, p.wy, 0)
    t.open(40, 40, 5)
    for (const side of ['N', 'E', 'S', 'W']) { const g = t.gateInner(side); t.path(g.x, g.y, 40, 40) }
    t.finish()
    // flood from the middle: every gate cell is reached
    const seen = new Set(['40,40']), stack = [[40, 40]]
    while (stack.length) {
      const [x, y] = stack.pop()
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen.has(`${nx},${ny}`) || !t.b.walkable(nx + MARGIN, ny + MARGIN)) continue
        seen.add(`${nx},${ny}`); stack.push([nx, ny])
      }
    }
    for (const side of ['N', 'E', 'S', 'W']) assert.ok(seen.has(`${t.gates[side].x},${t.gates[side].y}`), `${b} gate ${side} unreachable (seed ${seed})`)
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++)
      if (dx * dx + dy * dy <= 25) assert.ok(t.free(40 + dx, 40 + dy), `pad cell ${dx},${dy} not free in ${b}`)
  }
})

// ---- roads ------------------------------------------------------------------------
// The lanes a road wears where it crosses a piece edge, as offsets from the
// gate: g..g+2 at three wide, the whole corridor g-1..g+2 at four.
const roadLanes = (g, w = ROAD_WIDTH) => Array.from({ length: w }, (_, i) => g + 1 - (w >> 1) + i)
const isRoad = s => (s ?? '').startsWith('ow_road_')
// The skip-th piece with (or without) a road on its `side`, searched outward
// from home, away from the city.
function roadEdge(seed, side, want, skip = 0) {
  for (let r = 1; r < 30; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || isCityPiece(wx, wy) || isCityPiece(wx + 1, wy) || isCityPiece(wx, wy + 1)) continue
    if (roadSides(seed, wx, wy)[side] === want && skip-- <= 0) return { wx, wy }
  }
  throw new Error(`no piece with road ${side} = ${want} for seed ${seed}`)
}
const withRoadWidth = (w, fn) => { setRoadWidth(w); try { fn() } finally { setRoadWidth(3) } }

test('the road is three wide unless a tool asks for four, and has a ground of its own on four grounds', () => {
  assert.equal(ROAD_WIDTH, 3)
  withRoadWidth(4, () => assert.equal(ROAD_WIDTH, 4))
  assert.equal(ROAD_WIDTH, 3)
  assert.throws(() => setRoadWidth(5))
  assert.equal(ROAD_WIDTH, 3)
  for (const ground of ['grass', 'sand', 'mtn', 'marsh']) for (let i = 0; i < 4; i++) assert.ok(TERRAIN_SKINS.includes(`ow_road_${ground}_${i}`), `ow_road_${ground}_${i}`)
})

test('a road edge wears road lanes in the frame, the same on both sides of the edge, whatever the deal', () => {
  for (const w of [3, 4]) withRoadWidth(w, () => {
    for (const seed of SEEDS) for (const side of ['E', 'S']) for (const skip of [0, 3]) {
      const { wx, wy } = roadEdge(seed, side, true, skip)
      const [nx, ny] = side === 'E' ? [wx + 1, wy] : [wx, wy + 1]
      const g = gateAt(seed, wx, wy, side)
      const lanes = roadLanes(g)
      // o is the lane (an offset along the edge), d the depth from the edge into a piece
      const mine = (o, d) => side === 'E' ? [PIECE - 1 - d, o] : [o, PIECE - 1 - d]
      const theirs = (o, d) => side === 'E' ? [d, o] : [o, d]
      const looks = {}
      for (const deal of [0, 3]) {
        const A = built(seed, wx, wy, deal), B = built(seed, nx, ny, deal)
        const seen = []
        for (const o of [g - 1, g, g + 1, g + 2]) for (let d = 0; d < FRAME; d++) {
          for (const [t, [x, y]] of [[A, mine(o, d)], [B, theirs(o, d)]]) {
            const s = skinsOf(t, x, y)
            const at = `${w} wide, seed ${seed} ${wx},${wy} ${side} deal ${deal}: lane ${o - g} depth ${d} at ${x},${y} (${s.ground} / ${s.prop})`
            assert.ok(t.walkable(x, y), at)
            if (!lanes.includes(o)) { assert.ok(!isRoad(s.ground), at); continue }
            assert.ok(isRoad(s.ground) || isDeckSkin(s.prop), at)
            seen.push(isRoad(s.ground) ? s.ground : 'deck')
          }
          // A's margin past the edge is B's frame, and B's margin is A's frame
          if (d < MARGIN && lanes.includes(o)) {
            for (const [P, [px, py], Q, [qx, qy]] of [[A, mine(o, -1 - d), B, theirs(o, d)], [B, theirs(o, -1 - d), A, mine(o, d)]]) {
              const p = skinsOf(P, px, py).ground, q = skinsOf(Q, qx, qy).ground
              if (isRoad(p) || isRoad(q)) assert.equal(p, q, `${w} wide, seed ${seed} ${wx},${wy} ${side}: lane ${o - g} depth ${d} seen from both pieces`)
            }
          }
        }
        looks[deal] = seen.join(',')
      }
      assert.equal(looks[0], looks[3], `seed ${seed} ${wx},${wy} ${side}: the deal moved the road`)
    }
  })
})

test('an edge without a road keeps its two worn lanes', () => {
  const worn = s => /^ow_(dirt|path_sand)_/.test(s.ground) || isMountainGround(s.ground) || isDeckSkin(s.prop)
  for (const seed of SEEDS) for (const side of ['E', 'S']) for (const skip of [0, 2]) {
    const { wx, wy } = roadEdge(seed, side, false, skip)
    const A = built(seed, wx, wy, 0)
    const g = gateAt(seed, wx, wy, side)
    for (const o of [g - 1, g, g + 1, g + 2]) for (let d = 0; d < FRAME; d++) {
      const [x, y] = side === 'E' ? [PIECE - 1 - d, o] : [o, PIECE - 1 - d]
      const s = skinsOf(A, x, y), at = `seed ${seed} ${wx},${wy} ${side}: lane ${o - g} depth ${d} (${s.ground} / ${s.prop})`
      assert.ok(!isRoad(s.ground), at)
      if (o === g || o === g + 1) assert.ok(worn(s), at)
    }
  }
})

test('t.road lays ROAD_WIDTH-wide road ground, deck over water, and reports it through onRoad and onPath', () => {
  // the road's ground by the country under the cell
  const SET = { forest: ['grass'], autumn: ['grass'], mountain: ['mtn'], marsh: ['marsh'], desert: ['sand'], sea: ['grass', 'sand'] }
  for (const w of [3, 4]) withRoadWidth(w, () => {
    let decks = 0
    for (const seed of SEEDS) for (const country of Object.keys(SET)) {
      const p = pieceIn(seed, country)
      const t = makeTerrain(seed, p.wx, p.wy, 0)
      const from = t.gateInner('W'), to = t.gateInner('E')
      t.road(from.x, from.y, 40, 40)
      t.road(40, 40, to.x, to.y)
      t.finish()
      const at = (x, y) => `${w} wide, ${country} ${p.wx},${p.wy} seed ${seed} at ${x},${y}`
      let n = 0, off = 0
      for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
        const s = skinsOf(t, x, y)
        // nothing else is laid here, so inside the piece a cell is on the road
        // exactly when it wears the road's ground or the deck it laid
        if (t.inside(x, y) && !t.onRoad(x, y)) { off++; assert.ok(!isRoad(s.ground) && !isDeckSkin(s.prop), `${at(x, y)}: ${s.ground} / ${s.prop} off the road`) }
        if (!t.onRoad(x, y)) continue
        n++
        assert.ok(t.onPath(x, y) && t.inside(x, y) && t.walkable(x, y), at(x, y))
        if (isDeckSkin(s.prop)) { decks++; continue }
        const m = /^ow_road_([a-z]+)_\d$/.exec(s.ground)
        assert.ok(m && SET[t.biome(x, y)].includes(m[1]), `${at(x, y)}: ${s.ground} in ${t.biome(x, y)}`)
      }
      assert.ok(n > 0 && off > 0)
      // every column the road crosses holds a full road's width of it
      for (let x = FRAME; x < PIECE - FRAME; x++) {
        let col = 0
        for (let y = 0; y < PIECE; y++) if (t.onRoad(x, y)) col++
        assert.ok(col >= w, `${at(x, '*')}: ${col} road cells in the column`)
      }
    }
    assert.ok(decks > 0, 'no road crossed water on a deck')
  })
})

// Found in review: a step held inside at a border still laid part of its
// square in the frame, so the road thinned to a lane or two there.
test('a road keeps its full width along every border of the interior, three or four wide', () => {
  const IN0 = FRAME, IN1 = PIECE - 1 - FRAME
  // along each border's last interior line, and wandering a few cells off it
  const ROUTES = {
    N: [[IN0, IN0, IN1, IN0], [IN0, IN0 + 3, IN1, IN0 + 7]],
    S: [[IN0, IN1, IN1, IN1], [IN0, IN1 - 3, IN1, IN1 - 7]],
    W: [[IN0, IN0, IN0, IN1], [IN0 + 3, IN0, IN0 + 7, IN1]],
    E: [[IN1, IN0, IN1, IN1], [IN1 - 3, IN0, IN1 - 7, IN1]],
  }
  for (const w of [3, 4]) withRoadWidth(w, () => {
    for (const seed of SEEDS) for (const deal of [0, 2]) for (const [side, routes] of Object.entries(ROUTES)) for (const [x0, y0, x1, y1] of routes) {
      const t = makeTerrain(seed, 5, 5, deal)
      t.road(x0, y0, x1, y1)
      const eastWest = side === 'N' || side === 'S'   // count every column it crosses, else every row
      for (let a = IN0; a <= IN1; a++) {
        let k = 0
        for (let c = 0; c < PIECE; c++) if (eastWest ? t.onRoad(a, c) : t.onRoad(c, a)) k++
        assert.ok(k >= w, `${w} wide, seed ${seed} deal ${deal}, along the ${side} border (${x0},${y0} to ${x1},${y1}): ${k} road cells in ${eastWest ? 'column' : 'row'} ${a}`)
      }
    }
  })
})

test('a road from a road gate meets the frame\'s road lanes, three or four wide', () => {
  for (const w of [3, 4]) withRoadWidth(w, () => {
    for (const seed of SEEDS) for (const side of ['N', 'E', 'S', 'W']) for (const skip of [0, 1, 4]) {
      const { wx, wy } = roadEdge(seed, side, true, skip)
      const t = makeTerrain(seed, wx, wy, skip)
      const from = t.gateInner(side)
      t.road(from.x, from.y, 40, 40)
      t.finish()
      const g = gateAt(seed, wx, wy, side)
      for (const o of roadLanes(g)) {
        // the first cell inside the piece, and the last of the frame beside it
        const [ix, iy, fx, fy] = side === 'N' ? [o, FRAME, o, FRAME - 1] : side === 'S' ? [o, PIECE - 1 - FRAME, o, PIECE - FRAME]
          : side === 'W' ? [FRAME, o, FRAME - 1, o] : [PIECE - 1 - FRAME, o, PIECE - FRAME, o]
        const at = `${w} wide, seed ${seed} ${wx},${wy} ${side}: lane ${o - g}`
        assert.ok(t.onRoad(ix, iy), `${at}: no road inside at ${ix},${iy}`)
        const s = skinsOf(t, fx, fy)
        assert.ok(isRoad(s.ground) || isDeckSkin(s.prop), `${at}: the frame at ${fx},${fy} is ${s.ground}`)
      }
    }
  })
})
