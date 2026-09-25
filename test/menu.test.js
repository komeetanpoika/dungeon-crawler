import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMetaSummary, navActionFor, showTitle, showClassPicker, showTextEntry, showMessage } from '../renderer/ui/menu.js'

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

describe('showMessage', () => {
  it('defaults the button label to OK', () => {
    const overlay = stubDom()
    try {
      let ok = false
      showMessage({ title: 'Connecting…', onOk: () => { ok = true } })
      const btns = buttonsOf(overlay)
      assert.deepEqual(btns.map(b => b.textContent), ['OK'])
      btns[0].listeners.click()
      assert.equal(ok, true)
      hide()
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })

  it('accepts a custom button label (e.g. "Leave" on the next-match wait message)', () => {
    const overlay = stubDom()
    try {
      showMessage({ title: 'Next match starting…', onOk: () => {}, okLabel: 'Leave' })
      const btns = buttonsOf(overlay)
      assert.deepEqual(btns.map(b => b.textContent), ['Leave'])
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

// A DOM stub that actually captures the window keydown listener menu.js
// installs (stubDom's window is a pure no-op, fine for click-driven tests
// but useless here), so these tests can fire synthetic key events and read
// back e.defaultPrevented.
function stubDomWithKeys() {
  const makeEl = (tag) => {
    const el = {
      tag, children: [], className: '', textContent: '', style: {}, innerHTML: '',
      listeners: {}, value: '', maxLength: 0, autocomplete: '',
      appendChild(c) { el.children.push(c); return c },
      addEventListener(ev, fn) { el.listeners[ev] = fn },
      classList: { toggle() {} },
      focus() {},
    }
    return el
  }
  const overlay = makeEl('div')
  let keydownHandler = null
  globalThis.document = {
    getElementById: id => (id === 'menu-overlay' ? overlay : null),
    createElement: makeEl,
  }
  globalThis.window = {
    addEventListener: (ev, fn) => { if (ev === 'keydown') keydownHandler = fn },
    removeEventListener: (ev) => { if (ev === 'keydown') keydownHandler = null },
    saveAPI: undefined,
  }
  const press = (key, opts = {}) => {
    const e = { key, repeat: false, target: null, defaultPrevented: false, preventDefault() { e.defaultPrevented = true }, ...opts }
    keydownHandler?.(e)
    return e
  }
  return { overlay, press }
}

describe('menu key handler: held keys, Escape, and cheat/nav interplay', () => {
  it('a repeated (held) confirm key is ignored — a panel that opens under a still-held Space cannot be pressed by it', () => {
    const { press } = stubDomWithKeys()
    try {
      let picked = null
      showClassPicker({ onPick: cls => { picked = cls } })
      const e = press(' ', { repeat: true })
      assert.equal(picked, null)
      assert.equal(e.defaultPrevented, true)
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })

  it('a repeated (held) down-nav key is ignored', () => {
    const { press } = stubDomWithKeys()
    try {
      let picked = null
      showClassPicker({ onPick: cls => { picked = cls } })
      press('s', { repeat: true })
      // Selection must still be index 0 (Warrior) — confirm it directly.
      press(' ')
      assert.equal(picked, 'warrior')
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })

  it('Escape on a class-picker screen calls onBack', () => {
    const { press } = stubDomWithKeys()
    try {
      let back = false
      showClassPicker({ onPick: () => {}, onBack: () => { back = true } })
      press('Escape')
      assert.equal(back, true)
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })

  it('Escape on a text-entry screen calls onBack', () => {
    const { press } = stubDomWithKeys()
    try {
      let back = false
      showTextEntry({ title: 'Host a room', onSubmit: () => {}, onBack: () => { back = true } })
      press('Escape')
      assert.equal(back, true)
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })

  it('typing "host" (lowercase, letter by letter) fires onNet even though "s" is also the down-nav key, and prevents default on the firing key', () => {
    const { press } = stubDomWithKeys()
    try {
      let netFired = null
      showTitle({ deepestReached: 0, runsCompleted: 0, treasureStolen: false },
        { onCheat: () => {}, onNet: k => { netFired = k } })
      press('h'); press('o'); press('s')
      assert.equal(netFired, null)
      const e = press('t')
      assert.equal(netFired, 'host')
      assert.equal(e.defaultPrevented, true)
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })
})
