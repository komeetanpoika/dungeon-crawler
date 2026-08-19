import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dungeonLabels, markCleared, isMapComplete, nextMapDepth,
  normalizeAdventureSave, freshProgress,
} from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { ADVENTURE_DEPTH } from '../renderer/data/levels.js'

describe('the adventure map chain', () => {
  it('exports nine maps at depths 7..15', () => {
    assert.deepEqual(Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b),
      [7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('every map but the last has a walkable exit cell', () => {
    for (const [depth, m] of Object.entries(OPEN_MAPS)) {
      if (Number(depth) === 15) { assert.equal(m.exit, null); continue }
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
    assert.equal(nextMapDepth(14), 15)
    assert.equal(nextMapDepth(15), null)
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
    const map = OPEN_MAPS[8]   // bear cave only
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

  it('passes a v2 file through', () => {
    const v2 = { caves: { m: {} }, progress: { mapDepth: 10, cleared: { m: ['a'] } } }
    const s = normalizeAdventureSave(v2)
    assert.deepEqual(s, v2)
  })
})
