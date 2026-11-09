// tools/monster-bench/bench-state.js
// The bench panel's model: the values it edits (a monster's tuning, its
// hp/dmg/speed and the numeric fields of its behaviour), which of them are
// unsaved, and the switches. A snapshot of the unsaved values and the
// switches rides sessionStorage across the bench's reload-on-edit, so a
// tweak never vanishes because Claude saved a file. Pure — no DOM.
import { clampParams } from '../../renderer/render/monster-rigs/schema.js'
import { WEAPONS } from '../../renderer/systems/enemy-attack.js'
import { fightValues, weaponPatch } from './fight-fields.js'

const SECTIONS = ['tuning', 'stats', 'behavior', 'params', 'weapon']
const STATS = ['hp', 'dmg', 'speed']

export const storageKey = name => `dc-bench:${name}`

export function makeBenchModel(def) {
  const numeric = obj => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => Number.isFinite(v)))
  return {
    values: {
      tuning: { ...(def.tuning ?? {}) },
      stats: Object.fromEntries(STATS.map(k => [k, def.stats?.[k]])),
      behavior: numeric(def.behavior),
      params: { ...(def.params ?? {}) },
      weapon: fightValues(def),
    },
    // without a schema (a hook that failed to load, or none) the panel has
    // no tuning to offer, and Save must not overwrite what the file holds
    hasTuning: Array.isArray(def.tuningSchema),
    hasParams: Array.isArray(def.rig?.PARAM_SCHEMA),
    dirty: new Set(),
    switches: { frozen: false, invulnerable: false, hitboxes: false, timeScale: 1, paused: false, count: 1, collapsed: false },
  }
}

export function edit(model, section, key, value) {
  model.values[section][key] = value
  model.dirty.add(`${section}.${key}`)
}

export function setWeapon(model, id) {
  model.values.weapon = { weapon: id ?? null, damage: null, reach: null }
  for (const k of ['weapon', 'damage', 'reach']) model.dirty.add(`weapon.${k}`)
}

// `params: false` leaves the rig params out (the studio's draft keeps them
// in the cutter's file, not in the bench's saves).
export function savePatch(model, { params = true } = {}) {
  const { tuning, stats, behavior, params: rigParams, weapon } = model.values
  return {
    ...(model.hasTuning ? { tuning: { ...tuning } } : {}),
    ...(params && model.hasParams ? { params: { ...rigParams } } : {}),
    stats: { ...stats },
    behavior: { ...behavior, ...weaponPatch(weapon) },
  }
}

export const liveBehavior = model => savePatch(model).behavior

// Studio mode runs the bench in an iframe whose draft is the source of
// truth: no sessionStorage snapshot is read or kept.
export const usesSnapshots = saveAPI => !saveAPI?.isStudio

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

const validParam = (p, v) =>
  p.type === 'range' ? Number.isFinite(v) : p.type === 'color' ? /^#[0-9a-f]{6}$/i.test(v) : p.type === 'toggle' ? typeof v === 'boolean' : false

// Unsaved values win over what is on disk for keys that still exist (a
// tuning key still in the schema, re-clamped to its current range; a rig param likewise; a stat;
// a numeric behaviour field the def still has) and stay unsaved. The rest
// come from disk.
export function restore(model, text, schema, paramSchema) {
  let snap
  try { snap = JSON.parse(text ?? 'null') } catch { return }
  if (!snap || typeof snap !== 'object') return
  const bySchemaKey = new Map((schema ?? []).map(p => [p.key, p]))
  const byParamKey = new Map((paramSchema ?? []).map(p => [p.key, p]))
  for (const [k, v] of Object.entries(snap.values ?? {})) {
    const [section, key] = k.split('.')
    if (!SECTIONS.includes(section)) continue
    if (section === 'tuning') {
      const p = bySchemaKey.get(key)
      if (!p || (p.type === 'range' && !Number.isFinite(v))) continue
      edit(model, section, key, clampParams([p], { [key]: v })[key])
    } else if (section === 'params') {
      const p = byParamKey.get(key)
      if (!p || !validParam(p, v)) continue
      edit(model, section, key, clampParams([p], { [key]: v })[key])
    } else if (section === 'weapon') {
      if (key === 'weapon' ? (v === null || (typeof v === 'string' && Object.hasOwn(WEAPONS, v))) : (key === 'damage' || key === 'reach') && (v === null || Number.isFinite(v))) edit(model, section, key, v)
    } else if (key in model.values[section] && Number.isFinite(v)) edit(model, section, key, v)
  }
  for (const [k, v] of Object.entries(snap.switches ?? {}))
    if (k in model.switches && k !== 'paused' && typeof v === typeof model.switches[k]) model.switches[k] = v
}

// The snapshot rides one reload only: it is removed as it is read, and
// written again on every page hide (a reload by the watcher or by hand), so
// a later reload never resurrects an older panel state over newer files.
export function takeSnapshot(storage, key) {
  try { const text = storage.getItem(key); storage.removeItem(key); return text } catch { return null }
}
export function keepSnapshot(storage, key, model) {
  try { storage.setItem(key, snapshot(model)) } catch { /* no storage: the values are lost with the page */ }
}
