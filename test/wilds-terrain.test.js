import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTerrain, WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { PIECE, FRAME, MARGIN, biomeAt, pieceBiome, gateAt } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { TREE_PAIRS } from '../renderer/terrain/lib.js'

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
