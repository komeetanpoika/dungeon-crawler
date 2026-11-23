// Kalevanlinna's church inside (interior/buildings/church.js): the nave with
// its pews either side of the aisle, the altar on its dais under the coloured
// windows, the bell tower up a stair and the crypt down one; who the
// schedules put in it sits where their job and act say; the door keeps hours
// (wilds/city/indoors.js doorShut).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWalkable } from '../renderer/systems/entities.js'
import { MISC, INTERIOR_SKINS } from '../renderer/interior/kit.js'
import { buildBuilding, BUILDINGS } from '../renderer/interior/buildings/index.js'
import { doorShut } from '../renderer/wilds/city/indoors.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { rollTownsfolk, rollWatch } from '../renderer/wilds/city/folk.js'
import { scheduleFor, entryAt } from '../renderer/wilds/city/schedule.js'
import { makeNpc, updateNpc } from '../renderer/systems/npc.js'
import { mulberry32 } from '../renderer/interior/rng.js'

const CRACK_LINE = 'Warm air breathes up through the crack.'
const NIGHT_LINE = 'The church is locked for the night.'
const built = buildBuilding('church', { seed: 7, people: [] })
const floorOf = (b, id) => b.floors.find(f => f.id === id)
const key = c => `${c.x},${c.y}`

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

test('the church has a nave, a bell tower and a crypt, each walkable from its way in', () => {
  assert.equal(built.ground, 'nave')
  assert.deepEqual(built.floors.map(f => f.id), ['nave', 'tower', 'crypt'])
  for (const f of built.floors) {
    const origin = f.playerSpawn ?? f.stairs[0].land
    const seen = reach(f.map, origin)
    f.map.forEach((row, y) => row.forEach((c, x) => {
      if (isWalkable(c.tile, c)) assert.ok(seen.has(`${x},${y}`), `${f.id} ${x},${y} cut off`)
    }))
  }
  // the way out is on the ground floor only, in the south wall, three cells from the west end
  const nave = floorOf(built, 'nave')
  assert.equal(nave.exit.y, nave.map.length - 1)
  assert.equal(nave.exit.x, 3)
  assert.equal(floorOf(built, 'tower').exit, undefined)
  assert.equal(floorOf(built, 'crypt').exit, undefined)
})

test('every stair leads to a stair that leads back, and every floor is reached from the nave', () => {
  for (const f of built.floors) for (const s of f.stairs) {
    const to = floorOf(built, s.to.floor)
    assert.ok(to, `${f.id}/${s.id} leads to a floor that exists`)
    const back = to.stairs.find(t => t.id === s.to.stair)
    assert.ok(back, `${f.id}/${s.id} leads to a stair that exists`)
    assert.deepEqual(back.to, { floor: f.id, stair: s.id }, `${to.id}/${back.id} leads back`)
  }
  const seen = new Set(['nave']), q = ['nave']
  while (q.length) for (const s of floorOf(built, q.pop()).stairs) if (!seen.has(s.to.floor)) { seen.add(s.to.floor); q.push(s.to.floor) }
  assert.deepEqual([...seen].sort(), ['crypt', 'nave', 'tower'])
  // up to the tower from the west end; down to the crypt from beside the north wall
  const nave = floorOf(built, 'nave')
  const up = nave.stairs.find(s => s.to.floor === 'tower'), down = nave.stairs.find(s => s.to.floor === 'crypt')
  assert.ok(up.x <= 2, `the tower stair at the west end (${key(up)})`)
  assert.equal(down.y, 3, `the crypt stair against the north wall (${key(down)})`)
})

test('the nave: pews either side of the aisle, the front pews for school, the altar, pulpit, organ and font', () => {
  const nave = floorOf(built, 'nave')
  for (const id of ['pulpit', 'organ', 'altar-side']) assert.ok(nave.spots.get(id)?.length >= 1, `spot ${id}`)
  const pews = nave.spots.get('pew'), school = nave.spots.get('school')
  assert.ok(pews.length >= 36, `${pews.length} pew seats`)
  assert.ok(school.length >= 6, `${school.length} school seats`)
  for (const c of [...pews, ...school]) assert.equal(nave.map[c.y][c.x].overlay, 'in_pew', `a pew at ${key(c)}`)
  // the front pews are the ones nearest the altar
  const altar = overlays(nave, /^in_altar_l$/)
  assert.equal(altar.length, 1, 'one altar')
  const frontX = Math.max(...school.map(c => c.x))
  assert.ok(school.every(c => c.x > Math.max(...pews.map(p => p.x))), 'school sits in front of the congregation')
  assert.ok(frontX < altar[0].x, 'and the altar in front of them')
  // the aisle: two rows from the west end to the altar with no pew on them, pews north and south of it
  const pewRows = new Set([...pews, ...school].map(c => c.y))
  const aisle = nave.map.map((_, y) => y).filter(y => !pewRows.has(y) && y > Math.min(...pewRows) && y < Math.max(...pewRows))
  assert.equal(aisle.length, 2, `a two-row aisle between the pews (rows ${aisle})`)
  for (const y of aisle) for (let x = 1; x < altar[0].x; x++) {
    const c = nave.map[y][x]
    assert.ok(isWalkable(c.tile, c) && !/^in_pew/.test(c.overlay ?? ''), `the aisle is clear at ${x},${y}`)
  }
  // the altar on the red dais with two candles beside it
  const a = altar[0]
  assert.match(nave.map[a.y][a.x].deco ?? '', /^in_rug_red_/, 'the altar on a red rug')
  assert.match(nave.map[a.y][a.x + 1].deco ?? '', /^in_rug_red_/)
  const candles = overlays(nave, /^in_candle$/).filter(c => Math.abs(c.y - a.y) <= 1 && Math.abs(c.x - a.x - 0.5) <= 2.5)
  assert.ok(candles.length >= 2, 'two candles by the altar')
  // the organ on the north face at the west end, its bench below it
  const organ = overlays(nave, /^in_organ_tl$/)
  assert.equal(organ.length, 1)
  assert.ok(organ[0].x < nave.map[0].length / 4 && organ[0].y === 1, `the organ at the west end of the face (${key(organ[0])})`)
  const bench = nave.spots.get('organ')[0]
  assert.equal(nave.map[bench.y][bench.x].overlay, 'in_organ_bench')
  assert.ok(bench.y === 3 && (bench.x === organ[0].x || bench.x === organ[0].x + 1), 'the bench below the organ')
  // the pulpit at the north-east, the font near the door
  const [pulpit] = overlays(nave, /^in_pulpit$/)
  assert.ok(pulpit.x > nave.map[0].length * 0.7 && pulpit.y <= 4, `the pulpit at the north-east (${key(pulpit)})`)
  const [font] = overlays(nave, /^in_font$/)
  assert.ok(Math.max(Math.abs(font.x - nave.exit.x), Math.abs(font.y - nave.exit.y)) <= 3, `the font by the door (${key(font)})`)
})

test('coloured windows in a row along the north wall, no two neighbours alike', () => {
  const nave = floorOf(built, 'nave')
  const tops = overlays(nave, /^in_window_glass_[abc]_t$/).sort((a, b) => a.x - b.x)
  assert.ok(tops.length >= 6, `${tops.length} windows`)
  for (const t of tops) {
    assert.equal(t.y, 1, 'on the upper face row')
    assert.equal(nave.map[2][t.x].overlay, t.o.replace(/_t$/, '_b'), 'its lower half below it')
  }
  for (let i = 1; i < tops.length; i++) assert.notEqual(tops[i].o, tops[i - 1].o, `windows ${tops[i - 1].x} and ${tops[i].x} differ`)
  assert.ok(overlays(nave, /^in_window_glass_[abc]_[tb]$/).length >= 6)
})

test('the tower holds the bell and a window; the crypt its tombs, columns and the breathing crack', () => {
  const tower = floorOf(built, 'tower')
  assert.ok(tower.spots.get('bell')?.length >= 1, 'a place to ring from')
  assert.equal(overlays(tower, /^in_bell$/).length, 1)
  assert.equal(overlays(tower, /^in_window$/).filter(c => c.y === 1).length, 1, 'one window on the north face')
  const crypt = floorOf(built, 'crypt')
  assert.equal(crypt.shut.length, 1)
  const [crack] = crypt.shut
  assert.equal(crack.line, CRACK_LINE)
  assert.equal(crypt.map[crack.y][crack.x].deco, MISC.crack)
  assert.ok(crack.x > crypt.map[0].length * 0.75, `the crack at the east end (${key(crack)})`)
  const floors = new Set(crypt.map.flat().filter(c => isWalkable(c.tile, c) && !c.deco?.startsWith('in_rug')).map(c => c.skin))
  assert.ok([...floors].every(s => /^in_floor_greyflags/.test(s)), `grey flags (${[...floors]})`)
  const tombs = overlays(crypt, /^in_tomb_t$/)
  assert.ok(new Set(tombs.map(t => t.y)).size >= 2 && tombs.length >= 6, `two rows of tombs (${tombs.length})`)
  assert.ok(overlays(crypt, /^in_column$/).length >= 4, 'columns')
  assert.ok(overlays(crypt, /^in_candle$/).length >= 2, 'candles')
})

const person = (id, extra) => ({ id, age: 'adult', job: 'weaver', look: 'a01', ...extra })
const entry = (p, act) => ({ spawn: { kind: 'npc', species: 'townsfolk', id: p.id, look: p.look, lines: ['Hush.'], hostile: false }, person: p, act })

test('seat: the vicar, the organist, the bell-ringer, children at school and everyone else', () => {
  const { seat } = BUILDINGS.church
  assert.deepEqual(seat(person('named:vicar', { job: 'vicar' }), 'work'), { floor: 'nave', spot: 'pulpit' })
  assert.deepEqual(seat(person('named:vicar', { job: 'vicar' }), 'church'), { floor: 'nave', spot: 'altar-side' })
  assert.deepEqual(seat(person('named:vaino', { job: 'organist', age: 'elder' }), 'church'), { floor: 'nave', spot: 'organ' })
  assert.deepEqual(seat(person('named:vaino', { job: 'organist', age: 'elder' }), 'work'), { floor: 'nave', spot: 'organ' })
  assert.deepEqual(seat(person('tf:1', { job: 'bell-ringer' }), 'ring'), { floor: 'tower', spot: 'bell' })
  assert.deepEqual(seat(person('tf:1', { job: 'bell-ringer' }), 'church'), { floor: 'nave', spot: 'pew' })
  assert.deepEqual(seat(person('tf:2', { job: 'child', age: 'child' }), 'work'), { floor: 'nave', spot: 'school' })
  assert.deepEqual(seat(person('tf:2', { job: 'child', age: 'child' }), 'church'), { floor: 'nave', spot: 'pew' })
  assert.deepEqual(seat(person('tf:3'), 'church'), { floor: 'nave', spot: 'pew' })
})

// Review Focus 2: more people than seats
test('a full church: everyone once, each on a cell of their own, the overflow off the ways', () => {
  const crowd = Array.from({ length: 60 }, (_, i) => entry(person(`tf:${i}`), 'church'))
  const vicar = entry(person('named:vicar', { job: 'vicar', look: 'vicar' }), 'church')
  const organist = entry(person('named:vaino', { job: 'organist', age: 'elder', look: 'vaino' }), 'church')
  const ringer = entry(person('tf:ringer', { job: 'bell-ringer' }), 'ring')
  const b = buildBuilding('church', { seed: 7, people: [...crowd, vicar, organist, ringer] })
  const all = b.floors.flatMap(f => f.entitySpawns.map(s => ({ f, s })))
  assert.equal(all.length, 63)
  assert.equal(new Set(all.map(({ s }) => s.id)).size, 63, 'each once')
  for (const f of b.floors) {
    const cells = f.entitySpawns.map(key)
    assert.equal(new Set(cells).size, cells.length, `${f.id}: a cell each`)
    const ways = new Set([...f.stairs.flatMap(s => [key(s), key(s.land)]), ...[f.playerSpawn, f.exit].filter(Boolean).map(key)])
    for (const s of f.entitySpawns) {
      assert.ok(!ways.has(key(s)), `${s.id} not on a way in or out (${f.id} ${key(s)})`)
      assert.ok(isWalkable(f.map[s.y][s.x].tile, f.map[s.y][s.x]), `${s.id} on a walkable cell`)
    }
  }
  const at = id => all.find(({ s }) => s.id === id)
  const nave = floorOf(b, 'nave')
  assert.ok(nave.spots.get('altar-side').some(c => c.x === at('named:vicar').s.x && c.y === at('named:vicar').s.y), 'the vicar by the altar')
  assert.ok(nave.spots.get('organ').some(c => c.x === at('named:vaino').s.x && c.y === at('named:vaino').s.y), 'Väinö at the organ')
  assert.equal(at('tf:ringer').f.id, 'tower', 'the bell-ringer up the tower')
  // every pew is taken before anyone stands
  const pewCells = new Set(nave.spots.get('pew').map(key))
  assert.equal(crowd.filter(c => pewCells.has(key(at(c.person.id).s))).length, pewCells.size)
  assert.equal(at('tf:0').s.look, 'a01', 'the spawn is the one given')
})

test('the church door: open from dawn to dusk, the castle gate still shut by its line', () => {
  const city = cityFor(7)
  const church = city.doors.find(d => d.kind === 'church'), castle = city.doors.find(d => d.kind === 'castle')
  assert.equal(church.building, 'church')
  assert.deepEqual(church.hours, { from: DAY.dawn, to: DAY.dusk, shut: NIGHT_LINE })
  assert.ok(!church.closed, 'no shut line by day')
  assert.equal(doorShut(church, 0.45), null)
  assert.equal(doorShut(church, DAY.dawn), null, 'open at dawn')
  assert.equal(doorShut(church, DAY.dusk), NIGHT_LINE, 'locked at dusk')
  assert.equal(doorShut(church, 0.80), NIGHT_LINE)
  assert.equal(doorShut(church, 0.10), NIGHT_LINE)
  // a shut line always wins
  assert.equal(doorShut({ ...church, closed: 'Not today.' }, 0.45), 'Not today.')
  assert.equal(doorShut(castle, 0.45), castle.closed)
  assert.equal(typeof castle.closed, 'string')
  // an ordinary door keeps no hours
  assert.equal(doorShut(city.doors.find(d => d.kind === 'home'), 0.95), null)
})

test('every picture the church lays is one the game loads, for any seed', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const f of buildBuilding('church', { seed, people: [] }).floors) {
      for (const row of f.map) for (const c of row) for (const n of [c.skin, c.deco, c.overlay]) {
        if (n) assert.ok(INTERIOR_SKINS.includes(n), `${f.id} #${seed}: ${n} is not loaded`)
      }
    }
  }
})

test('the most people the schedules put in the church at once all find a place', () => {
  let peak = 0
  for (const seed of [1, 7]) {
    const city = cityFor(seed), door = city.doors.find(d => d.kind === 'church').label
    const folk = [...rollTownsfolk(seed, city), ...rollWatch(seed, city)]
    for (const day of [0, 1, 2]) {
      const days = folk.map(p => scheduleFor(p, city, seed, day))
      for (let f = 0; f < 1; f += 0.005) peak = Math.max(peak, days.filter(s => s[entryAt(s, f)].where.door === door).length)
    }
  }
  assert.ok(peak >= 30, `the bell sends a crowd (${peak})`)
  const crowd = Array.from({ length: peak }, (_, i) => entry(person(`tf:${i}`), 'church'))
  const b = buildBuilding('church', { seed: 7, people: crowd })
  assert.equal(b.floors.reduce((n, f) => n + f.entitySpawns.length, 0), peak)
})

// Ruling 2 (Task 6 follow-up): people in a building keep their place.
test('someone seated in the church stays on their pew; an ordinary resident would wander', () => {
  const people = [entry(person('tf:sitter'), 'church'), ...Array.from({ length: 50 }, (_, i) => entry(person(`tf:${i}`), 'church'))]
  const b = buildBuilding('church', { seed: 7, people })
  const nave = floorOf(b, 'nave')
  const sitter = nave.entitySpawns.find(s => s.id === 'tf:sitter')
  const stander = nave.entitySpawns.find(s => s.id === 'tf:49')   // one of the overflow, on free floor
  assert.equal(sitter.roam, 0, 'a seated spawn keeps its place')
  assert.equal(stander.roam, 0, 'and so does one put on free floor')
  assert.ok(nave.spots.get('pew').some(c => c.x === sitter.x && c.y === sitter.y))
  // ticked for 20 s with a seeded Math.random: still on the cell
  const tick = spawn => {
    const e = makeNpc(spawn)
    const state = { map: nave.map, player: { type: 'player', x: nave.exit.x, y: nave.exit.y, px: nave.exit.x * 32 + 16, py: nave.exit.y * 32 + 16, hp: 5, maxHp: 5 }, entities: [e], feedback: null, sfx: { cues: [], muted: false } }
    const random = Math.random
    Math.random = mulberry32(11)
    let strayed = 0
    try {
      for (let t = 0; t < 20; t += 1 / 30) {
        updateNpc(e, state, 1 / 30)
        strayed = Math.max(strayed, Math.abs(e.x - spawn.x), Math.abs(e.y - spawn.y))
      }
    } finally { Math.random = random }
    return { e, strayed }
  }
  for (const s of [sitter, stander]) {
    const { e, strayed } = tick(s)
    assert.equal(strayed, 0, `${s.id} never left ${key(s)}`)
    assert.deepEqual([e.x, e.y], [s.x, s.y])
  }
  // the same person without the building's roam wanders off (the test can tell)
  const { strayed } = tick({ ...sitter, roam: undefined })
  assert.ok(strayed >= 1, 'an ordinary resident roams')
})
