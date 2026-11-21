import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePlan, SIZES } from '../renderer/interior/plan.js'
import { mulberry32, hashStr } from '../renderer/interior/rng.js'

const plans = (size, n = 200) => Array.from({ length: n }, (_, i) => makePlan(size, mulberry32(hashStr(`${size}:${i}`))))
const at = (p, x, y) => p.grid[y]?.[x] ?? ' '
const WALKABLE = new Set(['.', 'd', 'E'])
const show = p => '\n' + p.grid.join('\n')

function flood(p, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && WALKABLE.has(at(p, nx, ny))) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

describe('house floor plans', () => {
  for (const size of Object.keys(SIZES)) {
    it(`${size}: rooms fit, are wrapped in walls, and have their face rows`, () => {
      for (const p of plans(size)) {
        assert.ok(p.grid.every(r => r.length === p.w) && p.grid.length === p.h, 'ragged grid')
        assert.ok(p.w <= 24 && p.h <= 20, `${p.w}x${p.h}`)
        assert.ok(/^[ #ul.dE]+$/.test(p.grid.join('')), 'unknown glyph' + show(p))
        const [lo, hi] = SIZES[size].rooms
        assert.ok(p.rooms.length >= lo && p.rooms.length <= hi, `${p.rooms.length} rooms` + show(p))
        for (const r of p.rooms) {
          assert.ok(r.x1 - r.x0 + 1 >= 3, 'narrow room' + show(p))
          assert.ok(r.y1 - r.floorY0 + 1 >= 3, 'shallow room' + show(p))
          assert.equal(r.floorY0, r.y0 + 2)
          for (let x = r.x0; x <= r.x1; x++) {
            if (at(p, x, r.y0) === 'd') continue
            assert.equal(at(p, x, r.y0), 'u', `upper face at ${x},${r.y0}` + show(p))
            assert.equal(at(p, x, r.y0 + 1), 'l', `lower face at ${x},${r.y0 + 1}` + show(p))
            assert.equal(at(p, x, r.y0 - 1), '#', `wall top over ${x},${r.y0}` + show(p))
          }
        }
        // every room cell is wrapped: nothing walkable or face touches the void
        for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
          const ch = at(p, x, y)
          if (ch === ' ' || ch === '#' || ch === 'E') continue
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
            assert.notEqual(at(p, x + dx, y + dy), ' ', `${ch} at ${x},${y} touches the void` + show(p))
        }
      }
    })
    it(`${size}: the way out is under the spawn and every floor cell can be walked to`, () => {
      for (const p of plans(size)) {
        assert.equal(at(p, p.spawn.x, p.spawn.y), '.', 'spawn on floor' + show(p))
        assert.deepEqual(p.exit, { x: p.spawn.x, y: p.spawn.y + 1 })
        assert.equal(at(p, p.exit.x, p.exit.y), 'E')
        assert.equal(p.exit.y, p.h - 1, 'exit in the south wall' + show(p))
        const seen = flood(p, p.spawn)
        for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++)
          if (WALKABLE.has(at(p, x, y))) assert.ok(seen.has(`${x},${y}`), `${x},${y} cut off` + show(p))
        assert.ok(p.rooms.some(r => r.id === p.entry && p.spawn.x >= r.x0 && p.spawn.x <= r.x1 && p.spawn.y === r.y1))
      }
    })
    it(`${size}: the same seed gives the same plan, and seeds give many plans`, () => {
      const a = makePlan(size, mulberry32(7)), b = makePlan(size, mulberry32(7))
      assert.deepEqual(a, b)
      assert.ok(new Set(plans(size).map(p => p.grid.join('/'))).size >= 20)
    })
  }
  it('records each doorway with the rooms it joins', () => {
    for (const p of plans('large', 50)) {
      assert.equal(p.doors.length >= p.rooms.length - 1, true)
      for (const d of p.doors) {
        assert.ok(d.cells.every(c => at(p, c.x, c.y) === 'd'), 'door cells are d' + show(p))
        assert.ok(['h', 'v'].includes(d.axis))
        assert.ok(p.rooms.some(r => r.id === d.a) && p.rooms.some(r => r.id === d.b))
        if (d.axis === 'h') assert.equal(d.cells.length, 3)
        else assert.equal(d.cells.length, 1)
      }
    }
  })
})

describe('a plan with a hall first (the puzzle house)', () => {
  it('keeps one big full-height room by the door, the rest cut beside it', () => {
    for (const size of ['large', 'grand']) for (let i = 0; i < 200; i++) {
      const p = makePlan(size, mulberry32(hashStr(`hall:${size}:${i}`)), { hall: true })
      const hall = p.rooms.find(r => r.id === p.entry)
      assert.ok(hall.x1 - hall.x0 + 1 >= 8, `hall ${hall.x1 - hall.x0 + 1} wide` + show(p))
      assert.equal(hall.y0, 1, 'the hall starts at the north wall' + show(p))
      assert.equal(hall.y1, p.h - 2, 'and runs to the south wall' + show(p))
      assert.ok(p.rooms.length >= 2, 'the glassmaker sleeps somewhere')
    }
  })
})
