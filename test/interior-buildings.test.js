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
  def.legend = { ...def.legend, K: { item: 'stool', spot: 'throne' } }
  const p = parseFloor(def)
  assert.deepEqual(p.spots.get('throne'), [{ x: 6, y: 5 }])
  assert.ok(p.items.some(i => i.item === 'stool' && i.x === 6 && i.y === 5))
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
  assert.equal(Object.hasOwn(BUILDINGS, 'test'), false, 'the registry passed in is the one used')
})

const withLegend = (def, extra) => ({ ...def, legend: { ...def.legend, ...extra } })

test('parse: a spot must be somewhere a person can stand', () => {
  const S = { S: { spot: 'seat' } }
  assert.throws(() => parseFloor(withLegend(edit(hall, 'things', 7, 5, 'S'), S)), /hall 5,7.*spawn/)
  assert.throws(() => parseFloor(withLegend(edit(hall, 'things', 8, 5, 'S'), S)), /hall 5,8/)
  const blocking = withLegend(edit(hall, 'things', 5, 6, 'K'), { K: { item: 'barrel', spot: 'throne' } })
  assert.throws(() => parseFloor(blocking), /hall 6,5.*blocks/)
  const face = withLegend(edit(edit(hall, 'things', 1, 4, 'W'), 'things', 2, 4, 'W'), { W: { item: 'wardrobe', spot: 'throne' } })
  assert.throws(() => parseFloor(face), /hall 4,1.*blocks/)
  const open = withLegend(edit(hall, 'things', 5, 6, 'K'), { K: { item: 'stool', spot: 'throne' } })
  assert.deepEqual(parseFloor(open).spots.get('throne'), [{ x: 6, y: 5 }])
})

test('parse: items on the wrong cells, two landings, a things grid of another size', () => {
  const on = (ch, y, x, item) => withLegend(edit(hall, 'things', y, x, ch), { [ch]: { item } })
  assert.throws(() => parseFloor(on('D', 4, 6, 'dresser')), /hall 6,4.*needs "l"/)
  assert.throws(() => parseFloor(on('N', 4, 6, 'window')), /hall 6,4.*needs "u"/)
  assert.throws(() => parseFloor(on('W', 2, 6, 'wardrobe')), /hall 6,2.*(2x1|needs)/)
  assert.throws(() => parseFloor(on('D', 1, 6, 'dresser')), /hall 6,1.*needs "l"/)
  assert.throws(() => parseFloor(on('W', 4, 6, 'wardrobe')), /hall 6,4.*2x1|hall 6,4.*1x2/)
  assert.throws(() => parseFloor(edit(hall, 'things', 5, 9, '1')), /hall 9,5.*more than one landing/)
  assert.throws(() => parseFloor({ ...hall, things: hall.things.slice(1) }), /hall.*things has 8 rows/)
  assert.throws(() => parseFloor({ ...hall, things: hall.things.map((r, i) => i === 2 ? r + ' ' : r) }), /hall 0,2.*things row/)
})

test('buildFloor: a hand-laid wall that cuts a stair off throws, naming the floor and cell', () => {
  let def = hall
  for (const [y, x] of [[3, 8], [4, 8], [5, 9]]) def = edit(def, 'things', y, x, 'B')
  def = withLegend(def, { B: { item: 'barrel' } })
  assert.throws(() => buildFloor(def, { rng: mulberry32(1) }), /hall 9,3.*not reached/)
  assert.doesNotThrow(() => buildFloor(hall, { rng: mulberry32(1) }))
  // a floor without a way in has nowhere to start
  assert.throws(() => buildFloor({ ...upper, things: upper.things.map(r => r.replace(/[>2]/g, ' ')) }, { rng: mulberry32(1) }), /upper.*way out/)
})

test('buildBuilding: fallback seating never uses a shut cell or any spot cell', () => {
  let def = edit(edit(hall, 'things', 5, 6, 'c'), 'things', 5, 7, 'c')
  def = withLegend(def, { c: { spot: 'cellar' } })
  const registry = {
    test: {
      floors: [def, upper], ground: 'hall', theme: {},
      seat: p => ({ floor: 'hall', spot: p.id === 'last' ? 'cellar' : 'bench' }),
    },
  }
  const people = [...Array.from({ length: 12 }, (_, i) => `p${i}`), 'last'].map(id => ({ spawn: { kind: 'npc', species: 'villager', id }, person: { id }, act: 'sit' }))
  const f = buildBuilding('test', { seed: 2, people }, registry).floors[0]
  const placed = f.entitySpawns
  assert.equal(placed.length, 13)
  assert.equal(new Set(placed.map(s => `${s.x},${s.y}`)).size, 13)
  const cell = s => `${s.x},${s.y}`
  const last = placed.find(s => s.id === 'last')
  assert.ok(['6,5', '7,5'].includes(cell(last)), 'the last person sits on their own spot')
  for (const s of placed.filter(s => s.id !== 'last')) {
    assert.notEqual(cell(s), '2,7', 'not on the shut cell')
    assert.ok(!['6,5', '7,5'].includes(cell(s)), 'not on the unused spot')
  }
})

test('buildFloor: dressing hangs wall things on the face rows too', () => {
  const def = { ...upper, dress: [{ item: 'web_wall', n: 2 }, { item: 'dresser', n: 1 }] }
  for (let s = 1; s <= 6; s++) {
    const f = buildFloor(def, { rng: mulberry32(s) })
    const on = name => f.map.flatMap((row, y) => row.map((c, x) => ({ x, y, o: c.overlay }))).filter(c => c.o === name)
    assert.equal(on('in_web_wall').length, 2, `seed ${s}: webs on the wall`)
    assert.ok(on('in_web_wall').every(c => upper.rows[c.y][c.x] === 'u'), 'on the upper face row')
    assert.ok(on('in_dresser').length === 1 && upper.rows[on('in_dresser')[0].y][on('in_dresser')[0].x] === 'l', 'a dresser against the lower face')
  }
})

test('parse and build: rugs lie under what stands on them; cells kept clear take no dressing and no one seated for want of a seat', () => {
  const def = {
    ...hall,
    rugs: [{ colour: 'red', x0: 2, y0: 4, x1: 5, y1: 6 }],
    clear: [{ x0: 1, y0: 3, x1: 9, y1: 3 }],
    dress: [{ item: 'barrel', n: 6 }],
  }
  const p = parseFloor(def)
  assert.deepEqual(p.rugs, [{ colour: 'red', x0: 2, y0: 4, x1: 5, y1: 6 }])
  assert.equal(p.clear.length, 9)
  const f = buildFloor(def, { rng: mulberry32(3) })
  assert.equal(f.map[4][2].deco, 'in_rug_red_tl')
  assert.equal(f.map[4][3].deco, 'in_rug_red_tm')
  assert.equal(f.map[4][3].overlay, 'in_table_l', 'the table on the rug')
  assert.equal(f.map[5][3].deco, 'in_rug_red_mm')
  assert.equal(f.map[6][5].deco, 'in_rug_red_br')
  for (let x = 1; x <= 9; x++) {
    if (x === 9) continue // the stair
    assert.equal(f.map[3][x].overlay, undefined, `${x},3 kept clear`)
    assert.ok(!f.free.some(c => c.x === x && c.y === 3), `${x},3 is not free floor for seating`)
  }
  // broken rugs and clear runs throw, naming the floor and the cell
  assert.throws(() => parseFloor({ ...hall, rugs: [{ colour: 'purple', x0: 2, y0: 4, x1: 3, y1: 5 }] }), /hall: rug 0.*unknown colour/)
  assert.throws(() => parseFloor({ ...hall, rugs: [{ colour: 'red', x0: 2, y0: 4, x1: 2, y1: 5 }] }), /hall: rug 0.*2x2/)
  assert.throws(() => parseFloor({ ...hall, rugs: [{ colour: 'red', x0: 0, y0: 4, x1: 2, y1: 5 }] }), /hall 0,4: rug 0/)
  assert.throws(() => parseFloor({ ...hall, rugs: [{ colour: 'red', x0: 1, y0: 6, x1: 3, y1: 7 }] }), /hall 2,7: rug 0.*picture/)
  assert.throws(() => parseFloor({ ...hall, clear: [{ x0: 1, y0: 2, x1: 3, y1: 3 }] }), /hall 1,2: clear 0/)
})

// A prison cell behind its barred door: floor the player sees through the
// bars but never walks on (the keep's cells, interior/buildings/castle.js).
test('parse and build: sealed floor is seen but never walked, and takes no dressing and no one', () => {
  const def = { ...hall, sealed: [{ x0: 6, y0: 6, x1: 8, y1: 7 }], dress: [{ item: 'barrel', n: 8 }] }
  const p = parseFloor(def)
  assert.equal(p.sealed.length, 6)
  for (const seed of [1, 2, 3, 4]) {
    const f = buildFloor(def, { rng: mulberry32(seed) })
    for (let y = 6; y <= 7; y++) for (let x = 6; x <= 8; x++) {
      const c = f.map[y][x]
      assert.equal(c.tile, TILE.WALL, `${x},${y} is not walked on`)
      assert.equal(c.losClear, true, `${x},${y} is seen into`)
      assert.match(c.skin, /^in_floor_planks/, `${x},${y} is drawn as floor`)
      assert.equal(c.overlay, undefined, `${x},${y} takes no dressing (seed ${seed})`)
      assert.ok(!f.free.some(o => o.x === x && o.y === y), `${x},${y} is no seat`)
    }
  }
  // an item may stand in it (a cot in a cell); nothing a person or the player must reach may
  const withCot = edit(def, 'things', 6, 7, 'b')
  withCot.legend = { ...def.legend, b: { item: 'bedroll' } }
  assert.equal(buildFloor(withCot, { rng: mulberry32(1) }).map[6][7].overlay, 'in_bedroll')
  assert.throws(() => parseFloor({ ...hall, sealed: [{ x0: 1, y0: 2, x1: 3, y1: 3 }] }), /hall 1,2: sealed 0/)
  assert.throws(() => parseFloor({ ...hall, sealed: [{ x0: 1, y0: 7, x1: 3, y1: 7 }] }), /hall 2,7: sealed 0.*shut/)
  assert.throws(() => parseFloor({ ...hall, sealed: [{ x0: 7, y0: 4, x1: 8, y1: 5 }] }), /hall 7,4: sealed 0.*spot/)
  assert.throws(() => parseFloor({ ...hall, sealed: [{ x0: 9, y0: 3, x1: 9, y1: 4 }] }), /hall 9,3: sealed 0.*stair/)
  assert.throws(() => parseFloor({ ...hall, sealed: [{ x0: 4, y0: 6, x1: 3, y1: 7 }] }), /hall: sealed 0/)
})
