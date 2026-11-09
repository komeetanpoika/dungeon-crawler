import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TABS, tabsFor, startTab, disabledNote } from '../tools/monster-studio/tabs.js'

describe('studio tabs', () => {
  it('tabsFor and startTab by kind', () => {
    assert.deepEqual(TABS.filter(t => tabsFor('code')[t]), ['movement', 'fight', 'publish'])
    assert.deepEqual(TABS.filter(t => tabsFor('story')[t]), ['movement', 'publish'])
    assert.deepEqual(TABS.filter(t => tabsFor('drawn')[t]), TABS)
    assert.equal(startTab('new'), 'drawing'); assert.equal(startTab('drawn'), 'cuts'); assert.equal(startTab('story'), 'movement')
    assert.equal(disabledNote('story', 'fight'), 'Fights only inside its story.')
    assert.equal(disabledNote('drawn', 'fight'), null)
  })

  it('a new drawing gets every tab; code monsters start on Movement', () => {
    assert.deepEqual(TABS.filter(t => tabsFor('new')[t]), TABS)
    assert.equal(startTab('code'), 'movement')
  })

  it('every disabled tab carries a note, and only disabled tabs do', () => {
    for (const kind of ['new', 'drawn', 'code', 'story']) {
      for (const tab of TABS) {
        const note = disabledNote(kind, tab)
        if (tabsFor(kind)[tab]) assert.equal(note, null, `${kind}/${tab}`)
        else assert.equal(typeof note, 'string', `${kind}/${tab}`)
      }
    }
    assert.equal(disabledNote('code', 'drawing'), "Drawn by code: there's no picture to cut.")
    assert.equal(disabledNote('story', 'cuts'), "Drawn by code: there's no picture to cut.")
  })
})
