import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dungeonLabels, markCleared, isMapComplete, nextMapDepth,
  normalizeAdventureSave, normalizeBody, freshProgress, npcRecordFor, recordNpcState, resetNpcs,
  recordVisit, waystoneDestinations,
} from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { ADVENTURE_DEPTH } from '../renderer/data/levels.js'
import { DAY_START } from '../renderer/data/weather.js'
import { makeRangedContents, emptyAmmo } from '../renderer/systems/entities.js'

describe('the adventure map chain', () => {
  it('exports the adventure chain at depths 7..18 (leap maps at 8-10)', () => {
    const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b)
    assert.deepEqual(depths, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
    assert.equal(OPEN_MAPS[7].name, 'forest-1-clearings')
    assert.equal(OPEN_MAPS[10].name, 'marsh-3-hermit')
    assert.equal(OPEN_MAPS[11].name, 'forest-2-river')
    assert.equal(OPEN_MAPS[18].name, 'sea-3-archipelago')
    assert.equal(OPEN_MAPS[8].leap, true)
    assert.equal(OPEN_MAPS[9].leap, true)
    assert.equal(OPEN_MAPS[10].leap, true)
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

  it('nextMapDepth walks the chain, skipping leap maps, and ends after the last map', () => {
    assert.equal(nextMapDepth(7), 11)
    assert.equal(nextMapDepth(11), 12)
    assert.equal(nextMapDepth(17), 18)
    assert.equal(nextMapDepth(18), null)
    assert.equal(nextMapDepth(8), null, 'leap maps are not on the chain')
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
    assert.deepEqual(normalizeAdventureSave(v3), {
      ...v3, body: { ...v3.body, wand: null, ammo: { arrow: 0, bolt: 0, stone: 0 } },
      gates: {}, npcs: {}, felled: {}, leaps: {}, clock: DAY_START, v6: true, v7: true,
    })
  })

  it('v4 saves keep their npcs and gain an empty felled map', () => {
    const v4 = { caves: {}, progress: { mapDepth: 7, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: { 'forest-1-clearings': { dead: ['npc:forest-1-clearings:0'], hostile: false } } }
    assert.deepEqual(normalizeAdventureSave(v4), { ...v4, felled: {}, leaps: {}, clock: DAY_START, v6: true, v7: true })
  })

  it('a fresh save has no felled trees', () => {
    assert.deepEqual(normalizeAdventureSave(null).felled, {})
  })

  it('a legacy sack bow is rebuilt from the weapon table and its ammo joins the pool', () => {
    // Pre-redesign sack bows carried their own ammo/maxAmmo and no ammoKind.
    // Keeping that payload would leave tryFire reading player.ammo[undefined]
    // forever, so the payload is re-derived and the old count banked once.
    const payload = { weaponType: 'shortbow', ammo: 5, maxAmmo: 12, type: 'ranged' }
    const v3 = { caves: {}, progress: { mapDepth: 7, cleared: {} },
      talents: [], body: {
        weapon: null, ranged: null,
        inventory: [
          { kind: 'ranged', name: 'bow', emoji: '🏹', stackable: false, payload },
        ],
      } }
    const s = normalizeAdventureSave(v3)
    const item = s.body.inventory[0]
    assert.equal(item.kind, 'ranged')
    const { type: _t, ...fresh } = makeRangedContents('shortbow')
    assert.deepEqual(item.payload, fresh, 'payload rebuilt from the table')
    assert.equal(item.payload.ammoKind, 'arrow')
    assert.equal(item.payload.ammo, undefined, 'no stale per-weapon ammo')
    assert.equal(item.payload.maxAmmo, undefined)
    assert.equal(s.body.ammo.arrow, 5, 'the old on-weapon count credited to the pool once')
  })

  it('a legacy sack bow of an unknown type is dropped, not left unusable', () => {
    const v3 = { caves: {}, progress: { mapDepth: 7, cleared: {} },
      talents: [], body: {
        weapon: null, ranged: null,
        inventory: [{ kind: 'ranged', name: 'Raygun', emoji: '🏹', stackable: false,
          payload: { weaponType: 'raygun', ammo: 3 } }],
      } }
    const s = normalizeAdventureSave(v3)
    assert.deepEqual(s.body.inventory, [])
    assert.deepEqual(s.body.ammo, emptyAmmo())
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

describe('save v7 (mode split)', () => {
  it('a fresh save carries visited=[Clearings] and the v7 marker', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.progress.visited, ['forest-1-clearings'])
    assert.equal(s.v7, true)
  })
  it('a v6 save stranded on a leap map is moved to the river (depth 11)', () => {
    const v6 = { caves: {}, progress: { mapDepth: 9, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true }
    const s = normalizeAdventureSave(v6)
    assert.equal(s.progress.mapDepth, 11)
    assert.equal(s.v7, true)
  })
  it('visited is seeded with every non-leap map at or below the current depth', () => {
    const v6 = { caves: {}, progress: { mapDepth: 12, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true }
    const s = normalizeAdventureSave(v6)
    assert.deepEqual(s.progress.visited,
      ['forest-1-clearings', 'forest-2-river', 'forest-3-autumn'])
  })
  it('an existing visited list is kept, and the bump never runs twice', () => {
    const v7 = { caves: {}, progress: { mapDepth: 11, cleared: {}, visited: ['forest-1-clearings'] },
      talents: [], body: null, gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true, v7: true }
    const s = normalizeAdventureSave(v7)
    assert.deepEqual(s.progress.visited, ['forest-1-clearings'])
    assert.equal(s.progress.mapDepth, 11)
  })
})

describe('recordVisit', () => {
  it('appends once, ignoring duplicates', () => {
    const progress = freshProgress()
    progress.visited = []
    recordVisit(progress, 'forest-2-river')
    recordVisit(progress, 'forest-2-river')
    assert.deepEqual(progress.visited, ['forest-2-river'])
  })
})

describe('waystoneDestinations', () => {
  it('lists only the visited map while its dungeons are uncleared', () => {
    const s = normalizeAdventureSave(null)   // visited: Clearings, nothing cleared
    assert.deepEqual(s.progress.visited, ['forest-1-clearings'])
    const dests = waystoneDestinations(s)
    assert.deepEqual(dests.map(d => d.depth), [7])
  })
  it('adds the next chain map once the frontier map is complete', () => {
    const s = normalizeAdventureSave(null)
    for (const label of dungeonLabels(OPEN_MAPS[7])) markCleared(s.progress, OPEN_MAPS[7].name, label)
    const dests = waystoneDestinations(s)
    assert.deepEqual(dests.map(d => d.depth), [7, 11], 'skips the leap maps')
    assert.equal(dests[1].title, OPEN_MAPS[11].title)
  })
  it('an uncleared frontier still allows hopping back through every visited map', () => {
    const s = normalizeAdventureSave(null)
    recordVisit(s.progress, OPEN_MAPS[11].name)
    recordVisit(s.progress, OPEN_MAPS[12].name)   // frontier: autumn, uncleared
    assert.deepEqual(waystoneDestinations(s).map(d => d.depth), [7, 11, 12])
  })
  it('the last map has no next entry even when complete', () => {
    const s = normalizeAdventureSave(null)
    for (const d of [11, 12, 13, 14, 15, 16, 17, 18]) recordVisit(s.progress, OPEN_MAPS[d].name)
    for (const label of dungeonLabels(OPEN_MAPS[18])) markCleared(s.progress, OPEN_MAPS[18].name, label)
    assert.deepEqual(waystoneDestinations(s).map(d => d.depth), [7, 11, 12, 13, 14, 15, 16, 17, 18])
  })
})

describe('normalizeBody', () => {
  it('passes null through untouched', () => {
    assert.equal(normalizeBody(null), null)
  })

  it('defaults wand and ammo on an otherwise-current body', () => {
    const b = normalizeBody({ weapon: null, ranged: null, inventory: [] })
    assert.equal(b.wand, null)
    assert.deepEqual(b.ammo, { arrow: 0, bolt: 0, stone: 0 })
  })

  it('moves a legacy ranged wand to the wand slot', () => {
    const b = normalizeBody({ weapon: null, ranged: { weaponType: 'sparkwand', ammo: 5 }, inventory: [] })
    assert.equal(b.wand.weaponType, 'sparkwand')
    assert.equal(b.ranged, null)
  })

  it('folds a legacy bow\'s own ammo into the pool and drops ammo/maxAmmo from the weapon', () => {
    const b = normalizeBody({ weapon: null, ranged: { weaponType: 'longbow', ammo: 7, maxAmmo: 10 }, inventory: [] })
    assert.equal(b.ammo.arrow, 7)
    assert.equal(b.ranged.weaponType, 'longbow')
    assert.ok(!('ammo' in b.ranged), 'ammo dropped from the weapon')
    assert.ok(!('maxAmmo' in b.ranged), 'maxAmmo dropped from the weapon')
  })

  it('converts a sack ranged item with a wand payload to kind wand', () => {
    const b = normalizeBody({
      weapon: null, ranged: null,
      inventory: [{ kind: 'ranged', name: 'x', emoji: '🏹', stackable: false, payload: { weaponType: 'firewand', ammo: 3 } }],
    })
    assert.equal(b.inventory[0].kind, 'wand')
    assert.equal(b.inventory[0].payload.weaponType, 'firewand')
    assert.ok(!('ammo' in b.inventory[0].payload), 'wand payload has no ammo field')
  })

  it('drops unknown weapon types rather than crashing', () => {
    const b = normalizeBody({
      weapon: null, ranged: { weaponType: 'made-up-gun', ammo: 1 },
      inventory: [{ kind: 'ranged', name: 'x', emoji: '🏹', stackable: false, payload: { weaponType: 'made-up-gun' } }],
    })
    assert.equal(b.ranged, null)
    assert.deepEqual(b.inventory, [])
  })

  it('is idempotent', () => {
    const once = normalizeBody({ weapon: null, ranged: { weaponType: 'longbow', ammo: 7, maxAmmo: 10 }, inventory: [
      { kind: 'ranged', name: 'x', emoji: '🏹', stackable: false, payload: { weaponType: 'stormwand' } },
    ] })
    const twice = normalizeBody(once)
    assert.deepEqual(twice, once)
  })
})
