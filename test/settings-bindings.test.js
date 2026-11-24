import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTIONS, defaultBindings, cleanBindings, route, rebind, actionOf, keysLabel, bindable } from '../renderer/systems/bindings.js'
import { loadSettings, saveSettings, defaultSettings, stepVolume, SETTINGS_KEY } from '../renderer/systems/settings.js'

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m } }

test('by default every key the game reads goes through untouched', () => {
  const b = defaultBindings()
  for (const a of ACTIONS) for (const k of a.native) assert.deepEqual(route(b, k), { type: 'pass' })
  assert.deepEqual(route(b, 'F'), { type: 'pass' })
  assert.deepEqual(route(b, 'x'), { type: 'pass' })
  assert.deepEqual(route(b, 'Escape'), { type: 'pass' })
})

test('a rebound key is sent as the key the game reads, and the old key goes quiet', () => {
  const b = rebind(defaultBindings(), 'attack', 'k')
  assert.deepEqual(route(b, 'k'), { type: 'send', key: ' ' })
  assert.deepEqual(route(b, 'K'), { type: 'send', key: ' ' })
  assert.deepEqual(route(b, ' '), { type: 'drop' })
  assert.deepEqual(b.attack, ['k'])
})

test('taking a key another action holds swaps the two', () => {
  const b = rebind(defaultBindings(), 'attack', 'q')
  assert.deepEqual(b.attack, ['q'])
  assert.deepEqual(b.offhand, [' '])
  assert.deepEqual(route(b, 'q'), { type: 'send', key: ' ' })
  assert.deepEqual(route(b, ' '), { type: 'send', key: 'q' })
})

test('taking one of two keys of a move leaves it the other', () => {
  const b = rebind(defaultBindings(), 'bag', 'w')
  assert.deepEqual(b.up, ['ArrowUp'])
  assert.deepEqual(b.bag, ['w'])
  assert.equal(actionOf(b, 'i'), null)
  assert.deepEqual(route(b, 'i'), { type: 'drop' })
})

test('Escape and Enter can never be bound', () => {
  const b = defaultBindings()
  assert.equal(rebind(b, 'attack', 'Escape'), b)
  assert.equal(rebind(b, 'attack', 'Enter'), b)
  assert.equal(bindable('F5'), false)
  assert.equal(bindable('Tab'), true)
})

test('every action always has a key, and no key has two actions', () => {
  let b = defaultBindings()
  const keys = ['q', ' ', 'w', 'i', 'Tab', 'm', 'e', 'Shift', 'ArrowUp', 'f', 'z']
  let n = 0
  for (const a of ACTIONS) for (const k of keys) {
    b = rebind(b, a.id, keys[(n++ * 7) % keys.length] ?? k)
    const seen = new Set()
    for (const x of ACTIONS) {
      assert.ok(b[x.id].length >= 1, `${x.id} has a key`)
      for (const key of b[x.id]) { assert.ok(!seen.has(key), `${key} bound once`); seen.add(key) }
    }
  }
})

test('saved bindings are cleaned: junk dropped, doubles kept by the first, gaps filled', () => {
  const b = cleanBindings({ attack: ['q', 'Escape', 7], offhand: ['q'], nonsense: ['x'], up: 'w' })
  assert.deepEqual(b.attack, ['q'])
  assert.deepEqual(b.offhand, [])   // its own key is taken and nothing else was saved for it
  assert.deepEqual(b.up, ['ArrowUp', 'w'])
  assert.deepEqual(cleanBindings(null), defaultBindings())
  assert.equal(keysLabel(b, 'up'), '↑ / W')
  assert.equal(keysLabel(defaultBindings(), 'attack'), 'Space')
})

test('settings: defaults, a round trip, and one bad field does not spoil the rest', () => {
  assert.deepEqual(loadSettings(store()), defaultSettings())
  const s = store()
  const mine = { ...defaultSettings(), volume: 0.3, muted: true, minimap: false, bindings: rebind(defaultBindings(), 'map', 'n') }
  assert.equal(saveSettings(s, mine), true)
  assert.deepEqual(loadSettings(s), mine)
  const bad = store({ [SETTINGS_KEY]: JSON.stringify({ volume: 'loud', muted: true, minimap: 3, bindings: 'no' }) })
  assert.deepEqual(loadSettings(bad), { ...defaultSettings(), muted: true })
  assert.deepEqual(loadSettings(store({ [SETTINGS_KEY]: '{broken' })), defaultSettings())
})

test('the old mute preference is taken over once', () => {
  assert.equal(loadSettings(store({ 'dc-muted': '1' })).muted, true)
  assert.equal(loadSettings(store({ 'dc-muted': '1', [SETTINGS_KEY]: JSON.stringify({ muted: false }) })).muted, false)
})

test('a store that throws is survived', () => {
  const angry = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') } }
  assert.deepEqual(loadSettings(angry), defaultSettings())
  assert.equal(saveSettings(angry, defaultSettings()), false)
})

test('volume moves in tenths and stops at the ends', () => {
  assert.equal(stepVolume(1, 1), 1)
  assert.equal(stepVolume(1, -1), 0.9)
  assert.equal(stepVolume(0.1, -1), 0)
  assert.equal(stepVolume(0, -1), 0)
  assert.equal(stepVolume(0.3, 1), 0.4)
})
