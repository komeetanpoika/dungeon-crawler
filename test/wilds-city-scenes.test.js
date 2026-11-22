// Kalevanlinna's scenes: the set pieces that make five minutes on the square
// never the same twice (wilds/city/scenes.js), cast by the runtime from the
// near people and run through their npc goals. The window is built by
// session.js as in the game; buildEntities and the hooks stand in for game.js's.
//
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b): a failing strict equal makes Node diff both sides, and a
// city npc's ai.goals reaches the whole city.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCENES, ALWAYS, scenesForDay, squareScenesAt, sceneWindows, scheduleAt, LIFT_R } from '../renderer/wilds/city/scenes.js'
import { TALKS, NIGHT_TALKS } from '../renderer/wilds/city/lines.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { arriveCity, tickCity, cityPeople } from '../renderer/wilds/city/runtime.js'
import { arrest, seat, clearCrime, stocksWorld } from '../renderer/wilds/city/law.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { toWindow } from '../renderer/wilds/window.js'
import { PIECE } from '../renderer/wilds/layout.js'
import { makeNpc, updateNpc, sceneSay } from '../renderer/systems/npc.js'
import { stepEnemyAttack } from '../renderer/systems/enemy-attack.js'
import { makeFeedback, think, ambientSpeakers } from '../renderer/systems/feedback.js'
import { TILE } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const SEED = 7
const S = 32
const DT = 0.05
const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
  return [{ type: s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
})
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5, facing: 'south' }, entities: [], projectiles: [], zones: [],
  fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(),
  caveInstances: {}, sfx: { cues: [], muted: false },
})
const FOUNTAIN = { X: 79, Y: 236 }   // a step south of the fountain

function setup({ at = FOUNTAIN, frac = 0.5, day = 0, view = { w: 20, h: 12 } } = {}) {
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, at, { buildEntities })
  const T = { clock: frac * DAY_LENGTH, day, view }
  const cues = new Map()
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: name => cues.set(name, (cues.get(name) ?? 0) + 1), hurt: () => {},
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T, cues }
}
// the frame loop's share: the town, every npc's goals, their swings. `each`
// runs after every frame and stops the run by returning false.
function run(ctx, seconds, { each = null } = {}) {
  const { state, world, hooks, T } = ctx
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    T.clock = (T.clock + DT) % DAY_LENGTH
    tickCity(state, world, DT, hooks)
    for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, DT)
    for (const e of state.entities) stepEnemyAttack(e, state, DT)
    state.sfx.cues = []
    if (each && each(t) === false) return true
  }
  return false
}
const frac = ctx => ctx.T.clock / DAY_LENGTH
const entityOf = (state, id) => state.entities.find(e => e.cityKey === id) ?? null
const entityWorld = (world, e) => ({ X: e.px / S - 0.5 + world.origin.wx * PIECE, Y: e.py / S - 0.5 + world.origin.wy * PIECE })
const cheb = (a, b) => Math.max(Math.abs(a.X - b.X), Math.abs(a.Y - b.Y))
function placePlayer(state, world, X, Y) {
  const { x, y } = toWindow(world.origin, X, Y)
  state.player.x = x; state.player.y = y; state.player.px = x * S + 16; state.player.py = y * S + 16
}
const walkable = (state, world, X, Y) => { const { x, y } = toWindow(world.origin, X, Y); return state.map[y]?.[x]?.tile === TILE.FLOOR }

test('five minutes on the square: at least four scenes, and no two consecutive minutes alike', () => {
  for (const seed of [1, 7, 4242]) for (const day of [0, 1, 5]) {
    const minutes = [0, 1, 2, 3, 4].map(m => new Set([0, 10, 20, 30, 40, 50].flatMap(s => squareScenesAt(seed, day, ((DAY.morning * 360 + m * 60 + s) % 360) / 360))))
    assert.ok(new Set(minutes.flatMap(s => [...s])).size >= 4)
    for (let i = 1; i < 5; i++) assert.notDeepEqual([...minutes[i]].sort(), [...minutes[i - 1]].sort())
  }
})

test('two days in a row run different scene sets', () => {
  for (const seed of [1, 7, 4242, 99]) for (let day = 0; day < 21; day++) {
    const a = scenesForDay(seed, day), b = scenesForDay(seed, day + 1)
    for (const id of ALWAYS) assert.ok(a.has(id), `${id} every day`)
    assert.ok([...a].every(id => SCENES.includes(id) && id !== 'gawk'), 'known scenes; the stocks\' crowd is never rolled')
    assert.ok(a.size - ALWAYS.length >= 3, `at least three rolled (${[...a]})`)
    assert.notDeepEqual([...a].sort(), [...b].sort(), `seed ${seed}, days ${day} and ${day + 1}`)
    assert.deepEqual([...scenesForDay(seed, day)].sort(), [...a].sort(), 'the same day is the same')
    // every scene of the day has its time in it, and none that is not of the day
    const timed = new Set(sceneWindows(seed, day).map(s => s.id))
    assert.deepEqual([...timed].sort(), [...a].sort())
  }
  assert.deepEqual(SCENES.slice().sort(), ['beggar', 'busker', 'cart', 'church', 'crier', 'drunk', 'gawk', 'lamps', 'pigeons', 'shift', 'smith', 'tag', 'talk', 'unload', 'washing'])
})

test('two townsfolk talking stop, face each other and take turns', () => {
  const slot = sceneWindows(SEED, 0).find(s => s.id === 'talk' && s.place === 'square')
  assert.ok(slot, 'a talk on the square that day')
  const ctx = setup({ frac: slot.a + 0.002 })
  const { state, world } = ctx
  const pair = () => state.cityRun.scenes.find(s => s.id === 'talk' && s.conv.go)
  assert.ok(run(ctx, 15, { each: () => !pair() }), 'two people stopped for a word')
  const sc = pair()
  const [ia, ib] = sc.cast
  const a = entityOf(state, ia), b = entityOf(state, ib)
  assert.ok(a && b && a !== b, 'two of them, both near')
  // stopped: neither moves for a second, and each faces the other
  const pa = { px: a.px, py: a.py }, pb = { px: b.px, py: b.py }
  run(ctx, 1)
  assert.ok(entityOf(state, ia) === a && entityOf(state, ib) === b)
  assert.ok(Math.hypot(a.px - pa.px, a.py - pa.py) < 3 && Math.hypot(b.px - pb.px, b.py - pb.py) < 3, 'they stand')
  assert.equal(a.ai.current, 'talk'); assert.equal(b.ai.current, 'talk')
  assert.ok(Math.hypot(a.px - b.px, a.py - b.py) < 1.6 * S, 'side by side')
  assert.equal(a.facing, b.px > a.px ? 'east' : 'west')
  assert.equal(b.facing, a.px > b.px ? 'east' : 'west')
  // the lines alternate, in order, until the last
  const lines = a.city.talk.lines
  assert.ok(b.city.talk.lines === lines && [...TALKS, ...NIGHT_TALKS].includes(lines))
  const said = []
  const seen = { a: 0, b: 0 }
  // on screen round the player, each line shows in a bubble over its speaker
  const view = { x0: state.player.px - 20 * S, y0: state.player.py - 12 * S, x1: state.player.px + 20 * S, y1: state.player.py + 12 * S }
  const onScreen = e => e.px >= view.x0 && e.px <= view.x1 && e.py >= view.y0 && e.py <= view.y1
  let shown = 0
  // the first line may already be out
  for (const [who, e] of [['a', a], ['b', b]]) if (e.city.say) { said.push({ who, text: e.city.say.text }); seen[who] = e.city.say.n }
  run(ctx, lines.length * 2.4 + 2, { each: () => {
    for (const [who, e] of [['a', a], ['b', b]]) if (e.city.say && e.city.say.n !== seen[who]) {
      seen[who] = e.city.say.n; said.push({ who, text: e.city.say.text })
      if (onScreen(e)) { assert.ok(ambientSpeakers(state.entities, view, state.player).includes(e), 'a street talk shows over the speaker'); shown++ }
    }
    return !sc.done
  } })
  assert.deepEqual(said.map(s => s.text), lines, 'every line, in order')
  for (let i = 0; i < said.length; i++) assert.equal(said[i].who, i % 2 ? 'b' : 'a', 'turn and turn about')
  if (onScreen(a)) assert.ok(shown >= 2, `the talk was seen (${shown})`)
  assert.equal(state.feedback.bubble, null, 'and none of it in the player\'s own bubble')
  // done: both go back about their day
  run(ctx, 0.5)
  const people = new Map(cityPeople(state).map(p => [p.id, p]))
  assert.equal(people.get(ia).scene, null); assert.equal(people.get(ib).scene, null)
})

test('a scene never talks over the player or a tale', () => {
  const state = freshState()
  state.player.px = 16; state.player.py = 16
  const e = { id: 'tf:1', px: 48, py: 16, city: {} }
  think(state, 'Hm.')
  sceneSay(state, e, 'Morning.')
  assert.equal(state.feedback.bubble.text, 'Hm.', 'the player\'s own thought stays')
  assert.deepEqual(e.city.say, { text: 'Morning.', n: 1, t: 0 }, 'kept on the speaker all the same')
  // the single bubble is never a scene's: each speaker has their own (wilds-city-lines.test.js)
  state.feedback.bubble = null
  sceneSay(state, e, 'Cold one.')
  const o = { id: 'tf:2', px: 80, py: 16, city: {} }
  sceneSay(state, o, 'True enough.')
  assert.equal(state.feedback.bubble, null)
  assert.equal(e.city.say.text, 'Cold one.'); assert.equal(o.city.say.text, 'True enough.')
  const both = ambientSpeakers([e, o], { x0: 0, y0: 0, x1: 640, y1: 480 }, state.player)
  assert.ok(both.length === 2 && both[0] === e && both[1] === o, 'two speakers, two bubbles')
})

test('pigeons lift when the dog runs at them and settle somewhere else', () => {
  const slot = sceneWindows(SEED, 0).find(s => s.id === 'pigeons')
  // a wide screen: the square's dog (homed at the door nearest the fountain) is near wherever it pottered
  const ctx = setup({ frac: slot.a - 0.004, view: { w: 30, h: 18 } })
  const { state, world } = ctx
  const f = state.cityRun.fx.flocks[0]
  assert.equal(f.state, 'settled')
  const from = { X: f.X, Y: f.Y }
  // the player stands on the square, well clear of the flock
  let at = null
  for (let r = 7; r < 14 && !at; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (walkable(state, world, from.X + dx, from.Y + dy)) { at = { X: from.X + dx, Y: from.Y + dy }; break }
  assert.ok(at)
  placePlayer(state, world, at.X, at.Y)
  const scene = () => state.cityRun.scenes.find(s => s.id === 'pigeons')
  assert.ok(run(ctx, 4, { each: () => !scene() }), 'the scene is on')
  const sc = scene()
  assert.ok(sc.dog, 'a dog is about')
  const dogEntity = () => state.cityRun.animals.get(sc.dog).entity
  const d0 = cheb(entityWorld(world, dogEntity()), from)
  assert.ok(d0 > LIFT_R, `the dog starts off away from the flock (${d0})`)
  let liftD = null
  const states = []
  run(ctx, 30, { each: () => {
    if (states.at(-1) !== f.state) {
      states.push(f.state)
      if (f.state === 'lifting') liftD = cheb(entityWorld(world, dogEntity()), from)
    }
    return !(sc.done && f.state === 'settled')
  } })
  assert.deepEqual(states, ['settled', 'lifting', 'circling', 'settled'])
  assert.ok(liftD !== null && liftD <= LIFT_R + 0.5, `the dog was on them when they lifted (${liftD})`)
  assert.ok(cheb(f, from) >= 6, `settled somewhere else (${f.X},${f.Y} from ${from.X},${from.Y})`)
  assert.ok(sc.done, 'and the scene is over')
  assert.equal(dogEntity()?.objective ?? null, null, 'the dog goes back to its own business')
})

test('the stocks draw a crowd: the gawk scene', () => {
  const ctx = setup()
  const { state, world } = ctx
  assert.equal(arrest(state), true)
  assert.equal(seat(state, world), true)
  const st = stocksWorld(world)
  run(ctx, 10)
  const sc = state.cityRun.scenes.find(s => s.id === 'gawk')
  assert.ok(sc, 'the crowd is a scene')
  const crowd = sc.cast.map(id => entityOf(state, id)).filter(Boolean)
  assert.ok(crowd.length >= 4, `a crowd (${crowd.length})`)
  const standing = crowd.filter(e => cheb(entityWorld(world, e), st) <= 3.5)
  assert.ok(standing.length >= 4, `round the stocks (${standing.length})`)
  for (const e of standing) {
    assert.equal(e.ai.current, 'gawk')
    const X = entityWorld(world, e).X
    if (Math.abs(X - st.X) > 0.6) assert.equal(e.facing, st.X < X ? 'west' : 'east', 'facing the stocks')
  }
  assert.ok((ctx.cues.get('splat') ?? 0) >= 3, 'turnips land')
  assert.ok(cityPeople(state).filter(p => p.gawk).length >= 4)
  // let go (a wake, say): everyone back about their day
  clearCrime(state)
  assert.equal(state.cityRun.scenes.some(s => s.id === 'gawk'), false)
  assert.equal(cityPeople(state).filter(p => p.gawk).length, 0)
  assert.equal(state.cityRun.fx.turnips.length, 0)
  run(ctx, 1)
  assert.equal(state.cityRun.scenes.some(s => s.id === 'gawk'), false, 'no crowd without the stocks')
})

test('a carter\'s cart comes down market street to a stall and back out; people step aside', () => {
  const day = 1
  const slot = sceneWindows(SEED, day).find(s => s.id === 'cart')
  assert.ok(slot, 'a cart that day')
  // the player at the top of the square, where market street comes in
  const ctx = setup({ at: { X: 82, Y: 222 }, frac: slot.a - 0.002, day })
  const { state } = ctx
  const r = state.cityRun
  const gate = cityGateOut()
  let cart = null, driver = null, unloaded = false, minY = Infinity, maxY = -Infinity
  const aside = new Set()
  run(ctx, 80, { each: () => {
    const k = r.fx.carts[0]
    if (k && !cart) { cart = k; driver = r.people.get(k.by) }
    if (k) {
      minY = Math.min(minY, k.Y); maxY = Math.max(maxY, k.Y)
      if (k.state === 'unloading') unloaded = true
      // on the box, not in the street
      assert.ok(driver.mode === 'indoors' && driver.door === null && !driver.entity, 'the carter rides')
      for (const w of r.people.values()) if (w.shy && w.mode === 'near' && cheb(w, k) <= 3) aside.add(w.id)
    }
    return !(cart && !k)
  } })
  assert.ok(cart, 'a cart came')
  assert.ok(['carter', 'porter'].includes(driver.person.job))
  assert.ok(Math.abs(minY - gate.Y) <= 1, `in at the north gate (${minY})`)
  assert.ok(maxY >= 220, `down market street to the square (${maxY})`)
  assert.ok(unloaded, 'unloaded at a stall')
  assert.ok(aside.size >= 3, `people stepped out of its way (${aside.size})`)
  assert.equal(r.fx.carts.length, 0, 'and it went back out of sight')
  assert.equal(driver.scene, null)
  assert.ok(driver.mode !== 'indoors' || driver.door !== null, 'the carter is back about his day')
})
const cityGateOut = () => { const { spots } = cityFor(SEED); return { X: spots['gate-N-out'].x, Y: spots['gate-N-out'].y + 160 } }

test('fishers carry crates from the boats and set them down at the fish market', () => {
  const day = 0, seed = 1
  const world = makeWorld(null, { seed })
  const state = freshState()
  const AT = { X: 71, Y: 264 }   // on the wharf by the fish market
  enterWilds(state, world, AT, { buildEntities })
  const T = { clock: 0.205 * DAY_LENGTH, day, view: { w: 20, h: 12 } }
  const hooks = { spawn: buildEntities, clock: () => T.clock, day: () => T.day, viewHalf: () => T.view, sfx: () => {}, hurt: () => {} }
  arriveCity(state, world, hooks, { fresh: true })
  const ctx = { world, state, hooks, T, cues: new Map() }
  assert.ok(scenesForDay(seed, day).has('unload'))
  const fm = cityFor(seed).spots['fish-market'], market = { X: fm.x, Y: fm.y + 160 }
  const carrying = new Map()   // entity -> carrying last frame
  let delivered = 0, setDown = 0, picked = 0
  run(ctx, (0.45 - 0.205) * DAY_LENGTH, { each: () => {
    for (const sc of state.cityRun.scenes) if (sc.id === 'unload') delivered = Math.max(delivered, sc.delivered)
    for (const e of state.entities) {
      if (e.cityKey === undefined || !e.city) continue
      const now = !!e.city.carry, was = carrying.get(e)
      if (was === false && now) picked++
      if (was && !now) {
        // a crate leaves the arms only at the market
        assert.ok(cheb(entityWorld(world, e), market) <= 3, `${e.cityKey} put a crate down in the street at ${JSON.stringify(entityWorld(world, e))}`)
        setDown++
      }
      carrying.set(e, now)
    }
  } })
  assert.ok(picked >= 2, `crates picked up (${picked})`)
  assert.ok(setDown >= 2 && delivered >= 1, `crates set down at the market (${setDown}, ${delivered} in one slot)`)
  assert.equal(state.cityRun.scenes.some(s => s.id === 'unload'), false, 'and the work is over')
  assert.ok(![...state.cityRun.people.values()].some(w => w.entity?.city.carry && !w.scene), 'nobody left holding a crate')
})

// A day on the square, dawn to night (seed 7, day 1: a cart, a busker, tag,
// washing): the runtime casts only what the timetable has on, the scenes
// round the square all happen, and nobody is left held by a scene that ended.
test('a day on the square: the timetable is what runs', () => {
  const day = 1
  const ctx = setup({ frac: 0.18, day })
  const { state } = ctx
  const run_ = state.cityRun
  const cast = new Set(), known = new Set()
  const did = { blows: 0, rings: 0, unloading: false, lit: 0, lifts: 0, listeners: 0, tags: 0, hung: 0 }
  const lineWas = run_.fx.washing.map(l => l.state)
  run(ctx, (0.97 - 0.18) * DAY_LENGTH, { each: () => {
    for (const sc of run_.scenes) {
      if (sc.done) continue
      if (!known.has(sc.key)) {
        known.add(sc.key)
        if (sc.id !== 'gawk') assert.ok(scheduleAt(SEED, day, frac(ctx)).some(s => s.k === sc.slot), `${sc.id} cast in its slot`)
        if (['shift', 'church'].includes(sc.id) || sc.cast.length) cast.add(sc.id)
      }
      if (sc.id === 'lamps') did.lit = Math.max(did.lit, sc.lit)
      if (sc.id === 'busker') did.listeners = Math.max(did.listeners, sc.cast.length - 1)
      if (sc.id === 'tag') did.tags = Math.max(did.tags, sc.tags)
    }
    const fx = run_.fx
    did.blows = Math.max(did.blows, fx.smithy?.blows ?? 0)
    did.rings = Math.max(did.rings, fx.crier?.rings ?? 0)
    did.lifts = fx.flocks[0].lifts
    if (fx.carts.some(k => k.state === 'unloading')) did.unloading = true
    // everyone held is held by a scene still on
    for (const w of run_.people.values()) if (w.scene) assert.ok(run_.scenes.some(s => !s.done && s.key === w.scene.key), `${w.id} held by an ended ${w.scene.id}`)
    // a line in sight changes only when someone has seen to it
    const P = { X: state.player.x + ctx.world.origin.wx * PIECE, Y: state.player.y + ctx.world.origin.wy * PIECE }
    fx.washing.forEach((l, j) => {
      if (l.state === lineWas[j]) return
      lineWas[j] = l.state
      if (cheb(l, P) > run_.nearR) return
      assert.ok(l.by, `line ${j} changed in sight with nobody at it`)
      assert.ok(cheb(entityWorld(ctx.world, entityOf(state, l.by)), l) <= 2.5, 'by someone standing at it')
      did.hung++
    })
  } })
  for (const id of ['talk', 'smith', 'crier', 'lamps', 'church', 'shift', 'pigeons', 'cart', 'busker', 'tag']) assert.ok(cast.has(id), `${id} happened (${[...cast]})`)
  assert.ok(did.blows >= 10, `the smith hammered (${did.blows})`)
  assert.ok(did.rings >= 3, `the crier rang (${did.rings})`)
  assert.ok(did.unloading, 'the cart got to its stall')
  assert.ok(did.lit >= 2, `the lamplighter lit lamps (${did.lit})`)
  assert.ok(did.lifts >= 1, 'the pigeons lifted')
  assert.ok(did.hung >= 1, `washing hung out or taken in by hand (${did.hung})`)
  // by night every lamp is lit, and the washing is in
  assert.ok(run_.lights.lit.every(v => v === 1), 'lamps lit at night')
  assert.ok(run_.fx.washing.every(l => l.state === 'in'), 'washing in at night')
})
