import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMetaSummary, navActionFor } from '../renderer/ui/menu.js'

describe('formatMetaSummary', () => {
  it('formats a played meta with treasure stolen', () => {
    const s = formatMetaSummary({ deepestReached: 4, runsCompleted: 12, treasureStolen: true })
    assert.equal(s, 'Deepest: Level 4 · Runs: 12 · Treasure: ✓')
  })

  it('formats a fresh meta without treasure', () => {
    const s = formatMetaSummary({ deepestReached: 0, runsCompleted: 0, treasureStolen: false })
    assert.equal(s, 'Deepest: Level 0 · Runs: 0 · Treasure: ✗')
  })
})

describe('navActionFor', () => {
  it('maps arrows and stick keys to menu movement', () => {
    assert.equal(navActionFor('ArrowDown'), 'down')
    assert.equal(navActionFor('s'), 'down')
    assert.equal(navActionFor('ArrowUp'), 'up')
    assert.equal(navActionFor('w'), 'up')
  })
  it('maps Enter and Space (the red button) to confirm', () => {
    assert.equal(navActionFor('Enter'), 'confirm')
    assert.equal(navActionFor(' '), 'confirm')
  })
  it('leaves other keys to the cheat buffer', () => {
    assert.equal(navActionFor('m'), null)
    assert.equal(navActionFor('Escape'), null)
  })
})

import { showEpisodeSelect, showDestinations, hide } from '../renderer/ui/menu.js'

// Minimal DOM stub: enough for renderScreen (createElement, overlay lookup).
function stubDom() {
  const makeEl = (tag) => {
    const el = {
      tag, children: [], className: '', textContent: '', style: {}, innerHTML: '',
      listeners: {},
      appendChild(c) { el.children.push(c); return c },
      addEventListener(ev, fn) { el.listeners[ev] = fn },
      classList: { toggle() {} },
    }
    return el
  }
  const overlay = makeEl('div')
  globalThis.document = {
    getElementById: id => (id === 'menu-overlay' ? overlay : null),
    createElement: makeEl,
  }
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  return overlay
}

function buttonsOf(overlay) {
  const panel = overlay.children[0]
  return panel.children.filter(c => c.tag === 'button')
}

describe('showEpisodeSelect', () => {
  it('renders one button per episode plus Back, tinting resolved ones', () => {
    const overlay = stubDom()
    try {
      const picks = []
      showEpisodeSelect(
        [{ depth: 8, title: 'Ferry', resolved: true }, { depth: 9, title: 'Fold', resolved: false }],
        { onPick: d => picks.push(d), onBack: () => picks.push('back') },
      )
      const btns = buttonsOf(overlay)
      assert.deepEqual(btns.map(b => b.textContent), ['Ferry', 'Fold', 'Back'])
      assert.equal(btns[0].className, 'menu-btn done')
      assert.equal(btns[1].className, 'menu-btn')
      btns[1].listeners.click()
      btns[2].listeners.click()
      assert.deepEqual(picks, [9, 'back'])
      hide()
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })
})

describe('showDestinations', () => {
  it('renders one button per destination plus Stay', () => {
    const overlay = stubDom()
    try {
      const picks = []
      showDestinations(
        [{ depth: 7, title: 'Clearings' }, { depth: 11, title: 'River' }],
        { onPick: d => picks.push(d), onCancel: () => picks.push('stay') },
      )
      const btns = buttonsOf(overlay)
      assert.deepEqual(btns.map(b => b.textContent), ['Clearings', 'River', 'Stay'])
      btns[0].listeners.click()
      btns[2].listeners.click()
      assert.deepEqual(picks, [7, 'stay'])
      hide()
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })
})
