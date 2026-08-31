import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTimewarpSave, enterEpisode, episodeEntries } from '../renderer/systems/timewarp.js'
import { EPISODES } from '../renderer/data/leaps.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

describe('normalizeTimewarpSave', () => {
  it('starts empty from nothing', () => {
    assert.deepEqual(normalizeTimewarpSave(null), { episodes: {} })
  })
  it('keeps existing episode records', () => {
    const rec = { resolved: true, save: { caves: {}, progress: { mapDepth: 8, cleared: {} } } }
    const tw = normalizeTimewarpSave({ episodes: { 'lake-1-ferry': rec } })
    assert.equal(tw.episodes['lake-1-ferry'].resolved, true)
  })
  it('seeds from a legacy adventure leaps record, deriving resolved via the rule', () => {
    const legacy = {
      'lake-1-ferry': { flags: { nakki_gone: true, bell_hung: true } },   // rule: nakki_gone
      'marsh-3-hermit': { flags: { wraith_dead: false } },                 // rule: wraith_dead
    }
    const tw = normalizeTimewarpSave(null, legacy, {})
    assert.equal(tw.episodes['lake-1-ferry'].resolved, true)
    assert.equal(tw.episodes['lake-1-ferry'].save.leaps['lake-1-ferry'].flags.bell_hung, true)
    assert.equal(tw.episodes['marsh-3-hermit'].resolved, false)
    assert.equal(tw.episodes['highland-2-fold'], undefined, 'untouched episodes stay absent')
  })
  it('legacy seeding copies the map npc record so wolf-dependent rules see it', () => {
    const legacy = { 'highland-2-fold': { flags: { maahinen_dead: true } } }
    const npcs = { 'highland-2-fold': { dead: ['npc:highland-2-fold:0'], hostile: false } }
    const tw = normalizeTimewarpSave(null, legacy, npcs)
    assert.deepEqual(tw.episodes['highland-2-fold'].save.npcs['highland-2-fold'], npcs['highland-2-fold'])
  })
})

describe('enterEpisode', () => {
  it('creates a fresh adventure-shaped mini-save pinned to the episode depth', () => {
    const tw = normalizeTimewarpSave(null)
    const rec = enterEpisode(tw, 8)
    assert.equal(rec.resolved, false)
    assert.equal(rec.save.progress.mapDepth, 8)
    assert.deepEqual(rec.save.caves, {})
    assert.equal(rec.save.body, null)
    assert.equal(tw.episodes['lake-1-ferry'], rec, 'stored under the map name')
  })
  it('an unresolved episode resumes: the same record comes back', () => {
    const tw = normalizeTimewarpSave(null)
    const rec = enterEpisode(tw, 9)
    rec.save.leaps['highland-2-fold'] = { flags: { fleece_shown: true } }
    assert.equal(enterEpisode(tw, 9), rec)
    assert.equal(enterEpisode(tw, 9).save.leaps['highland-2-fold'].flags.fleece_shown, true)
  })
  it('a resolved episode re-enters fresh, keeping only the checkmark', () => {
    const tw = normalizeTimewarpSave(null)
    const rec = enterEpisode(tw, 8)
    rec.save.leaps['lake-1-ferry'] = { flags: { nakki_gone: true } }
    rec.resolved = true
    const again = enterEpisode(tw, 8)
    assert.equal(again.resolved, true)
    assert.deepEqual(again.save.leaps, {}, 'flags wiped for replay')
  })
})

describe('episodeEntries', () => {
  it('lists the three leap maps in depth order with resolved state', () => {
    const tw = normalizeTimewarpSave(null)
    enterEpisode(tw, 9).resolved = true
    const entries = episodeEntries(tw)
    assert.deepEqual(entries.map(e => e.depth), [8, 9, 10])
    assert.deepEqual(entries.map(e => e.resolved), [false, true, false])
    assert.equal(entries[0].title, OPEN_MAPS[8].title)
    assert.equal(entries[0].persona, 'Toivo')
  })
})

describe('episode kits', () => {
  it('every episode declares a kit (arena player-override shape)', () => {
    for (const [name, ep] of Object.entries(EPISODES)) {
      assert.ok(ep.kit && typeof ep.kit === 'object', `${name} needs a kit`)
    }
  })
})
