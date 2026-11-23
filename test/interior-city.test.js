// Kalevanlinna's doors from the inside: a city house is built afresh at every
// visit, holding exactly the people the schedules put behind that door now
// (wilds/city/runtime.js occupantsOf), its trade from whose house it is,
// nothing lying about, and the inn's hall a taproom. The town is run as in
// test/wilds-city-runtime.test.js; game.js enterHouse/exitCave do what
// wilds/city/indoors.js and systems/cave.js do here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arriveCity, tickCity, occupantsOf, occupantsWithActs, householdOf, cityPeople } from '../renderer/wilds/city/runtime.js'
import { cityHouseSpec, cityBuildingSpec, leaveCityHouse, struckInBuilding, spareStruck } from '../renderer/wilds/city/indoors.js'
import { violenceUnseen } from '../renderer/wilds/city/law.js'
import { tickCrime } from '../renderer/wilds/city/crime.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { buildBuilding } from '../renderer/interior/buildings/index.js'
import { makeBuilding } from '../renderer/interior/floors.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { generateInterior, houseSpec, INTERIOR_SKINS } from '../renderer/interior/index.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { buildCaveState, restoreSurface } from '../renderer/systems/cave.js'
import { INTERIOR_DEPTH, doorAt } from '../renderer/systems/houses.js'
import { isWalkable, TILE } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const SEED = 7
const S = 32
const NIGHT = 0.1 * DAY_LENGTH, NOON = 0.5 * DAY_LENGTH
// What game.js's buildEntities does with an npc spawn, minus the art.
const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') {
    const n = makeNpc(s)
    if (n && s.lines) n.lines = s.lines
    if (n && s.look) n.look = s.look
    return n ? [n] : []
  }
  return [{ type: s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
})
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5 }, entities: [], projectiles: [], zones: [], fireZones: [],
  lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(), caveInstances: {},
  sfx: { cues: [], muted: false },
})
const FOUNTAIN = { X: 79, Y: 236 }

function setup({ clock = NIGHT, day = 0 } = {}) {
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, FOUNTAIN, { buildEntities })
  const T = { clock, day, view: { w: 20, h: 12 } }
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: () => {}, hurt: () => {},
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T }
}
// the town put where the clock says (a load does the same)
function at(ctx, clock) { ctx.T.clock = clock; arriveCity(ctx.state, ctx.world, ctx.hooks, { fresh: true }) }

const city = cityFor(SEED)
// the doors built as houses: not the hand-laid church and keep
const open = city.doors.filter(d => !d.closed && !d.building)
const ids = list => list.map(p => p.id).sort()
const npcsOf = g => g.entitySpawns.filter(s => s.kind === 'npc')

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
function assertSound(g, what) {
  const seen = reach(g.map, g.playerSpawn)
  g.map.forEach((row, y) => row.forEach((c, x) => { if (isWalkable(c.tile, c)) assert.ok(seen.has(`${x},${y}`), `${what}: ${x},${y} cut off`) }))
  for (const s of g.entitySpawns) assert.ok(seen.has(`${s.x},${s.y}`), `${what}: ${s.kind} ${s.id} out of reach`)
  for (const row of g.map) for (const c of row) for (const n of [c.skin, c.deco, c.overlay]) if (n) assert.ok(INTERIOR_SKINS.includes(n), `${what}: ${n} is not loaded`)
}

test("a city house holds whoever's schedule puts them there now", () => {
  const ctx = setup({ clock: NIGHT })
  const { state, world } = ctx
  const night = new Map(open.map(d => [d.label, ids(occupantsOf(state, d.label))]))
  at(ctx, NOON)
  const noon = new Map(open.map(d => [d.label, ids(occupantsOf(state, d.label))]))
  // a home with people in at night, and fewer of them by day
  const door = open.find(d => d.kind === 'home' && night.get(d.label).length >= 2 && noon.get(d.label).length < night.get(d.label).length)
  assert.ok(door, 'a household that goes out by day')

  for (const [clock, want] of [[NIGHT, night], [NOON, noon]]) {
    at(ctx, clock)
    // every open door of the town, at this moment: exactly who is in, each once, as they look
    let total = 0
    for (const d of open) {
      const g = generateInterior(cityHouseSpec(state, d, world.seed))
      const npcs = npcsOf(g)
      assert.deepEqual(ids(npcs), want.get(d.label), `${d.kind} ${d.label} at ${clock}`)
      total += npcs.length
      for (const s of npcs) {
        const w = state.cityRun.people.get(s.id)
        assert.ok(w && w.mode === 'indoors' && w.door === d.label, `${s.id} is in by the town`)
        assert.equal(w.entry.where.door, d.label, `${s.id}: the schedule puts them there`)
        assert.equal(s.species, w.person.job === 'watch' ? 'watchman' : 'townsfolk')
        assert.equal(s.look, w.person.look)
        assert.equal(s.hostile, false)
        assert.ok(s.lines.length >= 1, `${s.id} has something to say`)
      }
    }
    assert.equal(total, cityPeople(state).filter(p => p.mode === 'indoors' && !p.out && p.door && open.some(d => d.label === p.door)).length, 'nobody indoors is missing from their house')
  }
  // the off-duty watch is in the barracks, as watchmen
  at(ctx, NIGHT)
  const barracks = open.find(d => d.kind === 'barracks')
  const watch = npcsOf(generateInterior(cityHouseSpec(state, barracks, world.seed)))
  assert.ok(watch.length >= 6 && watch.every(s => s.species === 'watchman'), `${watch.length} watchmen off duty`)
  // the house is the same one whoever is in: only the people differ
  const g1 = generateInterior(cityHouseSpec(state, door, world.seed))
  at(ctx, NOON)
  const g2 = generateInterior(cityHouseSpec(state, door, world.seed))
  assert.deepEqual(g2.plan.grid, g1.plan.grid)
  assert.deepEqual([...g2.roles.values()], [...g1.roles.values()])
})

test('a house whose people are all out is empty', () => {
  const ctx = setup({ clock: NOON })
  const { state, world } = ctx
  const out = open.filter(d => d.kind === 'home' && householdOf(state, d.label).length && !occupantsOf(state, d.label).length)
  assert.ok(out.length >= 5, `${out.length} households all out at noon`)
  for (const door of out) {
    const spec = cityHouseSpec(state, door, world.seed)
    assert.equal(spec.version, 'empty', door.label)
    const g = generateInterior(spec)
    assert.equal(g.entitySpawns.length, 0, `${door.label}: nobody and nothing in`)
  }
  // a door nobody lives or works behind is empty at any hour
  at(ctx, NIGHT)
  const unlet = open.filter(d => !householdOf(state, d.label).length)
  assert.ok(unlet.length >= 5)
  for (const door of unlet) assert.equal(generateInterior(cityHouseSpec(state, door, world.seed)).entitySpawns.length, 0, door.label)
})

test('the inn has a taproom with a counter, tables and a fire', () => {
  const ctx = setup({ clock: 0.78 * DAY_LENGTH })   // the evening at the inn
  const { state, world } = ctx
  const inn = open.find(d => d.kind === 'inn')
  const live = cityHouseSpec(state, inn, world.seed)
  assert.equal(live.trade, 'innkeeper')
  assert.ok(live.residents.length >= 3, `${live.residents.length} in the inn of an evening`)
  const specs = [live, ...Array.from({ length: 24 }, (_, s) => houseSpec(inn, { worldSeed: 100 + s }))]
  for (const spec of specs) {
    const what = `inn #${spec.seed}`
    assert.equal(spec.trade, 'innkeeper', what)
    const g = generateInterior(spec)
    assertSound(g, what)
    assert.equal(g.roles.get(g.plan.entry), 'taproom', what)
    assert.ok([...g.roles.values()].includes('bedroom') && [...g.roles.values()].includes('kitchen'), `${what}: rooms for guests and a kitchen`)
    const r = g.plan.rooms.find(q => q.id === g.plan.entry)
    const at = (x, y) => g.map[y][x].overlay ?? ''
    // the counter: three cells of counter on the lower face row, bottles on the shelf above
    let counter = 0
    for (let x = r.x0; x + 2 <= r.x1; x++) {
      if ([0, 1, 2].every(i => at(x + i, r.y0 + 1).startsWith('in_worktop')) && [0, 1, 2].some(i => at(x + i, r.y0).startsWith('in_bottleshelf'))) counter++
    }
    assert.ok(counter >= 1, `${what}: a counter on the face` + '\n' + g.plan.grid.join('\n'))
    // the fire: a fireplace on the face
    let fire = false
    for (let x = r.x0; x <= r.x1; x++) if (at(x, r.y0).startsWith('in_hearth_t') && at(x, r.y0 + 1).startsWith('in_hearth_b')) fire = true
    assert.ok(fire, `${what}: a fireplace`)
    // the tables, each with a bench along it
    let tables = 0
    for (let y = r.floorY0; y <= r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      if (!/^in_table(_food)?_l$/.test(at(x, y))) continue
      const bench = [y - 1, y + 1].some(by => at(x, by) === 'in_bench' && at(x + 1, by) === 'in_bench')
      if (bench) tables++
    }
    assert.ok(tables >= 2, `${what}: ${tables} tables with benches`)
    // the kegs
    let kegs = 0
    for (let y = r.floorY0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (/^in_barrel\d?$/.test(at(x, y))) kegs++
    assert.ok(kegs >= 2, `${what}: ${kegs} kegs`)
  }
})

test('city homes have no loot', () => {
  const ctx = setup({ clock: NIGHT })
  const { state, world } = ctx
  const kinds = new Set()
  for (const door of open) {
    const spec = cityHouseSpec(state, door, world.seed)
    assert.equal(spec.noLoot, true)
    const g = generateInterior(spec)
    assertSound(g, `${door.kind} ${door.label}`)
    const things = g.entitySpawns.filter(s => s.kind !== 'npc')
    assert.equal(things.length, 0, `${door.kind} ${door.label}: ${things.map(s => s.kind).join(', ')}`)
    kinds.add(door.kind)
  }
  assert.deepEqual([...kinds].sort(), ['barracks', 'home', 'inn', 'shop', 'smithy', 'warehouse', 'workshop'])
  // the trade from whose house it is: the smithy is a smith's, a baker's shop a baker's
  assert.equal(cityHouseSpec(state, open.find(d => d.kind === 'smithy'), world.seed).trade, 'smith')
  const bakery = open.find(d => d.kind === 'shop' && householdOf(state, d.label)[0]?.job === 'baker')
  assert.equal(cityHouseSpec(state, bakery, world.seed).trade, 'baker')
})

test('one struck down indoors is out until the next day', () => {
  const ctx = setup({ clock: NIGHT })
  const { state, world, hooks, T } = ctx
  const door = open.find(d => d.kind === 'home' && occupantsOf(state, d.label).length >= 2)
  const enter = () => {
    const house = generateInterior(cityHouseSpec(state, door, world.seed))
    return buildCaveState(state, { x: door.x, y: door.y, caveDepth: INTERIOR_DEPTH, label: door.label }, {
      map: house.map, entities: buildEntities(house.entitySpawns), playerSpawn: house.playerSpawn, exit: house.exit, theme: house.theme,
    })
  }
  let cave = enter()
  const [victim, other] = cave.entities.filter(e => e.type === 'npc')
  assert.ok(victim.look && victim.lines.length, 'a resident drawn with their look')
  assert.equal(victim.cityKey, undefined, 'not one of the street: a blow indoors is not seen outside')
  // struck down and culled, the other only hurt
  victim.hp = 0
  other.hp = 1
  cave.entities = cave.entities.filter(e => e.hp > 0)
  leaveCityHouse(cave)
  let surface = restoreSurface(cave)
  const me = () => cityPeople(surface).find(p => p.id === victim.id)
  assert.equal(me().out, true)
  assert.equal(occupantsOf(surface, door.label).some(p => p.id === victim.id), false, 'nobody finds them at home')
  assert.ok(occupantsOf(surface, door.label).some(p => p.id === other.id), 'the hurt one is still in')
  // back in: they are not
  cave = enter()
  assert.equal(cave.entities.some(e => e.id === victim.id), false)
  assert.ok(cave.entities.some(e => e.id === other.id))
  surface = restoreSurface(cave)
  // the next day they are about again, and at night at home
  T.day = 1; T.clock = 0.02 * DAY_LENGTH
  tickCity(surface, world, 0.05, hooks)
  assert.equal(me().out, false)
  assert.ok(occupantsOf(surface, door.label).some(p => p.id === victim.id), 'home again the next night')
})

// ---- the church: a building of floors (interior/buildings/church.js) -----------------------------
const BELL = (DAY.bell + 0.025) * DAY_LENGTH
const churchIn = state => state.houseDoors.find(d => d.kind === 'church')
// what game.js enterBuilding does, minus the art
function enterChurch(state, door, spec) {
  const built = buildBuilding(spec.kind, spec)
  const floors = built.floors.map(f => ({
    id: f.id, map: f.map, entities: buildEntities(f.entitySpawns), stairs: f.stairs, shut: f.shut, spawn: f.playerSpawn, exit: f.exit,
  }))
  const building = makeBuilding(floors, built.ground)
  const ground = building.floors.get(built.ground)
  const cave = buildCaveState(state, { x: door.x, y: door.y, caveDepth: INTERIOR_DEPTH, label: door.label }, {
    map: ground.map, entities: ground.entities, playerSpawn: ground.spawn, exit: ground.exit, theme: built.theme,
  })
  cave.cave.building = building
  cave.cave.city = true
  return cave
}

test('the church door reaches the window with its building and hours', () => {
  const { state } = setup({ clock: NOON })
  const rec = city.doors.find(d => d.kind === 'church')
  const door = churchIn(state)
  assert.ok(door, 'the church door is among the window\'s doors')
  assert.equal(door.label, rec.label)
  assert.equal(door.building, 'church')
  assert.deepEqual(door.hours, { from: DAY.dawn, to: DAY.dusk, shut: 'The church is locked for the night.' })
  // its double door: either half is walked onto and opens it (game.js doorAt)
  for (const x of [door.x, door.x + 1]) {
    assert.equal(state.map[door.y][x].tile, TILE.FLOOR, `the door's cell ${x - door.x} is walked onto`)
    assert.ok(doorAt(state.houseDoors, x, door.y) === door, `the door's cell ${x - door.x} opens the church`)
  }
  assert.equal(doorAt(state.houseDoors, door.x + 2, door.y), null, 'and the wall beside it does not')
})

test('at the bell the church holds whoever the schedules put in it, each where their act seats them', () => {
  const { state, world } = setup({ clock: BELL })
  const door = churchIn(state)
  const inside = occupantsOf(state, door.label)
  const withActs = occupantsWithActs(state, door.label)
  assert.deepEqual(withActs.map(p => p.person.id).sort(), ids(inside))
  for (const { person, act } of withActs) {
    const w = state.cityRun.people.get(person.id)
    assert.ok(w.person === person, 'the Person record itself')
    assert.equal(act, w.entry.act)
  }
  const spec = cityBuildingSpec(state, door, world.seed)
  assert.equal(spec.kind, 'church')
  assert.equal(typeof spec.seed, 'number')
  assert.equal(cityBuildingSpec(state, door, world.seed).seed, spec.seed, 'the same church every visit')
  assert.deepEqual(spec.people.map(p => p.person.id).sort(), ids(inside))
  for (const p of spec.people) {
    assert.equal(p.spawn.kind, 'npc'); assert.equal(p.spawn.id, p.person.id); assert.equal(p.spawn.look, p.person.look)
    assert.equal(p.spawn.hostile, false); assert.ok(p.spawn.lines.length >= 1)
  }
  // the church's own people are in at the bell (the congregation walks to it
  // and may not be in yet: test/interior-church.test.js seats a full one)
  const actOf = id => spec.people.find(p => p.person.id === id)?.act
  assert.equal(actOf('named:vicar'), 'church')
  assert.equal(actOf('named:vaino'), 'church')
  assert.ok(spec.people.some(p => p.act === 'ring' && p.person.job === 'bell-ringer'), 'the bell-ringer')
  // built, everyone appears once; the vicar by the altar, Väinö at the organ, the ringer up the tower
  const b = buildBuilding(spec.kind, spec)
  const placed = b.floors.flatMap(f => f.entitySpawns.map(s => ({ f, s })))
  assert.deepEqual(placed.map(({ s }) => s.id).sort(), ids(inside))
  const on = (id, floor, spot) => {
    const at = placed.find(({ s }) => s.id === id)
    assert.equal(at.f.id, floor, id)
    if (spot) assert.ok(at.f.spots.get(spot).some(c => c.x === at.s.x && c.y === at.s.y), `${id} on ${spot}`)
  }
  on('named:vicar', 'nave', 'altar-side')
  on('named:vaino', 'nave', 'organ')
  for (const p of spec.people.filter(q => q.act === 'ring')) on(p.person.id, 'tower', 'bell')
  // at night the door is shut and nobody is seen: an empty church is still a church
  assert.ok(buildBuilding('church', { seed: spec.seed, people: [] }).floors.length === 4)
})

test('leaving the church: those on the other floors were not struck down; one gone from the tower was', () => {
  const { state, world } = setup({ clock: BELL })
  const door = churchIn(state)
  const spec = cityBuildingSpec(state, door, world.seed)
  const ringer = spec.people.find(p => p.act === 'ring')
  assert.ok(ringer, 'the bell-ringer is up the tower at the bell')
  const out = id => cityPeople(state).find(q => q.id === id).out
  let cave = enterChurch(state, door, spec)
  assert.ok(cave.cave.building.floors.get('tower').entities.some(e => e.id === ringer.person.id), 'in the tower, not on the nave')
  assert.equal(cave.entities.some(e => e.id === ringer.person.id), false)
  leaveCityHouse(cave)
  restoreSurface(cave)
  for (const p of spec.people) assert.equal(out(p.person.id), false, `${p.person.id} is not struck down`)
  // struck down up the tower (culled from that floor), and the vicar on the nave
  cave = enterChurch(state, door, spec)
  const tower = cave.cave.building.floors.get('tower')
  tower.entities = tower.entities.filter(e => e.id !== ringer.person.id)
  assert.ok(cave.entities.some(e => e.id === 'named:vicar'))
  cave.entities = cave.entities.filter(e => e.id !== 'named:vicar')
  leaveCityHouse(cave)
  restoreSurface(cave)
  assert.equal(out(ringer.person.id), true, 'the ringer is out until tomorrow')
  assert.equal(out('named:vicar'), true)
  assert.equal(spec.people.filter(p => out(p.person.id)).length, 2, 'nobody else')
})

test('a blow in a building: spared and not struck down; counted as a blow in the street (warn, then wanted)', () => {
  const { state, world } = setup({ clock: BELL })
  const door = churchIn(state)
  const spec = cityBuildingSpec(state, door, world.seed)
  let cave = enterChurch(state, door, spec)
  assert.equal(struckInBuilding(cave), true)
  // an ordinary house is not a building: the old path
  const home = open.find(d => d.kind === 'home')
  const house = generateInterior(cityHouseSpec(state, home, world.seed))
  const hcave = buildCaveState(state, { x: home.x, y: home.y, caveDepth: INTERIOR_DEPTH, label: home.label }, {
    map: house.map, entities: buildEntities(house.entitySpawns), playerSpawn: house.playerSpawn, exit: house.exit, theme: house.theme,
  })
  assert.equal(struckInBuilding(hcave), false)
  assert.equal(struckInBuilding(state), false)
  // the vicar is killed outright and culled; still not struck down
  const vicar = cave.entities.find(e => e.id === 'named:vicar')
  vicar.hp = 0
  cave.entities = cave.entities.filter(e => e !== vicar)
  spareStruck(cave, vicar)
  assert.equal(vicar.hp, vicar.maxHp, 'healed to full')
  leaveCityHouse(cave)
  const surface = restoreSurface(cave)
  assert.equal(cityPeople(surface).find(q => q.id === 'named:vicar').out, false)
  // the act is counted like a street blow
  assert.equal(surface.cityRun.crime.level, 'calm')
  assert.equal(violenceUnseen(surface), 'warn')
  assert.equal(surface.cityRun.crime.level, 'warned')
  tickCrime(surface.cityRun.crime, 0.3)   // street time only: well inside the warning's grace
  assert.equal(violenceUnseen(surface), 'wanted')
  assert.equal(surface.cityRun.crime.level, 'wanted')
})
