import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dungeonLabels, markCleared, isMapComplete, nextMapDepth,
  normalizeAdventureSave, freshProgress, npcRecordFor, recordNpcState, resetNpcs,
} from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { ADVENTURE_DEPTH } from '../renderer/data/levels.js'

describe('the adventure map chain', () => {
  it('exports the adventure chain at depths 7..18 (leap maps at 8-10)', () => {
    const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b)
    assert.deepEqual(depths, [7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18])
    assert.equal(OPEN_MAPS[7].name, 'forest-1-clearings')
    assert.equal(OPEN_MAPS[11].name, 'forest-2-river')
    assert.equal(OPEN_MAPS[18].name, 'sea-3-archipelago')
    assert.equal(OPEN_MAPS[8].leap, true)
    assert.equal(OPEN_MAPS[9].leap, true)
    assert.equal(OPEN_MAPS[11].leap, undefined)
  })

  it('every map but the last has a walkable exit cell', () => {
    for (const [depth, m] of Object.entries(OPEN_MAPS)) {
      if (Number(depth) === 18) { assert.equal(m.exit, null); continue }
      assert.ok(m.exit, `${m.name} needs an exit`)
      assert.equal(m.walk[m.exit.y][m.exit.x], '1', `${m.name} exit walkable`)
      assert.ok(m.prop[m.exit.y][m.exit.x] < 0, `${m.name} exit unpropped`)
    }
  })

  it('caveDepths pairs one difficulty per dungeon entrance', () => {
    for (const m of Object.values(OPEN_MAPS))
      assert.equal(m.caveDepths.length, dungeonLabels(m).length, m.name)
  })

  it('nextMapDepth walks the chain and ends after the last map', () => {
    assert.equal(nextMapDepth(7), 8)
    assert.equal(nextMapDepth(17), 18)
    assert.equal(nextMapDepth(18), null)
  })
})

describe('progression', () => {
  it('markCleared records once and reports completion of the set', () => {
    const progress = freshProgress()
    const map = OPEN_MAPS[7]   // two dungeons: cave 1, cave 2
    assert.equal(isMapComplete(progress, map), false)
    markCleared(progress, map.name, 'cave 1')
    assert.equal(isMapComplete(progress, map), false)
    markCleared(progress, map.name, 'cave 1')
    assert.deepEqual(progress.cleared[map.name], ['cave 1'], 'no duplicates')
    markCleared(progress, map.name, 'cave 2')
    assert.equal(isMapComplete(progress, map), true)
  })

  it('single-dungeon maps complete with one clear', () => {
    const progress = freshProgress()
    const map = OPEN_MAPS[11]   // bear cave only
    markCleared(progress, map.name, 'bear cave')
    assert.equal(isMapComplete(progress, map), true)
  })
})

describe('normalizeAdventureSave', () => {
  it('starts fresh from nothing', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.caves, {})
    assert.equal(s.progress.mapDepth, ADVENTURE_DEPTH)
    assert.deepEqual(s.progress.cleared, {})
  })

  it('migrates a v1 caves-only file', () => {
    const v1 = { 'forest-1-clearings': { 'cave 1': { cleared: true, age: 0 } } }
    const s = normalizeAdventureSave(v1)
    assert.deepEqual(s.caves, v1)
    assert.equal(s.progress.mapDepth, ADVENTURE_DEPTH)
  })

  it('migrates a v2 file additively', () => {
    const v2 = { caves: { m: {} }, progress: { mapDepth: 10, cleared: { m: ['a'] } } }
    const s = normalizeAdventureSave(v2)
    assert.deepEqual(s.caves, v2.caves)
    assert.deepEqual(s.progress, v2.progress)
    assert.deepEqual(s.talents, [])
    assert.equal(s.body, null)
  })
})

describe('v3 save shape', () => {
  it('fresh saves carry empty talents and no body', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.talents, [])
    assert.equal(s.body, null)
  })

  it('v2 saves migrate additively, keeping caves and progress', () => {
    const v2 = { caves: { m: {} }, progress: { mapDepth: 7, cleared: { m: ['a'] } } }
    const s = normalizeAdventureSave(v2)
    assert.deepEqual(s.talents, [])
    assert.equal(s.body, null)
    assert.deepEqual(s.progress.cleared, { m: ['a'] })
  })

  it('v1 bare-caves saves still migrate', () => {
    const s = normalizeAdventureSave({ somemap: { cave1: {} } })
    assert.ok(s.progress)
    assert.deepEqual(s.talents, [])
  })

  it('v3 saves pass through untouched, gaining only the empty gates, npcs and felled maps', () => {
    const v3 = { caves: {}, progress: { mapDepth: 7, cleared: {} },
      talents: ['magic_stance'], body: { weapon: null, ranged: null, inventory: [] } }
    assert.deepEqual(normalizeAdventureSave(v3), { ...v3, gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true })
  })

  it('v4 saves keep their npcs and gain an empty felled map', () => {
    const v4 = { caves: {}, progress: { mapDepth: 7, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: { 'forest-1-clearings': { dead: ['npc:forest-1-clearings:0'], hostile: false } } }
    assert.deepEqual(normalizeAdventureSave(v4), { ...v4, felled: {}, leaps: {}, v6: true })
  })

  it('a fresh save has no felled trees', () => {
    assert.deepEqual(normalizeAdventureSave(null).felled, {})
  })

  it('body inventory items with nested payload are preserved', () => {
    const payload = { ammo: 5, type: 'ranged' }
    const v3 = { caves: {}, progress: { mapDepth: 7, cleared: {} },
      talents: [], body: {
        weapon: null, ranged: null,
        inventory: [
          { kind: 'ranged', name: 'bow', emoji: '🏹', stackable: false, payload },
        ],
      } }
    const s = normalizeAdventureSave(v3)
    // After normalization, the payload should still exist and be the same data
    assert.ok(s.body.inventory[0].payload, 'payload preserved')
    assert.deepEqual(s.body.inventory[0].payload, payload, 'payload data matches')
  })
})

describe('npc persistence (save v4)', () => {
  it('migrates older saves with an empty npcs map', () => {
    assert.deepEqual(normalizeAdventureSave({ caves: {}, progress: freshProgress() }).npcs, {})
    assert.deepEqual(normalizeAdventureSave(null).npcs, {})
    const kept = normalizeAdventureSave({ caves: {}, progress: freshProgress(), npcs: { a: { dead: ['x'], hostile: true } } })
    assert.deepEqual(kept.npcs, { a: { dead: ['x'], hostile: true } })
  })
  it('npcRecordFor defaults to alive and peaceful', () => {
    const save = normalizeAdventureSave(null)
    assert.deepEqual(npcRecordFor(save, 'forest-1-clearings'), { dead: [], hostile: false })
  })
  it('recordNpcState lists the ids that no longer live and the wrath flag', () => {
    const save = normalizeAdventureSave(null)
    const ids = ['npc:m:0', 'npc:m:1', 'npc:m:2']
    const entities = [{ type: 'npc', id: 'npc:m:1', hp: 2 }, { type: 'chest' }]
    recordNpcState(save, 'm', ids, entities, true)
    assert.deepEqual(save.npcs.m, { dead: ['npc:m:0', 'npc:m:2'], hostile: true })
  })
  it('resetNpcs forgets every map', () => {
    const save = normalizeAdventureSave(null)
    recordNpcState(save, 'm', ['npc:m:0'], [], false)
    resetNpcs(save)
    assert.deepEqual(save.npcs, {})
  })
})

describe('save v6', () => {
  it('a fresh save carries empty leaps and the v6 marker', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.leaps, {})
    assert.equal(s.v6, true)
  })
  it('a pre-v6 save at depth 8+ is shifted by three to stay on the same map', () => {
    const v5 = { caves: {}, progress: { mapDepth: 9, cleared: {} }, talents: [], body: null, gates: {}, npcs: {}, felled: {} }
    const s = normalizeAdventureSave(v5)
    assert.equal(s.progress.mapDepth, 12)
    assert.equal(s.v6, true)
    assert.deepEqual(s.leaps, {})
  })
  it('a pre-v6 save at depth 7 is untouched; a v6 save is never shifted twice', () => {
    assert.equal(normalizeAdventureSave({ caves: {}, progress: { mapDepth: 7, cleared: {} } }).progress.mapDepth, 7)
    const twice = normalizeAdventureSave(normalizeAdventureSave({ caves: {}, progress: { mapDepth: 9, cleared: {} } }))
    assert.equal(twice.progress.mapDepth, 12)
  })
})
