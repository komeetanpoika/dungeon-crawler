import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QUESTS } from '../renderer/data/quests.js'
import { questFor, questFlags, isQuestDone, questLines, makeQuestCtx } from '../renderer/systems/quests.js'
import { QUEST_MODULES } from '../renderer/systems/quests/index.js'
import { normalizeAdventureSave, resetNpcs } from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

const clearings = OPEN_MAPS[7]
const lake = OPEN_MAPS[8]
// A map no slice has declared a quest for. Deliberately synthetic rather
// than a real OPEN_MAPS entry so a future slice declaring a quest for it
// can't silently flip these "undeclared" assertions to pass for the wrong
// reason (or force another edit here).
const UNDECLARED = { name: 'nope', leap: false, pois: [] }

describe('quest declarations', () => {
  it('every declared quest names a real non-leap map', () => {
    for (const name of Object.keys(QUESTS)) {
      const map = Object.values(OPEN_MAPS).find(m => m.name === name)
      assert.ok(map, name)
      assert.equal(!!map.leap, false, name)
    }
  })
  it('each quest declares a title, staged villager lines and a rule', () => {
    for (const [name, q] of Object.entries(QUESTS)) {
      assert.ok(q.title, name)
      assert.equal(typeof q.rule, 'function', name)
      assert.ok(q.villagerLines.length >= 2, name)
      // the last stage must be the catch-all
      assert.equal(q.villagerLines.at(-1).when({}), true, name)
      for (const s of q.villagerLines) assert.ok(Object.keys(s.by).length, `${name} stage`)
    }
  })
  it('every line stage speaks only to species the map actually rosters', () => {
    for (const [name, q] of Object.entries(QUESTS)) {
      const map = Object.values(OPEN_MAPS).find(m => m.name === name)
      const rostered = new Set([...(map.npcs?.village ?? []), ...(map.npcs?.wild ?? [])])
      for (const s of q.villagerLines) for (const species of Object.keys(s.by))
        assert.ok(rostered.has(species), `${name}: ${species}`)
    }
  })
  it('every module in the registry has a declaration', () => {
    for (const name of Object.keys(QUEST_MODULES)) assert.ok(QUESTS[name], name)
  })
})

describe('questFor', () => {
  it('resolves a declared Adventure map', () => {
    assert.equal(questFor(clearings), QUESTS['forest-1-clearings'])
  })
  it('is null on a leap map, an undeclared map and nothing at all', () => {
    assert.equal(questFor(lake), null)
    assert.equal(questFor(UNDECLARED), null)
    assert.equal(questFor(null), null)
    assert.equal(questFor(undefined), null)
  })
})

describe('save field', () => {
  it('normalizeAdventureSave defaults quests and keeps an existing record', () => {
    assert.deepEqual(normalizeAdventureSave(null).quests, {})
    const carried = normalizeAdventureSave({ progress: { mapDepth: 7, cleared: {} }, caves: {},
      quests: { 'forest-1-clearings': { flags: { flush: 2 } } } })
    assert.equal(carried.quests['forest-1-clearings'].flags.flush, 2)
  })
  it('quest flags survive the death wipe', () => {
    const save = normalizeAdventureSave(null)
    questFlags(save, 'forest-1-clearings').hirvi_dead = true
    resetNpcs(save)
    assert.equal(questFlags(save, 'forest-1-clearings').hirvi_dead, true)
  })
  it('questFlags creates the record on demand', () => {
    const save = normalizeAdventureSave(null)
    assert.deepEqual(questFlags(save, 'forest-1-clearings'), {})
    assert.deepEqual(save.quests['forest-1-clearings'], { flags: {} })
  })
})

describe('isQuestDone', () => {
  it('follows the map rule and is false for a map with no quest', () => {
    const save = normalizeAdventureSave(null)
    assert.equal(isQuestDone(save, clearings), false)
    questFlags(save, clearings.name).hide_given = true
    assert.equal(isQuestDone(save, clearings), true)
    assert.equal(isQuestDone(save, UNDECLARED), false)
  })
})

describe('questLines', () => {
  const quest = QUESTS['forest-1-clearings']
  it('picks the first matching stage, and the catch-all when nothing matches', () => {
    const open = questLines(quest, {})
    const done = questLines(quest, { hide_given: true })
    assert.ok(open.villager.length)
    assert.ok(done.villager.length)
    assert.notDeepEqual(open, done)
  })
  it('returns null when handed no quest', () => {
    assert.equal(questLines(null, {}), null)
  })
})

describe('makeQuestCtx', () => {
  it('writes into save.quests and nowhere else', () => {
    const save = normalizeAdventureSave(null)
    const ctx = makeQuestCtx({ getState: () => ({}), save, mapData: clearings,
      persist: () => {}, refreshInventory: () => {}, spawn: () => {} })
    ctx.set('hunt_seen')
    assert.equal(save.quests[clearings.name].flags.hunt_seen, true)
    assert.deepEqual(save.leaps, {})
  })
})

describe('the River Split declaration', () => {
  const river = OPEN_MAPS[11]
  const quest = QUESTS['forest-2-river']
  it('is found for depth 11 and is done only on bridge_done', () => {
    assert.equal(questFor(river), quest)
    assert.equal(quest.title, 'Tervahauta')
    assert.equal(quest.rule({}), false)
    assert.equal(quest.rule({ pit_lit: true, plank_1: true, plank_2: true, plank_3: true }), false)
    assert.equal(quest.rule({ bridge_done: true }), true)
  })
  it('stages the crew\'s lines: opening, once the pit is lit, and when the deck is whole', () => {
    const open = questLines(quest, {})
    const lit = questLines(quest, { pit_lit: true })
    const done = questLines(quest, { bridge_done: true })
    for (const s of [open, lit, done]) assert.ok(s.villager?.length, 'the camp is villagers')
    assert.notDeepEqual(open, lit)
    assert.notDeepEqual(lit, done)
  })
  it('the River Split has a registered module with onArrive and tick', () => {
    const m = QUEST_MODULES['forest-2-river']
    assert.equal(typeof m?.onArrive, 'function')
    assert.equal(typeof m?.tick, 'function')
  })
})
