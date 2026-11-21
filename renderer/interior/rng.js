// Seeded randomness for house interiors. A house is a pure function of its
// seed (a hash of the world seed and the door), so it is the same house on
// every visit; nothing in renderer/interior/ reads Math.random.
export { mulberry32 } from '../terrain/lib.js'

// FNV-1a over a string, as an unsigned 32-bit seed.
export function hashStr(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

export const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
export const chance = (rng, p) => rng() < p
// [[value, weight], ...] -> a value
export function weighted(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [v, w] of entries) { if (r < w) return v; r -= w }
  return entries[entries.length - 1][0]
}
export function shuffle(rng, arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
