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

// How long the title screen holds a matched-but-extendable level cheat,
// waiting for another digit.
export const CHEAT_HOLD_MS = 600

// Whether a further digit could turn `depth` into a different valid depth —
// typing "level1" also matches on the way to "level18".
const couldExtend = depth =>
  LEVEL_CONFIG.some(c => c.depth !== depth && String(c.depth).startsWith(String(depth)))

// What the menu should do with the buffer as it stands: nothing (null), fire
// `depth` now (`wait: false`), or hold briefly in case the player is still
// typing a longer depth (`wait: true`). Pure — the timer lives in menu.js.
export function cheatDecision(buffer) {
  const depth = parseLevelCheat(buffer)
  if (depth === null) return null
  return { depth, wait: couldExtend(depth) }
}
