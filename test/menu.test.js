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
import { showOnline, showFriends, showLeaveConfirm, showPvpResults } from '../renderer/ui/menu.js'

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

// A DOM stub with a body (for the menu-typing class), setAttribute on
// elements, a captured keydown listener, and an optional web saveAPI.
function stubDomFull({ isWeb = false } = {}) {
  const bodyClasses = new Set()
  const makeEl = (tag) => {
    const el = {
      tag, children: [], className: '', textContent: '', style: {}, innerHTML: '', listeners: {}, attrs: {},
      value: '', maxLength: 0, autocomplete: '',
      appendChild(c) { el.children.push(c); return c },
      addEventListener(ev, fn) { el.listeners[ev] = fn },
      setAttribute(k, v) { el.attrs[k] = String(v) },
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
    body: { classList: { toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)), remove: c => bodyClasses.delete(c) } },
  }
  globalThis.window = {
    addEventListener: (ev, fn) => { if (ev === 'keydown') keydownHandler = fn },
    removeEventListener: (ev) => { if (ev === 'keydown') keydownHandler = null },
    saveAPI: isWeb ? { isWeb: true } : undefined,
  }
  const press = (key, opts = {}) => {
    const e = { key, repeat: false, target: null, defaultPrevented: false, preventDefault() { e.defaultPrevented = true }, ...opts }
    keydownHandler?.(e)
    return e
  }
  const cleanup = () => { hide(); delete globalThis.document; delete globalThis.window }
  return { overlay, press, bodyClasses, cleanup }
}
const labelsOf = overlay => buttonsOf(overlay).map(b => b.textContent)
const titleOf = overlay => overlay.children[0].children[0].textContent
const inputOf = overlay => overlay.children[0].children.find(c => c.tag === 'input')
const META = { deepestReached: 0, runsCompleted: 0, treasureStolen: false }

describe('the Online menu', () => {
  it('the web title has Online right after Dungeon Rush, and it calls onOnline', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      let online = false
      showTitle(META, { onOnline: () => { online = true } })
      assert.deepEqual(labelsOf(d.overlay), ['Adventure', 'Timewarp', 'Dungeon Rush', 'Online'])
      buttonsOf(d.overlay)[3].listeners.click()
      assert.equal(online, true)
    } finally { d.cleanup() }
  })
  it('the desktop title has no Online button', () => {
    const d = stubDomFull({ isWeb: false })
    try {
      showTitle(META, {})
      assert.deepEqual(labelsOf(d.overlay), ['Adventure', 'Timewarp', 'Dungeon Rush', 'Open Editor', 'Quit'])
    } finally { d.cleanup() }
  })
  it('Online: Quick match, Play with friends, Back — and Escape goes back', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      const got = []
      showOnline({ onQuick: () => got.push('quick'), onFriends: () => got.push('friends'), onBack: () => got.push('back') })
      assert.equal(titleOf(d.overlay), 'Online')
      assert.deepEqual(labelsOf(d.overlay), ['Quick match', 'Play with friends', 'Back'])
      buttonsOf(d.overlay).forEach(b => b.listeners.click())
      d.press('Escape')
      assert.deepEqual(got, ['quick', 'friends', 'back', 'back'])
    } finally { d.cleanup() }
  })
  it('Play with friends: Host a room, Join with code, Back — and Escape goes back', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      const got = []
      showFriends({ onHost: () => got.push('host'), onJoin: () => got.push('join'), onBack: () => got.push('back') })
      assert.equal(titleOf(d.overlay), 'Play with friends')
      assert.deepEqual(labelsOf(d.overlay), ['Host a room', 'Join with code', 'Back'])
      buttonsOf(d.overlay).forEach(b => b.listeners.click())
      d.press('Escape')
      assert.deepEqual(got, ['host', 'join', 'back', 'back'])
    } finally { d.cleanup() }
  })
})

describe('the leave confirm', () => {
  it('asks "Leave the match?" with Stay then Leave, each calling its handler', () => {
    const d = stubDomFull()
    try {
      const got = []
      showLeaveConfirm({ onStay: () => got.push('stay'), onLeave: () => got.push('leave') })
      assert.equal(titleOf(d.overlay), 'Leave the match?')
      assert.deepEqual(labelsOf(d.overlay), ['Stay', 'Leave'])
      buttonsOf(d.overlay).forEach(b => b.listeners.click())
      assert.deepEqual(got, ['stay', 'leave'])
    } finally { d.cleanup() }
  })
  it('Space (the red touch button) confirms the selected Stay, never Leave', () => {
    const d = stubDomFull()
    try {
      const got = []
      showLeaveConfirm({ onStay: () => got.push('stay'), onLeave: () => got.push('leave') })
      d.press(' ')
      assert.deepEqual(got, ['stay'])
    } finally { d.cleanup() }
  })
  it('Escape on it calls neither handler: game.js owns Escape in a match', () => {
    const d = stubDomFull()
    try {
      const got = []
      showLeaveConfirm({ onStay: () => got.push('stay'), onLeave: () => got.push('leave') })
      d.press('Escape')
      assert.deepEqual(got, [])
    } finally { d.cleanup() }
  })
})

describe('text entry on a phone', () => {
  it('the code field asks for capitals with no autocomplete, and the touch layer is hidden while typing', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      showTextEntry({ title: 'Join with code', subtitle: 'Room code', autocapitalize: 'characters', onSubmit: () => {} })
      const inp = inputOf(d.overlay)
      assert.equal(inp.attrs.autocapitalize, 'characters')
      assert.equal(inp.autocomplete, 'off')
      assert.equal(d.bodyClasses.has('menu-typing'), true)
      showMessage({ title: 'Finding a match…', onOk: () => {} })
      assert.equal(d.bodyClasses.has('menu-typing'), false)
      showTextEntry({ title: 'Quick match', subtitle: 'Your name', onSubmit: () => {} })
      assert.equal(d.bodyClasses.has('menu-typing'), true)
      hide()
      assert.equal(d.bodyClasses.has('menu-typing'), false)
    } finally { d.cleanup() }
  })
  it("the keyboard's Enter in the field submits its text", () => {
    const d = stubDomFull({ isWeb: true })
    try {
      let got = null
      showTextEntry({ title: 'Quick match', subtitle: 'Your name', value: 'Aino', onSubmit: v => { got = v } })
      const inp = inputOf(d.overlay)
      inp.value = 'Ilmari'
      d.press('Enter', { target: inp })
      assert.equal(got, 'Ilmari')
    } finally { d.cleanup() }
  })
})

describe('online results', () => {
  it('the online table ends in Leave, and has no Next match', () => {
    const d = stubDomFull()
    try {
      let left = false
      showPvpResults([{ rank: 1, name: 'Bot Ukko', cls: 'mage', kills: 3, deaths: 1 }], { onQuit: () => { left = true }, quitLabel: 'Leave' })
      assert.deepEqual(labelsOf(d.overlay), ['Leave'])
      buttonsOf(d.overlay)[0].listeners.click()
      assert.equal(left, true)
    } finally { d.cleanup() }
  })
})
