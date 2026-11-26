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
import { roadsFrom } from '../renderer/wilds/roads.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef } from '../renderer/systems/monsters.js'
import { makeHirvi, FLUSH_TILES } from '../renderer/systems/monsters/hirvi.js'
import { makeNakki } from '../renderer/systems/monsters/nakki.js'
import { makeMaahinen } from '../renderer/systems/monsters/maahinen.js'
import { makeSammunut } from '../renderer/systems/monsters/sammunut.js'
import { CHORE_TIMEOUT, DELIVERY_COOLDOWN } from '../renderer/systems/episodes/hermit.js'
import { isNight } from '../renderer/systems/weather.js'
import { BURN_INTERVAL } from '../renderer/systems/episodes/fold.js'
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
import { skinBridges, isDeckSkin } from '../renderer/wilds/bridge-art.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { MapBuilder } from '../renderer/terrain/lib.js'
import { takeDirtyTiles } from '../renderer/systems/tile-dirty.js'

const S = 32
const KIVIHIISI_DEF = JSON.parse(fs.readFileSync('renderer/data/monsters/kivihiisi.json', 'utf8'))
const FAKE_RIG = { PARAM_SCHEMA: [], drawMonster: () => {}, hitHalf: () => 12 }
before(async () => { clearMonsters(); await registerMonsters([KIVIHIISI_DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }) })

function buildEntities(spawns) {
  return spawns.flatMap(s => {
    const at = { x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }
    if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.coachman) n.coachman = true; return n ? [Object.assign(n, at)] : [] }   // the coachman's marker, as game.js copies it
    if (s.kind === 'hirvi') return [Object.assign(makeHirvi(s.x, s.y), at)]
    if (s.kind === 'nakki') return [Object.assign(makeNakki(s.x, s.y), at)]
    if (s.kind === 'maahinen') return [Object.assign(makeMaahinen(s.x, s.y), at)]
    if (s.kind === 'sammunut') return [Object.assign(makeSammunut(s.x, s.y), at)]
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
// The Wilds' piers are plank deck cut to their neighbours (wilds/bridge-art.js),
// and a plank a tale lays or lifts must leave the deck as a newly made piece
// would wear it. freshDecks runs the generator's own pass over the place's
// piece as its cells now stand and answers for a window tile.
function freshDecks(t, wx = pwx, wy = pwy) {
  const ox = (wx - t.world.origin.wx) * PIECE, oy = (wy - t.world.origin.wy) * PIECE
  const b = new MapBuilder('t', 't', 't', PIECE, PIECE)
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    const c = t.state.map[oy + y][ox + x]
    b.ground[y][x] = b.skin(c.skin)
    b.prop[y][x] = c.overlay ? b.skin(c.overlay) : -1
    b.walkG[y][x] = c.tile === TILE.FLOOR
  }
  skinBridges(b, { X0: wx * PIECE, Y0: wy * PIECE })
  return (x, y) => b.palette[b.prop[y - oy][x - ox]] ?? null
}
// Every cell of row y from x0 to x1 wears what the generator would lay there now.
function assertFreshRow(t, y, x0, x1, what) {
  const fresh = freshDecks(t)
  for (let x = x0; x <= x1; x++) assert.equal(t.state.map[y][x].overlay ?? null, fresh(x, y), `${what}: the deck at ${x},${y} is not cut to its neighbours`)
}
const beams = cell => { const m = /^ow_pier_deck_[hv]_(\d+)p?$/.exec(cell.overlay ?? ''); return m ? +m[1] : null }
const planking = cell => /^ow_pier_deck_([hv])_/.exec(cell.overlay ?? '')?.[1] ?? null
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

  // the giver has changed for good: the done stage (and the road), and no second delivery
  const told = fillLines(t.world, '0,0')
  assert.deepEqual(t.state.villageLines['0,0'], { ...told, villager: [...told.villager, roadTalk(t.world.seed, '0,0')] })
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
  // (the farms round the village have elders of their own, who are nobody's stand-in)
  const stand = t.state.entities.find(e => e.type === 'npc' && e.species === 'elder' && e.taleKey === 'tale:0,0')
  assert.ok(stand, 'no stand-in elder')
  assert.ok(!t.state.entities.some(e => e.type === 'npc' && e.species === 'elder' && e.wildsKey === '0,0'), 'the dead elder is back')
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
  const row = t.state.map[gaps[0].y], lo = Math.min(...gaps.map(g => g.x)), hi = Math.max(...gaps.map(g => g.x))
  for (const g of gaps) { assert.equal(row[g.x].tile, TILE.WALL, 'the gap is not broken'); assert.ok(!row[g.x].overlay, 'planks float on the broken gap') }
  // the deck breaks off at the gap with a proper end on each side: a beam
  // (and the corner posts that come with it) facing the missing planks
  assert.equal(beams(row[lo - 1]), 1 | 2 | 4, 'the deck west of the gap has no end')
  assert.equal(beams(row[hi + 1]), 1 | 4 | 8, 'the deck east of the gap has no end')
  assertFreshRow(t, gaps[0].y, lo - 4, hi + 3, 'broken')
  // a new piece of the same deal is the whole deck: what the mended one must match
  const whole = generatePiece(t.world.seed, pwx, pwy, getPiece(t.world, pwx, pwy).deal, 'tar')
  const wholeAt = x => whole.cells[gaps[0].y - (pwy - t.world.origin.wy) * PIECE][x - (pwx - t.world.origin.wx) * PIECE].overlay
  t.state.player.inventory.push(makeItem('lumber', 6))
  put(t.state, point(t.world, 'tar pit'))
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.pit_lit, true)
  assert.equal(t.state.player.inventory.find(i => i.kind === 'tar')?.count, 3)
  takeDirtyTiles(t.state.map)
  put(t.state, gaps[0], -1, 0); tickTales(t.state, t.world, 0.016, t.hooks)
  // one plank down: it and the deck it joins are cut together, the gap's other side is untouched
  const near = gaps[0].x < gaps[2].x ? -1 : 1   // which way the standing deck lies from the first gap
  assert.equal(row[gaps[0].x].tile, TILE.FLOOR)
  assert.equal(beams(row[gaps[0].x]), 1 | 4 | (near < 0 ? 2 : 8), 'the new plank does not end at the next gap')
  assert.equal(beams(row[gaps[0].x + near]), 1 | 4, 'the deck still ends where the new plank joins it')
  assert.equal(planking(row[gaps[0].x]), planking(row[gaps[0].x + near]), 'the new plank lies the other way from the deck')
  assertFreshRow(t, gaps[0].y, lo - 4, hi + 3, 'one plank down')
  // the tile layer is told of the plank and of the neighbour whose end closed
  const dirty = takeDirtyTiles(t.state.map) ?? []
  const told = new Set(); for (let i = 0; i < dirty.length; i += 2) told.add(`${dirty[i]},${dirty[i + 1]}`)
  for (const x of [gaps[0].x, gaps[0].x + near]) assert.ok(told.has(`${x},${gaps[0].y}`), `the cell at ${x} is not marked for redrawing`)
  put(t.state, gaps[0]); tickTales(t.state, t.world, 0.016, t.hooks)
  assertFreshRow(t, gaps[0].y, lo - 4, hi + 3, 'two planks down')
  put(t.state, gaps[1]); tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.bridge_done, true)
  for (let x = lo - 4; x <= hi + 3; x++) assert.equal(row[x].overlay ?? null, wholeAt(x) ?? null, `the mended deck differs from a new one at ${x}`)
  assert.equal(t.rec.done, true)
  assert.ok(pickups(t.state).some(e => e.contents?.weaponType === 'tervajousi'), 'no bow at the camp')

  // the piece is made anew (evicted, reloaded): the deck is whole again from the flags
  t.world.pieces.delete('1,1')
  enterWilds(t.state, t.world, { wx: 0, wy: 0 }, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  for (const g of [1, 2, 3].map(i => point(t.world, `bridge gap ${i}`))) {
    assert.equal(t.state.map[g.y][g.x].tile, TILE.FLOOR)
    assert.equal(t.state.map[g.y][g.x].overlay, wholeAt(g.x))
  }
  for (let x = lo - 4; x <= hi + 3; x++) assert.equal(t.state.map[gaps[0].y][x].overlay ?? null, wholeAt(x) ?? null, `the deck made anew differs at ${x}`)
})

test('the tar pit, half mended and come back to: the deck is cut from the flags as it was left', () => {
  const t = setup('tar', '1,1', { flags: { pit_lit: true, bridge_seen: true, plank_1: true } })
  const gaps = [1, 2, 3].map(i => point(t.world, `bridge gap ${i}`))
  const row = t.state.map[gaps[0].y]
  assert.equal(row[gaps[0].x].tile, TILE.FLOOR)
  assert.ok(isDeckSkin(row[gaps[0].x].overlay), `the plank the flag remembers is ${row[gaps[0].x].overlay}`)
  for (const g of gaps.slice(1)) assert.equal(row[g.x].tile, TILE.WALL)
  assertFreshRow(t, gaps[0].y, Math.min(gaps[0].x, gaps[2].x) - 4, Math.max(gaps[0].x, gaps[2].x) + 3, 'half mended')
  // a second arrival (the window re-centred) changes nothing
  const before = row.map(c => c.overlay ?? null)
  arriveTales(t.state, t.world, t.hooks)
  assert.deepEqual(row.map(c => c.overlay ?? null), before)
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

// What a village's villagers say of its first road (by N, E, S, W): where it goes.
const roadTalk = (seed, key) => {
  const r = roadsFrom(seed, key)[0]
  return `The ${{ N: 'north', E: 'east', S: 'south', W: 'west' }[r.side]} road goes to ${r.town.name}.`
}
test('every village names the town its first road goes to, with the rest of what it says', () => {
  let n = 0
  for (const seed of [3, 7, 11]) {
    const world = makeWorld(null, { seed })
    const state = { player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10, talents: [], inventory: [], maxInventory: 20 }, entities: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {} }
    const hooks = { getState: () => state, spawn: s => buildEntities(s), persist: () => {}, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 4 }) }
    for (const v of [{ wx: 0, wy: 0 }, ...villagesNear(seed, 0, 0, 6).filter(v => v.wx || v.wy).slice(0, 2)]) {
      enterWilds(state, world, v, { buildEntities })
      arriveTales(state, world, hooks, { fresh: true })
      const key = `${v.wx},${v.wy}`, lines = state.villageLines[key], at = `seed ${seed} village ${key}`
      const line = roadTalk(seed, key)
      assert.equal(lines.villager.filter(l => l === line).length, 1, `${at}: ${JSON.stringify(lines.villager)} lacks "${line}"`)
      assert.equal(lines.villager.at(-1), line, `${at}: the road comes after the tale`)
      assert.ok(lines.villager.length >= 2, `${at}: the road is all they say`)
      assert.ok(!(lines.elder ?? []).includes(line), `${at}: the elder says it too`)
      n++
    }
  }
  assert.equal(n, 9)
  // Koivula's first road by N, E, S, W
  assert.match(roadTalk(3, '0,0'), /^The (north|east|south|west) road goes to [A-Z]/)
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
  // the four planks join the standing pier as one deck: its planking, no
  // beam left where the pier used to end, and cut as a new piece would be
  const pierEnd = point(t.world, 'pier end'), pierRow = t.state.map[pierEnd.y]
  for (const g of gaps) {
    assert.equal(pierRow[g.x].tile, TILE.FLOOR)
    assert.ok(isDeckSkin(pierRow[g.x].overlay), `the plank at ${g.x} is ${pierRow[g.x].overlay}`)
    assert.equal(planking(pierRow[g.x]), planking(pierRow[pierEnd.x]))
  }
  assert.equal(beams(pierRow[pierEnd.x]), 1 | 4, 'the pier still ends where it used to stop')
  for (const g of gaps.slice(0, 3)) assert.equal(beams(pierRow[g.x]), 1 | 4)
  assertFreshRow(t, pierEnd.y, pierEnd.x - 5, gaps[3].x + 1, 'the pier mended')
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
  { const e = point(t.world, 'pier end'); assertFreshRow(t, e.y, e.x - 5, e.x + 5, 'the pier made anew') }
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

// ---- step 2: the fold and the wolves ---------------------------------------------------------
// the den's own wolves (a roaming pack in the same piece is not the den's)
const denWolves = (state, world) => { const den = point(world, 'den'); return state.entities.filter(e => e.type === 'npc' && e.species === 'wolf' && (e.wildsKey === '1,1' || e.taleKey === 'tale:0,0') && Math.max(Math.abs(e.x - den.x), Math.abs(e.y - den.y)) <= 6) }
const charredNear = (t, label) => { const b = point(t.world, label); let n = 0; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (String(t.state.map[b.y + dy]?.[b.x + dx]?.overlay).startsWith('ow_deadtree')) n++; return n }
function burnAll(t, bands) {
  put(t.state, centre(t))
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.begun, true, 'the burning did not begin when the stranger stood in the village')
  for (let n = 1; n <= bands; n++) { tickTales(t.state, t.world, BURN_INTERVAL + 1, t.hooks); assert.equal(t.flags.burn, n) }
}

test('the fold, start to finish: the bands burn, the village shuts, the fleece, the burrow, the wolves, Aino home', () => {
  const t = setup('fold', '1,1')
  assert.equal(denWolves(t.state, t.world).length, 3)
  assert.ok(denWolves(t.state, t.world).every(w => !w.hostile), 'the den wolves attack')
  put(t.state, point(t.world, 'den'), 0, 3)     // up on the ridge, never yet in the village
  tickTales(t.state, t.world, BURN_INTERVAL * 5, t.hooks)
  assert.ok(!t.flags.burn, 'the wood burnt before the stranger had set foot in the village')
  burnAll(t, 4)
  for (let n = 1; n <= 4; n++) assert.ok(charredNear(t, `burn ${n}`) >= 1, `band ${n} is not charred`)
  assert.ok(t.state.entities.every(e => e.type !== 'npc' || e.species === 'wolf' || !e.hostile), 'a villager attacks')
  assert.ok(!t.state.npcWrath)
  assert.deepEqual(t.state.villageLines['0,0'], TALES.fold.shutLines)

  const fleece = pickups(t.state).find(e => e.contents?.type === 'fleece'), cache = point(t.world, 'fleece cache')
  assert.deepEqual([fleece.x, fleece.y], [cache.x, cache.y])
  t.state.entities = t.state.entities.filter(e => e !== fleece)
  t.state.player.inventory.push(makeItem('fleece'))
  put(t.state, villageElder(t.state), 1, 0)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.fleece_shown, true)
  assert.notDeepEqual(t.state.villageLines['0,0'], TALES.fold.shutLines)
  assert.ok(pickups(t.state).some(e => e.contents?.weaponType === 'pick') || t.state.player.weapon?.weaponType === 'pick' || t.state.player.inventory.some(i => i.payload?.weaponType === 'pick'), 'no pick from the elder')
  tickTales(t.state, t.world, BURN_INTERVAL * 3, t.hooks)
  assert.equal(t.flags.burn, 4)

  const burrow = point(t.world, 'burrow'), lair = point(t.world, 'lair')
  put(t.state, burrow, 0, 2)
  mineOut(t.state, burrow)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.maahinen_spawned, true)
  const [beast] = t.state.entities.filter(e => e.type === 'maahinen')
  assert.deepEqual([beast.x, beast.y, beast.taleKey], [lair.x, lair.y, 'tale:0,0'])
  t.state.creatureKills.maahinen = true     // the wolves bring it down
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.maahinen_dead, true)
  assert.equal(t.rec.done, true)
  assert.deepEqual(t.calls.talents, ['tapio_peace'])
  assert.equal(missing(t.state).length, 1, 'Aino did not come home')
})

// Review Focus 1, and the step-2 review's dead end: the stranger kills the pack and then the thing itself
test('the fold with no wolves left: the pack comes back to an empty den, and the tale still ends', () => {
  const t = setup('fold', '1,1', { flags: { begun: true, burn: 4 } })     // no fleece shown: the village is shut
  const all = t.state.entities.filter(e => e.type === 'npc' && e.species === 'wolf' && e.wildsKey === '1,1')
  for (const w of all) recordFor(t.world, '1,1').gone.add(w.wildsIx)
  t.state.entities = t.state.entities.filter(e => !all.includes(e))
  t.flags.maahinen_spawned = true; t.flags.maahinen_dead = true
  put(t.state, point(t.world, 'den'), 0, 4)
  tickTales(t.state, t.world, 1.5, t.hooks)
  assert.equal(denWolves(t.state, t.world).length, 0, 'wolves appeared in front of the player')
  assert.ok(!t.rec.done, 'the fold ended with no wolf alive')
  put(t.state, centre(t))                                             // back in the village: nobody at the den to see
  tickTales(t.state, t.world, 1.5, t.hooks)
  const back = denWolves(t.state, t.world), den = point(t.world, 'den')
  assert.equal(back.length, 2)
  assert.ok(back.every(w => !w.hostile && w.taleKey === 'tale:0,0' && Math.max(Math.abs(w.x - den.x), Math.abs(w.y - den.y)) <= 4))
  tickTales(t.state, t.world, 1.5, t.hooks)
  assert.equal(denWolves(t.state, t.world).length, 2, 'more wolves each time')
  assert.equal(t.rec.done, true, 'the fold is a dead end')
  assert.equal(missing(t.state).length, 1, 'Aino did not come home')
  assert.notDeepEqual(t.state.villageLines['0,0'], TALES.fold.shutLines, 'the village is still shut after the tale is done')
})

test('a Maahinen that wandered off is not joined by a second when the ridge comes back', () => {
  const t = setup('fold', '1,1', { flags: { begun: true, fleece_shown: true } })
  mineOut(t.state, point(t.world, 'burrow'))
  tickTales(t.state, t.world, 0.016, t.hooks)
  const [beast] = t.state.entities.filter(e => e.type === 'maahinen')
  Object.assign(beast, { x: 100, y: 200, px: 100 * S + 16, py: 200 * S + 16 })   // into the piece south of home, which stays
  shift(t, -1, 0)                                                              // the ridge leaves the window
  assert.equal(t.state.entities.filter(e => e.type === 'maahinen').length, 1)
  shift(t, 1, 0)
  assert.equal(t.state.entities.filter(e => e.type === 'maahinen').length, 1, 'a second Maahinen rose')
})

test('the Sammunut of the Wilds fears only grey wood', () => {
  const t = setup('flame', '1,1')
  assert.equal(wraiths(t.state)[0].bane, 'greywood')
})

// Review Focus 5
test('death at the third band: the charred wood is charred again on a ridge made anew', () => {
  const t = setup('fold', '1,1')
  burnAll(t, 3)
  t.world.pieces.delete('1,1')
  wildsRespawn(t.state, t.world, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  for (let n = 1; n <= 3; n++) assert.ok(charredNear(t, `burn ${n}`) >= 1, `band ${n} came back green`)
})

// Review Focus 4
test('two tale villages on one screen: only the fold\'s own people shut the player out', () => {
  let found = null
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const vs = villagesNear(seed, 0, 0, 10).filter(v => v.wx || v.wy)
    for (const a of vs) for (const b of vs) if (a !== b && !found && Math.max(Math.abs(a.wx - b.wx), Math.abs(a.wy - b.wy)) <= 2) found = { seed, a, b }
  }
  const { seed, a, b } = found
  const world = makeWorld(null, { seed })
  const ka = `${a.wx},${a.wy}`, kb = `${b.wx},${b.wy}`
  world.tales.set(ka, { id: 'fold', flags: { begun: true, burn: 4 }, place: null, n: 0, nSide: 0, done: false })
  world.tales.set(kb, { id: 'elk', flags: {}, place: null, n: 0, nSide: 0, done: false })
  const state = { player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10, talents: [], inventory: [], maxInventory: 20 }, entities: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {} }
  const hooks = { getState: () => state, spawn: s => buildEntities(s), persist: () => {}, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 4 }), save: () => ({ clock: 0 }), isNight: () => false, grantTalent: () => {} }
  enterWilds(state, world, { wx: Math.round((a.wx + b.wx) / 2), wy: Math.round((a.wy + b.wy) / 2) }, { buildEntities })
  arriveTales(state, world, hooks, { fresh: true })
  assert.deepEqual(state.villageLines[ka], TALES.fold.shutLines)
  assert.notDeepEqual(state.villageLines[kb], TALES.fold.shutLines)
  assert.ok(state.villageLines[kb].villager.length >= 1)
})

// ---- step 2: the flame-thief and the grey wood ---------------------------------------------------
const NIGHT = [...Array(360).keys()].find(c => isNight(c)), DAY = [...Array(360).keys()].find(c => !isNight(c))
const wraiths = state => state.entities.filter(e => e.type === 'sammunut')
const firesOf = state => state.entities.filter(e => e.type === 'campfire')
const hearth = (t, n) => { const p = getPiece(t.world, 0, 0), h = p.villagePoints[n - 1]; return { x: (0 - t.world.origin.wx) * PIECE + h.x, y: (0 - t.world.origin.wy) * PIECE + h.y } }
// hearths seen to this dusk: a villager on the way, or one already there who lit it at once
const tended = (state, folk) => folk.filter(v => v.chore).length + firesOf(state).filter(f => f.hearth).length
const villagers = state => state.entities.filter(e => e.type === 'npc' && ['villager', 'elder'].includes(e.species) && e.wildsKey === '0,0')
function handWood(t) {
  t.state.player.inventory.push(makeItem('greywood', 3))
  put(t.state, villagers(t.state).find(v => !v.chore) ?? villagers(t.state)[0], 1, 0)
  tickTales(t.state, t.world, DELIVERY_COOLDOWN + 0.1, t.hooks)
  tickTales(t.state, t.world, CHORE_TIMEOUT + 1, t.hooks)
}

test('the flame-thief, start to finish: dusk, the snuffing, three blue hearths, Lauri home', () => {
  const t = setup('flame', '1,1')
  const c = centre(t)
  const [wraith] = wraiths(t.state)
  assert.equal(wraiths(t.state).length, 1)
  const far = Math.max(Math.abs(wraith.x - c.x), Math.abs(wraith.y - c.y))
  assert.ok(far >= 20 && far <= 30, `the Sammunut rose ${far} tiles from the village`)
  assert.deepEqual([wraith.taleKey, wraith.leash?.x, wraith.leash?.y], ['tale:0,0', c.x, c.y])
  assert.equal(t.save.clock, 0, 'the hour was changed')

  t.save.clock = NIGHT
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(tended(t.state, villagers(t.state)), 3, 'the three hearths were not all seen to')
  tickTales(t.state, t.world, CHORE_TIMEOUT + 1, t.hooks)
  assert.equal(firesOf(t.state).filter(f => f.hearth).length, 3)
  put(t.state, hearth(t, 1), 0, 4)
  tickTales(t.state, t.world, 0.016, t.hooks)
  const h1 = hearth(t, 1)
  t.state.entities = t.state.entities.filter(e => !(e.type === 'campfire' && Math.abs(e.x - h1.x) <= 1 && Math.abs(e.y - h1.y) <= 1))
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.seen_snuff, true)

  t.state.player.inventory.push(makeItem('deadwood', 3))
  put(t.state, villagers(t.state)[0], 1, 0)
  tickTales(t.state, t.world, DELIVERY_COOLDOWN + 0.1, t.hooks)
  assert.ok(!t.flags.wood_1, 'dead wood from any tree was taken')
  t.state.player.inventory.length = 0
  for (const n of [1, 2, 3]) {
    handWood(t)
    assert.equal(t.flags[`wood_${n}`], true)
    const hn = hearth(t, n)
    assert.ok(firesOf(t.state).some(f => f.eternal && f.fuel === 'greywood' && f.x === hn.x && f.y === hn.y), `hearth ${n} is not blue`)
  }
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(wraith.doomed, true)
  t.state.creatureKills.sammunut = true
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(t.flags.wraith_dead, true)
  assert.equal(t.rec.done, true)
  assert.deepEqual(t.calls.talents, ['sinituli'])
  assert.equal(missing(t.state).length, 1, 'Lauri did not come home')
  assert.equal(t.state.map[h1.y][h1.x].overlay, 'prop_hearth_lit')
})

// Review Focus 2
test('dusk while away: coming back at night finds the hearths tended and one Sammunut about', () => {
  const t = setup('flame', '1,1')
  shift(t, 0, -1); shift(t, 0, -1)
  assert.equal(wraiths(t.state).length, 0)
  t.save.clock = NIGHT
  tickTales(t.state, t.world, 30, t.hooks)
  shift(t, 0, 1); shift(t, 0, 1)
  assert.equal(wraiths(t.state).length, 1)
  tickTales(t.state, t.world, 0.016, t.hooks)
  assert.equal(tended(t.state, villagers(t.state)), 3)
  arriveTales(t.state, t.world, t.hooks)
  assert.equal(wraiths(t.state).length, 1, 'a second Sammunut rose')
})

// Review Focus 5
test('death with two hearths blue: both burn again on waking', () => {
  const t = setup('flame', '1,1', { flags: { arrived: true, sammunut_spawned: true, wood_1: true, wood_2: true } })
  wildsRespawn(t.state, t.world, { buildEntities })
  arriveTales(t.state, t.world, t.hooks, { fresh: true })
  const blue = firesOf(t.state).filter(f => f.eternal && f.fuel === 'greywood')
  assert.equal(blue.length, 2)
  for (const n of [1, 2]) { const h = hearth(t, n); assert.ok(blue.some(f => f.x === h.x && f.y === h.y)) }
  assert.equal(wraiths(t.state).length, 1)
})

// Task 8's review: the coachman by the village's cart keeps to his horse
test('the coachman lights no hearth and takes no grey wood for the flame-thief\'s village', () => {
  const t = setup('flame', '1,1')
  const man = t.state.entities.find(e => e.type === 'npc' && e.coachman && e.wildsKey === '0,0')
  assert.ok(man, 'the village has no coachman')
  // he alone is left of the village's people: nobody else can be sent
  t.state.entities = t.state.entities.filter(e => e === man || !villagers(t.state).includes(e))
  t.save.clock = NIGHT
  tickTales(t.state, t.world, 0.016, t.hooks)
  tickTales(t.state, t.world, 1, t.hooks)
  assert.ok(!man.chore, 'the coachman was sent to light a hearth')
  t.state.player.inventory.push(makeItem('greywood', 3))
  put(t.state, man, 1, 0)
  tickTales(t.state, t.world, DELIVERY_COOLDOWN + 0.1, t.hooks)
  assert.equal(t.state.player.inventory[0]?.count, 3, 'the coachman took the grey wood')
  assert.ok(!t.flags.wood_1)
})

// Review Focus 4
test('a fold village on the same screen lights no hearths and takes no grey wood', () => {
  let found = null
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const vs = villagesNear(seed, 0, 0, 10).filter(v => v.wx || v.wy)
    for (const a of vs) for (const b of vs) if (a !== b && !found && Math.max(Math.abs(a.wx - b.wx), Math.abs(a.wy - b.wy)) <= 2) found = { seed, a, b }
  }
  const { seed, a, b } = found
  const world = makeWorld(null, { seed })
  const ka = `${a.wx},${a.wy}`, kb = `${b.wx},${b.wy}`
  world.tales.set(ka, { id: 'flame', flags: { arrived: true, sammunut_spawned: true }, place: null, n: 0, nSide: 0, done: false })
  world.tales.set(kb, { id: 'fold', flags: {}, place: null, n: 0, nSide: 0, done: false })
  const state = { player: { x: 0, y: 0, px: 0, py: 0, hp: 10, maxHp: 10, talents: [], inventory: [], maxInventory: 20 }, entities: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {} }
  const save = { clock: NIGHT }
  const hooks = { getState: () => state, spawn: s => buildEntities(s), persist: () => {}, refreshInventory: () => {}, rollLoot: () => ({ type: 'potion', amount: 4 }), save: () => save, isNight: () => true, grantTalent: () => {} }
  enterWilds(state, world, { wx: Math.round((a.wx + b.wx) / 2), wy: Math.round((a.wy + b.wy) / 2) }, { buildEntities })
  arriveTales(state, world, hooks, { fresh: true })
  tickTales(state, world, 0.016, hooks)
  const of = k => state.entities.filter(e => e.type === 'npc' && ['villager', 'elder'].includes(e.species) && e.wildsKey === k)
  assert.equal(tended(state, of(ka)), 3)
  assert.equal(of(kb).filter(v => v.chore).length, 0, 'the fold\'s people were sent to light hearths')
  state.player.inventory.push(makeItem('greywood', 3))
  const stranger = of(kb)[0]
  Object.assign(state.player, { x: stranger.x + 1, y: stranger.y })
  tickTales(state, world, 3, hooks)
  assert.equal(state.player.inventory[0].count, 3, 'the fold\'s people took the grey wood')
})
