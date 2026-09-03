import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerMonsters, clearMonsters, getMonsterDef, monsterNames, monstersForDepth,
         makeMonsterFromDef, updateMonsterPose, entityPose, drawGeneratedMonster, monstersForOpenMap } from '../renderer/systems/monsters.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'
import { CREATURE_TYPES } from '../renderer/systems/creatures.js'

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
  it('a failing hooks module is non-fatal and never touches CREATURE_TYPES', async () => {
    const before = [...CREATURE_TYPES]
    const n = await registerMonsters([{ ...DEF, hooks: true }],
      { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => { throw new Error('boom') }, warn: () => {} })
    assert.equal(n, 1)
    assert.ok(getMonsterDef('boarhound'))
    assert.deepEqual([...CREATURE_TYPES], before)
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
