// Kalevanlinna's keep inside (interior/buildings/castle.js): the entrance
// hall by the door with its two guards, the great hall with the Count's
// throne on its dais under the banners and the dim Sampo lid beside it, long
// tables, fireplaces and torches, the kitchens with the cook and the servant;
// the cells below behind their barred doors; the Count's floor above, held by
// the stair guard, with the battlements door barred. The keep's door keeps
// hours (wilds/city/indoors.js doorShut).
//
// Entities are compared by identity, never with assert.equal on two of them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWalkable } from '../renderer/systems/entities.js'
import { INTERIOR_SKINS, MISC } from '../renderer/interior/kit.js'
import { buildBuilding, BUILDINGS } from '../renderer/interior/buildings/index.js'
import { makeBuilding, blockedBy } from '../renderer/interior/floors.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { doorShut } from '../renderer/wilds/city/indoors.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { cityFor } from '../renderer/wilds/city/build.js'

const STAIR_LINE = "The Count's rooms are private."
const BATTLEMENTS_LINE = 'The door to the battlements is barred.'
const NIGHT_LINE = 'The keep is barred for the night.'
const HOUSEHOLD = ['castle:hall-guard-1', 'castle:hall-guard-2', 'castle:stair-guard', 'castle:cook', 'castle:servant']
const built = buildBuilding('castle', { seed: 7, people: [] })
const floorOf = (b, id) => b.floors.find(f => f.id === id)
const defOf = id => BUILDINGS.castle.floors.find(f => f.id === id)
const roomOf = (floor, id) => defOf(floor).rooms.find(r => r.id === id)
const inRoom = (r, c) => c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1
const key = c => `${c.x},${c.y}`
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

function reach(map, from) {
  const seen = new Set([key(from)]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile, map[ny][nx])) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}
const overlays = (f, re) => f.map.flatMap((row, y) => row.map((c, x) => ({ x, y, o: c.overlay ?? '' }))).filter(c => re.test(c.o))

test('the keep has the hall, the cells and the Count\'s floor, each walkable from its way in', () => {
  assert.equal(built.ground, 'hall')
  assert.deepEqual(built.floors.map(f => f.id), ['hall', 'cells', 'count'])
  for (const f of built.floors) {
    const origin = f.playerSpawn ?? f.stairs[0].land
    const seen = reach(f.map, origin)
    f.map.forEach((row, y) => row.forEach((c, x) => {
      if (isWalkable(c.tile, c)) assert.ok(seen.has(`${x},${y}`), `${f.id} ${x},${y} cut off`)
    }))
  }
  // the way out on the ground floor only, in the south wall, about the middle (as the keep's door outside)
  const hall = floorOf(built, 'hall')
  const w = hall.map[0].length
  assert.equal(hall.exit.y, hall.map.length - 1)
  assert.ok(Math.abs(hall.exit.x - (w - 1) / 2) <= 1, `the door in the middle of the south wall (${key(hall.exit)})`)
  assert.equal(floorOf(built, 'cells').exit, undefined)
  assert.equal(floorOf(built, 'count').exit, undefined)
  // about 15 x 13 inside, in three rooms
  const h = defOf('hall')
  assert.ok(Math.abs((w - 2) - 15) <= 2 && Math.abs((hall.map.length - 2) - 13) <= 2, `${w - 2} x ${hall.map.length - 2} inside`)
  assert.deepEqual(h.rooms.map(r => r.id).sort(), ['entrance', 'great', 'kitchen'])
  assert.equal(h.entry, 'entrance')
})

test('every stair leads to a stair that leads back; down to the cells from the entrance hall, up from the great hall', () => {
  for (const f of built.floors) for (const s of f.stairs) {
    const to = floorOf(built, s.to.floor)
    assert.ok(to, `${f.id}/${s.id} leads to a floor that exists`)
    const back = to.stairs.find(t => t.id === s.to.stair)
    assert.ok(back, `${f.id}/${s.id} leads to a stair that exists`)
    assert.deepEqual(back.to, { floor: f.id, stair: s.id }, `${to.id}/${back.id} leads back`)
  }
  const seen = new Set(['hall']), q = ['hall']
  while (q.length) for (const s of floorOf(built, q.pop()).stairs) if (!seen.has(s.to.floor)) { seen.add(s.to.floor); q.push(s.to.floor) }
  assert.deepEqual([...seen].sort(), ['cells', 'count', 'hall'])
  const hall = floorOf(built, 'hall')
  const down = hall.stairs.find(s => s.to.floor === 'cells'), up = hall.stairs.find(s => s.to.floor === 'count')
  assert.ok(inRoom(roomOf('hall', 'entrance'), down), `the stair down in the entrance hall (${key(down)})`)
  assert.ok(inRoom(roomOf('hall', 'great'), up), `the stair up at the great hall's side (${key(up)})`)
  const great = roomOf('hall', 'great')
  assert.ok(up.x - great.x0 <= 1 || great.x1 - up.x <= 1, `at its side (${key(up)})`)
})

test('the great hall: the throne on its dais under the banners, the lid beside it, long tables, fireplaces, torches', () => {
  const hall = floorOf(built, 'hall'), great = roomOf('hall', 'great')
  const throne = hall.spots.get('throne')
  assert.equal(throne?.length, 1, 'one throne')
  const t = throne[0]
  assert.equal(hall.map[t.y][t.x].overlay, 'in_throne')
  assert.ok(isWalkable(hall.map[t.y][t.x].tile, hall.map[t.y][t.x]), 'the Count sits in it')
  // at the far (north) end of the great hall, in its middle, on the dais rug
  assert.equal(t.y, great.y0 + 2, 'on the first floor row, under the north face')
  assert.ok(Math.abs(t.x - (great.x0 + great.x1) / 2) <= 1, `in the middle (${key(t)})`)
  assert.match(hall.map[t.y][t.x].deco ?? '', /^in_rug_red_/, 'on the dais')
  // the dim lid on its stand beside it
  const lids = overlays(hall, /^in_sampo_lid$/)
  assert.equal(lids.length, 1)
  assert.ok(cheb(lids[0], t) <= 2, `the lid by the throne (${key(lids[0])})`)
  assert.ok(!isWalkable(hall.map[lids[0].y][lids[0].x].tile, hall.map[lids[0].y][lids[0].x]), 'the lid stands in the way')
  // over the throne: banners either side on the north face
  const banners = overlays(hall, /^in_banner_red_t$/).filter(b => inRoom(great, b))
  assert.ok(banners.length >= 2 && banners.every(b => b.y === great.y0), `banners on the face (${banners.length})`)
  assert.ok(banners.some(b => b.x < t.x && t.x - b.x <= 2) && banners.some(b => b.x > t.x && b.x - t.x <= 2), 'flanking the throne')
  // two long tables with benches along them
  const tables = overlays(hall, /^in_longtable_l$/)
  assert.equal(tables.length, 2, 'two long tables')
  for (const tb of tables) {
    assert.ok(inRoom(great, tb), `the table at ${key(tb)} in the great hall`)
    const benches = overlays(hall, /^in_bench$/).filter(b => Math.abs(b.y - tb.y) === 1 && b.x >= tb.x - 1 && b.x <= tb.x + 3)
    assert.ok(benches.length >= 4, `benches along the table at ${key(tb)} (${benches.length})`)
    for (const b of benches) assert.ok(isWalkable(hall.map[b.y][b.x].tile, hall.map[b.y][b.x]), `a bench is sat on (${key(b)})`)
  }
  // the tables either side of the way from the door to the throne, which is kept clear
  assert.ok(tables.some(tb => tb.x + 2 < t.x) && tables.some(tb => tb.x > t.x), 'one table each side')
  for (let y = t.y + 1; y <= great.y1; y++) {
    const c = hall.map[y][t.x]
    assert.ok(isWalkable(c.tile, c) && !c.overlay, `the way to the throne is clear at ${t.x},${y}`)
  }
  // a fireplace on the face each side, torches
  const fires = overlays(hall, /^in_fireplace_tl$/)
  assert.equal(fires.length, 2)
  assert.ok(fires.every(f => f.y === great.y0 && inRoom(great, f)), 'on the north face of the great hall')
  assert.ok(fires.some(f => f.x < t.x) && fires.some(f => f.x > t.x), 'one each side')
  assert.ok(overlays(hall, /^in_torch$/).filter(c => c.y === great.y0 && inRoom(great, c)).length >= 2, 'torches')
})

test('the kitchens: hearth, oven, worktops, barrels and crates', () => {
  const hall = floorOf(built, 'hall'), kitchen = roomOf('hall', 'kitchen')
  const inK = re => overlays(hall, re).filter(c => inRoom(kitchen, c))
  assert.equal(inK(/^in_hearth_t$/).length, 1, 'a hearth')
  assert.ok(inK(/^in_oven$/).length >= 1, 'an oven')
  assert.ok(inK(/^in_worktop$/).length >= 1, 'a worktop')
  assert.ok(inK(/^in_barrel[23]?$/).length >= 1, 'barrels')
  assert.ok(inK(/^in_crate_(bread|cheese|greens)$/).length >= 1, 'crates of food')
})

test('the household: two hall guards, the stair guard, the cook and the servant, each on a cell of their own', () => {
  const all = built.floors.flatMap(f => f.entitySpawns.map(s => ({ f, s })))
  assert.deepEqual(all.map(({ s }) => s.id).sort(), [...HOUSEHOLD].sort())
  assert.ok(all.every(({ f }) => f.id === 'hall'), 'all on the ground floor')
  const hall = floorOf(built, 'hall')
  const cells = hall.entitySpawns.map(key)
  assert.equal(new Set(cells).size, cells.length, 'a cell each')
  const by = id => hall.entitySpawns.find(s => s.id === id)
  for (const id of HOUSEHOLD) {
    const s = by(id)
    assert.equal(s.kind, 'npc')
    assert.equal(s.species, id.includes('guard') ? 'watchman' : 'townsfolk', id)
    assert.ok(typeof s.look === 'string' && s.look.length > 0, `${id} has a look`)
    assert.equal(s.lines?.length, 2, `${id} has two lines of their own`)
    assert.ok(isWalkable(hall.map[s.y][s.x].tile, hall.map[s.y][s.x]), `${id} on a walkable cell`)
    assert.ok(makeNpc(s), `${id} becomes an npc`)
  }
  const entrance = roomOf('hall', 'entrance'), kitchen = roomOf('hall', 'kitchen')
  assert.ok(inRoom(entrance, by('castle:hall-guard-1')) && inRoom(entrance, by('castle:hall-guard-2')), 'the hall guards in the entrance hall')
  assert.ok(inRoom(kitchen, by('castle:cook')) && inRoom(kitchen, by('castle:servant')), 'the cook and the servant in the kitchens')
  // nobody on the way in, a stair or a landing
  const ways = new Set([...hall.stairs.flatMap(s => [key(s), key(s.land)]), key(hall.playerSpawn), key(hall.exit)])
  for (const s of hall.entitySpawns) assert.ok(!ways.has(key(s)), `${s.id} off the ways (${key(s)})`)
  // the stair guard stands by the stair up, on its landing's side
  const up = hall.stairs.find(s => s.to.floor === 'count')
  const g = by('castle:stair-guard')
  assert.ok(cheb(g, up.land) <= 1 && cheb(g, up) <= 1, `by the stair and its landing (${key(g)})`)
})

test('the stair up is held by the stair guard: his line while he stands, the way open without him', () => {
  const hall = floorOf(built, 'hall')
  const up = hall.stairs.find(s => s.to.floor === 'count')
  assert.equal(up.guard, 'castle:stair-guard')
  assert.equal(up.line, STAIR_LINE)
  const entities = hall.entitySpawns.map(s => makeNpc(s))
  const building = makeBuilding(built.floors.map(f => ({ ...f, entities: f.id === 'hall' ? entities : [] })), built.ground)
  assert.equal(blockedBy(building, up, entities), STAIR_LINE)
  assert.equal(blockedBy(building, up, entities.filter(e => e.id !== 'castle:stair-guard')), null)
  const guard = entities.find(e => e.id === 'castle:stair-guard')
  guard.hp = 0
  assert.equal(blockedBy(building, up, entities), null, 'not while he lies down')
  // the stair down to the cells is open
  assert.equal(blockedBy(building, hall.stairs.find(s => s.to.floor === 'cells'), entities), null)
})

test('the cells: a corridor, four cells behind barred doors, a table with a stool, a torch', () => {
  const cells = floorOf(built, 'cells')
  const doors = overlays(cells, /^in_celldoor$/)
  assert.equal(doors.length, 4, 'four cell doors')
  const seen = reach(cells.map, cells.stairs[0].land)
  for (const d of doors) {
    const c = cells.map[d.y][d.x]
    assert.ok(!isWalkable(c.tile, c) && c.losClear, `the door at ${key(d)} bars the way and is seen through`)
    // the corridor side reaches the bars; the cell behind is seen, never walked in
    assert.ok(seen.has(`${d.x},${d.y + 1}`), `the door at ${key(d)} is reached from the corridor`)
    const behind = cells.map[d.y - 1][d.x]
    assert.ok(!isWalkable(behind.tile, behind) && behind.losClear && /^in_floor_/.test(behind.skin), `the cell behind ${key(d)} is floor, seen but not walked`)
  }
  const [table] = overlays(cells, /^in_table_small$/)
  assert.ok(table, 'a table')
  assert.ok(overlays(cells, /^in_stool$/).some(s => cheb(s, table) === 1), 'a stool by it')
  assert.ok(overlays(cells, /^in_torch$/).length >= 1, 'a torch')
  assert.equal(cells.shut.length, 0)
})

test('the Count\'s floor: his chamber and his study off a corridor, the battlements door barred', () => {
  const count = floorOf(built, 'count')
  assert.equal(count.shut.length, 1)
  assert.equal(count.shut[0].line, BATTLEMENTS_LINE)
  // drawn as a door, not a gap in the wall: a heavy one with an iron bar across
  const [bar] = count.shut
  assert.equal(count.map[bar.y][bar.x].deco, MISC.barredDoor)
  assert.ok(INTERIOR_SKINS.includes(MISC.barredDoor), 'its picture is loaded with the kit')
  const def = defOf('count')
  const room = re => {
    const c = overlays(count, re)[0]
    assert.ok(c, `${re} laid`)
    return def.rooms.find(r => inRoom(r, c))?.id
  }
  const chamber = room(/^in_bed_v_t$/)
  assert.equal(room(/^in_wardrobe_t$/), chamber, 'the wardrobe in the chamber')
  assert.ok(count.map.flat().some(c => /^in_rug_/.test(c.deco ?? '')), 'a rug')
  const study = room(/^in_table_books$/)
  assert.notEqual(study, chamber)
  assert.ok(overlays(count, /^in_books_[13]$/).filter(c => def.rooms.find(r => inRoom(r, c))?.id === study).length >= 2, 'bookcases in the study')
  assert.ok(def.rooms.length >= 3, 'a corridor besides')
})

test('seat: the Count on his throne; anyone else on free floor of the hall', () => {
  const { seat } = BUILDINGS.castle
  const count = { id: 'named:count', age: 'adult', job: 'count', look: 'count' }
  assert.deepEqual(seat(count, 'work'), { floor: 'hall', spot: 'throne' })
  assert.deepEqual(seat(count, 'home'), { floor: 'hall', spot: 'throne' })
  assert.equal(seat({ id: 'tf:1', age: 'adult', job: 'weaver' }, 'work').floor, 'hall')
  const entry = (p, act) => ({ spawn: { kind: 'npc', species: 'townsfolk', id: p.id, look: p.look, lines: [], hostile: false }, person: p, act })
  const visitors = Array.from({ length: 6 }, (_, i) => entry({ id: `tf:${i}`, age: 'adult', job: 'weaver', look: 'a01' }, 'work'))
  const b = buildBuilding('castle', { seed: 7, people: [entry(count, 'work'), ...visitors] })
  const hall = floorOf(b, 'hall')
  const c = hall.entitySpawns.find(s => s.id === 'named:count')
  const t = hall.spots.get('throne')[0]
  assert.deepEqual([c.x, c.y], [t.x, t.y], 'the Count in his chair')
  assert.equal(c.roam, 0, 'and he keeps to it')
  const cells = hall.entitySpawns.map(key)
  assert.equal(new Set(cells).size, cells.length, 'a cell each')
  const great = roomOf('hall', 'great')
  for (const v of visitors) {
    const s = hall.entitySpawns.find(e => e.id === v.person.id)
    assert.ok(s, `${v.person.id} in the hall`)
    assert.ok(!(s.x === t.x && s.y > t.y && s.y <= great.y1), `${v.person.id} not on the way to the throne (${key(s)})`)
    assert.ok(isWalkable(hall.map[s.y][s.x].tile, hall.map[s.y][s.x]))
  }
})

test('every picture the keep lays is one the game loads, for any seed', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const f of buildBuilding('castle', { seed, people: [] }).floors) {
      for (const row of f.map) for (const c of row) for (const n of [c.skin, c.deco, c.overlay]) {
        if (n) assert.ok(INTERIOR_SKINS.includes(n), `${f.id} #${seed}: ${n} is not loaded`)
      }
    }
  }
})

test('the keep\'s door: open from dawn to nightfall, barred after; it stands in the keep', () => {
  for (const seed of [1, 7, 4242]) {
    const castle = cityFor(seed).doors.filter(d => d.kind === 'castle')
    assert.equal(castle.length, 1)
    const [door] = castle
    const k = PLAN.places.keep
    assert.ok(door.x >= k.x0 && door.x <= k.x1 && door.y >= k.y0 && door.y <= k.y1, `in the keep (${key(door)})`)
    assert.equal(door.building, 'castle')
    assert.equal(door.closed ?? null, null)
    assert.deepEqual(door.hours, { from: DAY.dawn, to: DAY.night, shut: NIGHT_LINE })
    assert.equal(doorShut(door, 0.5), null)
    assert.equal(doorShut(door, DAY.dawn), null, 'open at dawn')
    assert.equal(doorShut(door, DAY.dusk + 0.05), null, 'still open at dusk')
    assert.equal(doorShut(door, DAY.night), NIGHT_LINE, 'barred at nightfall')
    assert.equal(doorShut(door, 0.1), NIGHT_LINE)
  }
})
