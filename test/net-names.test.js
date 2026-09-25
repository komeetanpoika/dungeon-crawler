import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKLIST, ALLOWLIST } from '../server/blocklist.js'
import { normalizeName, acceptableName, RESERVED_PREFIXES } from '../server/names.js'

// Ordinary names and words a substring filter could trip on (the Scunthorpe
// problem). Every one must pass: a stem that hits any of these is too short
// or too generic, so drop it or lengthen it. This list is checked both raw
// (BLOCKLIST below) and through acceptableName, so it must NOT contain a
// name that only passes via ALLOWLIST stripping — those live separately in
// ALLOWLISTED_PASS.
const INNOCENT = ['Aino', 'Ilmari', 'Vaino', 'Sam', 'Alex', 'Kalle_99', 'Pasi', 'Kassi', 'Lasse', 'Tassu',
  'Hannu', 'Jussi', 'Matti', 'Pekka', 'Mika', 'Sakari', 'Tuomas', 'Thomas', 'Kasper', 'Sukka', 'Pakila',
  'Vesa', 'Grape', 'Hancock', 'Dickens', 'Spicer', 'Cassandra', 'Essi', 'Titta', 'Kukka', 'Pippa', 'Ninja 7',
  'Shadow', 'Karhu', 'Susi', 'Ahti', 'Ukko', 'Tapio', 'Abbot', 'Tabot', 'Otto', 'Helmi', 'Lumikki', 'Ronja',
  'Peppi', 'Mustikka', 'Kristian', 'Therese', 'Hilkka', 'Raparperi', 'Analyysi', 'Sussex', 'Essex',
  'Arsenal', 'Kalevala', 'Perkele', 'Saatana',
  // Reviewer's fix-round-1 sample (real Finnish/English given names, common
  // surnames, and near-miss/leetspeak/decorated names), minus the five
  // entries that only pass through ALLOWLIST stripping (see
  // ALLOWLISTED_PASS below).
  'Sanna', 'Kimmo', 'Mikko', 'Petteri', 'Anneli', 'Niko', 'Oskari', 'Hessu', 'Nisse', 'Rasmus', 'Pikku',
  'Lassi', 'Masa', 'Mira', 'Nea', 'Scott', 'Dick', 'Cassie', 'Kuntz', 'Assunta', 'Titania', 'Harold',
  'Nigel', 'Spencer', 'Pussycat', 'Cockburn', 'xX_Aino_Xx', 'Mage42', 'NoobSlayer', 'Lollipop', 'Lolita',
  'Matsushita',
  // Final-review fix wave (2026-09-25, item 6): real names/handles a
  // too-short stem used to catch. 'Hintikka' and 'Rampage' pass because
  // their culprit stems (hinti, rampa) were dropped from BLOCKLIST outright,
  // so — unlike ALLOWLISTED_PASS below — they belong here, checked raw too.
  'Hintikka', 'Rampage', 'Perseus', 'Persephone', 'Thoth',
  // Reserved-prefix narrowing: real names/handles starting with "bot"/"mod"
  // that must not be treated as posing as a bot or a moderator.
  'Modest', 'Modric', 'Mode', 'Moderna', 'Bottas', 'Botticelli', 'Botond', 'Bottom', 'Botanist']

// Real places/words that only pass because acceptableName forgives these
// ALLOWLIST entries (server/blocklist.js) — each one raw-contains a stem
// that must stay in BLOCKLIST (cunt, rapist, negro, niger). Checked only
// through acceptableName, never through raw stem containment.
// Final-review fix wave (2026-09-25, item 6) additions: Georgy/orgy,
// Sisyphus/sisy, Shuri+Hurricane/huri, Chrysalis/rysa, Minigames+Tanigawa/
// niga, Dagobah/dago. Unlike the INNOCENT four above, these stems must stay
// in BLOCKLIST (niga alone catches "nigga"; the others are real
// slurs/profanity too short to lengthen without losing their own bare
// form), so the false positive is carved out per real name/word via
// ALLOWLIST instead. (Thoth/thot is not here — see blocklist.js: "thot" is
// a strict prefix of "thoth", so allowlisting "thoth" would have forgiven
// any "thot"+"h" from elsewhere too; "thot" was dropped instead, so Thoth
// is in INNOCENT above.)
const ALLOWLISTED_PASS = ['Scunthorpe', 'Therapist', 'Nigeria', 'Montenegro', 'Negroni',
  'Georgy', 'Sisyphus', 'Shuri', 'Hurricane', 'Chrysalis', 'Minigames', 'Tanigawa', 'Dagobah']

// Each must be refused: the stems themselves, and the tricks normalisation
// exists for (look-alike digits, spacing, underscores, stretched letters,
// a stem inside a longer name).
const REFUSED = ['vittu', 'V1TTU', 'v i t t u', 'Vi_ttu', 'VITTUUU', 'xVittux', 'paska', 'P4sk4', 'kyrpa',
  'mulkku', 'huora', 'neekeri', 'N33k3ri', 'fuck', 'FUUUCK', 'f_u_c_k', 'Fuck3r', 'motherfucker', 'cunt',
  'nigger', 'N1gg3r', 'nigga', 'faggot', 'whore',
  // item 7: the 6→g / 9→g look-alike bypass ("ni9a" -> "niga", "6imp" -> "gimp")
  'ni9a', '6imp']

describe('normalizeName', () => {
  it('lowercases, drops space _ -, maps look-alike digits and collapses runs', () => {
    assert.equal(normalizeName('V1_t-T u'), 'vitu')
    assert.equal(normalizeName('Kalle_99'), 'kaleg')
    assert.equal(normalizeName('0137 45'), 'oietas')
    assert.equal(normalizeName('Aino'), 'aino')
  })
  it('also maps 6 and 9 to g (item 7: closes the g/6/9 bypass)', () => {
    assert.equal(normalizeName('669'), 'g')
    assert.equal(normalizeName('9imp6'), 'gimpg')
  })
})

describe('BLOCKLIST', () => {
  it('holds 120-200 unique stems, each already normalised and at least 4 letters', () => {
    assert.ok(Object.isFrozen(BLOCKLIST))
    assert.ok(BLOCKLIST.length >= 120 && BLOCKLIST.length <= 200, `${BLOCKLIST.length} stems`)
    assert.equal(new Set(BLOCKLIST).size, BLOCKLIST.length)
    for (const stem of BLOCKLIST) {
      assert.match(stem, /^[a-z]{4,}$/, stem)
      assert.equal(normalizeName(stem), stem, `${stem} is not in normalised form`)
    }
  })
  it('no stem sits inside an ordinary name', () => {
    for (const name of INNOCENT) {
      const n = normalizeName(name)
      for (const stem of BLOCKLIST) assert.ok(!n.includes(stem), `stem "${stem}" hits "${name}"`)
    }
  })
})

describe('acceptableName', () => {
  it('ordinary Finnish and English names pass', () => {
    for (const name of INNOCENT) assert.equal(acceptableName(name), true, name)
  })
  it('slurs and hard profanity are refused, through look-alikes, spacing and stretching', () => {
    for (const name of REFUSED) assert.equal(acceptableName(name), false, name)
  })
  it('names posing as a bot or staff are refused', () => {
    assert.deepEqual(RESERVED_PREFIXES, ['bot', 'admin', 'mod', 'moderator'])
    for (const name of ['Bot', 'Bot Ukko', 'B0t', 'bot_7', 'B o t', 'Admin', '4dmin', 'Mod', 'M0d3rator', 'moderator'])
      assert.equal(acceptableName(name), false, name)
    for (const name of ['Abbot', 'Tabot', 'Ukko']) assert.equal(acceptableName(name), true, name)
  })
  it('a reserved prefix must be the whole name or followed by a separator/digit — a name that only starts the letters passes (item 6)', () => {
    for (const name of ['Modest', 'Modric', 'Mode', 'Moderna', 'Bottas', 'Botticelli', 'Botond', 'Bottom', 'Botanist'])
      assert.equal(acceptableName(name), true, name)
  })
})

describe('ALLOWLIST', () => {
  it('holds normalised, unique words', () => {
    assert.ok(Object.isFrozen(ALLOWLIST))
    assert.equal(new Set(ALLOWLIST).size, ALLOWLIST.length)
    for (const word of ALLOWLIST) assert.equal(normalizeName(word), word, `${word} is not in normalised form`)
  })
  it('real places/words that raw-contain a required stem now pass', () => {
    for (const name of ALLOWLISTED_PASS) assert.equal(acceptableName(name), true, name)
  })
  it('a slur alone still fails, even one identical to an allowlisted-adjacent word', () => {
    // normalizeName collapses doubled letters, so "nigger" and the country
    // name "Niger" both normalise to the exact string "niger" — not one
    // merely containing the other. "niger" is therefore deliberately absent
    // from ALLOWLIST (only "Nigeria"/"Nigerian" are): allowlisting it would
    // strip the slur itself wherever it appears. The bare country name
    // stays refused as a result — a known, deliberate trade-off.
    assert.equal(acceptableName('nigger'), false)
    assert.equal(acceptableName('Niger'), false)
  })
  it('a slur next to (not part of) an allowlisted word still fails', () => {
    for (const name of ['TherapistCunt', 'ScunthorpeVittu', 'MontenegroFuck', 'NigeriaNigger'])
      assert.equal(acceptableName(name), false, name)
  })
  it('a stem sharing a boundary letter with an allowlisted word is never forgiven', () => {
    // Built from the real BLOCKLIST/ALLOWLIST, not hard-coded, so this stays
    // valid as either list is edited. For every (stem, word) pair, wherever
    // a suffix of the stem equals a prefix of the word (in either
    // direction), the merged string shares that boundary letter instead of
    // repeating it — e.g. "cunt" + "therapist" -> "cuntherapist" — which is
    // exactly the construction the old strip-then-check implementation let
    // through (see server/names.js's comment on acceptableName). It must
    // still be refused under span containment, because the stem's
    // occurrence starts before the allowlisted word's occurrence does.
    //
    // Is [spanStart, spanEnd) inside some occurrence of a DIFFERENT
    // ALLOWLIST word in `haystack`? Used only to recognise the rare, benign
    // case where two allowlisted words placed back to back happen to spell
    // a third one at the join — e.g. "negro" + "nigeria" begins with the
    // allowlisted word "negroni", which legitimately covers "negro" even
    // though this pair's own word ("nigeria") doesn't start there. That's a
    // structural coincidence between real place names, not a bypass: this
    // helper is used only to skip asserting refusal for such an already-
    // legitimately-covered span, never to excuse an uncovered one.
    function coveredByAnAllowlistedWord(haystack, spanStart, spanEnd) {
      return ALLOWLIST.some(w => {
        let i = haystack.indexOf(w)
        while (i !== -1) {
          if (i <= spanStart && i + w.length >= spanEnd) return true
          i = haystack.indexOf(w, i + 1)
        }
        return false
      })
    }

    let checked = 0
    for (const stem of BLOCKLIST) {
      for (const word of ALLOWLIST) {
        const maxOverlap = Math.min(stem.length, word.length) - 1
        for (let overlap = 1; overlap <= maxOverlap; overlap++) {
          if (stem.slice(-overlap) === word.slice(0, overlap)) {
            const stemThenWord = stem + word.slice(overlap)
            assert.equal(acceptableName(stemThenWord), false, `${stem}+${word} (overlap ${overlap}) -> "${stemThenWord}"`)
            checked++
          }
          if (word.slice(-overlap) === stem.slice(0, overlap)) {
            const wordThenStem = word + stem.slice(overlap)
            assert.equal(acceptableName(wordThenStem), false, `${word}+${stem} (overlap ${overlap}) -> "${wordThenStem}"`)
            checked++
          }
        }
        // Plain concatenations (no shared boundary letter) must also fail —
        // unless the stem's own span is already, separately covered by some
        // other allowlisted word's occurrence (see helper above).
        const stemThenWordPlain = stem + word
        if (!coveredByAnAllowlistedWord(stemThenWordPlain, 0, stem.length))
          assert.equal(acceptableName(stemThenWordPlain), false, `${stem}${word}`)
        const wordThenStemPlain = word + stem
        if (!coveredByAnAllowlistedWord(wordThenStemPlain, word.length, word.length + stem.length))
          assert.equal(acceptableName(wordThenStemPlain), false, `${word}${stem}`)
        checked++
      }
    }
    assert.ok(checked > 0, 'expected at least one real boundary-overlap pair to exist')
  })
})
