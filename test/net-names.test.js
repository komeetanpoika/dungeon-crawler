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
  'Matsushita']

// Real places/words that only pass because acceptableName strips these
// ALLOWLIST entries (server/blocklist.js) before the stem check — each one
// raw-contains a stem that must stay in BLOCKLIST (cunt, rapist, negro,
// niger). Checked only through acceptableName, never through raw stem
// containment.
const ALLOWLISTED_PASS = ['Scunthorpe', 'Therapist', 'Nigeria', 'Montenegro', 'Negroni']

// Each must be refused: the stems themselves, and the tricks normalisation
// exists for (look-alike digits, spacing, underscores, stretched letters,
// a stem inside a longer name).
const REFUSED = ['vittu', 'V1TTU', 'v i t t u', 'Vi_ttu', 'VITTUUU', 'xVittux', 'paska', 'P4sk4', 'kyrpa',
  'mulkku', 'huora', 'neekeri', 'N33k3ri', 'fuck', 'FUUUCK', 'f_u_c_k', 'Fuck3r', 'motherfucker', 'cunt',
  'nigger', 'N1gg3r', 'nigga', 'faggot', 'whore']

describe('normalizeName', () => {
  it('lowercases, drops space _ -, maps look-alike digits and collapses runs', () => {
    assert.equal(normalizeName('V1_t-T u'), 'vitu')
    assert.equal(normalizeName('Kalle_99'), 'kale9')
    assert.equal(normalizeName('0137 45'), 'oietas')
    assert.equal(normalizeName('Aino'), 'aino')
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
})
