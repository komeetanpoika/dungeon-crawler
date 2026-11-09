// tools/monster-bench/fight-fields.js
// The bench's Fight section as pure data: a def's weapon and its overrides,
// what the weapon really does once overridden, what to save, and which
// fields the panel greys out (and why). `null` damage or reach means "the
// weapon's own". No DOM.
import { WEAPONS } from '../../renderer/systems/enemy-attack.js'

const NO_WEAPON = "No weapon: it can't hit in melee."

export function fightValues(def) {
  const b = def?.behavior ?? {}
  const o = b.weaponOverrides ?? {}
  return {
    weapon: b.weapon ?? null,
    damage: Number.isFinite(o.damage) ? o.damage : null,
    reach: Number.isFinite(o.reach) ? o.reach : null,
  }
}

export function effectiveFight(values, weapons = WEAPONS) {
  const w = values.weapon ? weapons[values.weapon] : null
  if (!w) return { damage: null, reach: null }
  return { damage: values.damage ?? w.damage, reach: values.reach ?? w.reach }
}

export function weaponPatch(values, weapons = WEAPONS) {
  const w = values.weapon ? weapons[values.weapon] : null
  if (!w) return { weapon: null, weaponOverrides: null }
  const o = {}
  for (const k of ['damage', 'reach']) if (Number.isFinite(values[k]) && values[k] !== w[k]) o[k] = values[k]
  return { weapon: values.weapon, weaponOverrides: Object.keys(o).length ? o : null }
}

export function fieldStates(values, ignores = {}) {
  const on = { disabled: false, reason: '' }
  const states = { hp: { ...on }, speed: { ...on }, weapon: { ...on }, damage: { ...on }, reach: { ...on } }
  if (!values.weapon) for (const k of ['damage', 'reach']) states[k] = { disabled: true, reason: NO_WEAPON }
  for (const [k, reason] of Object.entries(ignores ?? {})) if (k in states) states[k] = { disabled: true, reason }
  return states
}
