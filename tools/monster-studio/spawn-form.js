// Pure spawn-rule helpers shared by the studio server and the page (no node: imports).
// A spawn is { depths, weight } (dungeon & cave levels) and/or
// { openMaps: { depths, count } } (open-map outskirts), or null for nowhere.
export const SPAWN_LIMITS = {
  dungeon: { min: 1, max: 5 },
  openMaps: { min: 7, max: 18 },
  storyMaps: [8, 10],
  weight: { min: 0.25, max: 4, step: 0.25 },
  count: { min: 1, max: 6 },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)
const range = (from, to, lim) => {
  const a = clamp(Math.round(num(from, lim.min)), lim.min, lim.max)
  const b = clamp(Math.round(num(to, lim.max)), lim.min, lim.max)
  return a <= b ? [a, b] : [b, a]
}
const snap = (w, L) => clamp(Math.round(num(w, 1) / L.step) * L.step, L.min, L.max)

export function spawnToForm(spawn) {
  const L = SPAWN_LIMITS, s = spawn ?? {}
  const d = Array.isArray(s.depths), o = s.openMaps && Array.isArray(s.openMaps.depths)
  return {
    dungeon: { on: d, from: d ? s.depths[0] : L.dungeon.min, to: d ? s.depths[1] : L.dungeon.max, weight: d ? (s.weight ?? 1) : 1 },
    openMaps: { on: !!o, from: o ? s.openMaps.depths[0] : L.openMaps.min, to: o ? s.openMaps.depths[1] : L.openMaps.max, count: o ? (s.openMaps.count ?? 1) : 1 },
  }
}

export function formToSpawn(form) {
  const L = SPAWN_LIMITS, out = {}
  const d = form?.dungeon, o = form?.openMaps
  if (d?.on) { out.depths = range(d.from, d.to, L.dungeon); out.weight = snap(d.weight, L.weight) }
  if (o?.on) {
    out.openMaps = { depths: range(o.from, o.to, L.openMaps), count: clamp(Math.round(num(o.count, 1)), L.count.min, L.count.max) }
  }
  return Object.keys(out).length ? out : null
}

const okRange = (r, lim) => Array.isArray(r) && r.length === 2 && r.every(Number.isInteger) && r[0] >= lim.min && r[1] <= lim.max && r[0] <= r[1]

export function spawnErrors(spawn) {
  if (spawn == null) return []
  const L = SPAWN_LIMITS, errs = []
  if (typeof spawn !== 'object' || Array.isArray(spawn)) return ['spawn must be an object or null']
  if ('depths' in spawn && !okRange(spawn.depths, L.dungeon)) errs.push(`depths must be two whole levels ${L.dungeon.min}-${L.dungeon.max}, low to high`)
  if ('weight' in spawn && !(typeof spawn.weight === 'number' && spawn.weight >= L.weight.min && spawn.weight <= L.weight.max)) errs.push(`weight must be ${L.weight.min}-${L.weight.max}`)
  if ('openMaps' in spawn) {
    const o = spawn.openMaps
    if (!o || typeof o !== 'object') errs.push('openMaps must be an object')
    else {
      if (!okRange(o.depths, L.openMaps)) errs.push(`openMaps.depths must be two whole maps ${L.openMaps.min}-${L.openMaps.max}, low to high`)
      if ('count' in o && !(Number.isInteger(o.count) && o.count >= L.count.min && o.count <= L.count.max)) errs.push(`openMaps.count must be a whole number ${L.count.min}-${L.count.max}`)
    }
  }
  return errs
}

export function describeSpawn(spawn) {
  const parts = []
  if (Array.isArray(spawn?.depths)) parts.push(`dungeon & cave levels ${spawn.depths[0]}–${spawn.depths[1]} (how common: ${spawn.weight ?? 1})`)
  if (Array.isArray(spawn?.openMaps?.depths)) parts.push(`open maps ${spawn.openMaps.depths[0]}–${spawn.openMaps.depths[1]}, ${spawn.openMaps.count ?? 1} per map`)
  return parts.length ? parts.join('; ') : 'nowhere'
}
