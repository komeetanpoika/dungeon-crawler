import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TILE } from '../renderer/systems/entities.js'
import { MISC } from '../renderer/interior/kit.js'
import { mulberry32 } from '../renderer/interior/rng.js'
import { parseFloor } from '../renderer/interior/buildings/parse.js'
import { buildFloor } from '../renderer/interior/buildings/build.js'
import { buildBuilding, BUILDINGS } from '../renderer/interior/buildings/index.js'

const hall = {
  id: 'hall', palette: 'plaster', entry: 'hall',
  rooms: [{ id: 'hall', x0: 1, x1: 9, y0: 1, y1: 7, floor: 'planks' }],
  rows: [
    '###########',
    '#uuuuuuuuu#',
    '#lllllllll#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#####E#####',
  ],
  things: [
    '           ',
    '           ',
    '           ',
    '         < ',
    '   TT  ss1 ',
    '           ',
    '           ',
    '  x        ',
    '           ',
  ],
  legend: {
    T: { item: 'table' },
    s: { spot: 'bench' },
    '<': { stair: 'up', to: ['upper', 'down'], dir: 'up' },
    1: { land: 'up' },
    x: { shut: 'Warm air breathes up through the crack.', deco: 'crack' },
  },
  dress: [{ item: 'barrel', n: [2, 4] }, { item: 'crate', n: [1, 3] }],
}
// the landing '1' sits at (9,4); the stair at (9,3)
const upper = {
  id: 'upper', palette: 'plaster', entry: 'room',
  rooms: [{ id: 'room', x0: 1, x1: 7, y0: 1, y1: 7, floor: 'planks' }],
  rows: [
    '#########',
    '#uuuuuuu#',
    '#lllllll#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#########',
  ],
  things: [
    '         ',
    '         ',
    '         ',
    '  >      ',
    '  2      ',
    '         ',
    '         ',
    '         ',
    '         ',
  ],
  legend: { '>': { stair: 'down', to: ['hall', 'up'], dir: 'down' }, 2: { land: 'down' } },
}
const edit = (def, key, y, x, ch) => {
  const rows = [...def[key]]
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1)
  return { ...def, [key]: rows }
}

test('parse: items, spots, stair landing, exit and spawn', () => {
  const p = parseFloor(hall)
  assert.deepEqual(p.items, [{ item: 'table', x: 3, y: 4 }])
  assert.deepEqual(p.spots.get('bench'), [{ x: 7, y: 4 }, { x: 8, y: 4 }])
  assert.deepEqual(p.stairs, [{ id: 'up', x: 9, y: 3, to: { floor: 'upper', stair: 'down' }, land: { x: 9, y: 4 }, dir: 'up' }])
  assert.deepEqual(p.plan.exit, { x: 5, y: 8 })
  assert.deepEqual(p.plan.spawn, { x: 5, y: 7 })
  assert.deepEqual(p.shut, [{ x: 2, y: 7, line: 'Warm air breathes up through the crack.' }])
  assert.deepEqual(p.decos, [{ x: 2, y: 7, deco: 'crack' }])
  assert.equal(p.plan.rooms[0].floorY0, 3)
  const up = parseFloor(upper)
  assert.equal(up.plan.exit, undefined)
  assert.equal(up.plan.spawn, undefined)
})

test('parse: a guard puts its id and line on its stair', () => {
  const def = edit(hall, 'things', 6, 6, 'g')
  def.legend = { ...def.legend, g: { spawn: { species: 'watchman', id: 'castle:stair-guard', lines: ['Halt.'] }, guards: 'up', line: "The Count's rooms are private." } }
  const p = parseFloor(def)
  assert.deepEqual(p.spawns, [{ kind: 'npc', species: 'watchman', id: 'castle:stair-guard', lines: ['Halt.'], x: 6, y: 6 }])
  assert.deepEqual(p.guards, [{ stair: 'up', id: 'castle:stair-guard', line: "The Count's rooms are private." }])
  assert.equal(p.stairs[0].guard, 'castle:stair-guard')
  assert.equal(p.stairs[0].line, "The Count's rooms are private.")
})

test('parse: an item and a spot may share a character', () => {
  const def = edit(hall, 'things', 5, 6, 'K')
  def.legend = { ...def.legend, K: { item: 'barrel', spot: 'throne' } }
  const p = parseFloor(def)
  assert.deepEqual(p.spots.get('throne'), [{ x: 6, y: 5 }])
  assert.ok(p.items.some(i => i.item === 'barrel' && i.x === 6 && i.y === 5))
})

test('parse: broken definitions throw, naming the floor and the cell', () => {
  assert.throws(() => parseFloor({ ...hall, rows: [...hall.rows.slice(0, 3), '#........#', ...hall.rows.slice(4)] }), /hall 0,3.*unequal/)
  assert.throws(() => parseFloor(edit(hall, 'things', 6, 4, 'Q')), /hall 4,6.*unknown legend character "Q"/)
  assert.throws(() => parseFloor(edit(hall, 'things', 4, 4, ' ')), /hall 3,4.*2x1/)
  assert.throws(() => parseFloor(edit(edit(hall, 'things', 2, 3, 'T'), 'things', 2, 4, 'T')), /hall 3,2.*needs "\."/)
  assert.throws(() => parseFloor(edit(hall, 'things', 4, 9, ' ')), /hall 9,3.*landing/)
  assert.throws(() => parseFloor(edit(hall, 'rows', 8, 7, 'E')), /hall 7,8.*more than one E/)
  assert.throws(() => parseFloor({ ...hall, legend: { ...hall.legend, T: { item: 'table', stair: 'up' } } }), /hall.*mixes roles/)
})

test('buildFloor: items block and cast, stairs and shut cells walk, floor stays connected', () => {
  const f = buildFloor(hall, { rng: mulberry32(5) })
  for (const x of [3, 4]) {
    const c = f.map[4][x]
    assert.equal(c.tile, TILE.WALL)
    assert.equal(c.losClear, true)
    assert.ok(f.map[5][x].castAbove, 'cast under the table')
  }
  assert.equal(f.map[3][9].overlay, MISC.stairUp)
  assert.notEqual(f.map[3][9].tile, TILE.WALL)
  assert.equal(f.map[7][2].deco, MISC.crack)
  assert.notEqual(f.map[7][2].tile, TILE.WALL)
  assert.deepEqual(f.playerSpawn, { x: 5, y: 7 })
  assert.deepEqual(f.stairs, [{ id: 'up', x: 9, y: 3, to: { floor: 'upper', stair: 'down' }, land: { x: 9, y: 4 } }])
  // flood from the spawn reaches every walkable floor cell
  const H = f.map.length, W = f.map[0].length
  const seen = new Set(['5,7']), q = [[5, 7]]
  while (q.length) {
    const [x, y] = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(k)) continue
      if (f.map[ny][nx].tile === TILE.WALL || f.map[ny][nx].skin === MISC.void || hall.rows[ny][nx] === '#') continue
      seen.add(k); q.push([nx, ny])
    }
  }
  for (let y = 3; y <= 7; y++) for (let x = 1; x <= 9; x++) {
    if (f.map[y][x].tile !== TILE.WALL) assert.ok(seen.has(`${x},${y}`), `${x},${y} reachable`)
  }
})

test('buildFloor: dressing is seeded, and keeps off spots, landing, stair and doorway', () => {
  const sig = f => f.map.flatMap((row, y) => row.map((c, x) => c.overlay ? `${x},${y}:${c.overlay}` : null)).filter(Boolean).join('|')
  const a = buildFloor(hall, { rng: mulberry32(1) }), a2 = buildFloor(hall, { rng: mulberry32(1) })
  assert.equal(sig(a), sig(a2))
  assert.ok([2, 3, 4, 5, 6, 7, 8, 9].some(s => sig(buildFloor(hall, { rng: mulberry32(s) })) !== sig(a)))
  for (let s = 1; s <= 12; s++) {
    const f = buildFloor(hall, { rng: mulberry32(s) })
    for (const [x, y] of [[7, 4], [8, 4], [9, 4], [5, 7], [5, 6], [4, 7], [6, 7], [2, 7]]) assert.equal(f.map[y][x].overlay, undefined, `${x},${y} bare (seed ${s})`)
    assert.equal(f.map[3][9].overlay, MISC.stairUp)
    const dressed = f.map.flat().filter(c => c.overlay === 'in_barrel' || c.overlay === 'in_crate').length
    assert.ok(dressed >= 1, 'something was dressed')
  }
})

test('buildBuilding: people take the spot cells, then free floor away from the ways', () => {
  const registry = {
    test: { floors: [hall, upper], ground: 'hall', theme: { bgColor: '#000' }, seat: () => ({ floor: 'hall', spot: 'bench' }) },
  }
  const people = [1, 2, 3].map(i => ({ spawn: { kind: 'npc', species: 'villager', id: `p${i}` }, person: { id: `p${i}` }, act: 'sit' }))
  const b = buildBuilding('test', { seed: 3, people }, registry)
  assert.equal(b.ground, 'hall')
  assert.equal(b.floors.length, 2)
  const f = b.floors[0]
  const placed = f.entitySpawns.filter(s => /^p/.test(s.id))
  assert.equal(placed.length, 3)
  assert.equal(new Set(placed.map(s => `${s.x},${s.y}`)).size, 3)
  const byId = Object.fromEntries(placed.map(s => [s.id, s]))
  assert.deepEqual([byId.p1.x, byId.p1.y], [7, 4])
  assert.deepEqual([byId.p2.x, byId.p2.y], [8, 4])
  const third = byId.p3
  assert.notEqual(f.map[third.y][third.x].tile, TILE.WALL)
  for (const a of [{ x: 9, y: 3 }, { x: 9, y: 4 }, { x: 5, y: 7 }, { x: 5, y: 8 }]) {
    assert.ok(Math.max(Math.abs(a.x - third.x), Math.abs(a.y - third.y)) > 2, 'away from the ways')
  }
  assert.equal(f.map[third.y][third.x].overlay, undefined)
  assert.throws(() => buildBuilding('nope', { seed: 1, people: [] }, registry), /unknown building/)
  assert.deepEqual(BUILDINGS, {})
})
