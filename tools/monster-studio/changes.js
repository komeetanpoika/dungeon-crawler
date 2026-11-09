// "What changes" on the Publish tab: the draft against the game's copy, in
// plain words. Pure (no DOM, no node: imports).
import { effectiveFight, fightValues } from '../monster-bench/fight-fields.js'
import { WEAPONS } from '../../renderer/systems/enemy-attack.js'
import { describeSpawn } from './spawn-form.js'

const show = v => (v == null ? '—' : v)
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const SKIP_BEHAVIOR = new Set(['weapon', 'weaponOverrides'])

export function describeChanges({ name, isNew, published, draft, cutChanged, labels = {}, weapons = WEAPONS }) {
  const out = []
  if (isNew) {
    out.push(`New monster "${name}"`)
    if (draft?.spawn) out.push(`Spawns: ${describeSpawn(draft.spawn)}`)
    return out
  }
  if (cutChanged) out.push('New cut')
  const pub = published ?? {}, d = draft ?? {}
  for (const [key, label] of [['hp', 'Health'], ['speed', 'Speed']]) {
    const a = pub.stats?.[key], b = d.stats?.[key]
    if (a !== b) out.push(`${label} ${show(a)} → ${show(b)}`)
  }
  const fa = fightValues(pub), fb = fightValues(d)
  if (fa.weapon !== fb.weapon) out.push(`Weapon ${fa.weapon ?? 'none'} → ${fb.weapon ?? 'none'}`)
  const ea = effectiveFight(fa, weapons), eb = effectiveFight(fb, weapons)
  for (const [key, label] of [['damage', 'Damage'], ['reach', 'Reach']]) {
    if (ea[key] == null && eb[key] == null) continue
    if (ea[key] !== eb[key]) out.push(`${label} ${show(ea[key])} → ${show(eb[key])}`)
  }
  const diffKeys = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !same(a[k], b[k]))
  for (const k of diffKeys(pub.params, d.params)) out.push(`Movement: ${labels[k] ?? k} ${show(pub.params?.[k])} → ${show(d.params?.[k])}`)
  for (const k of diffKeys(pub.tuning, d.tuning)) out.push(`Special moves: ${k} ${show(pub.tuning?.[k])} → ${show(d.tuning?.[k])}`)
  for (const k of diffKeys(pub.behavior, d.behavior)) {
    if (SKIP_BEHAVIOR.has(k)) continue
    const a = pub.behavior?.[k], b = d.behavior?.[k]
    if ((a == null || typeof a === 'number') && (b == null || typeof b === 'number')) out.push(`${k} ${show(a)} → ${show(b)}`)
  }
  if (!same(pub.spawn, d.spawn)) out.push(`Spawns: ${describeSpawn(d.spawn)}`)
  return out
}
