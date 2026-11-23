// The Sampo of Kalevanlinna, part 3 (wilds/city/sampo-end.js, the eagle's
// hook, the two floors the story opens): the words in the giant's belly, the
// Sampo made whole, the great hall, the eagle on the battlements, and the
// player's choice of where it ends up.
//
// Entities are compared by identity with assert.ok(a === b), never deep-equal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stageOf, questKey, namedLines, luckLine, tellingFor, crierItem, passageFor, guardWaves, goneFrom, SAMPO_FLAGS,
  BLOWS, VIPUNEN, BELLY, SAMPO, HERRING, FLOOD, HALL, EAGLE_WON, ENDINGS, FOUNTAIN_REST, LID_TILE } from '../renderer/wilds/city/sampo.js'
import { tickSampo, startTelling } from '../renderer/wilds/city/sampo-run.js'
import { tickSampoEnd, noteSampoSwing, ANVIL_TILE, BLOW_GAP, COUGH_AFTER } from '../renderer/wilds/city/sampo-end.js'
import { linesFor } from '../renderer/wilds/city/lines.js'
import { arriveCity, tickCity } from '../renderer/wilds/city/runtime.js'
import { PROPS } from '../renderer/wilds/city/kit.js'
import { makeWorld, exportWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { buildBuilding } from '../renderer/interior/buildings/index.js'
import { CRACK } from '../renderer/interior/buildings/church.js'
import { BATTLEMENTS } from '../renderer/interior/buildings/castle.js'
import { EAGLE, updateEagle, ensureEagle } from '../renderer/systems/monsters/louhi.js'
import { hurtCreature } from '../renderer/systems/creatures.js'
import { makeItem, addItem } from '../renderer/systems/inventory.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeFeedback, tickFeedback } from '../renderer/systems/feedback.js'
import { isWalkable } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const S = 32
const DT = 0.05
const SEED = 7
const ORDER = ['heard', 'mark', 'smith', 'gift', 'won_sea', 'won_mountain', 'won_marsh', 'sea', 'mountain', 'marsh', 'three', 'jaw',
  'crack', 'words', 'whole', 'forged', 'set', 'turned', 'flood', 'stolen', 'eagle']
// a world told as far as (and with) the named flag
function upTo(flag, seed = SEED) {
  const w = makeWorld(null, { seed })
  for (const f of ORDER) { w.sampo.flags[f] = true; if (f === flag) break }
  return w
}
const church = () => buildBuilding('church', { seed: 3, people: [] })
const castle = () => buildBuilding('castle', { seed: 3, people: [] })

test('the story runs from the words to one of two ends', () => {
  assert.deepEqual([...ORDER, 'castle', 'fountain', 'paid'], SAMPO_FLAGS)
  const stages = ['three', 'words', 'whole', 'stolen', 'eagle'].map(f => stageOf(upTo(f)))
  assert.deepEqual(stages, ['words', 'forge', 'whole', 'eagle', 'choice'])
  for (const end of ['castle', 'fountain']) { const w = upTo('eagle'); w.sampo.flags[end] = true; assert.equal(stageOf(w), end) }
  // who tells what, in order
  assert.equal(tellingFor('named:vaino', upTo('three')).sets, 'crack')
  assert.equal(tellingFor('named:vaino', upTo('marsh')), null)
  assert.equal(tellingFor('named:vaino', upTo('crack')), null)
  assert.equal(tellingFor('named:seppo', upTo('crack')), null, 'no forging without the words')
  assert.equal(tellingFor('named:seppo', upTo('words')).sets, 'whole')
  assert.equal(tellingFor('named:count', upTo('forged')), null)
  assert.equal(tellingFor('named:count', upTo('set')).sets, 'turned')
  assert.equal(tellingFor('named:pohjanen', upTo('set')), null)
  assert.equal(tellingFor('named:pohjanen', upTo('turned')).sets, 'stolen')
  assert.equal(tellingFor('named:pohjanen', upTo('stolen')), null)
  // the jawbone is no gate: Väinö tells with or without his kantele
  const noJaw = upTo('three'); delete noJaw.sampo.flags.jaw
  assert.equal(tellingFor('named:vaino', noJaw).sets, 'crack')
  assert.equal(questKey(upTo('crack')), 'words/jaw,crack')
  assert.ok(namedLines('vaino', questKey(upTo('crack')))[0].includes('crypt'))
  // every stage has its call, short enough to read, and the named have something to say at the ends
  const isLine = l => typeof l === 'string' && l.length > 0 && /[.!?]$/.test(l)
  for (const f of ['words', 'whole', 'stolen', 'eagle']) { const l = crierItem(upTo(f)); assert.ok(l.startsWith('Hear ye! ') && l.length <= 105, l) }
  for (const end of ['castle', 'fountain']) {
    for (const id of ['count', 'seppo', 'vaino']) assert.ok(namedLines(id, end).every(isLine), `${id} at the ${end} end`)
    for (const t of ['cheerful', 'gruff', 'shy', 'chatty']) {
      assert.ok(isLine(luckLine(t, end)) && luckLine(t, end) !== luckLine(t, 'luck'))
      assert.ok(linesFor({ id: 'tf:1', job: 'baker', temperament: t, age: 'adult' }, { night: false, crime: 'calm', quest: end }).includes(luckLine(t, end)))
    }
    assert.ok(crierItem(Object.assign(upTo('eagle'), {}) && (() => { const w = upTo('eagle'); w.sampo.flags[end] = true; return w })()).length <= 105)
  }
  // a save keeps it all
  const w = upTo('eagle'); w.sampo.flags.fountain = true; w.sampo.flags.paid = true
  assert.deepEqual(makeWorld(JSON.parse(JSON.stringify(exportWorld(w)))).sampo.flags, w.sampo.flags)
})

test('the doors the story opens lead where the buildings have floors', () => {
  assert.equal(passageFor(upTo('three'), CRACK), null, 'the crack is shut until Väinö has spoken')
  assert.equal(passageFor(upTo('turned'), BATTLEMENTS), null)
  for (const [b, line, flag] of [[church(), CRACK, 'crack'], [castle(), BATTLEMENTS, 'stolen']]) {
    const p = passageFor(upTo(flag), line)
    assert.ok(p && typeof p.say === 'string')
    const floor = b.floors.find(f => f.id === p.to.floor)
    const stair = floor?.stairs.find(s => s.id === p.to.stair)
    assert.ok(stair?.land, `${p.to.floor}/${p.to.stair} is a stair with a landing`)
    // and the way back comes out on a floor of the same building
    const back = b.floors.find(f => f.id === stair.to.floor)
    assert.ok(back?.stairs.some(s => s.id === stair.to.stair))
    assert.ok(b.floors.some(f => f.shut.some(s => s.line === line)), 'the shut cell is still in the building')
  }
  assert.equal(guardWaves(upTo('turned'), 'castle:stair-guard'), false)
  assert.equal(guardWaves(upTo('stolen'), 'castle:stair-guard'), true)
  assert.equal(guardWaves(upTo('stolen'), 'castle:hall-guard-1'), false)
  assert.deepEqual(goneFrom(upTo('turned')), [])
  assert.deepEqual([...goneFrom(upTo('stolen'))], ['named:pohjanen'])
})

// ---- a floor of a building as the game's state -----------------------------------------

function onFloor(built, id, world) {
  const floor = built.floors.find(f => f.id === id)
  const state = {
    player: { x: 1, y: 3, px: 1 * S + 16, py: 3 * S + 16, hp: 5, maxHp: 5, inventory: [], facing: 'south' },
    entities: [], feedback: makeFeedback(), sfx: { cues: [], muted: false }, map: floor.map,
    cave: { building: { floors: new Map(built.floors.map(f => [f.id, f])), at: id } },
  }
  const log = { travel: [], asks: [], saves: 0 }
  const hooks = {
    spawn: spawns => spawns.flatMap(s => {
      if (s.kind === 'npc') { const n = makeNpc(s); return n ? [n] : [] }
      const e = { type: s.kind === 'floating_pickup' ? 'floating_item' : s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }
      if (s.contents) e.contents = s.contents
      if (s.kind === 'louhi') e.hp = e.maxHp = 18
      return [e]
    }),
    persist: () => { log.saves++ }, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 1 }),
    travel: to => log.travel.push(to), choose: (ask, onYes) => log.asks.push({ ask, onYes }), getState: () => state,
  }
  const put = (x, y) => Object.assign(state.player, { x, y, px: x * S + 16, py: y * S + 16 })
  const tick = (seconds = DT) => { for (let t = 0; t < seconds - 1e-9; t += DT) { tickSampo(state, world, DT, hooks); tickSampoEnd(state, world, DT, hooks); tickFeedback(state.feedback, DT) } }
  const find = tile => { for (let y = 0; y < floor.map.length; y++) for (let x = 0; x < floor.map[y].length; x++) if (floor.map[y][x]?.overlay === tile) return { x, y }; return null }
  const lies = kind => state.entities.filter(e => e.type === 'floating_item' && e.contents?.type === kind)
  return { state, hooks, log, put, tick, find, lies, floor }
}

test('the giant\'s belly: a lit forge and five blows on the anvil, and he sings the words and coughs', () => {
  const world = upTo('crack')
  const c = onFloor(church(), 'belly', world), { state } = c
  const anvil = c.find(ANVIL_TILE)
  assert.ok(anvil, 'the anvil a swallowed smith left')
  const forge = { x: anvil.x - 2, y: anvil.y }
  const cell = state.map[forge.y][forge.x]
  assert.ok(isWalkable(cell.tile, cell) && !cell.overlay, 'room for a fire beside it')
  // hammering a cold anvil does nothing
  c.put(anvil.x, anvil.y + 1)
  noteSampoSwing(state, world, c.hooks)
  assert.equal(state.cave.blows, undefined)
  assert.equal(state.feedback.banner, null)
  c.tick()
  assert.equal(state.feedback.bubble?.text, BELLY.cold)
  // coming beside the forge lights it
  c.put(forge.x, forge.y + 1)
  c.tick()
  const fires = state.entities.filter(e => e.type === 'campfire')
  assert.ok(fires.length === 1 && fires[0].x === forge.x && fires[0].y === forge.y && fires[0].eternal)
  assert.equal(state.feedback.bubble?.text, BELLY.lit)
  c.tick(1)
  assert.equal(state.entities.filter(e => e.type === 'campfire').length, 1, 'lit once')
  // blows: beside the anvil only, and one counted every so often
  c.put(anvil.x - 4, anvil.y + 2)
  noteSampoSwing(state, world, c.hooks)
  assert.equal(state.cave.blows, undefined, 'a swing at nothing is no blow')
  c.put(anvil.x, anvil.y + 1)
  noteSampoSwing(state, world, c.hooks)
  noteSampoSwing(state, world, c.hooks)
  assert.equal(state.cave.blows, 1)
  assert.equal(state.feedback.banner.text, VIPUNEN[0])
  for (let n = 2; n <= BLOWS; n++) {
    c.tick(BLOW_GAP + 0.1)
    assert.equal(world.sampo.flags.words, undefined, `not at ${n - 1} blows`)
    noteSampoSwing(state, world, c.hooks)
    assert.equal(state.feedback.banner.text, VIPUNEN[n - 1])
  }
  assert.equal(world.sampo.flags.words, true)
  assert.equal(stageOf(world), 'forge')
  assert.equal(state.feedback.bubble.text, BELLY.words)
  assert.equal(VIPUNEN.length, BLOWS)
  // he coughs the player out into the crypt
  c.tick(COUGH_AFTER - 0.5)
  assert.deepEqual(c.log.travel, [])
  c.tick(1)
  assert.deepEqual(c.log.travel, [{ floor: 'crypt', stair: 'up' }])
  assert.equal(state.feedback.banner.text, BELLY.out)
  // back down afterwards: the anvil rings and nobody answers
  const again = onFloor(church(), 'belly', world)
  again.put(forge.x, forge.y + 1); again.tick()
  again.put(anvil.x, anvil.y + 1)
  noteSampoSwing(again.state, world, again.hooks)
  assert.equal(again.state.feedback.banner, null)
  assert.deepEqual(again.log.travel, [])
})

test('Seppo makes it whole when he hears the words, and it is the player\'s to carry', () => {
  const world = upTo('words')
  const seppo = makeNpc({ species: 'townsfolk', id: 'named:seppo', x: 5, y: 3 })
  const c = onFloor(castle(), 'cells', world), { state } = c   // any floor without the story's furniture: a street would do
  state.entities.push(seppo)
  c.put(seppo.x, seppo.y + 1)
  assert.equal(startTelling(state, seppo, world), true)
  c.tick(1)
  assert.ok(!state.player.inventory.some(i => i.kind === SAMPO), 'not before he has finished')
  c.tick(60)
  assert.equal(world.sampo.flags.whole, true)
  assert.equal(world.sampo.flags.forged, true)
  assert.deepEqual(state.player.inventory.map(i => i.kind), [SAMPO])
  c.tick(2)
  assert.equal(state.player.inventory.length, 1, 'one Sampo')
  assert.equal(stageOf(world), 'whole')
})

test('the great hall: under the lid, the Count\'s turn, herring on the floor, and Louhi away with it', () => {
  const world = upTo('forged')
  const c = onFloor(castle(), 'hall', world), { state } = c
  const lid = c.find(LID_TILE)
  const count = makeNpc({ species: 'townsfolk', id: 'named:count', x: lid.x - 1, y: lid.y })
  state.entities.push(count)
  addItem(state.player, makeItem(SAMPO))
  c.put(lid.x - 1, lid.y + 1)   // before the throne: cornerwise to the lid
  c.tick(0.5)
  assert.equal(world.sampo.flags.set, undefined)
  c.put(lid.x, lid.y + 1)
  c.tick()
  assert.equal(world.sampo.flags.set, true)
  assert.ok(!state.player.inventory.length, 'out of the sack')
  assert.equal(state.feedback.bubble.text, HALL.set)
  // the Count takes his turn without being asked, when the thought has passed
  for (let t = 0; t < 20 && !state.telling; t += DT) c.tick()
  assert.equal(state.telling?.id, 'named:count')
  for (let t = 0; t < 60 && !world.sampo.flags.turned; t += DT) c.tick()
  c.tick()
  assert.equal(world.sampo.flags.turned, true)
  assert.equal(world.sampo.flags.flood, true)
  const herring = c.lies(HERRING)
  assert.equal(herring.length, FLOOD)
  assert.equal(new Set(herring.map(e => `${e.x},${e.y}`)).size, FLOOD, 'each on its own cell')
  for (const h of herring) { const cell = state.map[h.y][h.x]; assert.ok(isWalkable(cell.tile, cell) && !cell.overlay) }
  // Granny Pohjanen comes with her thanks
  c.tick(0.5)
  assert.equal(state.entities.filter(e => e.id === 'named:pohjanen').length, 1)
  assert.equal(world.sampo.flags.stolen, undefined)
  for (let t = 0; t < 80 && !world.sampo.flags.stolen; t += DT) c.tick()
  assert.equal(world.sampo.flags.stolen, true)
  assert.equal(state.entities.filter(e => e.id === 'named:pohjanen').length, 1, 'she stays for her last word')
  c.tick(10)
  assert.equal(state.entities.filter(e => e.id === 'named:pohjanen').length, 0, 'gone')
  c.tick(0)
  assert.equal(state.feedback.bubble?.text ?? HALL.up, HALL.up)
  assert.equal(stageOf(world), 'eagle')
  assert.equal(c.lies(HERRING).length, FLOOD, 'the herring stays')
  assert.equal(c.log.asks.length, 0)
  // walked out before she had done: she is there again on coming back
  const w2 = upTo('flood'), d = onFloor(castle(), 'hall', w2)
  d.state.entities.push(makeNpc({ species: 'townsfolk', id: 'named:count', x: lid.x - 1, y: lid.y }))
  d.put(lid.x, lid.y + 2)
  d.tick(0.2)
  assert.equal(d.state.entities.filter(e => e.id === 'named:pohjanen').length, 1)
  assert.equal(d.lies(HERRING).length, 0, 'the flood once')
})

test('the eagle: out of reach aloft, she marks her spot, stoops on it, and can be struck where she lands', () => {
  const state = {
    player: { x: 10, y: 8, px: 10 * S + 16, py: 8 * S + 16, hp: 9, maxHp: 9, inventory: [] }, entities: [], feedback: makeFeedback(),
    sfx: { cues: [], muted: false }, map: Array.from({ length: 13 }, () => Array.from({ length: 21 }, () => ({ tile: 1 }))),
  }
  const e = { type: 'louhi', x: 10, y: 4, px: 10 * S + 16, py: 4 * S + 16, hp: 18, maxHp: 18 }
  const run = (seconds, each) => { for (let t = 0; t < seconds - 1e-9; t += DT) { updateEagle(e, state, DT); each?.() } }
  run(DT)
  assert.equal(e.wing.state, 'aloft')
  assert.equal(hurtCreature(state, e, 5).absorbed, true)
  run(EAGLE.aloft)
  assert.equal(e.wing.state, 'stoop')
  const aim = { ...e.wing.aim }
  assert.ok(Math.abs(aim.px - state.player.px) < 1 && Math.abs(aim.py - state.player.py) < 1, 'where the player stood')
  // stepping aside while she hangs: she comes down on the empty spot
  state.player.x = 16; state.player.px = 16 * S + 16
  run(EAGLE.stoop + EAGLE.dive + 0.1)
  assert.equal(e.wing.state, 'down')
  assert.equal(state.player.hp, 9, 'missed')
  assert.ok(Math.hypot(e.px - aim.px, e.py - aim.py) < S, 'landed where she aimed')
  assert.ok(e.sink < 0.5)
  assert.equal(hurtCreature(state, e, 5).absorbed, false)
  assert.equal(e.hp, 13)
  run(EAGLE.down + 0.1)
  assert.equal(e.wing.state, 'aloft')
  // standing still is hit once, and thrown
  run(EAGLE.aloft + EAGLE.stoop + EAGLE.dive + 0.2)
  assert.equal(state.player.hp, 9 - EAGLE.strike)
  // she keeps inside the floor's edge, whatever she aims at
  ensureEagle(e).state = 'dive'; e.wing.t = 5; e.wing.aim = { px: -500, py: -500 }; e.wing.hit = true
  run(3)
  assert.ok(e.px >= S && e.py >= S)
  e.wing.state = 'down'; e.hp = 2
  assert.ok(hurtCreature(state, e, 2).killed && state.creatureKills.louhi)
})

test('the battlements: the eagle until she is beaten, then the Sampo where she fell', () => {
  const world = upTo('stolen')
  const c = onFloor(castle(), 'battlements', world), { state } = c
  c.put(3, 6)
  c.tick()
  const eagle = state.entities.filter(e => e.type === 'louhi')
  assert.equal(eagle.length, 1)
  c.tick(1)
  assert.equal(state.entities.filter(e => e.type === 'louhi').length, 1, 'one eagle')
  assert.equal(world.sampo.flags.eagle, undefined)
  state.creatureKills = { louhi: true }
  state.entities = state.entities.filter(e => e.type !== 'louhi')
  c.tick()
  assert.equal(world.sampo.flags.eagle, true)
  assert.equal(state.feedback.bubble.text, EAGLE_WON)
  assert.equal(c.lies(SAMPO).length, 1)
  c.tick(1)
  assert.equal(c.lies(SAMPO).length, 1)
  assert.equal(state.entities.filter(e => e.type === 'louhi').length, 0, 'beaten for good')
  // lost on the way down: up here again on the next coming
  const d = onFloor(castle(), 'battlements', world)
  d.tick()
  assert.equal(d.lies(SAMPO).length, 1)
  addItem(d.state.player, makeItem(SAMPO)); d.state.entities.length = 0
  d.tick(1)
  assert.equal(d.lies(SAMPO).length, 0)
  // before she has flown there is nothing up here
  const early = onFloor(castle(), 'battlements', upTo('turned'))
  early.tick(1)
  assert.equal(early.state.entities.length, 0)
})

test('the castle end: asked at the lid, once a coming; yes sets it there for good, and the Count pays', () => {
  const world = upTo('eagle')
  const c = onFloor(castle(), 'hall', world), { state } = c
  const lid = c.find(LID_TILE)
  const count = makeNpc({ species: 'townsfolk', id: 'named:count', x: lid.x - 1, y: lid.y })
  state.entities.push(count)
  c.put(lid.x, lid.y + 1)
  c.tick(0.5)
  assert.equal(c.log.asks.length, 0, 'nothing to ask without the Sampo')
  c.put(lid.x, lid.y + 4)
  addItem(state.player, makeItem(SAMPO))
  c.tick(0.5)
  assert.equal(c.log.asks.length, 0)
  c.put(lid.x, lid.y + 1)
  c.tick(1)
  assert.equal(c.log.asks.length, 1, 'asked once while standing there')
  assert.deepEqual(c.log.asks[0].ask, ENDINGS.castle.ask)
  // "not yet": nothing changes, and coming up again asks again
  c.put(lid.x, lid.y + 4); c.tick()
  c.put(lid.x, lid.y + 1); c.tick()
  assert.equal(c.log.asks.length, 2)
  assert.equal(world.sampo.flags.castle, undefined)
  c.log.asks[1].onYes()
  assert.equal(world.sampo.flags.castle, true)
  assert.equal(world.sampo.flags.paid, true)
  assert.equal(stageOf(world), 'castle')
  assert.ok(!state.player.inventory.some(i => i.kind === SAMPO))
  assert.deepEqual(state.feedback.toasts, [ENDINGS.castle.toast])
  assert.equal(state.entities.filter(e => e.type === 'floating_item').length, ENDINGS.castle.loot)
  assert.equal(state.feedback.bubble.text, ENDINGS.castle.said)
  assert.ok(c.log.saves >= 1)
  c.put(lid.x, lid.y + 4); c.tick()
  c.put(lid.x, lid.y + 1); c.tick()
  assert.equal(c.log.asks.length, 2, 'settled: never asked again')
})

test('the fountain end: asked on the square; yes, and the fountain runs, the town says so, and resting by it heals', () => {
  const world = upTo('eagle')
  const state = {
    player: { x: 0, y: 0, px: 0, py: 0, hp: 2, maxHp: 5, facing: 'south', inventory: [] }, entities: [], projectiles: [], zones: [],
    fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(),
    caveInstances: {}, sfx: { cues: [], muted: false },
  }
  const buildEntities = spawns => spawns.flatMap(s => {
    if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
    return [{ type: s.kind === 'floating_pickup' ? 'floating_item' : s.kind, contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
  })
  enterWilds(state, world, { X: 79, Y: 236 }, { buildEntities })   // three steps south of the fountain
  const cityHooks = { spawn: buildEntities, clock: () => 0.5 * DAY_LENGTH, day: () => 0, viewHalf: () => ({ w: 20, h: 12 }), sfx: () => {}, hurt: () => {} }
  arriveCity(state, world, cityHooks, { fresh: true })
  const asks = []
  const hooks = { spawn: buildEntities, persist: () => {}, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 1 }), travel: () => {}, choose: (ask, onYes) => asks.push({ ask, onYes }), getState: () => state }
  const tick = (seconds = DT) => { for (let t = 0; t < seconds - 1e-9; t += DT) { tickSampoEnd(state, world, DT, hooks); tickCity(state, world, DT, cityHooks); tickFeedback(state.feedback, DT); state.sfx.cues = [] } }
  const basin = () => state.map[state.player.y - (state.player.y - fy)][fx]
  const fx = state.player.x, fy = state.player.y - 3
  assert.equal(state.map[fy][fx].overlay, PROPS.fountain.empty, 'the dry fountain')
  assert.ok(state.cityRun.people.get('named:pohjanen').out, 'Granny Pohjanen keeps no stall once she has flown')
  addItem(state.player, makeItem(SAMPO))
  tick(0.3)
  assert.equal(asks.length, 0, 'not from three steps off')
  Object.assign(state.player, { y: fy + 2, py: (fy + 2) * S + 16 })
  tick(0.3)
  assert.equal(asks.length, 1)
  assert.deepEqual(asks[0].ask, ENDINGS.fountain.ask)
  asks[0].onYes()
  assert.equal(world.sampo.flags.fountain, true)
  assert.equal(stageOf(world), 'fountain')
  assert.ok(!state.player.inventory.some(i => i.kind === SAMPO))
  assert.deepEqual(state.feedback.toasts, [ENDINGS.fountain.toast])
  tick()
  assert.equal(basin().overlay, PROPS.fountain.full, 'the fountain runs')
  assert.equal(state.cityRun.quest, 'fountain/jaw')
  const anyone = [...state.cityRun.people.values()].find(w => w.person.id.startsWith('tf:') && w.person.age !== 'child' && w.person.job !== 'watch')
  assert.ok(anyone.lines.includes(luckLine(anyone.person.temperament, 'fountain')), 'the town talks of it')
  // resting by it
  const hp = state.player.hp
  tick(FOUNTAIN_REST.every + 0.2)
  assert.equal(state.player.hp, hp + 1)
  Object.assign(state.player, { y: fy + 8, py: (fy + 8) * S + 16 })
  tick(FOUNTAIN_REST.every * 2)
  assert.equal(state.player.hp, hp + 1, 'not from across the square')
})
