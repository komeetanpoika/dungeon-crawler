import { FINAL_DEPTH } from '../data/levels.js'

// Returns a valid starting depth when `buffer` ends with "level<N>"
// (N in 1..FINAL_DEPTH), otherwise null. Matches on the suffix so stray
// earlier keystrokes don't block a later valid code. Case-insensitive.
export function parseLevelCheat(buffer) {
  const m = /level(\d+)$/.exec(String(buffer).toLowerCase())
  if (!m) return null
  const depth = Number(m[1])
  return depth >= 1 && depth <= FINAL_DEPTH ? depth : null
}
