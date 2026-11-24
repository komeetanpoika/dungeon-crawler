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
import { layoutTale } from '../renderer/wilds/sites.js'
import { roadSides, pieceClass } from '../renderer/wilds/roads.js'
import { PIECE, FRAME, BIOMES, pieceKey, tierAt, pieceBiome, lootDepthFor, villageAt, biomeAt } from '../renderer/wilds/layout.js'
import { hashInt, mulberry32 } from '../renderer/wilds/rand.js'
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
// what is path and what is a site's own ground, which small thing got a
// trail, and every path and road the features laid.
function built(seed, wx, wy, deal = 0, tale = null, villageTale = null) {
  const t = makeTerrain(seed, wx, wy, deal)
  const trails = [], laid = []
  const lay = t.path, layRoad = t.road
  t.path = (x0, y0, x1, y1, width = 2) => {
    if (width === 1) trails.push(`${x0},${y0}`)
    laid.push({ kind: 'path', x0, y0, x1, y1, width })
    return lay(x0, y0, x1, y1, width)
  }
  t.road = (x0, y0, x1, y1) => { laid.push({ kind: 'road', x0, y0, x1, y1 }); return layRoad(x0, y0, x1, y1) }
  const tier = tierAt(wx, wy)
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy), cls: pieceClass(seed, wx, wy), road: null,
    main: null, small: [], packs: [], tale, points: [], villageTale, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  t.finish()
  const opened = new Set([...piece.doors, ...piece.caves].map(d => d.y * PIECE + d.x))
  const walk = (x, y) => x >= 0 && y >= 0 && x < PIECE && y < PIECE && (t.walkable(x, y) || opened.has(y * PIECE + x))
  return { t, piece, walk, laid, trailed: piece.small.filter(s => trails.includes(`${s.x},${s.y}`)), at: `seed ${seed} piece ${wx},${wy} deal ${deal}${tale ? ' ' + tale : ''}${villageTale ? ' village of ' + villageTale : ''} (${piece.biome} ${piece.cls} ${piece.main.kind})` }
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

// ---- the road inside a piece ------------------------------------------------------
// A piece with a road edge is laid round its roads (features.js): a road from
// each road gate to a junction beside the main thing, or to the hub of a
// village or of a tale's place; a piece with no road edge as it always was.
const SIDES = ['N', 'E', 'S', 'W']
const PAD = { village: 12, ring: 6, cave: 5, camp: 6, boss: 7, ruin: 8, landmark: 7 }   // as features.js opens them
const CALM = 10   // at toughness 1 and 2, no foe of a pack this near a road
const sidesOf = sides => SIDES.filter(s => sides[s])
// Road pieces round home that are neither a village nor Kalevanlinna, nearest first.
function roadPieces(seed, n, keep = () => true) {
  const out = []
  for (let r = 0; r <= 30 && out.length < n; r++) for (let wy = -r; wy <= r && out.length < n; wy++) for (let wx = -r; wx <= r && out.length < n; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r) continue
    const cls = pieceClass(seed, wx, wy)
    if (cls === 'village' || cls === 'city' || cls === 'wild' || sidesOf(roadSides(seed, wx, wy)).length === 0) continue
    if (keep(wx, wy)) out.push({ wx, wy })
  }
  return out
}
function villagePieces(seed, n) {
  const out = []
  for (let r = 0; r <= 12 && out.length < n; r++) for (let wy = -r; wy <= r && out.length < n; wy++) for (let wx = -r; wx <= r && out.length < n; wx++)
    if (Math.max(Math.abs(wx), Math.abs(wy)) === r && pieceClass(seed, wx, wy) === 'village') out.push({ wx, wy })
  return out
}
// Ten road pieces a seed, each dealt four times, and four villages a seed
// dealt twice; built once, shared by the tests below.
let sample = null, villages = null
const roadSample = () => sample ??= SEEDS.flatMap(seed => roadPieces(seed, 10).flatMap(({ wx, wy }) => [0, 1, 2, 3].map(deal => built(seed, wx, wy, deal))))
const villageSample = () => villages ??= SEEDS.flatMap(seed => villagePieces(seed, 4).flatMap(({ wx, wy }) => [0, 1].map(deal => built(seed, wx, wy, deal))))

// Every road gate of the piece reaches every other, and the junction, over
// walkable road cells alone.
function checkRoads({ t, piece, walk, at }) {
  assert.ok(piece.road, `${at}: no road recorded`)
  const names = sidesOf(piece.road.sides), gates = names.map(s => t.gateInner(s))
  assert.ok(gates.length >= 1, `${at}: a road piece with no road gate`)
  const seen = flood(gates[0], (x, y) => t.onRoad(x, y) && walk(x, y))
  for (const [i, g] of gates.entries()) assert.equal(seen[g.y * PIECE + g.x], 1, `${at}: the road from gate ${names[0]} does not reach gate ${names[i]}`)
  const j = piece.road.junction
  assert.equal(seen[j.y * PIECE + j.x], 1, `${at}: the roads do not meet at the junction ${j.x},${j.y}`)
}

test('in a road piece every road gate reaches every other over road cells alone, for deals 0..3', () => {
  const pieces = roadSample()
  assert.equal(pieces.length, 120)
  const ways = new Set()
  for (const b of pieces) { checkRoads(b); ways.add(sidesOf(b.piece.road.sides).length) }
  // through roads and junctions both
  assert.ok(ways.has(2) && ways.has(3), `only pieces with ${[...ways]} road sides in the sample`)
})

test('the same holds where the piece is mostly sea or mostly mountain', () => {
  const seeds = [...SEEDS, 7]
  for (const biome of ['sea', 'mountain']) {
    let n = 0, decks = 0, cuts = 0
    for (const seed of seeds) for (const { wx, wy } of roadPieces(seed, 2, (wx, wy) => pieceBiome(seed, wx, wy) === biome)) for (const deal of [0, 1]) {
      const b = built(seed, wx, wy, deal)
      checkRoads(b)
      n++
      for (let y = FRAME; y < PIECE - FRAME; y++) for (let x = FRAME; x < PIECE - FRAME; x++) {
        if (!b.t.onRoad(x, y)) continue
        if (isPier(b.t.propAt(x, y))) decks++
        if (/^ow_road_mtn_/.test(b.t.groundAt(x, y))) cuts++
      }
    }
    assert.ok(n >= 8, `found only ${n / 2} road pieces of ${biome} country round home in seeds ${seeds}`)
    // the sample crosses what it is meant to cross
    if (biome === 'sea') assert.ok(decks > 50, `${decks} road cells of deck over the sea`)
    else assert.ok(cuts > 200, `${cuts} road cells of mountain road`)
  }
})

test('the junction keeps clear of the main thing', () => {
  for (const b of roadSample()) {
    const { t, piece, at } = b
    const j = piece.road.junction, m = piece.main, pad = PAD[m.kind]
    assert.ok(Math.hypot(j.x - m.x, j.y - m.y) >= pad + 4, `${at}: the junction ${j.x},${j.y} is ${Math.hypot(j.x - m.x, j.y - m.y).toFixed(1)} from the ${m.kind} at ${m.x},${m.y}`)
    for (const v of [j.x, j.y]) assert.ok(v >= FRAME + 8 && v <= PIECE - FRAME - 9, `${at}: the junction ${j.x},${j.y} is out of its box`)
    // nor does a road run through the main thing's pad
    for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++)
      if (dx * dx + dy * dy <= pad * pad) assert.ok(!t.onRoad(m.x + dx, m.y + dy), `${at}: a road runs through the ${m.kind}'s pad at ${m.x + dx},${m.y + dy}`)
  }
})

test('a tale place on a road piece keeps its hub and the road reaches it', () => {
  const lands = { nakki: ['forest', 'autumn', 'marsh'], tar: ['sea', 'marsh'] }
  for (const seed of [3, 77]) for (const [id, land] of Object.entries(lands)) {
    const spots = roadPieces(seed, 2, (wx, wy) => pieceClass(seed, wx, wy) === 'roadside' && land.includes(pieceBiome(seed, wx, wy)))
    assert.equal(spots.length, 2, `seed ${seed}: too little roadside ${land} land for ${id}`)
    for (const [deal, { wx, wy }] of spots.entries()) {
      const b = built(seed, wx, wy, deal, id)
      const { t, piece, at } = b
      // the place is laid out as on a piece with no road: its hub is where the roads meet
      const hub = layoutTale(id, mulberry32(hashInt(seed, wx, wy, 500 + deal)), side => t.gateInner(side)).hub
      assert.deepEqual(piece.road?.junction, hub, `${at}: the roads meet at ${JSON.stringify(piece.road?.junction)}, not at the hub`)
      assert.deepEqual(piece.spawnPoint, hub, at)
      const seen = flood(hub, alongPaths(b))
      for (const s of sidesOf(piece.road.sides)) {
        const g = t.gateInner(s)
        assert.ok(t.onRoad(g.x, g.y), `${at}: gate ${s} carries no road into the piece`)
        assert.equal(seen[g.y * PIECE + g.x], 1, `${at}: the road from gate ${s} does not reach the hub`)
      }
      checkPaths(b)
    }
  }
})

test('every gate and small thing of a road piece is still reached on foot from the spawn point', () => {
  let small = 0
  for (const b of [...roadSample(), ...villageSample()]) {
    const { piece, walk, at } = b
    const seen = flood(piece.spawnPoint, walk)
    for (const [side, g] of Object.entries(piece.gates)) assert.equal(seen[g.y * PIECE + g.x], 1, `${at}: gate ${side} cut off`)
    for (const s of piece.small) { small++; assert.ok(inPad(seen, s), `${at}: the ${s.kind} at ${s.x},${s.y} is cut off`) }
    checkPaths(b)
  }
  assert.ok(small > 200, `${small} small things`)
})

test('no pack near the road at toughness 1 and 2', () => {
  let packs = 0, pieces = 0
  for (const b of [...roadSample(), ...villageSample()]) {
    const { t, piece, at } = b
    if (piece.tier > 2) continue
    pieces++
    const road = []
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) if (t.onRoad(x, y)) road.push({ x, y })
    const gap = p => Math.min(...road.map(c => Math.hypot(c.x - p.x, c.y - p.y)))
    for (const k of piece.packs) {
      packs++
      assert.ok(!k.road, `${at}: a pack posted on the road`)
      for (const s of piece.spawns.filter(s => s.kind !== 'chest' && Math.hypot(s.x - k.x, s.y - k.y) <= 3))
        assert.ok(gap(s) >= CALM, `${at}: a ${s.species ?? s.kind} of the pack at ${k.x},${k.y} stands ${gap(s).toFixed(1)} tiles from the road`)
    }
  }
  assert.ok(pieces >= 40 && packs >= 20, `${packs} packs in ${pieces} calm road pieces`)
})

test('a wild piece is laid out as before', () => {
  let n = 0
  for (const seed of SEEDS) for (const { wx, wy, deal } of samplePieces(seed)) {
    if (sidesOf(roadSides(seed, wx, wy)).length) continue
    const { t, piece, laid, at } = built(seed, wx, wy, deal)
    n++
    assert.equal(piece.road, null, at)
    assert.equal(piece.cls, 'wild', at)
    assert.ok(!laid.some(l => l.kind === 'road'), `${at}: a road laid on a wild piece`)
    const hub = { x: piece.main.x, y: piece.main.y }
    const endsAtHub = l => l.x1 === hub.x && l.y1 === hub.y
    for (const side of SIDES) {
      const g = t.gateInner(side)
      assert.ok(laid.some(l => l.kind === 'path' && l.width === 2 && l.x0 === g.x && l.y0 === g.y && endsAtHub(l)), `${at}: no path two wide from gate ${side} to the hub`)
    }
    for (const s of piece.small) for (const l of laid.filter(l => l.x0 === s.x && l.y0 === s.y)) assert.ok(endsAtHub(l), `${at}: the ${s.kind}'s trail leads elsewhere`)
  }
  assert.ok(n >= 20, `only ${n} wild pieces in the sample`)
})

test('a village is entered by its roads: each reaches the square over road cells, cobbled inside the village', () => {
  let streets = 0
  for (const b of villageSample()) {
    const { t, piece, walk, laid, at } = b
    const c = piece.main
    assert.deepEqual(piece.road?.junction, { x: c.x, y: c.y }, `${at}: the roads do not meet at the hub`)
    for (const s of sidesOf(piece.road.sides)) {
      const seen = flood(t.gateInner(s), (x, y) => t.onRoad(x, y) && walk(x, y))
      let square = false
      for (let y = c.y - 4; y <= c.y + 4; y++) for (let x = c.x - 4; x <= c.x + 4; x++) if (Math.hypot(x - c.x, y - c.y) <= 4 && seen[y * PIECE + x]) square = true
      assert.ok(square, `${at}: the road from gate ${s} does not reach the square`)
      streets++
    }
    // a gate with no road keeps a trail
    for (const s of SIDES.filter(s => !piece.road.sides[s])) {
      const g = t.gateInner(s)
      assert.ok(laid.some(l => l.kind === 'path' && l.width === 1 && l.x0 === g.x && l.y0 === g.y), `${at}: gate ${s} has no trail`)
    }
    for (let y = c.y - 12; y <= c.y + 12; y++) for (let x = c.x - 12; x <= c.x + 12; x++) {
      if (Math.hypot(x - c.x, y - c.y) > 12 || !t.onRoad(x, y) || t.kind(x, y) === 'water') continue
      assert.equal(t.groundAt(x, y), 'ow_cobble_green', `${at}: the street at ${x},${y} is not cobbled`)
      assert.ok(walk(x, y), `${at}: the street at ${x},${y} is built on (${t.propAt(x, y)})`)
    }
  }
  assert.ok(streets >= 40, `${streets} streets`)
})
