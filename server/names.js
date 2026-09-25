// Name screening for public play (4a spec §2). validateName
// (renderer/net/protocol.js) already limits a name to 1-12 of [A-Za-z0-9 _-];
// this is the server-only second gate: no slurs or hard profanity — matched
// as stems through look-alike digits, spacing and stretched letters — and no
// name that poses as a bot or staff. The list lives in server/ and is never
// served to a browser.
//
// Some blocked stems sit inside real place names or words (the Scunthorpe
// problem: "cunt" in Scunthorpe, "rapist" in therapist, "negro" in
// Montenegro/Negroni, "niger" in Nigeria/Nigerian) — see server/blocklist.js
// for the ALLOWLIST and why the bare word "Niger" is deliberately not on it.
// acceptableName strips every ALLOWLIST entry out of the normalised name,
// as a substring, before checking for a blocked stem, so the allowlisted
// word passes but a stem next to it (not part of it) still doesn't.
import { BLOCKLIST, ALLOWLIST } from './blocklist.js'

const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' }
export const RESERVED_PREFIXES = Object.freeze(['bot', 'admin', 'mod', 'moderator'])

export function normalizeName(name) {
  return String(name).toLowerCase()
    .replace(/[\s_-]/g, '')
    .replace(/[013457]/g, d => LOOKALIKE[d])
    .replace(/(.)\1+/g, '$1')
}

// false → the server answers bad_name, exactly as for a malformed name, so
// the reason is never revealed.
export function acceptableName(name) {
  const n = normalizeName(name)
  if (RESERVED_PREFIXES.some(p => n.startsWith(p))) return false
  const stripped = ALLOWLIST.reduce((s, word) => s.split(word).join(''), n)
  return !BLOCKLIST.some(stem => stripped.includes(stem))
}
