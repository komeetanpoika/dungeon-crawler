import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCity, cityFor } from '../renderer/wilds/city/build.js'
import { generateCityPiece } from '../renderer/wilds/city/piece.js'
import { PLAN, insideWalls } from '../renderer/wilds/city/plan.js'
import { cutBlocks } from '../renderer/wilds/city/blocks.js'
import { CITY_KEYS, isCityPiece, fromCity } from '../renderer/wilds/city/geometry.js'
import { makeTerrain, WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { PIECE, FRAME } from '../renderer/wilds/layout.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeWorld, getPiece } from '../renderer/wilds/world.js'
import { taleOf } from '../renderer/wilds/tales.js'

const N = 160
const SEEDS = [1, 7, 4242]
const TILES = new URL('../renderer/assets/tiles/', import.meta.url).pathname
const keyOf = k => k.split(',').map(Number)
const cellsDigest = city => city.cells.map(r => r.map(c => `${c.skin}|${c.overlay ?? ''}|${c.deco ?? ''}|${c.tile}|${c.ward ? 1 : 0}`).join(',')).join('\n')
const walk = (city, x, y) => x >= 0 && y >= 0 && x < N && y < N && city.cells[y][x].tile === TILE.FLOOR

// The FRAME-wide strips of a city piece along its sides that face a piece of
// the Wilds (not another city piece), in piece tiles.
function outerFrameCells(wx, wy) {
  const out = []
  const open = { N: !isCityPiece(wx, wy - 1), S: !isCityPiece(wx, wy + 1), W: !isCityPiece(wx - 1, wy), E: !isCityPiece(wx + 1, wy) }
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    if ((open.N && y < FRAME) || (open.S && y >= PIECE - FRAME) || (open.W && x < FRAME) || (open.E && x >= PIECE - FRAME)) out.push([x, y])
  }
  return out
}

// Every walkable city cell reached from (x, y), four ways.
function reach(city, x, y) {
  const seen = new Uint8Array(N * N)
  if (!walk(city, x, y)) return seen
  const stack = [y * N + x]; seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop(), cx = i % N, cy = (i / N) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy
      if (!walk(city, nx, ny) || seen[ny * N + nx]) continue
      seen[ny * N + nx] = 1; stack.push(ny * N + nx)
    }
  }
  return seen
}
// The eight edge crossings in city tiles: where each outer gate's path ends inside the frame.
function crossings(seed) {
  const out = []
  for (const k of CITY_KEYS) {
    const [wx, wy] = keyOf(k)
    const t = makeTerrain(seed, wx, wy, 0)
    for (const side of ['N', 'E', 'S', 'W']) {
      const dx = side === 'E' ? 1 : side === 'W' ? -1 : 0, dy = side === 'S' ? 1 : side === 'N' ? -1 : 0
      if (isCityPiece(wx + dx, wy + dy)) continue
      const g = t.gates[side], inner = t.gateInner(side)
      out.push({ side, key: k, edge: { x: g.x + (wx - 0) * PIECE, y: g.y + (wy - 2) * PIECE }, inner: { x: inner.x + wx * PIECE, y: inner.y + (wy - 2) * PIECE } })
    }
  }
  return out
}
// the land gates' arches and the water gates' (plan.js PLAN.waterGates)
const GATE_CELLS = [[80, 20], [80, 21], [20, 68], [140, 75], ...PLAN.waterGates.flatMap(g => [[g.x, g.y - 1], [g.x, g.y], [g.x, g.y + 1]])]

test('the city is the same every time for a seed, and its skeleton the same in every world', () => {
  assert.deepEqual(cellsDigest(buildCity(7)), cellsDigest(buildCity(7)))
  // fixed places stand on the same cells whatever the seed
  const f = PLAN.places.fountain
  for (const seed of SEEDS) assert.equal(cityFor(seed).cells[f.y][f.x].overlay, cityFor(1).cells[f.y][f.x].overlay)
  assert.equal(cityFor(1).cells[f.y][f.x].overlay, 'ow_fountain_basin_empty')
  // so do the walls, the gates and the church
  const fixed = [[80, 20], [20, 68], [140, 75], [31, 66], [110, 56], [62, 120]]
  for (const seed of SEEDS) for (const [x, y] of fixed) {
    const a = cityFor(seed).cells[y][x], b = cityFor(1).cells[y][x]
    assert.equal(`${a.overlay}|${a.tile}`, `${b.overlay}|${b.tile}`, `${x},${y} seed ${seed}`)
  }
  // the blocks between differ between worlds
  assert.notEqual(cellsDigest(cityFor(1)), cellsDigest(cityFor(7)))
})

test('the outer frame is ordinary land the neighbours agree with', () => {
  for (const seed of SEEDS) for (const k of CITY_KEYS) {
    const [wx, wy] = keyOf(k); const piece = generateCityPiece(seed, wx, wy)
    const t = makeTerrain(seed, wx, wy, 0); t.finish()
    for (const [x, y] of outerFrameCells(wx, wy)) {   // FRAME-wide strips on the sides facing non-city pieces
      const c = piece.cells[y][x]
      const at = `${x},${y} of ${k} seed ${seed}`
      assert.equal(c.skin, t.groundAt(x, y), at); assert.equal(c.overlay ?? null, t.propAt(x, y) ?? null, at); assert.equal(c.tile === TILE.FLOOR, t.walkable(x, y), at)
      assert.equal(c.deco ?? null, null, at)
    }
  }
})

test('every door, gate, post and spot is reachable from the square', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const f = city.spots.fountain
    const seen = reach(city, f.x, f.y)
    const ok = (x, y) => seen[y * N + x] === 1
    for (const d of city.doors) assert.ok(ok(d.x, d.y), `door ${d.label} (${d.kind}) at ${d.x},${d.y} seed ${seed}`)
    for (const [x, y] of GATE_CELLS) assert.ok(ok(x, y), `gate ${x},${y} seed ${seed}`)
    for (const p of PLAN.posts) assert.ok(ok(p.x, p.y), `post ${p.id} seed ${seed}`)
    for (const [id, s] of Object.entries(city.spots)) assert.ok(ok(s.x, s.y), `spot ${id} at ${s.x},${s.y} seed ${seed}`)
    for (const c of crossings(seed)) assert.ok(ok(c.inner.x, c.inner.y) && ok(c.edge.x, c.edge.y), `crossing ${c.side} of ${c.key} seed ${seed}`)
    // and no alley is shut by what the builder put in the streets
    for (const a of cutBlocks(seed).alleys) {
      const [[ax, ay], [bx, by]] = a.pts
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) assert.ok(ok(x, y), `alley cell ${x},${y} seed ${seed}`)
    }
    assert.ok(ok(city.inn.door.x, city.inn.door.y) && ok(city.inn.doorstep.x, city.inn.doorstep.y))
  }
})

test('the spots the townsfolk will need are all there', () => {
  const city = cityFor(7)
  const want = [...PLAN.posts.map(p => p.id), 'crier', 'stocks', 'fountain', 'bell', 'fish-market', 'church-steps', 'quay-1', 'quay-2', 'quay-3',
    'stall-1', 'bench-1', 'smithy-anvil', 'church-door', 'inn-door', 'barracks-door',
    ...['N', 'W', 'E'].flatMap(g => [`gate-${g}-in`, `gate-${g}-out`])]
  for (const id of want) assert.ok(city.spots[id], id)
  for (const p of PLAN.posts) assert.deepEqual(city.spots[p.id], { x: p.x, y: p.y })
  for (const [id, s] of Object.entries(city.spots)) {
    const inside = insideWalls(s.x, s.y)
    assert.equal(inside, !id.endsWith('-out'), `${id} is ${inside ? 'inside' : 'outside'} the walls`)
  }
})

test('all eight edge crossings join a city gate', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const all = crossings(seed)
    assert.equal(all.length, 8)
    for (const c of all) {
      const seen = reach(city, c.edge.x, c.edge.y)
      assert.ok(GATE_CELLS.some(([x, y]) => seen[y * N + x]), `crossing ${c.side} of ${c.key} seed ${seed} reaches no gate`)
    }
  }
})

test('every walkable cell inside the walls is warded and none outside is', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    let warded = 0
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = city.cells[y][x]
      const want = c.tile === TILE.FLOOR && insideWalls(x, y)
      assert.equal(!!c.ward, want, `${x},${y} seed ${seed}`)
      if (want) warded++
    }
    assert.ok(warded > 5000, `${warded} warded cells`)
    // the gate arches carry it too
    for (const [x, y] of GATE_CELLS) assert.equal(city.cells[y][x].ward, true)
  }
})

test('the inn piece holds the village record and the doorstep spawn', () => {
  const p = generateCityPiece(7, 0, 2); assert.equal(p.village.city, true); assert.deepEqual(p.spawnPoint, { x: p.village.x, y: p.village.y })
  assert.equal(p.village.name, 'Kalevanlinna')
  const inn = cityFor(7).inn.doorstep
  assert.deepEqual({ x: p.village.x, y: p.village.y }, inn)   // (0, 2) is the city's north-west piece: piece tiles are city tiles
  for (const k of CITY_KEYS) {
    const [wx, wy] = keyOf(k); const q = generateCityPiece(7, wx, wy)
    assert.equal(q.city, true); assert.equal(q.deal, 0); assert.equal(q.main.kind, 'city'); assert.equal(q.key, k)
    assert.equal(q.cells.length, PIECE); assert.equal(q.cells[0].length, PIECE)
    assert.equal(q.cells[q.spawnPoint.y][q.spawnPoint.x].tile, TILE.FLOOR, `spawn of ${k}`)
    if (k !== '0,2') assert.equal(q.village, null)
    assert.deepEqual(q.gates, makeTerrain(7, wx, wy, 0).gates)
    assert.deepEqual(q.packs, []); assert.deepEqual(q.caves, [])
    for (const s of q.spawns) assert.ok(['chicken', 'sheep', 'goat'].includes(s.species) && s.kind === 'npc', JSON.stringify(s))
    for (const s of q.spawns) assert.ok(!insideWalls(s.x + wx * PIECE, s.y + (wy - 2) * PIECE), 'farm animals stay in the outskirts')
    for (const d of q.doors) {
      const { X, Y } = fromCity(d.x + wx * PIECE, d.y + (wy - 2) * PIECE)
      assert.equal(d.label, `house:city:${X},${Y}`)
      assert.equal(q.cells[d.y][d.x].tile, TILE.FLOOR)
    }
  }
  // the pieces share the city's doors out between them, and a piece's cells are its own
  assert.equal(CITY_KEYS.reduce((n, k) => n + generateCityPiece(7, ...keyOf(k)).doors.length, 0), cityFor(7).doors.length)
  assert.notEqual(generateCityPiece(7, 0, 2).cells[10][10], generateCityPiece(7, 0, 2).cells[10][10])
})

test('every lot has its door, and the church and castle doors are shut', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const lots = cutBlocks(seed).lots
    const byLot = new Map(city.doors.filter(d => d.lot).map(d => [d.lot, d]))
    for (const l of lots) {
      const d = byLot.get(l.id)
      assert.ok(d, `lot ${l.id} has a door`)
      assert.ok(d.x >= l.x0 && d.x <= l.x1 && d.y >= l.y0 && d.y <= l.y1, `door of ${l.id} in its lot`)
    }
    for (const d of city.doors) {
      assert.equal(d.city, true); assert.equal(d.tier, 'safe'); assert.ok(d.look && d.look.w >= 3 && d.look.storeys >= 1)
      assert.ok(['home', 'shop', 'workshop', 'inn', 'smithy', 'barracks', 'church', 'castle', 'warehouse'].includes(d.kind), d.kind)
    }
    const church = city.doors.find(d => d.kind === 'church'), castle = city.doors.find(d => d.kind === 'castle')
    assert.equal(church.closed, 'The vicar is preparing his sermon. The door is shut.')
    assert.equal(castle.closed, '"The Count receives no one today," says the guard.')
    assert.ok(city.doors.filter(d => d.closed).length === 2)
    assert.equal(new Set(city.doors.map(d => d.label)).size, city.doors.length, 'one door per cell')
    assert.ok(city.doors.some(d => d.kind === 'inn') && city.doors.some(d => d.kind === 'smithy') && city.doors.some(d => d.kind === 'barracks'))
  }
})

test('lamps, chimneys and windows are where the city says', () => {
  const city = cityFor(7)
  assert.ok(city.lamps.length >= 20)
  for (const l of city.lamps) assert.match(city.cells[l.y][l.x].overlay, /^ow_prop_city_lamp/)
  assert.ok(city.chimneys.length > 100)
  const labels = new Set(city.doors.map(d => d.label))
  for (const c of city.chimneys) { assert.ok(labels.has(c.door)); assert.match(city.cells[c.y][c.x].overlay, /chim/) }
  assert.ok(city.windows.length > 200)
  for (const w of city.windows) assert.ok(labels.has(w.door))
})

// The gate is a warm build: the city is built once, when the game enters the
// Wilds (a load moment), so the first, cold build there also pays for
// compiling the generator (several hundred ms in a fresh process). Here the
// test warms up on three other seeds itself, so it means the same run alone
// or after the other tests.
test('building is quick enough', () => {
  for (const seed of [101, 202, 303]) buildCity(seed)
  const t0 = performance.now(); buildCity(31337); const build = performance.now() - t0
  assert.ok(build < 200 * 2, `a warm build took ${build.toFixed(0)} ms`)   // CI headroom ×2
  const t1 = performance.now(); generateCityPiece(31337, 1, 3); const piece = performance.now() - t1
  assert.ok(piece < 10 * 2, `a piece took ${piece.toFixed(1)} ms`)
})

test('every skin the city lays exists as a tile, and the game loads it', () => {
  const wilds = new Set(WILDS_SKINS)
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const names = new Set()
    for (const r of city.cells) for (const c of r) for (const n of [c.skin, c.overlay, c.deco]) if (n) names.add(n)
    for (const n of names) {
      assert.ok(fs.existsSync(`${TILES}${n}.png`), `${n} has no tile`)
      assert.ok(wilds.has(n), `${n} is not in WILDS_SKINS`)
    }
  }
})

test('the world hands out city pieces from the city', () => {
  const world = makeWorld(null, { seed: 7 })
  const p = getPiece(world, 1, 2)
  assert.equal(p.city, true)
  assert.equal(getPiece(world, 2, 2).city, undefined)
  // no tale ever belongs to the city
  for (const k of CITY_KEYS) assert.equal(taleOf(7, { wx: keyOf(k)[0], wy: keyOf(k)[1] }), null)
})
