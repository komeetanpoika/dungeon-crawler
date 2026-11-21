import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAN, insideWalls, wallCells, streetCells, districtAt } from '../renderer/wilds/city/plan.js'

const N = 160
const key = (x, y) => y * N + x
const rectOf = r => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
const placeRects = () => Object.values(PLAN.places).filter(p => p.x0 !== undefined)
const placePoints = plan => {
  const pts = []
  for (const p of Object.values(plan.places)) {
    if (p.x0 !== undefined) pts.push({ x: p.x0, y: p.y0 }, { x: p.x1, y: p.y0 }, { x: p.x0, y: p.y1 }, { x: p.x1, y: p.y1 })
    else pts.push({ x: p.x, y: p.y })
    if (p.door) pts.push(p.door)
  }
  for (const p of plan.posts) pts.push({ x: p.x, y: p.y, id: p.id })
  return pts
}
const inBasin = (x, y) => inRect(PLAN.harbour.basin, x, y)

test('the wall is closed, orthogonal and inside the owned land', () => {
  const w = PLAN.wall
  for (let i = 0; i < w.length; i++) {
    const [a, b] = [w[i], w[(i + 1) % w.length]]
    assert.ok(a[0] === b[0] || a[1] === b[1], 'segment ' + i + ' is not axis-aligned')
    assert.ok(a[0] !== b[0] || a[1] !== b[1])
  }
  for (const [x, y] of w) assert.ok(x >= 14 && x <= 145 && y >= 14 && y <= 145, [x, y] + '')
  for (const t of PLAN.towers) assert.ok(t.x >= 14 && t.x <= 145 && t.y >= 14 && t.y <= 145)
  for (const k of wallCells()) assert.ok(k % N >= 14 && k % N <= 145 && Math.floor(k / N) >= 14 && Math.floor(k / N) <= 145)
})

test('towers stand on every corner and both harbour heads, and keep clear of gates', () => {
  const at = (x, y) => PLAN.towers.some(t => t.x === x && t.y === y)
  for (const [x, y] of PLAN.wall) assert.ok(at(x, y), 'no tower at corner ' + x + ',' + y)
  const wc = wallCells()
  for (const t of PLAN.towers) {
    assert.ok(['round', 'square'].includes(t.kind))
    assert.ok(wc.has(key(t.x, t.y)))
  }
  for (const g of Object.values(PLAN.gates)) for (const c of gateArch(g)) assert.ok(!wc.has(key(c.x, c.y)), 'tower on a gate arch')
})

const gateArch = g => {
  const out = []
  for (let d = -1; d <= 1; d++) out.push(g.dir === 'N' ? { x: g.x + d, y: g.y } : { x: g.x, y: g.y + d })
  return out
}
const step = { N: [0, -1], W: [-1, 0], E: [1, 0] }

test('every gate sits on the wall and opens both ways', () => {
  const wc = wallCells()
  const onWall = (x, y) => PLAN.wall.some((a, i) => {
    const b = PLAN.wall[(i + 1) % PLAN.wall.length]
    return x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])
  })
  for (const [d, g] of Object.entries(PLAN.gates)) {
    assert.equal(g.w, 3)
    assert.ok(onWall(g.x, g.y), d + ' gate is off the wall')
    const [dx, dy] = step[d]
    for (const c of gateArch(g)) {
      assert.ok(onWall(c.x, c.y)); assert.ok(!wc.has(key(c.x, c.y)), 'arch is wall')
      assert.ok(insideWalls(c.x, c.y), 'arch not inside')
      assert.ok(!wc.has(key(c.x + dx, c.y + dy)) && !insideWalls(c.x + dx, c.y + dy), 'outside cell')
      assert.ok(!wc.has(key(c.x - dx, c.y - dy)) && insideWalls(c.x - dx, c.y - dy), 'inside cell')
    }
  }
})

test('insideWalls: interior, basin and mouth yes; wall and outside no', () => {
  assert.ok(insideWalls(80, 73)); assert.ok(insideWalls(80, 120)); assert.ok(insideWalls(80, 139)); assert.ok(insideWalls(80, 140))
  assert.ok(!insideWalls(20, 40)); assert.ok(!insideWalls(19, 40)); assert.ok(!insideWalls(10, 10)); assert.ok(!insideWalls(50, 130))
  assert.ok(!insideWalls(80, 141)); assert.ok(!insideWalls(62, 130)); assert.ok(!insideWalls(98, 130))
  assert.equal(wallCells(), wallCells()); assert.equal(streetCells(), streetCells())
})

test('every fixed place and post lies inside the walls, clear of wall cells', () => {
  const wc = wallCells()
  for (const p of placePoints(PLAN)) {
    assert.ok(insideWalls(p.x, p.y), JSON.stringify(p))
    assert.ok(!wc.has(key(p.x, p.y)), 'on wall ' + JSON.stringify(p))
  }
  assert.equal(PLAN.posts.length, 10)
  for (const p of PLAN.posts) assert.ok(['N', 'S', 'E', 'W'].includes(p.face))
})

test('fixed places do not overlap each other or the streets, and stay off the water', () => {
  const rs = Object.entries(PLAN.places).filter(([id, p]) => p.x0 !== undefined && id !== 'keep') // the keep stands inside the castle
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const [a, b] = [rs[i][1], rs[j][1]]
    assert.ok(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0, rs[i][0] + ' overlaps ' + rs[j][0])
  }
  const sc = streetCells()
  for (const [id, p] of rs) {
    for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) {
      assert.ok(!sc.has(key(x, y)), id + ' on a street at ' + x + ',' + y)
      assert.ok(!inBasin(x, y), id + ' in the basin')
    }
  }
})

test('the main streets join every gate to the square', () => {
  const sc = streetCells(); const sq = PLAN.places.square
  const nearSquare = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inRect(sq, x + dx, y + dy))
  for (const [d, g] of Object.entries(PLAN.gates)) {
    const seen = new Set(); const q = []
    for (const c of gateArch(g)) { const [dx, dy] = step[d]; q.push([c.x - dx, c.y - dy]) }
    let reached = false
    while (q.length) {
      const [x, y] = q.pop(); const k = key(x, y)
      if (seen.has(k) || !sc.has(k)) continue
      seen.add(k)
      if (nearSquare(x, y)) reached = true
      q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
    assert.ok(reached, d + ' gate does not reach the square')
  }
})

test('quay, castle street, harbour and castle gate connect to the street net', () => {
  const sc = streetCells()
  const gate = PLAN.gates.N
  const seen = new Set(); const q = [[gate.x, gate.y + 1]]
  while (q.length) { const [x, y] = q.pop(); const k = key(x, y); if (seen.has(k) || !sc.has(k)) continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]) }
  const cg = PLAN.places.castleGate
  assert.ok(seen.has(key(cg.x, cg.y + 1)), 'castle gate street')
  // the quay reaches the square's south edge, and the wharf reaches the quay
  const sq = PLAN.places.square
  assert.ok(sc.has(key(79, sq.y1 + 1)))
  for (const p of PLAN.posts) assert.ok(sc.has(key(p.x, p.y)), 'post off the streets ' + p.id)
})

test('patrols run on street cells', () => {
  const sc = streetCells()
  assert.deepEqual(PLAN.patrols.map(p => p.id).sort(), ['harbour', 'market', 'wall-east', 'wall-west'])
  for (const p of PLAN.patrols) {
    assert.ok(p.pts.length >= 2)
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [a, b] = [p.pts[i], p.pts[i + 1]]
      assert.ok(a[0] === b[0] || a[1] === b[1])
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
        assert.ok(sc.has(key(x, y)), p.id + ' off street at ' + x + ',' + y)
    }
  }
})

test('districts cover the block land exactly once and never touch a fixed place', () => {
  assert.deepEqual(PLAN.districts.map(d => d.id).sort(), ['crafts', 'gardens', 'harbour', 'market'])
  const wc = wallCells(), sc = streetCells(), rs = placeRects()
  const owner = new Map()
  for (const d of PLAN.districts) for (const [x0, y0, x1, y1] of d.rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    assert.ok(!owner.has(key(x, y)), 'district overlap at ' + x + ',' + y)
    owner.set(key(x, y), d.id)
    assert.ok(insideWalls(x, y) && !wc.has(key(x, y)), 'district outside walls at ' + x + ',' + y)
    assert.ok(!rs.some(r => inRect(r, x, y)), 'district on a place at ' + x + ',' + y)
    assert.ok(!inBasin(x, y), 'district in the basin')
  }
  let block = 0
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!insideWalls(x, y) || wc.has(key(x, y)) || sc.has(key(x, y)) || inBasin(x, y) || rs.some(r => inRect(r, x, y))) continue
    block++
    assert.ok(owner.has(key(x, y)), 'block land with no district at ' + x + ',' + y)
    assert.equal(districtAt(x, y), owner.get(key(x, y)))
  }
  assert.ok(block > 2000)
})

test('the plan is frozen', () => {
  assert.ok(Object.isFrozen(PLAN) && Object.isFrozen(PLAN.wall) && Object.isFrozen(PLAN.gates.N) && Object.isFrozen(PLAN.districts[0].rects))
})
