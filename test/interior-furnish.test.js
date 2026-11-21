import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePlan, SIZES } from '../renderer/interior/plan.js'
import { buildCells } from '../renderer/interior/walls.js'
import { assignRoles, floorsFor, furnish } from '../renderer/interior/furnish.js'
import { ITEMS } from '../renderer/interior/kit.js'
import { mulberry32, hashStr } from '../renderer/interior/rng.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

const TRADES = ['farmer', 'hunter', 'fisher', 'smith', 'baker', 'scholar', 'weaver']
function house(size, version, seed) {
  const rng = mulberry32(hashStr(`${version}:${size}:${seed}`))
  const plan = makePlan(size, rng)
  const trade = version === 'home' ? TRADES[seed % TRADES.length] : null
  const roles = assignRoles(plan, { version, trade, rng })
  const floors = floorsFor(plan, roles, rng, version)
  const map = buildCells(plan, { palette: 'plaster', floorOf: id => floors.get(id) })
  const out = furnish(map, plan, roles, { version, trade, rng })
  return { plan, roles, map, ...out }
}
const tileOf = name => Object.entries(ITEMS).find(([, i]) => i.tiles.flat().includes(name))?.[0]
const show = (h) => '\n' + h.plan.grid.join('\n')

function reach(map, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile, map[ny][nx])) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

describe('furnishing', () => {
  for (const version of ['home', 'hideout', 'ruin']) for (const size of Object.keys(SIZES)) {
    it(`${version}/${size}: never cuts a floor cell off, never blocks a doorway, the spawn or the way out`, () => {
      for (let seed = 0; seed < 300; seed++) {
        const h = house(size, version, seed)
        const seen = reach(h.map, h.plan.spawn)
        h.map.forEach((row, y) => row.forEach((c, x) => {
          if (isWalkable(c.tile, c)) assert.ok(seen.has(`${x},${y}`), `${version}/${size}#${seed}: ${x},${y} cut off` + show(h))
        }))
        const clear = [h.plan.spawn, h.plan.exit, ...h.plan.doors.flatMap(d => d.cells)]
        for (const c of clear) {
          assert.ok(isWalkable(h.map[c.y][c.x].tile), `${version}/${size}#${seed}: ${c.x},${c.y} blocked`)
          assert.equal(h.map[c.y][c.x].overlay ?? null, null, `${version}/${size}#${seed}: furniture on ${c.x},${c.y}`)
        }
      }
    })
  }
  it('stands floor things on the floor and face things on the face', () => {
    for (const version of ['home', 'hideout', 'ruin']) for (let seed = 0; seed < 100; seed++) {
      const h = house('large', version, seed)
      h.map.forEach((row, y) => row.forEach((c, x) => {
        if (!c.overlay) return
        const id = tileOf(c.overlay), ch = h.plan.grid[y][x]
        assert.ok(id, `${c.overlay} is not an item`)
        const on = ITEMS[id].on
        if (on === 'floor') assert.equal(ch, '.', `${id} on '${ch}'`)
        else assert.ok(ch === 'u' || ch === 'l', `${id} (${on}) on '${ch}'`)
        if (on === 'faceUpper') assert.equal(ch, 'u'); if (on === 'faceLower') assert.equal(ch, 'l')
        if (on === 'floor' && ITEMS[id].block !== false) { assert.equal(c.tile, TILE.WALL); assert.equal(c.losClear, true) }
        if (on === 'floor' && ITEMS[id].block === false) assert.equal(c.tile, TILE.FLOOR_WOOD)
      }))
    }
  })
  it('gives every room something, a home hall its hearth and a bedroom its bed', () => {
    for (let seed = 0; seed < 200; seed++) {
      const h = house(['medium', 'large', 'grand'][seed % 3], 'home', seed)
      for (const r of h.plan.rooms) {
        const cells = h.map.slice(r.y0, r.y1 + 1).flatMap(row => row.slice(r.x0, r.x1 + 1))
        const ids = cells.filter(c => c.overlay).map(c => tileOf(c.overlay))
        const role = h.roles.get(r.id)
        assert.ok(ids.length >= 2, `room ${r.id} (${role}) has ${ids.length} things` + show(h))
        if (role === 'hall') assert.ok(ids.includes('hearth'), `hall without a hearth #${seed}` + show(h))
        if (role === 'bedroom') assert.ok(ids.some(i => i.startsWith('bed')), `bedroom without a bed #${seed}` + show(h))
      }
    }
  })
  it('the same seed furnishes the same, and seeds furnish many ways', () => {
    const a = house('medium', 'home', 4), b = house('medium', 'home', 4)
    assert.deepEqual(a.map, b.map)
    const layouts = new Set()
    for (let seed = 0; seed < 50; seed++) layouts.add(house('medium', 'home', seed).map.map(r => r.map(c => c.overlay ?? '.').join(',')).join('/'))
    assert.ok(layouts.size >= 40, `${layouts.size} layouts`)
  })
  it('names a role for every room: the hall by the door, the rest by size and trade', () => {
    for (let seed = 0; seed < 100; seed++) {
      const h = house('grand', 'home', seed)
      assert.equal(h.roles.get(h.plan.entry), 'hall')
      assert.equal(h.roles.size, h.plan.rooms.length)
      assert.ok([...h.roles.values()].includes('bedroom'))
    }
    const one = { ...makePlan('small', mulberry32(3)) }
    const single = { ...one, rooms: [one.rooms.find(r => r.id === one.entry)] }
    assert.equal(assignRoles(single, { version: 'home', rng: mulberry32(1) }).get(single.rooms[0].id), 'cottage')
  })
})
