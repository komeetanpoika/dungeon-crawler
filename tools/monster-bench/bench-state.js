// tools/monster-bench/bench-state.js
// The bench panel's model: the values it edits (a monster's tuning, its
// hp/dmg/speed and the numeric fields of its behaviour), which of them are
// unsaved, and the switches. A snapshot of the unsaved values and the
// switches rides sessionStorage across the bench's reload-on-edit, so a
// tweak never vanishes because Claude saved a file. Pure — no DOM.
import { clampParams } from '../../renderer/render/monster-rigs/schema.js'

const SECTIONS = ['tuning', 'stats', 'behavior']
const STATS = ['hp', 'dmg', 'speed']

export const storageKey = name => `dc-bench:${name}`

export function makeBenchModel(def) {
  const numeric = obj => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => Number.isFinite(v)))
  return {
    values: {
      tuning: { ...(def.tuning ?? {}) },
      stats: Object.fromEntries(STATS.map(k => [k, def.stats?.[k]])),
      behavior: numeric(def.behavior),
    },
    dirty: new Set(),
    switches: { frozen: false, invulnerable: false, hitboxes: false, timeScale: 1, paused: false, count: 1, collapsed: false },
  }
}

export function edit(model, section, key, value) {
  model.values[section][key] = value
  model.dirty.add(`${section}.${key}`)
}

export function savePatch(model) {
  const { tuning, stats, behavior } = model.values
  return { tuning: { ...tuning }, stats: { ...stats }, behavior: { ...behavior } }
}

export function markSaved(model) { model.dirty.clear() }

// Pausing is never carried over: a reload resumes play.
export function snapshot(model) {
  const values = {}
  for (const k of model.dirty) {
    const [section, key] = k.split('.')
    values[k] = model.values[section][key]
  }
  const { paused, ...switches } = model.switches
  return JSON.stringify({ values, switches })
}

// Unsaved values win over what is on disk for keys that still exist (a
// tuning key still in the schema, re-clamped to its current range; a stat;
// a numeric behaviour field the def still has) and stay unsaved. The rest
// come from disk.
export function restore(model, text, schema) {
  let snap
  try { snap = JSON.parse(text ?? 'null') } catch { return }
  if (!snap || typeof snap !== 'object') return
  const bySchemaKey = new Map((schema ?? []).map(p => [p.key, p]))
  for (const [k, v] of Object.entries(snap.values ?? {})) {
    const [section, key] = k.split('.')
    if (!SECTIONS.includes(section)) continue
    if (section === 'tuning') {
      const p = bySchemaKey.get(key)
      if (!p || (p.type === 'range' && !Number.isFinite(v))) continue
      edit(model, section, key, clampParams([p], { [key]: v })[key])
    } else if (key in model.values[section] && Number.isFinite(v)) edit(model, section, key, v)
  }
  for (const [k, v] of Object.entries(snap.switches ?? {}))
    if (k in model.switches && k !== 'paused' && typeof v === typeof model.switches[k]) model.switches[k] = v
}
