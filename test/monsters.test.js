import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registerMonsters, clearMonsters, getMonsterDef, monsterNames, monstersForDepth,
         makeMonsterFromDef, updateMonsterPose, entityPose, drawGeneratedMonster, monstersForOpenMap,
         isStoryCreature, tuningOf, retuneMonster, drawMonsterFx } from '../renderer/systems/monsters.js'
import { schemaErrors } from '../renderer/render/monster-rigs/schema.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'
import { isEnemy } from '../renderer/systems/factions.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { hurtCreature } from '../renderer/systems/creatures.js'
import { tryStartEnemyAttack, stepEnemyAttack, getEnemyWeapon, WEAPONS } from '../renderer/systems/enemy-attack.js'
import { makeCutoutRig, pieceTransforms } from '../renderer/render/monster-rigs/cutout.js'
import { ensureHirvi, startBolt, updateHirvi, makeStand } from '../renderer/systems/monsters/hirvi.js'

const FAKE_RIG = {
  RIG_ID: 'fakerig',
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
}
const rigLoader = table => async id => { if (!table[id]) throw new Error('no rig'); return table[id] }
const DEF = { name: 'boarhound', rig: 'fakerig', params: { size: 5 },
              stats: { hp: 30, dmg: 8, speed: 85, half: 10 },
              behavior: { sightRange: 260 }, spawn: { depths: [3, 5], weight: 2 } }
const load = (defs, opts = {}) =>
  registerMonsters(defs, { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => {}, warn: () => {}, ...opts })

describe('registerMonsters', () => {
  beforeEach(clearMonsters)
  it('loads a def: clamped params, stat defaults, AI row, spawn pool', async () => {
    assert.equal(await load([DEF]), 1)
    const d = getMonsterDef('boarhound')
    assert.equal(d.params.size, 2)                       // clamped 5 -> max 2
    assert.equal(d.stats.hp, 30)
    assert.deepEqual(monsterNames(), ['boarhound'])
    assert.equal(getAIConfig({ type: 'boarhound' }).sightRange, 260)
    assert.equal(getAIConfig({ type: 'boarhound' }).speed, 85)  // stats.speed feeds the row
    assert.deepEqual(monstersForDepth(4), [{ name: 'boarhound', weight: 2 }])
    assert.deepEqual(monstersForDepth(6), [])
  })
  it('skips a def whose rig is missing, warns, loads the rest', async () => {
    const warnings = []
    const n = await load([{ ...DEF, rig: 'ghost' }, { ...DEF, name: 'ok' }], { warn: m => warnings.push(m) })
    assert.equal(n, 1)
    assert.equal(getMonsterDef('boarhound'), null)
    assert.ok(getMonsterDef('ok'))
    assert.ok(warnings.some(w => w.includes('ghost')))
  })
  it('rejects bad names', async () => {
    assert.equal(await load([{ ...DEF, name: '../evil' }]), 0)
  })
  it('skips a reserved built-in name, warns, loads the rest', async () => {
    const warnings = []
    const n = await load([{ ...DEF, name: 'monster' }, { ...DEF, name: 'ok' }], { warn: m => warnings.push(m) })
    assert.equal(n, 1)
    assert.equal(getMonsterDef('monster'), null)
    assert.ok(getMonsterDef('ok'))
    assert.ok(warnings.some(w => w.includes('monster') && w.includes('reserved')))
  })
  it('__proto__ name: stored as own key, cleared by clearMonsters', async () => {
    assert.equal(await load([{ ...DEF, name: '__proto__' }]), 1)
    const d = getMonsterDef('__proto__')
    assert.ok(d)
    assert.ok(monsterNames().includes('__proto__'))
    assert.ok(Object.prototype.hasOwnProperty.call(d, 'name'))
    clearMonsters()
    assert.equal(getMonsterDef('__proto__'), null)
    assert.ok(!monsterNames().includes('__proto__'))
  })
  it('a failing hooks module is non-fatal — the def still registers', async () => {
    const n = await registerMonsters([{ ...DEF, hooks: true }],
      { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => { throw new Error('boom') }, warn: () => {} })
    assert.equal(n, 1)
    assert.ok(getMonsterDef('boarhound'))
  })

  // The three leap-episode creatures are ordinary registry monsters now: the
  // defs on disk must load against the real rigs with no warnings, and the
  // driver/passive flags they carry are what game.js and factions read.
  it('the three story creature defs on disk load against their rigs', async () => {
    const fs = await import('node:fs')
    const defs = ['nakki', 'maahinen', 'sammunut'].map(n => JSON.parse(fs.readFileSync(`renderer/data/monsters/${n}.json`, 'utf8')))
    const rigs = { quadruped: await import('../renderer/render/monster-rigs/quadruped.js'),
                   lurker: await import('../renderer/render/monster-rigs/lurker.js'),
                   serpent: await import('../renderer/render/monster-rigs/serpent.js'),
                   wraith: await import('../renderer/render/monster-rigs/wraith.js') }
    assert.equal(await registerMonsters(defs, { loadRig: async id => rigs[id], loadHooks: async () => {}, warn: m => { throw new Error(m) } }), 3)
    assert.equal(getMonsterDef('nakki').behavior.passive, true)
    assert.equal(isStoryCreature({ type: 'maahinen' }), true)
    assert.equal(isEnemy({ type: 'nakki' }), false)
    assert.equal(isEnemy({ type: 'maahinen' }), true)
  })
})

describe('makeMonsterFromDef', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  it('builds the entity from stats', () => {
    assert.deepEqual(makeMonsterFromDef('boarhound', 4, 5),
      { type: 'boarhound', x: 4, y: 5, hp: 30, maxHp: 30, damage: 8, inCombat: false })
  })
  it('null for unknown names', () => assert.equal(makeMonsterFromDef('nosuch', 0, 0), null))
})

describe('updateMonsterPose / entityPose', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  const ent = () => ({ ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 })
  it('starts idle, seeds deterministically from the spawn tile', () => {
    const a = ent(), b = ent()
    updateMonsterPose(a, 0.016); updateMonsterPose(b, 0.016)
    assert.equal(entityPose(a).state, 'idle')
    assert.equal(entityPose(a).seed, entityPose(b).seed)
  })
  it('movement -> walk with speed01 and facing from velocity', () => {
    const e = ent()
    updateMonsterPose(e, 0.016)
    e.px += 85 * 0.016            // one frame at full configured speed, +x
    updateMonsterPose(e, 0.016)
    const p = entityPose(e)
    assert.equal(p.state, 'walk')
    assert.ok(p.speed01 > 0.9 && p.speed01 <= 1)
    assert.ok(Math.abs(p.facing) < 0.01)
  })
  it('hp drop -> hit for a flash, then back; attack flag -> attack; hp<=0 -> death', () => {
    const e = ent()
    updateMonsterPose(e, 0.016)
    e.hp -= 5
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'hit')
    updateMonsterPose(e, 0.5)                 // flash expires
    assert.equal(entityPose(e).state, 'idle')
    e.attack = { swing: 1 }
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'attack')
    delete e.attack; e.hp = 0
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'death')
  })
  it('stateT accumulates within a state and resets on change', () => {
    const e = ent()
    updateMonsterPose(e, 0.016); updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).stateT > 0.016)
    e.hp -= 1; updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).stateT <= 0.016)
  })
})

describe('rig-derived hitbox', () => {
  beforeEach(clearMonsters)
  it('uses rig.hitHalf(params) over the def stats.half for collision and AI clearance', async () => {
    const rig = { ...FAKE_RIG, hitHalf: params => 21 + (params.size === 2 ? 1 : 0) }
    await registerMonsters([{ ...DEF, params: { size: 5 } }],   // size clamps to 2
      { loadRig: async () => rig, loadHooks: async () => {}, warn: () => {} })
    assert.equal(getMonsterDef('boarhound').stats.half, 22)     // derived, not DEF's 10
    assert.equal(getAIConfig({ type: 'boarhound' }).half, 22)
  })
  it('falls back to stats.half for rigs without hitHalf', async () => {
    await registerMonsters([DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })
    assert.equal(getMonsterDef('boarhound').stats.half, 10)
  })
})

describe('pose passthrough for hooks', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  it('entityPose carries headAim and eyeGlow written into e.pose by a hook', () => {
    const e = { ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 }
    updateMonsterPose(e, 0.016)
    e.pose.headAim = 0.7
    e.pose.eyeGlow = 0.5
    const p = entityPose(e)
    assert.equal(p.headAim, 0.7)
    assert.equal(p.eyeGlow, 0.5)
  })
  it('eyeGlow defaults to 0 when no hook wrote it', () => {
    const e = { ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 }
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).eyeGlow, 0)
  })
})

describe('laser beam rendering', () => {
  beforeEach(clearMonsters)
  it('draws beam segments when a hook has a fire-state laser on the entity', async () => {
    const rig = { ...FAKE_RIG, eyeAnchors: () => ({ pivot: { x: 0, y: -5 }, eyes: [{ x: -2, y: -3 }, { x: 2, y: -3 }] }) }
    await registerMonsters([DEF], { loadRig: async () => rig, loadHooks: async () => {}, warn: () => {} })
    const mk = () => ({ ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 })
    const quiet = { ops: [] }, firing = { ops: [] }
    const proxy = t => new Proxy(t, {
      get(o, k) { if (k in o) return o[k]; return (...a) => { o.ops.push([k, ...a]) } },
      set(o, k, v) { o[k] = v; return true },
    })
    const a = mk()
    updateMonsterPose(a, 0.016)
    drawGeneratedMonster(proxy(quiet), a, 100, 100, 32, {})
    const b = mk()
    updateMonsterPose(b, 0.016)
    b.laser = { state: 'fire', beams: [{ ang: 0 }] }
    drawGeneratedMonster(proxy(firing), b, 100, 100, 32, {})
    const rects = o => o.ops.filter(x => x[0] === 'fillRect').length
    assert.ok(rects(firing) > rects(quiet) + 10, `expected many beam rects, got ${rects(firing)} vs ${rects(quiet)}`)
  })
})

describe('tentacle rendering', () => {
  beforeEach(clearMonsters)
  const proxy = t => new Proxy(t, {
    get(o, k) { if (k in o) return o[k]; return (...a) => { o.ops.push([k, ...a]) } },
    set(o, k, v) { o[k] = v; return true },
  })
  const rects = o => o.ops.filter(x => x[0] === 'fillRect').length
  it('draws writhing stubs on a rooted lasher, and a long tentacle while it lashes', async () => {
    await registerMonsters([DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })
    const mk = () => { const e = { ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 }; updateMonsterPose(e, 0.016); return e }
    const quiet = { ops: [] }, rooted = { ops: [] }, lashing = { ops: [] }
    drawGeneratedMonster(proxy(quiet), mk(), 100, 100, 32, {})
    const b = mk(); b.stones = 6; b.lash = { state: 'idle', len: 0, t: 0 }
    drawGeneratedMonster(proxy(rooted), b, 100, 100, 32, {})
    const c = mk(); c.stones = 6; c.lash = { state: 'extend', aim: 0, len: 128, t: 0.3 }
    drawGeneratedMonster(proxy(lashing), c, 100, 100, 32, {})
    assert.ok(rects(rooted) > rects(quiet) + 8, `stubs: ${rects(rooted)} vs ${rects(quiet)}`)
    assert.ok(rects(lashing) > rects(rooted) + 20, `lash: ${rects(lashing)} vs ${rects(rooted)}`)
    const far = lashing.ops.filter(x => x[0] === 'fillRect' && x[1] > 64)   // two tiles out, well past any body
    assert.ok(far.length > 10, `the tentacle runs out past the body along the aim (${far.length} far rects)`)
  })
  it('varies the shade from segment to segment, so the flesh is mottled rather than flat', async () => {
    await registerMonsters([DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })
    const e = { ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 }
    updateMonsterPose(e, 0.016)
    e.stones = 6; e.lash = { state: 'extend', aim: 0, len: 160, t: 0.3 }
    const fills = new Set()
    const ctx = new Proxy({ ops: [] }, {
      get(o, k) { if (k in o) return o[k]; return (...a) => { if (k === 'fillRect') fills.add(o.fillStyle); o.ops.push([k, ...a]) } },
      set(o, k, v) { o[k] = v; return true },
    })
    drawGeneratedMonster(ctx, e, 100, 100, 32, {})
    assert.ok(fills.size >= 5, `expected outline, tip and at least three flesh shades, got ${fills.size}: ${[...fills].join(' ')}`)
  })
})

describe('monstersForOpenMap', () => {
  beforeEach(clearMonsters)
  const om = (name, depths, count) => ({ ...DEF, name, spawn: { ...DEF.spawn, openMaps: { depths, count } } })
  it('lists monsters whose openMaps range covers the depth, with counts', async () => {
    await load([om('aa', [7, 14], 3), om('bb', [11, 18], 2), { ...DEF, name: 'cc' }])
    assert.deepEqual(monstersForOpenMap(12), [{ name: 'aa', count: 3 }, { name: 'bb', count: 2 }])
    assert.deepEqual(monstersForOpenMap(7), [{ name: 'aa', count: 3 }])
    assert.deepEqual(monstersForOpenMap(18), [{ name: 'bb', count: 2 }])
    assert.deepEqual(monstersForOpenMap(19), [])
  })
  it('always excludes the leap story maps (depths 8-10)', async () => {
    await load([om('aa', [7, 14], 3)])
    for (const d of [8, 9, 10]) assert.deepEqual(monstersForOpenMap(d), [], `depth ${d}`)
  })
  it('count defaults to 1', async () => {
    await load([{ ...DEF, spawn: { openMaps: { depths: [7, 18] } } }])
    assert.deepEqual(monstersForOpenMap(12), [{ name: 'boarhound', count: 1 }])
  })
})

describe('entityPose channels', () => {
  it('passes sink/burn/flicker through from the entity, defaulting to 0', () => {
    assert.deepEqual([entityPose({}).sink, entityPose({}).burn, entityPose({}).flicker], [0, 0, 0])
    const p = entityPose({ sink: 0.5, burn: 0.25, flicker: 1 })
    assert.deepEqual([p.sink, p.burn, p.flicker], [0.5, 0.25, 1])
  })
})

describe('isStoryCreature', () => {
  beforeEach(clearMonsters)
  it('is true only for a registry def with behavior.driver === "hook"', async () => {
    await load([{ ...DEF, name: 'hooked', behavior: { driver: 'hook' } }, { ...DEF, name: 'plain' }])
    assert.equal(isStoryCreature({ type: 'hooked' }), true)
    assert.equal(isStoryCreature({ type: 'plain' }), false)
    assert.equal(isStoryCreature({ type: 'guard' }), false)
  })
})

describe('brainDriven opt-out', () => {
  beforeEach(clearMonsters)
  it('a story creature that hands control back is no longer story-driven', async () => {
    await load([{ ...DEF, name: 'testhook', behavior: { driver: 'hook' } }])
    assert.equal(isStoryCreature({ type: 'testhook' }), true)
    assert.equal(isStoryCreature({ type: 'testhook', brainDriven: true }), false)
  })
})

// The real spawn path: the game builds the elk through buildEntities's
// default case into makeMonsterFromDef, never through hirvi.js's own
// makeHirvi — every other hirvi suite drives makeHirvi or a hand-rolled
// literal instead, which is how Finding 1 (a standing elk with no weaponId)
// survived six task reviews. This registers the actual on-disk def against
// its actual rig and hook module (registerMonsters' defaults resolve both
// relative to systems/monsters.js, the same way the game's own boot does)
// and drives the entity makeMonsterFromDef hands back through the real
// lifecycle.
// behavior.weapon is the def-level arm: makeMonsterFromDef stamps it as the
// entity's weaponId (the same rule npc.js applies to a species' `weapon`), so
// no hook module has to remember to — the class of bug behind Finding 1.
describe('behavior.weapon', () => {
  beforeEach(clearMonsters)
  it('makeMonsterFromDef stamps weaponId from the def, and nothing without one', async () => {
    await load([{ ...DEF, behavior: { ...DEF.behavior, weapon: 'claw' } }])
    assert.equal(makeMonsterFromDef('boarhound', 1, 1).weaponId, 'claw')
    clearMonsters()
    await load([DEF])
    assert.equal('weaponId' in makeMonsterFromDef('boarhound', 1, 1), false)
  })
  it('every hook monster that fights carries its weapon on the def', () => {
    for (const name of ['hirvi', 'maahinen', 'kivihiisi']) {
      const def = JSON.parse(fs.readFileSync(`renderer/data/monsters/${name}.json`, 'utf8'))
      assert.equal(def.behavior.weapon, 'maul', name)
    }
  })
})

// A lair's boss spawn ({ isBoss: true }, map.js placeTemplate) reaches a
// registry monster through buildEntities's default case, so the flag has to
// survive makeMonsterFromDef — the boss gate (countBosses) and the key drop
// read it off the entity.
describe('a registry monster spawned as a boss', () => {
  beforeEach(clearMonsters)
  it('carries isBoss from the spawn, and only from the spawn', async () => {
    await load([DEF])
    assert.equal(makeMonsterFromDef('boarhound', 1, 1, { isBoss: true }).isBoss, true)
    assert.equal('isBoss' in makeMonsterFromDef('boarhound', 1, 1), false)
    assert.equal('isBoss' in makeMonsterFromDef('boarhound', 1, 1, { isBoss: false }), false)
  })
})

describe('the real hirvi def — the actual spawn path', () => {
  beforeEach(clearMonsters)

  const S = 32
  function makeState(elk, playerAt) {
    const N = 20
    const map = createMap(N, N)
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) map[y][x].tile = TILE.FLOOR
    return {
      map, entities: [elk], feedback: makeFeedback(), sfx: makeSfx(),
      player: { x: playerAt.x, y: playerAt.y, px: playerAt.x * S + 16, py: playerAt.y * S + 16, hp: 10 },
    }
  }

  it('loads against the real quadruped rig and hook module with no warnings', async () => {
    const def = JSON.parse(fs.readFileSync('renderer/data/monsters/hirvi.json', 'utf8'))
    const n = await registerMonsters([def], { warn: m => { throw new Error(m) } })
    assert.equal(n, 1)
    assert.ok(getMonsterDef('hirvi'))
  })

  it('the rig derives the real hitbox half — the JSON def carries no fallback for it', async () => {
    const def = JSON.parse(fs.readFileSync('renderer/data/monsters/hirvi.json', 'utf8'))
    assert.equal('half' in def.stats, false, 'dropped from the JSON — the rig always overrides it')
    await registerMonsters([def], { warn: () => {} })
    assert.equal(getMonsterDef('hirvi').stats.half, 23)
  })

  it('drives ensureHirvi -> startBolt -> updateHirvi -> makeStand -> hurtCreature through the registry-built entity', async () => {
    const def = JSON.parse(fs.readFileSync('renderer/data/monsters/hirvi.json', 'utf8'))
    await registerMonsters([def], { warn: () => {} })

    const e = makeMonsterFromDef('hirvi', 8, 5)
    assert.equal(e.hp, 30)
    e.px = 8 * S + 16
    e.py = 5 * S + 16
    const state = makeState(e, { x: 4, y: 5 })

    // Armed from the def at spawn — before any hook has touched it.
    assert.equal(e.weaponId, 'maul')

    // Bedded: an enemy by faction (it has a def and isn't passive), but the
    // hook still owns it — the enemy loop skips story creatures before it
    // ever reaches tryStartEnemyAttack, so the weapon it carries is inert.
    ensureHirvi(e)
    assert.equal(isEnemy(e), true)
    assert.equal(isStoryCreature(e), true)
    const before = e.hp
    const absorbed = hurtCreature(state, e, 99)
    assert.equal(absorbed.absorbed, true)
    assert.equal(e.hp, before)

    // Bolting: still a story creature.
    assert.equal(startBolt(e), true)
    updateHirvi(e, state, 0.1)
    assert.equal(isStoryCreature(e), true)

    // The stand: brain-driven, and a real enemy fight from here on with the
    // weapon the def gave it — makeStand stamps nothing.
    makeStand(e)
    assert.equal(isStoryCreature(e), false)
    assert.equal(e.weaponId, 'maul')
    state.player.px = e.px + 10; state.player.py = e.py   // inside maul's 34px reach
    assert.equal(tryStartEnemyAttack(e, state), true)

    const kill = hurtCreature(state, e, 99)
    assert.equal(kill.killed, true)
    assert.equal(state.creatureKills.hirvi, true)
  })
})

describe('kivihiisi def', () => {
  const def = JSON.parse(fs.readFileSync(new URL('../renderer/data/monsters/kivihiisi.json', import.meta.url), 'utf8'))
  const index = JSON.parse(fs.readFileSync(new URL('../renderer/data/monsters/index.json', import.meta.url), 'utf8'))
  it('is a brain-driven quadruped with hooks, never a random spawn', () => {
    assert.match(def.name, /^[a-z0-9_]+$/)
    assert.equal(def.rig, 'quadruped')
    assert.equal(def.params.horns, true)
    assert.deepEqual(def.stats, { hp: 40, dmg: 3, speed: 45 })
    assert.notEqual(def.behavior.driver, 'hook', 'the ordinary brain chases and attacks')
    assert.equal(def.behavior.fleeHp, 0)
    assert.equal(def.spawn, null)
    assert.equal(def.hooks, true)
  })
  it('is listed in the index', () => { assert.ok(index.includes('kivihiisi')) })
})

describe('tuning', () => {
  beforeEach(clearMonsters)
  const SCHEMA = [
    { key: 'cooldown', label: 'Cooldown', group: 'attack', type: 'range', min: 0.5, max: 10, step: 0.1, default: 2, hint: 's between attacks' },
    { key: 'enraged', label: 'Enraged', group: 'attack', type: 'toggle', default: false },
  ]
  const TUNED = { name: 'tuned', rig: 'fakerig', hooks: true, stats: { speed: 70 } }
  it('clamps def tuning against the hook TUNING_SCHEMA', async () => {
    const warns = []
    await load([{ ...TUNED, tuning: { cooldown: 99, bogus: 1 } }],
      { loadHooks: async () => ({ TUNING_SCHEMA: SCHEMA }), warn: m => warns.push(m) })
    assert.deepEqual(getMonsterDef('tuned').tuning, { cooldown: 10, enraged: false })
    assert.deepEqual(getMonsterDef('tuned').tuningSchema, SCHEMA)
    assert.ok(warns.some(w => /clamped/.test(w)) && warns.some(w => /bogus/.test(w)))
  })
  it('tuningOf returns the same live object the def holds', async () => {
    await load([TUNED], { loadHooks: async () => ({ TUNING_SCHEMA: SCHEMA }) })
    assert.equal(tuningOf('tuned'), getMonsterDef('tuned').tuning)
    tuningOf('tuned').cooldown = 4
    assert.equal(getMonsterDef('tuned').tuning.cooldown, 4)
  })
  it('keeps the hook module on the def', async () => {
    const mod = { TUNING_SCHEMA: SCHEMA, debugState: () => 'x' }
    await load([TUNED], { loadHooks: async () => mod })
    assert.equal(getMonsterDef('tuned').hookModule, mod)
  })
  it('a hook without TUNING_SCHEMA loads with empty tuning', async () => {
    await load([TUNED], { loadHooks: async () => ({}) })
    assert.deepEqual(getMonsterDef('tuned').tuning, {})
    assert.equal(getMonsterDef('tuned').tuningSchema, null)
  })
  it('a legacy loadHooks returning undefined still loads', async () => {
    assert.equal(await load([TUNED]), 1)
    assert.deepEqual(getMonsterDef('tuned').tuning, {})
    assert.equal(getMonsterDef('tuned').hookModule, null)
  })
  it('an invalid TUNING_SCHEMA warns and is ignored', async () => {
    const warns = []
    await load([{ ...TUNED, tuning: { x: 1 } }],
      { loadHooks: async () => ({ TUNING_SCHEMA: [{ key: 'x', type: 'range' }] }), warn: m => warns.push(m) })
    assert.ok(warns.some(w => /TUNING_SCHEMA/.test(w)))
    assert.equal(getMonsterDef('tuned').tuningSchema, null)
    assert.deepEqual(getMonsterDef('tuned').tuning, {})
  })
  it('a def without hooks has empty tuning', async () => {
    await load([{ ...DEF }])
    assert.deepEqual(getMonsterDef('boarhound').tuning, {})
  })
  it('accepts a hint field in the schema', () => {
    assert.deepEqual(schemaErrors(SCHEMA), [])
  })
  it('retuneMonster re-registers the AI row with new speed and behaviour', async () => {
    await load([{ ...TUNED, behavior: { sightRange: 200, taxon: 'beast' } }])
    assert.equal(retuneMonster('tuned', { stats: { speed: 140, hp: 30 }, behavior: { sightRange: 320 } }), true)
    assert.equal(getAIConfig({ type: 'tuned' }).speed, 140)
    assert.equal(getAIConfig({ type: 'tuned' }).sightRange, 320)
    assert.equal(getMonsterDef('tuned').stats.hp, 30)
    assert.equal(getMonsterDef('tuned').behavior.taxon, 'beast')
    assert.equal(makeMonsterFromDef('tuned', 1, 1).hp, 30)
  })
  it('retuneMonster on an unknown name is false', () => {
    assert.equal(retuneMonster('nope', { stats: { hp: 1 } }), false)
  })
  it('records its own load warnings on the def for the bench to show', async () => {
    await load([{ ...TUNED, tuning: { cooldown: 99 } }], { loadHooks: async () => ({ TUNING_SCHEMA: SCHEMA }) })
    assert.ok(getMonsterDef('tuned').warnings.some(w => /clamped/.test(w)))
    await load([{ ...TUNED, name: 'broken' }], { loadHooks: async () => { throw new Error('Unexpected token') } })
    assert.ok(getMonsterDef('broken').warnings.some(w => /hooks failed.*Unexpected token/.test(w)))
    await load([{ ...TUNED, name: 'clean' }], { loadHooks: async () => ({ TUNING_SCHEMA: SCHEMA }) })
    assert.deepEqual(getMonsterDef('clean').warnings, [])
  })
  it('tuningOf on an unknown type is an empty object', () => {
    assert.deepEqual(tuningOf('nope'), {})
  })
})

describe('drawMonsterFx', () => {
  const S = 32
  function scene(visible = true) {
    const map = createMap(6, 6)
    for (const row of map) for (const c of row) { c.tile = TILE.FLOOR; c.visible = visible }
    return map
  }
  const recorder = () => {
    const ops = []
    return { ops, ctx: { save: () => ops.push(['save']), restore: () => ops.push(['restore']),
                         translate: (x, y) => ops.push(['translate', x, y]) } }
  }
  async function withFx(drawFx) {
    clearMonsters()
    await load([{ ...DEF, hooks: true }], { loadHooks: async () => ({ drawFx }) })
  }

  it('hands each visible monster with a drawFx the ctx at its screen centre', async () => {
    const seen = []
    await withFx((ctx, e, s) => seen.push([e, s]))
    const e = { type: 'boarhound', x: 2, y: 3, px: 80, py: 112, hp: 5 }
    const { ops, ctx } = recorder()
    drawMonsterFx(ctx, [e, { type: 'chest', x: 1, y: 1, px: 48, py: 48 }], scene(), 10, 20, S)
    assert.deepEqual(seen, [[e, S]])
    assert.deepEqual(ops, [['save'], ['translate', 70, 92], ['restore']])
  })

  it('skips a monster on a cell the hero cannot see', async () => {
    const seen = []
    await withFx((ctx, e) => seen.push(e))
    drawMonsterFx(recorder().ctx, [{ type: 'boarhound', x: 2, y: 3, px: 80, py: 112, hp: 5 }], scene(false), 0, 0, S)
    assert.equal(seen.length, 0)
  })

  it('leaves monsters whose hooks draw nothing alone', async () => {
    clearMonsters()
    await load([DEF])
    const { ops, ctx } = recorder()
    drawMonsterFx(ctx, [{ type: 'boarhound', x: 2, y: 3, px: 80, py: 112, hp: 5 }], scene(), 0, 0, S)
    assert.deepEqual(ops, [])
  })
})

describe('weapon overrides from the def', () => {
  beforeEach(clearMonsters)
  const opts = { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }
  it('stamps a def\'s weapon overrides onto the entity, and the swing uses them', async () => {
    await registerMonsters([{ name: 'wovr', rig: 'fakerig', stats: { hp: 5 }, behavior: { weapon: 'maul', weaponOverrides: { damage: 3 } } }], opts)
    const e = makeMonsterFromDef('wovr', 1, 1)
    assert.deepEqual(e.weaponOverrides, { damage: 3 })
    const w = getEnemyWeapon(e)
    assert.equal(w.damage, 3)
    assert.equal(w.reach, WEAPONS.maul.reach)
  })
  it('ignores overrides without a weapon, and non-finite override values', async () => {
    await registerMonsters([
      { name: 'wnone', rig: 'fakerig', behavior: { weaponOverrides: { damage: 3 } } },
      { name: 'wbad', rig: 'fakerig', behavior: { weapon: 'maul', weaponOverrides: { damage: 'x', reach: 40, extra: 1 } } },
    ], opts)
    assert.equal('weaponOverrides' in makeMonsterFromDef('wnone', 1, 1), false)
    assert.deepEqual(makeMonsterFromDef('wbad', 1, 1).weaponOverrides, { reach: 40 })
  })
})

describe('posed sequences in the game', () => {
  const STRIKE = { phases: [{ time: 0.30, pose: {} }, { time: 0.35, pose: { a: { turn: -25 } } }, { time: 0.08, hit: true, pose: { a: { turn: 120 } } }] }
  const armed = (over = {}) => ({ ...DEF, name: 'striker', behavior: { weapon: 'maul' }, anims: { attack: STRIKE }, ...over })
  beforeEach(() => clearMonsters())

  it('attaches cleaned anims to the params, not to own.params', async () => {
    await load([armed()])
    const d = getMonsterDef('striker')
    assert.deepEqual(d.params.anims, { attack: STRIKE })
    assert.equal('anims' in d.own.params, false)
  })
  it('the attack sequence sets the weapon timing (windup to the hit, the rest as follow-through)', async () => {
    await load([armed()])
    const e = makeMonsterFromDef('striker', 1, 1)
    assert.ok(Math.abs(e.weaponOverrides.windup - 0.43) < 1e-9)
    assert.ok(Math.abs(e.weaponOverrides.duration - 0.30) < 1e-9)
    assert.ok(Math.abs(getEnemyWeapon(e).windup - 0.43) < 1e-9)
    assert.equal(getEnemyWeapon(e).damage, WEAPONS.maul.damage)
  })
  it('no weapon: no timing stamped (Review Focus 5); no sequence: entity unchanged', async () => {
    await load([armed({ behavior: {} }), { ...DEF, name: 'plain', behavior: { weapon: 'maul' } }])
    assert.equal(makeMonsterFromDef('striker', 1, 1).weaponOverrides, undefined)
    assert.equal(makeMonsterFromDef('plain', 1, 1).weaponOverrides, undefined)
  })
  it('broken anims load with a warning, never throw (Review Focus 4)', async () => {
    const warns = []
    await load([armed({ anims: { dance: 1, attack: { phases: 'x' } } })], { warn: m => warns.push(m) })
    assert.deepEqual(getMonsterDef('striker').params.anims, {})
    assert.ok(warns.some(w => w.includes('striker') && w.includes('anims')))
  })
  it('entityPose exposes the attack clock', async () => {
    await load([armed()])
    const e = { ...makeMonsterFromDef('striker', 2, 3), px: 80, py: 112 }
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).attack, null)
    e.attack = { phase: 'windup', timer: 0.1, duration: 0.43 }
    assert.deepEqual({ ...entityPose(e).attack, t: Math.round(entityPose(e).attack.t * 100) / 100 }, { phase: 'windup', t: 0.33 })
    e.attack = { swing: 1 }
    assert.equal(entityPose(e).attack.phase, 'swing')
  })
  it('an animation switch starts a blend and restarts animT', async () => {
    await load([armed()])
    const e = { ...makeMonsterFromDef('striker', 2, 3), px: 80, py: 112 }
    updateMonsterPose(e, 0.016); updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).animT > 0.016)
    e.attack = { phase: 'windup', timer: 0.3, duration: 0.43 }
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).blend.from, 'idle')
    assert.equal(entityPose(e).animT, 0)
    updateMonsterPose(e, 0.016)
    assert.ok(Math.abs(entityPose(e).blend.t - 0.016) < 1e-9)
    e.attack = null
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).blend.from, 'attack')
    assert.equal(entityPose(e).blend.at.phase, 'windup')
  })
  it('the attack starts with the windup the sequence set, then strikes', async () => {
    await load([armed()])
    const e = { ...makeMonsterFromDef('striker', 2, 3), px: 80, py: 112 }
    const state = { player: { px: e.px + 10, py: e.py } }      // inside maul's 34 px reach; a windup > 0 does not strike yet
    assert.equal(tryStartEnemyAttack(e, state), true)
    assert.equal(e.attack.phase, 'windup')
    assert.ok(Math.abs(e.attack.timer - 0.43) < 1e-9)
  })
})

// The game's own frame order: the pose bookkeeping runs before the attack
// starts and steps (game.js), and the canvas draws after both. Whatever that
// order, a posed attack must ease in and out — no one-frame pop of the arm or
// the lunge at its start or its end.
describe('a posed attack in the game frame order', () => {
  // a two-piece cut-out figure: a torso and a left arm hung on it
  const PARTS = { figure: { w: 40, h: 60 }, view: 'front', faces: 'left', points: {},
    pieces: [
      { id: 'torso', role: 'torso', side: null, parent: null, z: 0, pivot: [20, 30], rect: [0, 0, 20, 30], at: [10, 15], cap: null },
      { id: 'arm', role: 'arm', side: 'left', parent: 'torso', z: 1, pivot: [10, 20], rect: [20, 0, 6, 20], at: [4, 20], cap: null },
    ] }
  // slow moves, so a legitimate frame never turns the arm far: start and end
  // at -40 (the built-in attack reach would be +35), pull back, strike at 80
  const SLOW = { phases: [{ time: 0.4, pose: { arm: { turn: -40 } } }, { time: 0.4, pose: {} }, { time: 0.4, hit: true, pose: { arm: { turn: 80 } } }] }
  const def = anims => ({ name: 'poser', rig: 'cut', params: { lunge: 0.5, armSwing: 0 }, stats: { hp: 10, speed: 70 },
    behavior: { weapon: 'maul' }, ...(anims ? { anims } : {}) })
  const loadCut = d => registerMonsters([d], { loadRig: async () => makeCutoutRig({ id: 'cut', parts: PARTS, imageUrl: null }),
    loadHooks: async () => {}, warn: () => {} })
  const recorder = () => { const t = { ops: [] }; return new Proxy(t, { get: (o, k) => (k in o ? o[k] : (...a) => { o.ops.push([k, ...a]) }), set: (o, k, v) => { o[k] = v; return true } }) }
  const draw = (d, pose) => { const c = recorder(); d.rig.drawMonster(c, d.params, pose, 32); return c.ops }
  const armDeg = (d, pose) => { const m = pieceTransforms(PARTS, d.params, pose).get('arm'); return Math.atan2(m[1], m[0]) * 180 / Math.PI }
  const lungeOf = ops => ops.find(o => o[0] === 'translate')[1]

  // idle, the player steps in, the attack runs its windup and swing (the
  // player has stepped away, so it whiffs), then idle again
  function run(d, frame) {
    const dt = 1 / 60
    const e = { ...makeMonsterFromDef('poser', 2, 3), px: 80, py: 112, damageCooldown: 0 }
    const state = { player: { px: 2000, py: 112, hp: 10 } }
    let started = false, ended = false
    for (let i = 0; i < 150; i++) {
      if (i === 30) state.player.px = e.px + 10                  // inside maul's reach: the attack starts
      if (e.attack) state.player.px = 2000                        // and steps away again
      updateMonsterPose(e, dt)
      if (tryStartEnemyAttack(e, state)) started = true
      stepEnemyAttack(e, state, dt)
      if (started && !e.attack) ended = true
      frame(e, i)
    }
    assert.ok(started && ended, 'the attack ran start to end')
  }

  beforeEach(() => clearMonsters())

  it('the posed arm and the lunge never jump at the start or the end', async () => {
    await loadCut(def({ attack: SLOW }))
    const d = getMonsterDef('poser')
    let prev = null, maxTurn = 0, maxLunge = 0, peak = -Infinity
    run(d, e => {
      const pose = entityPose(e)
      const now = { arm: armDeg(d, pose), lunge: lungeOf(draw(d, pose)) }
      if (prev) {
        maxTurn = Math.max(maxTurn, Math.abs(now.arm - prev.arm))
        maxLunge = Math.max(maxLunge, Math.abs(now.lunge - prev.lunge))
      }
      peak = Math.max(peak, now.arm)
      prev = now
    })
    assert.ok(peak > 75, `the strike was reached (${peak})`)
    assert.ok(maxTurn <= 10, `the arm turned at most 10 degrees a frame, got ${maxTurn}`)
    assert.ok(maxLunge <= 2, `the lunge moved at most 2 px a frame, got ${maxLunge}`)
    assert.equal(prev.lunge, 0)
    assert.ok(Math.abs(prev.arm) < 1e-9, 'back at rest once idle')
  })

  it('an unposed monster draws exactly as it would from the bare pose (attack and blend are inert)', async () => {
    await loadCut(def(null))
    const d = getMonsterDef('poser')
    run(d, (e, i) => {
      const pose = entityPose(e)
      assert.deepEqual(draw(d, pose), draw(d, { ...pose, attack: null, blend: null }), `frame ${i}`)
    })
  })
})
