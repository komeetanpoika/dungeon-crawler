import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKLIST } from '../server/blocklist.js'
import { normalizeName, acceptableName, RESERVED_PREFIXES } from '../server/names.js'

// Ordinary names and words a substring filter could trip on (the Scunthorpe
// problem). Every one must pass: a stem that hits any of these is too short
// or too generic, so drop it or lengthen it.
const INNOCENT = ['Aino', 'Ilmari', 'Vaino', 'Sam', 'Alex', 'Kalle_99', 'Pasi', 'Kassi', 'Lasse', 'Tassu',
  'Hannu', 'Jussi', 'Matti', 'Pekka', 'Mika', 'Sakari', 'Tuomas', 'Thomas', 'Kasper', 'Sukka', 'Pakila',
  'Vesa', 'Grape', 'Hancock', 'Dickens', 'Spicer', 'Cassandra', 'Essi', 'Titta', 'Kukka', 'Pippa', 'Ninja 7',
  'Shadow', 'Karhu', 'Susi', 'Ahti', 'Ukko', 'Tapio', 'Abbot', 'Tabot', 'Otto', 'Helmi', 'Lumikki', 'Ronja',
  'Peppi', 'Mustikka', 'Kristian', 'Therese', 'Hilkka', 'Raparperi', 'Analyysi', 'Sussex', 'Essex',
  'Arsenal', 'Kalevala', 'Perkele', 'Saatana']

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
