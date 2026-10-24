import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { BENCH_KIT, benchArenaConfig, respawnSpots, makeBenchCore, gateKeys } from '../tools/monster-bench/bench-core.js'
import { makeBenchModel } from '../tools/monster-bench/bench-state.js'
import { registerMonsters, clearMonsters, getMonsterDef } from '../renderer/systems/monsters.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'

const RIG = { PARAM_SCHEMA: [], drawMonster: () => {} }
const def = () => ({ tuning: {}, stats: { hp: 10, dmg: 2, speed: 60 }, behavior: { sightRange: 300 } })
const mkState = (hp = 10) => { const player = { hp, maxHp: 10 }; return { player, entities: [] } }

describe('observe', () => {
  it('invulnerable: tallies, deals nothing', () => {
    const m = makeBenchModel(def()); m.switches.invulnerable = true
    const core = makeBenchCore(m), s = mkState()
    assert.equal(core.observe(s, s.player, 3, 'hit'), 0)
    assert.deepEqual(core.tally, { taken: 3, deaths: 0 })
  })
  it('a normal hit passes through and is tallied', () => {
    const core = makeBenchCore(makeBenchModel(def())), s = mkState()
    assert.equal(core.observe(s, s.player, 3, 'hit'), 3)
    assert.equal(core.tally.taken, 3)
  })
  it('a killing blow refills hp and counts a death', () => {
    const core = makeBenchCore(makeBenchModel(def())), s = mkState(2)
    assert.equal(core.observe(s, s.player, 3, 'hit'), 0)
    assert.equal(s.player.hp, 10)
    assert.deepEqual(core.tally, { taken: 3, deaths: 1 })
  })
  it('ignores heroes other than state.player', () => {
    const core = makeBenchCore(makeBenchModel(def())), s = mkState()
    assert.equal(core.observe(s, { hp: 1, maxHp: 8 }, 3, 'hit'), 3)
    assert.deepEqual(core.tally, { taken: 0, deaths: 0 })
  })
})

describe('frameDelta / step', () => {
  it('paused returns null; step yields one 1/60 frame', () => {
    const m = makeBenchModel(def()); m.switches.paused = true
    const core = makeBenchCore(m)
    assert.equal(core.frameDelta(0.016), null)
    core.step()
    assert.equal(core.frameDelta(0.016), 1 / 60)
    assert.equal(core.frameDelta(0.016), null)
  })
  it('time scale multiplies delta', () => {
    const m = makeBenchModel(def()); m.switches.timeScale = 0.25
    assert.equal(makeBenchCore(m).frameDelta(0.04), 0.01)
  })
})

describe('isFrozen', () => {
  it('freezes only the bench monster, only when switched on', () => {
    const m = makeBenchModel(def()), core = makeBenchCore(m)
    assert.equal(core.isFrozen({ type: 'glorp' }, 'glorp'), false)
    m.switches.frozen = true
    assert.equal(core.isFrozen({ type: 'glorp' }, 'glorp'), true)
    assert.equal(core.isFrozen({ type: 'guard' }, 'glorp'), false)
  })
})

describe('respawn', () => {
  beforeEach(clearMonsters)
  it('retunes, removes the type, spawns count fresh', async () => {
    await registerMonsters([{ name: 'glorp', rig: 'r', stats: { hp: 10, speed: 60 } }], { loadRig: async () => RIG, loadHooks: async () => ({}), warn: () => {} })
    const m = makeBenchModel(getMonsterDef('glorp'))
    m.values.stats.speed = 120; m.values.stats.hp = 33; m.switches.count = 2
    const state = { entities: [{ type: 'glorp' }, { type: 'chest' }, { type: 'glorp' }] }
    const spawned = []
    makeBenchCore(m).respawn({ getState: () => state, spawn: list => spawned.push(...list) }, 'glorp')
    assert.deepEqual(state.entities, [{ type: 'chest' }])
    assert.deepEqual(spawned, [{ kind: 'glorp', x: 13, y: 7 }, { kind: 'glorp', x: 10, y: 7 }])
    assert.equal(getAIConfig({ type: 'glorp' }).speed, 120)
    assert.equal(getMonsterDef('glorp').stats.hp, 33)
  })
})

describe('arena config', () => {
  it('puts the monster 8 rows from the hero with the bench kit', () => {
    const c = benchArenaConfig('glorp', 1)
    assert.deepEqual(c.size, { w: 26, h: 18 })
    assert.deepEqual(c.enemies, [{ kind: 'glorp', x: 13, y: 7 }])
    assert.equal(c.player.y - c.enemies[0].y, 8)
    assert.equal(c.player.weaponType, 'sword')
    assert.deepEqual(BENCH_KIT.outfits, ['ranger', 'robe'])
  })
  it('respawnSpots clamps count to 1..7', () => {
    assert.equal(respawnSpots(0).length, 1)
    assert.equal(respawnSpots(99).length, 7)
    assert.deepEqual(respawnSpots(3).map(p => p.x), [13, 10, 16])
  })
})

describe('gateKeys', () => {
  // Bubbling stand-in: an event on the panel reaches the window unless the
  // panel stopped it.
  const fire = (root, win, ev) => { root.dispatchEvent(ev); if (!ev.cancelBubble) win.dispatchEvent(new Event(ev.type)) }
  it('focusing the panel clears held keys (a blur on the window)', () => {
    const root = new EventTarget(), win = new EventTarget()
    let blurs = 0; win.addEventListener('blur', () => blurs++)
    gateKeys(root, win)
    root.dispatchEvent(new Event('focusin'))
    assert.equal(blurs, 1)
  })
  it('typing in the panel never reaches the game', () => {
    const root = new EventTarget(), win = new EventTarget()
    const seen = []; win.addEventListener('keydown', e => seen.push(e.type)); win.addEventListener('keyup', e => seen.push(e.type))
    gateKeys(root, win)
    fire(root, win, new Event('keydown')); fire(root, win, new Event('keyup'))
    assert.deepEqual(seen, [])
  })
  it('a button or slider gives the keyboard back after use; a text field keeps it', () => {
    const root = new EventTarget(), win = new EventTarget()
    gateKeys(root, win)
    const blurred = []
    const target = type => ({ type, blur: () => blurred.push(type) })
    for (const type of ['submit', 'range', 'checkbox', 'number', 'text']) {
      const ev = new Event('pointerup'); Object.defineProperty(ev, 'target', { value: target(type) }); root.dispatchEvent(ev)
    }
    assert.deepEqual(blurred, ['submit', 'range', 'checkbox'])
  })
})
