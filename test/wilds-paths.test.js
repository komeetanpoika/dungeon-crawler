// The paths and bridges of a Wilds piece can be walked from end to end.
//
// Found broken in play: a trail one cell wide stepped corner to corner, which
// over water is a bridge nobody can cross (and through rock or thick wood a
// pass nobody can use), and things built after the paths were laid stood on
// them. A thing the piece could then not reach was silently dropped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePiece } from '../renderer/wilds/piece.js'
import { makeTerrain } from '../renderer/wilds/terrain.js'
import { placeFeatures } from '../renderer/wilds/features.js'
import { PIECE, FRAME, BIOMES, pieceKey, tierAt, pieceBiome, lootDepthFor, villageAt, biomeAt } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { TILE } from '../renderer/systems/entities.js'

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const padOf = kind => kind === 'hut' ? 5 : kind === 'stones' ? 3 : 2   // as features.js opens them
const isPier = s => (s ?? '').startsWith('ow_pier')

// Cells reached from `from` by steps that share an edge, over cells `ok` allows.
function flood(from, ok) {
  const seen = new Uint8Array(PIECE * PIECE)
  if (!ok(from.x, from.y)) return seen
  const stack = [from.y * PIECE + from.x]
  seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop(), x = i % PIECE, y = (i / PIECE) | 0
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen[ny * PIECE + nx] || !ok(nx, ny)) continue
      seen[ny * PIECE + nx] = 1; stack.push(ny * PIECE + nx)
    }
  }
  return seen
}
// Pairs of walkable cells that touch only at a corner, both of them `kind`.
function cornerJoints(walk, kind) {
  const out = []
  for (let y = 0; y < PIECE - 1; y++) for (let x = 0; x < PIECE; x++) for (const dx of [1, -1]) {
    if (!kind(x, y) || !kind(x + dx, y + 1) || !walk(x, y) || !walk(x + dx, y + 1)) continue
    if (!walk(x + dx, y) && !walk(x, y + 1)) out.push(`${x},${y}/${x + dx},${y + 1}`)
  }
  return out
}

// A piece as piece.js makes it, with its terrain kept so the test can ask
// what is path and what is a site's own ground, and which small thing got a trail.
function built(seed, wx, wy, deal = 0, tale = null, villageTale = null) {
  const t = makeTerrain(seed, wx, wy, deal)
  const trails = []
  const lay = t.path
  t.path = (x0, y0, x1, y1, width = 2) => { if (width === 1) trails.push(`${x0},${y0}`); return lay(x0, y0, x1, y1, width) }
  const tier = tierAt(wx, wy)
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy),
    main: null, small: [], packs: [], tale, points: [], villageTale, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  t.finish()
  const opened = new Set([...piece.doors, ...piece.caves].map(d => d.y * PIECE + d.x))
  const walk = (x, y) => x >= 0 && y >= 0 && x < PIECE && y < PIECE && (t.walkable(x, y) || opened.has(y * PIECE + x))
  return { t, piece, walk, trailed: piece.small.filter(s => trails.includes(`${s.x},${s.y}`)), at: `seed ${seed} piece ${wx},${wy} deal ${deal}${tale ? ' ' + tale : ''}${villageTale ? ' village of ' + villageTale : ''} (${piece.biome} ${piece.main.kind})` }
}
// The walk a path promises: on path, in a gate's corridor, or on the ground
// of the site at either end. Never across the open country beside it.
const alongPaths = ({ t, walk }) => (x, y) => walk(x, y) && (t.onPath(x, y) || t.onSite(x, y) || Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y) < FRAME)
const inPad = (seen, s) => {
  const r = padOf(s.kind)
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (dx * dx + dy * dy <= r * r && seen[(s.y + dy) * PIECE + s.x + dx] === 1) return true
  return false
}
function checkPaths(b) {
  const { t, piece, walk, at } = b
  assert.deepEqual(cornerJoints(walk, (x, y) => isPier(t.propAt(x, y))), [], `${at}: pier cells joined only at a corner`)
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++)
    if (t.onPath(x, y) && !t.onSite(x, y)) assert.ok(walk(x, y), `${at}: the path is built over at ${x},${y} (${t.propAt(x, y) ?? t.groundAt(x, y)})`)
  const seen = flood(piece.spawnPoint, alongPaths(b))
  for (const [side, g] of Object.entries(piece.gates)) assert.equal(seen[g.y * PIECE + g.x], 1, `${at}: the road to gate ${side} is broken`)
  for (const s of b.trailed) assert.ok(inPad(seen, s), `${at}: the trail to the ${s.kind} at ${s.x},${s.y} is broken`)
}

// Home and the land round it, and pieces far out in every direction.
const SEEDS = [1, 3, 2024]
const samplePieces = seed => {
  const out = []
  for (let wy = -2; wy <= 2; wy++) for (let wx = -2; wx <= 2; wx++) out.push({ wx, wy, deal: 0 })
  for (let i = 0; i < 12; i++) out.push({ wx: (hashInt(seed, i, 0, 6) % 25) - 12, wy: (hashInt(seed, i, 1, 6) % 25) - 12, deal: 1 + i % 2 })
  return out
}
// A piece well inside the named country.
function pieceIn(seed, biome) {
  for (let r = 2; r < 40; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r) continue
    if ([8, 40, 72].every(y => [8, 40, 72].every(x => biomeAt(seed, wx * PIECE + x, wy * PIECE + y) === biome))) return { wx, wy }
  }
  throw new Error(`no ${biome} piece found for seed ${seed}`)
}

test('a trail one cell wide is a stair: every step shares an edge', () => {
  for (const seed of SEEDS) for (const biome of ['sea', 'mountain', 'forest']) {
    const { wx, wy } = pieceIn(seed, biome)
    // long diagonals, each alone on its piece so nothing else joins it up
    for (const [x0, y0, x1, y1] of [[12, 14, 66, 61], [64, 10, 13, 58], [10, 40, 68, 52], [38, 9, 47, 70]]) {
      const t = makeTerrain(seed, wx, wy, 0)
      t.path(x0, y0, x1, y1, 1)
      const seen = flood({ x: x0, y: y0 }, (x, y) => t.onPath(x, y) && t.walkable(x, y))
      let cells = 0
      for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (t.onPath(x, y)) {
        cells++
        assert.equal(seen[y * PIECE + x], 1, `${biome} seed ${seed}: the trail ${x0},${y0} to ${x1},${y1} breaks before ${x},${y}`)
      }
      assert.equal(seen[y1 * PIECE + x1], 1)
      // still a trail: a stair of n steps, not a road
      assert.ok(cells < 2.2 * Math.hypot(x1 - x0, y1 - y0), `${cells} cells for a trail ${Math.hypot(x1 - x0, y1 - y0).toFixed(0)} long`)
    }
  }
})

test('two paths that brush past each other are joined, not left corner to corner', () => {
  const { wx, wy } = pieceIn(3, 'sea')
  const t = makeTerrain(3, wx, wy, 0)
  // a fan of trails and roads out of one hub, as a piece lays them
  for (const [x, y, w] of [[10, 12, 2], [66, 14, 2], [12, 66, 2], [68, 60, 2], [30, 9, 1], [9, 34, 1], [52, 70, 1], [70, 38, 1], [22, 62, 1]]) t.path(x, y, 40, 40, w)
  assert.deepEqual(cornerJoints((x, y) => t.walkable(x, y), (x, y) => t.onPath(x, y)), [])
})

test('off a site\'s own ground nothing is built on a path', () => {
  for (const biome of ['forest', 'sea']) {
    const { wx, wy } = pieceIn(77, biome)
    const t = makeTerrain(77, wx, wy, 0)
    t.open(40, 40, 4)
    t.path(10, 40, 40, 40, 2)
    const far = []
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < 30; x++) if (t.onPath(x, y)) far.push({ x, y })
    assert.ok(far.length >= 30 && far.every(c => !t.onSite(c.x, c.y)))
    const was = far.map(c => [t.groundAt(c.x, c.y), t.propAt(c.x, c.y)])
    for (const c of far) { t.setProp(c.x, c.y, 'ow_rock_gray_0'); t.setMass(c.x, c.y); t.setWater(c.x, c.y) }
    assert.deepEqual(far.map(c => [t.groundAt(c.x, c.y), t.propAt(c.x, c.y)]), was, `${biome}: the path was changed`)
    assert.ok(far.every(c => t.walkable(c.x, c.y)), `${biome}: the path was blocked`)
    // what is walked on may still be laid there
    t.setProp(far[0].x, far[0].y, 'ow_deco_flower_0', { walkable: true })
    assert.equal(t.propAt(far[0].x, far[0].y), 'ow_deco_flower_0')
    // on the pad, and on ground a site claims, the site may build what it likes
    assert.ok(t.onPath(38, 40) && t.onSite(38, 40))
    t.setProp(38, 40, 'ow_well')
    assert.ok(!t.walkable(38, 40))
    t.claim(far[3].x, far[3].y)
    t.setWater(far[3].x, far[3].y)
    assert.ok(!t.walkable(far[3].x, far[3].y))
  }
})

test('every road and trail of a piece can be walked from end to end, and no bridge is joined at a corner', () => {
  const seen = { biomes: new Set(), mains: new Set() }
  let piers = 0, trails = 0
  for (const seed of SEEDS) for (const { wx, wy, deal } of samplePieces(seed)) {
    const b = built(seed, wx, wy, deal)
    checkPaths(b)
    seen.biomes.add(b.piece.biome); seen.mains.add(b.piece.main.kind)
    trails += b.trailed.length
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (isPier(b.t.propAt(x, y))) piers++
  }
  // the sample is worth its name: every country, every kind of main thing, plenty of bridge
  assert.deepEqual([...seen.biomes].sort(), [...BIOMES].sort())
  for (const kind of ['village', 'ring', 'cave', 'camp', 'boss', 'ruin', 'landmark']) assert.ok(seen.mains.has(kind), `no ${kind} in the sample`)
  assert.ok(piers > 3000 && trails > 250, `${piers} pier cells, ${trails} trails`)
})

const TALE_SPOTS = { elk: ['forest', 'autumn'], tar: ['sea', 'marsh'], kivihiisi: ['mountain'], nakki: ['forest', 'autumn', 'marsh'], fold: ['forest', 'autumn', 'mountain'], flame: ['marsh', 'autumn', 'forest'], lalli: ['forest', 'autumn', 'marsh'] }
test('the same in a tale\'s place and in a village built for a tale', () => {
  for (const seed of [3, 77]) {
    for (const [id, lands] of Object.entries(TALE_SPOTS)) {
      let n = 0
      for (let r = 1; r <= 9 && n < 3; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
        if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || villageAt(seed, wx, wy) || n >= 3 || !lands.includes(pieceBiome(seed, wx, wy))) continue
        checkPaths(built(seed, wx, wy, n++ % 2, id))
      }
      assert.equal(n, 3, `too little ${lands} land for ${id}`)
    }
    const villages = [{ wx: 0, wy: 0 }]
    for (let wy = -6; wy <= 6; wy++) for (let wx = -6; wx <= 6; wx++) if (villageAt(seed, wx, wy) && villages.length < 3) villages.push({ wx, wy })
    for (const { wx, wy } of villages) for (const vt of ['nakki', 'fold', 'flame', 'lalli']) checkPaths(built(seed, wx, wy, 0, null, vt))
  }
})

// The same promise seen from the game's side, on the cells it is handed.
test('the game\'s cells: no bridge joined at a corner, and nothing a trail leads to is cut off', () => {
  const walk = p => (x, y) => p.cells[y]?.[x]?.tile === TILE.FLOOR
  const pieces = [[1, 2, 2, 0]]   // the piece the bug was first seen on: 20 such joints
  for (const seed of SEEDS) for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) pieces.push([seed, wx, wy, 1])
  for (const seed of SEEDS) for (const biome of ['sea', 'marsh', 'mountain']) { const { wx, wy } = pieceIn(seed, biome); pieces.push([seed, wx, wy, 0]) }
  let huts = 0
  for (const [seed, wx, wy, deal] of pieces) {
    const p = generatePiece(seed, wx, wy, deal)
    const at = `seed ${seed} piece ${wx},${wy} deal ${deal} (${p.biome} ${p.main.kind})`
    assert.deepEqual(cornerJoints(walk(p), (x, y) => isPier(p.cells[y]?.[x]?.overlay)), [], `${at}: pier cells joined only at a corner`)
    const seen = flood(p.spawnPoint, walk(p))
    for (const [side, g] of Object.entries(p.gates)) assert.equal(seen[g.y * PIECE + g.x], 1, `${at}: gate ${side} cut off`)
    for (const s of p.small) {
      assert.ok(inPad(seen, s), `${at}: the ${s.kind} at ${s.x},${s.y} is cut off`)
      // a hut whose door could not be reached lost it without a word
      if (s.kind === 'hut') { huts++; assert.ok(p.doors.some(d => d.x === s.x && d.y === s.y), `${at}: the hut at ${s.x},${s.y} has no door`) }
    }
  }
  assert.ok(huts >= 5, `${huts} huts`)
})
