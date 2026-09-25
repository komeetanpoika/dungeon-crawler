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
//
// acceptableName forgives a blocked-stem occurrence only when it sits
// ENTIRELY inside a single occurrence of an allowlisted word in the
// normalised name — i.e. every character of the stem match is also part of
// the allowlist-word match, at the same position. It does NOT strip the
// allowlisted word out of the string first: an earlier version did that
// (`name.split(word).join('')`), which was bypassable at the boundary — a
// name like "cunt" + "herapist" contains "therapist" as a substring (using
// the stem's trailing "t" as the word's leading "t"), so stripping
// "therapist" silently ate the "t" the "cunt" stem needed and let the name
// through. Span containment doesn't have this hole: "cunt"'s span [0,4) is
// not contained by "therapist"'s span [3,12) in "cuntherapist" (it starts
// before it), so the stem occurrence is still flagged and the name is still
// refused. A stem occurrence that's a genuine substring of the allowlisted
// word — "rapist" at [3,9) inside "therapist"'s [0,9) — stays forgiven.
import { BLOCKLIST, ALLOWLIST } from './blocklist.js'

const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 9: 'g' }
export const RESERVED_PREFIXES = Object.freeze(['bot', 'admin', 'mod', 'moderator'])
// A reserved prefix only refuses a name that IS the word (after
// normalising) or that, in the name as typed, is immediately followed by a
// separator or a digit — "Bot Ukko", "bot_1", "mod-x", "4dmin" (the leading
// "4" is itself look-alike-mapped by normalizeName, not matched here). This
// is checked against the raw name, not the normalised one, because
// normalizeName strips spaces/_/- — on the normalised string alone "Bot
// Ukko" and "Botticelli" would be indistinguishable substring matches.
// Without this the prefix check used to refuse any name merely *starting*
// with "mod"/"bot" once normalised, catching real names/handles like
// Modest, Modric, Bottas or Botticelli.
const RESERVED_RE = new RegExp(`^(${RESERVED_PREFIXES.join('|')})([\\s_-]|\\d)`, 'i')

export function normalizeName(name) {
  return String(name).toLowerCase()
    .replace(/[\s_-]/g, '')
    .replace(/[01345679]/g, d => LOOKALIKE[d])
    .replace(/(.)\1+/g, '$1')
}

// Every [start, end) span where `needle` occurs in `haystack`, including
// overlapping occurrences.
function occurrenceSpans(haystack, needle) {
  const spans = []
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    spans.push([i, i + needle.length])
    i = haystack.indexOf(needle, i + 1)
  }
  return spans
}

// false → the server answers bad_name, exactly as for a malformed name, so
// the reason is never revealed.
export function acceptableName(name) {
  const raw = String(name)
  const n = normalizeName(raw)
  if (RESERVED_PREFIXES.includes(n) || RESERVED_RE.test(raw)) return false
  const allowSpans = ALLOWLIST.flatMap(word => occurrenceSpans(n, word))
  for (const stem of BLOCKLIST) {
    for (const [start, end] of occurrenceSpans(n, stem)) {
      const forgiven = allowSpans.some(([aStart, aEnd]) => aStart <= start && end <= aEnd)
      if (!forgiven) return false
    }
  }
  return true
}
