// Which key does what. The game reads fixed keys for each action (`native`,
// the first being the one a rebound key is sent as); the player's bindings
// say which real keys stand for an action, and `route` turns a pressed key
// into the key the game expects. DOM-free: game.js owns the one listener.
export const ACTIONS = [
  { id: 'up', label: 'Move up', native: ['ArrowUp', 'w'] },
  { id: 'down', label: 'Move down', native: ['ArrowDown', 's'] },
  { id: 'left', label: 'Move left', native: ['ArrowLeft', 'a'] },
  { id: 'right', label: 'Move right', native: ['ArrowRight', 'd'] },
  { id: 'attack', label: 'Attack', native: [' '] },
  { id: 'offhand', label: 'Offhand', native: ['q'] },
  { id: 'interact', label: 'Talk, interact', native: ['f'] },
  { id: 'swap', label: 'Switch character', native: ['Shift'] },
  { id: 'bag', label: 'Bag', native: ['i'] },
  { id: 'map', label: 'Map', native: ['m'] },
  { id: 'minimap', label: 'Minimap on/off', native: ['Tab'] },
]
const BY_ID = new Map(ACTIONS.map(a => [a.id, a]))
// Never bound and never changed: the menu and its confirm.
export const FIXED = ['Escape', 'Enter']
// Keys that cannot be told apart from typing or that the browser owns.
const REFUSED = new Set([...FIXED, 'Meta', 'OS', 'ContextMenu', 'Unidentified', 'Dead', 'Process'])

export const normKey = k => (typeof k === 'string' && k.length === 1 ? k.toLowerCase() : k)
export const bindable = k => typeof k === 'string' && k.length > 0 && k.length <= 20 && !REFUSED.has(k) && !/^F\d+$/.test(k)

export function defaultBindings() {
  return Object.fromEntries(ACTIONS.map(a => [a.id, [...a.native]]))
}

// A full, sound set of bindings from whatever was saved: unknown actions and
// unusable keys dropped, a key held by two actions kept by the first, and an
// action left with nothing given back whichever of its own keys are free.
export function cleanBindings(saved) {
  const out = {}, taken = new Set()
  const src = saved && typeof saved === 'object' ? saved : {}
  for (const a of ACTIONS) {
    const keys = Array.isArray(src[a.id]) ? src[a.id].map(normKey).filter(bindable) : null
    out[a.id] = []
    if (!keys) continue
    for (const k of keys) if (!taken.has(k) && out[a.id].length < 3) { taken.add(k); out[a.id].push(k) }
  }
  for (const a of ACTIONS) {
    if (out[a.id].length) continue
    for (const k of a.native) if (!taken.has(k)) { taken.add(k); out[a.id].push(k) }
  }
  return out
}

export function actionOf(bindings, key) {
  const k = normKey(key)
  for (const a of ACTIONS) if (bindings[a.id]?.includes(k)) return a.id
  return null
}

// What to do with a pressed key: let it through as it is, drop it, or send
// another key in its place.
export function route(bindings, key) {
  const k = normKey(key)
  if (FIXED.includes(k)) return { type: 'pass' }
  const id = actionOf(bindings, k)
  if (id) {
    const a = BY_ID.get(id)
    return a.native.includes(k) ? { type: 'pass' } : { type: 'send', key: a.native[0] }
  }
  // a key the game reads for an action the player took it away from
  return ACTIONS.some(a => a.native.includes(k)) ? { type: 'drop' } : { type: 'pass' }
}

// Give `id` the key and nothing else. An action that held the key loses it,
// and if that leaves it with none it takes over what `id` had.
export function rebind(bindings, id, key) {
  const k = normKey(key)
  if (!BY_ID.has(id) || !bindable(k)) return bindings
  const out = Object.fromEntries(ACTIONS.map(a => [a.id, [...(bindings[a.id] ?? [])]]))
  const old = out[id]
  const other = actionOf(out, k)
  out[id] = [k]
  if (other && other !== id) {
    out[other] = out[other].filter(x => x !== k)
    if (!out[other].length) out[other] = old.filter(x => x !== k).slice(0, 1)
  }
  return cleanBindings(out)
}

const NAMES = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Control: 'Ctrl' }
export const keyName = k => NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k)
export const keysLabel = (bindings, id) => (bindings[id] ?? []).map(keyName).join(' / ') || '—'
