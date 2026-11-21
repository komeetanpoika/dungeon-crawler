import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cityFor } from '../renderer/wilds/city/build.js'
import { route } from '../renderer/wilds/city/streets.js'
import { isWalkable } from '../renderer/systems/entities.js'

const SEEDS = [1, 7, 4242]
const gateIns = ['gate-N-in', 'gate-W-in', 'gate-E-in']

test('every home and workplace is routable from every gate', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    for (const g of [...gateIns, 'gate-N-out', 'gate-W-out', 'gate-E-out']) {
      const from = city.spots[g]
      for (const d of city.doors) {
        const r = route(city.streets, from, d)
        assert.ok(r, `${seed} ${g} -> ${d.label}`)
        assert.deepEqual(r[0], from); assert.deepEqual(r[r.length - 1], { x: d.x, y: d.y })
      }
      for (const [id, s] of Object.entries(city.spots)) assert.ok(route(city.streets, from, s), `${seed} ${g} -> ${id}`)
    }
  }
})

test('routes keep to streets and alleys, legs of at most six tiles', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const G = city.streets
    const doorKeys = new Set(city.doors.map(d => d.y * 160 + d.x))
    const pts = [...Object.values(city.spots), ...city.doors]
    const doors = city.doors
    const spots = Object.values(city.spots)
    const pairs = []
    for (let i = 0; i < 120; i++) pairs.push([spots[(i * 7) % spots.length], spots[(i * 13 + 3) % spots.length]])
    for (let i = 0; i < 150; i++) pairs.push([doors[(i * 37 + seed) % doors.length], doors[(i * 53 + 11) % doors.length]])
    for (let i = 0; i < 100; i++) pairs.push([doors[(i * 17) % doors.length], spots[(i * 5) % spots.length]], [spots[(i * 3) % spots.length], doors[(i * 29 + 1) % doors.length]])
    assert.ok(pts.length > 100)
    let n = 0
    for (const [a0, b0] of pairs) {
      if (a0 === b0) continue
      const r = route(G, a0, b0); assert.ok(r, `${seed} ${JSON.stringify(a0)} -> ${JSON.stringify(b0)}`); n++
      assert.deepEqual(r[0], { x: a0.x, y: a0.y }); assert.deepEqual(r[r.length - 1], { x: b0.x, y: b0.y })
      // every cell the route covers, in order
      const cells = [{ x: r[0].x, y: r[0].y }]
      for (let k = 1; k < r.length; k++) {
        const a = r[k - 1], b = r[k]
        const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y)
        const len = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
        assert.ok(len <= 6, `leg ${len}`)
        assert.ok(a.x === b.x || a.y === b.y || Math.abs(b.x - a.x) === Math.abs(b.y - a.y), 'straight')
        for (let s = 1; s <= len; s++) cells.push({ x: a.x + dx * s, y: a.y + dy * s })
      }
      cells.forEach((c, i) => {
        const key = c.y * 160 + c.x
        assert.ok(isWalkable(city.cells[c.y][c.x].tile, city.cells[c.y][c.x]), `walkable ${c.x},${c.y}`)
        if (i > 0) assert.ok(Math.abs(c.x - cells[i - 1].x) <= 1 && Math.abs(c.y - cells[i - 1].y) <= 1, 'step')
        const end = i === 0 || i === cells.length - 1
        void end
        if (!G.lane[key]) {
          // only the snap chains at either end may leave the lanes
          assert.ok(G.snapDist[key] >= 0 && G.snapDist[key] <= 10, `off-lane ${c.x},${c.y}`)
        }
        if (doorKeys.has(key) && !end) assert.fail(`passes through door ${c.x},${c.y}`)
      })
      // interior cells beyond the first and last chain are all lane cells
      const firstLane = cells.findIndex(c => G.lane[c.y * 160 + c.x])
      let lastLane = cells.length - 1
      while (lastLane >= 0 && !G.lane[cells[lastLane].y * 160 + cells[lastLane].x]) lastLane--
      assert.ok(firstLane >= 0 && lastLane >= firstLane)
      assert.ok(firstLane <= 10 && cells.length - 1 - lastLane <= 10)
      for (let i = firstLane; i <= lastLane; i++) assert.ok(G.lane[cells[i].y * 160 + cells[i].x], `lane gap ${cells[i].x},${cells[i].y}`)
    }
    assert.ok(n > 300)
  }
})

test('a route avoids walking through other doors and the unreachable gives null', () => {
  const city = cityFor(7)
  const G = city.streets
  assert.equal(route(G, { x: 0, y: 0 }, city.spots.fountain), null)
  assert.deepEqual(route(G, city.spots.fountain, city.spots.fountain), [city.spots.fountain])
  const doorKeys = new Set(city.doors.map(d => d.y * 160 + d.x))
  const d = city.doors[10]
  const r = route(G, city.spots['gate-N-in'], d)
  for (const p of r.slice(0, -1)) assert.ok(!doorKeys.has(p.y * 160 + p.x))
})
