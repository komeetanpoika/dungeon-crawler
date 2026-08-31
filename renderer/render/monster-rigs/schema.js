// PARAM_SCHEMA helpers shared by rigs, the game loader, and the monster lab.
// A schema is an ordered array of { key, label, group, type, ... } where type
// is 'range' (min/max/step/default numbers), 'color' (#rrggbb default) or
// 'toggle' (boolean default). Pure — no DOM, no game imports.
const TYPES = new Set(['range', 'color', 'toggle'])
const COLOR_RE = /^#[0-9a-f]{6}$/i

export function schemaErrors(schema) {
  if (!Array.isArray(schema)) return ['schema is not an array']
  const errs = [], seen = new Set()
  schema.forEach((p, i) => {
    if (!p || typeof p.key !== 'string' || !p.key) { errs.push(`#${i}: missing key`); return }
    if (seen.has(p.key)) errs.push(`${p.key}: duplicate key`)
    seen.add(p.key)
    if (!TYPES.has(p.type)) errs.push(`${p.key}: unknown type "${p.type}"`)
    if (typeof p.label !== 'string' || !p.label) errs.push(`${p.key}: missing label`)
    if (typeof p.group !== 'string' || !p.group) errs.push(`${p.key}: missing group`)
    if (p.type === 'range') {
      if (![p.min, p.max, p.step, p.default].every(Number.isFinite)) errs.push(`${p.key}: min/max/step/default must be numbers`)
      else {
        if (p.min >= p.max) errs.push(`${p.key}: min >= max`)
        if (p.default < p.min || p.default > p.max) errs.push(`${p.key}: default out of range`)
      }
    }
    if (p.type === 'color' && !COLOR_RE.test(p.default ?? '')) errs.push(`${p.key}: default must be #rrggbb`)
    if (p.type === 'toggle' && typeof p.default !== 'boolean') errs.push(`${p.key}: default must be boolean`)
  })
  return errs
}

export function defaultParams(schema) {
  return Object.fromEntries(schema.map(p => [p.key, p.default]))
}

export function clampParams(schema, params, warn = () => {}) {
  const out = defaultParams(schema)
  const byKey = new Map(schema.map(p => [p.key, p]))
  for (const [k, v] of Object.entries(params ?? {})) {
    const p = byKey.get(k)
    if (!p) { warn(`unknown param "${k}" ignored`); continue }
    if (p.type === 'range') {
      if (!Number.isFinite(v)) { warn(`param "${k}" is not a number — default kept`); continue }
      const c = Math.max(p.min, Math.min(p.max, v))
      if (c !== v) warn(`param "${k}" clamped ${v} -> ${c}`)
      out[k] = c
    } else if (p.type === 'color') {
      if (COLOR_RE.test(v)) out[k] = v
      else warn(`param "${k}" is not #rrggbb — default kept`)
    } else out[k] = !!v
  }
  return out
}
