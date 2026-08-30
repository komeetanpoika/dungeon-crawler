import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EPISODES } from '../renderer/data/leaps.js'
import { episodeFor, leapFlags, setFlag, wolvesAlive, isMapUnlocked, isResolved, echoLine, poiCell, missingSpawn, echoSpawns, echoAdjacent, checkDeliveries, makeEpCtx } from '../renderer/systems/leap.js'
import { normalizeAdventureSave, markCleared } from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { npcSpawnsForMap, npcSpawnIndex } from '../renderer/systems/openmap.js'
import { makeItem } from '../renderer/systems/inventory.js'

const fold = Object.values(OPEN_MAPS).find(m => m.name === 'highland-2-fold')
const lake = Object.values(OPEN_MAPS).find(m => m.name === 'lake-1-ferry')
const clearings = OPEN_MAPS[7]

describe('episode data', () => {
  it('every leap map has an episode and no plain map does', () => {
    for (const m of Object.values(OPEN_MAPS)) assert.equal(!!episodeFor(m), !!m.leap, m.name)
  })
  it('each episode declares persona, missing species, villager lines, echo spots and a rule', () => {
    for (const [name, ep] of Object.entries(EPISODES)) {
      assert.ok(ep.persona, name); assert.ok(ep.missing?.species, name)
      assert.ok(Object.keys(ep.villagerLines).length, name)
      assert.ok(ep.echoSpots.length >= 2, name)
      assert.equal(typeof ep.rule, 'function', name)
      for (const s of ep.echoSpots) assert.ok(s.lines.length && s.lines.at(-1).when({}, {}) !== undefined, `${name} ${s.fromPoi}`)
    }
  })
  it('every echo spot names a POI the map declares', () => {
    for (const m of Object.values(OPEN_MAPS)) for (const s of episodeFor(m)?.echoSpots ?? [])
      assert.ok(poiCell(m, s.fromPoi), `${m.name}: ${s.fromPoi}`)
  })
})

describe('flags', () => {
  it('leapFlags creates the record on demand and setFlag writes through', () => {
    const save = normalizeAdventureSave(null)
    assert.deepEqual(leapFlags(save, 'lake-1-ferry'), {})
    setFlag(save, 'lake-1-ferry', 'bell_hung')
    setFlag(save, 'lake-1-ferry', 'fed', 2)
    assert.deepEqual(save.leaps['lake-1-ferry'], { flags: { bell_hung: true, fed: 2 } })
  })
})

describe('rules', () => {
  it('a plain map still unlocks by clearing its dungeons', () => {
    const save = normalizeAdventureSave(null)
    assert.equal(isMapUnlocked(save, clearings), false)
    for (const l of ['cave 1', 'cave 2']) markCleared(save.progress, clearings.name, l)
    assert.equal(isMapUnlocked(save, clearings), true)
    assert.equal(isResolved(save, clearings), false)
  })
  it('the lake unlocks only when the Näkki is gone, regardless of caves', () => {
    const save = normalizeAdventureSave(null)
    markCleared(save.progress, lake.name, 'lake cave')
    assert.equal(isMapUnlocked(save, lake), false)
    setFlag(save, lake.name, 'nakki_gone')
    assert.equal(isMapUnlocked(save, lake), true)
    assert.equal(isResolved(save, lake), true)
  })
  // The fold's wolves are homed at the den (npcs.at), so their ids sit after
  // village + wild — wolvesAlive has to read the same roster openmap.js
  // assigns ids from, not just the wild list.
  const wolfIds = m => npcSpawnIndex(m).filter(e => e.species === 'wolf').map(e => `npc:${m.name}:${e.i}`)

  it('wolvesAlive counts declared wolves minus the dead record, wherever they are declared', () => {
    const save = normalizeAdventureSave(null)
    assert.equal(wolvesAlive(save, fold), 3)
    const ids = wolfIds(fold)
    assert.equal(ids.length, 3)
    const v = fold.npcs.village.length, w = (fold.npcs.wild ?? []).length
    assert.deepEqual(ids, [v + w, v + w + 1, v + w + 2].map(i => `npc:${fold.name}:${i}`))
    save.npcs[fold.name] = { dead: ids.slice(0, 2), hostile: false }
    assert.equal(wolvesAlive(save, fold), 1)
  })
  it('the fold needs the Maahinen dead and a wolf alive', () => {
    const save = normalizeAdventureSave(null)
    setFlag(save, fold.name, 'maahinen_dead')
    assert.equal(isMapUnlocked(save, fold), true)
    save.npcs[fold.name] = { dead: wolfIds(fold), hostile: false }
    assert.equal(isMapUnlocked(save, fold), false)
  })
})

describe('missing person spawn id', () => {
  it("missingSpawn's id is never among the declared roster's ids, so recordNpcState can never tombstone the returned local", () => {
    for (const m of Object.values(OPEN_MAPS)) {
      if (!episodeFor(m)) continue
      const declaredIds = npcSpawnsForMap(m).map(s => s.id)
      assert.ok(!declaredIds.includes(missingSpawn(m).id), m.name)
    }
  })
})

describe('echo and resolution helpers', () => {
  it('echoLine picks the first line whose condition holds, last line is the fallback', () => {
    const ep = { echoSpots: [{ fromPoi: 'x', lines: [{ when: f => f.a, text: 'A' }, { when: () => true, text: 'Z' }] }] }
    assert.equal(echoLine(ep, 0, {}, {}), 'Z')
    assert.equal(echoLine(ep, 0, { a: true }, {}), 'A')
    assert.equal(echoLine(ep, 5, {}, {}), null)
  })
  it('missingSpawn lands on walkable ground beside the village, tagged as the returned local', () => {
    const s = missingSpawn(lake)
    assert.equal(s.kind, 'npc'); assert.equal(s.id, 'npc:lake-1-ferry:missing')
    assert.equal(s.role, 'missing')
    assert.equal(lake.walk[s.y][s.x], '1')
    const v = poiCell(lake, 'village')
    assert.ok(Math.max(Math.abs(s.x - v.x), Math.abs(s.y - v.y)) <= 4)
  })
})

describe('returned local', () => {
  it('every leap map tags its missing person with role: missing', () => {
    for (const m of Object.values(OPEN_MAPS)) {
      if (!episodeFor(m)) continue
      assert.equal(missingSpawn(m).role, 'missing', m.name)
    }
  })
  it('every episode has resolved lines for the villagers to speak', () => {
    for (const [name, ep] of Object.entries(EPISODES)) {
      assert.ok(ep.resolvedLines && Object.keys(ep.resolvedLines).length, name)
      for (const lines of Object.values(ep.resolvedLines)) assert.ok(lines.length, name)
    }
  })
})

describe('echo', () => {
  it('spawns one echo per spot, on the POI cell', () => {
    const s = echoSpawns(lake)
    assert.equal(s.length, episodeFor(lake).echoSpots.length)
    assert.deepEqual(s[0], { kind: 'echo', x: poiCell(lake, 'runestone').x, y: poiCell(lake, 'runestone').y, spot: 0 })
  })
  it('echoAdjacent finds an echo on or orthogonally beside the player', () => {
    const e = { type: 'echo', x: 5, y: 5, spot: 0 }
    assert.equal(echoAdjacent([e], { x: 5, y: 6 }), e)
    assert.equal(echoAdjacent([e], { x: 6, y: 6 }), null)
  })
})

describe('makeEpCtx', () => {
  it('ctx.state is a live getter that follows getState, not a value frozen at construction', () => {
    const save = normalizeAdventureSave(null)
    let current = { player: { x: 1, y: 1 } }
    const ctx = makeEpCtx({ getState: () => current, save, mapData: lake,
      persist: () => {}, resolve: () => {}, refreshInventory: () => {}, spawn: () => {} })
    assert.equal(ctx.state, current)
    assert.equal(ctx.state.player.x, 1)
    // Simulate a cave dive/return: game.js reassigns the module-level `state`
    // binding wholesale (buildCaveState / restoreSurface) rather than
    // mutating it in place — a captured `state` value would go stale here.
    current = { player: { x: 9, y: 9 } }
    assert.equal(ctx.state, current)
    assert.equal(ctx.state.player.x, 9)
  })
  it('carries save/mapData/episode/flags and wires set() through to the save', () => {
    const save = normalizeAdventureSave(null)
    const ctx = makeEpCtx({ getState: () => ({ player: {} }), save, mapData: lake,
      persist: () => {}, resolve: () => {}, refreshInventory: () => {}, spawn: () => {} })
    assert.equal(ctx.mapData, lake)
    assert.equal(ctx.episode, episodeFor(lake))
    assert.deepEqual(ctx.flags, {})
    ctx.set('nakki_gone')
    assert.equal(ctx.flags.nakki_gone, true)
    assert.equal(leapFlags(save, lake.name).nakki_gone, true)
  })
})

describe('deliveries', () => {
  const mk = (over) => ({ player: { x: 3, y: 3, inventory: [makeItem('clapper')], maxInventory: 10 }, entities: [], ...over })
  it('delivers to a POI cell when standing on it, removing the item and setting the flag', () => {
    const save = normalizeAdventureSave(null)
    const state = mk({})
    const ctx = { state, save, mapData: { name: 'm', pois: [{ kind: 'landmark', label: 'bell', x: 3, y: 3 }] }, flags: leapFlags(save, 'm'), set: (f, v = true) => setFlag(save, 'm', f, v) }
    const d = checkDeliveries(ctx, [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }])
    assert.equal(d?.sets, 'bell_hung')
    assert.equal(ctx.flags.bell_hung, true)
    assert.equal(state.player.inventory.length, 0)
    assert.equal(checkDeliveries(ctx, [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }]), null)
  })
  it('delivers to an NPC species when beside it, and not to a hostile one', () => {
    const save = normalizeAdventureSave(null)
    const elder = { type: 'npc', species: 'elder', x: 4, y: 3, hostile: false }
    const state = mk({ player: { x: 3, y: 3, inventory: [makeItem('fleece')], maxInventory: 10 }, entities: [elder] })
    const ctx = { state, save, mapData: { name: 'm', pois: [] }, flags: leapFlags(save, 'm'), set: (f, v = true) => setFlag(save, 'm', f, v) }
    elder.hostile = true
    assert.equal(checkDeliveries(ctx, [{ item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown' }]), null)
    elder.hostile = false
    assert.equal(checkDeliveries(ctx, [{ item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown' }]).sets, 'fleece_shown')
  })
})
