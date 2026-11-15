// Tales running in a real Wilds window: the Adventure quest modules driven by
// wilds/tale-run.js. The window is built by session.js as in the game; only
// buildEntities is a stand-in, making the few kinds a tale needs.
import { test, before } from 'node:test'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { arriveTales, tickTales, storyEpisode } from '../renderer/wilds/tale-run.js'
import { EPISODE_MODULES } from '../renderer/systems/episodes/index.js'
import { TALES } from '../renderer/data/tales.js'
import { fillLines } from '../renderer/wilds/tales.js'
import { makeWorld, getPiece, recordFor, exportWorld } from '../renderer/wilds/world.js'
import { enterWilds, tickWilds, snapshotWilds, wildsRespawn } from '../renderer/wilds/session.js'
import { PIECE, villagesNear } from '../renderer/wilds/layout.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef } from '../renderer/systems/monsters.js'
import { makeHirvi, FLUSH_TILES } from '../renderer/systems/monsters/hirvi.js'
import { makeNakki } from '../renderer/systems/monsters/nakki.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeCampfire } from '../renderer/systems/campfire.js'
import { RING } from '../renderer/systems/quests/pass.js'
import { TILE } from '../renderer/systems/entities.js'
import { hurtCreature } from '../renderer/systems/creatures.js'
import { harvest } from '../renderer/systems/lumber.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { hasTalent } from '../renderer/systems/talents.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const KIVIHIISI_DEF = JSON.parse(fs.readFileSync('renderer/data/monsters/kivihiisi.json', 'utf8'))
const FAKE_RIG = { PARAM_SCHEMA: [], drawMonster: () => {}, hitHalf: () => 12 }
before(async () => { clearMonsters(); await registerMonsters([KIVIHIISI_DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }) })

function buildEntities(spawns) {
  return spawns.flatMap(s => {
    const at = { x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }
    if (s.kind === 'npc') { const n = makeNpc(s); return n ? [Object.assign(n, at)] : [] }
    if (s.kind === 'hirvi') return [Object.assign(makeHirvi(s.x, s.y), at)]
    if (s.kind === 'nakki') return [Object.assign(makeNakki(s.x, s.y), at)]
    if (s.kind === 'kivihiisi') return [Object.assign(makeMonsterFromDef('kivihiisi', s.x, s.y), at)]
    if (s.kind === 'floating_pickup') return [{ type: 'floating_item', contents: s.contents, ...at, progress: 1 }]
    if (s.kind === 'campfire') return [makeCampfire(s.x, s.y, { eternal: true })]
    return [{ type: s.kind, ...at }]
  })
}

// A world whose home village has tale `id` with its place already at `place`.
function setup(id, place, { flags = {}, seed = 3, paid = [] } = {}) {
  const world = makeWorld(null, { seed })
  world.tales.set('0,0', { id, flags: { ...flags }, place, n: 1, nSide: 0, done: false })
  world.places.set(place, { id, village: '0,0', done: false })
  for (const k of paid) world.paid.add(k)
  const state = {
    player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10, talents: [], inventory: [], maxInventory: 20, weapon: null },
    entities: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {},
  }
  const calls = { persist: 0, talents: [] }
  const save = { clock: 0 }
  const hooks = {
    getState: () => state, spawn: (spawns, depth) => buildEntities(spawns, state.map, depth),
    persist: () => { calls.persist++ }, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 4 }),
    save: () => save, isNight: () => false, grantTalent: id => { calls.talents.push(id); (state.player.talents ??= []).push(id) },
  }
  enterWilds(state, world, { wx: 0, wy: 0 }, { buildEntities })
  arriveTales(state, world, hooks, { fresh: true })
  const rec = world.tales.get('0,0')
  return { world, state, hooks, rec, flags: rec.flags, calls, save }
}
const [pwx, pwy] = [1, 1]
// A named point of the place at (1, 1), in window tiles.
const point = (world, label, wx = pwx, wy = pwy) => {
  const p = getPiece(world, wx, wy).points.find(q => q.label === label)
  return { x: (wx - world.origin.wx) * PIECE + p.x, y: (wy - world.origin.wy) * PIECE + p.y }
}
const put = (state, c, dx = 0, dy = 0) => { const p = state.player; p.x = c.x + dx; p.y = c.y + dy; p.px = p.x * S + 16; p.py = p.y * S + 16 }
// Step the window one piece by walking the player past its margin.
function shift(t, dx, dy) {
  const p = t.state.player
  p.x = dx > 0 ? 170 : dx < 0 ? 60 : 120; p.y = dy > 0 ? 170 : dy < 0 ? 60 : 120
  p.px = p.x * S + 16; p.py = p.y * S + 16
  const { recentred } = tickWilds(t.state, t.world, 0.016, { buildEntities })
  assert.deepEqual(recentred, { dx, dy })
  arriveTales(t.state, t.world, t.hooks)
}
const elks = state => state.entities.filter(e => e.type === 'hirvi')
const villageElder = state => state.entities.find(e => e.type === 'npc' && e.species === 'elder' && e.wildsKey === '0,0')
const pickups = state => state.entities.filter(e => e.type === 'floating_item')

test('the elk beds at the first wallow when its wood enters the window', () => {
  const t = setup('elk', '1,1')
  const w1 = point(t.world, 'wallow 1')
  assert.equal(elks(t.state).length, 1)
  const elk = elks(t.state)[0]
  assert.deepEqual([elk.x, elk.y], [w1.x, w1.y])
  assert.equal(elk.taleKey, 'tale:0,0')
  arriveTales(t.state, t.world, t.hooks)
  assert.equal(elks(t.state).length, 1, 'a second arrival made a second elk')
})

test('walking up flushes it; out of the window and back it beds where the flags say', () => {
  const t = setup('elk', '1,1')
  put(t.state, point(t.world, 'wallow 1'), FLUSH_TILES - 1, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  const elk = elks(t.state)[0]
  assert.equal(elk.mood, 'bolting')
  elk.bolted = true
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.flush, 1)
  shift(t, -1, 0)
  assert.equal(elks(t.state).length, 0, 'the elk left with its wood')
  shift(t, 1, 0)
  const w2 = point(t.world, 'wallow 2')
  assert.equal(elks(t.state).length, 1)
  assert.deepEqual([elks(t.state)[0].x, elks(t.state)[0].y], [w2.x, w2.y])
})

test('the elk bolting across a re-centre keeps its goal', () => {
  const t = setup('elk', '1,1')
  put(t.state, point(t.world, 'wallow 1'), 2, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  const elk = elks(t.state)[0]
  const goal = { ...elk.boltTo }
  shift(t, 1, 0)   // the wood stays in the window; everything moves 80 tiles west
  assert.ok(elks(t.state).includes(elk))
  assert.deepEqual(elk.boltTo, { px: goal.px - 80 * S, py: goal.py })
})

test('the hide is handed over in the village with the wood out of the window', () => {
  const t = setup('elk', '2,2', { flags: { hirvi_dead: true } })
  assert.ok(!t.world.pieces.get('2,2') || t.world.origin.wx + 2 < 2, 'the wood is not in the window')
  t.state.player.inventory.push(makeItem('elk_hide'))
  put(t.state, villageElder(t.state), 1, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.hide_given, true)
  assert.equal(hasTalent(t.state.player, 'ski_legs'), true)
  assert.equal(t.rec.done, true)
  assert.equal(t.world.places.get('2,2').done, true)
  assert.ok(t.world.paid.has('elk'))
  assert.ok(t.calls.persist >= 1)

  // the giver has changed for good: the done stage, and no second delivery
  assert.deepEqual(t.state.villageLines['0,0'], fillLines(t.world, '0,0'))
  assert.ok(!JSON.stringify(t.state.villageLines['0,0']).includes('shrine'))
  t.state.player.inventory.push(makeItem('elk_hide'))
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.ok(t.state.player.inventory.some(i => i.kind === 'elk_hide'), 'a second hide was taken')
})

// Review Focus 2
test('a dead elder is replaced by a stand-in who takes the hide', () => {
  const t = setup('elk', '2,2', { flags: { hirvi_dead: true } })
  const elder = villageElder(t.state)
  t.state.entities = t.state.entities.filter(e => e !== elder)
  recordFor(t.world, '0,0').gone.add(elder.wildsIx)
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  const stand = t.state.entities.find(e => e.type === 'npc' && e.species === 'elder')
  assert.ok(stand && stand.taleKey === 'tale:0,0', 'no stand-in elder')
  t.state.player.inventory.push(makeItem('elk_hide'))
  put(t.state, stand, 1, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.hide_given, true)
})

test('a second village\'s elk pays loot, not Ski-legs', () => {
  const t = setup('elk', '2,2', { flags: { hirvi_dead: true }, paid: ['elk'] })
  t.state.player.inventory.push(makeItem('elk_hide'))
  put(t.state, villageElder(t.state), 1, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.hide_given, true)
  assert.equal(hasTalent(t.state.player, 'ski_legs'), false)
  assert.equal(t.rec.special, false)
  const loot = pickups(t.state)
  assert.equal(loot.length, 2)
  for (const l of loot) {
    assert.ok(Math.max(Math.abs(l.x - t.state.player.x), Math.abs(l.y - t.state.player.y)) <= 2)
    assert.equal(t.state.map[l.y][l.x].tile, TILE.FLOOR)
  }
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(pickups(t.state).length, 2, 'paid twice')
})

// Review Focus 1
test('death mid-tale resumes from the flags', () => {
  const t = setup('elk', '1,1', { flags: { flush: 1 } })
  wildsRespawn(t.state, t.world, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  const w2 = point(t.world, 'wallow 2')
  assert.equal(elks(t.state).length, 1)
  assert.deepEqual([elks(t.state)[0].x, elks(t.state)[0].y], [w2.x, w2.y])

  const h = setup('kivihiisi', '1,1', { flags: { hiisi_woken: true, stones: 4 } })
  wildsRespawn(h.state, h.world, { buildEntities })
  arriveTales(h.state, h.world, h.hooks, { fresh: true })
  const k = point(h.world, 'hiidenkiuas')
  const standing = RING.map(([dx, dy]) => h.state.map[k.y + dy][k.x + dx]).filter(c => c.tile === TILE.WALL && String(c.overlay).startsWith('ow_mtn_rock_'))
  assert.equal(standing.length, 4)
  for (let i = 0; i < 4; i++) assert.equal(h.state.map[k.y + RING[i][1]][k.x + RING[i][0]].tile, TILE.WALL)
  const hiisi = h.state.entities.filter(e => e.type === 'kivihiisi')
  assert.equal(hiisi.length, 1)
  assert.deepEqual([hiisi[0].x, hiisi[0].y], [k.x, k.y])
})

test('a second Hiisi is not killed by the first one\'s death', () => {
  const t = setup('kivihiisi', '1,1', { flags: { hiisi_woken: true, stones: 6 } })
  t.state.creatureKills.kivihiisi = true   // left over from another place
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.ok(!t.flags.hiisi_dead)
  assert.equal(t.state.entities.filter(e => e.type === 'kivihiisi').length, 1)
})

test('the hermit speaks his own lines beside the oven', () => {
  const t = setup('kivihiisi', '1,1')
  const hermit = t.state.entities.find(e => e.type === 'npc' && e.species === 'hermit')
  assert.ok(hermit, 'no hermit')
  assert.ok(t.state.villageLines[hermit.wildsKey]?.hermit?.length >= 1)
  assert.ok(t.state.villageLines['0,0'].villager.length >= 1)
})

test('the tar pit: six logs light it, three pots mend the gap, and it stays mended', () => {
  const t = setup('tar', '1,1')
  const gaps = [1, 2, 3].map(i => point(t.world, `bridge gap ${i}`))
  for (const g of gaps) assert.equal(t.state.map[g.y][g.x].tile, TILE.WALL, 'the gap is not broken')
  t.state.player.inventory.push(makeItem('lumber', 6))
  put(t.state, point(t.world, 'tar pit'))
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.pit_lit, true)
  assert.equal(t.state.player.inventory.find(i => i.kind === 'tar')?.count, 3)
  put(t.state, gaps[0], -1, 0); tickTales(t.state, t.world, 0.016, t.hooks)
  put(t.state, gaps[0]); tickTales(t.state, t.world, 0.016, t.hooks)
  put(t.state, gaps[1]); tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.bridge_done, true)
  assert.equal(t.rec.done, true)
  assert.ok(pickups(t.state).some(e => e.contents?.weaponType === 'tervajousi'), 'no bow at the camp')

  // the piece is made anew (evicted, reloaded): the deck is whole again from the flags
  t.world.pieces.delete('1,1')
  enterWilds(t.state, t.world, { wx: 0, wy: 0 }, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  for (const g of [1, 2, 3].map(i => point(t.world, `bridge gap ${i}`))) {
    assert.equal(t.state.map[g.y][g.x].tile, TILE.FLOOR)
    assert.equal(t.state.map[g.y][g.x].overlay, 'ow_pier_log')
  }
})

// Review Focus 3
test('a save made underground keeps the tale', () => {
  const t = setup('elk', '1,1', { flags: { flush: 1, hunt_seen: true } })
  const under = { cave: { surface: t.state }, player: { x: 3, y: 3 } }
  const again = makeWorld(JSON.parse(JSON.stringify(snapshotWilds(under, t.world))))
  assert.deepEqual(again.tales.get('0,0'), t.world.tales.get('0,0'))
  assert.deepEqual(again.places.get('1,1'), { id: 'elk', village: '0,0', done: false })
  assert.equal(getPiece(again, 1, 1).tale, 'elk')
  assert.ok(!('_taleRuns' in exportWorld(t.world)), 'the runner\'s scratch state was saved')
})

test('two villages in one window speak their own lines; one without a tale still speaks', () => {
  let found = null
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const vs = [{ wx: 0, wy: 0 }, ...villagesNear(seed, 0, 0, 10).filter(v => v.wx || v.wy)]
    for (const a of vs) for (const b of vs) {
      if (a === b || found) continue
      if (Math.max(Math.abs(a.wx - b.wx), Math.abs(a.wy - b.wy)) <= 2) found = { seed, a, b }
    }
  }
  assert.ok(found, 'no two villages two pieces apart in sixty worlds')
  const { seed, a, b } = found
  const world = makeWorld(null, { seed })
  const state = { player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10, talents: [], inventory: [], maxInventory: 20 }, entities: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {} }
  const hooks = { getState: () => state, spawn: s => buildEntities(s), persist: () => {}, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 4 }) }
  enterWilds(state, world, { wx: Math.round((a.wx + b.wx) / 2), wy: Math.round((a.wy + b.wy) / 2) }, { buildEntities })
  arriveTales(state, world, hooks, { fresh: true })
  for (const v of [a, b]) {
    const lines = state.villageLines[`${v.wx},${v.wy}`]
    assert.ok(lines?.villager?.length >= 1 && lines?.elder?.length >= 1, `village ${v.wx},${v.wy} is mute`)
    assert.ok(!/\{\w+\}/.test(JSON.stringify(lines)), 'a placeholder was left in')
  }
})

// ---- found by the whole-branch review ----------------------------------------------
const PICK = { weaponType: 'pick', name: 'Pick', damage: 2, mine: 3 }
const mineOut = (state, c) => { for (let i = 0; i < 5; i++) harvest(state.map, c.x, c.y, PICK) }

test('a kill left over from another place does not finish a village whose own place is not here', () => {
  let kept = 0
  for (const [id, creature, flag] of [['elk', 'hirvi', 'hirvi_dead'], ['kivihiisi', 'kivihiisi', 'hiisi_dead']]) {
    const t = setup(id, '2,2')          // the village is in the window, its place is not
    t.state.creatureKills[creature] = true
    tickTales(t.state, t.world, 0.016, t.hooks)
    assert.ok(!t.flags[flag], `${id}: another place's kill finished this tale`)
    assert.ok(!t.rec.done)
    assert.equal(pickups(t.state).filter(e => e.taleKey === 'tale:0,0').length, 0, `${id}: paid for a kill that was not its own`)
    // ...and it is left for whoever it does belong to (unless that one is in this window and took it)
    if (!t.state.entities.some(e => e.type === creature)) { kept++; assert.equal(t.state.creatureKills[creature], true, 'the kill was thrown away') }
  }
  assert.ok(kept >= 1, 'neither world left the kill to be checked')
})

test('the elk, start to finish through the runner: flushed twice, stood, killed, the hide handed in', () => {
  const t = setup('elk', '1,1')
  for (const n of [1, 2]) {
    const elk = elks(t.state)[0]
    put(t.state, elk, 2, 0)
    tickTales(t.state, t.world, 0.016, t.hooks)
    assert.equal(elk.mood, 'bolting')
    elk.bolted = true
    tickTales(t.state, t.world, 0.016, t.hooks)
    assert.equal(t.flags.flush, n)
  }
  const elk = elks(t.state)[0], w3 = point(t.world, 'wallow 3')
  assert.deepEqual([elk.x, elk.y], [w3.x, w3.y])
  hurtCreature(t.state, elk, elk.hp)
  assert.equal(t.state.creatureKills.hirvi, true, 'the standing elk did not die')
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.hirvi_dead, true)
  assert.equal(t.state.creatureKills.hirvi, undefined, 'the kill was not consumed')
  const hide = pickups(t.state).find(e => e.contents?.type === 'elk_hide')
  assert.ok(hide, 'no hide where the elk fell')
  t.state.entities = t.state.entities.filter(e => e !== hide)
  t.state.player.inventory.push(makeItem('elk_hide'))
  put(t.state, villageElder(t.state), 1, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.hide_given, true)
  assert.equal(hasTalent(t.state.player, 'ski_legs'), true)
  assert.equal(t.rec.done, true)
})

test('the Kivihiisi, start to finish through the runner: the capstone, six stones, the hammer', () => {
  const t = setup('kivihiisi', '1,1')
  const k = point(t.world, 'hiidenkiuas')
  put(t.state, k, 0, 5)
  mineOut(t.state, k)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.hiisi_woken, true)
  assert.equal(t.state.entities.filter(e => e.type === 'kivihiisi').length, 1)
  for (let i = 0; i < 6; i++) {
    mineOut(t.state, { x: k.x + RING[i][0], y: k.y + RING[i][1] })
    tickTales(t.state, t.world, 0.016, t.hooks)
    assert.equal(t.flags.stones, 5 - i)
  }
  assert.equal(t.flags.hiisi_dead, true)
  assert.equal(t.state.creatureKills.kivihiisi, undefined, 'the kill was not consumed')
  assert.ok(pickups(t.state).some(e => e.contents?.weaponType === 'ukonvasara'), 'no hammer')
  assert.equal(t.rec.done, true)
  assert.ok(t.world.paid.has('kivihiisi'))
})

// ---- step 2: the runner drives episodes -------------------------------------------------
const thought = state => state.feedback.bubble?.kind === 'thought' ? state.feedback.bubble.text : null
const missing = state => state.entities.filter(e => e.type === 'npc' && e.role === 'missing')
const centre = (t, wx = 0, wy = 0) => { const p = getPiece(t.world, wx, wy); return { x: (wx - t.world.origin.wx) * PIECE + p.village.x, y: (wy - t.world.origin.wy) * PIECE + p.village.y } }

test('a remark is thought once when its point comes near', () => {
  const t = setup('elk', '1,1')
  const text = TALES.elk.remarks[0].text
  put(t.state, point(t.world, 'forest shrine'), 0, 12)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.notEqual(thought(t.state), text, 'remarked from too far away')
  put(t.state, point(t.world, 'forest shrine'), 0, 3)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(thought(t.state), text)
  assert.deepEqual(t.flags.said, [0])
  t.state.feedback.bubble = null
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(thought(t.state), null, 'said twice')
})

test('the missing person comes home when the tale is done, once, and is there on every later arrival', () => {
  const t = setup('nakki', '2,2', { flags: { nakki_gone: true } })
  assert.equal(missing(t.state).length, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.rec.done, true)
  const [who] = missing(t.state)
  assert.equal(missing(t.state).length, 1)
  assert.deepEqual([who.species, who.hostile, who.taleKey, who.linesKey], ['villager', false, 'tale:0,0', '0,0'])
  const c = centre(t)
  assert.ok(Math.max(Math.abs(who.x - c.x), Math.abs(who.y - c.y)) <= 4)
  assert.equal(t.state.map[who.y][who.x].tile, TILE.FLOOR)
  tickTales(t.state, t.world, 0.016, t.hooks)
  arriveTales(t.state, t.world, t.hooks)
  assert.equal(missing(t.state).length, 1, 'a second one came home')
  shift(t, 0, -1); shift(t, 0, -1)          // the village leaves the window...
  assert.equal(missing(t.state).length, 0)
  shift(t, 0, 1); shift(t, 0, 1)            // ...and is back
  assert.equal(missing(t.state).length, 1)
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  assert.equal(missing(t.state).length, 1)
})

test('an episode that calls resolve() is finished, and reads the Wilds clock', () => {
  const t = setup('flame', '2,2', { flags: { sammunut_spawned: true, arrived: true } })
  assert.equal(t.rec.done, false)
  t.state.entities.push({ type: 'sammunut', taleKey: 'tale:0,0', x: 5, y: 5, px: 176, py: 176 })
  t.state.creatureKills.sammunut = true
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.wraith_dead, true, 'the village tale did not see its own creature die')
  assert.equal(t.flags.resolved, true)
  assert.equal(t.state.creatureKills.sammunut, undefined)
  assert.equal(t.rec.done, true)
})

test('a creature that lives in the village is not the tale\'s own when only the knoll is here', () => {
  const t = setup('flame', '3,0', { flags: { sammunut_spawned: true, arrived: true } })
  enterWilds(t.state, t.world, { wx: 3, wy: 0 }, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  assert.ok(t.world.origin.wx > 0, 'the village is still in the window')
  t.state.creatureKills.sammunut = true
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.ok(!t.flags.wraith_dead)
  assert.equal(t.state.creatureKills.sammunut, true)
})

test('onArrive runs when the piece the tale names comes in, not the other', () => {
  const spy = id => { const mod = EPISODE_MODULES[TALES[id].module], real = mod.onArrive; let n = 0; mod.onArrive = () => { n++ }; return { get n() { return n }, restore: () => { mod.onArrive = real } } }
  const flame = spy('flame'), nakki = spy('nakki')
  try {
    const a = setup('flame', '2,0')            // village here, knoll one piece outside the window
    assert.equal(flame.n, 1)
    shift(a, 1, 0)                             // the knoll comes in, the village stays
    assert.equal(flame.n, 1, 'the flame-thief arrived again for its knoll')
    const b = setup('nakki', '2,0')
    assert.equal(nakki.n, 0, 'the Näkki arrived for its village')
    shift(b, 1, 0)
    assert.equal(nakki.n, 1)
  } finally { flame.restore(); nakki.restore() }
})

test('a story house hands out its tale\'s things', () => {
  const t = setup('nakki', '1,1')
  const door = { label: `house:wilds:${1 * PIECE + 30},${1 * PIECE + 30}`, story: "Toivo's hut", tier: 'hut' }
  const ep = storyEpisode(t.world, door)
  assert.ok(ep?.houses["Toivo's hut"].pickups.length >= 3)
  assert.equal(ep.houses["Toivo's hut"].room, 'toivo_kitchen')
  assert.equal(storyEpisode(t.world, { ...door, label: 'house:wilds:5,5' }), null, 'a door outside any place')
  assert.equal(storyEpisode(t.world, { ...door, story: null }), null)
})

// ---- step 2: the Näkki and the bell ---------------------------------------------------------
const nakkis = state => state.entities.filter(e => e.type === 'nakki')
function ringAndFeed(t) {
  const islet = point(t.world, 'islet cache'), end = point(t.world, 'pier end')
  const clapper = pickups(t.state).find(e => e.contents?.type === 'clapper')
  assert.deepEqual([clapper.x, clapper.y], [islet.x, islet.y])
  t.state.entities = t.state.entities.filter(e => e !== clapper)
  t.state.player.inventory.push(makeItem('clapper'))
  put(t.state, end)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.bell_hung, true)
  const [nakki] = nakkis(t.state), at = point(t.world, 'nakki')
  assert.equal(nakkis(t.state).length, 1)
  assert.deepEqual([nakki.x, nakki.y, nakki.taleKey], [at.x, at.y, 'tale:0,0'])
  assert.deepEqual(nakki.pierEnd, end)
  t.state.player.inventory.push(makeItem('cooked_meat', 3))
  for (let i = 1; i <= 3; i++) {
    nakki.state = 'surfaced'
    tickTales(t.state, t.world, 0.016, t.hooks)
    assert.equal(t.flags.fed, i)
  }
}

test('the Näkki, start to finish: the clapper, the bell, three meals, Toivo home', () => {
  const t = setup('nakki', '1,1')
  const gaps = [1, 2, 3, 4].map(i => point(t.world, `pier gap ${i}`))
  for (const g of gaps) assert.equal(t.state.map[g.y][g.x].tile, TILE.WALL)
  assert.equal(nakkis(t.state).length, 0, 'the Näkki is there before the bell is rung')
  ringAndFeed(t)
  assert.equal(t.flags.nakki_gone, true)
  for (const g of gaps) { assert.equal(t.state.map[g.y][g.x].tile, TILE.FLOOR); assert.equal(t.state.map[g.y][g.x].overlay, 'ow_pier_log') }
  assert.equal(t.rec.done, true)
  assert.deepEqual(t.calls.talents, ['lake_breath'])
  assert.ok(t.world.paid.has('nakki'))
  assert.equal(missing(t.state).length, 1, 'Toivo did not come home')
  assert.ok(!JSON.stringify(t.state.villageLines['0,0']).includes('Nobody dares'), 'the village still tells the tale')
  // the lake is made anew: the pier is whole from the flags
  t.world.pieces.delete('1,1')
  enterWilds(t.state, t.world, { wx: 0, wy: 0 }, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  for (const g of [1, 2, 3, 4].map(i => point(t.world, `pier gap ${i}`))) assert.equal(t.state.map[g.y][g.x].tile, TILE.FLOOR)
  assert.equal(nakkis(t.state).length, 0)
})

test('a second village\'s Näkki pays loot, not the lake\'s breath', () => {
  const t = setup('nakki', '1,1', { paid: ['nakki'] })
  ringAndFeed(t)
  assert.equal(t.rec.done, true)
  assert.deepEqual(t.calls.talents, [])
  assert.equal(pickups(t.state).filter(e => e.taleKey === 'tale:0,0').length, 2)
})

// Review Focus 5
test('death with the bell hung: the Näkki is back at the pier', () => {
  const t = setup('nakki', '1,1', { flags: { bell_hung: true, fed: 1 } })
  assert.equal(nakkis(t.state).length, 1)
  wildsRespawn(t.state, t.world, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  const at = point(t.world, 'nakki')
  assert.equal(nakkis(t.state).length, 1)
  assert.deepEqual([nakkis(t.state)[0].x, nakkis(t.state)[0].y], [at.x, at.y])
})

test('the stranger works the Näkki out from what is there', () => {
  const t = setup('nakki', '1,1')
  put(t.state, point(t.world, 'bell'), -2, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.match(thought(t.state) ?? '', /clapper/)
  const told = JSON.stringify(t.state.villageLines['0,0'])
  assert.match(told, /Toivo/)
  assert.match(told, /a short walk south-east/)
  assert.ok(!/\{\w+\}/.test(told))
})
