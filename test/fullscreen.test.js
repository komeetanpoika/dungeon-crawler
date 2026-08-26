import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRequestFullscreen, initFullscreen } from '../renderer/ui/fullscreen.js'

describe('shouldRequestFullscreen', () => {
  const base = { coarse: true, supported: true, active: false, standalone: false }

  it('requests on a coarse-pointer device with API support and no fullscreen yet', () => {
    assert.equal(shouldRequestFullscreen(base), true)
  })

  it('skips fine-pointer (desktop) devices', () => {
    assert.equal(shouldRequestFullscreen({ ...base, coarse: false }), false)
  })

  it('skips when the Fullscreen API is unsupported (iPhone Safari)', () => {
    assert.equal(shouldRequestFullscreen({ ...base, supported: false }), false)
  })

  it('skips when already fullscreen', () => {
    assert.equal(shouldRequestFullscreen({ ...base, active: true }), false)
  })

  it('skips installed PWAs — the manifest already made them fullscreen', () => {
    assert.equal(shouldRequestFullscreen({ ...base, standalone: true }), false)
  })
})

// Minimal stand-ins for window/document: just enough surface for initFullscreen.
function makeStubs({ coarse = true, supported = true, standalone = false } = {}) {
  const winListeners = {}
  const docListeners = {}
  const calls = { requestFullscreen: 0, lock: [] }
  const win = {
    matchMedia: q => ({
      matches: q.includes('coarse') ? coarse
        : q.includes('display-mode') ? standalone
        : false,
    }),
    addEventListener: (type, fn) => { (winListeners[type] ??= []).push(fn) },
    screen: {
      orientation: { lock: type => { calls.lock.push(type); return Promise.resolve() } },
    },
  }
  const doc = {
    fullscreenElement: null,
    documentElement: supported
      ? { requestFullscreen: () => { calls.requestFullscreen++; return Promise.resolve() } }
      : {},
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn) },
  }
  const fire = (listeners, type, event = {}) => (listeners[type] ?? []).forEach(fn => fn(event))
  return {
    win, doc, calls,
    // Touch user-activation is granted at pointerup (not pointerdown), so
    // pointerup is the event the module must act on.
    tap: () => fire(docListeners, 'pointerup'),
    fullscreenchange: () => fire(docListeners, 'fullscreenchange'),
  }
}

describe('initFullscreen', () => {
  it('requests fullscreen on the first tap', () => {
    const { win, doc, calls, tap } = makeStubs()
    initFullscreen(win, doc)
    tap()
    assert.equal(calls.requestFullscreen, 1)
  })

  it('does not re-request while fullscreen is active', () => {
    const { win, doc, calls, tap } = makeStubs()
    initFullscreen(win, doc)
    tap()
    doc.fullscreenElement = doc.documentElement
    tap()
    assert.equal(calls.requestFullscreen, 1)
  })

  it('requests again after fullscreen is exited', () => {
    const { win, doc, calls, tap } = makeStubs()
    initFullscreen(win, doc)
    tap()
    doc.fullscreenElement = doc.documentElement
    tap()
    doc.fullscreenElement = null
    tap()
    assert.equal(calls.requestFullscreen, 2)
  })

  it('never requests on fine-pointer devices', () => {
    const { win, doc, calls, tap } = makeStubs({ coarse: false })
    initFullscreen(win, doc)
    tap()
    assert.equal(calls.requestFullscreen, 0)
  })

  it('never requests without API support', () => {
    const { win, doc, calls, tap } = makeStubs({ supported: false })
    initFullscreen(win, doc)
    tap()
    assert.equal(calls.requestFullscreen, 0)
  })

  it('never requests inside an installed PWA', () => {
    const { win, doc, calls, tap } = makeStubs({ standalone: true })
    initFullscreen(win, doc)
    tap()
    assert.equal(calls.requestFullscreen, 0)
  })

  it('locks landscape orientation once fullscreen is entered', () => {
    const { win, doc, calls, tap, fullscreenchange } = makeStubs()
    initFullscreen(win, doc)
    tap()
    doc.fullscreenElement = doc.documentElement
    fullscreenchange()
    assert.deepEqual(calls.lock, ['landscape'])
  })

  it('does not try to lock orientation when leaving fullscreen', () => {
    const { win, doc, calls, fullscreenchange } = makeStubs()
    initFullscreen(win, doc)
    doc.fullscreenElement = null
    fullscreenchange()
    assert.deepEqual(calls.lock, [])
  })

  it('survives a device without screen.orientation', () => {
    const { win, doc, tap, fullscreenchange } = makeStubs()
    delete win.screen.orientation
    initFullscreen(win, doc)
    tap()
    doc.fullscreenElement = doc.documentElement
    assert.doesNotThrow(fullscreenchange)
  })
})
