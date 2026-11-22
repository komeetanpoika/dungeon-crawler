// Kalevanlinna's doors from the inside: a city house is built afresh at every
// visit, holding exactly the people the schedules put behind that door now
// (wilds/city/runtime.js occupantsOf), its trade from whose house it is,
// nothing lying about, and the inn's hall a taproom. The town is run as in
// test/wilds-city-runtime.test.js; game.js enterHouse/exitCave do what
// wilds/city/indoors.js and systems/cave.js do here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arriveCity, tickCity, occupantsOf, householdOf, cityPeople } from '../renderer/wilds/city/runtime.js'
import { cityHouseSpec, leaveCityHouse } from '../renderer/wilds/city/indoors.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { generateInterior, houseSpec, INTERIOR_SKINS } from '../renderer/interior/index.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { buildCaveState, restoreSurface } from '../renderer/systems/cave.js'
import { INTERIOR_DEPTH } from '../renderer/systems/houses.js'
import { isWalkable } from '../renderer/systems/entities.js'
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
const open = city.doors.filter(d => !d.closed)
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
