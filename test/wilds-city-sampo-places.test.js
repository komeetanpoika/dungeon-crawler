// The Sampo of Kalevanlinna, part 2 (wilds/city/sampo-places.js, the lurker
// and Pohjan vahti hooks, sampo-run.js handovers): where the three pieces'
// places come to be, what is built there, their guardians, and the pieces
// changing hands in the city.
//
// Entities are compared by identity with assert.ok(a === b), never deep-equal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PIECES, PIECE_KINDS, SAMPO_PLACES, JAW, JAW_LINE, stageOf, questKey, namedLines, tellingFor, handover, crierDeeds, crierItem } from '../renderer/wilds/city/sampo.js'
import { admitSampo, fitsPiece, placeKeyOf, tickSampoPlaces, NO_BAIT, GLOOM_FADE } from '../renderer/wilds/city/sampo-places.js'
import { tickSampo } from '../renderer/wilds/city/sampo-run.js'
import { crierNews } from '../renderer/wilds/city/crier.js'
import { makeWorld, exportWorld, getPiece, sweep, GEN, FORGET_SECONDS } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { PIECE, pieceBiome, villageAt } from '../renderer/wilds/layout.js'
import { isCityPiece } from '../renderer/wilds/city/geometry.js'
import { LURKERS, updateLurker, hitLurker, ensureLurker, SINK_TIME } from '../renderer/systems/monsters/lurker.js'
import { inLight, DARK_THOUGHT } from '../renderer/systems/monsters/pohjanvahti.js'
import { hurtCreature, creatureAlpha } from '../renderer/systems/creatures.js'
import { weatherLook } from '../renderer/systems/weather.js'
import { makeCampfire } from '../renderer/systems/campfire.js'
import { makeItem, addItem } from '../renderer/systems/inventory.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeFeedback, tickFeedback, sayDuration } from '../renderer/systems/feedback.js'
import { isWalkable } from '../renderer/systems/entities.js'

const S = 32
const DT = 0.05
const SEEDS = [7, 4242]
const told = seed => { const w = makeWorld(null, { seed }); Object.assign(w.sampo.flags, { heard: true, mark: true, smith: true, gift: true }); return w }
const parse = key => { const [wx, wy] = key.split(',').map(Number); return { wx, wy } }
// the fitting piece nearest the city, as the first new land a walker that way comes to
function nearest(seed, kind) {
  const out = []
  for (let wy = -12; wy <= 14; wy++) for (let wx = -12; wx <= 12; wx++) if (fitsPiece(seed, kind, wx, wy)) out.push({ wx, wy })
  return out.sort((a, b) => Math.hypot(a.wx - 0.5, a.wy - 2.5) - Math.hypot(b.wx - 0.5, b.wy - 2.5))[0]
}

test('the three places come to be on Seppo\'s sides of the city, once he has named them', () => {
  for (const seed of SEEDS) for (const kind of PIECE_KINDS) {
    const p = nearest(seed, kind)
    assert.ok(p, `${kind} land near the city (seed ${seed})`)
    assert.equal(pieceBiome(seed, p.wx, p.wy), PIECES[kind].land)
    assert.ok(!isCityPiece(p.wx, p.wy) && !villageAt(seed, p.wx, p.wy) && Math.max(Math.abs(p.wx), Math.abs(p.wy)) > 1)
    const side = PIECES[kind].side
    assert.ok(side === 'south' ? p.wy >= 5 : side === 'north' ? p.wy <= 0 : p.wx <= -2, `${kind} lies ${side}`)
    assert.ok(Math.hypot(p.wx - 0.5, p.wy - 2.5) <= 9, `${kind} within a long walk (${p.wx},${p.wy})`)
    // not before Seppo has spoken
    const early = makeWorld(null, { seed }); early.sampo.flags.heard = true
    assert.deepEqual(admitSampo(early, [p]), [])
    const world = told(seed)
    // land already walked is no place; nor a village, the city, the ring round home
    world.records.set(`${p.wx},${p.wy}`, { gone: new Set(), felled: new Set(), lastSeen: 0 })
    assert.deepEqual(admitSampo(world, [p, { wx: 0, wy: 2 }, { wx: 0, wy: 0 }, { wx: 1, wy: 1 }]), [])
    world.records.clear()
    assert.deepEqual(admitSampo(world, [p]), [`${p.wx},${p.wy}`])
    assert.deepEqual(world.places.get(`${p.wx},${p.wy}`), { id: PIECES[kind].place, village: 'sampo', done: false })
    assert.equal(placeKeyOf(world, kind), `${p.wx},${p.wy}`)
    assert.deepEqual(admitSampo(world, [{ wx: p.wx, wy: p.wy + (side === 'north' ? -1 : 1) }, p]), [], 'one place a piece')
    // kept in a save, across a generator change, and not forgotten while its piece is wanted
    const saved = JSON.parse(JSON.stringify(exportWorld(world)))
    for (const s of [saved, { ...saved, gen: GEN - 1 }]) assert.equal(placeKeyOf(makeWorld(s), kind), `${p.wx},${p.wy}`)
    world.records.set(`${p.wx},${p.wy}`, { gone: new Set(), felled: new Set(), lastSeen: 0 })
    world.playtime = FORGET_SECONDS + 10
    world.origin = { wx: 40, wy: 40 }
    assert.ok(!sweep(world, 41, 41).includes(`${p.wx},${p.wy}`))
    world.places.get(`${p.wx},${p.wy}`).done = true
    assert.ok(sweep(world, 41, 41).includes(`${p.wx},${p.wy}`), 'forgotten like any land once the piece is home')
  }
  assert.deepEqual(SAMPO_PLACES, ['sampo_sea', 'sampo_mountain', 'sampo_marsh'])
})

// every walkable cell reachable on foot from `from`
function flood(cells, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const c = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy, k = `${x},${y}`, cell = cells[y]?.[x]
      if (!cell || seen.has(k) || !isWalkable(cell.tile, cell)) continue
      seen.add(k); q.push({ x, y })
    }
  }
  return seen
}

test('each place is built with its points, and can be walked from the piece\'s roads', () => {
  for (const seed of SEEDS) for (const kind of PIECE_KINDS) {
    const world = told(seed), p = nearest(seed, kind)
    admitSampo(world, [p])
    const piece = getPiece(world, p.wx, p.wy)
    assert.equal(piece.tale, PIECES[kind].place)
    const pts = Object.fromEntries(piece.points.map(q => [q.label, q]))
    const walk = c => { const cell = piece.cells[c.y]?.[c.x]; return !!cell && isWalkable(cell.tile, cell) }
    const msg = `${kind} seed ${seed} at ${p.wx},${p.wy}`
    const prize = kind === 'mountain' ? pts.vault : pts['pier end']
    assert.ok(prize && walk(prize), `${msg}: the piece's cell can be stood on`)
    const reach = flood(piece.cells, prize)
    // a way in from the piece's edge (every piece has a gate on each side)
    assert.ok([...reach].some(k => { const [x, y] = k.split(',').map(Number); return x <= 1 || y <= 1 || x >= PIECE - 2 || y >= PIECE - 2 }), `${msg}: reachable from the edge`)
    if (kind === 'mountain') {
      for (const n of [1, 2, 3]) {
        const b = pts[`brazier ${n}`]
        assert.ok(b && !walk(b), `${msg}: brazier ${n} stands`)
        assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has(`${b.x + dx},${b.y + dy}`)), `${msg}: brazier ${n} can be come beside`)
      }
      assert.ok(walk(pts.den))
    } else {
      assert.ok(walk(pts['pier bank']) && reach.has(`${pts['pier bank'].x},${pts['pier bank'].y}`), `${msg}: the pier is joined to the bank`)
      const lairs = piece.points.filter(q => q.label.startsWith('lair '))
      assert.ok(lairs.length >= 3, `${msg}: lair cells (${lairs.length})`)
      for (const l of lairs) {
        assert.ok(!walk(l), `${msg}: ${l.label} is water`)
        assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => reach.has(`${l.x + dx},${l.y + dy}`)), `${msg}: ${l.label} is a step off the planks`)
      }
    }
  }
})

// ---- the guardians ------------------------------------------------------------------

const water = () => ({
  player: { x: 5, y: 5, px: 5 * S + 16, py: 5 * S + 16, hp: 9, maxHp: 9, inventory: [], facing: 'east' },
  entities: [], feedback: makeFeedback(), sfx: { cues: [], muted: false }, map: [],
})
const lurker = (type, hp) => ({ type, x: 0, y: 0, px: 16, py: 16, hp, maxHp: hp, lurkSpots: [{ x: 6, y: 5 }, { x: 12, y: 5 }], lurkPier: { x: 5, y: 5 } })
const runFor = (e, state, seconds, each) => { for (let t = 0; t < seconds - 1e-9; t += DT) { updateLurker(e, state, DT); each?.() } }

test('Iku-Turso rises beside whoever walks his pier, bites, and can be struck only while he is up', () => {
  const state = water(), cfg = LURKERS.ikuturso
  const e = lurker('ikuturso', 14)
  state.entities.push(e)
  state.player.x = 30; state.player.px = 30 * S + 16
  runFor(e, state, 3)
  assert.equal(e.lurk.state, 'under', 'nobody near: he stays down')
  assert.equal(creatureAlpha(e), 0, 'and unseen')
  assert.deepEqual(hurtCreature(state, e, 3), { absorbed: true, cue: null, think: undefined, killed: false })
  assert.equal(e.hp, 14)
  state.player.x = 5; state.player.px = 5 * S + 16
  runFor(e, state, cfg.rise + 0.1)
  assert.equal(e.lurk.state, 'up')
  assert.ok(e.x === 6 && e.y === 5, 'at the lair cell nearest the player')
  assert.equal(e.sink, 0)
  assert.equal(state.player.hp, 9, 'a moment to step back before he bites')
  runFor(e, state, cfg.biteAfter)
  assert.equal(state.player.hp, 9 - cfg.bite, 'then he bites whoever is still beside him')
  assert.equal(hurtCreature(state, e, 2).absorbed, false)
  assert.equal(e.hp, 12)
  assert.equal(e.lurk.state, 'up', 'a light blow does not send him down')
  hurtCreature(state, e, 2)
  assert.equal(e.lurk.state, 'sinking', 'enough for one rising')
  assert.equal(hurtCreature(state, e, 3).absorbed, true)
  runFor(e, state, SINK_TIME + 0.1)
  assert.equal(e.lurk.state, 'under')
  // he comes again, and dies like anything else
  runFor(e, state, cfg.down + cfg.rise + 0.2)
  assert.equal(e.lurk.state, 'up')
  e.hp = 2
  const r = hurtCreature(state, e, 2)
  assert.ok(r.killed && state.creatureKills.ikuturso)
  // two steps back along the planks is out of his reach
  const far = lurker('ikuturso', 14), s3 = water()
  runFor(far, s3, 1.2 + cfg.rise)
  s3.player.x = 3; s3.player.px = 3 * S + 16
  runFor(far, s3, cfg.up - 0.2)
  assert.equal(s3.player.hp, 9)
  // left alone he goes down by himself
  const f = lurker('ikuturso', 14), s2 = water()
  s2.player.hp = 99
  runFor(f, s2, 1.2 + cfg.rise + cfg.up + 0.2)
  assert.ok(f.lurk.state === 'sinking' || f.lurk.state === 'under')
})

test('the great pike rises for meat held at the pier\'s end, and takes one blow a rising', () => {
  const state = water(), cfg = LURKERS.hauki
  const e = lurker('hauki', 3)
  runFor(e, state, 3)
  assert.equal(e.lurk.state, 'under', 'not for nothing')
  addItem(state.player, makeItem('meat', 2))
  state.player.x = 4
  runFor(e, state, 2)
  assert.equal(e.lurk.state, 'under', 'not a step short of the end')
  state.player.x = 5
  runFor(e, state, cfg.rise + 0.2)
  assert.equal(e.lurk.state, 'up')
  assert.equal(state.player.inventory.find(i => i.kind === 'meat').count, 1, 'it takes one cut')
  assert.equal(state.player.hp, 9, 'it does not bite')
  assert.equal(hurtCreature(state, e, 5).absorbed, false)
  assert.equal(e.hp, 2, 'one blow is one blow, whatever the blade')
  assert.equal(e.lurk.state, 'sinking')
  runFor(e, state, SINK_TIME + cfg.down + cfg.rise + 0.3)
  assert.equal(e.lurk.state, 'up')
  assert.ok(!state.player.inventory.some(i => i.kind === 'meat'), 'the second cut')
  hurtCreature(state, e, 1)
  runFor(e, state, 6)
  assert.equal(e.lurk.state, 'under', 'no meat left: it stays down')
  assert.equal(e.hp, 1)
  ensureLurker(e).state = 'up'
  assert.ok(hurtCreature(state, e, 1).killed)
  assert.equal(hitLurker.length, 3)
})

test('Pohjan vahti cannot be hurt out of firelight', () => {
  const state = { ...water(), fireZones: [] }
  const e = { type: 'pohjanvahti', x: 10, y: 10, px: 10 * S + 16, py: 10 * S + 16, hp: 16, maxHp: 16 }
  state.entities.push(e)
  assert.equal(inLight(e, state), false)
  const r = hurtCreature(state, e, 4)
  assert.deepEqual([r.absorbed, r.think, e.hp], [true, DARK_THOUGHT, 16])
  assert.equal(hurtCreature(state, e, 4).think, undefined, 'the thought once')
  state.entities.push(makeCampfire(12, 10))
  assert.equal(inLight(e, state), true)
  assert.equal(hurtCreature(state, e, 4).absorbed, false)
  assert.equal(e.hp, 12)
  state.entities.pop()
  state.entities.push(makeCampfire(20, 10))
  assert.equal(hurtCreature(state, e, 4).absorbed, true, 'too far from the fire')
  e.px = 18 * S; e.hp = 3
  assert.ok(hurtCreature(state, e, 4).killed)
})

test('a place dark at any hour: the gloom is night as far as it reaches', () => {
  const state = { weather: { dayCycle: true, t: 0, lightningT: 0 }, entities: [makeCampfire(3, 3)] }
  const noon = { clock: 0.45 * 360 }
  const day = weatherLook(state, noon)
  assert.ok(day.dark < 0.05)
  state.gloom = 1
  const dark = weatherLook(state, noon)
  assert.ok(dark.dark >= 0.8 && dark.lights.length === 1, 'dark at noon, and a fire shows in it')
  assert.ok(dark.ambient[0] < 80)
  state.gloom = 0.5
  const half = weatherLook(state, noon)
  assert.ok(half.dark > 0.3 && half.dark < dark.dark && half.ambient[0] > dark.ambient[0] && half.ambient[0] < 255)
  state.gloom = 0
  assert.deepEqual(weatherLook(state, noon), day)
})

// ---- at the places, in a real window --------------------------------------------------

const GUARD_HP = { ikuturso: 14, hauki: 3, pohjanvahti: 16 }
const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') { const n = makeNpc(s); return n ? [n] : [] }
  const e = { type: s.kind === 'floating_pickup' ? 'floating_item' : s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }
  if (s.contents) e.contents = s.contents
  if (GUARD_HP[s.kind]) e.hp = e.maxHp = GUARD_HP[s.kind]
  return [e]
})
function arrive(seed, kind) {
  const world = told(seed), near = nearest(seed, kind)
  const state = {
    player: { x: 0, y: 0, px: 0, py: 0, hp: 9, maxHp: 9, facing: 'south', inventory: [] }, entities: [], projectiles: [], zones: [],
    fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(),
    caveInstances: {}, sfx: { cues: [], muted: false },
  }
  enterWilds(state, world, { X: near.wx * PIECE + 40, Y: near.wy * PIECE + 40 }, { buildEntities })
  // walking there makes new land of that country the place (a village's tale may have taken the very nearest)
  const key = placeKeyOf(world, kind)
  assert.ok(key, `a place for the ${kind} piece in the window`)
  const p = parse(key)
  assert.ok(fitsPiece(seed, kind, p.wx, p.wy) && Math.max(Math.abs(p.wx - near.wx), Math.abs(p.wy - near.wy)) <= 1)
  const piece = getPiece(world, p.wx, p.wy)
  const at = label => { const q = piece.points.find(q => q.label === label); return { x: (p.wx - world.origin.wx) * PIECE + q.x, y: (p.wy - world.origin.wy) * PIECE + q.y } }
  const saves = []
  const hooks = { spawn: buildEntities, persist: () => saves.push({ ...world.sampo.flags }), refreshInventory: () => {} }
  const put = c => Object.assign(state.player, { x: c.x, y: c.y, px: c.x * S + 16, py: c.y * S + 16 })
  const tick = (seconds = DT) => { for (let t = 0; t < seconds - 1e-9; t += DT) { tickSampoPlaces(state, world, DT, hooks); tickFeedback(state.feedback, DT) } }
  const guard = () => state.entities.find(e => e.type === PIECES[kind].guardian)
  const slay = () => { const g = guard(); state.creatureKills = { ...state.creatureKills, [g.type]: true }; state.entities = state.entities.filter(e => e !== g) }
  const lies = item => state.entities.filter(e => e.type === 'floating_item' && e.contents?.type === item)
  return { world, state, hooks, saves, at, put, tick, guard, slay, lies, p }
}

test('the sea: Turso keeps the pier until he is beaten; the wheel then lies at its end, and again if lost', () => {
  const c = arrive(7, 'sea'), { state, world } = c
  c.put(c.at('pier bank'))
  c.tick()
  const g = c.guard()
  assert.ok(g && g.sampoKey === 'sea' && g.taleKey === 'sampo:sea')
  assert.ok(g.lurkSpots.length >= 3 && g.lurkPier.x === c.at('pier end').x)
  assert.equal(state.feedback.bubble?.kind, 'thought', 'a thought on coming to the water')
  c.tick(1)
  assert.equal(state.entities.filter(e => e.type === 'ikuturso').length, 1, 'one Turso')
  assert.equal(world.sampo.flags.won_sea, undefined)
  // gone without a kill (carried off with a leaving piece): he is there again, and nothing is won
  state.entities = state.entities.filter(e => e !== g)
  c.tick()
  assert.ok(c.guard() && c.guard() !== g && !world.sampo.flags.won_sea)
  c.slay()
  c.tick()
  assert.equal(world.sampo.flags.won_sea, true)
  assert.equal(c.lies('sampo_sea').length, 1)
  const piece = c.lies('sampo_sea')[0], end = c.at('pier end')
  assert.ok(Math.max(Math.abs(piece.x - end.x), Math.abs(piece.y - end.y)) <= 1, 'at the pier\'s end')
  assert.deepEqual(c.saves.at(-1).won_sea, true)
  c.tick(1)
  assert.equal(c.guard(), undefined, 'beaten for good')
  assert.equal(c.lies('sampo_sea').length, 1)
  // picked up: not laid twice; lost again and the place seen anew: there once more
  state.entities = state.entities.filter(e => e !== piece)
  addItem(state.player, makeItem('sampo_sea'))
  c.tick(1)
  assert.equal(c.lies('sampo_sea').length, 0)
  state.player.inventory.length = 0
  delete world._sampoPlaces.sea   // the place left the window and came back
  c.tick()
  assert.equal(c.lies('sampo_sea').length, 1)
  assert.equal(crierDeeds(world).length, 1)
  assert.ok(crierNews(world, 7, 3).includes(crierDeeds(world)[0]))
})

test('the marsh: the pike wants meat, and leaves the hopper and its jawbone', () => {
  const c = arrive(7, 'marsh'), { state, world } = c
  c.put(c.at('pier bank'))
  c.tick()
  assert.ok(c.guard()?.lurkSpots.length === 1)
  c.tick(4)
  c.put(c.at('pier end'))
  c.guard().lurk = { state: 'under', t: 0, taken: 0, biteT: 0 }
  c.tick()
  assert.equal(state.feedback.bubble?.text, NO_BAIT)
  c.slay()
  c.tick()
  assert.equal(world.sampo.flags.won_marsh, true)
  assert.deepEqual([c.lies('sampo_marsh').length, c.lies(JAW).length], [1, 1])
  const spots = new Set([...c.lies('sampo_marsh'), ...c.lies(JAW)].map(e => `${e.x},${e.y}`))
  assert.equal(spots.size, 2, 'side by side, not one on the other')
})

test('the copper mountain: dark at noon, braziers that light for whoever comes beside them, and the stone when the watch falls', () => {
  const c = arrive(7, 'mountain'), { state, world } = c
  c.put(c.at('vault'))
  c.tick(GLOOM_FADE + 0.2)
  assert.equal(state.gloom, 1, 'full dark in the bowl')
  assert.ok(c.guard() && c.guard().taleKey === 'sampo:mountain')
  const b = c.at('brazier 1')
  const onBraziers = () => state.entities.filter(e => e.type === 'campfire' && [1, 2, 3].some(n => e.x === c.at(`brazier ${n}`).x && e.y === c.at(`brazier ${n}`).y))
  assert.equal(onBraziers().length, 0, 'cold until someone comes')
  c.put({ x: b.x, y: b.y + 1 })
  c.tick(0.5)
  const fires = onBraziers()
  assert.ok(fires.length === 1 && fires[0].x === b.x && fires[0].y === b.y && !fires[0].eternal && !fires[0].hearth, 'one fire on the brazier, an ordinary one')
  assert.ok(inLight({ px: b.x * S + 16, py: (b.y + 2) * S + 16 }, state))
  c.slay()
  c.tick()
  assert.equal(world.sampo.flags.won_mountain, true)
  assert.equal(c.lies('sampo_mountain').length, 1)
  c.tick(GLOOM_FADE + 0.2)
  assert.equal(state.gloom, 0, 'the dark lifts')
  // far off the gloom never reached
  const d = arrive(4242, 'mountain')
  d.put({ x: d.at('vault').x + 60, y: d.at('vault').y })
  d.tick(GLOOM_FADE + 0.2)
  assert.equal(d.state.gloom, 0)
})

// ---- back in the city -----------------------------------------------------------------

function smithy(world) {
  const seppo = makeNpc({ species: 'townsfolk', id: 'named:seppo', x: 5, y: 3 })
  const vaino = makeNpc({ species: 'townsfolk', id: 'named:vaino', x: 15, y: 3 })
  const state = {
    player: { x: 9, y: 6, px: 9 * S + 16, py: 6 * S + 16, inventory: [] }, entities: [seppo, vaino], feedback: makeFeedback(), sfx: { cues: [], muted: false },
    map: Array.from({ length: 10 }, () => Array.from({ length: 20 }, () => ({ tile: 1 }))),
  }
  const hooks = { spawn: buildEntities, persist: () => {}, refreshInventory: () => {} }
  const tick = (seconds = DT) => { for (let t = 0; t < seconds - 1e-9; t += DT) { tickSampo(state, world, DT, hooks); tickFeedback(state.feedback, DT) } }
  const put = (x, y) => Object.assign(state.player, { x, y, px: x * S + 16, py: y * S + 16 })
  return { state, seppo, vaino, tick, put }
}

test('the pieces change hands: one at a time at Seppo\'s side, and the third brings what the Sampo still wants', () => {
  const world = told(7)
  for (const k of PIECE_KINDS) { world.sampo.flags[`won_${k}`] = true; world.places.set(`9,${PIECE_KINDS.indexOf(k)}`, { id: PIECES[k].place, village: 'sampo', done: false }) }
  const { state, seppo, vaino, tick, put } = smithy(world)
  addItem(state.player, makeItem('sampo_marsh')); addItem(state.player, makeItem('sampo_sea')); addItem(state.player, makeItem(JAW)); addItem(state.player, makeItem('meat'))
  tick(0.5)
  assert.equal(state.player.inventory.length, 4, 'not from across the yard')
  put(5, 4)
  tick()
  assert.equal(world.sampo.flags.sea, true, 'in the story\'s order of pieces, one a visit to his elbow')
  assert.equal(world.sampo.flags.marsh, undefined)
  assert.equal(state.feedback.bubble.text, handover('sea'))
  assert.ok(state.feedback.bubble.anchorId === seppo.id)
  assert.equal(world.places.get('9,0').done, true, 'its place may be forgotten')
  assert.equal(questKey(world), 'pieces/sea')
  assert.ok(namedLines('seppo', questKey(world))[0].includes('mountain') && !namedLines('seppo', questKey(world))[0].includes('sea,'))
  tick(sayDuration(handover('sea')) + 0.2)
  assert.equal(world.sampo.flags.marsh, true, 'the next when his line is done')
  assert.equal(state.feedback.bubble.text, handover('marsh'))
  assert.ok(!state.player.inventory.some(i => i.kind.startsWith('sampo')) && state.player.inventory.length === 2)
  assert.equal(stageOf(world), 'pieces')
  assert.equal(tellingFor('named:seppo', world), null)
  // Väinö takes the jawbone
  tick(sayDuration(handover('marsh')) + 0.2)
  put(15, 4)
  tick()
  assert.equal(world.sampo.flags.jaw, true)
  assert.equal(state.feedback.bubble.text, JAW_LINE)
  assert.ok(state.feedback.bubble.anchorId === vaino.id)
  assert.deepEqual(state.player.inventory.map(i => i.kind), ['meat'])
  assert.equal(questKey(world), 'pieces/sea,marsh,jaw')
  assert.ok(namedLines('vaino', questKey(world))[0].includes('pike'))
  // the third
  tick(sayDuration(JAW_LINE) + 0.2)
  addItem(state.player, makeItem('sampo_mountain'))
  put(5, 4)
  tick()
  assert.equal(world.sampo.flags.mountain, true)
  assert.ok(state.telling && state.telling.sets === 'three')
  tick(0.2)
  assert.equal(state.feedback.bubble.text, handover('mountain'))
  tick(60)
  assert.equal(world.sampo.flags.three, true)
  assert.equal(stageOf(world), 'words')
  assert.equal(state.telling, null)
  assert.ok(/words/.test(crierItem(world)))
  assert.ok(namedLines('seppo', questKey(world)).some(l => /Väinö/.test(l)))
  // walked off before he had done: asking him brings it again
  const again = told(7); Object.assign(again.sampo.flags, { sea: true, mountain: true, marsh: true })
  assert.equal(tellingFor('named:seppo', again).sets, 'three')
})
