// The Lalli tale played through the runner in a real Wilds window: Kerttu's
// sausage, the pint in the larder, the piper's flute, eight mice led off the
// pier, Lalli down from his pine and home.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arriveTales, tickTales, storyEpisode } from '../renderer/wilds/tale-run.js'
import { MICE } from '../renderer/wilds/tale-lalli.js'
import { makeWorld, getPiece } from '../renderer/wilds/world.js'
import { enterWilds, tickWilds } from '../renderer/wilds/session.js'
import { PIECE } from '../renderer/wilds/layout.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeCampfire } from '../renderer/systems/campfire.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { makeItem, itemFromContents } from '../renderer/systems/inventory.js'
import { playTune, tickTune, hasFlute, TUNE_SECONDS } from '../renderer/systems/tune.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
function buildEntities(spawns) {
  return spawns.flatMap(s => {
    const at = { x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }
    if (s.kind === 'npc') { const n = makeNpc(s); return n ? [Object.assign(n, at)] : [] }
    if (s.kind === 'floating_pickup') return [{ type: 'floating_item', contents: s.contents, ...at, progress: 1 }]
    if (s.kind === 'campfire') return [makeCampfire(s.x, s.y, { eternal: true })]
    return [{ type: s.kind, ...at }]
  })
}
// A world whose home village tells the Lalli tale, its pine at piece (1, 1).
function setup({ flags = {}, paid = [], place = '1,1' } = {}) {
  const world = makeWorld(null, { seed: 3 })
  world.tales.set('0,0', { id: 'lalli', flags: { ...flags }, place, n: 1, nSide: 0, done: false })
  world.places.set(place, { id: 'lalli', village: '0,0', done: false })
  for (const k of paid) world.paid.add(k)
  const state = {
    player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10, talents: [], inventory: [], maxInventory: 20, weapon: null },
    entities: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {},
  }
  const calls = { persist: 0 }
  const hooks = {
    getState: () => state, spawn: spawns => buildEntities(spawns),
    persist: () => { calls.persist++ }, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 4 }),
    save: () => ({ clock: 0 }), isNight: () => false, grantTalent: () => {},
  }
  enterWilds(state, world, { wx: 0, wy: 0 }, { buildEntities })
  arriveTales(state, world, hooks, { fresh: true })
  const rec = world.tales.get('0,0')
  return { world, state, hooks, rec, flags: rec.flags, calls }
}
const toWin = (world, wx, wy, p) => ({ x: (wx - world.origin.wx) * PIECE + p.x, y: (wy - world.origin.wy) * PIECE + p.y })
const point = (world, label) => toWin(world, 1, 1, getPiece(world, 1, 1).points.find(q => q.label === label))
const vpoint = (world, label) => toWin(world, 0, 0, getPiece(world, 0, 0).villagePoints.find(q => q.label === label))
const put = (state, c, dx = 0, dy = 0) => { const p = state.player; p.x = c.x + dx; p.y = c.y + dy; p.px = p.x * S + 16; p.py = p.y * S + 16 }
const move = (e, c) => { e.x = c.x; e.y = c.y; e.px = c.x * S + 16; e.py = c.y * S + 16 }
const who = (state, species) => state.entities.filter(e => e.type === 'npc' && e.species === species && e.taleKey === 'tale:0,0')
const mice = state => who(state, 'mouse')
const has = (state, kind) => state.player.inventory.find(i => i.kind === kind)?.count ?? 0
const give = (state, kind, n = 1) => state.player.inventory.push(makeItem(kind, n))
const flute = () => itemFromContents({ type: 'weapon', ...weaponContents('flute') })
const pickups = (state, weaponType) => state.entities.filter(e => e.type === 'floating_item' && e.contents?.weaponType === weaponType)
const tick = (t, dt = 0.016) => { tickTune(t.state, dt); tickTales(t.state, t.world, dt, t.hooks) }
function shift(t, dx, dy) {
  const p = t.state.player
  p.x = dx > 0 ? 170 : dx < 0 ? 60 : 120; p.y = dy > 0 ? 170 : dy < 0 ? 60 : 120
  p.px = p.x * S + 16; p.py = p.y * S + 16
  const { recentred } = tickWilds(t.state, t.world, 0.016, { buildEntities })
  assert.deepEqual(recentred, { dx, dy })
  arriveTales(t.state, t.world, t.hooks)
}
// Play at the pier's end and bring `n` mice to the plank beside it, one tick each.
function drown(t, n) {
  const end = point(t.world, 'pier end')
  put(t.state, end)
  for (let i = 0; i < n; i++) {
    playTune(t.state)
    move(mice(t.state)[0], { x: end.x - 1, y: end.y })
    tick(t)
  }
}

test('everyone is where the tale puts them: Lalli up his pine, eight mice under it, the piper in camp, Kerttu by her door', () => {
  const t = setup()
  const top = point(t.world, 'lalli tree'), foot = point(t.world, 'tree foot'), camp = point(t.world, 'piper camp'), k = vpoint(t.world, 'kerttu')
  const [lalli] = who(t.state, 'lalli_treed')
  assert.deepEqual([lalli.x, lalli.y], [top.x, top.y])
  assert.equal(who(t.state, 'lalli_treed').length, 1)
  assert.equal(mice(t.state).length, MICE)
  for (const m of mice(t.state)) {
    assert.ok(Math.max(Math.abs(m.x - foot.x), Math.abs(m.y - foot.y)) <= 3, `a mouse at ${m.x},${m.y}`)
    assert.equal(t.state.map[m.y][m.x].tile, TILE.FLOOR)
  }
  assert.equal(new Set(mice(t.state).map(m => `${m.x},${m.y}`)).size, MICE, 'two mice on one cell')
  assert.deepEqual(who(t.state, 'piper').map(e => [e.x, e.y]), [[camp.x, camp.y]])
  assert.deepEqual(who(t.state, 'kerttu').map(e => [e.x, e.y]), [[k.x, k.y]])
  // a second arrival makes nobody twice
  arriveTales(t.state, t.world, t.hooks)
  assert.deepEqual([who(t.state, 'lalli_treed').length, mice(t.state).length, who(t.state, 'piper').length, who(t.state, 'kerttu').length], [1, MICE, 1, 1])
})

test('they speak for their village: Kerttu says exactly where, the piper names his price', () => {
  const t = setup()
  const lines = t.state.villageLines['0,0']
  assert.ok(lines.kerttu.some(l => /a pine/.test(l) && !l.includes('{')), 'Kerttu does not say where')
  assert.ok(lines.piper.some(l => /beer/.test(l)))
  assert.equal(who(t.state, 'piper')[0].linesKey, '0,0')
})

test('Kerttu makes a sausage of two cuts of raw meat, and another if it is lost', () => {
  const t = setup()
  put(t.state, vpoint(t.world, 'kerttu'), 1, 0)
  give(t.state, 'meat', 1)
  tick(t)
  assert.equal(has(t.state, 'sausage'), 0, 'one cut is not enough')
  assert.equal(has(t.state, 'meat'), 1)
  t.state.player.inventory[0].count = 3
  tick(t)
  assert.equal(has(t.state, 'sausage'), 1)
  assert.equal(has(t.state, 'meat'), 1)
  assert.equal(t.flags.sausage_made, true)
  t.state.player.inventory[0].count = 5
  tick(t)
  assert.equal(has(t.state, 'sausage'), 1, 'she does not make a second while the first is carried')
  t.state.player.inventory = [makeItem('meat', 2)]
  tick(t)
  assert.equal(has(t.state, 'sausage'), 1, 'a lost sausage is made again')
})

test('with no room in the sack she keeps the meat where it is', () => {
  const t = setup()
  put(t.state, vpoint(t.world, 'kerttu'), 1, 0)
  t.state.player.maxInventory = 1
  give(t.state, 'meat', 3)
  tick(t)
  assert.equal(has(t.state, 'meat'), 3)
  assert.equal(has(t.state, 'sausage'), 0)
})

test('cooked meat is not what she asked for, and nothing happens away from her', () => {
  const t = setup()
  give(t.state, 'cooked_meat', 4)
  put(t.state, vpoint(t.world, 'kerttu'), 1, 0)
  tick(t)
  assert.equal(has(t.state, 'sausage'), 0)
  t.state.player.inventory = [makeItem('meat', 2)]
  put(t.state, vpoint(t.world, 'kerttu'), 4, 0)
  tick(t)
  assert.equal(has(t.state, 'sausage'), 0)
})

test("the pint is in Lalli's larder: his door opens on the tale's room", () => {
  const t = setup()
  const piece = getPiece(t.world, 0, 0)
  const door = piece.doors.find(d => d.story)
  const ep = storyEpisode(t.world, door)
  assert.deepEqual(ep.houses["Lalli's house"].pickups, [{ type: 'beer' }])
  assert.equal(storyEpisode(t.world, piece.doors.find(d => !d.story)), null)
  // a door of that name out at the pine is not his house
  assert.equal(storyEpisode(t.world, { ...door, label: `house:wilds:${PIECE + 30},${PIECE + 30}` }), null)
})

test('the piper trades his flute for the pint and the sausage together, and not for one of them', () => {
  const t = setup()
  put(t.state, point(t.world, 'piper camp'), 1, 0)
  give(t.state, 'beer')
  tick(t)
  assert.ok(!t.flags.flute_given)
  assert.equal(has(t.state, 'beer'), 1, 'he took the pint and gave nothing')
  give(t.state, 'sausage')
  tick(t)
  assert.equal(t.flags.flute_given, true)
  assert.equal(has(t.state, 'beer') + has(t.state, 'sausage'), 0)
  assert.equal(hasFlute(t.state.player), true)
  assert.ok(t.calls.persist >= 1)
})

test('with a full sack the flute lies at the player\'s feet', () => {
  const t = setup()
  put(t.state, point(t.world, 'piper camp'), 1, 0)
  t.state.player.maxInventory = 2
  give(t.state, 'beer'); give(t.state, 'sausage'); give(t.state, 'lumber'); give(t.state, 'potion')
  t.state.player.maxInventory = 2   // lumber and potion fill it once the trade empties two slots
  tick(t)
  assert.equal(t.flags.flute_given, true)
  assert.ok(hasFlute(t.state.player) || pickups(t.state, 'flute').length === 1)
})

test('a flute lost before Lalli is down is handed over again; one in the hand is not', () => {
  const t = setup({ flags: { flute_given: true } })
  put(t.state, point(t.world, 'piper camp'), 1, 0)
  tick(t)
  assert.equal(hasFlute(t.state.player), true, 'the piper let the tale die with a lost flute')
  const n = t.state.player.inventory.length
  tick(t)
  assert.equal(t.state.player.inventory.length, n, 'a second flute')
})

test('a mouse brought to the pier\'s end while the tune carries goes into the pond; without a tune it does not', () => {
  const t = setup({ flags: { flute_given: true } })
  const end = point(t.world, 'pier end')
  put(t.state, end)
  const m = mice(t.state)[0]
  move(m, { x: end.x - 1, y: end.y })
  tick(t)
  assert.equal(mice(t.state).length, MICE, 'no tune, no swim')
  playTune(t.state)
  tick(t)
  assert.equal(mice(t.state).length, MICE - 1)
  assert.equal(t.flags.mice, 1)
  assert.ok(!t.state.entities.includes(m))
  assert.ok(t.state.sfx.cues.some(c => c.name === 'sink'))
})

test('a mouse elsewhere on the bank is not drowned by a tune', () => {
  const t = setup({ flags: { flute_given: true } })
  const bank = point(t.world, 'pier bank')
  put(t.state, bank)
  playTune(t.state)
  move(mice(t.state)[0], { x: bank.x - 1, y: bank.y })
  tick(t)
  assert.equal(mice(t.state).length, MICE)
})

test('all eight in the pond: Lalli climbs down, his axe lies at the foot of the pine, the tale is done', () => {
  const t = setup({ flags: { flute_given: true } })
  drown(t, MICE - 1)
  assert.equal(t.flags.mice, MICE - 1)
  assert.equal(t.rec.done, false)
  assert.equal(who(t.state, 'lalli_treed').length, 1)
  drown(t, 1)
  assert.equal(t.flags.lalli_down, true)
  assert.equal(t.rec.done, true)
  assert.equal(who(t.state, 'lalli_treed').length, 0)
  const foot = point(t.world, 'tree foot')
  const [down] = who(t.state, 'lalli').filter(e => e.role !== 'missing')
  assert.ok(down && Math.max(Math.abs(down.x - foot.x), Math.abs(down.y - foot.y)) <= 2, 'nobody climbed down')
  const [axe] = pickups(t.state, 'lalli_axe')
  assert.ok(axe && Math.max(Math.abs(axe.x - foot.x), Math.abs(axe.y - foot.y)) <= 2, 'no axe at the foot of the pine')
  assert.deepEqual(axe.contents, { type: 'weapon', ...weaponContents('lalli_axe') })
  assert.ok(t.world.paid.has('lalli'))
  assert.equal(t.world.places.get('1,1').done, true)
  // and he is home, as himself, since his village is in the window
  assert.equal(who(t.state, 'lalli').filter(e => e.role === 'missing').length, 1)
  assert.ok(t.state.villageLines['0,0'].kerttu.some(l => /home/.test(l)))
})

test('a world that has had the axe pays the next Lalli village in loot', () => {
  const t = setup({ flags: { flute_given: true }, paid: ['lalli'] })
  drown(t, MICE)
  assert.equal(t.rec.done, true)
  assert.equal(pickups(t.state, 'lalli_axe').length, 0)
  assert.equal(t.state.entities.filter(e => e.type === 'floating_item' && e.contents?.type === 'potion').length, 2)
})

test('killing mice finishes nothing: more come out from under the roots', () => {
  const t = setup({ flags: { flute_given: true } })
  for (const m of mice(t.state)) m.hp = 0
  t.state.entities = t.state.entities.filter(e => !(e.species === 'mouse' && e.hp <= 0))
  tick(t)
  assert.equal(mice(t.state).length, MICE)
  assert.ok(!t.flags.mice)
  assert.equal(t.rec.done, false)
  assert.equal(who(t.state, 'lalli_treed').length, 1)
})

test('Lalli cannot be hurt out of his tree, and the piper and Kerttu outlive a blow', () => {
  const t = setup()
  for (const species of ['lalli_treed', 'piper', 'kerttu']) who(t.state, species)[0].hp = 1
  tick(t)
  for (const species of ['lalli_treed', 'piper', 'kerttu']) { const e = who(t.state, species)[0]; assert.equal(e.hp, e.maxHp, species) }
})

test('the place leaving and coming back: the mice still to lead are there, the drowned ones are not', () => {
  const t = setup({ flags: { flute_given: true } })
  drown(t, 3)
  shift(t, -1, 0)
  assert.equal(mice(t.state).length, 0)
  assert.equal(who(t.state, 'piper').length, 0)
  shift(t, 1, 0)
  assert.equal(mice(t.state).length, MICE - 3)
  assert.equal(who(t.state, 'lalli_treed').length, 1)
  assert.equal(who(t.state, 'piper').length, 1)
  assert.equal(who(t.state, 'kerttu').length, 1)
})

test('after it is done: nobody up the pine on a later visit, an axe left lying is still there, one taken is not laid again', () => {
  const t = setup({ flags: { flute_given: true } })
  drown(t, MICE)
  shift(t, -1, 0)
  shift(t, 1, 0)
  assert.equal(who(t.state, 'lalli_treed').length, 0)
  assert.equal(mice(t.state).length, 0)
  assert.equal(pickups(t.state, 'lalli_axe').length, 1, 'the axe was lost with the piece')
  assert.equal(who(t.state, 'lalli').filter(e => e.role === 'missing').length, 1)
  // taken: gone from the ground while its place is here
  t.state.entities = t.state.entities.filter(e => e.contents?.weaponType !== 'lalli_axe')
  tick(t)
  assert.equal(t.flags.axe_taken, true)
  shift(t, -1, 0)
  shift(t, 1, 0)
  assert.equal(pickups(t.state, 'lalli_axe').length, 0)
})

test('a tune played where no tale is does nothing but lead mice', () => {
  const t = setup({ place: '2,2' })
  playTune(t.state)
  for (let i = 0; i < 10; i++) tick(t, TUNE_SECONDS / 8)
  assert.ok(!t.flags.mice)
  assert.equal(t.rec.done, false)
})

test("inside Lalli's house the pint stands on the larder floor, in a house with nothing in it that bites", async () => {
  const fs = await import('node:fs')
  const { generateInterior } = await import('../renderer/systems/interior.js')
  const { INTERIOR_CONFIG, attachPickups, storyStructures } = await import('../renderer/systems/houses.js')
  const structures = JSON.parse(fs.readFileSync(new URL('../renderer/data/structures.json', import.meta.url), 'utf8'))
  const t = setup()
  const door = getPiece(t.world, 0, 0).doors.find(d => d.story)
  const ep = storyEpisode(t.world, door)
  for (let i = 0; i < 20; i++) {
    const { map, entitySpawns } = generateInterior(INTERIOR_CONFIG[door.tier], { structures: storyStructures(structures, ep, door.story) })
    const spawns = attachPickups(entitySpawns, ep.houses[door.story].pickups)
    const pints = spawns.filter(s => s.kind === 'floating_pickup' && s.contents.type === 'beer')
    assert.equal(pints.length, 1, 'no pint in the larder')
    assert.notEqual(map[pints[0].y][pints[0].x].tile, TILE.WALL)
    assert.ok(!spawns.some(s => s.kind === 'monster'), 'vermin in a village house')
  }
})
