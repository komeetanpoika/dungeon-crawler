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
  const city = cityFor(7)
  const G = city.streets
  const doorKeys = new Set(city.doors.map(d => d.y * 160 + d.x))
  const ids = Object.values(city.spots)
  let n = 0
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j += 7) {
    if (i === j) continue
    const r = route(G, ids[i], ids[j]); assert.ok(r); n++
    for (let k = 1; k < r.length; k++) {
      const a = r[k - 1], b = r[k]
      const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y)
      const len = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      assert.ok(len <= 6, `leg ${len}`)
      assert.ok(Math.abs(b.x - a.x) === 0 || Math.abs(b.y - a.y) === 0 || Math.abs(b.x - a.x) === Math.abs(b.y - a.y), 'straight')
      for (let s = 0; s <= len; s++) {
        const x = a.x + dx * s, y = a.y + dy * s
        const c = city.cells[y][x]
        assert.ok(isWalkable(c.tile, c), `walkable ${x},${y}`)
        const mid = k > 1 && k < r.length - 1 || s > 0 && s < len
        if (mid && !doorKeys.has(y * 160 + x)) assert.ok(G.lane[y * 160 + x] || G.snapDist[y * 160 + x] <= 10)
      }
    }
  }
  assert.ok(n > 100)
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
