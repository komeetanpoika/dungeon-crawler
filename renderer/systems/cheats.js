import { LEVEL_CONFIG } from '../data/levels.js'

// Returns a valid starting depth when `buffer` ends with "level<N>"
// (N must have a LEVEL_CONFIG entry — currently 0..6), otherwise null.
// Matches on the suffix so stray earlier keystrokes don't block a later
// valid code. Case-insensitive.
export function parseLevelCheat(buffer) {
  const m = /level(\d+)$/.exec(String(buffer).toLowerCase())
  if (!m) return null
  const depth = Number(m[1])
  return LEVEL_CONFIG.some(c => c.depth === depth) ? depth : null
}

// In-game weapon cheat: typing "mauno" equips the Maunonmiekka. Suffix-matched
// like the level cheat so stray earlier keystrokes don't block it.
export function parseWeaponCheat(buffer) {
  return /mauno$/.test(String(buffer).toLowerCase()) ? 'maunonmiekka' : null
}
