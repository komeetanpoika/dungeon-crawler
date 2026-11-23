// The player's settings: sound, keys, the minimap. Kept apart from every
// save, in one record, through a store with getItem/setItem (localStorage in
// the game). DOM-free.
import { cleanBindings, defaultBindings } from './bindings.js'

export const SETTINGS_KEY = 'dc-settings'
const LEGACY_MUTED = 'dc-muted'
export const VOLUME_STEPS = 10

export const defaultSettings = () => ({ v: 1, volume: 1, muted: false, bindings: defaultBindings(), minimap: true })

const read = (store, key) => { try { return store?.getItem(key) ?? null } catch { return null } }

// Every field stands on its own: a bad one falls back to its default.
export function loadSettings(store) {
  const out = defaultSettings()
  let saved = null
  try { saved = JSON.parse(read(store, SETTINGS_KEY)) } catch { saved = null }
  if (!saved || typeof saved !== 'object') {
    out.muted = read(store, LEGACY_MUTED) === '1'   // the old M-key preference
    return out
  }
  if (Number.isFinite(saved.volume)) out.volume = Math.round(Math.min(1, Math.max(0, saved.volume)) * VOLUME_STEPS) / VOLUME_STEPS
  if (typeof saved.muted === 'boolean') out.muted = saved.muted
  if (typeof saved.minimap === 'boolean') out.minimap = saved.minimap
  out.bindings = cleanBindings(saved.bindings)
  return out
}

export function saveSettings(store, settings) {
  try { store?.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true } catch { return false }
}

export const stepVolume = (volume, by) => Math.round(Math.min(VOLUME_STEPS, Math.max(0, Math.round(volume * VOLUME_STEPS) + by))) / VOLUME_STEPS
