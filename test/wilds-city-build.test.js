import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCity, cityFor } from '../renderer/wilds/city/build.js'
import { generateCityPiece } from '../renderer/wilds/city/piece.js'
import { PLAN, insideWalls, wallCells, towerRect } from '../renderer/wilds/city/plan.js'
import { cutBlocks } from '../renderer/wilds/city/blocks.js'
import { CITY, CITY_KEYS, isCityPiece, fromCity } from '../renderer/wilds/city/geometry.js'
import { makeTerrain, WILDS_SKINS, ROAD_WIDTH, roadLane0 } from '../renderer/wilds/terrain.js'
import { RING, APPROACHES } from '../renderer/wilds/city/build-land.js'
import { roadSides, CITY_DOORS } from '../renderer/wilds/roads.js'
import { PIECE, FRAME } from '../renderer/wilds/layout.js'
import { TILE } from '../renderer/systems/entities.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { makeWorld, getPiece } from '../renderer/wilds/world.js'
import { taleOf } from '../renderer/wilds/tales.js'
import { CASTLE, CHURCH } from '../renderer/wilds/city/kit.js'
import { doorAt } from '../renderer/systems/houses.js'

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

// The wall runs into its towers. A tower's foot stands on the row of the
// wall's own foot (its face), its body or cap on the wall line: the walk runs
// on behind its sides there and the face behind its foot (the wall's masonry
// as the deco of its side cells, so it shows round the tower, not the ground),
// and the face beside it never ends in an end piece. A wall going on south
// starts in the middle of the foot (its walk there instead of the foot); one
// coming in from the north runs in under the tip of the cap.
test('the walls run into their towers, the masonry unbroken', () => {
  const city = cityFor(7)
  const at = (x, y) => city.cells[y]?.[x]
  const masonry = c => !!c && /^ow_city_(wall_top_|gate_|castle_gate)/.test(c.overlay ?? '')
  const towers = []   // x (middle), foot row, top row
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!/^ow_city_(tower_\w+|harbour_tower)_f0$/.test(at(x, y).overlay ?? '')) continue
    let top = y
    while (top > y - 4 && !/_(c|h)01$/.test(at(x + 1, top).overlay ?? '')) top--
    towers.push({ x: x + 1, foot: y, top })
  }
  assert.ok(towers.length >= 30, `towers found (${towers.length})`)
  let sides = 0, ups = 0
  for (const t of towers) {
    const line = t.foot - 1
    for (const d of [-1, 1]) {
      if (!masonry(at(t.x + 2 * d, line))) continue
      sides++
      const where = `${t.x},${line} ${d < 0 ? 'west' : 'east'}`
      assert.equal(at(t.x + d, line).deco, 'ow_city_wall_top_10', `${where}: the walk runs on behind the tower`)
      assert.equal(at(t.x + d, t.foot).deco, 'ow_city_wall_lower_m', `${where}: the face runs on behind its foot`)
      // the face beside the tower must not end towards it: no `_r` west of it, no `_l` east of it, no `_lr`
      const beside = at(t.x + 2 * d, t.foot).overlay ?? ''
      const endsTowardTower = ['ow_city_wall_lower_lr', d < 0 ? 'ow_city_wall_lower_r' : 'ow_city_wall_lower_l'].includes(beside)
      assert.ok(!endsTowardTower, `${where}: the face beside it runs on (${beside})`)
    }
    if (/^ow_city_wall_top_/.test(at(t.x, t.foot + 1)?.overlay ?? '')) {
      ups++
      assert.equal(at(t.x, t.foot).overlay, 'ow_city_wall_top_5', `${t.x},${t.foot}: the wall south starts in the middle of the foot`)
      assert.equal(at(t.x, line).deco, 'ow_city_wall_top_5', `${t.x},${line}: and runs on behind the tower`)
    }
    if (masonry(at(t.x, t.top - 1))) { ups++; assert.equal(at(t.x, t.top).deco, 'ow_city_wall_top_5', `${t.x},${t.top}: the wall north runs in under the cap`) }
  }
  assert.ok(sides >= 25 && ups >= 25, `joints checked (${sides} side, ${ups} up and down)`)
})

test('a tower on an east-west wall is a row taller, its foot beside the wall\'s', () => {
  const city = cityFor(7)
  for (const t of PLAN.towers) {
    const r = towerRect(t)
    assert.match(city.cells[t.y + 1][t.x - 1].overlay ?? '', /_f0$/, `${t.x},${t.y}: its foot on the row below the wall line`)
    assert.match(city.cells[r.y0][t.x].overlay ?? '', /_(c|h)01$/, `${t.x},${t.y}: its cap's top at ${r.y0}`)
    const eastWest = /^ow_city_wall_top_/.test(city.cells[t.y][t.x - 2]?.overlay ?? '') || /^ow_city_wall_top_/.test(city.cells[t.y][t.x + 2]?.overlay ?? '')
    assert.equal(r.y0, t.y - (eastWest ? 2 : 1), `${t.x},${t.y}: ${eastWest ? 'four' : 'three'} rows`)
  }
})

// The harbour walls stand in stone: no grass or water shows through the
// masonry there (a tower's margins, the slivers beside a wall's walk), and
// the moles run right up to the walls with no strip of grass or water between.
test('the harbour walls stand in stone, the moles right up against them', () => {
  const natural = n => /^ow_(grass|water|sand|dirt|shore|mud|pond|bank)/.test(n ?? '')
  const masonry = c => /^ow_city_(wall_|tower_|harbour_tower|gate_)/.test(c.overlay ?? '') || /^ow_city_(wall_|tower_)/.test(c.deco ?? '')
  for (const seed of [7, 742458924]) {
    const city = cityFor(seed)
    for (const wallX of [62, 98]) for (let y = 118; y <= 141; y++) for (let x = wallX - 1; x <= wallX + 1; x++) {
      const c = city.cells[y][x]
      if (masonry(c)) assert.ok(!natural(c.skin), `seed ${seed}: ${x},${y} (${c.overlay ?? c.deco}) stands on ${c.skin}`)
    }
    for (let y = 122; y <= 141; y++) for (const x of [61, 99]) assert.ok(!natural(city.cells[y][x].skin), `seed ${seed}: ${x},${y} between the mole and the wall is ${city.cells[y][x].skin}`)
    // and no moss of the mossy mole shows in a margin either
    for (const wallX of [62, 98]) for (let y = 118; y <= 141; y++) for (let x = wallX - 1; x <= wallX + 1; x++) {
      const c = city.cells[y][x]
      if (masonry(c)) assert.notEqual(c.skin, 'ow_city_pave_mole_1', `seed ${seed}: ${x},${y} shows the mole's moss`)
    }
  }
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

// Seen from the south: a door stands in its building's south face (the building
// over it, never open ground, or the door would sit on the roof's edge) and
// opens onto the street graph.
test('every door stands in the south face of its building and opens onto the streets', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed), G = city.streets
    for (const d of city.doors) {
      const at = `door ${d.label} (${d.kind}) seed ${seed}`
      assert.ok(!walk(city, d.x, d.y - 1), `${at}: open ground north of it`)
      const s = G.snapDist[d.y * N + d.x]
      assert.ok(s >= 1 && s <= 2, `${at}: ${s} steps from a street`)
    }
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
      // (a wall's walk opened from the inside, like the south wall's, is warded with the street it opens onto)
      const want = c.tile === TILE.FLOOR && (insideWalls(x, y) || (!!c.over && !!city.cells[y - 1][x].ward))
      assert.equal(!!c.ward, want, `${x},${y} seed ${seed}`)
      if (want) warded++
    }
    assert.ok(warded > 5000, `${warded} warded cells`)
    // the gate arches carry it too
    for (const [x, y] of GATE_CELLS) assert.equal(city.cells[y][x].ward, true)
  }
})

// A road cell out in the country: the road's own ground on land, a pier over water.
const roadish = c => c.skin.startsWith('ow_road_') || !!c.overlay?.startsWith('ow_pier')
const walledCell = (x, y) => insideWalls(x, y) || wallCells().has(y * N + x)

test('the ring road and gate approaches outside the walls wear the road surface', () => {
  const rects = [...['north', 'west', 'east', 'southW', 'southE', 'shoreW', 'shoreE'].map(k => RING[k]), ...Object.values(APPROACHES)]
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    let land = 0
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = city.cells[y][x]
      assert.ok(!walledCell(x, y), `${x},${y} of the ring is walled`)
      assert.ok(c.tile === TILE.FLOOR, `${x},${y} seed ${seed}: the road is blocked`)
      // on land (rock included: a pass wears the mountain set) the road's ground, over water a pier
      if (c.overlay?.startsWith('ow_pier')) continue
      assert.ok(c.skin.startsWith('ow_road_'), `${x},${y} seed ${seed}: ${c.skin}`)
      land++
    }
    assert.ok(land > 1000, `seed ${seed}: ${land} road cells on land`)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (walledCell(x, y)) assert.ok(!city.cells[y][x].skin.startsWith('ow_road_'), `${x},${y} seed ${seed}: road inside the walls`)
    }
  }
})

test('a road door\'s spur continues the frame\'s road lanes without a step', () => {
  let doors = 0, onLand = 0
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    for (const d of CITY_DOORS) {
      if (!roadSides(seed, d.wx, d.wy)[d.side]) continue
      doors++
      const g = makeTerrain(seed, d.wx, d.wy, 0).gates[d.side]
      const ox = d.wx * PIECE, oy = (d.wy - 2) * PIECE
      const a = roadLane0(d.side === 'N' ? g.x : g.y)
      // depth k in from the city's edge, offset o across the road: a city cell
      const at = (k, o) => d.side === 'N' ? city.cells[oy + k][ox + o] : d.side === 'W' ? city.cells[oy + o][ox + k] : city.cells[oy + o][ox + PIECE - 1 - k]
      const ring = d.side === 'N' ? RING.north[1] : d.side === 'W' ? RING.west[0] : N - 1 - RING.east[2]
      const lanes = Array.from({ length: ROAD_WIDTH }, (_, i) => a + i)
      const across = [a - 2, a - 1, ...lanes, a + ROAD_WIDTH, a + ROAD_WIDTH + 1]
      for (let k = 0; k < ring; k++) {
        const where = `seed ${seed} ${d.side} door, ${k} in`
        if (k < FRAME) {
          // the frame's road lanes: its road ground lies on these lanes only, a pier at most one wider
          const road = across.filter(o => at(k, o).skin.startsWith('ow_road_'))
          assert.ok(road.every(o => lanes.includes(o)), `${where}: frame road on ${road} (lanes ${lanes})`)
          assert.ok(lanes.every(o => roadish(at(k, o))), `${where}: a frame lane is no road`)
          if (road.length === ROAD_WIDTH) onLand++
        } else {
          // the spur: the same lanes, road ground or pier, and nothing of the road beside them
          const got = across.filter(o => roadish(at(k, o)))
          assert.deepEqual(got, lanes, `${where}: spur on ${got}`)
          assert.ok(lanes.every(o => at(k, o).tile === TILE.FLOOR), `${where}: the spur is blocked`)
        }
      }
      assert.ok(lanes.every(o => roadish(at(ring, o))), `seed ${seed} ${d.side} door: the spur meets no ring road`)
    }
  }
  assert.ok(doors >= 8, `${doors} road doors`)
  assert.ok(onLand > 0, 'no frame lane on land to compare with')
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

test('every lot has its door, and the church and the keep keep hours', () => {
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
    // the church is open by day (interior/buildings/church.js), locked at night
    assert.equal(church.closed ?? null, null)
    assert.equal(church.building, 'church')
    assert.deepEqual(church.hours, { from: DAY.dawn, to: DAY.dusk, shut: 'The church is locked for the night.' })
    // the keep is open by day too (interior/buildings/castle.js), barred at night
    assert.equal(castle.closed ?? null, null)
    assert.equal(castle.building, 'castle')
    assert.deepEqual(castle.hours, { from: DAY.dawn, to: DAY.night, shut: 'The keep is barred for the night.' })
    assert.equal(city.doors.filter(d => d.closed).length, 0, 'no door is shut for good')
    assert.equal(new Set(city.doors.map(d => d.label)).size, city.doors.length, 'one door per cell')
    assert.ok(city.doors.some(d => d.kind === 'inn') && city.doors.some(d => d.kind === 'smithy') && city.doors.some(d => d.kind === 'barracks'))
  }
})

// The keep and the church draw a double door, two cells wide: either half is
// walked onto and opens the building, and each keeps one door record (the
// schedules and the street graph know the building by it).
test('both halves of the keep\'s and the church\'s double doors lead in, one door each', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    for (const [kind, art] of [['castle', CASTLE.lower.door], ['church', CHURCH.lower.door]]) {
      const doors = city.doors.filter(d => d.kind === kind)
      assert.equal(doors.length, 1, `seed ${seed}: one ${kind} door`)
      const drawn = []
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (art.includes(city.cells[y][x].overlay)) drawn.push([x, y])
      assert.equal(drawn.length, 2, `seed ${seed}: the ${kind}'s door is drawn two cells wide`)
      for (const [x, y] of drawn) {
        assert.equal(city.cells[y][x].tile, TILE.FLOOR, `seed ${seed}: the ${kind}'s door at ${x},${y} is walked onto`)
        assert.equal(city.cells[y][x].ward, true, `seed ${seed}: the ${kind}'s door at ${x},${y} is warded`)
        assert.ok(doorAt(city.doors, x, y) === doors[0], `seed ${seed}: ${x},${y} opens the ${kind}`)
        assert.ok(!city.streets.lane[y * N + x], `seed ${seed}: the ${kind}'s door at ${x},${y} is no street`)
      }
    }
  }
})

// The castle gate (PLAN.places.castleGate, the middle of its lower row) is
// walked through: its portcullis is up in the city's cells (fx.js lets it down
// at night); the door is the keep's, at the head of the courtyard.
const CASTLE_GATE = [-1, 0, 1].flatMap(d => [[PLAN.places.castleGate.x + d, PLAN.places.castleGate.y - 1], [PLAN.places.castleGate.x + d, PLAN.places.castleGate.y]])
test('the castle gate is open ground into the courtyard; the castle\'s door is the keep\'s', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed), G = city.streets
    const gate = new Set(CASTLE_GATE.map(([x, y]) => `${x},${y}`))
    assert.ok(!city.doors.some(d => d.kind === 'castle' && gate.has(`${d.x},${d.y}`)), `seed ${seed}: no door on the gate`)
    const castle = city.doors.filter(d => d.kind === 'castle')
    assert.equal(castle.length, 1, `seed ${seed}: one castle door`)
    const [door] = castle, k = PLAN.places.keep
    assert.ok(door.x >= k.x0 && door.x <= k.x1 && door.y >= k.y0 && door.y <= k.y1, `seed ${seed}: the door in the keep (${door.x},${door.y})`)
    const s = G.snapDist[door.y * N + door.x]
    assert.ok(s >= 1 && s <= 2, `seed ${seed}: the keep door ${s} steps from a street`)
    const f = city.spots.fountain
    assert.equal(reach(city, f.x, f.y)[door.y * N + door.x], 1, `seed ${seed}: the keep door is reached from the square`)
    for (const [x, y] of CASTLE_GATE) {
      const c = city.cells[y][x]
      assert.equal(c.tile, TILE.FLOOR, `seed ${seed}: the gate at ${x},${y} is walked through`)
      assert.match(c.overlay ?? '', /^ow_city_castle_gate2open_/, `seed ${seed}: the portcullis up at ${x},${y}`)
      assert.equal(c.ward, true, `seed ${seed}: the gate at ${x},${y} is warded as the streets are`)
      assert.ok(G.lane[y * N + x], `seed ${seed}: the gate at ${x},${y} is on the street graph`)
    }
    // the courtyard: every walkable cell inside the castle's wall keeps its ward
    const c = PLAN.places.castle
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const cell = city.cells[y][x]
      if (cell.tile === TILE.FLOOR) assert.equal(cell.ward, true, `seed ${seed}: ${x},${y} in the castle is warded`)
    }
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

// How long a build takes is gated by tools/city/perf.mjs (warm buildCity
// <= 200 ms, generateCityPiece <= 10 ms, in a fresh process), not here: a
// wall-clock assertion in npm test fails on a slow or busy runner (single warm
// builds range 120-735 ms on this laptop) and npm test is main's required
// check. Here a seed no other test uses builds, and its pieces come from it.
test('a city builds for a seed of its own, and its four pieces are cut from it', () => {
  const city = cityFor(31337)
  assert.ok(city.cells.length === 160 && city.cells.every(r => r.length === 160), 'the city is 160 x 160 tiles')
  for (const key of CITY_KEYS) {
    const [wx, wy] = key.split(',').map(Number)
    const piece = generateCityPiece(31337, wx, wy)
    assert.ok(piece.key === key && piece.city === true && piece.cells.length === PIECE && piece.cells.every(r => r.length === PIECE), `${key}: a city piece of 80 x 80`)
    const ox = (wx - CITY.wx0) * PIECE, oy = (wy - CITY.wy0) * PIECE
    for (const [x, y] of [[0, 0], [40, 40], [79, 79], [13, 66]]) {
      const a = piece.cells[y][x], b = city.cells[y + oy][x + ox]
      assert.ok(a !== b && a.tile === b.tile && a.skin === b.skin && a.overlay === b.overlay, `${key} (${x}, ${y}): a copy of the city's cell`)
    }
  }
})

// The same timing as perf.mjs, for a look at it here (CITY_TIMING=1 npm test).
// The gate is a warm build: the city is built once, when the game enters the
// Wilds (a load moment), so the first, cold build there also pays for
// compiling the generator (several hundred ms in a fresh process). Here the
// test warms up on three other seeds itself, so it means the same run alone
// or after the other tests.
test('building is quick enough (opt-in with CITY_TIMING=1; tools/city/perf.mjs gates it)', { skip: !process.env.CITY_TIMING }, () => {
  for (const seed of [101, 202, 303]) buildCity(seed)
  const t0 = performance.now(); buildCity(31337); const build = performance.now() - t0
  assert.ok(build < 200 * 2, `a warm build took ${build.toFixed(0)} ms`)   // headroom ×2
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
